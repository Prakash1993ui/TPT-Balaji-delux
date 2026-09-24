/*
 * Reports: occupancy, ADR, RevPAR, collections, GST summary, expenses, sources.
 */
(function (App) {
  'use strict';
  const { html, useState, U, L, Icon, Button, Select, Segmented, Card, Stat, Page, EmptyState, BarChart, Input } = App;
  const S = App.Store;

  function presetRange(p) {
    const t = U.today();
    switch (p) {
      case 'today': return [t, t];
      case 'yesterday': return [U.addDays(t, -1), U.addDays(t, -1)];
      case '7': return [U.addDays(t, -6), t];
      case '30': return [U.addDays(t, -29), t];
      case 'month': return [U.startOfMonth(t), t];
      case 'lastmonth': { const s = U.startOfMonth(U.addDays(U.startOfMonth(t), -1)); return [s, U.endOfMonth(s)]; }
      case 'fy': return [U.fyStart(t), t];
      default: return null;
    }
  }

  function Table({ head, rows, foot }) {
    return html`<div class="table-wrap"><table class="table table-compact">
      <thead><tr>${head.map((h, i) => html`<th class=${i ? 'num' : ''}>${h}</th>`)}</tr></thead>
      <tbody>${rows.map((r) => html`<tr>${r.map((c, i) => html`<td class=${i ? 'num' : ''}>${c}</td>`)}</tr>`)}</tbody>
      ${foot && html`<tfoot><tr>${foot.map((c, i) => html`<td class=${i ? 'num' : ''}>${c}</td>`)}</tr></tfoot>`}
    </table></div>`;
  }

  function ReportsPage() {
    App.useStore();
    const [preset, setPreset] = useState('month');
    const [custom, setCustom] = useState(() => [U.addDays(U.today(), -6), U.today()]);
    const [metric, setMetric] = useState('occupancy');
    if (!S.can('reports')) return html`<${Page} title="Reports"><${EmptyState} icon="lock" title="Reports are for managers" text="Ask the admin for access." /><//>`;
    const [from, to] = presetRange(preset) || custom;
    const r = L.report(from, to);
    const long = r.days.length > 45;
    const chart = r.days.map((d) => ({
      label: long ? '' : String(U.parse(d.date).getDate()),
      title: U.fmtDayMonth(d.date),
      value: metric === 'occupancy' ? Math.round(d.occupancy) : metric === 'revenue' ? d.roomRevenue : d.collected,
    }));
    const fmt = metric === 'occupancy' ? (v) => v + '%' : U.moneyShort;
    const modes = Object.entries(r.collections.byMode).sort((a, b) => b[1] - a[1]);
    const cats = Object.entries(r.expenses.byCategory).sort((a, b) => b[1] - a[1]);
    const file = (name) => `${name}-${from}-to-${to}.csv`;

    const exportDaily = () => U.download(file('daily-report'), U.toCSV(r.days, [
      { label: 'Date', value: (d) => d.date }, { label: 'Rooms Occupied', value: (d) => d.occupied }, { label: 'Occupancy %', value: (d) => U.round2(d.occupancy) },
      { label: 'Room Revenue (excl. GST)', value: (d) => d.roomRevenue }, { label: 'Collected', value: (d) => d.collected }, { label: 'Expenses', value: (d) => d.expenses },
      { label: 'Net Cash', value: (d) => U.round2(d.collected - d.expenses) },
    ]), 'text/csv;charset=utf-8');
    const exportGst = () => U.download(file('gst-summary'), U.toCSV(r.invoices.bySlab, [
      { label: 'GST Rate %', value: (x) => x.rate }, { label: 'Taxable Value', value: (x) => U.round2(x.taxable) },
      { label: 'CGST', value: (x) => U.round2(x.cgst) }, { label: 'SGST', value: (x) => U.round2(x.sgst) }, { label: 'Total Tax', value: (x) => U.round2(x.tax) },
    ]), 'text/csv;charset=utf-8');
    const exportPayments = () => U.download(file('collections'), U.toCSV(r.collections.list, [
      { label: 'Date', value: (p) => p.at.replace('T', ' ') }, { label: 'Booking', value: (p) => p.booking.code }, { label: 'Guest', value: (p) => L.guestName(p.booking) },
      { label: 'Type', value: (p) => (p.kind === 'refund' ? 'Refund' : 'Payment') }, { label: 'Mode', value: (p) => p.mode }, { label: 'Reference', value: (p) => p.ref },
      { label: 'Amount', value: (p) => (p.kind === 'refund' ? -p.amount : p.amount) }, { label: 'Received By', value: (p) => p.by },
    ]), 'text/csv;charset=utf-8');

    return html`<${Page} title="Reports" subtitle=${`${U.fmtDate(from)} – ${U.fmtDate(to)} · ${U.plural(r.days.length, 'day')}`} class="page-reports"
        actions=${html`<${Button} icon="printer" onClick=${() => window.print()} class="hide-xs">Print<//><${Button} icon="download" onClick=${exportDaily}>Daily CSV<//>`}>
      <div class="toolbar">
        <${Select} value=${preset} onChange=${setPreset} class="toolbar-select" aria-label="Period"
          options=${[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' },
            { value: 'month', label: 'This month' }, { value: 'lastmonth', label: 'Last month' }, { value: 'fy', label: 'This financial year' }, { value: 'custom', label: 'Custom range…' }]} />
        ${preset === 'custom' && html`<div class="range-inputs">
          <${Input} type="date" value=${custom[0]} max=${custom[1]} onChange=${(v) => v && setCustom([v, custom[1]])} aria-label="From" />
          <span class="muted">to</span>
          <${Input} type="date" value=${custom[1]} min=${custom[0]} onChange=${(v) => v && setCustom([custom[0], v])} aria-label="To" />
        </div>`}
      </div>

      <div class="stats stats-4">
        <${Stat} label="Occupancy" value=${U.pct(r.occupancy)} sub=${`${U.num(r.roomNights)} of ${U.num(r.available)} room-nights`} icon="percent" />
        <${Stat} label="Avg. daily rate (ADR)" value=${U.money(Math.round(r.adr))} sub="Room revenue ÷ nights sold" icon="bed" tone="indigo" />
        <${Stat} label="RevPAR" value=${U.money(Math.round(r.revpar))} sub="Revenue per available room" icon="trendingUp" tone="violet" />
        <${Stat} label="Room revenue" value=${U.money(r.roomRevenue)} sub="Excluding GST" icon="rupee" tone="info" />
        <${Stat} label="Collected" value=${U.money(r.collections.net)} sub=${r.collections.refunds ? `after ${U.money(r.collections.refunds)} refunds` : 'All payment modes'} icon="coins" tone="ok" />
        <${Stat} label="Expenses" value=${U.money(r.expenses.total)} sub=${`${U.plural(r.expenses.list.length, 'entry', 'entries')}`} icon="expenses" tone="danger" />
        <${Stat} label="Net cash" value=${U.money(r.net)} sub="Collected − expenses" icon="cash" tone=${r.net >= 0 ? 'ok' : 'danger'} />
        <${Stat} label="GST collected" value=${U.money(r.invoices.tax)} sub=${`${U.plural(r.invoices.count, 'invoice')}`} icon="invoice" tone="warn" />
      </div>

      <${Card} title="Daily trend" icon="reports" actions=${html`<${Segmented} size="sm" value=${metric} onChange=${setMetric}
          options=${[{ value: 'occupancy', label: 'Occupancy' }, { value: 'revenue', label: 'Revenue' }, { value: 'collected', label: 'Collected' }]} />`}>
        <${BarChart} data=${chart} format=${fmt} tone=${metric === 'occupancy' ? 'brand' : metric === 'revenue' ? 'indigo' : 'ok'} height=${190} />
      <//>

      <div class="report-grid">
        <${Card} title="Collections by mode" icon="card" actions=${html`<${Button} size="sm" variant="ghost" icon="download" onClick=${exportPayments}>CSV<//>`}>
          ${modes.length ? html`<${Table} head=${['Mode', 'Amount', 'Share']} rows=${modes.map(([m, v]) => [m, U.money(v), U.pct((v / (r.collections.total || 1)) * 100)])}
              foot=${['Total received', U.money(r.collections.total), '']} />
            ${r.collections.refunds > 0 && html`<div class="muted small pad-t">Refunds: ${U.money(r.collections.refunds)} · Net ${U.money(r.collections.net)}</div>`}`
          : html`<div class="card-empty">No payments in this period.</div>`}
        <//>
        <${Card} title="GST summary" subtitle="Invoices dated in this period" icon="percent" actions=${html`<${Button} size="sm" variant="ghost" icon="download" onClick=${exportGst}>CSV<//>`}>
          ${r.invoices.count ? html`<${Table} head=${['Rate', 'Taxable', 'CGST', 'SGST']}
              rows=${r.invoices.bySlab.map((x) => [x.rate + '%', U.money(x.taxable, 2), U.money(x.cgst, 2), U.money(x.sgst, 2)])}
              foot=${['Total', U.money(r.invoices.taxable, 2), U.money(r.invoices.cgst, 2), U.money(r.invoices.sgst, 2)]} />
            <div class="muted small pad-t">${U.plural(r.invoices.count, 'invoice')} · Invoice value ${U.money(r.invoices.total)}</div>`
          : html`<div class="card-empty">No invoices in this period.</div>`}
        <//>
        <${Card} title="Bookings by source" icon="bookings">
          ${r.sources.length ? html`<${Table} head=${['Source', 'Bookings', 'Value']} rows=${r.sources.map((x) => [x.source, x.bookings, U.money(x.revenue)])} />`
            : html`<div class="card-empty">No bookings in this period.</div>`}
          ${r.cancellations.length > 0 && html`<div class="muted small pad-t">${U.plural(r.cancellations.length, 'cancellation')} / no-shows in this period</div>`}
        <//>
        <${Card} title="Expenses by category" icon="expenses">
          ${cats.length ? html`<${Table} head=${['Category', 'Amount', 'Share']} rows=${cats.map(([c, v]) => [c, U.money(v), U.pct((v / (r.expenses.total || 1)) * 100)])}
              foot=${['Total', U.money(r.expenses.total), '']} />` : html`<div class="card-empty">No expenses in this period.</div>`}
        <//>
      </div>

      <${Card} title="Day by day" icon="calendarDays" pad=${false} actions=${html`<${Button} size="sm" variant="ghost" icon="download" onClick=${exportDaily}>CSV<//>`}>
        <div class="table-wrap"><table class="table table-compact">
          <thead><tr><th>Date</th><th class="num">Occupied</th><th class="num">Occ. %</th><th class="num">Room revenue</th><th class="num">Collected</th><th class="num">Expenses</th></tr></thead>
          <tbody>${[...r.days].reverse().map((d) => html`<tr>
            <td>${U.fmtDayMonth(d.date)}</td><td class="num">${d.occupied}/${r.roomCount}</td><td class="num">${U.pct(d.occupancy)}</td>
            <td class="num">${U.money(Math.round(d.roomRevenue))}</td><td class="num">${U.money(d.collected)}</td><td class="num">${U.money(d.expenses)}</td>
          </tr>`)}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${U.num(r.roomNights)}</td><td class="num">${U.pct(r.occupancy)}</td><td class="num">${U.money(Math.round(r.roomRevenue))}</td>
            <td class="num">${U.money(r.collections.net)}</td><td class="num">${U.money(r.expenses.total)}</td></tr></tfoot>
        </table></div>
      <//>
      <p class="muted small">Room revenue is spread across the nights of each stay and excludes GST. In-house stays are counted up to their planned check-out. Collections are counted on the payment date.</p>
    <//>`;
  }

  App.views = App.views || {};
  App.views.reports = ReportsPage;
})(window.App = window.App || {});
