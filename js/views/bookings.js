/*
 * Bookings: list page, booking detail (folio) and the check-in / check-out /
 * payment / charge / cancel dialogs.
 */
(function (App) {
  'use strict';
  const { html, useState, useMemo, U, L, Icon, Button, Badge, Field, Input, MoneyInput, Select, Textarea, Segmented, Stepper,
    Modal, Avatar, Page, EmptyState, SearchInput, KV, toast, confirm, chooseAction, attempt } = App;
  const S = App.Store;

  // ------------------------------------------------------------------ small pieces
  function StatusBadge({ b }) {
    if (L.isOverdue(b)) return html`<${Badge} tone="danger" dot>Overdue<//>`;
    if (L.isDueToday(b)) return html`<${Badge} tone="violet" dot>Due out<//>`;
    if (L.isLateArrival(b)) return html`<${Badge} tone="warn" dot>Late<//>`;
    if (b.status === 'reserved' && U.datePart(b.checkIn) === U.today()) return html`<${Badge} tone="info" dot>Arriving<//>`;
    const st = L.BOOKING_STATUS[b.status] || { label: b.status, tone: 'muted' };
    return html`<${Badge} tone=${st.tone} dot>${st.label}<//>`;
  }
  const Money = ({ v, tone }) => html`<span class=${U.cls('money', tone && 'text-' + tone)}>${U.money(v)}</span>`;
  const Balance = ({ b }) => {
    const bal = L.totals(b).balance;
    if (b.status === 'cancelled' || b.status === 'no_show') return bal < 0 ? html`<span class="text-warn">Refund ${U.money(-bal)}</span>` : html`<span class="muted">—</span>`;
    if (bal > 0) return html`<span class="text-danger fw-600">${U.money(bal)} due</span>`;
    if (bal < 0) return html`<span class="text-warn">${U.money(-bal)} extra</span>`;
    return html`<span class="text-ok">Paid</span>`;
  };
  const s24 = () => S.settings().checkoutMode === '24h';
  App.StatusBadge = StatusBadge;
  App.BalanceText = Balance;

  // ------------------------------------------------------------------ list page
  const TABS = [
    { id: 'inhouse', label: 'In house', filter: (b) => b.status === 'checked_in', sort: (b) => b.checkOut, dir: 1 },
    { id: 'arrivals', label: 'Arrivals', filter: (b) => b.status === 'reserved', sort: (b) => b.checkIn, dir: 1 },
    { id: 'departures', label: 'Due out', filter: (b) => b.status === 'checked_in' && U.datePart(b.checkOut) <= U.today(), sort: (b) => b.checkOut, dir: 1 },
    { id: 'history', label: 'Checked out', filter: (b) => b.status === 'checked_out', sort: (b) => b.checkOut, dir: -1 },
    { id: 'cancelled', label: 'Cancelled', filter: (b) => b.status === 'cancelled' || b.status === 'no_show', sort: (b) => b.checkIn, dir: -1 },
    { id: 'all', label: 'All', filter: () => true, sort: (b) => b.checkIn, dir: -1 },
  ];
  const PERIODS = [
    { value: '', label: 'Any time' },
    { value: 'today', label: 'Today' },
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: 'month', label: 'This month' },
    { value: 'lastmonth', label: 'Last month' },
  ];
  function periodRange(p) {
    const t = U.today();
    if (p === 'today') return [t, t];
    if (p === '7') return [U.addDays(t, -6), t];
    if (p === '30') return [U.addDays(t, -29), t];
    if (p === 'month') return [U.startOfMonth(t), U.endOfMonth(t)];
    if (p === 'lastmonth') {
      const s = U.startOfMonth(U.addDays(U.startOfMonth(t), -1));
      return [s, U.endOfMonth(s)];
    }
    return null;
  }

  function BookingsPage({ route }) {
    App.useStore();
    App.useTick(60000);
    const wide = App.useMedia(App.BP.wide);
    const tabId = route.query.tab || 'inhouse';
    const tab = TABS.find((t) => t.id === tabId) || TABS[0];
    const [q, setQ] = useState('');
    const [period, setPeriod] = useState('');
    const [limit, setLimit] = useState(40);
    const all = S.all('bookings');
    const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, all.filter(t.filter).length])), [S.version]);
    const range = periodRange(period);
    const list = useMemo(() => {
      let arr = all.filter(tab.filter);
      if (range) arr = arr.filter((b) => {
        const d = U.datePart(b.status === 'checked_out' ? b.checkOut : b.checkIn);
        return d >= range[0] && d <= range[1];
      });
      if (q.trim()) arr = arr.filter((b) => {
        const g = L.guest(b.guestId) || {};
        return U.matches(q, g.name, g.phone, b.code, b.invoiceNo, L.roomNumbers(b), b.source, g.city);
      });
      return U.sortBy(arr, tab.sort, tab.dir);
    }, [S.version, tab.id, q, period]);
    const setTab = (id) => {
      setLimit(40);
      App.navigate('#/bookings?tab=' + id);
    };
    const shown = list.slice(0, limit);

    return html`<${Page} title="Bookings" subtitle=${`${counts.inhouse} in house · ${counts.arrivals} upcoming reservations`}
      actions=${html`<${Button} icon="calendarPlus" onClick=${() => App.newBooking({ mode: 'reserve' })} class="hide-xs">Reservation<//>
        <${Button} variant="primary" icon="key" onClick=${() => App.newBooking({ mode: 'walkin' })} class="hide-xs">Walk-in check-in<//>`}>
      <div class="tabs-scroll">
        <${Segmented} value=${tab.id} onChange=${setTab} options=${TABS.map((t) => ({ value: t.id, label: t.label, count: counts[t.id] }))} class="tabs" />
      </div>
      <div class="toolbar">
        <${SearchInput} value=${q} onChange=${(v) => { setQ(v); setLimit(40); }} placeholder="Search guest, phone, room, booking no…" class="grow" />
        <${Select} value=${period} onChange=${(v) => { setPeriod(v); setLimit(40); }} options=${PERIODS} class="toolbar-select" aria-label="Period" />
      </div>
      ${!list.length ? html`<${EmptyState} icon="bookings" title=${q ? 'No matching bookings' : 'Nothing here yet'}
          text=${q ? 'Try a different name, phone number or room.' : tab.id === 'arrivals' ? 'Advance reservations will appear here.' : 'Bookings will appear here.'}
          action=${!q && html`<${Button} variant="primary" icon="plus" onClick=${() => App.newBooking({ mode: tab.id === 'arrivals' ? 'reserve' : 'walkin' })}>New booking<//>`} />`
        : wide ? html`<${BookingTable} list=${shown} />` : html`<div class="card-list">${shown.map((b) => html`<${BookingCard} key=${b.id} b=${b} />`)}</div>`}
      ${list.length > limit && html`<div class="load-more"><${Button} onClick=${() => setLimit(limit + 60)}>Show more (${list.length - limit} more)<//></div>`}
    <//>`;
  }

  function BookingTable({ list }) {
    return html`<div class="table-wrap card"><table class="table table-click">
      <thead><tr><th>Guest</th><th>Booking</th><th>Room</th><th>Check-in</th><th>Check-out</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th></tr></thead>
      <tbody>${list.map((b) => {
        const g = L.guest(b.guestId) || {};
        return html`<tr key=${b.id} onClick=${() => App.openBooking(b.id)} tabindex="0" onKeyDown=${(e) => e.key === 'Enter' && App.openBooking(b.id)}>
          <td><div class="cell-guest"><${Avatar} name=${L.guestName(b)} size=${34} /><div><div class="fw-600">${L.guestName(b)}</div><div class="muted small">${U.phoneDisplay(g.phone)}</div></div></div></td>
          <td><div class="fw-500">${b.code}</div><div class="muted small">${b.source || ''}</div></td>
          <td><span class="room-tag">${L.roomNumbers(b)}</span></td>
          <td><div>${U.relDate(b.checkIn)}</div><div class="muted small">${U.fmtTime(b.checkIn)}</div></td>
          <td><div>${U.relDate(b.checkOut)}</div><div class="muted small">${U.fmtTime(b.checkOut)}</div></td>
          <td class="num"><${Money} v=${L.totals(b).total} /></td>
          <td class="num"><${Balance} b=${b} /></td>
          <td><${StatusBadge} b=${b} /></td>
        </tr>`;
      })}</tbody>
    </table></div>`;
  }

  function BookingCard({ b }) {
    const g = L.guest(b.guestId) || {};
    const t = L.totals(b);
    return html`<button type="button" class="list-card" onClick=${() => App.openBooking(b.id)}>
      <div class="lc-top">
        <${Avatar} name=${L.guestName(b)} size=${40} />
        <div class="lc-main">
          <div class="lc-title">${L.guestName(b)}</div>
          <div class="lc-sub">${U.phoneDisplay(g.phone)} · ${b.code}</div>
        </div>
        <${StatusBadge} b=${b} />
      </div>
      <div class="lc-meta">
        <span class="room-tag"><${Icon} name="bed" size=${14} /> ${L.roomNumbers(b)}</span>
        <span><${Icon} name="calendarDays" size=${14} /> ${U.fmtDateShort(b.checkIn)} → ${U.fmtDateShort(b.checkOut)}</span>
        <span class="lc-right">${U.money(t.total)} · <${Balance} b=${b} /></span>
      </div>
    </button>`;
  }
  App.BookingCard = BookingCard;

  // ------------------------------------------------------------------ booking detail
  function BookingDetail({ close, id }) {
    App.useStore();
    App.useTick(60000);
    const b = S.get('bookings', id);
    if (!b) {
      return html`<${Modal} title="Booking" kind="drawer" onClose=${() => close()}><${EmptyState} icon="bookings" title="This booking was deleted" /><//>`;
    }
    const g = L.guest(b.guestId) || b.billTo || {};
    const bill = L.billOf(b);
    const hist = b.guestId ? L.guestHistory(b.guestId) : { stays: 0 };
    const locked = b.status === 'checked_out' || b.status === 'cancelled' || b.status === 'no_show';

    async function more() {
      const actions = [
        (b.status === 'reserved' || b.status === 'checked_in') && { value: 'edit', label: b.status === 'checked_in' ? 'Edit / extend stay' : 'Edit booking', icon: 'edit', hint: 'Dates, rooms, tariff, guests' },
        b.status === 'checked_in' && { value: 'charge', label: 'Add extra charge', icon: 'utensils', hint: 'Food, laundry, taxi…' },
        { value: 'payment', label: 'Record payment / refund', icon: 'cash' },
        g.phone && { value: 'whatsapp', label: 'Send details on WhatsApp', icon: 'whatsapp' },
        b.status === 'checked_out' && { value: 'invoice', label: 'View / print invoice', icon: 'printer' },
        b.status === 'reserved' && { value: 'noshow', label: 'Mark as no-show', icon: 'userX' },
        b.status === 'reserved' && { value: 'cancel', label: 'Cancel reservation', icon: 'calendarX', danger: true },
        S.can('delete') && { value: 'delete', label: 'Delete booking', icon: 'trash', danger: true, hint: 'Permanently removes it (admin)' },
      ];
      const a = await chooseAction(`${b.code} · ${L.guestName(b)}`, actions);
      if (a) runAction(a);
    }
    async function runAction(a) {
      if (a === 'edit') App.editBooking(b.id);
      if (a === 'charge') App.openModal(ChargeDialog, { id: b.id });
      if (a === 'payment') App.openModal(PaymentDialog, { id: b.id });
      if (a === 'invoice') App.openInvoice(b.id);
      if (a === 'checkin') App.openModal(CheckInDialog, { id: b.id });
      if (a === 'checkout') App.openModal(CheckOutDialog, { id: b.id });
      if (a === 'cancel') App.openModal(CancelDialog, { id: b.id });
      if (a === 'noshow') App.openModal(CancelDialog, { id: b.id, noShow: true });
      if (a === 'whatsapp') window.open(U.waLink(g.phone, bookingMessage(b)), '_blank', 'noopener');
      if (a === 'delete') {
        const ok = await confirm({
          title: 'Delete booking?', danger: true, confirmText: 'Delete',
          message: html`This permanently deletes <strong>${b.code}</strong> for ${L.guestName(b)}${b.invoiceNo ? html` and its invoice <strong>${b.invoiceNo}</strong>` : ''}, including all payments. This cannot be undone.`,
          requireText: b.invoiceNo ? 'DELETE' : null,
        });
        if (ok) {
          S.remove('bookings', b.id);
          toast('Booking deleted');
          close();
        }
      }
    }

    const primary = [];
    if (b.status === 'reserved') primary.push(html`<${Button} variant="primary" icon="key" onClick=${() => runAction('checkin')}>Check in<//>`);
    if (b.status === 'checked_in') primary.push(html`<${Button} variant="primary" icon="doorOpen" onClick=${() => runAction('checkout')}>Check out<//>`);
    if (b.status === 'checked_out') primary.push(html`<${Button} variant="primary" icon="printer" onClick=${() => runAction('invoice')}>Invoice<//>`);
    if (!locked || bill.balance !== 0) primary.push(html`<${Button} icon="cash" onClick=${() => runAction('payment')}>Payment<//>`);
    if (b.status === 'checked_in') primary.push(html`<${Button} icon="plus" onClick=${() => runAction('charge')} class="hide-xs">Charge<//>`);

    return html`<${Modal} kind="drawer" size="lg" onClose=${() => close()} icon="bookings"
        title=${L.guestName(b)} subtitle=${html`${b.code} · <${StatusBadge} b=${b} />`}
        footer=${html`${primary}<${Button} icon="more" onClick=${more} aria-label="More actions" class="btn-more">More<//>`}>
      ${L.isOverdue(b) && html`<div class="alert alert-danger"><${Icon} name="alert" size=${18} /> Check-out was due ${U.fmtDateTime(b.checkOut)}. Check out or extend the stay.</div>`}
      ${L.isLateArrival(b) && html`<div class="alert alert-warn"><${Icon} name="clock" size=${18} /> Guest was expected ${U.fmtDateTime(b.checkIn)}. Check in, or mark as no-show.</div>`}
      ${b.status === 'cancelled' && html`<div class="alert alert-muted"><${Icon} name="calendarX" size=${18} /> Cancelled ${U.fmtDateTime(b.cancelledAt)}${b.cancelReason ? ' · ' + b.cancelReason : ''}</div>`}
      ${b.status === 'no_show' && html`<div class="alert alert-muted"><${Icon} name="userX" size=${18} /> Marked no-show${b.cancelReason ? ' · ' + b.cancelReason : ''}</div>`}

      <div class="detail-grid">
        <section class="panel">
          <div class="panel-head"><h3>Guest</h3>${b.guestId && L.guest(b.guestId) && html`<button type="button" class="link-btn" onClick=${() => App.openGuest(b.guestId)}>Profile</button>`}</div>
          <div class="guest-row">
            <${Avatar} name=${g.name} size=${44} />
            <div class="guest-row-text"><div class="fw-600">${g.name}</div><div class="muted small">${[g.city, g.state].filter(Boolean).join(', ') || '—'}${hist.stays > 1 ? ` · ${hist.stays} stays` : ''}</div></div>
          </div>
          ${g.phone && html`<div class="contact-btns">
            <a class="btn btn-secondary btn-sm" href=${U.telLink(g.phone)}><${Icon} name="phone" size=${16} /><span>${U.phoneDisplay(g.phone)}</span></a>
            <a class="btn btn-secondary btn-sm" href=${U.waLink(g.phone)} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${16} /><span>WhatsApp</span></a>
          </div>`}
          <${KV} items=${[
            ['ID proof', g.idNumber ? `${g.idType || 'ID'} · ${U.maskId(g.idNumber)}` : html`<span class="text-warn">Not recorded</span>`],
            g.company && ['Company', g.company],
            g.gstin && ['GSTIN', g.gstin],
          ]} />
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Stay</h3></div>
          <div class="stay-dates">
            <div><span class="muted small">${b.actualCheckIn ? 'Checked in' : 'Check-in'}</span><strong>${U.fmtDayMonth(b.checkIn)}</strong><span class="small">${U.fmtTime(b.checkIn)}</span></div>
            <div class="stay-arrow"><${Icon} name="arrowRight" size=${18} /><span class="small muted">${U.plural(b.billedNights || b.nights || 1, s24(b) ? 'day' : 'night')}</span></div>
            <div><span class="muted small">${b.actualCheckOut ? 'Checked out' : 'Check-out'}</span><strong>${U.fmtDayMonth(b.checkOut)}</strong><span class="small">${U.fmtTime(b.checkOut)}</span></div>
          </div>
          <${KV} items=${[
            ['Rooms', html`<span class="room-tags">${(b.rooms || []).map((r) => html`<span class="room-tag">${(L.room(r.roomId) || {}).number || r.number} <span class="muted">${(L.roomType((L.room(r.roomId) || {}).typeId) || {}).name || r.typeName || ''}</span></span>`)}</span>`],
            ['Guests', `${U.plural(b.adults || 1, 'adult')}${b.children ? ', ' + U.plural(b.children, 'child', 'children') : ''}`],
            ['Source', b.source],
            b.purpose && ['Purpose', b.purpose],
            b.notes && ['Notes', b.notes],
          ]} />
        </section>
      </div>

      <section class="panel folio">
        <div class="panel-head"><h3>${b.status === 'checked_out' ? 'Invoice ' + (b.invoiceNo || '') : 'Folio'}</h3>
          ${b.status === 'checked_in' && html`<span class="muted small">Estimated for ${U.plural(bill.nights, s24() ? 'day' : 'night')}</span>`}</div>
        ${bill.cancelled ? html`<div class="folio-line"><span>Cancellation charge</span><span>${U.money(bill.total)}</span></div>` : html`
          ${bill.lines.map((l) => html`<div class="folio-line"><span>Room ${l.number} · ${U.money(l.rate)}${l.extraBeds ? ` + ${l.extraBeds} extra bed` : ''} × ${U.plural(l.nights, s24() ? 'day' : 'night')}</span><span>${U.money(l.gross)}</span></div>`)}
          ${bill.discount > 0 && html`<div class="folio-line text-ok"><span>Discount</span><span>− ${U.money(bill.discount)}</span></div>`}
          ${bill.charges.map((c) => html`<div class="folio-line">
            <span>${c.description}${c.qty > 1 ? ` × ${c.qty}` : ''} <span class="muted small">${U.fmtDateShort(c.at)}</span></span>
            <span class="folio-amt">${U.money(c.gross)}
              ${!locked && html`<button type="button" class="icon-btn" aria-label="Remove charge" onClick=${async () => {
                if (await confirm({ title: 'Remove charge?', message: `${c.description} · ${U.money(c.gross)}`, confirmText: 'Remove', danger: true })) L.removeCharge(S.get('bookings', b.id), c.id);
              }}><${Icon} name="x" size=${14} /></button>`}</span>
          </div>`)}
          ${bill.taxes.filter((t) => t.tax > 0).map((t) => html`<div class="folio-line muted"><span>CGST ${t.rate / 2}% + SGST ${t.rate / 2}% on ${U.money(t.taxable)}</span><span>${U.money(t.tax, 2)}</span></div>`)}
          ${bill.roundOff !== 0 && html`<div class="folio-line muted"><span>Round off</span><span>${U.money(bill.roundOff, 2)}</span></div>`}
        `}
        <div class="folio-line folio-total"><span>Total</span><span>${U.money(bill.total)}</span></div>
        ${(b.payments || []).map((p) => html`<div class=${U.cls('folio-line', 'folio-pay', p.kind === 'refund' && 'is-refund')}>
          <span><${Icon} name=${p.kind === 'refund' ? 'undo' : 'checkCircle'} size=${14} /> ${p.kind === 'refund' ? 'Refund' : 'Paid'} · ${p.mode}${p.ref ? ' · ' + p.ref : ''} <span class="muted small">${U.fmtDateTime(p.at)}</span></span>
          <span class="folio-amt">${p.kind === 'refund' ? '− ' : ''}${U.money(p.amount)}
            ${S.can('delete') && html`<button type="button" class="icon-btn" aria-label="Delete payment" onClick=${async () => {
              if (await confirm({ title: 'Delete this payment entry?', message: `${p.mode} · ${U.money(p.amount)} on ${U.fmtDateTime(p.at)}`, confirmText: 'Delete', danger: true })) L.removePayment(S.get('bookings', b.id), p.id);
            }}><${Icon} name="x" size=${14} /></button>`}</span>
        </div>`)}
        <div class=${U.cls('folio-line', 'folio-balance', bill.balance > 0 ? 'is-due' : bill.balance < 0 ? 'is-extra' : 'is-paid')}>
          <span>${bill.balance > 0 ? 'Balance due' : bill.balance < 0 ? (bill.cancelled ? 'Refund due' : 'Excess paid') : 'Fully paid'}</span>
          <span>${U.money(Math.abs(bill.balance))}</span>
        </div>
      </section>

      <div class="audit muted small">
        Created ${U.fmtDateTime(b.createdAt)}${b.createdBy ? ' by ' + b.createdBy : ''}${b.updatedAt && b.updatedAt !== b.createdAt ? ` · Updated ${U.timeAgo(b.updatedAt)}${b.updatedBy ? ' by ' + b.updatedBy : ''}` : ''}
      </div>
    <//>`;
  }

  function bookingMessage(b) {
    const s = S.settings();
    const t = L.totals(b);
    const lines = [
      `*${s.hotelName}*`,
      `Booking ${b.code} for ${L.guestName(b)}`,
      `Room: ${L.roomNumbers(b)}`,
      `Check-in: ${U.fmtDateTimeFull(b.checkIn)}`,
      `Check-out: ${U.fmtDateTimeFull(b.checkOut)}`,
      `Total: ${U.money(t.total)} · Paid: ${U.money(t.paid)}${t.balance > 0 ? ` · Balance: ${U.money(t.balance)}` : ''}`,
    ];
    if (b.invoiceNo) lines.push(`Invoice: ${b.invoiceNo}`);
    if (s.phone) lines.push(`Contact: ${s.phone}`);
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ dialogs
  function PaymentFields({ amount, setAmount, mode, setMode, reference, setReference, balance }) {
    const s = S.settings();
    return html`<div class="grid-2c">
      <${Field} label="Amount"><${MoneyInput} value=${amount} onChange=${setAmount} data-autofocus /><//>
      <${Field} label="Mode"><${Select} value=${mode} onChange=${setMode} options=${s.paymentModes} /><//>
    </div>
    ${+amount > 0 && mode !== 'Cash' && html`<${Field} label="Reference (UPI / txn id)"><${Input} value=${reference} onChange=${setReference} placeholder="Optional" /><//>`}
    ${balance > 0 && html`<div class="quick-amounts"><button type="button" class="chip" onClick=${() => setAmount(String(balance))}>Full balance · ${U.money(balance)}</button></div>`}`;
  }

  function CheckInDialog({ close, id }) {
    const b = S.get('bookings', id);
    const s = S.settings();
    const g = L.guest(b.guestId) || {};
    const defNights = s.checkoutMode === '24h' ? b.nights : Math.max(1, U.diffDays(U.today(), U.datePart(b.plannedCheckOut || b.checkOut)));
    const [nights, setNights] = useState(defNights || 1);
    const [idType, setIdType] = useState(g.idType || 'Aadhaar');
    const [idNumber, setIdNumber] = useState(g.idNumber || '');
    const [amount, setAmount] = useState('');
    const [mode, setMode] = useState((s.paymentModes || ['Cash'])[0]);
    const [reference, setReference] = useState('');
    const [err, setErr] = useState('');
    const nowS = U.now();
    const out = L.plannedCheckOut(nowS, nights, s);
    const [st, en] = [U.today(), U.datePart(out) > U.today() ? U.datePart(out) : U.addDays(U.today(), 1)];
    const avail = L.availability(st, en, b.id);
    const busy = (b.rooms || []).filter((r) => avail.get(r.roomId) && !avail.get(r.roomId).free);
    const est = L.computeBill(Object.assign({}, b, { checkIn: nowS, checkOut: out }), { nights });

    function go() {
      if (s.requireIdAtCheckIn && !idNumber.trim()) return setErr('ID proof is required at check-in');
      if (busy.length) return setErr(`Room ${busy.map((r) => r.number).join(', ')} is occupied or out of order. Edit the booking to change room.`);
      if (b.guestId && L.guest(b.guestId)) L.upsertGuest(Object.assign({}, L.guest(b.guestId), { idType, idNumber }));
      L.checkIn(S.get('bookings', id), { nights, payment: +amount || 0, paymentMode: mode, paymentRef: reference });
      toast(`${L.guestName(b)} checked in · Room ${L.roomNumbers(b)}`);
      close(true);
    }
    return html`<${Modal} title="Check in" subtitle=${`${L.guestName(b)} · Room ${L.roomNumbers(b)}`} icon="key" size="md" onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="key" onClick=${go}>Check in now<//>`}>
      ${err && html`<div class="alert alert-danger"><${Icon} name="alert" size=${18} /> ${err}</div>`}
      <div class="grid-2c">
        <${Field} label="ID proof"><${Select} value=${idType} onChange=${setIdType} options=${s.idTypes} /><//>
        <${Field} label="ID number" required=${s.requireIdAtCheckIn}><${Input} value=${idNumber} onChange=${setIdNumber} /><//>
      </div>
      <${Field} as="div" label=${s.checkoutMode === '24h' ? 'Days (24 h)' : 'Nights'} hint=${`Check-out ${U.fmtDayMonth(out)}, ${U.fmtTime(out)}`}>
        <${Stepper} value=${nights} min=${1} max=${60} onChange=${setNights} />
      <//>
      <div class="sum-line sum-total"><span>Estimated bill</span><span>${U.money(est.total)}</span></div>
      <div class="sum-line"><span>Already paid</span><span>${U.money(est.paid)}</span></div>
      <h4 class="sub-title">Payment received now (optional)</h4>
      <${PaymentFields} amount=${amount} setAmount=${setAmount} mode=${mode} setMode=${setMode} reference=${reference} setReference=${setReference} balance=${Math.max(0, est.balance)} />
    <//>`;
  }

  function CheckOutDialog({ close, id }) {
    const b = S.get('bookings', id);
    const s = S.settings();
    const nowS = U.now();
    const suggested = L.nightsFor(b.checkIn, nowS, s);
    const [nights, setNights] = useState(suggested);
    const [discountType, setDiscountType] = useState(b.discountType || 'amount');
    const [discountValue, setDiscountValue] = useState(b.discountValue ? String(b.discountValue) : '');
    const draft = Object.assign({}, b, { discountType, discountValue: +discountValue || 0 });
    const bill = L.computeBill(draft, { nights });
    const [amount, setAmount] = useState(String(Math.max(0, bill.balance)));
    const [mode, setMode] = useState((s.paymentModes || ['Cash'])[0]);
    const [reference, setReference] = useState('');
    const [busy, setBusy] = useState(false);
    const remaining = U.round2(bill.balance - (+amount || 0));

    async function go() {
      if (remaining > 0) {
        const ok = await confirm({ title: 'Balance pending', message: `${U.money(remaining)} will remain unpaid after check-out. Continue?`, confirmText: 'Check out anyway' });
        if (!ok) return;
      }
      setBusy(true);
      const res = await attempt(() => L.checkOut(S.get('bookings', id), { nights, discountType, discountValue: +discountValue || 0, payment: +amount || 0, paymentMode: mode, paymentRef: reference }));
      setBusy(false);
      if (!res) return;
      toast(`Checked out · Invoice ${res.invoiceNo}`);
      close(true);
      App.openInvoice(res.id);
    }
    return html`<${Modal} title="Check out" subtitle=${`${L.guestName(b)} · Room ${L.roomNumbers(b)}`} icon="doorOpen" size="md" locked onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="checkCircle" loading=${busy} onClick=${go}>Complete check-out<//>`}>
      <div class="stay-dates compact">
        <div><span class="muted small">Checked in</span><strong>${U.fmtDateTime(b.checkIn)}</strong></div>
        <div class="stay-arrow"><${Icon} name="arrowRight" size=${18} /></div>
        <div><span class="muted small">Now</span><strong>${U.fmtDateTime(nowS)}</strong></div>
      </div>
      <${Field} as="div" label=${s.checkoutMode === '24h' ? 'Days to charge (24 h)' : 'Nights to charge'}
          hint=${nights !== suggested ? `Suggested: ${suggested} as per ${s.checkoutMode === '24h' ? '24-hour' : 'check-out time'} policy` : `As per ${s.checkoutMode === '24h' ? '24-hour' : s.checkOutTime + ' check-out'} policy`}>
        <${Stepper} value=${nights} min=${1} max=${90} onChange=${setNights} />
      <//>
      <div class="sum-lines">
        ${bill.lines.map((l) => html`<div class="sum-line"><span>Room ${l.number} · ${U.money(l.perNight)} × ${l.nights}</span><span>${U.money(l.gross)}</span></div>`)}
        ${bill.charges.length > 0 && html`<div class="sum-line"><span>Extra charges (${bill.charges.length})</span><span>${U.money(bill.chargesGross)}</span></div>`}
        <div class="discount-row">
          <span>Discount</span>
          <${Segmented} size="sm" value=${discountType} onChange=${setDiscountType} options=${[{ value: 'amount', label: '₹' }, { value: 'percent', label: '%' }]} />
          <input class="input input-sm" type="number" inputmode="decimal" min="0" placeholder="0" value=${discountValue} onInput=${(e) => setDiscountValue(e.currentTarget.value)} aria-label="Discount" />
        </div>
        ${bill.taxes.filter((t) => t.tax > 0).map((t) => html`<div class="sum-line muted"><span>GST ${t.rate}%</span><span>${U.money(t.tax, 2)}</span></div>`)}
        ${bill.roundOff !== 0 && html`<div class="sum-line muted"><span>Round off</span><span>${U.money(bill.roundOff, 2)}</span></div>`}
        <div class="sum-line sum-total"><span>Total bill</span><span>${U.money(bill.total)}</span></div>
        <div class="sum-line"><span>Paid so far</span><span>${U.money(bill.paid)}</span></div>
        <div class=${U.cls('sum-line', 'sum-balance', bill.balance > 0 && 'is-due')}><span>${bill.balance >= 0 ? 'Balance to collect' : 'Refund to guest'}</span><span>${U.money(Math.abs(bill.balance))}</span></div>
      </div>
      ${bill.balance > 0 && html`<h4 class="sub-title">Collect payment</h4>
        <${PaymentFields} amount=${amount} setAmount=${setAmount} mode=${mode} setMode=${setMode} reference=${reference} setReference=${setReference} balance=${bill.balance} />`}
      ${bill.balance < 0 && html`<div class="alert alert-warn"><${Icon} name="info" size=${18} /> Guest has paid ${U.money(-bill.balance)} more than the bill. Record a refund from the booking after check-out.</div>`}
    <//>`;
  }

  function PaymentDialog({ close, id }) {
    const b = S.get('bookings', id);
    const s = S.settings();
    const bal = L.totals(b).balance;
    const [kind, setKind] = useState(bal < 0 ? 'refund' : 'payment');
    const [amount, setAmount] = useState(bal > 0 ? String(bal) : bal < 0 ? String(-bal) : '');
    const [mode, setMode] = useState((s.paymentModes || ['Cash'])[0]);
    const [reference, setReference] = useState('');
    const [note, setNote] = useState('');
    function go() {
      if (!(+amount > 0)) return toast('Enter an amount', 'error');
      L.addPayment(S.get('bookings', id), { amount: +amount, mode, ref: reference, note, kind });
      toast(kind === 'refund' ? 'Refund recorded' : 'Payment recorded');
      close(true);
    }
    return html`<${Modal} title=${kind === 'refund' ? 'Record refund' : 'Record payment'} subtitle=${`${b.code} · ${L.guestName(b)} · ${bal > 0 ? U.money(bal) + ' due' : bal < 0 ? U.money(-bal) + ' excess' : 'fully paid'}`}
        icon="cash" size="sm" onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="check" onClick=${go}>Save<//>`}>
      <${Segmented} full value=${kind} onChange=${setKind} options=${[{ value: 'payment', label: 'Payment received' }, { value: 'refund', label: 'Refund given' }]} />
      <${PaymentFields} amount=${amount} setAmount=${setAmount} mode=${mode} setMode=${setMode} reference=${reference} setReference=${setReference} balance=${kind === 'payment' ? Math.max(0, bal) : 0} />
      <${Field} label="Note"><${Input} value=${note} onChange=${setNote} placeholder="Optional" /><//>
    <//>`;
  }

  function ChargeDialog({ close, id }) {
    const b = S.get('bookings', id);
    const s = S.settings();
    const cats = s.chargeCategories || [];
    const [category, setCategory] = useState((cats[0] || {}).name || 'Other');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [qty, setQty] = useState(1);
    const catGst = (name) => {
      const c = cats.find((x) => x.name === name);
      return c && c.gst != null ? String(c.gst) : '';
    };
    const [gst, setGst] = useState(catGst(category));
    function go() {
      if (!(+amount > 0)) return toast('Enter an amount', 'error');
      L.addCharge(S.get('bookings', id), { category, description: description || category, amount: +amount, qty, gstRate: gst === '' ? null : +gst });
      toast('Charge added');
      close(true);
    }
    return html`<${Modal} title="Add extra charge" subtitle=${`${b.code} · ${L.guestName(b)}`} icon="utensils" size="sm" onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="plus" onClick=${go}>Add charge<//>`}>
      <${Field} label="Category"><${Select} value=${category} onChange=${(v) => { setCategory(v); setGst(catGst(v)); }} options=${cats.map((c) => c.name)} /><//>
      <${Field} label="Description"><${Input} value=${description} onChange=${setDescription} placeholder=${category} /><//>
      <div class="grid-2c">
        <${Field} label="Amount (each)"><${MoneyInput} value=${amount} onChange=${setAmount} data-autofocus /><//>
        <${Field} as="div" label="Quantity"><${Stepper} value=${qty} min=${1} max=${99} onChange=${setQty} /><//>
      </div>
      ${s.gstEnabled && html`<${Field} label="GST rate" hint="“Same as room” follows the room tariff slab (5% up to ₹7,500/night)">
        <${Select} value=${gst} onChange=${setGst} options=${[{ value: '', label: 'Same as room' }, { value: '0', label: '0% (exempt)' }, { value: '5', label: '5%' }, { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' }]} />
      <//>`}
      ${+amount > 0 && html`<div class="sum-line sum-total"><span>Charge total</span><span>${U.money(+amount * qty)}</span></div>`}
    <//>`;
  }

  function CancelDialog({ close, id, noShow }) {
    const b = S.get('bookings', id);
    const s = S.settings();
    const paid = L.totals(b).paid;
    const [reason, setReason] = useState(noShow ? 'Guest did not arrive' : '');
    const [fee, setFee] = useState(noShow ? String(Math.min(paid, (b.rooms || []).reduce((t, r) => t + (+r.rate || 0), 0))) : '0');
    const refundDefault = Math.max(0, paid - (+fee || 0));
    const [refund, setRefund] = useState(null);
    const refundVal = refund == null ? String(refundDefault) : refund;
    const [mode, setMode] = useState((s.paymentModes || ['Cash'])[0]);
    function go() {
      L.cancelBooking(S.get('bookings', id), { reason, fee: +fee || 0, refund: +refundVal || 0, refundMode: mode, noShow });
      toast(noShow ? 'Marked as no-show' : 'Reservation cancelled');
      close(true);
    }
    return html`<${Modal} title=${noShow ? 'Mark as no-show' : 'Cancel reservation'} subtitle=${`${b.code} · ${L.guestName(b)} · Room ${L.roomNumbers(b)}`}
        icon=${noShow ? 'userX' : 'calendarX'} size="sm" class="is-danger" onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Keep booking<//><${Button} variant="danger" onClick=${go}>${noShow ? 'Mark no-show' : 'Cancel booking'}<//>`}>
      <${Field} label="Reason"><${Input} value=${reason} onChange=${setReason} placeholder="e.g. Plans changed" list="tbd-cancel-reasons" /><//>
      <datalist id="tbd-cancel-reasons">${['Plans changed', 'Darshan tickets not available', 'Booked elsewhere', 'Train/bus cancelled', 'Health reasons', 'Guest did not arrive'].map((r) => html`<option value=${r} />`)}</datalist>
      <div class="grid-2c">
        <${Field} label="Cancellation charge" hint=${`Advance paid: ${U.money(paid)}`}><${MoneyInput} value=${fee} onChange=${(v) => { setFee(v); setRefund(null); }} /><//>
        <${Field} label="Refund now"><${MoneyInput} value=${refundVal} onChange=${setRefund} /><//>
      </div>
      ${+refundVal > 0 && html`<${Field} label="Refund mode"><${Select} value=${mode} onChange=${setMode} options=${s.paymentModes} /><//>`}
    <//>`;
  }

  App.openBooking = (id) => App.openModal(BookingDetail, { id });
  App.checkInBooking = (id) => App.openModal(CheckInDialog, { id });
  App.checkOutBooking = (id) => App.openModal(CheckOutDialog, { id });
  App.addPaymentTo = (id) => App.openModal(PaymentDialog, { id });
  App.views = App.views || {};
  App.views.bookings = BookingsPage;
})(window.App = window.App || {});
