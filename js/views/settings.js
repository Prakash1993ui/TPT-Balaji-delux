/*
 * Settings: hotel profile, rooms & rates, stay policy & GST, lists, invoice
 * numbering, users (server mode), data backup/restore and appearance.
 */
(function (App) {
  'use strict';
  const { html, useState, useEffect, useMemo, U, L, Icon, Button, Badge, Field, Input, MoneyInput, Select, Textarea, Toggle, Segmented, Stepper,
    Modal, Page, EmptyState, Card, KV, toast, confirm, attempt } = App;
  const S = App.Store;

  const SECTIONS = [
    { id: 'hotel', label: 'Hotel profile', icon: 'hotel', hint: 'Name, address, GSTIN, logo', perm: 'settings' },
    { id: 'rooms', label: 'Rooms & rates', icon: 'rooms', hint: 'Room types, tariffs, room numbers', perm: 'settings' },
    { id: 'policy', label: 'Stay policy & GST', icon: 'percent', hint: '24-hour check-out, tax slabs', perm: 'settings' },
    { id: 'lists', label: 'Lists', icon: 'list', hint: 'Sources, payment modes, ID types', perm: 'settings' },
    { id: 'invoice', label: 'Invoice & numbering', icon: 'invoice', hint: 'Prefixes, terms, footer', perm: 'settings' },
    { id: 'users', label: 'Users & login', icon: 'guests', hint: 'Staff accounts & passwords' },
    { id: 'data', label: 'Backup & data', icon: 'database', hint: 'Backup, restore, start fresh', perm: 'backup' },
    { id: 'device', label: 'Appearance & app', icon: 'smartphone', hint: 'Theme, install on phone/PC' },
  ];

  function SettingsPage({ route }) {
    App.useStore();
    const wide = App.useMedia(App.BP.wide);
    const visible = SECTIONS.filter((x) => !x.perm || S.can(x.perm));
    const tab = route.query.tab;
    const current = visible.find((x) => x.id === tab) || (wide ? visible[0] : null);
    const go = (id) => App.navigate('#/settings' + (id ? '?tab=' + id : ''));
    const Section = current && SECTION_VIEWS[current.id];

    if (!wide && !current) {
      return html`<${Page} title="Settings" subtitle=${S.settings().hotelName}>
        <div class="settings-menu card">${visible.map((x) => html`<button type="button" class="action-item" onClick=${() => go(x.id)}>
          <span class="action-icon"><${Icon} name=${x.icon} size=${20} /></span>
          <span class="action-text"><span class="action-label">${x.label}</span><span class="action-hint">${x.hint}</span></span>
          <${Icon} name="chevronRight" size=${18} class="action-chev" /></button>`)}</div>
      <//>`;
    }
    return html`<div class="page settings-page">
      ${wide ? html`<div class="page-head"><div class="page-titles"><h1 class="page-title">Settings</h1><p class="page-subtitle">${S.settings().hotelName}</p></div></div>`
        : html`<button type="button" class="back-link" onClick=${() => go('')}><${Icon} name="chevronLeft" size=${18} /> Settings</button>`}
      <div class="settings-layout">
        ${wide && html`<nav class="settings-nav card" aria-label="Settings sections">${visible.map((x) => html`<button type="button"
            class=${U.cls('settings-nav-item', current && current.id === x.id && 'is-active')} onClick=${() => go(x.id)}>
            <${Icon} name=${x.icon} size=${18} /><span>${x.label}</span></button>`)}</nav>`}
        <div class="settings-content">
          <h2 class="settings-title">${current.label}</h2>
          <${Section} />
        </div>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ helpers
  function useDraft(keys) {
    const s = S.settings();
    const pick = () => Object.fromEntries(keys.map((k) => [k, s[k]]));
    const [d, setD] = useState(pick);
    const dirty = keys.some((k) => JSON.stringify(d[k]) !== JSON.stringify(s[k]));
    const set = (k) => (v) => setD((cur) => Object.assign({}, cur, { [k]: v }));
    return { d, setD, set, dirty, reset: () => setD(pick()) };
  }
  const SaveBar = ({ dirty, onSave, onReset }) => html`<div class=${U.cls('save-bar', dirty && 'is-dirty')}>
    <span class="muted small">${dirty ? 'You have unsaved changes' : 'All changes saved'}</span>
    <${Button} onClick=${onReset} disabled=${!dirty}>Reset<//>
    <${Button} variant="primary" icon="check" onClick=${onSave} disabled=${!dirty}>Save<//>
  </div>`;

  // ------------------------------------------------------------------ hotel profile
  function HotelSection() {
    const { d, set, dirty, reset } = useDraft(['hotelName', 'tagline', 'legalName', 'address', 'pincode', 'phone', 'email', 'gstin', 'stateName', 'stateCode', 'logo']);
    const gstinOk = !d.gstin || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(d.gstin);
    async function onLogo(e) {
      const f = e.currentTarget.files && e.currentTarget.files[0];
      if (!f) return;
      const url = await attempt(() => U.resizeImage(f, 240));
      if (url) set('logo')(url);
    }
    function save() {
      if (!d.hotelName.trim()) return toast('Hotel name is required', 'error');
      if (!gstinOk) return toast('GSTIN format looks wrong (15 characters, e.g. 37ABCDE1234F1Z5)', 'error');
      S.saveSettings(Object.assign({}, d, { hotelName: d.hotelName.trim() }));
      toast('Hotel profile saved');
    }
    return html`<div class="card settings-card">
      <div class="logo-row">
        <div class="logo-preview">${d.logo ? html`<img src=${d.logo} alt="Logo" />` : App.LogoMark && html`<${App.LogoMark} size=${64} />`}</div>
        <div class="logo-actions">
          <label class="btn btn-secondary btn-sm"><${Icon} name="upload" size=${16} /><span class="btn-text">Upload logo</span>
            <input type="file" accept="image/*" hidden onChange=${onLogo} /></label>
          ${d.logo && html`<${Button} size="sm" variant="ghost" onClick=${() => set('logo')('')}>Remove<//>`}
          <div class="muted small">Shown on invoices and the sidebar. Square images work best.</div>
        </div>
      </div>
      <div class="grid-2">
        <${Field} label="Hotel name" required><${Input} value=${d.hotelName} onChange=${set('hotelName')} /><//>
        <${Field} label="Tagline"><${Input} value=${d.tagline} onChange=${set('tagline')} placeholder="e.g. Hotel · Tirupati" /><//>
        <${Field} label="Legal / business name" hint="As registered for GST (if different)"><${Input} value=${d.legalName} onChange=${set('legalName')} /><//>
        <${Field} label="GSTIN" error=${!gstinOk && 'Check the GSTIN format'}><${Input} value=${d.gstin} maxlength="15" onChange=${(v) => set('gstin')(v.toUpperCase().trim())} placeholder="37XXXXX0000X1Z5" /><//>
        <${Field} label="Address" class="span-2"><${Input} value=${d.address} onChange=${set('address')} /><//>
        <${Field} label="PIN code"><${Input} value=${d.pincode} inputmode="numeric" maxlength="6" onChange=${set('pincode')} /><//>
        <${Field} label="Phone"><${Input} type="tel" value=${d.phone} onChange=${set('phone')} /><//>
        <${Field} label="Email"><${Input} type="email" value=${d.email} onChange=${set('email')} /><//>
        <${Field} label="State (place of supply)"><${Select} value=${d.stateName} onChange=${(v) => { set('stateName')(v); const code = STATE_CODES[v]; if (code) set('stateCode')(code); }} options=${Object.keys(STATE_CODES)} /><//>
      </div>
      <${SaveBar} dirty=${dirty} onSave=${save} onReset=${reset} />
    </div>`;
  }
  const STATE_CODES = {
    'Andhra Pradesh': '37', 'Arunachal Pradesh': '12', Assam: '18', Bihar: '10', Chhattisgarh: '22', Goa: '30', Gujarat: '24', Haryana: '06',
    'Himachal Pradesh': '02', Jharkhand: '20', Karnataka: '29', Kerala: '32', 'Madhya Pradesh': '23', Maharashtra: '27', Manipur: '14',
    Meghalaya: '17', Mizoram: '15', Nagaland: '13', Odisha: '21', Punjab: '03', Rajasthan: '08', Sikkim: '11', 'Tamil Nadu': '33',
    Telangana: '36', Tripura: '16', 'Uttar Pradesh': '09', Uttarakhand: '05', 'West Bengal': '19', Delhi: '07', 'Jammu and Kashmir': '01',
    Ladakh: '38', Puducherry: '34', Chandigarh: '04', 'Andaman and Nicobar Islands': '35', Lakshadweep: '31', 'Dadra and Nagar Haveli and Daman and Diu': '26',
  };

  // ------------------------------------------------------------------ rooms & rates
  function RoomsSection() {
    App.useStore();
    const types = L.roomTypes();
    const rooms = L.allRoomsSorted();
    const byType = U.groupBy(rooms, (r) => r.typeId);
    return html`<div class="stack">
      <${Card} title="Room types & tariffs" subtitle="Default tariff per night — can be changed on each booking" icon="sliders"
          actions=${html`<${Button} size="sm" variant="primary" icon="plus" onClick=${() => App.openModal(RoomTypeForm, {})}>Add type<//>`} pad=${false}>
        ${types.length ? types.map((t) => html`<button type="button" class="setting-row" onClick=${() => App.openModal(RoomTypeForm, { id: t.id })}>
            <div class="grow"><div class="fw-600">${t.name}</div><div class="muted small">${U.plural((byType.get(t.id) || []).length, 'room')} · up to ${t.maxAdults || 2} adults${t.extraBedRate ? ` · extra bed ${U.money(t.extraBedRate)}` : ''}</div></div>
            <div class="fw-600">${U.money(t.rate)}<span class="muted small"> /night</span></div>
            <${Icon} name="chevronRight" size=${18} class="muted" />
          </button>`) : html`<div class="card-empty">Add your first room type (e.g. “AC Double”).</div>`}
      <//>
      <${Card} title="Rooms" subtitle=${`${rooms.filter((r) => r.active !== false).length} active rooms`} icon="doorClosed"
          actions=${html`<${Button} size="sm" icon="plus" onClick=${() => App.openModal(RoomForm, {})} disabled=${!types.length}>Add room<//>
            <${Button} size="sm" variant="primary" icon="grid" onClick=${() => App.openModal(BulkRooms, {})} disabled=${!types.length}>Add many<//>`} pad=${false}>
        ${rooms.length ? html`<div class="room-admin-grid">${rooms.map((r) => html`<button type="button" class=${U.cls('room-admin', r.active === false && 'is-inactive')} onClick=${() => App.openModal(RoomForm, { id: r.id })}>
            <strong>${r.number}</strong><span>${(L.roomType(r.typeId) || {}).name || 'No type'}</span>${r.active === false && html`<em>Inactive</em>`}
          </button>`)}</div>` : html`<div class="card-empty">No rooms yet. Use “Add many” to add a range like 101-110.</div>`}
      <//>
    </div>`;
  }

  function RoomTypeForm({ close, id }) {
    const cur = id ? S.get('roomTypes', id) : null;
    const [t, setT] = useState(() => Object.assign({ name: '', rate: '', extraBedRate: '', maxAdults: 2, amenities: [], description: '' }, cur || {},
      cur ? { rate: String(cur.rate), extraBedRate: cur.extraBedRate ? String(cur.extraBedRate) : '' } : {}));
    const [amen, setAmen] = useState((t.amenities || []).join(', '));
    const set = (k) => (v) => setT(Object.assign({}, t, { [k]: v }));
    const count = id ? S.all('rooms').filter((r) => r.typeId === id).length : 0;
    function save() {
      if (!t.name.trim()) return toast('Enter a name', 'error');
      if (!(+t.rate >= 0) || t.rate === '') return toast('Enter the tariff', 'error');
      S.put('roomTypes', Object.assign({}, t, {
        name: t.name.trim(), rate: +t.rate, extraBedRate: +t.extraBedRate || 0, maxAdults: +t.maxAdults || 2,
        amenities: amen.split(',').map((x) => x.trim()).filter(Boolean),
      }));
      toast('Room type saved');
      close(true);
    }
    async function remove() {
      if (count) return toast(`${U.plural(count, 'room uses', 'rooms use')} this type. Change their type first.`, 'error');
      if (await confirm({ title: 'Delete room type?', message: t.name, confirmText: 'Delete', danger: true })) {
        S.remove('roomTypes', id);
        close(true);
      }
    }
    const gst = L.gstRateFor(+t.rate || 0);
    return html`<${Modal} title=${cur ? 'Edit room type' : 'Add room type'} icon="sliders" size="sm" onClose=${() => close()}
        footer=${html`${cur && html`<${Button} variant="ghost" icon="trash" onClick=${remove} aria-label="Delete" />`}<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="check" onClick=${save}>Save<//>`}>
      <${Field} label="Name" required><${Input} value=${t.name} onChange=${set('name')} placeholder="e.g. AC Deluxe" data-autofocus /><//>
      <div class="grid-2">
        <${Field} label="Tariff per night" required hint=${S.settings().gstEnabled && +t.rate > 0 ? `GST slab: ${gst}%` : ''}><${MoneyInput} value=${t.rate} onChange=${set('rate')} /><//>
        <${Field} label="Extra bed per night"><${MoneyInput} value=${t.extraBedRate} onChange=${set('extraBedRate')} /><//>
      </div>
      <${Field} as="div" label="Max adults"><${Stepper} value=${t.maxAdults} min=${1} max=${12} onChange=${set('maxAdults')} /><//>
      <${Field} label="Amenities" hint="Comma separated"><${Input} value=${amen} onChange=${setAmen} placeholder="AC, TV, Hot water, Wi-Fi" /><//>
    <//>`;
  }

  function RoomForm({ close, id }) {
    const cur = id ? S.get('rooms', id) : null;
    const types = L.roomTypes();
    const [r, setR] = useState(() => Object.assign({ number: '', floor: '', typeId: (types[0] || {}).id || '', notes: '', active: true }, cur || {}));
    const set = (k) => (v) => setR(Object.assign({}, r, { [k]: v }));
    function save() {
      const num = String(r.number).trim();
      if (!num) return toast('Enter the room number', 'error');
      if (S.all('rooms').some((x) => x.id !== id && String(x.number).toLowerCase() === num.toLowerCase())) return toast(`Room ${num} already exists`, 'error');
      if (!r.typeId) return toast('Choose a room type', 'error');
      S.put('rooms', Object.assign({}, r, { number: num, floor: String(r.floor).trim() || guessFloor(num) }));
      toast('Room saved');
      close(true);
    }
    async function remove() {
      const active = L.activeBookings().filter((b) => b.rooms.some((x) => x.roomId === id));
      if (active.length) return toast('This room has active bookings. Move them first.', 'error');
      const past = S.all('bookings').some((b) => b.rooms.some((x) => x.roomId === id));
      if (await confirm({ title: `Delete room ${r.number}?`, message: past ? 'Past bookings keep the room number on their invoices. Tip: mark the room inactive instead to keep it in reports.' : 'This room will be removed.', confirmText: 'Delete', danger: true })) {
        S.batch(() => {
          S.remove('rooms', id);
          S.remove('housekeeping', id);
        });
        close(true);
      }
    }
    return html`<${Modal} title=${cur ? `Room ${cur.number}` : 'Add room'} icon="doorClosed" size="sm" onClose=${() => close()}
        footer=${html`${cur && html`<${Button} variant="ghost" icon="trash" onClick=${remove} aria-label="Delete" />`}<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="check" onClick=${save}>Save<//>`}>
      <div class="grid-2">
        <${Field} label="Room number" required><${Input} value=${r.number} onChange=${set('number')} data-autofocus /><//>
        <${Field} label="Floor"><${Input} value=${r.floor} onChange=${set('floor')} placeholder=${guessFloor(r.number) || 'e.g. 1'} /><//>
      </div>
      <${Field} label="Room type"><${Select} value=${r.typeId} onChange=${set('typeId')} options=${types.map((t) => ({ value: t.id, label: `${t.name} · ${U.money(t.rate)}` }))} /><//>
      <${Field} label="Notes"><${Input} value=${r.notes} onChange=${set('notes')} placeholder="e.g. Lift facing, balcony" /><//>
      <${Toggle} label="Active" hint="Inactive rooms are hidden from the board and bookings" checked=${r.active !== false} onChange=${set('active')} />
    <//>`;
  }

  function guessFloor(num) {
    const n = String(num || '').trim();
    if (/^\d{3,4}$/.test(n)) return String(Math.floor(+n / 100));
    const m = /^([A-Za-z])\d+/.exec(n);
    return m ? m[1].toUpperCase() : '';
  }
  /** "101-106, 110, A1-A3" -> ['101',...,'106','110','A1','A2','A3'] */
  function parseRoomList(text) {
    const out = [];
    for (const part of String(text || '').split(/[,\s]+/).filter(Boolean)) {
      const m = /^([A-Za-z]*)(\d+)-([A-Za-z]*)(\d+)$/.exec(part);
      if (m && (m[1] === m[3] || !m[3])) {
        const a = +m[2], b = +m[4];
        if (b >= a && b - a <= 300) {
          for (let i = a; i <= b; i++) out.push(m[1] + String(i).padStart(m[2].length, '0'));
          continue;
        }
      }
      out.push(part);
    }
    return U.uniq(out);
  }
  App.parseRoomList = parseRoomList;
  App.guessFloor = guessFloor;

  function BulkRooms({ close }) {
    const types = L.roomTypes();
    const [typeId, setTypeId] = useState((types[0] || {}).id || '');
    const [text, setText] = useState('');
    const nums = parseRoomList(text);
    const existing = new Set(S.all('rooms').map((r) => String(r.number).toLowerCase()));
    const fresh = nums.filter((n) => !existing.has(n.toLowerCase()));
    function save() {
      if (!fresh.length) return toast('Enter new room numbers', 'error');
      S.batch(() => fresh.forEach((n) => S.put('rooms', { number: n, floor: guessFloor(n), typeId, active: true, notes: '' })));
      toast(`${U.plural(fresh.length, 'room')} added`);
      close(true);
    }
    return html`<${Modal} title="Add many rooms" icon="grid" size="sm" onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="plus" onClick=${save} disabled=${!fresh.length}>${fresh.length ? 'Add ' + U.plural(fresh.length, 'room') : 'Add rooms'}<//>`}>
      <${Field} label="Room type"><${Select} value=${typeId} onChange=${setTypeId} options=${types.map((t) => ({ value: t.id, label: `${t.name} · ${U.money(t.rate)}` }))} /><//>
      <${Field} label="Room numbers" hint="Ranges and lists, e.g. 101-110, 115, G1-G4"><${Input} value=${text} onChange=${setText} placeholder="201-212" data-autofocus /><//>
      ${nums.length > 0 && html`<div class="chips">${nums.map((n) => html`<span class=${U.cls('chip', existing.has(n.toLowerCase()) ? 'is-busy' : 'is-on')}>${n}${existing.has(n.toLowerCase()) ? ' (exists)' : ''}</span>`)}</div>`}
    <//>`;
  }

  // ------------------------------------------------------------------ policy & GST
  function PolicySection() {
    const { d, set, dirty, reset, setD } = useDraft(['checkoutMode', 'checkInTime', 'checkOutTime', 'graceMinutes', 'requireIdAtCheckIn', 'gstEnabled', 'ratesIncludeGst', 'gstSlabs', 'sacCode', 'chargeCategories']);
    const slabs = d.gstSlabs || [];
    const setSlab = (i, k, v) => set('gstSlabs')(slabs.map((x, j) => (j === i ? Object.assign({}, x, { [k]: v }) : x)));
    const cats = d.chargeCategories || [];
    const setCat = (i, k, v) => set('chargeCategories')(cats.map((x, j) => (j === i ? Object.assign({}, x, { [k]: v }) : x)));
    function save() {
      const clean = slabs.map((x) => ({ upTo: x.upTo === '' || x.upTo == null ? null : +x.upTo, rate: +x.rate || 0 }));
      if (clean.filter((x) => x.upTo == null).length !== 1) return toast('Keep exactly one "and above" slab (leave “up to” empty)', 'error');
      S.saveSettings(Object.assign({}, d, {
        graceMinutes: +d.graceMinutes || 0, gstSlabs: clean,
        chargeCategories: cats.filter((c) => (c.name || '').trim()).map((c) => ({ name: c.name.trim(), gst: c.gst === '' || c.gst == null ? null : +c.gst, sac: (c.sac || '').trim() })),
      }));
      toast('Policy & tax settings saved');
    }
    return html`<div class="stack">
      <div class="card settings-card">
        <h3 class="sub-title">Check-out policy</h3>
        <${Segmented} full value=${d.checkoutMode} onChange=${set('checkoutMode')}
          options=${[{ value: '24h', label: '24 hours from check-in', icon: 'timer' }, { value: 'fixed', label: 'Fixed check-out time', icon: 'clock' }]} />
        <p class="muted small">${d.checkoutMode === '24h' ? 'Common in Tirupati: a guest who checks in at 3 pm checks out by 3 pm the next day. Each extra 24 hours is charged as one more day.' : 'Every guest checks out by the same time. Staying past check-out time (plus grace) adds a night.'}</p>
        <div class="grid-3">
          ${d.checkoutMode === 'fixed' && html`<${Field} label="Standard check-in"><${Input} type="time" value=${d.checkInTime} onChange=${set('checkInTime')} /><//>`}
          ${d.checkoutMode === 'fixed' && html`<${Field} label="Check-out time"><${Input} type="time" value=${d.checkOutTime} onChange=${set('checkOutTime')} /><//>`}
          ${d.checkoutMode === '24h' && html`<${Field} label="Default arrival time" hint="For advance reservations"><${Input} type="time" value=${d.checkInTime} onChange=${set('checkInTime')} /><//>`}
          <${Field} label="Grace period (minutes)"><${Input} type="number" inputmode="numeric" min="0" value=${d.graceMinutes} onChange=${set('graceMinutes')} /><//>
        </div>
        <${Toggle} label="ID proof required at check-in" hint="As required by local police for hotels and lodges" checked=${d.requireIdAtCheckIn} onChange=${set('requireIdAtCheckIn')} />
      </div>

      <div class="card settings-card">
        <h3 class="sub-title">GST</h3>
        <${Toggle} label="Hotel is registered under GST" hint="Invoices show GSTIN, CGST and SGST. Turn off to print simple bills without tax." checked=${d.gstEnabled} onChange=${set('gstEnabled')} />
        ${d.gstEnabled && html`
          <${Toggle} label="Tariffs include GST" hint="Tariffs you enter already contain GST (tax is calculated backwards)" checked=${d.ratesIncludeGst} onChange=${set('ratesIncludeGst')} />
          <div class="slab-table">
            <div class="slab-head"><span>Room value per night up to</span><span>GST rate</span><span></span></div>
            ${slabs.map((x, i) => html`<div class="slab-row">
              <div class="input-affix"><span class="affix">₹</span><input class="input" type="number" inputmode="numeric" placeholder="and above" value=${x.upTo == null ? '' : x.upTo} onInput=${(e) => setSlab(i, 'upTo', e.currentTarget.value)} /></div>
              <${Select} value=${String(x.rate)} onChange=${(v) => setSlab(i, 'rate', +v)} options=${['0', '5', '12', '18', '28'].map((r) => ({ value: r, label: r + '%' }))} />
              <${Button} variant="ghost" icon="x" aria-label="Remove slab" onClick=${() => set('gstSlabs')(slabs.filter((_, j) => j !== i))} disabled=${slabs.length <= 1} />
            </div>`)}
            <${Button} size="sm" variant="ghost" icon="plus" onClick=${() => set('gstSlabs')([{ upTo: '', rate: 5 }, ...slabs])}>Add slab<//>
            <p class="muted small">Default follows GST rates effective 22 Sep 2025: 5% (without input tax credit) when the room value is ₹7,500 or less per night, 18% above. Leave “up to” empty for the top slab.
              <button type="button" class="link-btn" onClick=${() => setD((cur) => Object.assign({}, cur, { gstSlabs: App.Store.DEFAULT_SETTINGS.gstSlabs }))}>Restore defaults</button></p>
          </div>
          <div class="grid-2"><${Field} label="SAC code for rooms"><${Input} value=${d.sacCode} onChange=${set('sacCode')} /><//></div>`}
      </div>

      <div class="card settings-card">
        <h3 class="sub-title">Extra charge categories</h3>
        <div class="cat-table">
          <div class="cat-head"><span>Category</span>${d.gstEnabled && html`<span>GST</span><span>SAC</span>`}<span></span></div>
          ${cats.map((c, i) => html`<div class="cat-row">
            <input class="input" value=${c.name} onInput=${(e) => setCat(i, 'name', e.currentTarget.value)} aria-label="Category name" />
            ${d.gstEnabled && html`<${Select} value=${c.gst == null ? '' : String(c.gst)} onChange=${(v) => setCat(i, 'gst', v === '' ? null : +v)}
              options=${[{ value: '', label: 'Same as room' }, ...['0', '5', '12', '18', '28'].map((r) => ({ value: r, label: r + '%' }))]} />
            <input class="input" value=${c.sac || ''} onInput=${(e) => setCat(i, 'sac', e.currentTarget.value)} aria-label="SAC" placeholder="SAC" />`}
            <${Button} variant="ghost" icon="x" aria-label="Remove category" onClick=${() => set('chargeCategories')(cats.filter((_, j) => j !== i))} />
          </div>`)}
          <${Button} size="sm" variant="ghost" icon="plus" onClick=${() => set('chargeCategories')([...cats, { name: '', gst: 18, sac: '' }])}>Add category<//>
        </div>
      </div>
      <${SaveBar} dirty=${dirty} onSave=${save} onReset=${reset} />
    </div>`;
  }

  // ------------------------------------------------------------------ lists
  function ListEditor({ label, hint, value, onChange }) {
    const [txt, setTxt] = useState('');
    const add = () => {
      const v = txt.trim();
      if (v && !value.includes(v)) onChange([...value, v]);
      setTxt('');
    };
    return html`<div class="list-editor">
      <div class="list-editor-head"><strong>${label}</strong>${hint && html`<span class="muted small">${hint}</span>`}</div>
      <div class="chips">${value.map((v) => html`<span class="chip is-on chip-removable">${v}<button type="button" aria-label=${'Remove ' + v} onClick=${() => onChange(value.filter((x) => x !== v))}><${Icon} name="x" size=${12} /></button></span>`)}</div>
      <div class="list-editor-add">
        <input class="input" value=${txt} placeholder="Add new…" onInput=${(e) => setTxt(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <${Button} icon="plus" onClick=${add} disabled=${!txt.trim()}>Add<//>
      </div>
    </div>`;
  }
  function ListsSection() {
    const keys = ['sources', 'paymentModes', 'idTypes', 'purposes', 'expenseCategories'];
    const { d, set, dirty, reset } = useDraft(keys);
    const save = () => {
      if (!d.paymentModes.length) return toast('Keep at least one payment mode', 'error');
      S.saveSettings(d);
      toast('Lists saved');
    };
    return html`<div class="card settings-card stack">
      <${ListEditor} label="Booking sources" hint="Where bookings come from" value=${d.sources} onChange=${set('sources')} />
      <${ListEditor} label="Payment modes" value=${d.paymentModes} onChange=${set('paymentModes')} />
      <${ListEditor} label="ID proof types" value=${d.idTypes} onChange=${set('idTypes')} />
      <${ListEditor} label="Purpose of visit" value=${d.purposes} onChange=${set('purposes')} />
      <${ListEditor} label="Expense categories" value=${d.expenseCategories} onChange=${set('expenseCategories')} />
      <${SaveBar} dirty=${dirty} onSave=${save} onReset=${reset} />
    </div>`;
  }

  // ------------------------------------------------------------------ invoice & numbering
  function InvoiceSection() {
    const { d, set, dirty, reset } = useDraft(['bookingPrefix', 'invoicePrefix', 'invoiceTerms', 'invoiceFooter']);
    const fy = U.fy();
    const [lastInv, setLastInv] = useState(null);
    const [lastBk, setLastBk] = useState(null);
    useEffect(() => {
      S.peekSeq('invoice:' + fy, 0).then(setLastInv).catch(() => setLastInv('?'));
      S.peekSeq('booking', 1000).then(setLastBk).catch(() => setLastBk('?'));
    }, []);
    const sample = [d.invoicePrefix, U.fyShort(), String((+lastInv || 0) + 1).padStart(4, '0')].filter(Boolean).join('/');
    async function setNext(kind) {
      const cur = kind === 'invoice' ? lastInv : lastBk;
      const v = window.prompt(kind === 'invoice' ? `Next invoice number for FY ${fy}` : 'Next booking number', String((+cur || 0) + 1));
      if (v == null) return;
      const n = parseInt(v, 10);
      if (!(n >= 1)) return toast('Enter a number', 'error');
      await attempt(() => S.setSeq(kind === 'invoice' ? 'invoice:' + fy : 'booking', n - 1), 'Numbering updated');
      // re-read: numbers already used by existing bookings/invoices are never reused
      S.peekSeq('invoice:' + fy, 0).then(setLastInv).catch(() => {});
      S.peekSeq('booking', 1000).then(setLastBk).catch(() => {});
    }
    const save = () => {
      if (sample.length > 16) return toast('Invoice numbers must be 16 characters or fewer for GST. Use a shorter prefix.', 'error');
      S.saveSettings(d);
      toast('Invoice settings saved');
    };
    return html`<div class="card settings-card">
      <div class="grid-2">
        <${Field} label="Booking number prefix" hint=${`Next booking: ${d.bookingPrefix}${lastBk == null ? '…' : (+lastBk || 1000) + 1}`}><${Input} value=${d.bookingPrefix} onChange=${set('bookingPrefix')} /><//>
        <${Field} label="Invoice number prefix" hint=${`Next invoice: ${sample} (restarts every April)`}><${Input} value=${d.invoicePrefix} maxlength="6" onChange=${(v) => set('invoicePrefix')(v.replace(/[^A-Za-z0-9-]/g, '').toUpperCase())} /><//>
      </div>
      ${S.can('settings') && html`<div class="btn-row">
        <${Button} size="sm" icon="edit" onClick=${() => setNext('invoice')}>Set next invoice number<//>
        <${Button} size="sm" icon="edit" onClick=${() => setNext('booking')}>Set next booking number<//>
      </div>`}
      <${Field} label="Terms printed on invoice"><${Textarea} rows=${3} value=${d.invoiceTerms} onChange=${set('invoiceTerms')} /><//>
      <${Field} label="Thank-you line"><${Input} value=${d.invoiceFooter} onChange=${set('invoiceFooter')} /><//>
      <${SaveBar} dirty=${dirty} onSave=${save} onReset=${reset} />
    </div>`;
  }

  // ------------------------------------------------------------------ users
  function UsersSection() {
    const server = S.mode === 'server';
    const [users, setUsers] = useState(null);
    const load = () => App.Sync.users().then(setUsers).catch((e) => toast(e.message, 'error'));
    useEffect(() => { if (server && S.can('users')) load(); }, []);
    if (!server) {
      return html`<div class="card settings-card">
        <div class="info-block"><${Icon} name="info" size=${20} />
          <div><strong>This device is working on its own (local mode).</strong>
            <p>Data is saved in this browser only, so there are no user accounts. To share one live database between the front-desk PC, the owner's phone and staff tablets, run the included hotel server on a computer at the hotel (or a small cloud server). Everyone then signs in with their own username. See <em>README → Multi-device setup</em>.</p></div></div>
        <${App.LockSettings} />
      </div>`;
    }
    return html`<div class="stack">
      <div class="card settings-card">
        <${KV} items=${[['Signed in as', `${S.user.name} (${S.user.username || ''})`], ['Role', U.titleCase(S.user.role)]]} />
        <div class="btn-row"><${Button} icon="key" onClick=${() => App.openModal(PasswordForm, {})}>Change my password<//>
          <${Button} icon="logout" onClick=${App.logout}>Sign out<//></div>
        <${App.LockSettings} />
      </div>
      ${S.can('users') && html`<${Card} title="Staff accounts" icon="guests" pad=${false}
          actions=${html`<${Button} size="sm" variant="primary" icon="userPlus" onClick=${() => App.openModal(UserForm, { onSaved: load })}>Add user<//>`}>
        ${users == null ? html`<div class="card-empty">Loading…</div>` : users.map((u) => html`<button type="button" class="setting-row" onClick=${() => App.openModal(UserForm, { user: u, onSaved: load })}>
            <${App.Avatar} name=${u.name} size=${36} />
            <div class="grow"><div class="fw-600">${u.name} ${u.id === S.user.id && html`<${Badge} tone="info">You<//>`}</div><div class="muted small">${u.username}${u.lastSeen ? ' · last active ' + U.timeAgo(u.lastSeen) : ''}</div></div>
            <${Badge} tone=${u.active === false ? 'muted' : u.role === 'admin' ? 'brand' : u.role === 'manager' ? 'violet' : 'info'}>${u.active === false ? 'Disabled' : U.titleCase(u.role)}<//>
          </button>`)}
        <div class="card-foot muted small">Admin: everything · Manager: reports, rates, deleting · Staff: front desk & housekeeping only</div>
      <//>`}
    </div>`;
  }
  function UserForm({ close, user, onSaved }) {
    const [u, setU] = useState(() => Object.assign({ name: '', username: '', role: 'staff', active: true, password: '' }, user || {}, { password: '' }));
    const set = (k) => (v) => setU(Object.assign({}, u, { [k]: v }));
    const [busy, setBusy] = useState(false);
    async function save() {
      if (!u.name.trim() || !u.username.trim()) return toast('Name and username are required', 'error');
      if (!user && u.password.length < 6) return toast('Password must be at least 6 characters', 'error');
      if (u.password && u.password.length < 6) return toast('Password must be at least 6 characters', 'error');
      setBusy(true);
      const ok = await attempt(() => App.Sync.saveUser(u), 'User saved');
      setBusy(false);
      if (ok) { onSaved && onSaved(); close(true); }
    }
    async function remove() {
      if (!(await confirm({ title: `Delete ${user.name}?`, message: 'They will no longer be able to sign in.', confirmText: 'Delete', danger: true }))) return;
      if (await attempt(() => App.Sync.deleteUser(user.id), 'User deleted')) { onSaved && onSaved(); close(true); }
    }
    return html`<${Modal} title=${user ? 'Edit user' : 'Add user'} icon="userPlus" size="sm" onClose=${() => close()}
        footer=${html`${user && user.id !== S.user.id && html`<${Button} variant="ghost" icon="trash" onClick=${remove} aria-label="Delete user" />`}
          <${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" icon="check" loading=${busy} onClick=${save}>Save<//>`}>
      <${Field} label="Full name" required><${Input} value=${u.name} onChange=${set('name')} data-autofocus /><//>
      <${Field} label="Username" required hint="Used to sign in"><${Input} value=${u.username} autocapitalize="none" autocomplete="off" onChange=${(v) => set('username')(v.toLowerCase().replace(/\s+/g, ''))} /><//>
      <${Field} as="div" label="Role"><${Segmented} full value=${u.role} onChange=${set('role')} options=${[{ value: 'staff', label: 'Staff' }, { value: 'manager', label: 'Manager' }, { value: 'admin', label: 'Admin' }]} /><//>
      <${Field} label=${user ? 'New password (leave empty to keep)' : 'Password'} required=${!user}><${Input} type="password" autocomplete="new-password" value=${u.password} onChange=${set('password')} /><//>
      ${user && user.id !== S.user.id && html`<${Toggle} label="Account active" checked=${u.active !== false} onChange=${set('active')} />`}
    <//>`;
  }
  function PasswordForm({ close }) {
    const [cur, setCur] = useState('');
    const [next, setNext] = useState('');
    const [again, setAgain] = useState('');
    async function save() {
      if (next.length < 6) return toast('New password must be at least 6 characters', 'error');
      if (next !== again) return toast('Passwords do not match', 'error');
      if (await attempt(() => App.Sync.changePassword(cur, next), 'Password changed')) close(true);
    }
    return html`<${Modal} title="Change password" icon="key" size="sm" onClose=${() => close()}
        footer=${html`<${Button} onClick=${() => close()}>Cancel<//><${Button} variant="primary" onClick=${save}>Change password<//>`}>
      <${Field} label="Current password"><${Input} type="password" autocomplete="current-password" value=${cur} onChange=${setCur} data-autofocus /><//>
      <${Field} label="New password"><${Input} type="password" autocomplete="new-password" value=${next} onChange=${setNext} /><//>
      <${Field} label="Repeat new password"><${Input} type="password" autocomplete="new-password" value=${again} onChange=${setAgain} /><//>
    <//>`;
  }

  // ------------------------------------------------------------------ data
  function DataSection() {
    App.useStore();
    const [info, setInfo] = useState(null);
    const [persisted, setPersisted] = useState(null);
    useEffect(() => {
      S.persist && S.persist.estimate().then(setInfo);
      if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(setPersisted).catch(() => {});
    }, []);
    const last = App.Meta.get('lastBackup', 0);
    const counts = Object.fromEntries(['rooms', 'guests', 'bookings', 'expenses'].map((c) => [c, S.all(c).length]));

    async function restore(e) {
      const f = e.currentTarget.files && e.currentTarget.files[0];
      e.currentTarget.value = '';
      if (!f) return;
      let data;
      try {
        data = JSON.parse(await U.readText(f));
      } catch (err) {
        return toast('This file is not a valid backup', 'error');
      }
      if (!data || data.app !== 'tpt-balaji-delux' || !data.data) return toast('This file is not a TPT Balaji Delux backup', 'error');
      const n = (data.data.bookings || []).length;
      const ok = await confirm({
        title: 'Restore this backup?', danger: true, confirmText: 'Restore', requireText: 'RESTORE',
        message: html`Backup from <strong>${U.fmtDateTimeFull(data.exportedAt)}</strong> with ${U.plural(n, 'booking')} and ${U.plural((data.data.guests || []).length, 'guest')}. <strong>All current data${S.mode === 'server' ? ' on the server (for every device)' : ' on this device'} will be replaced.</strong>`,
      });
      if (!ok) return;
      if (await attempt(() => S.replaceAll(data.data, { push: true }), 'Backup restored')) App.navigate('#/dashboard');
    }
    async function fresh() {
      const choice = await App.chooseAction('Start fresh', [
        { value: 'keep', label: 'Keep rooms & tariffs', icon: 'rooms', hint: 'Delete guests, bookings, invoices and expenses' },
        { value: 'all', label: 'Delete everything', icon: 'trash', danger: true, hint: 'Also removes room types and rooms' },
      ]);
      if (!choice) return;
      const ok = await confirm({
        title: 'Delete data?', danger: true, confirmText: 'Delete', requireText: 'DELETE',
        message: html`This removes ${choice === 'all' ? 'all data' : 'all guests, bookings, invoices and expenses'}${S.mode === 'server' ? ' for every device' : ''}. Download a backup first if you might need it.`,
      });
      if (!ok) return;
      if (await attempt(() => App.Demo.startFresh({ keepRooms: choice === 'keep' }), 'Done — ready for your first booking')) App.navigate(choice === 'all' ? '#/settings?tab=rooms' : '#/dashboard');
    }
    async function demo() {
      const ok = await confirm({ title: 'Load demo data?', danger: true, confirmText: 'Load demo', requireText: S.all('bookings').length && !S.settings().demo ? 'DEMO' : null,
        message: 'All current data will be replaced with a sample month of bookings for a 20-room hotel.' });
      if (ok && (await attempt(() => App.Demo.loadDemo(), 'Demo data loaded'))) App.navigate('#/dashboard');
    }
    async function askPersist() {
      try {
        const r = await navigator.storage.persist();
        setPersisted(r);
        toast(r ? 'Storage protected on this device' : 'The browser did not allow it. Installing the app usually helps.', r ? 'success' : 'info');
      } catch (e) {
        toast('Not supported in this browser', 'error');
      }
    }
    function exportBookings() {
      const rows = U.sortBy(S.all('bookings'), (b) => b.checkIn, -1);
      U.download(`bookings-${U.today()}.csv`, U.toCSV(rows, [
        { label: 'Booking', value: (b) => b.code }, { label: 'Status', value: (b) => (L.BOOKING_STATUS[b.status] || {}).label || b.status },
        { label: 'Guest', value: (b) => L.guestName(b) }, { label: 'Phone', value: (b) => (L.guestOf(b) || {}).phone },
        { label: 'Rooms', value: (b) => L.roomNumbers(b) }, { label: 'Check-in', value: (b) => b.checkIn.replace('T', ' ') }, { label: 'Check-out', value: (b) => b.checkOut.replace('T', ' ') },
        { label: 'Nights', value: (b) => b.billedNights || b.nights }, { label: 'Adults', value: (b) => b.adults }, { label: 'Children', value: (b) => b.children },
        { label: 'Source', value: (b) => b.source }, { label: 'Total', value: (b) => L.totals(b).total }, { label: 'Paid', value: (b) => L.totals(b).paid },
        { label: 'Balance', value: (b) => L.totals(b).balance }, { label: 'Invoice', value: (b) => b.invoiceNo || '' },
      ]), 'text/csv;charset=utf-8');
    }
    return html`<div class="stack">
      <div class="card settings-card">
        <h3 class="sub-title">Backup</h3>
        <p class="muted">${S.mode === 'server' ? 'The hotel server also keeps automatic daily backups in its data folder.' : 'Your data lives in this browser on this device. Download a backup regularly and keep it on Google Drive, WhatsApp or a pen drive.'}</p>
        <${KV} items=${[['Last backup from this device', last ? U.fmtDateTimeFull(last) : 'Never'], ['Contents', `${counts.rooms} rooms · ${U.num(counts.guests)} guests · ${U.num(counts.bookings)} bookings · ${U.num(counts.expenses)} expenses`]]} />
        <div class="btn-row">
          <${Button} variant="primary" icon="download" onClick=${App.downloadBackup}>Download backup<//>
          <label class="btn btn-secondary"><${Icon} name="upload" size=${18} /><span class="btn-text">Restore from file</span><input type="file" accept="application/json,.json" hidden onChange=${restore} /></label>
          <${Button} icon="fileText" onClick=${exportBookings}>Bookings CSV<//>
        </div>
      </div>
      <div class="card settings-card">
        <h3 class="sub-title">Storage</h3>
        <${KV} items=${[
          ['Mode', S.mode === 'server' ? 'Shared hotel server (multi-device)' : 'This device only (local mode)'],
          ['Saved in', S.persist ? S.persist.kind : '—'],
          info && ['Space used', `${(info.usage / 1048576).toFixed(1)} MB of ${info.quota > 1e10 ? 'plenty' : (info.quota / 1048576).toFixed(0) + ' MB'}`],
          ['Protected from clean-up', persisted == null ? 'Unknown' : persisted ? 'Yes' : 'No'],
        ]} />
        ${persisted === false && navigator.storage && navigator.storage.persist && html`<div class="btn-row"><${Button} icon="shield" onClick=${askPersist}>Protect storage<//></div>`}
      </div>
      <div class="card settings-card danger-zone">
        <h3 class="sub-title">Start over</h3>
        <div class="btn-row">
          <${Button} variant="danger" icon="trash" onClick=${fresh}>Start fresh…<//>
          <${Button} icon="sparkles" onClick=${demo}>Load demo data<//>
        </div>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ appearance & app
  function DeviceSection() {
    const [theme, setTheme] = App.usePref('theme', 'system');
    const install = App.useInstall();
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    useEffect(() => App.applyTheme(theme), [theme]);
    return html`<div class="stack">
      <div class="card settings-card">
        <h3 class="sub-title">Theme</h3>
        <${Segmented} full value=${theme} onChange=${setTheme} options=${[{ value: 'system', label: 'Auto', icon: 'monitor' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }]} />
        <p class="muted small">Saved on this device only.</p>
      </div>
      <div class="card settings-card">
        <h3 class="sub-title">Install as an app</h3>
        ${install.installed ? html`<div class="info-block ok"><${Icon} name="checkCircle" size=${20} /><div>Running as an installed app. It opens full-screen and works offline.</div></div>`
          : install.canPrompt ? html`<p>Add TPT Balaji Delux to this device's home screen / desktop. It opens like a normal app and works offline.</p>
            <${Button} variant="primary" icon="download" onClick=${install.prompt}>Install app<//>`
          : html`<div class="install-steps">
            <div class=${U.cls('install-step', ios && 'is-current')}><${Icon} name="smartphone" size=${20} /><div><strong>iPhone / iPad (Safari)</strong><span>Tap the Share button, then “Add to Home Screen”.</span></div></div>
            <div class="install-step"><${Icon} name="smartphone" size=${20} /><div><strong>Android (Chrome)</strong><span>Tap ⋮ menu → “Install app” or “Add to Home screen”.</span></div></div>
            <div class="install-step"><${Icon} name="laptop" size=${20} /><div><strong>Windows / Mac (Chrome or Edge)</strong><span>Click the install icon at the right end of the address bar.</span></div></div>
          </div>`}
      </div>
      <div class="card settings-card">
        <h3 class="sub-title">About</h3>
        <${KV} items=${[['App', 'TPT Balaji Delux Hotel Manager'], ['Version', App.VERSION], ['Mode', S.mode === 'server' ? 'Hotel server' : 'Local (this device)'], ['Works offline', 'Yes']]} />
        <div class="btn-row"><${Button} icon="keyboard" onClick=${App.showShortcuts} class="hide-xs">Keyboard shortcuts<//><${Button} icon="refresh" onClick=${() => location.reload()}>Reload app<//></div>
      </div>
    </div>`;
  }

  const SECTION_VIEWS = { hotel: HotelSection, rooms: RoomsSection, policy: PolicySection, lists: ListsSection, invoice: InvoiceSection, users: UsersSection, data: DataSection, device: DeviceSection };

  App.downloadBackup = function () {
    const snap = S.snapshot();
    U.download(`tpt-balaji-delux-backup-${U.today()}.json`, JSON.stringify(snap), 'application/json');
    App.Meta.set('lastBackup', Date.now());
    toast('Backup downloaded');
    if (App.refresh) App.refresh(); // hide the backup reminder
  };
  App.views = App.views || {};
  App.views.settings = SettingsPage;
})(window.App = window.App || {});
