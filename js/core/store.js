/*
 * Central in-memory data store.
 *
 * Collections hold plain JSON records keyed by id. Every change is:
 *   1. applied in memory immediately (UI re-renders),
 *   2. saved on this device (App.Persist),
 *   3. queued for the server when "server mode" is active (App.Sync).
 *
 * Collections
 *   settings      'main' (hotel profile, tax, policies) and 'counters' (local numbering)
 *   roomTypes     { name, rate, maxAdults, extraBedRate, amenities[] }
 *   rooms         { number, floor, typeId, notes, active }
 *   housekeeping  id = roomId: { status: clean|dirty|inspected, oos, oosReason, assignedTo, note }
 *   guests        { name, phone, email, idType, idNumber, address, city, state, gstin, company, notes }
 *   bookings      see js/core/logic.js
 *   expenses      { date, category, amount, mode, paidTo, note }
 */
(function (App) {
  'use strict';
  const { U } = App;

  const COLLECTIONS = ['settings', 'roomTypes', 'rooms', 'housekeeping', 'guests', 'bookings', 'expenses'];
  const ID_PREFIX = { roomTypes: 'rt', rooms: 'rm', guests: 'g', bookings: 'b', expenses: 'ex' };

  const DEFAULT_SETTINGS = {
    id: 'main',
    hotelName: 'TPT Balaji Delux',
    tagline: 'Hotel · Tirupati',
    legalName: '',
    address: 'Tirupati, Andhra Pradesh',
    pincode: '517501',
    phone: '',
    email: '',
    gstin: '',
    stateName: 'Andhra Pradesh',
    stateCode: '37',
    logo: '',
    // stay policy
    checkoutMode: '24h', // '24h' = charge per 24 hours from check-in, 'fixed' = fixed check-out time
    checkInTime: '12:00',
    checkOutTime: '11:00',
    graceMinutes: 60,
    requireIdAtCheckIn: true,
    // tax (India GST from 22-Sep-2025: room value <= ₹7,500/night -> 5%, above -> 18%)
    gstEnabled: true,
    ratesIncludeGst: false,
    gstSlabs: [
      { upTo: 7500, rate: 5 },
      { upTo: null, rate: 18 },
    ],
    sacCode: '996311',
    chargeCategories: [
      { name: 'Food & beverages', gst: 5, sac: '996331' },
      { name: 'Laundry', gst: 18, sac: '999712' },
      { name: 'Travel / taxi', gst: 5, sac: '996601' },
      { name: 'Late check-out', gst: null, sac: '996311' },
      { name: 'Extra bed', gst: null, sac: '996311' },
      { name: 'Other', gst: 18, sac: '' },
    ],
    // lists
    idTypes: ['Aadhaar', 'Driving licence', 'Passport', 'Voter ID', 'PAN card', 'Other'],
    sources: ['Walk-in', 'Phone', 'WhatsApp', 'Website', 'MakeMyTrip', 'Goibibo', 'Booking.com', 'Agoda', 'OYO', 'Travel agent', 'Corporate'],
    paymentModes: ['Cash', 'UPI', 'Card', 'Bank transfer', 'Online (OTA)'],
    purposes: ['Darshan / pilgrimage', 'Family function', 'Business', 'Medical', 'Tourism', 'Other'],
    expenseCategories: ['Electricity', 'Water', 'Salaries', 'Laundry', 'Housekeeping supplies', 'Maintenance & repairs',
      'Food & kitchen', 'Commission', 'Rent', 'Taxes & fees', 'Internet & phone', 'Marketing', 'Other'],
    // numbering & invoice text
    bookingPrefix: 'BD-',
    invoicePrefix: 'BD',
    invoiceTerms: 'Check-out is 24 hours from check-in. Please keep your valuables in your own custody. Subject to Tirupati jurisdiction.',
    invoiceFooter: 'Thank you for staying with us. Visit again!',
    demo: false,
  };

  // ---------------------------------------------------------------- state
  const data = {};
  const rev = {};
  const cache = {};
  COLLECTIONS.forEach((c) => {
    data[c] = new Map();
    rev[c] = 0;
  });
  let version = 0;
  let persist = null;
  let remote = null; // App.Sync when in server mode
  let user = { id: 'local', name: 'Admin', role: 'admin' };
  let batchDepth = 0;
  let emitPending = false;
  const listeners = new Set();

  function touch(col) {
    rev[col]++;
    version++;
    if (batchDepth === 0) scheduleEmit();
  }
  function scheduleEmit() {
    if (emitPending) return;
    emitPending = true;
    setTimeout(() => {
      emitPending = false;
      listeners.forEach((fn) => {
        try {
          fn(version);
        } catch (e) {
          console.error(e);
        }
      });
    }, 0);
  }

  // ---------------------------------------------------------------- reads
  function all(col) {
    const c = cache[col];
    if (c && c.rev === rev[col]) return c.arr;
    const arr = [];
    for (const r of data[col].values()) if (!r._deleted) arr.push(r);
    cache[col] = { rev: rev[col], arr };
    return arr;
  }
  function get(col, id) {
    if (!id) return null;
    const r = data[col].get(id);
    return r && !r._deleted ? r : null;
  }

  // ---------------------------------------------------------------- writes
  function put(col, rec) {
    if (!data[col]) throw new Error('Unknown collection ' + col);
    const prev = data[col].get(rec.id);
    const t = Date.now();
    const next = Object.assign({}, rec, {
      id: rec.id || U.uid(ID_PREFIX[col]),
      createdAt: rec.createdAt || (prev && prev.createdAt) || t,
      createdBy: rec.createdBy || (prev && prev.createdBy) || user.name,
      updatedAt: t,
      updatedBy: user.name,
    });
    delete next._deleted;
    data[col].set(next.id, next);
    persist && persist.put(col, next);
    remote && remote.queue({ op: 'put', col, id: next.id, rec: next });
    touch(col);
    return next;
  }
  function patch(col, id, changes) {
    const cur = get(col, id);
    if (!cur) throw new Error(`${col}/${id} not found`);
    return put(col, Object.assign({}, cur, changes));
  }
  function remove(col, id) {
    if (!data[col].has(id)) return;
    data[col].delete(id);
    persist && persist.del(col, id);
    remote && remote.queue({ op: 'del', col, id });
    touch(col);
  }
  /** Group several writes into one UI update. */
  function batch(fn) {
    batchDepth++;
    try {
      return fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) scheduleEmit();
    }
  }

  // ---------------------------------------------------------------- settings & numbering
  let settingsCache = { rev: -1, value: null };
  function settings() {
    if (settingsCache.rev === rev.settings) return settingsCache.value;
    const stored = get('settings', 'main') || {};
    const value = Object.assign({}, DEFAULT_SETTINGS, stored);
    settingsCache = { rev: rev.settings, value };
    return value;
  }
  function saveSettings(changes) {
    const cur = get('settings', 'main') || { id: 'main' };
    return put('settings', Object.assign({}, cur, changes, { id: 'main' }));
  }
  /** Highest number already used in the data (so numbers never repeat, even after a restore). */
  function usedSeq(name) {
    let max = 0;
    if (name === 'booking') {
      for (const b of all('bookings')) {
        const m = /(\d+)\s*$/.exec(b.code || '');
        if (m) max = Math.max(max, +m[1]);
      }
    } else if (name.startsWith('invoice:')) {
      const fyShort = name.slice(10); // 'invoice:2026-27' -> '26-27'
      for (const b of all('bookings')) {
        if (!b.invoiceNo) continue;
        const parts = String(b.invoiceNo).split('/');
        if (parts.includes(fyShort)) max = Math.max(max, parseInt(parts[parts.length - 1], 10) || 0);
      }
    }
    return max;
  }
  /** Next number in a sequence (booking codes, invoice numbers). Server-backed in server mode. */
  async function nextSeq(name, start = 0) {
    if (remote) return remote.nextSeq(name, start);
    const c = get('settings', 'counters') || { id: 'counters' };
    const v = Math.max(+c[name] || 0, usedSeq(name), start) + 1;
    put('settings', Object.assign({}, c, { [name]: v }));
    return v;
  }
  async function setSeq(name, lastUsed) {
    if (remote) return remote.setSeq(name, lastUsed);
    const c = get('settings', 'counters') || { id: 'counters' };
    put('settings', Object.assign({}, c, { [name]: Math.max(0, +lastUsed || 0) }));
  }
  async function peekSeq(name, start = 0) {
    if (remote) return remote.peekSeq(name, start);
    const c = get('settings', 'counters') || {};
    return Math.max(+c[name] || 0, usedSeq(name), start);
  }

  // ---------------------------------------------------------------- users & permissions
  const PERMS = {
    admin: ['settings', 'reports', 'delete', 'revenue', 'users', 'rates', 'backup'],
    manager: ['reports', 'revenue', 'delete', 'rates'],
    staff: [],
  };
  const can = (perm) => (PERMS[user.role] || []).includes(perm);

  // ---------------------------------------------------------------- remote (server mode)
  function applyRemote(changes) {
    let touched = false;
    for (const col in changes) {
      if (!data[col]) continue;
      for (const r of changes[col]) {
        if (remote && remote.hasPending(col, r.id)) continue; // local edit wins until pushed
        if (r._deleted) {
          if (data[col].has(r.id)) {
            data[col].delete(r.id);
            persist && persist.del(col, r.id);
          }
        } else {
          data[col].set(r.id, r);
          persist && persist.put(col, r);
        }
      }
      rev[col]++;
      touched = true;
    }
    if (touched) {
      version++;
      scheduleEmit();
    }
  }

  /** Replace every collection (restore from backup / full server snapshot). */
  async function replaceAll(snapshotData, opts = {}) {
    const clean = {};
    for (const col of COLLECTIONS) {
      data[col] = new Map();
      clean[col] = [];
      for (const r of snapshotData[col] || []) {
        if (!r || !r.id || r._deleted) continue;
        data[col].set(r.id, r);
        clean[col].push(r);
      }
      rev[col]++;
    }
    version++;
    if (persist) await persist.replaceAll(clean);
    if (remote && opts.push) await remote.pushSnapshot(clean);
    scheduleEmit();
  }

  function snapshot() {
    const out = {};
    for (const col of COLLECTIONS) out[col] = all(col).map((r) => r);
    return {
      app: 'tpt-balaji-delux',
      schema: 1,
      exportedAt: new Date().toISOString(),
      hotel: settings().hotelName,
      data: out,
    };
  }

  async function reloadKeys(keys) {
    if (!persist) return;
    if (keys.includes('*')) {
      const loaded = await persist.loadAll();
      for (const col of COLLECTIONS) {
        data[col] = new Map((loaded[col] || []).map((r) => [r.id, r]));
        rev[col]++;
      }
    } else {
      const rows = await persist.getMany(keys);
      for (const row of rows) {
        if (!data[row.c]) continue;
        if (row.d) data[row.c].set(row.id, row.d);
        else data[row.c].delete(row.id);
        rev[row.c]++;
      }
    }
    version++;
    scheduleEmit();
  }

  // ---------------------------------------------------------------- boot
  async function init(opts) {
    persist = new App.Persist(opts.persistName);
    await persist.init();
    persist.onExternalChange = (keys) => reloadKeys(keys);
    persist.onError = (e) => {
      const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
      App.toast && App.toast(quota ? 'Device storage is full — export a backup and free up space.' : 'Could not save on this device: ' + (e.message || e), 'error');
    };
    const loaded = await persist.loadAll();
    for (const col of COLLECTIONS) {
      data[col] = new Map((loaded[col] || []).map((r) => [r.id, r]));
      rev[col]++;
    }
    version++;
  }

  App.Store = {
    COLLECTIONS,
    DEFAULT_SETTINGS,
    init,
    all,
    get,
    put,
    patch,
    remove,
    batch,
    settings,
    saveSettings,
    nextSeq,
    setSeq,
    peekSeq,
    can,
    applyRemote,
    replaceAll,
    snapshot,
    flush: () => (persist ? persist.flush() : Promise.resolve()),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get version() {
      return version;
    },
    get mode() {
      return remote ? 'server' : 'local';
    },
    get persist() {
      return persist;
    },
    get user() {
      return user;
    },
    setUser(u) {
      user = u || { id: 'local', name: 'Admin', role: 'admin' };
      version++;
      scheduleEmit();
    },
    attachRemote(r) {
      remote = r;
    },
    isEmpty() {
      return all('rooms').length === 0 && all('bookings').length === 0 && !get('settings', 'main');
    },
  };
})(window.App = window.App || {});
