#!/usr/bin/env node
/*
 * TPT Balaji Delux — optional hotel server (shared data for all devices).
 * Zero dependencies: needs only Node.js 18 or newer.
 *
 *   node server/server.js                         start on http://0.0.0.0:8080
 *   PORT=3000 ADMIN_PASSWORD=secret123 node server/server.js
 *   node server/server.js --reset-password admin NewPass123
 *
 * Everything is stored in ./data (override with DATA_DIR):
 *   db.json        hotel data (rooms, guests, bookings, …) with change versions
 *   auth.json      users (scrypt password hashes) and sessions (hashed tokens)
 *   backups/       one compressed snapshot per day (last 60 kept) + before every restore
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const APP_VERSION = (() => {
  try { return require(path.join(ROOT, 'package.json')).version; } catch (e) { return '1.0.0'; }
})();
const COLLECTIONS = ['settings', 'roomTypes', 'rooms', 'housekeeping', 'guests', 'bookings', 'expenses'];
const SESSION_DAYS = 30;
const MAX_BODY = 30 * 1024 * 1024;
const MAX_RECORD = 1024 * 1024;
const LONG_POLL_MAX = 25;

// ------------------------------------------------------------------ storage
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const localDate = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in server's time zone

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`!! Could not read ${file}: ${e.message}`);
      try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch (e2) { /* ignore */ }
      console.error('!! A copy was kept. Restore from data/backups if needed.');
    }
    return fallback;
  }
}
function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

let db = readJson(DB_FILE, null) || { dbId: rid(), version: 0, counters: {}, records: {} };
db.records = db.records || {};
db.counters = db.counters || {};
COLLECTIONS.forEach((c) => { db.records[c] = db.records[c] || {}; });
let auth = readJson(AUTH_FILE, null) || { users: [], sessions: {} };
auth.users = auth.users || [];
auth.sessions = auth.sessions || {};

let dirtyDb = false;
let dirtyAuth = false;
let saveTimer = null;
function markDb() { dirtyDb = true; scheduleSave(); }
function markAuth() { dirtyAuth = true; scheduleSave(); }
function scheduleSave() {
  if (!saveTimer) saveTimer = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    if (dirtyDb) {
      writeJsonAtomic(DB_FILE, db);
      dirtyDb = false;
      dailyBackup();
    }
    if (dirtyAuth) {
      writeJsonAtomic(AUTH_FILE, auth);
      dirtyAuth = false;
    }
  } catch (e) {
    console.error('!! SAVE FAILED:', e);
  }
}
function backupFile(name) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, name), zlib.gzipSync(JSON.stringify(db)));
}
function dailyBackup() {
  const name = `db-${localDate()}.json.gz`;
  if (fs.existsSync(path.join(BACKUP_DIR, name))) return;
  try {
    backupFile(name);
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 60)).forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flush();
    console.log('\nSaved. Bye!');
    process.exit(0);
  });
}

// ------------------------------------------------------------------ users & passwords
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(String(pw), salt, 64)).toString('hex');
  return { salt, hash };
}
async function verifyPassword(pw, user) {
  if (!user || !user.salt || !user.hash) return false;
  const h = await scrypt(String(pw), user.salt, 64);
  const expected = Buffer.from(user.hash, 'hex');
  return expected.length === h.length && crypto.timingSafeEqual(h, expected);
}
function generatePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), (b) => abc[b % abc.length]).join('');
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active !== false, lastSeen: u.lastSeen || null, createdAt: u.createdAt });
const activeAdmins = () => auth.users.filter((u) => u.role === 'admin' && u.active !== false);

async function ensureAdmin() {
  if (auth.users.length) return;
  const fromEnv = !!process.env.ADMIN_PASSWORD;
  const pw = process.env.ADMIN_PASSWORD || generatePassword();
  auth.users.push(Object.assign({ id: rid(8), username: 'admin', name: 'Admin', role: 'admin', active: true, createdAt: Date.now() }, await hashPassword(pw)));
  dirtyAuth = true;
  flush();
  if (!fromEnv) {
    fs.writeFileSync(path.join(DATA_DIR, 'initial-admin-password.txt'),
      `TPT Balaji Delux hotel server\n\nusername: admin\npassword: ${pw}\n\nSign in, change this password (Settings -> Users & login), then delete this file.\n`);
  }
  console.log('\n  First start — an admin account was created:');
  console.log('    username: admin');
  console.log(`    password: ${fromEnv ? '(from ADMIN_PASSWORD)' : pw}`);
  if (!fromEnv) console.log(`    (also saved in ${path.join(DATA_DIR, 'initial-admin-password.txt')})`);
  console.log('');
}

// ------------------------------------------------------------------ sessions & rate limiting
function createSession(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  auth.sessions[sha256(token)] = { userId: user.id, createdAt: Date.now(), lastSeen: Date.now() };
  markAuth();
  return token;
}
function getSession(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const key = sha256(m[1].trim());
  const s = auth.sessions[key];
  if (!s) return null;
  if (Date.now() - s.lastSeen > SESSION_DAYS * 864e5) {
    delete auth.sessions[key];
    markAuth();
    return null;
  }
  const user = auth.users.find((u) => u.id === s.userId && u.active !== false);
  if (!user) return null;
  if (Date.now() - s.lastSeen > 60000) {
    s.lastSeen = Date.now();
    user.lastSeen = s.lastSeen;
    markAuth();
  }
  return { key, user };
}
function dropSessions(userId, exceptKey) {
  for (const [k, s] of Object.entries(auth.sessions)) if (s.userId === userId && k !== exceptKey) delete auth.sessions[k];
  markAuth();
}
setInterval(() => {
  const cutoff = Date.now() - SESSION_DAYS * 864e5;
  let changed = false;
  for (const [k, s] of Object.entries(auth.sessions)) if (s.lastSeen < cutoff) { delete auth.sessions[k]; changed = true; }
  if (changed) markAuth();
}, 6 * 3600 * 1000).unref();

const failures = new Map(); // ip|username -> { count, first }
function tooMany(key) {
  const f = failures.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > 15 * 60000) { failures.delete(key); return 0; }
  return f.count >= 10 ? Math.ceil((f.first + 15 * 60000 - Date.now()) / 60000) : 0;
}
function fail(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > 15 * 60000) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

// ------------------------------------------------------------------ sync
function snapshot() {
  const out = {};
  for (const c of COLLECTIONS) out[c] = Object.values(db.records[c]).filter((r) => !r._deleted);
  return out;
}
function changesSince(since) {
  const out = {};
  for (const c of COLLECTIONS) {
    const arr = [];
    for (const r of Object.values(db.records[c])) if (r._v > since) arr.push(r);
    if (arr.length) out[c] = arr;
  }
  return out;
}
function syncPayload(since, clientDb) {
  since = Number(since) || 0;
  // Full snapshot for new devices, devices from before a restore, or impossible cursors
  if (clientDb !== db.dbId || since < 0 || since > db.version) return { full: true, dbId: db.dbId, version: db.version, data: snapshot() };
  return { dbId: db.dbId, version: db.version, changes: changesSince(since) };
}
function allowed(user, op) {
  if (user.role === 'admin') return true;
  if (op.col === 'settings') return false;
  if (op.op === 'del') return user.role === 'manager' && op.col !== 'roomTypes' && op.col !== 'rooms';
  if (op.col === 'roomTypes' || op.col === 'rooms') return user.role === 'manager';
  return true;
}
function applyOps(ops, user) {
  const rejected = [];
  let changed = false;
  for (const op of Array.isArray(ops) ? ops : []) {
    const ok = op && COLLECTIONS.includes(op.col) && typeof op.id === 'string' && op.id.length > 0 && op.id.length <= 120;
    if (!ok || !allowed(user, op)) { rejected.push(op && op.id); continue; }
    const table = db.records[op.col];
    if (op.op === 'del') {
      const cur = table[op.id];
      if (cur && !cur._deleted) {
        table[op.id] = { id: op.id, _deleted: true, _v: ++db.version, updatedAt: Date.now(), updatedBy: user.name };
        changed = true;
      }
    } else if (op.op === 'put' && op.rec && typeof op.rec === 'object' && !Array.isArray(op.rec) && op.rec.id === op.id) {
      if (JSON.stringify(op.rec).length > MAX_RECORD) { rejected.push(op.id); continue; }
      const prev = table[op.id];
      const rec = Object.assign({}, op.rec, {
        _v: ++db.version,
        updatedBy: user.name,
        createdBy: (prev && !prev._deleted && prev.createdBy) || op.rec.createdBy || user.name,
      });
      delete rec._deleted;
      table[op.id] = rec;
      changed = true;
    } else rejected.push(op.id);
  }
  if (changed) {
    markDb();
    notifyWaiters();
  }
  return rejected;
}
const waiters = new Set();
function notifyWaiters() {
  for (const w of [...waiters]) {
    waiters.delete(w);
    clearTimeout(w.timer);
    sendJson(w.res, 200, syncPayload(w.since, w.db));
  }
}
function deriveCounters(data) {
  const counters = {};
  for (const b of data.bookings || []) {
    const m = /(\d+)\s*$/.exec(b.code || '');
    if (m) counters.booking = Math.max(counters.booking || 0, +m[1]);
    if (b.invoiceNo) {
      const parts = String(b.invoiceNo).split('/');
      const fyPart = parts.find((p) => /^\d\d-\d\d$/.test(p));
      const seq = parseInt(parts[parts.length - 1], 10);
      if (fyPart && seq > 0) {
        const key = `invoice:20${fyPart.slice(0, 2)}-${fyPart.slice(3)}`;
        counters[key] = Math.max(counters[key] || 0, seq);
      }
    }
  }
  return counters;
}

// ------------------------------------------------------------------ http helpers
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
function sendJson(res, status, obj) {
  if (res.writableEnded || res.destroyed) return;
  const body = JSON.stringify(obj);
  const headers = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS);
  const req = res.req;
  if (body.length > 2048 && req && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(status, headers);
    res.end(zlib.gzipSync(body));
  } else {
    res.writeHead(status, headers);
    res.end(body);
  }
}
const error = (res, status, message) => sendJson(res, status, { error: message });
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ API
async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  const method = req.method;

  if (route === 'health' && method === 'GET') return sendJson(res, 200, { ok: true, app: 'tpt-balaji-delux', version: APP_VERSION, time: Date.now() });

  if (route === 'login' && method === 'POST') {
    const body = await readBody(req, 64 * 1024);
    const username = String(body.username || '').trim().toLowerCase();
    const ip = req.socket.remoteAddress || '';
    const key = `${ip}|${username}`;
    const wait = tooMany(key);
    if (wait) return error(res, 429, `Too many attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`);
    const user = auth.users.find((u) => u.username === username && u.active !== false);
    if (!user || !(await verifyPassword(body.password || '', user))) {
      fail(key);
      return error(res, 401, 'Wrong username or password');
    }
    failures.delete(key);
    user.lastSeen = Date.now();
    return sendJson(res, 200, { token: createSession(user), user: publicUser(user) });
  }

  const sess = getSession(req);
  if (!sess) return error(res, 401, 'Please sign in');
  const user = sess.user;
  const admin = user.role === 'admin';

  if (route === 'logout' && method === 'POST') {
    delete auth.sessions[sess.key];
    markAuth();
    return sendJson(res, 200, { ok: true });
  }
  if (route === 'me' && method === 'GET') return sendJson(res, 200, { user: publicUser(user) });

  if (route === 'sync' && method === 'GET') {
    const since = Number(url.searchParams.get('since')) || 0;
    const clientDb = url.searchParams.get('db') || '';
    const wait = Math.min(LONG_POLL_MAX, Math.max(0, Number(url.searchParams.get('wait')) || 0));
    const payload = syncPayload(since, clientDb);
    const empty = !payload.full && !Object.keys(payload.changes).length;
    if (!empty || !wait) return sendJson(res, 200, payload);
    const w = { res, since, db: clientDb, timer: null };
    w.timer = setTimeout(() => {
      waiters.delete(w);
      sendJson(res, 200, syncPayload(since, clientDb));
    }, wait * 1000);
    waiters.add(w);
    res.on('close', () => {
      clearTimeout(w.timer);
      waiters.delete(w);
    });
    return undefined;
  }
  if (route === 'sync' && method === 'POST') {
    const body = await readBody(req);
    const rejected = applyOps(body.ops, user);
    return sendJson(res, 200, Object.assign(syncPayload(body.since, body.db), { rejected }));
  }

  if (route === 'counter') {
    const name = method === 'GET' ? url.searchParams.get('name') : null;
    if (method === 'GET') {
      if (!/^[a-z0-9:_-]{1,40}$/i.test(name || '')) return error(res, 400, 'Bad counter name');
      const start = Number(url.searchParams.get('start')) || 0;
      return sendJson(res, 200, { value: Math.max(db.counters[name] || 0, start) });
    }
    if (method === 'POST') {
      const body = await readBody(req, 16 * 1024);
      if (!/^[a-z0-9:_-]{1,40}$/i.test(body.name || '')) return error(res, 400, 'Bad counter name');
      if (body.set != null) {
        if (!admin) return error(res, 403, 'Only an admin can change numbering');
        db.counters[body.name] = Math.max(0, Math.floor(Number(body.set) || 0));
      } else {
        db.counters[body.name] = Math.max(db.counters[body.name] || 0, Math.floor(Number(body.start) || 0)) + 1;
      }
      markDb();
      return sendJson(res, 200, { value: db.counters[body.name] });
    }
  }

  if (route === 'password' && method === 'POST') {
    const body = await readBody(req, 16 * 1024);
    if (!(await verifyPassword(body.current || '', user))) return error(res, 400, 'Current password is wrong');
    if (String(body.next || '').length < 6) return error(res, 400, 'New password must be at least 6 characters');
    Object.assign(user, await hashPassword(body.next));
    dropSessions(user.id, sess.key);
    try { fs.unlinkSync(path.join(DATA_DIR, 'initial-admin-password.txt')); } catch (e) { /* ignore */ }
    return sendJson(res, 200, { ok: true });
  }

  // ----- admin only below
  if (route === 'users' && method === 'GET') {
    if (!admin) return error(res, 403, 'Admins only');
    return sendJson(res, 200, { users: auth.users.map(publicUser) });
  }
  if (route === 'users' && method === 'POST') {
    if (!admin) return error(res, 403, 'Admins only');
    const b = await readBody(req, 64 * 1024);
    const username = String(b.username || '').trim().toLowerCase();
    const name = String(b.name || '').trim();
    const role = ['admin', 'manager', 'staff'].includes(b.role) ? b.role : 'staff';
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) return error(res, 400, 'Username: 2-32 letters, numbers, dot, dash or underscore');
    if (!name) return error(res, 400, 'Name is required');
    if (auth.users.some((u) => u.username === username && u.id !== b.id)) return error(res, 400, 'That username is already taken');
    let u = b.id ? auth.users.find((x) => x.id === b.id) : null;
    if (b.id && !u) return error(res, 404, 'User not found');
    const active = b.active !== false;
    if (u && u.role === 'admin' && u.active !== false && (role !== 'admin' || !active) && activeAdmins().length <= 1) return error(res, 400, 'Keep at least one active admin');
    if (!u) {
      if (String(b.password || '').length < 6) return error(res, 400, 'Password must be at least 6 characters');
      u = { id: rid(8), createdAt: Date.now() };
      auth.users.push(u);
    }
    Object.assign(u, { username, name, role, active });
    if (b.password) {
      if (String(b.password).length < 6) return error(res, 400, 'Password must be at least 6 characters');
      Object.assign(u, await hashPassword(b.password));
      dropSessions(u.id, u.id === user.id ? sess.key : null);
    }
    if (!active) dropSessions(u.id);
    markAuth();
    return sendJson(res, 200, { user: publicUser(u) });
  }
  if (route.startsWith('users/') && method === 'DELETE') {
    if (!admin) return error(res, 403, 'Admins only');
    const id = decodeURIComponent(route.slice(6));
    const u = auth.users.find((x) => x.id === id);
    if (!u) return error(res, 404, 'User not found');
    if (u.id === user.id) return error(res, 400, 'You cannot delete yourself');
    if (u.role === 'admin' && activeAdmins().length <= 1) return error(res, 400, 'Keep at least one active admin');
    auth.users = auth.users.filter((x) => x.id !== id);
    dropSessions(id);
    return sendJson(res, 200, { ok: true });
  }
  if (route === 'backup' && method === 'GET') {
    if (!admin) return error(res, 403, 'Admins only');
    const settings = db.records.settings.main || {};
    return sendJson(res, 200, { app: 'tpt-balaji-delux', schema: 1, exportedAt: new Date().toISOString(), hotel: settings.hotelName || '', data: snapshot(), counters: db.counters });
  }
  if (route === 'restore' && method === 'POST') {
    if (!admin) return error(res, 403, 'Admins only');
    const body = await readBody(req);
    if (!body.data || typeof body.data !== 'object') return error(res, 400, 'No data');
    backupFile(`before-restore-${Date.now()}.json.gz`);
    const records = {};
    let v = 0;
    for (const c of COLLECTIONS) {
      records[c] = {};
      for (const r of Array.isArray(body.data[c]) ? body.data[c] : []) {
        if (!r || typeof r.id !== 'string' || r._deleted) continue;
        records[c][r.id] = Object.assign({}, r, { _v: ++v });
      }
    }
    db = { dbId: rid(), version: v, counters: deriveCounters(body.data), records };
    dirtyDb = true;
    flush();
    notifyWaiters();
    console.log(`Data restored by ${user.name} (${v} records)`);
    return sendJson(res, 200, { dbId: db.dbId, version: db.version });
  }
  return error(res, 404, 'Not found');
}

// ------------------------------------------------------------------ static files (only the app itself)
const STATIC_FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js', 'favicon.ico', 'robots.txt']);
const STATIC_DIRS = new Set(['css', 'js', 'vendor', 'icons']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const gzCache = new Map();
/** Short hash of all app files (size + mtime) — changes whenever any file changes. */
function assetFingerprint() {
  const h = crypto.createHash('sha1');
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    let st;
    try { st = fs.statSync(abs); } catch (e) { return; }
    if (st.isDirectory()) fs.readdirSync(abs).sort().forEach((f) => { if (!f.startsWith('.')) walk(path.join(rel, f)); });
    else h.update(`${rel}:${st.size}:${st.mtimeMs};`);
  };
  [...STATIC_FILES, ...STATIC_DIRS].forEach(walk);
  return h.digest('hex').slice(0, 10);
}
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch (e) { return error(res, 400, 'Bad path'); }
  if (rel === '') rel = 'index.html';
  const parts = rel.split('/');
  const permitted = !rel.includes('\0') && !parts.some((p) => p === '..' || p.startsWith('.')) &&
    (STATIC_FILES.has(rel) || (parts.length > 1 && STATIC_DIRS.has(parts[0])));
  const file = path.join(ROOT, rel);
  if (!permitted || !file.startsWith(ROOT + path.sep)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const etag = `W/"${st.size.toString(36)}-${st.mtimeMs.toString(36)}-${APP_VERSION}${rel === 'sw.js' ? '-' + assetFingerprint() : ''}"`;
    const headers = Object.assign({ 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag }, SECURITY_HEADERS);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(file, (err2, buf) => {
      if (err2) return notFound(res);
      if (rel === 'index.html') buf = Buffer.from(buf.toString('utf8').replace('<!--TBD_SERVER-->', `<meta name="tbd-server" content="${APP_VERSION}" />`));
      if (rel === 'sw.js') buf = Buffer.from(buf.toString('utf8').replace(/const VERSION = '([^']+)';/, (m, v) => `const VERSION = '${v}-${assetFingerprint()}';`));
      const compressible = /text|javascript|json|svg|manifest/.test(headers['Content-Type']) && buf.length > 1024;
      if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        let gz = gzCache.get(etag + rel);
        if (!gz) { gz = zlib.gzipSync(buf); gzCache.set(etag + rel, gz); }
        headers['Content-Encoding'] = 'gzip';
        headers.Vary = 'Accept-Encoding';
        buf = gz;
      }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  });
}
function notFound(res) {
  res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
  res.end('Not found');
}

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!e.status) console.error(e);
    return error(res, e.status || 500, e.status ? e.message : 'Server error');
  }
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.requestTimeout = 120000;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node server/server.js [--reset-password <username> <new-password>]\nEnv: PORT (8080), HOST (0.0.0.0), DATA_DIR (./data), ADMIN_PASSWORD (first start only)');
    return;
  }
  const ri = args.indexOf('--reset-password');
  if (ri >= 0) {
    const [username, pw] = [String(args[ri + 1] || '').toLowerCase(), args[ri + 2]];
    const u = auth.users.find((x) => x.username === username);
    if (!u || !pw || pw.length < 6) {
      console.error('Usage: node server/server.js --reset-password <username> <new-password (6+ chars)>');
      process.exit(1);
    }
    Object.assign(u, await hashPassword(pw), { active: true });
    dropSessions(u.id);
    flush();
    console.log(`Password for "${username}" was reset.`);
    return;
  }
  await ensureAdmin();
  server.listen(PORT, HOST, () => {
    console.log(`  TPT Balaji Delux hotel server v${APP_VERSION}`);
    console.log(`  Data folder: ${DATA_DIR}`);
    console.log(`  Open on this computer:   http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`  Open on phones/tablets:  http://${ip}:${PORT}   (same Wi-Fi)`);
    console.log('  Press Ctrl+C to stop.\n');
  });
}
main();
