/*
 * Expenses: record and review hotel running costs.
 */
(function (App) {
  'use strict';
  const { html, useState, useMemo, U, L, Icon, Button, Field, Input, MoneyInput, Select, Textarea, Modal, Page, EmptyState, SearchInput, Stat, toast, confirm } = App;
  const S = App.Store;

  const CAT_ICONS = {
    Electricity: 'zap', Water: 'droplet', Salaries: 'guests', Laundry: 'shirt', 'Housekeeping supplies': 'spray', 'Maintenance & repairs': 'wrench',
    'Food & kitchen': 'utensils', Commission: 'percent', Rent: 'building', 'Taxes & fees': 'landmark', 'Internet & phone': 'wifi', Marketing: 'bell',
  };
  const catIcon = (c) => CAT_ICONS[c] || 'expenses';

  function ExpensesPage() {
    App.useStore();
    const wide = App.useMedia(App.BP.wide);
    const s = S.settings();
    const t = U.today();
    const [period, setPeriod] = useState('month');
    const [cat, setCat] = useState('');
    const [q, setQ] = useState('');
    const ranges = {
      today: [t, t],
      week: [U.addDays(t, -6), t],
      month: [U.startOfMonth(t), U.endOfMonth(t)],
      lastmonth: (() => { const st = U.startOfMonth(U.addDays(U.startOfMonth(t), -1)); return [st, U.endOfMonth(st)]; })(),
      fy: [U.fyStart(t), U.addDays(U.fyStart(t), 364)],
      all: ['0000-01-01', '9999-12-31'],
    };
    const [from, to] = ranges[period];
    const list = useMemo(() => U.sortBy(S.all('expenses').filter((e) => e.date >= from && e.date <= to && (!cat || e.category === cat)
      && (!q.trim() || U.matches(q, e.category, e.paidTo, e.note, e.mode))), (e) => e.date + (e.createdAt || ''), -1), [S.version, period, cat, q]);
    const total = U.sum(list, (e) => e.amount);
    const byCat = U.sortBy([...U.groupBy(list, (e) => e.category || 'Other').entries()].map(([k, v]) => ({ k, v: U.sum(v, (e) => e.amount) })), (x) => x.v, -1);
    const days = Math.max(1, U.diffDays(from === '0000-01-01' ? (list[list.length - 1] || {}).date || t : from, (to > t ? t : to)) + 1);

    function exportCsv() {
      U.download(`expenses-${from}-to-${to}.csv`, U.toCSV(list, [
        { label: 'Date', value: (e) => e.date }, { label: 'Category', value: (e) => e.category }, { label: 'Amount', value: (e) => e.amount },
        { label: 'Mode', value: (e) => e.mode }, { label: 'Paid To', value: (e) => e.paidTo }, { label: 'Note', value: (e) => e.note }, { label: 'Added By', value: (e) => e.createdBy },
      ]), 'text/csv;charset=utf-8');
    }

    return html`<${Page} title="Expenses" subtitle="Electricity, salaries, laundry, repairs and other running costs"
        actions=${html`${S.can('reports') && html`<${Button} icon="download" onClick=${exportCsv} disabled=${!list.length} class="hide-xs">Export<//>`}
          <${Button} variant="primary" icon="plus" onClick=${() => App.openModal(ExpenseForm, {})}>Add expense<//>`}>
      <div class="stats stats-3">
        <${Stat} label="Total spent" value=${U.money(total)} sub=${`${U.plural(list.length, 'entry', 'entries')}`} icon="expenses" tone="danger" />
        <${Stat} label="Biggest category" value=${byCat[0] ? byCat[0].k : '—'} sub=${byCat[0] ? U.money(byCat[0].v) : ''} icon=${byCat[0] ? catIcon(byCat[0].k) : 'expenses'} tone="warn" />
        <${Stat} label="Average per day" value=${U.money(Math.round(total / days))} sub=${`over ${U.plural(days, 'day')}`} icon="calendarDays" tone="indigo" />
      </div>
      <div class="toolbar">
        <${SearchInput} value=${q} onChange=${setQ} placeholder="Search paid to, note…" class="grow" />
        <${Select} value=${cat} onChange=${setCat} class="toolbar-select" aria-label="Category" options=${[{ value: '', label: 'All categories' }, ...s.expenseCategories.map((c) => ({ value: c, label: c }))]} />
        <${Select} value=${period} onChange=${setPeriod} class="toolbar-select" aria-label="Period"
          options=${[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'This month' }, { value: 'lastmonth', label: 'Last month' }, { value: 'fy', label: 'This financial year' }, { value: 'all', label: 'All time' }]} />
      </div>
      ${byCat.length > 1 && html`<div class="card cat-bars">${byCat.slice(0, 6).map((x) => html`<button type="button" class="cat-bar" onClick=${() => setCat(cat === x.k ? '' : x.k)}>
          <span class="cat-name"><${Icon} name=${catIcon(x.k)} size=${16} />${x.k}</span>
          <span class="cat-track"><span style=${`width:${(x.v / byCat[0].v) * 100}%`}></span></span>
          <span class="cat-val">${U.money(x.v)}</span></button>`)}</div>`}
      ${!list.length ? html`<${EmptyState} icon="expenses" title="No expenses in this period" action=${html`<${Button} variant="primary" icon="plus" onClick=${() => App.openModal(ExpenseForm, {})}>Add expense<//>`} />`
        : wide ? html`<div class="table-wrap card"><table class="table table-click">
            <thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Note</th><th>Mode</th><th class="num">Amount</th></tr></thead>
            <tbody>${list.map((e) => html`<tr key=${e.id} onClick=${() => App.openModal(ExpenseForm, { id: e.id })} tabindex="0">
              <td>${U.fmtDate(e.date)}</td><td><span class="cat-cell"><${Icon} name=${catIcon(e.category)} size=${16} />${e.category}</span></td>
              <td>${e.paidTo || '—'}</td><td class="muted">${e.note || ''}</td><td>${e.mode || ''}</td><td class="num fw-600">${U.money(e.amount)}</td>
            </tr>`)}</tbody>
            <tfoot><tr><td colspan="5">Total</td><td class="num">${U.money(total)}</td></tr></tfoot></table></div>`
        : html`<div class="card-list">${list.map((e) => html`<button type="button" class="list-card" key=${e.id} onClick=${() => App.openModal(ExpenseForm, { id: e.id })}>
            <div class="lc-top"><div class="lc-icon"><${Icon} name=${catIcon(e.category)} size=${20} /></div>
              <div class="lc-main"><div class="lc-title">${e.category}</div><div class="lc-sub">${[e.paidTo, e.note].filter(Boolean).join(' · ') || e.mode}</div></div>
              <div class="lc-amount"><strong>${U.money(e.amount)}</strong><span class="muted small">${U.relDate(e.date)}</span></div></div>
          </button>`)}</div>`}
    <//>`;
  }

  function ExpenseForm({ close, id }) {
    const s = S.settings();
    const cur = id ? S.get('expenses', id) : null;
    const [e, setE] = useState(() => Object.assign({ date: U.today(), category: s.expenseCategories[0] || 'Other', amount: '', mode: 'Cash', paidTo: '', note: '' }, cur || {}, cur ? { amount: String(cur.amount) } : {}));
    const set = (k) => (v) => setE(Object.assign({}, e, { [k]: v }));
    const [err, setErr] = useState('');
    const payees = useMemo(() => U.uniq(S.all('expenses').map((x) => x.paidTo).filter(Boolean)).slice(0, 50), []);
    function save() {
      if (!(+e.amount > 0)) return setErr('Enter an amount');
      if (!e.date) return setErr('Choose a date');
      S.put('expenses', Object.assign({}, e, { amount: U.round2(+e.amount), paidTo: (e.paidTo || '').trim(), note: (e.note || '').trim() }));
      toast(cur ? 'Expense updated' : 'Expense added');
      close(true);
    }
    async function remove() {
      if (await confirm({ title: 'Delete expense?', message: `${e.category} · ${U.money(e.amount)} on ${U.fmtDate(e.date)}`, confirmText: 'Delete', danger: true })) {
        S.remove('expenses', id);
        toast('Expense deleted');
        close(true);
      }
    }
    return html`<${Modal} title=${cur ? 'Edit expense' : 'Add expense'} icon="expenses" size="sm" onClose=${() => close()}
        footer=${html`${cur && S.can('delete') && html`<${Button} variant="ghost" icon="trash" onClick=${remove} aria-label="Delete" />`}
          <${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="check" onClick=${save}>Save<//>`}>
      ${err && html`<div class="alert alert-danger"><${Icon} name="alert" size=${18} /> ${err}</div>`}
      <div class="grid-2c">
        <${Field} label="Amount" required><${MoneyInput} value=${e.amount} onChange=${set('amount')} data-autofocus /><//>
        <${Field} label="Date" required><${Input} type="date" value=${e.date} max=${U.today()} onChange=${set('date')} /><//>
        <${Field} label="Category"><${Select} value=${e.category} onChange=${set('category')} options=${U.uniq([...s.expenseCategories, e.category])} /><//>
        <${Field} label="Paid by"><${Select} value=${e.mode} onChange=${set('mode')} options=${U.uniq(['Cash', 'UPI', 'Card', 'Bank transfer', ...(s.paymentModes || [])].filter((m) => m !== 'Online (OTA)'))} /><//>
      </div>
      <${Field} label="Paid to"><${Input} value=${e.paidTo} onChange=${set('paidTo')} list="tbd-payees" placeholder="e.g. APSPDCL, plumber" /><//>
      <datalist id="tbd-payees">${payees.map((p) => html`<option value=${p} />`)}</datalist>
      <${Field} label="Note"><${Textarea} rows=${2} value=${e.note} onChange=${set('note')} /><//>
    <//>`;
  }

  App.addExpense = () => App.openModal(ExpenseForm, {});
  App.views = App.views || {};
  App.views.expenses = ExpensesPage;
})(window.App = window.App || {});
