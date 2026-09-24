/*
 * First-run welcome & setup wizard, server sign-in screen and the device PIN lock.
 */
(function (App) {
  'use strict';
  const { html, useState, useEffect, useRef, U, L, Icon, Button, Field, Input, MoneyInput, Toggle, Segmented, toast, attempt } = App;
  const S = App.Store;

  function AuthShell({ children, wide }) {
    return html`<div class="auth-screen">
      <div class=${U.cls('auth-card', wide && 'is-wide')}>
        <div class="auth-brand"><${App.LogoMark} size=${56} /><div><div class="auth-name">${S.settings().hotelName || 'TPT Balaji Delux'}</div><div class="muted">Hotel management</div></div></div>
        ${children}
      </div>
      <div class="auth-foot muted small">Works on phones, tablets, laptops & desktops · Works offline</div>
    </div>`;
  }

  // ------------------------------------------------------------------ welcome
  function Welcome() {
    const [step, setStep] = useState('choose');
    const [busy, setBusy] = useState(false);
    const server = S.mode === 'server';
    if (server && !S.can('settings')) {
      return html`<${AuthShell}><div class="empty"><div class="empty-icon"><${Icon} name="clock" size=${28} /></div>
        <div class="empty-title">Waiting for setup</div><div class="empty-text">The hotel admin hasn't added rooms yet. Please check back soon.</div>
        <${Button} icon="logout" onClick=${App.logout}>Sign out<//></div><//>`;
    }
    if (step === 'setup') return html`<${Setup} onBack=${() => setStep('choose')} />`;
    async function demo() {
      setBusy(true);
      await attempt(() => App.Demo.loadDemo());
      setBusy(false);
      location.hash = '#/dashboard';
    }
    return html`<${AuthShell} wide>
      <h1 class="welcome-title">Welcome! Let's get your front desk ready.</h1>
      <p class="muted">Rooms, bookings, check-in/out, GST invoices, housekeeping and reports — in one app for every device.</p>
      <div class="welcome-options">
        <button type="button" class="welcome-option" onClick=${() => setStep('setup')}>
          <span class="wo-icon"><${Icon} name="hotel" size=${26} /></span>
          <span class="wo-text"><strong>Set up my hotel</strong><span>Enter your hotel details, rooms and tariffs. Takes about 2 minutes.</span></span>
          <${Icon} name="chevronRight" size=${20} />
        </button>
        <button type="button" class="welcome-option" onClick=${demo} disabled=${busy}>
          <span class="wo-icon alt"><${Icon} name="sparkles" size=${26} /></span>
          <span class="wo-text"><strong>${busy ? 'Loading demo…' : 'Explore with demo data'}</strong><span>A busy month at a 20-room Tirupati hotel. Clear it any time from Settings.</span></span>
          <${Icon} name="chevronRight" size=${20} />
        </button>
      </div>
      <ul class="welcome-points">
        <li><${Icon} name="key" size=${18} /> Walk-in check-in in under a minute</li>
        <li><${Icon} name="invoice" size=${18} /> GST invoices (5% / 18% slabs) with print & WhatsApp</li>
        <li><${Icon} name="calendar" size=${18} /> Live room board & reservation calendar</li>
        <li><${Icon} name=${server ? 'cloud' : 'shield'} size=${18} /> ${server ? 'Shared live between all your devices' : 'Private: data stays on this device'}</li>
      </ul>
    <//>`;
  }

  // ------------------------------------------------------------------ setup wizard
  function Setup({ onBack }) {
    const [step, setStep] = useState(1);
    const [hotel, setHotel] = useState(() => {
      const s = S.settings();
      return { hotelName: s.hotelName, phone: s.phone, address: s.address, gstEnabled: s.gstEnabled, gstin: s.gstin, checkoutMode: s.checkoutMode };
    });
    const [types, setTypes] = useState(() => App.Demo.SAMPLE_TYPES.map((t, i) => ({
      key: t.key, name: t.name, rate: String(t.rate), extraBedRate: t.extraBedRate, maxAdults: t.maxAdults, amenities: t.amenities,
      rooms: ['101-106', '201-206', '301-305', '401-403'][i],
    })));
    const [busy, setBusy] = useState(false);
    const setH = (k) => (v) => setHotel(Object.assign({}, hotel, { [k]: v }));
    const setT = (i, k, v) => setTypes(types.map((t, j) => (j === i ? Object.assign({}, t, { [k]: v }) : t)));
    const parsed = types.map((t) => App.parseRoomList(t.rooms));
    const all = parsed.flat();
    const dupes = all.filter((n, i) => all.indexOf(n) !== i);

    async function finish() {
      if (!hotel.hotelName.trim()) return toast('Enter the hotel name', 'error');
      const valid = types.filter((t, i) => t.name.trim() && parsed[i].length);
      if (!valid.length) return toast('Add at least one room', 'error');
      if (dupes.length) return toast(`Room ${dupes[0]} is listed twice`, 'error');
      setBusy(true);
      const roomTypes = [];
      const rooms = [];
      types.forEach((t, i) => {
        if (!t.name.trim() || !parsed[i].length) return;
        const id = U.uid('rt');
        roomTypes.push({ id, name: t.name.trim(), rate: +t.rate || 0, extraBedRate: +t.extraBedRate || 0, maxAdults: +t.maxAdults || 2, amenities: t.amenities || [], description: '' });
        parsed[i].forEach((n) => rooms.push({ id: U.uid('rm'), number: n, floor: App.guessFloor(n), typeId: id, active: true, notes: '' }));
      });
      const main = Object.assign({}, S.DEFAULT_SETTINGS, { id: 'main', demo: false }, {
        hotelName: hotel.hotelName.trim(), phone: hotel.phone.trim(), address: hotel.address.trim(),
        gstEnabled: !!hotel.gstEnabled, gstin: hotel.gstEnabled ? (hotel.gstin || '').trim().toUpperCase() : '', checkoutMode: hotel.checkoutMode,
      });
      const ok = await attempt(() => S.replaceAll({ settings: [main], roomTypes, rooms, housekeeping: [], guests: [], bookings: [], expenses: [] }, { push: true }));
      setBusy(false);
      if (ok !== undefined) {
        toast(`All set! ${U.plural(rooms.length, 'room')} added.`);
        location.hash = '#/dashboard';
      }
    }

    return html`<${AuthShell} wide>
      <div class="wizard-steps"><span class=${step === 1 ? 'is-on' : 'is-done'}>1 · Hotel</span><span class=${step === 2 ? 'is-on' : ''}>2 · Rooms & tariffs</span></div>
      ${step === 1 ? html`<div class="stack">
        <${Field} label="Hotel name" required><${Input} value=${hotel.hotelName} onChange=${setH('hotelName')} data-autofocus /><//>
        <div class="grid-2">
          <${Field} label="Phone"><${Input} type="tel" value=${hotel.phone} onChange=${setH('phone')} placeholder="Front desk number" /><//>
          <${Field} label="Address"><${Input} value=${hotel.address} onChange=${setH('address')} /><//>
        </div>
        <${Field} as="div" label="Check-out policy"><${Segmented} full value=${hotel.checkoutMode} onChange=${setH('checkoutMode')}
          options=${[{ value: '24h', label: '24 hours from check-in' }, { value: 'fixed', label: 'Fixed time (e.g. 11 am)' }]} /><//>
        <${Toggle} label="Registered under GST" hint="Adds GSTIN, CGST & SGST to invoices (5% up to ₹7,500/night, 18% above)" checked=${hotel.gstEnabled} onChange=${setH('gstEnabled')} />
        ${hotel.gstEnabled && html`<${Field} label="GSTIN" hint="You can add this later in Settings"><${Input} value=${hotel.gstin} maxlength="15" onChange=${(v) => setH('gstin')(v.toUpperCase())} /><//>`}
        <div class="wizard-actions"><${Button} onClick=${onBack} icon="chevronLeft">Back<//><${Button} variant="primary" iconRight="chevronRight" onClick=${() => setStep(2)}>Next: rooms<//></div>
      </div>` : html`<div class="stack">
        <p class="muted">Edit the room types and tariffs to match your hotel. Enter room numbers as ranges (101-106) or lists (101, 102, 105). Leave numbers empty to skip a type.</p>
        ${types.map((t, i) => html`<div class="setup-type">
          <div class="grid-3">
            <${Field} label="Room type"><${Input} value=${t.name} onChange=${(v) => setT(i, 'name', v)} /><//>
            <${Field} label="Tariff / night"><${MoneyInput} value=${t.rate} onChange=${(v) => setT(i, 'rate', v)} /><//>
            <${Field} label="Room numbers" hint=${parsed[i].length ? U.plural(parsed[i].length, 'room') : 'No rooms'}><${Input} value=${t.rooms} onChange=${(v) => setT(i, 'rooms', v)} placeholder="e.g. 101-106" /><//>
          </div>
          <button type="button" class="icon-btn setup-remove" aria-label="Remove type" onClick=${() => setTypes(types.filter((_, j) => j !== i))}><${Icon} name="x" size=${16} /></button>
        </div>`)}
        <${Button} size="sm" variant="ghost" icon="plus" onClick=${() => setTypes([...types, { key: U.uid(), name: '', rate: '', extraBedRate: 0, maxAdults: 2, amenities: [], rooms: '' }])}>Add room type<//>
        <div class=${U.cls('setup-total', dupes.length && 'text-danger')}>${dupes.length ? `Room ${dupes[0]} is listed twice` : `${U.plural(all.length, 'room')} in ${U.plural(types.filter((t, i) => parsed[i].length).length, 'type')}`}</div>
        <div class="wizard-actions"><${Button} onClick=${() => setStep(1)} icon="chevronLeft">Back<//><${Button} variant="primary" icon="check" loading=${busy} onClick=${finish}>Finish setup<//></div>
      </div>`}
    <//>`;
  }

  // ------------------------------------------------------------------ server sign-in
  function Login({ onDone, message }) {
    const [username, setUsername] = useState(App.Meta.get('lastUsername', ''));
    const [password, setPassword] = useState('');
    const [err, setErr] = useState(message || '');
    const [busy, setBusy] = useState(false);
    const [show, setShow] = useState(false);
    async function submit(e) {
      e.preventDefault();
      if (!username.trim() || !password) return setErr('Enter your username and password');
      setBusy(true);
      setErr('');
      try {
        const user = await App.Sync.login(username.trim().toLowerCase(), password);
        App.Meta.set('lastUsername', username.trim().toLowerCase());
        onDone(user);
      } catch (ex) {
        setErr(ex.status === 401 ? 'Wrong username or password' : ex.status === 429 ? ex.message : !ex.status ? 'Cannot reach the hotel server. Check the network and try again.' : ex.message);
      } finally {
        setBusy(false);
      }
    }
    return html`<${AuthShell}>
      <form class="stack" onSubmit=${submit}>
        <h1 class="welcome-title">Sign in</h1>
        ${err && html`<div class="alert alert-danger"><${Icon} name="alert" size=${18} /> ${err}</div>`}
        <${Field} label="Username"><input class="input" autocomplete="username" autocapitalize="none" value=${username} onInput=${(e) => setUsername(e.currentTarget.value)} autofocus /><//>
        <${Field} label="Password">
          <div class="input-affix right">
            <input class="input" type=${show ? 'text' : 'password'} autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} />
            <button type="button" class="affix-btn" aria-label=${show ? 'Hide password' : 'Show password'} onClick=${() => setShow(!show)}><${Icon} name=${show ? 'eyeOff' : 'eye'} size=${18} /></button>
          </div>
        <//>
        <${Button} type="submit" variant="primary" block loading=${busy} icon="login">Sign in<//>
        <p class="muted small center"><${Icon} name="cloud" size=${14} /> Connected to the hotel server at ${location.host}</p>
      </form>
    <//>`;
  }

  // ------------------------------------------------------------------ PIN lock (per device)
  function hashPin(pin) {
    // Convenience lock only (the data itself is on the device). FNV-1a over a salted string.
    let h = 0x811c9dc5;
    const str = 'tbd-pin:' + pin + ':' + location.host;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }
  const lockState = { locked: !!App.Meta.get('pin', null), listeners: new Set(), last: Date.now() };
  function setLocked(v) {
    lockState.locked = v;
    lockState.listeners.forEach((f) => f());
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => (lockState.last = Date.now()), { passive: true }));
  setInterval(() => {
    const pin = App.Meta.get('pin', null);
    const after = +App.Meta.get('lockAfter', 15);
    if (pin && after > 0 && !lockState.locked && Date.now() - lockState.last > after * 60000) setLocked(true);
  }, 20000);
  App.useLock = () => {
    const [, force] = useState(0);
    useEffect(() => {
      const f = () => force((x) => x + 1);
      lockState.listeners.add(f);
      return () => lockState.listeners.delete(f);
    }, []);
    return lockState.locked && !!App.Meta.get('pin', null);
  };
  App.lockNow = () => App.Meta.get('pin', null) && setLocked(true);

  function LockScreen() {
    const [pin, setPin] = useState('');
    const [err, setErr] = useState(false);
    const press = (d) => {
      const next = (pin + d).slice(0, 8);
      setPin(next);
      setErr(false);
      if (next.length >= 4 && hashPin(next) === App.Meta.get('pin', null)) {
        lockState.last = Date.now();
        setLocked(false);
      } else if (next.length >= 8) {
        setErr(true);
        setPin('');
      }
    };
    useEffect(() => {
      const onKey = (e) => {
        if (/^\d$/.test(e.key)) press(e.key);
        if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    });
    return html`<div class="lock-screen" role="dialog" aria-modal="true" aria-label="Enter PIN">
      <div class="lock-box">
        <${App.LogoMark} size=${56} />
        <div class="lock-title">Enter PIN to unlock</div>
        <div class=${U.cls('pin-dots', err && 'is-error')}>${[0, 1, 2, 3, 4, 5].map((i) => html`<i class=${i < pin.length ? 'on' : ''}></i>`).slice(0, Math.max(4, pin.length))}</div>
        ${err && html`<div class="text-danger small">Wrong PIN</div>`}
        <div class="pin-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d) => d === '' ? html`<span></span>`
          : html`<button type="button" class="pin-key" onClick=${() => (d === '⌫' ? setPin(pin.slice(0, -1)) : press(d))} aria-label=${d === '⌫' ? 'Delete' : d}>${d}</button>`)}</div>
        <div class="muted small">Forgot the PIN? ${S.mode === 'server' ? html`<button type="button" class="link-btn" onClick=${() => { App.Meta.set('pin'); setLocked(false); App.logout(); }}>Sign out</button>` : 'Clear this site’s data in the browser settings (you will need your backup).'}</div>
      </div>
    </div>`;
  }

  function LockSettings() {
    const [has, setHas] = useState(!!App.Meta.get('pin', null));
    const [after, setAfter] = useState(String(App.Meta.get('lockAfter', 15)));
    function setPinFlow() {
      const a = window.prompt('Choose a 4–8 digit PIN for this device');
      if (a == null) return;
      if (!/^\d{4,8}$/.test(a)) return toast('PIN must be 4 to 8 digits', 'error');
      const b = window.prompt('Enter the PIN again');
      if (a !== b) return toast('PINs did not match', 'error');
      App.Meta.set('pin', hashPin(a));
      setHas(true);
      toast('PIN lock turned on');
    }
    return html`<div class="lock-settings">
      <h3 class="sub-title">PIN lock for this device</h3>
      <p class="muted small">Stops others at the counter from opening the app. Asks for the PIN when the app opens and after it has been idle.</p>
      <div class="btn-row">
        <${Button} icon="lock" onClick=${setPinFlow}>${has ? 'Change PIN' : 'Set a PIN'}<//>
        ${has && html`<${Button} variant="ghost" onClick=${() => { App.Meta.set('pin'); setHas(false); toast('PIN lock turned off'); }}>Turn off<//>`}
        ${has && html`<${Button} variant="ghost" icon="lock" onClick=${App.lockNow}>Lock now<//>`}
      </div>
      ${has && html`<${Field} label="Lock after idle"><${App.Select} value=${after} onChange=${(v) => { setAfter(v); App.Meta.set('lockAfter', +v); }}
        options=${[{ value: '5', label: '5 minutes' }, { value: '15', label: '15 minutes' }, { value: '30', label: '30 minutes' }, { value: '60', label: '1 hour' }, { value: '0', label: 'Only when the app opens' }]} /><//>`}
    </div>`;
  }

  Object.assign(App, { Welcome, Login, LockScreen, LockSettings, AuthShell });
})(window.App = window.App || {});
