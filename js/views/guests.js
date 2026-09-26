/*
 * Guests: searchable directory, profile with stay history, edit form.
 */
(function (App) {
  'use strict';
  const { html, useState, useMemo, U, L, Icon, Button, Badge, Field, Input, Select, Textarea, Modal, Page, EmptyState, SearchInput, Avatar, KV, toast, confirm } = App;
  const S = App.Store;

  function GuestsPage() {
    App.useStore();
    const wide = App.useMedia(App.BP.wide);
    const [q, setQ] = useState('');
    const [sort, setSort] = useState('recent');
    const [limit, setLimit] = useState(60);
    const rows = useMemo(() => {
      const lastStay = new Map();
      const stays = new Map();
      for (const b of S.all('bookings')) {
        if (b.status === 'cancelled' || b.status === 'no_show') continue;
        const cur = lastStay.get(b.guestId);
        if (!cur || b.checkIn > cur) lastStay.set(b.guestId, b.checkIn);
        stays.set(b.guestId, (stays.get(b.guestId) || 0) + 1);
      }
      let arr = S.all('guests').filter((g) => !q.trim() || U.matches(q, g.name, g.phone, g.city, g.state, g.idNumber, g.company, g.email));
      arr = arr.map((g) => ({ g, last: lastStay.get(g.id) || '', stays: stays.get(g.id) || 0 }));
      if (sort === 'recent') arr = U.sortBy(arr, (x) => x.last || String(x.g.createdAt), -1);
      if (sort === 'name') arr = U.sortBy(arr, (x) => x.g.name.toLowerCase());
      if (sort === 'stays') arr = U.sortBy(arr, (x) => x.stays, -1);
      return arr;
    }, [S.version, q, sort]);

    function exportCsv() {
      const csv = U.toCSV(rows, [
        { label: 'Name', value: (x) => x.g.name },
        { label: 'Phone', value: (x) => x.g.phone },
        { label: 'Email', value: (x) => x.g.email },
        { label: 'City', value: (x) => x.g.city },
        { label: 'State', value: (x) => x.g.state },
        { label: 'ID Type', value: (x) => x.g.idType },
        { label: 'ID Number', value: (x) => x.g.idNumber },
        { label: 'Company', value: (x) => x.g.company },
        { label: 'GSTIN', value: (x) => x.g.gstin },
        { label: 'Stays', value: (x) => x.stays },
        { label: 'Last Stay', value: (x) => (x.last ? U.datePart(x.last) : '') },
      ]);
      U.download(`guests-${U.today()}.csv`, csv, 'text/csv;charset=utf-8');
    }

    return html`<${Page} title="Guests" subtitle=${`${U.num(S.all('guests').length)} guests on record`}
        actions=${html`${S.can('reports') && html`<${Button} icon="download" onClick=${exportCsv} class="hide-xs">Export<//>`}
          <${Button} variant="primary" icon="userPlus" onClick=${() => App.openModal(GuestForm, {})}>Add guest<//>`}>
      <div class="toolbar">
        <${SearchInput} value=${q} onChange=${(v) => { setQ(v); setLimit(60); }} placeholder="Search name, phone, city, ID…" class="grow" />
        <${Select} value=${sort} onChange=${setSort} class="toolbar-select" aria-label="Sort"
          options=${[{ value: 'recent', label: 'Recent stays' }, { value: 'name', label: 'Name A–Z' }, { value: 'stays', label: 'Most stays' }]} />
      </div>
      ${!rows.length ? html`<${EmptyState} icon="guests" title=${q ? 'No guests found' : 'No guests yet'} text=${q ? 'Try another name or phone number.' : 'Guests are added automatically when you create bookings.'} />`
        : wide ? html`<div class="table-wrap card"><table class="table table-click">
            <thead><tr><th>Guest</th><th>Phone</th><th>City</th><th>ID proof</th><th class="num">Stays</th><th>Last stay</th></tr></thead>
            <tbody>${rows.slice(0, limit).map(({ g, stays, last }) => html`<tr key=${g.id} onClick=${() => App.openGuest(g.id)} tabindex="0" onKeyDown=${(e) => e.key === 'Enter' && App.openGuest(g.id)}>
              <td><div class="cell-guest"><${Avatar} name=${g.name} size=${34} /><div><div class="fw-600">${g.name}</div>${g.company && html`<div class="muted small">${g.company}</div>`}</div></div></td>
              <td>${U.phoneDisplay(g.phone)}</td><td>${[g.city, g.state].filter(Boolean).join(', ')}</td>
              <td>${g.idNumber ? html`<span class="muted">${g.idType}</span> ${U.maskId(g.idNumber)}` : html`<span class="muted">—</span>`}</td>
              <td class="num">${stays}</td><td>${last ? U.fmtDate(last) : '—'}</td>
            </tr>`)}</tbody></table></div>`
        : html`<div class="card-list">${rows.slice(0, limit).map(({ g, stays, last }) => html`<button type="button" class="list-card" key=${g.id} onClick=${() => App.openGuest(g.id)}>
            <div class="lc-top"><${Avatar} name=${g.name} size=${40} />
              <div class="lc-main"><div class="lc-title">${g.name}</div><div class="lc-sub">${U.phoneDisplay(g.phone)}${g.city ? ' · ' + g.city : ''}</div></div>
              <div class="lc-amount"><strong>${U.plural(stays, 'stay')}</strong><span class="muted small">${last ? U.fmtDateShort(last) : ''}</span></div></div>
          </button>`)}</div>`}
      ${rows.length > limit && html`<div class="load-more"><${Button} onClick=${() => setLimit(limit + 100)}>Show more<//></div>`}
    <//>`;
  }

  function GuestDetail({ close, id }) {
    App.useStore();
    const g = L.guest(id);
    if (!g) return html`<${Modal} title="Guest" kind="drawer" onClose=${() => close()}><${EmptyState} title="Guest not found" /><//>`;
    const hist = L.guestHistory(id);
    const active = hist.bookings.find((b) => b.status === 'checked_in' || b.status === 'reserved');

    async function remove() {
      if (hist.bookings.length) return toast('This guest has bookings and cannot be deleted', 'error');
      if (await confirm({ title: 'Delete guest?', message: `${g.name} will be removed permanently.`, confirmText: 'Delete', danger: true })) {
        S.remove('guests', id);
        toast('Guest deleted');
        close();
      }
    }
    return html`<${Modal} kind="drawer" size="md" icon="user" onClose=${() => close()} title=${g.name}
        subtitle=${`${U.plural(hist.stays, 'stay')}${S.can('revenue') ? ' · ' + U.money(hist.spent) + ' billed' : ''}`}
        footer=${html`<${Button} variant="primary" icon="calendarPlus" onClick=${() => { close(); App.newBooking({ mode: 'reserve', guestId: id }); }}>New booking<//>
          <${Button} icon="edit" onClick=${() => App.openModal(GuestForm, { id })}>Edit<//>
          ${S.can('delete') && html`<${Button} variant="ghost" icon="trash" aria-label="Delete guest" onClick=${remove} />`}`}>
      <div class="guest-hero">
        <${Avatar} name=${g.name} size=${64} />
        <div>
          <div class="guest-hero-name">${g.name}</div>
          <div class="muted">${[g.city, g.state].filter(Boolean).join(', ')}</div>
          ${active && html`<div style="margin-top:6px"><${App.StatusBadge} b=${active} /></div>`}
        </div>
      </div>
      ${g.phone && html`<div class="contact-btns">
        <a class="btn btn-secondary" href=${U.telLink(g.phone)}><${Icon} name="phone" size=${18} /><span>Call</span></a>
        <a class="btn btn-secondary" href=${U.waLink(g.phone)} target="_blank" rel="noopener"><${Icon} name="whatsapp" size=${18} /><span>WhatsApp</span></a>
        ${g.email && html`<a class="btn btn-secondary" href=${'mailto:' + g.email}><${Icon} name="mail" size=${18} /><span>Email</span></a>`}
      </div>`}
      <section class="panel">
        <${KV} items=${[
          ['Phone', U.phoneDisplay(g.phone)],
          ['Email', g.email],
          ['ID proof', g.idNumber ? `${g.idType} · ${g.idNumber}` : ''],
          ['Address', g.address],
          ['Company', g.company],
          ['GSTIN', g.gstin],
          ['Notes', g.notes],
          ['Guest since', U.fmtDate(g.createdAt)],
        ]} />
      </section>
      <section class="panel">
        <div class="panel-head"><h3>Stay history</h3></div>
        ${hist.bookings.length ? hist.bookings.map((b) => html`<button type="button" class="mini-row" key=${b.id} onClick=${() => App.openBooking(b.id)}>
            <div class="date-chip"><span>${new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(U.parse(b.checkIn))}</span><strong>${U.parse(b.checkIn).getDate()}</strong></div>
            <div class="mini-text"><div class="fw-600">Room ${L.roomNumbers(b)} · ${U.plural(b.billedNights || b.nights || 1, 'night')}</div>
              <div class="muted small">${b.code}${b.invoiceNo ? ' · ' + b.invoiceNo : ''} · ${U.fmtDate(b.checkIn)}</div></div>
            <div class="mini-right"><${App.StatusBadge} b=${b} />${S.can('revenue') && html`<span class="small">${U.money(L.totals(b).total)}</span>`}</div>
          </button>`) : html`<div class="card-empty">No stays yet.</div>`}
      </section>
    <//>`;
  }

  function GuestForm({ close, id }) {
    const s = S.settings();
    const existing = id ? L.guest(id) : null;
    const [g, setG] = useState(() => Object.assign({ name: '', phone: '', email: '', idType: 'Aadhaar', idNumber: '', address: '', city: '', state: '', gstin: '', company: '', notes: '' }, existing || {}));
    const [errors, setErrors] = useState({});
    const set = (k) => (v) => setG(Object.assign({}, g, { [k]: v }));
    function save() {
      const e = {};
      if (!g.name.trim()) e.name = 'Name is required';
      if (!U.digits(g.phone)) e.phone = 'Phone is required';
      const dup = S.all('guests').find((x) => x.id !== id && U.digits(x.phone) && U.digits(x.phone) === U.digits(g.phone));
      if (dup) e.phone = `Already saved for ${dup.name}`;
      setErrors(e);
      if (Object.keys(e).length) return;
      const saved = L.upsertGuest(g);
      toast(existing ? 'Guest updated' : 'Guest added');
      close(saved.id);
    }
    return html`<${Modal} title=${existing ? 'Edit guest' : 'Add guest'} icon="userPlus" size="md" locked onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="check" onClick=${save}>Save<//>`}>
      <div class="grid-2">
        <${Field} label="Full name" required error=${errors.name}><${Input} value=${g.name} onChange=${set('name')} data-autofocus /><//>
        <${Field} label="Mobile" required error=${errors.phone}><${Input} type="tel" inputmode="tel" value=${g.phone} onChange=${set('phone')} /><//>
        <${Field} label="ID proof"><${Select} value=${g.idType} onChange=${set('idType')} options=${s.idTypes} /><//>
        <${Field} label="ID number"><${Input} value=${g.idNumber} onChange=${set('idNumber')} /><//>
        <${Field} label="City"><${Input} value=${g.city} onChange=${set('city')} /><//>
        <${Field} label="State"><${Input} value=${g.state} onChange=${set('state')} list="tbd-states-g" /><//>
        <${Field} label="Email"><${Input} type="email" value=${g.email} onChange=${set('email')} /><//>
        <${Field} label="Address"><${Input} value=${g.address} onChange=${set('address')} /><//>
        <${Field} label="Company"><${Input} value=${g.company} onChange=${set('company')} /><//>
        <${Field} label="GSTIN"><${Input} value=${g.gstin} maxlength="15" onChange=${(v) => set('gstin')(v.toUpperCase())} /><//>
      </div>
      <${Field} label="Notes"><${Textarea} value=${g.notes} onChange=${set('notes')} placeholder="Preferences, VIP, blacklist reason…" /><//>
      <datalist id="tbd-states-g">${(App.INDIAN_STATES || []).map((st) => html`<option value=${st} />`)}</datalist>
    <//>`;
  }

  App.openGuest = (id) => App.openModal(GuestDetail, { id });
  App.views = App.views || {};
  App.views.guests = GuestsPage;
})(window.App = window.App || {});
