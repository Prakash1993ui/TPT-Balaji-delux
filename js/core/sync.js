/*
 * Server mode (optional). When the app is served by `node server/server.js`,
 * every phone, tablet and PC signs in and shares one live database.
 *
 *  - Local changes are applied instantly and queued (survives reloads/offline).
 *  - The queue is pushed with POST /api/sync; other devices receive changes via
 *    long-polling GET /api/sync?since=<version> (near real-time, no websockets).
 *  - Booking and invoice numbers come from the server so they never clash.
 */
(function (App) {
  'use strict';
  const { U, Meta } = App;
  const S = App.Store;

  const API = 'api/';
  let token = Meta.get('token', null);
  let since = Meta.get('since', 0);
  let dbId = Meta.get('dbId', null);
  const pendingMap = new Map((Meta.get('pending', []) || []).map((op) => [op.col + '/' + op.id, op]));
  let status = 'idle'; // idle | online | syncing | offline | auth
  let lastSync = 0;
  let running = false;
  let pollCtl = null;
  let wake = null;
  let backoff = 1000;
  let failures = 0;
  const listeners = new Set();

  const savePendingNow = () => Meta.set('pending', [...pendingMap.values()]);
  const savePending = U.debounce(savePendingNow, 150);
  window.addEventListener('pagehide', savePendingNow);

  function setStatus(st) {
    if (status === st) return;
    status = st;
    listeners.forEach((fn) => fn(st));
  }

  async function api(path, opts = {}) {
    const { method = 'GET', body, signal, timeout = 15000 } = opts;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const onAbort = () => ctl.abort();
    if (signal) signal.addEventListener('abort', onAbort);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch(API + path, {
        method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: 'no-store',
      });
      const isJson = (res.headers.get('content-type') || '').includes('json');
      const data = isJson ? await res.json() : null;
      if (!res.ok) {
        const e = new Error((data && data.error) || res.statusText || 'Request failed');
        e.status = res.status;
        throw e;
      }
      return data;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  /** Server mode is enabled when the page was served by server/server.js, which injects <meta name="tbd-server">. */
  async function detect() {
    if (location.protocol === 'file:') return null;
    const meta = document.querySelector('meta[name="tbd-server"]');
    return meta ? { app: 'tpt-balaji-delux', version: meta.getAttribute('content') || '' } : null;
  }
  const health = () => api('health', { timeout: 5000 });

  // ---------------------------------------------------------------- auth
  async function login(username, password) {
    const r = await api('login', { method: 'POST', body: { username, password } });
    token = r.token;
    Meta.set('token', token);
    return r.user;
  }
  async function me() {
    const r = await api('me');
    return r.user;
  }
  async function logout() {
    try {
      await api('logout', { method: 'POST', body: {} });
    } catch (e) { /* ignore */ }
    token = null;
    Meta.set('token');
    pendingMap.clear();
    savePendingNow();
    stop();
  }

  // ---------------------------------------------------------------- queue
  function queue(op) {
    pendingMap.set(op.col + '/' + op.id, op);
    savePending();
    kick();
  }
  const hasPending = (col, id) => pendingMap.has(col + '/' + id);

  function kick() {
    if (pollCtl) pollCtl.abort();
    if (wake) wake();
    if (!running && token) loop();
  }

  async function applyResponse(res) {
    if (!res) return;
    if (res.full) {
      // Keep local edits that have not reached the server yet on top of the snapshot
      const data = Object.assign({}, res.data || {});
      for (const op of pendingMap.values()) {
        const list = (data[op.col] || []).filter((r) => r.id !== op.id);
        if (op.op === 'put') list.push(op.rec);
        data[op.col] = list;
      }
      await S.replaceAll(data);
    } else if (res.changes) {
      S.applyRemote(res.changes);
    }
    since = res.version;
    dbId = res.dbId;
    Meta.set('since', since);
    Meta.set('dbId', dbId);
    lastSync = Date.now();
  }

  async function push() {
    const ops = [...pendingMap.values()].slice(0, 400);
    const res = await api('sync', { method: 'POST', body: { since, db: dbId, ops }, timeout: 30000 });
    for (const op of ops) {
      const k = op.col + '/' + op.id;
      if (pendingMap.get(k) === op) pendingMap.delete(k);
    }
    savePending();
    await applyResponse(res);
    if (res && res.rejected && res.rejected.length) {
      App.toast && App.toast(`${res.rejected.length} change(s) were not allowed for your role.`, 'error');
    }
  }

  async function pull(wait) {
    pollCtl = new AbortController();
    try {
      const res = await api(`sync?since=${since}&db=${encodeURIComponent(dbId || '')}${wait ? '&wait=25' : ''}`, {
        signal: pollCtl.signal, timeout: wait ? 40000 : 20000,
      });
      await applyResponse(res);
    } finally {
      pollCtl = null;
    }
  }

  const sleep = (ms) =>
    new Promise((res) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        wake = null;
        res();
      }
      wake = done;
    });

  async function loop() {
    if (running) return;
    running = true;
    let first = true;
    while (running && token) {
      try {
        if (pendingMap.size) {
          setStatus('syncing');
          await push();
          if (!pendingMap.size) setStatus('online');
        } else {
          if (first) setStatus('syncing');
          await pull(!first);
          first = false;
          setStatus('online');
        }
        backoff = 1000;
        failures = 0;
      } catch (e) {
        if (!running) break;
        if (e.status === 401) {
          running = false;
          token = null;
          Meta.set('token');
          setStatus('auth');
          if (App.onAuthLost) App.onAuthLost();
          break;
        }
        if (e.name === 'AbortError') continue; // interrupted to push a new change (or poll timeout)
        if (!e.status) {
          // Proxies sometimes cut long-running requests: if the server still answers, just reconnect.
          let reachable = false;
          try { await health(); reachable = true; } catch (x) { /* really offline */ }
          if (reachable && running) {
            failures = 0;
            await sleep(300);
            continue;
          }
        }
        failures++;
        if (failures >= 2 || pendingMap.size) setStatus('offline'); // ignore a single dropped connection
        await sleep(failures === 1 ? 500 : backoff);
        if (failures > 1) backoff = Math.min(backoff * 2, 30000);
      }
    }
    running = false;
  }
  function stop() {
    running = false;
    if (pollCtl) pollCtl.abort();
    if (wake) wake();
    setStatus('idle');
  }
  window.addEventListener('online', () => kick());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && token) kick();
  });

  // ---------------------------------------------------------------- counters & admin
  async function nextSeq(name, start) {
    try {
      const r = await api('counter', { method: 'POST', body: { name, start } });
      return r.value;
    } catch (e) {
      if (!e.status) throw new Error('No connection to the hotel server. Please check Wi-Fi/internet and try again.');
      throw e;
    }
  }
  async function setSeq(name, last) {
    await api('counter', { method: 'POST', body: { name, set: +last || 0 } });
  }
  async function peekSeq(name, start) {
    const r = await api(`counter?name=${encodeURIComponent(name)}&start=${start || 0}`);
    return r.value;
  }
  async function pushSnapshot(data) {
    const res = await api('restore', { method: 'POST', body: { data }, timeout: 120000 });
    pendingMap.clear();
    savePendingNow();
    since = res.version;
    dbId = res.dbId;
    Meta.set('since', since);
    Meta.set('dbId', dbId);
  }
  /** Forget cached server data on this device (used when switching users/servers). */
  function resetCursor() {
    since = 0;
    dbId = null;
    Meta.set('since', 0);
    Meta.set('dbId');
  }

  App.Sync = {
    detect, health, login, me, logout, queue, hasPending, kick, stop, start: () => kick(), resetCursor,
    nextSeq, setSeq, peekSeq, pushSnapshot,
    users: () => api('users').then((r) => r.users),
    saveUser: (u) => api('users', { method: 'POST', body: u }).then((r) => r.user),
    deleteUser: (id) => api('users/' + encodeURIComponent(id), { method: 'DELETE' }),
    changePassword: (current, next) => api('password', { method: 'POST', body: { current, next } }),
    backup: () => api('backup', { timeout: 120000 }),
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get status() { return status; },
    get lastSync() { return lastSync; },
    get pendingCount() { return pendingMap.size; },
    get hasToken() { return !!token; },
  };
})(window.App = window.App || {});
