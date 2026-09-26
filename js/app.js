/*
 * App shell: responsive navigation (sidebar / icon rail / bottom tabs), top bar,
 * global search, routing, theme, install prompt, service worker and boot.
 */
(function (App) {
  'use strict';
  const { html, h, render, useState, useEffect, useRef, U, L, Icon, Button, Badge, Avatar, Modal, toast } = App;
  const S = App.Store;
  App.VERSION = '1.0.1';

  const NAV = [
    { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: 'dashboard' },
    { id: 'rooms', label: 'Rooms', icon: 'rooms' },
    { id: 'bookings', label: 'Bookings', icon: 'bookings' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar' },
    { id: 'guests', label: 'Guests', icon: 'guests' },
    { id: 'invoices', label: 'Invoices', icon: 'invoice' },
    { id: 'housekeeping', label: 'Housekeeping', short: 'Cleaning', icon: 'housekeeping' },
    { id: 'expenses', label: 'Expenses', icon: 'expenses' },
    { id: 'reports', label: 'Reports', icon: 'reports', perm: 'reports' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];
  const MOBILE_TABS = ['dashboard', 'rooms', 'bookings', 'calendar'];
  const navItems = () => NAV.filter((n) => !n.perm || S.can(n.perm));

  // ------------------------------------------------------------------ routing
  function parseRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const page = (path || 'dashboard').split('/')[0];
    const query = {};
    new URLSearchParams(qs || '').forEach((v, k) => (query[k] = v));
    return { page: App.views[page] ? page : 'dashboard', query, raw };
  }
  function useRoute() {
    const [r, setR] = useState(parseRoute);
    useEffect(() => {
      const on = () => {
        setR(parseRoute());
        const main = document.getElementById('main');
        if (main) main.scrollTop = 0;
        window.scrollTo(0, 0);
      };
      window.addEventListener('hashchange', on);
      return () => window.removeEventListener('hashchange', on);
    }, []);
    return r;
  }

  // ------------------------------------------------------------------ theme
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  App.applyTheme = (pref = App.Meta.get('pref:theme', 'system')) => {
    const dark = pref === 'dark' || (pref !== 'light' && darkMq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute('content', dark ? '#141217' : '#8A1538');
  };
  const onScheme = () => App.applyTheme();
  if (darkMq.addEventListener) darkMq.addEventListener('change', onScheme);
  else darkMq.addListener(onScheme);

  // ------------------------------------------------------------------ install prompt
  let deferredPrompt = null;
  const installListeners = new Set();
  const notifyInstall = () => installListeners.forEach((f) => f());
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstall();
    toast('App installed');
  });
  App.useInstall = () => {
    const [, force] = useState(0);
    useEffect(() => {
      const f = () => force((x) => x + 1);
      installListeners.add(f);
      return () => installListeners.delete(f);
    }, []);
    const installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    return {
      installed,
      canPrompt: !!deferredPrompt && !installed,
      async prompt() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
        deferredPrompt = null;
        notifyInstall();
      },
    };
  };

  // ------------------------------------------------------------------ logo
  App.LogoMark = ({ size = 40 }) => html`<svg class="logo-mark" width=${size} height=${size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="15" fill="#8A1538" />
    <path d="M32 8l3.2 5.6h-6.4z" fill="#F2C14E" />
    <path d="M26.5 15.5h11l1.6 5.5H24.9z" fill="#F2C14E" />
    <path d="M23.5 23h17l1.8 6.2H21.7z" fill="#F2C14E" />
    <path d="M20.5 31.2h23l2 6.8h-27z" fill="#F2C14E" />
    <path d="M16.5 40h31v14h-31z" fill="#F2C14E" />
    <path d="M28 54v-6.5a4 4 0 0 1 8 0V54z" fill="#8A1538" />
  </svg>`;
  function Brand({ compact }) {
    const s = S.settings();
    return html`<div class="brand">
      ${s.logo ? html`<img class="brand-logo" src=${s.logo} alt="" />` : html`<${App.LogoMark} size=${38} />`}
      ${!compact && html`<div class="brand-text"><strong>${s.hotelName}</strong><span>${s.tagline || 'Hotel manager'}</span></div>`}
    </div>`;
  }

  // ------------------------------------------------------------------ badges
  function navBadges() {
    return L.memo('navBadges:' + U.now(), () => {
      const bk = S.all('bookings');
      const due = bk.filter((b) => L.isArrivalDue(b) || L.isDueToday(b)).length;
      const dirty = L.rooms().filter((r) => L.hk(r.id).status === 'dirty' && !L.hk(r.id).oos).length;
      return { bookings: due, housekeeping: dirty };
    });
  }

  // ------------------------------------------------------------------ sync pill
  function useSyncStatus() {
    const [st, setSt] = useState(S.mode === 'server' ? App.Sync.status : 'local');
    useEffect(() => {
      if (S.mode !== 'server') return undefined;
      const off = App.Sync.onStatus(setSt);
      setSt(App.Sync.status); // the first sync may have finished between render and subscribing
      return off;
    }, []);
    return st;
  }
  function SyncPill({ compact }) {
    const st = useSyncStatus();
    App.useStore();
    if (st === 'local') return null;
    const map = {
      online: { tone: 'ok', label: 'Live', icon: 'cloud', title: 'Connected — changes sync instantly to all devices' },
      syncing: { tone: 'info', label: 'Syncing', icon: 'refresh', title: 'Sending changes…' },
      offline: { tone: 'warn', label: 'Offline', icon: 'cloudOff', title: 'No connection — changes are saved on this device and will sync automatically' },
      auth: { tone: 'danger', label: 'Signed out', icon: 'lock', title: 'Please sign in again' },
      idle: { tone: 'muted', label: 'Connecting', icon: 'cloud', title: 'Connecting…' },
    };
    const m = map[st] || map.idle;
    const pending = App.Sync.pendingCount;
    return html`<span class=${U.cls('sync-pill', 'tone-' + m.tone, compact && 'is-compact')} title=${m.title + (pending ? ` · ${pending} pending` : '')}>
      <${Icon} name=${m.icon} size=${14} class=${st === 'syncing' ? 'spin' : ''} />${!compact && html`<span>${m.label}${pending && st !== 'online' ? ` · ${pending}` : ''}</span>`}
    </span>`;
  }

  // ------------------------------------------------------------------ sidebar (tablet rail + desktop)
  function Sidebar({ route, collapsed, onToggle, desktop }) {
    App.useStore();
    const badges = navBadges();
    return html`<aside class="sidebar" aria-label="Main navigation">
      <a class="sidebar-brand" href="#/dashboard" aria-label="Dashboard"><${Brand} compact=${!desktop || collapsed} /></a>
      <nav class="nav">
        ${navItems().map((n) => html`<a href=${'#/' + n.id} class=${U.cls('nav-item', route.page === n.id && 'is-active')} aria-current=${route.page === n.id ? 'page' : undefined} title=${n.label}>
          <span class="nav-icon"><${Icon} name=${n.icon} size=${21} />${badges[n.id] > 0 && html`<span class="nav-badge">${badges[n.id]}</span>`}</span>
          <span class="nav-label">${desktop && !collapsed ? n.label : n.short || n.label}</span>
        </a>`)}
      </nav>
      <div class="sidebar-foot">
        ${desktop && !collapsed && html`<${SyncPill} />`}
        ${desktop && html`<button type="button" class="nav-item collapse-btn" onClick=${onToggle} title=${collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label=${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <span class="nav-icon"><${Icon} name="sidebar" size=${20} /></span>${!collapsed && html`<span class="nav-label">Collapse</span>`}</button>`}
      </div>
    </aside>`;
  }

  // ------------------------------------------------------------------ top bar
  function Topbar({ route, tablet }) {
    App.useStore();
    const item = NAV.find((n) => n.id === route.page) || NAV[0];
    const user = S.user;
    async function userMenu() {
      const install = App.installState();
      const a = await App.chooseAction(S.mode === 'server' ? `${user.name} · ${U.titleCase(user.role)}` : S.settings().hotelName, [
        { value: 'theme', label: 'Appearance & app', icon: 'sun', hint: 'Theme, install on this device' },
        S.can('backup') && { value: 'backup', label: 'Download backup', icon: 'download' },
        App.Meta.get('pin', null) && { value: 'lock', label: 'Lock now', icon: 'lock' },
        install && { value: 'install', label: 'Install app', icon: 'download', hint: 'Open like a normal app, works offline' },
        tablet && { value: 'keys', label: 'Keyboard shortcuts', icon: 'keyboard' },
        S.mode === 'server' && { value: 'logout', label: 'Sign out', icon: 'logout', danger: true },
      ]);
      if (a === 'theme') App.navigate('#/settings?tab=device');
      if (a === 'backup') App.downloadBackup();
      if (a === 'lock') App.lockNow();
      if (a === 'install') App.promptInstall();
      if (a === 'keys') App.showShortcuts();
      if (a === 'logout') App.logout();
    }
    return html`<header class="topbar">
      ${!tablet && html`<a href="#/dashboard" class="topbar-brand" aria-label="Dashboard"><${Brand} compact /></a>`}
      <div class="topbar-title">${tablet ? '' : item.label}</div>
      ${tablet && html`<button type="button" class="topbar-search" onClick=${openSearch}>
        <${Icon} name="search" size=${18} /><span>Search guests, phone, room, booking…</span><kbd>Ctrl K</kbd></button>`}
      <div class="topbar-actions">
        ${!tablet && html`<${Button} variant="ghost" icon="search" aria-label="Search" onClick=${openSearch} />`}
        <${SyncPill} compact=${!tablet} />
        ${tablet && html`<${Button} variant="primary" icon="plus" onClick=${quickAdd}>New<//>`}
        <button type="button" class="user-btn" onClick=${userMenu} aria-label="Account menu">
          <${Avatar} name=${S.mode === 'server' ? user.name : S.settings().hotelName} size=${34} />
        </button>
      </div>
    </header>`;
  }

  // ------------------------------------------------------------------ mobile bottom nav & more
  function BottomNav({ route }) {
    App.useStore();
    const badges = navBadges();
    const tabs = MOBILE_TABS.map((id) => NAV.find((n) => n.id === id));
    const inMore = !MOBILE_TABS.includes(route.page);
    return html`<nav class="bottom-nav" aria-label="Main navigation">
      ${tabs.map((n) => html`<a href=${'#/' + n.id} class=${U.cls('tab', route.page === n.id && 'is-active')} aria-current=${route.page === n.id ? 'page' : undefined}>
        <span class="tab-icon"><${Icon} name=${n.icon} size=${22} />${badges[n.id] > 0 && html`<span class="nav-badge">${badges[n.id]}</span>`}</span><span>${n.short || n.label}</span></a>`)}
      <button type="button" class=${U.cls('tab', inMore && 'is-active')} onClick=${openMore}>
        <span class="tab-icon"><${Icon} name="menu" size=${22} />${badges.housekeeping > 0 && html`<span class="nav-dot"></span>`}</span><span>More</span></button>
    </nav>`;
  }
  async function openMore() {
    const badges = navBadges();
    const items = navItems().filter((n) => !MOBILE_TABS.includes(n.id));
    const a = await App.chooseAction('More', [
      ...items.map((n) => ({ value: '#/' + n.id, label: n.label, icon: n.icon, hint: n.id === 'housekeeping' && badges.housekeeping ? `${U.plural(badges.housekeeping, 'room')} to clean` : undefined })),
      App.installState() && { value: 'install', label: 'Install app on this phone', icon: 'download' },
      S.mode === 'server' && { value: 'logout', label: `Sign out (${S.user.name})`, icon: 'logout', danger: true },
    ]);
    if (!a) return;
    if (a === 'install') return App.promptInstall();
    if (a === 'logout') return App.logout();
    App.navigate(a);
  }
  async function quickAdd() {
    const a = await App.chooseAction('Add new', [
      { value: 'walkin', label: 'Walk-in check-in', icon: 'key', hint: 'Guest is at the desk now' },
      { value: 'reserve', label: 'Advance reservation', icon: 'calendarPlus', hint: 'Book for a future date' },
      { value: 'expense', label: 'Expense', icon: 'expenses' },
      { value: 'guest', label: 'Guest', icon: 'userPlus' },
    ]);
    if (a === 'walkin' || a === 'reserve') App.newBooking({ mode: a });
    if (a === 'expense') App.addExpense();
    if (a === 'guest') App.navigate('#/guests');
  }
  App.quickAdd = quickAdd;

  // ------------------------------------------------------------------ global search
  function SearchModal({ close }) {
    App.useStore();
    const [q, setQ] = useState('');
    const [sel, setSel] = useState(0);
    const inputRef = useRef();
    useEffect(() => { setTimeout(() => inputRef.current && inputRef.current.focus(), 50); }, []);
    const r = L.search(q);
    const items = [
      ...r.bookings.map((b) => ({ key: 'b' + b.id, icon: 'bookings', title: L.guestName(b), sub: `${b.code} · Room ${L.roomNumbers(b)} · ${U.fmtDateShort(b.checkIn)} → ${U.fmtDateShort(b.checkOut)}`, badge: html`<${App.StatusBadge} b=${b} />`, go: () => App.openBooking(b.id) })),
      ...r.guests.map((g) => ({ key: 'g' + g.id, icon: 'user', title: g.name, sub: `${U.phoneDisplay(g.phone)}${g.city ? ' · ' + g.city : ''}`, go: () => App.openGuest(g.id) })),
      ...r.rooms.map((rm) => ({ key: 'r' + rm.id, icon: 'rooms', title: `Room ${rm.number}`, sub: (L.roomType(rm.typeId) || {}).name || '', badge: html`<${Badge} tone=${L.ROOM_STATE[L.roomStatus(rm.id).state].tone}>${L.ROOM_STATE[L.roomStatus(rm.id).state].label}<//>`, go: () => App.openRoom(rm.id) })),
    ];
    const pick = (it) => {
      close();
      setTimeout(it.go, 30);
    };
    const onKey = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(items.length - 1, sel + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(0, sel - 1)); }
      if (e.key === 'Enter' && items[sel]) { e.preventDefault(); pick(items[sel]); }
    };
    return html`<${Modal} title="Search" size="md" kind="dialog" class="search-modal" onClose=${() => close()}>
      <${App.SearchInput} inputRef=${inputRef} value=${q} onChange=${(v) => { setQ(v); setSel(0); }} onKeyDown=${onKey} placeholder="Name, phone, room, booking or invoice no…" />
      <div class="search-results">
        ${!q.trim() ? html`<div class="search-hint muted">Type at least 2 letters or the last digits of a phone number.</div>`
          : !items.length ? html`<div class="search-hint muted">No results for “${q}”.</div>`
          : items.map((it, i) => html`<button type="button" key=${it.key} class=${U.cls('search-item', i === sel && 'is-sel')} onClick=${() => pick(it)} onMouseEnter=${() => setSel(i)}>
              <span class="search-icon-wrap"><${Icon} name=${it.icon} size=${18} /></span>
              <span class="search-text"><strong>${it.title}</strong><span>${it.sub}</span></span>${it.badge}</button>`)}
      </div>
    <//>`;
  }
  function openSearch() {
    App.openModal(SearchModal, {});
  }
  App.openSearch = openSearch;

  function ShortcutsModal({ close }) {
    const rows = [['Ctrl / ⌘ + K', 'Search'], ['/', 'Search'], ['Shift + N', 'Walk-in check-in'], ['Shift + R', 'New reservation'], ['Shift + E', 'Add expense'],
      ['G then D', 'Dashboard'], ['G then R', 'Rooms'], ['G then B', 'Bookings'], ['G then C', 'Calendar'], ['Esc', 'Close window']];
    return html`<${Modal} title="Keyboard shortcuts" icon="keyboard" size="sm" onClose=${() => close()}>
      <div class="kv">${rows.map(([k, v]) => html`<div class="kv-row"><dt><kbd>${k}</kbd></dt><dd>${v}</dd></div>`)}</div>
    <//>`;
  }
  App.showShortcuts = () => App.openModal(ShortcutsModal, {});
  let gPending = 0;
  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (App.ready) openSearch();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !App.ready || document.documentElement.classList.contains('modal-open')) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); }
    else if (e.key === 'N' && e.shiftKey) App.newBooking({ mode: 'walkin' });
    else if (e.key === 'R' && e.shiftKey) App.newBooking({ mode: 'reserve' });
    else if (e.key === 'E' && e.shiftKey) App.addExpense();
    else if (e.key === 'g') gPending = Date.now();
    else if (Date.now() - gPending < 1200) {
      const map = { d: 'dashboard', r: 'rooms', b: 'bookings', c: 'calendar', h: 'housekeeping', i: 'invoices', s: 'settings', e: 'expenses' };
      if (map[e.key]) App.navigate('#/' + map[e.key]);
      gPending = 0;
    }
  });

  App.installState = () => !!deferredPrompt;
  App.promptInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) { /* ignore */ }
      deferredPrompt = null;
      notifyInstall();
    } else App.navigate('#/settings?tab=device');
  };

  // ------------------------------------------------------------------ shell
  function Shell() {
    const route = useRoute();
    const tablet = App.useMedia(App.BP.tablet);
    const desktop = App.useMedia(App.BP.desktop);
    const [collapsed, setCollapsed] = App.usePref('sidebarCollapsed', false);
    const View = App.views[route.page] || App.views.dashboard;
    const showFab = !tablet && ['dashboard', 'rooms', 'bookings', 'calendar', 'guests', 'expenses'].includes(route.page);
    useEffect(() => {
      const item = NAV.find((n) => n.id === route.page);
      document.title = `${item ? item.label + ' · ' : ''}${S.settings().hotelName}`;
    }, [route.page]);
    useEffect(() => {
      // Home-screen shortcuts: #/dashboard?new=walkin | reserve | expense
      const n = route.query.new;
      if (!n) return;
      history.replaceState(history.state, '', '#/' + route.page);
      if (n === 'expense') App.addExpense();
      else App.newBooking({ mode: n === 'reserve' ? 'reserve' : 'walkin' });
    }, [route.raw]);
    return html`<div class=${U.cls('app', tablet && 'has-rail', desktop && !collapsed && 'has-sidebar', desktop && collapsed && 'is-collapsed')}>
      <a class="skip-link" href="#main">Skip to content</a>
      ${tablet && html`<${Sidebar} route=${route} desktop=${desktop} collapsed=${collapsed} onToggle=${() => setCollapsed(!collapsed)} />`}
      <div class="main-col">
        <${Topbar} route=${route} tablet=${tablet} />
        <main class="content" id="main" tabindex="-1"><${View} route=${route} key=${route.page} /></main>
      </div>
      ${!tablet && html`<${BottomNav} route=${route} />`}
      ${showFab && html`<button type="button" class="fab" onClick=${quickAdd} aria-label="Add new"><${Icon} name="plus" size=${26} stroke=${2.5} /></button>`}
    </div>`;
  }

  // ------------------------------------------------------------------ root & auth
  let authed = false;
  let authMessage = '';
  function Splash({ text }) {
    return html`<div class="splash"><${App.LogoMark} size=${64} /><div class="splash-text">${text}</div><div class="spinner lg"></div></div>`;
  }
  function Root() {
    const [, force] = useState(0);
    App.refresh = () => force((x) => x + 1);
    App.useStore();
    const locked = App.useLock();
    const st = useSyncStatus();
    let body;
    if (S.mode === 'server' && !authed) {
      body = html`<${App.Login} message=${authMessage} onDone=${(u) => {
        authed = true;
        authMessage = '';
        App.Meta.set('user', u);
        S.setUser(u);
        App.Sync.start();
        force((x) => x + 1);
      }} />`;
    } else if (S.mode === 'server' && S.isEmpty() && !App.Sync.lastSync) {
      body = html`<${Splash} text=${st === 'offline' ? 'Cannot reach the hotel server. Retrying…' : 'Loading hotel data…'} />`;
    } else if (S.isEmpty()) {
      body = html`<${App.Welcome} />`;
    } else {
      body = html`<${Shell} />`;
    }
    App.ready = S.mode !== 'server' || authed;
    return html`${body}${locked && html`<${App.LockScreen} />`}<${App.ModalHost} /><${App.ToastHost} />`;
  }

  App.onAuthLost = () => {
    authed = false;
    authMessage = Date.now() - (App.Sync.signedInAt || 0) < 60000
      ? 'The password was accepted, but the connection lost the sign-in straight away. Please try again — if it keeps happening, open the app in its own browser tab.'
      : 'Your session has ended. Please sign in again.';
    App.closeAllModals();
    if (App.refresh) App.refresh();
  };
  App.logout = async () => {
    const pending = App.Sync.pendingCount;
    if (pending && !(await App.confirm({ title: 'Changes not synced yet', danger: true, confirmText: 'Sign out anyway',
      message: `${pending} change(s) from this device have not reached the hotel server (no connection). If you sign out now they will be lost.` }))) return;
    await App.Sync.logout();
    App.Sync.resetCursor();
    App.Meta.set('user');
    authed = false;
    authMessage = '';
    App.closeAllModals();
    await S.replaceAll({}); // remove cached hotel data from this device
    if (App.refresh) App.refresh();
  };

  // ------------------------------------------------------------------ service worker
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
    if (/[?&]nosw\b/.test(location.search)) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // Workers from older versions wait for this message; new ones activate by themselves.
      if (reg.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage('skipWaiting');
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) w.postMessage('skipWaiting');
        });
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((e) => console.warn('SW registration failed', e));
    // A new version took over: reload now if nothing is being edited, otherwise as soon as it is safe.
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;
    const busy = () => {
      if (document.querySelector('.modal, [role=dialog]')) return true;
      const el = document.activeElement;
      return !!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value && !el.closest('.login-form'));
    };
    const reloadWhenSafe = () => {
      if (reloading) return;
      if (!busy()) {
        reloading = true;
        location.reload();
        return;
      }
      setTimeout(reloadWhenSafe, 2000);
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // first install: nothing to refresh
      reloadWhenSafe();
    });
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    const root = document.getElementById('app');
    try {
      if (history.state && history.state.tbdModal) history.replaceState(null, '');
      App.applyTheme();
      const wasServer = App.Meta.get('mode') === 'server';
      const server = await App.Sync.detect();
      if (server || (wasServer && location.protocol !== 'file:')) {
        App.Meta.set('mode', 'server');
        App.server = server;
        await S.init({ persistName: 'tbd-server' });
        S.attachRemote(App.Sync);
        const cached = App.Meta.get('user', null);
        if (App.Sync.hasToken && cached) {
          authed = true;
          S.setUser(cached);
          App.Sync.start();
          App.Sync.me().then((u) => { S.setUser(u); App.Meta.set('user', u); }).catch(() => {});
        }
      } else {
        App.Meta.set('mode', 'local');
        await S.init({ persistName: 'tbd-local' });
        S.setUser({ id: 'local', name: 'Admin', role: 'admin' });
        if (navigator.storage && navigator.storage.persist && !/Firefox/.test(navigator.userAgent)) navigator.storage.persist().catch(() => {});
      }
      render(h(Root), root);
      registerSW();
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="boot-error"><h1>Something went wrong</h1><p>${String((e && e.message) || e).replace(/</g, '&lt;')}</p><p><button onclick="location.reload()">Reload</button></p></div>`;
    }
  }
  App.boot = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.App = window.App || {});
