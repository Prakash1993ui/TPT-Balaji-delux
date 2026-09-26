/*
 * GST tax invoice (printable on A4, readable on phones) and the Invoices page.
 */
(function (App) {
  'use strict';
  const { html, h, render, useState, useMemo, U, L, Icon, Button, Badge, Modal, Page, EmptyState, SearchInput, Select, Stat, Avatar, toast } = App;
  const S = App.Store;

  function sacFor(charge, s) {
    const c = (s.chargeCategories || []).find((x) => x.name === charge.category);
    return (c && c.sac) || '';
  }

  /** The invoice document itself (used on screen and for printing). */
  function InvoiceDoc({ b }) {
    const s = S.settings();
    const iss = Object.assign({}, s, b.issuer || {});
    const bill = L.billOf(b);
    const to = b.billTo || L.guestOf(b);
    const gst = bill.gstEnabled !== false && bill.taxes && bill.tax > 0;
    const title = gst || (bill.gstEnabled && iss.gstin) ? 'Tax Invoice' : 'Bill / Receipt';
    const gross = U.round2((bill.roomGross || 0) + (bill.chargesGross || 0));
    const included = bill.inclusive ? U.round2(gross - bill.discount - bill.taxable) : 0;
    let n = 0;
    return html`<article class="invoice">
      <header class="inv-head">
        <div class="inv-hotel">
          ${s.logo ? html`<img class="inv-logo" src=${s.logo} alt="" />` : html`<div class="inv-logo inv-logo-mark">${App.LogoMark ? h(App.LogoMark, { size: 52 }) : ''}</div>`}
          <div>
            <div class="inv-name">${iss.hotelName}</div>
            ${iss.legalName && iss.legalName !== iss.hotelName && html`<div class="inv-legal">${iss.legalName}</div>`}
            <div class="inv-addr">${[iss.address, iss.pincode].filter(Boolean).join(' - ')}</div>
            <div class="inv-addr">${[iss.phone && 'Ph: ' + iss.phone, iss.email].filter(Boolean).join(' · ')}</div>
            ${iss.gstin && html`<div class="inv-gstin">GSTIN: <strong>${iss.gstin}</strong></div>`}
          </div>
        </div>
        <div class="inv-meta">
          <div class="inv-title">${title}</div>
          <table class="inv-meta-table"><tbody>
            <tr><th>Invoice no.</th><td>${b.invoiceNo || 'Draft'}</td></tr>
            <tr><th>Date</th><td>${U.fmtDate(b.invoiceDate || b.checkOut)}</td></tr>
            <tr><th>Booking</th><td>${b.code}</td></tr>
          </tbody></table>
        </div>
      </header>

      <section class="inv-parties">
        <div>
          <div class="inv-label">Billed to</div>
          <div class="inv-strong">${to.company || to.name}</div>
          ${to.company && html`<div>${to.name}</div>`}
          ${(to.address || to.city || to.state) && html`<div>${[to.address, to.city, to.state].filter(Boolean).join(', ')}</div>`}
          ${to.phone && html`<div>Ph: ${U.phoneDisplay(to.phone)}</div>`}
          ${to.gstin && html`<div>GSTIN: <strong>${to.gstin}</strong></div>`}
        </div>
        <div>
          <div class="inv-label">Stay details</div>
          <div>Check-in: <strong>${U.fmtDateTimeFull(b.actualCheckIn || b.checkIn)}</strong></div>
          <div>Check-out: <strong>${U.fmtDateTimeFull(b.actualCheckOut || b.checkOut)}</strong></div>
          <div>Room(s): <strong>${L.roomNumbers(b)}</strong> · Guests: ${(b.adults || 1) + (b.children || 0)}</div>
          ${gst && html`<div>Place of supply: ${iss.stateName || ''}${iss.stateCode ? ' (' + iss.stateCode + ')' : ''}</div>`}
        </div>
      </section>

      <table class="inv-table">
        <thead><tr>
          <th class="c-no">#</th><th>Description</th>${gst && html`<th class="c-sac">SAC</th>`}
          <th class="num">Qty</th><th class="num">Rate</th>${gst && html`<th class="num c-gst">GST</th>`}<th class="num">Amount</th>
        </tr></thead>
        <tbody>
          ${(bill.lines || []).map((l) => html`<tr>
            <td class="c-no">${++n}</td>
            <td>Room ${l.number}${l.typeName ? ' · ' + l.typeName : ''}${l.extraBeds ? html`<div class="inv-sub">Tariff ${U.amount(l.rate)} + ${l.extraBeds} extra bed × ${U.amount(l.bedRate)}</div>` : ''}
              <div class="inv-sub">${b.billedNights || l.nights} ${s.checkoutMode === '24h' ? 'day(s) of 24 h' : 'night(s)'}</div></td>
            ${gst && html`<td class="c-sac">${iss.sacCode || '996311'}</td>`}
            <td class="num">${l.nights}</td><td class="num">${U.amount(l.perNight)}</td>${gst && html`<td class="num c-gst">${l.gstRate}%</td>`}<td class="num">${U.amount(l.gross)}</td>
          </tr>`)}
          ${(bill.charges || []).map((c) => html`<tr>
            <td class="c-no">${++n}</td><td>${c.description}${c.category && c.category !== c.description ? html`<div class="inv-sub">${c.category}</div>` : ''}</td>
            ${gst && html`<td class="c-sac">${sacFor(c, s)}</td>`}
            <td class="num">${c.qty || 1}</td><td class="num">${U.amount(c.amount)}</td>${gst && html`<td class="num c-gst">${c.gstRate}%</td>`}<td class="num">${U.amount(c.gross)}</td>
          </tr>`)}
          ${bill.cancelled && html`<tr><td class="c-no">1</td><td>Cancellation charges</td>${gst && html`<td></td>`}<td class="num">1</td><td class="num">${U.amount(bill.total)}</td>${gst && html`<td></td>`}<td class="num">${U.amount(bill.total)}</td></tr>`}
        </tbody>
      </table>

      <section class="inv-bottom">
        <div class="inv-words">
          <div class="inv-label">Amount in words</div>
          <div class="inv-strong">${U.amountInWords(bill.total)}</div>
          ${gst && html`<table class="inv-tax">
            <thead><tr><th>GST rate</th><th class="num">Taxable</th><th class="num">CGST</th><th class="num">SGST</th><th class="num">Total tax</th></tr></thead>
            <tbody>${bill.taxes.map((t) => html`<tr><td>${t.rate}%</td><td class="num">${U.amount(t.taxable)}</td><td class="num">${U.amount(t.cgst)}</td><td class="num">${U.amount(t.sgst)}</td><td class="num">${U.amount(t.tax)}</td></tr>`)}</tbody>
          </table>`}
          ${bill.inclusive && html`<div class="inv-note">Tariffs are inclusive of GST.</div>`}
        </div>
        <table class="inv-totals"><tbody>
          <tr><th>Gross amount</th><td>${U.amount(gross || bill.total)}</td></tr>
          ${bill.discount > 0 && html`<tr><th>Less: discount</th><td>− ${U.amount(bill.discount)}</td></tr>`}
          ${included > 0 && html`<tr><th>Less: GST included</th><td>− ${U.amount(included)}</td></tr>`}
          ${gst && html`<tr><th>Taxable value</th><td>${U.amount(bill.taxable)}</td></tr>`}
          ${gst && html`<tr><th>CGST</th><td>${U.amount(bill.cgst)}</td></tr>`}
          ${gst && html`<tr><th>SGST</th><td>${U.amount(bill.sgst)}</td></tr>`}
          ${bill.roundOff !== 0 && html`<tr><th>Round off</th><td>${U.amount(bill.roundOff)}</td></tr>`}
          <tr class="inv-grand"><th>Grand total</th><td>₹ ${U.amount(bill.total)}</td></tr>
          <tr><th>Paid</th><td>${U.amount(bill.paid)}</td></tr>
          <tr class=${bill.balance > 0 ? 'inv-due' : ''}><th>${bill.balance >= 0 ? 'Balance due' : 'Refund due'}</th><td>${U.amount(Math.abs(bill.balance))}</td></tr>
        </tbody></table>
      </section>

      ${(b.payments || []).length > 0 && html`<section class="inv-payments">
        <div class="inv-label">Payments</div>
        <div class="inv-pay-list">${b.payments.map((p) => html`<span>${U.fmtDate(p.at)} · ${p.kind === 'refund' ? 'Refund' : p.mode}${p.ref ? ' (' + p.ref + ')' : ''} · ${p.kind === 'refund' ? '−' : ''}₹${U.amount(p.amount)}</span>`)}</div>
      </section>`}

      <footer class="inv-foot">
        <div class="inv-terms">${iss.invoiceTerms && html`<div><strong>Terms:</strong> ${iss.invoiceTerms}</div>`}${iss.invoiceFooter && html`<div class="inv-thanks">${iss.invoiceFooter}</div>`}</div>
        <div class="inv-sign"><div class="inv-sign-line"></div>For ${iss.legalName || iss.hotelName}<br /><span>Authorised signatory</span></div>
      </footer>
      <div class="inv-generated">Computer-generated invoice${b.updatedBy ? ' · ' + b.updatedBy : ''}</div>
    </article>`;
  }

  function printInvoice(b) {
    const root = document.getElementById('print-root');
    render(h(InvoiceDoc, { b }), root);
    document.documentElement.classList.add('is-printing');
    const done = () => {
      document.documentElement.classList.remove('is-printing');
      render(null, root);
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => {
      window.print();
      // Some mobile browsers never fire afterprint
      setTimeout(() => { if (document.documentElement.classList.contains('is-printing')) done(); }, 60000);
    }, 60);
  }

  function invoiceText(b) {
    const s = S.settings();
    const bill = L.billOf(b);
    return [
      `*${s.hotelName}* – Invoice ${b.invoiceNo || ''}`,
      `Guest: ${L.guestName(b)}`,
      `Room: ${L.roomNumbers(b)} · ${U.fmtDate(b.checkIn)} → ${U.fmtDate(b.checkOut)}`,
      bill.tax > 0 ? `Taxable: ${U.money(bill.taxable, 2)} · GST: ${U.money(bill.tax, 2)}` : '',
      `Total: ${U.money(bill.total)} · Paid: ${U.money(bill.paid)}${bill.balance > 0 ? ` · Due: ${U.money(bill.balance)}` : ''}`,
      s.invoiceFooter || '',
    ].filter(Boolean).join('\n');
  }

  function InvoiceModal({ close, id }) {
    App.useStore();
    const b = S.get('bookings', id);
    if (!b) return html`<${Modal} title="Invoice" onClose=${() => close()}><${EmptyState} title="Invoice not found" /><//>`;
    const g = L.guestOf(b);
    async function share() {
      const text = invoiceText(b);
      if (navigator.share) {
        try {
          await navigator.share({ title: `Invoice ${b.invoiceNo}`, text });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      if (g.phone) window.open(U.waLink(g.phone, text), '_blank', 'noopener');
      else {
        try {
          await navigator.clipboard.writeText(text);
          toast('Invoice summary copied');
        } catch (e) {
          toast('Sharing is not available on this device', 'error');
        }
      }
    }
    return html`<${Modal} title=${`Invoice ${b.invoiceNo || ''}`} subtitle=${`${L.guestName(b)} · ${U.fmtDate(b.invoiceDate || b.checkOut)}`} size="xl" icon="invoice"
        onClose=${() => close()} class="invoice-modal"
        footer=${html`<${Button} icon="share" onClick=${share}>Share<//>
          ${g.phone && html`<a class="btn btn-secondary hide-xs" href=${U.waLink(g.phone, invoiceText(b))} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${18} /><span class="btn-text">WhatsApp</span></a>`}
          <${Button} icon="bookings" onClick=${() => App.openBooking(b.id)} class="hide-xs">Booking<//>
          <${Button} variant="primary" icon="printer" onClick=${() => printInvoice(b)}>Print / PDF<//>`}>
      <div class="invoice-scroll"><${InvoiceDoc} b=${b} /></div>
    <//>`;
  }

  // ------------------------------------------------------------------ invoices page
  function InvoicesPage() {
    App.useStore();
    const wide = App.useMedia(App.BP.wide);
    const t = U.today();
    const [period, setPeriod] = useState('month');
    const [q, setQ] = useState('');
    const [limit, setLimit] = useState(50);
    const ranges = {
      today: [t, t],
      month: [U.startOfMonth(t), U.endOfMonth(t)],
      lastmonth: (() => { const st = U.startOfMonth(U.addDays(U.startOfMonth(t), -1)); return [st, U.endOfMonth(st)]; })(),
      fy: [U.fyStart(t), U.addDays(U.fyStart(t), 364)],
      all: ['0000-01-01', '9999-12-31'],
    };
    const [from, to] = ranges[period];
    const list = useMemo(() => U.sortBy(
      S.all('bookings').filter((b) => b.invoiceNo && b.status === 'checked_out')
        .filter((b) => { const d = U.datePart(b.invoiceDate || b.checkOut); return d >= from && d <= to; })
        .filter((b) => !q.trim() || U.matches(q, b.invoiceNo, b.code, L.guestName(b), (L.guestOf(b) || {}).phone, L.roomNumbers(b), (b.billTo || {}).company)),
      (b) => b.invoiceDate || b.checkOut, -1), [S.version, period, q]);
    const bills = list.map((b) => L.billOf(b));
    const sum = (k) => U.round2(U.sum(bills, (x) => x[k]));
    const due = U.round2(U.sum(bills, (x) => Math.max(0, x.balance)));

    function exportCsv() {
      const rows = list.map((b, i) => ({ b, bill: bills[i] }));
      const csv = U.toCSV(rows, [
        { label: 'Invoice No', value: (r) => r.b.invoiceNo },
        { label: 'Invoice Date', value: (r) => U.datePart(r.b.invoiceDate || r.b.checkOut) },
        { label: 'Booking', value: (r) => r.b.code },
        { label: 'Guest / Company', value: (r) => (r.b.billTo && r.b.billTo.company) || L.guestName(r.b) },
        { label: 'Guest GSTIN', value: (r) => (r.b.billTo && r.b.billTo.gstin) || '' },
        { label: 'Rooms', value: (r) => L.roomNumbers(r.b) },
        { label: 'Nights', value: (r) => r.bill.nights },
        { label: 'Taxable Value', value: (r) => r.bill.taxable },
        { label: 'CGST', value: (r) => r.bill.cgst },
        { label: 'SGST', value: (r) => r.bill.sgst },
        { label: 'Total GST', value: (r) => r.bill.tax },
        { label: 'Invoice Total', value: (r) => r.bill.total },
        { label: 'Paid', value: (r) => r.bill.paid },
        { label: 'Balance', value: (r) => r.bill.balance },
      ]);
      U.download(`invoices-${from}-to-${to === '9999-12-31' ? 'all' : to}.csv`, csv, 'text/csv;charset=utf-8');
    }

    return html`<${Page} title="Invoices" subtitle="GST invoices are created automatically at check-out"
        actions=${html`<${Button} icon="download" onClick=${exportCsv} disabled=${!list.length}>Export CSV<//>`}>
      <div class="stats stats-4">
        <${Stat} label="Invoices" value=${U.num(list.length)} icon="invoice" />
        <${Stat} label="Taxable value" value=${U.money(sum('taxable'))} icon="rupee" tone="indigo" />
        <${Stat} label="GST (CGST + SGST)" value=${U.money(sum('tax'))} sub=${`${U.money(sum('cgst'))} + ${U.money(sum('sgst'))}`} icon="percent" tone="violet" />
        <${Stat} label="Invoice total" value=${U.money(sum('total'))} sub=${due > 0 ? U.money(due) + ' pending' : 'All collected'} icon="coins" tone="ok" />
      </div>
      <div class="toolbar">
        <${SearchInput} value=${q} onChange=${setQ} placeholder="Search invoice no, guest, company…" class="grow" />
        <${Select} value=${period} onChange=${(v) => { setPeriod(v); setLimit(50); }} class="toolbar-select" aria-label="Period"
          options=${[{ value: 'today', label: 'Today' }, { value: 'month', label: 'This month' }, { value: 'lastmonth', label: 'Last month' }, { value: 'fy', label: 'This financial year' }, { value: 'all', label: 'All time' }]} />
      </div>
      ${!list.length ? html`<${EmptyState} icon="invoice" title="No invoices in this period" text="Check out a guest to create a GST invoice." />`
        : wide ? html`<div class="table-wrap card"><table class="table table-click">
            <thead><tr><th>Invoice</th><th>Date</th><th>Guest</th><th>Room</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th><th class="num">Balance</th></tr></thead>
            <tbody>${list.slice(0, limit).map((b, i) => html`<tr key=${b.id} onClick=${() => App.openInvoice(b.id)} tabindex="0" onKeyDown=${(e) => e.key === 'Enter' && App.openInvoice(b.id)}>
              <td class="fw-600">${b.invoiceNo}</td><td>${U.fmtDate(b.invoiceDate || b.checkOut)}</td>
              <td><div class="fw-500">${(b.billTo && b.billTo.company) || L.guestName(b)}</div>${b.billTo && b.billTo.gstin && html`<div class="muted small">${b.billTo.gstin}</div>`}</td>
              <td><span class="room-tag">${L.roomNumbers(b)}</span></td>
              <td class="num">${U.money(bills[i].taxable, 2)}</td><td class="num">${U.money(bills[i].tax, 2)}</td>
              <td class="num fw-600">${U.money(bills[i].total)}</td><td class="num"><${App.BalanceText} b=${b} /></td>
            </tr>`)}</tbody></table></div>`
        : html`<div class="card-list">${list.slice(0, limit).map((b, i) => html`<button type="button" class="list-card" key=${b.id} onClick=${() => App.openInvoice(b.id)}>
            <div class="lc-top"><div class="lc-icon"><${Icon} name="invoice" size=${20} /></div>
              <div class="lc-main"><div class="lc-title">${b.invoiceNo}</div><div class="lc-sub">${L.guestName(b)} · Room ${L.roomNumbers(b)}</div></div>
              <div class="lc-amount"><strong>${U.money(bills[i].total)}</strong><span class="muted small">${U.fmtDateShort(b.invoiceDate || b.checkOut)}</span></div></div>
          </button>`)}</div>`}
      ${list.length > limit && html`<div class="load-more"><${Button} onClick=${() => setLimit(limit + 100)}>Show more<//></div>`}
    <//>`;
  }

  App.InvoiceDoc = InvoiceDoc;
  App.printInvoice = printInvoice;
  App.openInvoice = (id) => App.openModal(InvoiceModal, { id });
  App.views = App.views || {};
  App.views.invoices = InvoicesPage;
})(window.App = window.App || {});
