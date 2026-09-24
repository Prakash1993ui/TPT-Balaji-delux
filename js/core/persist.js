/*
 * On-device persistence.
 *
 * Records are stored individually in IndexedDB (key "<collection>/<id>") so that
 * several open tabs never overwrite each other's work, and storage is large enough
 * for years of bookings. Falls back to localStorage when IndexedDB is unavailable
 * (e.g. some private-browsing modes or file:// pages in Firefox).
 *
 * Writes are batched (200 ms) and flushed when the page is hidden.
 */
(function (App) {
  'use strict';

  const LS = 'tbd:';

  function openIDB(name) {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window) || !window.indexedDB) return reject(new Error('IndexedDB not available'));
      let req;
      try {
        req = indexedDB.open(name, 1);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }
  const reqP = (req) =>
    new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  const txDone = (tx) =>
    new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
    });

  class Persist {
    constructor(name) {
      this.name = name;
      this.db = null;
      this.queue = new Map(); // key -> {c, d} | null (delete)
      this.timer = null;
      this.onExternalChange = null; // (keys[]) => void
      this.onError = null;
      this.channel = null;
      this.flushing = Promise.resolve();
    }

    async init() {
      try {
        this.db = await Promise.race([
          openIDB(this.name),
          new Promise((_, rej) => setTimeout(() => rej(new Error('IndexedDB timeout')), 4000)),
        ]);
      } catch (e) {
        console.warn('[persist] Falling back to localStorage:', e && e.message);
        this.db = null;
      }
      try {
        this.channel = new BroadcastChannel('tbd:' + this.name);
        this.channel.onmessage = (ev) => {
          if (ev.data && ev.data.keys && this.onExternalChange) this.onExternalChange(ev.data.keys);
        };
      } catch (e) {
        this.channel = null;
      }
      const flushNow = () => this.flush();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushNow();
      });
      window.addEventListener('pagehide', flushNow);
      return this;
    }

    get kind() {
      return this.db ? 'IndexedDB' : 'localStorage';
    }

    /** Load everything -> { collection: [records] } */
    async loadAll() {
      const out = {};
      if (this.db) {
        const tx = this.db.transaction('records', 'readonly');
        const store = tx.objectStore('records');
        const values = await reqP(store.getAll());
        for (const v of values) {
          if (!v || !v.c || !v.d) continue;
          (out[v.c] || (out[v.c] = [])).push(v.d);
        }
      } else {
        const prefix = LS + this.name + ':';
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(prefix)) continue;
          try {
            const map = JSON.parse(localStorage.getItem(k)) || {};
            out[k.slice(prefix.length)] = Object.values(map);
          } catch (e) {
            console.warn('[persist] corrupt key', k);
          }
        }
      }
      return out;
    }

    /** Read specific keys ("col/id") -> [{key, c, id, d|null}] */
    async getMany(keys) {
      const res = [];
      if (this.db) {
        const tx = this.db.transaction('records', 'readonly');
        const store = tx.objectStore('records');
        for (const key of keys) {
          const v = await reqP(store.get(key));
          const [c, id] = splitKey(key);
          res.push({ key, c, id, d: v ? v.d : null });
        }
      } else {
        const cache = {};
        for (const key of keys) {
          const [c, id] = splitKey(key);
          if (!cache[c]) cache[c] = readLS(this.name, c);
          res.push({ key, c, id, d: cache[c][id] || null });
        }
      }
      return res;
    }

    put(col, rec) {
      this.queue.set(col + '/' + rec.id, { c: col, d: rec });
      this.schedule();
    }
    del(col, id) {
      this.queue.set(col + '/' + id, null);
      this.schedule();
    }
    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 200);
    }

    flush() {
      clearTimeout(this.timer);
      if (!this.queue.size) return this.flushing;
      const batch = this.queue;
      this.queue = new Map();
      this.flushing = this.flushing.then(() => this._write(batch)).catch((e) => {
        console.error('[persist] write failed', e);
        // put the failed batch back (newer queued writes win)
        for (const [k, v] of batch) if (!this.queue.has(k)) this.queue.set(k, v);
        if (this.onError) this.onError(e);
      });
      return this.flushing;
    }

    async _write(batch) {
      if (this.db) {
        const tx = this.db.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        for (const [k, v] of batch) {
          if (v) store.put(v, k);
          else store.delete(k);
        }
        await txDone(tx);
      } else {
        const byCol = {};
        for (const [k, v] of batch) {
          const [c, id] = splitKey(k);
          if (!byCol[c]) byCol[c] = readLS(this.name, c);
          if (v) byCol[c][id] = v.d;
          else delete byCol[c][id];
        }
        for (const c in byCol) localStorage.setItem(LS + this.name + ':' + c, JSON.stringify(byCol[c]));
      }
      if (this.channel) {
        try {
          this.channel.postMessage({ keys: [...batch.keys()] });
        } catch (e) { /* ignore */ }
      }
    }

    /** Replace the whole database (restore / full server snapshot). data: {col: [records]} */
    async replaceAll(data) {
      clearTimeout(this.timer);
      this.queue = new Map();
      await this.flushing.catch(() => {});
      if (this.db) {
        const tx = this.db.transaction('records', 'readwrite');
        const store = tx.objectStore('records');
        store.clear();
        for (const c in data) for (const d of data[c]) store.put({ c, d }, c + '/' + d.id);
        await txDone(tx);
      } else {
        this._clearLS();
        for (const c in data) {
          const map = {};
          for (const d of data[c]) map[d.id] = d;
          localStorage.setItem(LS + this.name + ':' + c, JSON.stringify(map));
        }
      }
      if (this.channel) {
        try {
          this.channel.postMessage({ keys: ['*'] });
        } catch (e) { /* ignore */ }
      }
    }

    _clearLS() {
      const prefix = LS + this.name + ':';
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    }

    async estimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
      } catch (e) { /* ignore */ }
      return null;
    }
  }

  function splitKey(key) {
    const i = key.indexOf('/');
    return [key.slice(0, i), key.slice(i + 1)];
  }
  function readLS(name, c) {
    try {
      return JSON.parse(localStorage.getItem(LS + name + ':' + c)) || {};
    } catch (e) {
      return {};
    }
  }

  /** Small synchronous key/value store for preferences & session info. */
  const Meta = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(LS + 'meta:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (value === undefined) localStorage.removeItem(LS + 'meta:' + key);
        else localStorage.setItem(LS + 'meta:' + key, JSON.stringify(value));
      } catch (e) {
        console.warn('[meta] could not save', key, e);
      }
    },
  };

  App.Persist = Persist;
  App.Meta = Meta;
})(window.App = window.App || {});
