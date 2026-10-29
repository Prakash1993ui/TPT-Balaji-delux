/* Operational helpers shared by the UI and regression tests. */
(function (App) {
  'use strict';
  const S = App.Store, U = App.U;
  function rateFor(typeId, date) {
    const base = +(S.get('roomTypes', typeId) || {}).rate || 0;
    const day = U.parse(date).getDay();
    const plans = S.all('ratePlans').filter(p => p.typeId === typeId && p.from <= date && p.to >= date
      && (!p.days || !p.days.length || p.days.includes(day)));
    // Narrower date windows override broad seasons; newest wins a tie.
    plans.sort((a,b) => U.diffDays(a.from,a.to) - U.diffDays(b.from,b.to) || (a.days && a.days.length || 7) - (b.days && b.days.length || 7) || (b.updatedAt || 0) - (a.updatedAt || 0) || a.id.localeCompare(b.id));
    return plans.length ? +plans[0].rate : base;
  }
  function reconcile(date, opening = 0) {
    const modes = {};
    for (const b of S.all('bookings')) for (const p of b.payments || []) {
      if (U.datePart(p.at) !== date) continue;
      const mode = p.mode || 'Other';
      modes[mode] = U.round2((modes[mode] || 0) + (+p.amount || 0) * (p.kind === 'refund' ? -1 : 1));
    }
    let cashExpenses = 0;
    for (const e of S.all('expenses')) if (e.date === date && e.mode === 'Cash') cashExpenses += +e.amount || 0;
    return { modes, cashExpenses: U.round2(cashExpenses), expectedCash: U.round2(+opening + (modes.Cash || 0) - cashExpenses) };
  }
  function closeDay(date, opening, counted, note) {
    if (!S.can('reports')) throw new Error('Only managers can close a day');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > U.today()) throw new Error('Choose today or an earlier date');
    if (![opening, counted].every(v => v !== '' && Number.isFinite(+v) && +v >= 0)) throw new Error('Enter valid opening and counted cash');
    const totals = reconcile(date, +opening);
    const difference = U.round2(+counted - totals.expectedCash);
    if (difference && !String(note || '').trim()) throw new Error('Explain the cash difference before closing');
    if (S.get('dayClosings', date)) throw new Error('This day already has a closing');
    return S.put('dayClosings', { id: date, date, opening: +opening, counted: +counted, ...totals,
      difference, note: String(note || '').trim(), closedAt: new Date().toISOString(), closedBy: S.user.name });
  }
  function wifiPassword() {
    // Rejection sampling avoids modulo bias; uses the platform CSPRNG only.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const limit = 256 - 256 % alphabet.length;
    let out = '';
    while (out.length < 16) {
      const bytes = new Uint8Array(32);
      window.crypto.getRandomValues(bytes);
      for (const b of bytes) if (b < limit && out.length < 16) out += alphabet[b % alphabet.length];
    }
    return out;
  }
  App.Ops = { rateFor, reconcile, closeDay, wifiPassword };
})(window.App = window.App || {});
