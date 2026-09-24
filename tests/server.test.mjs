// Integration tests for server/server.js (starts a real server on a random port with a temp data folder).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let proc, base, dataDir, adminToken;

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout');
}
async function api(p, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + '/api/' + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbd-test-'));
  const port = 18000 + Math.floor(Math.random() * 20000);
  base = `http://127.0.0.1:${port}`;
  proc = spawn(process.execPath, ['server/server.js'], {
    cwd: root,
    env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, ADMIN_PASSWORD: 'secret123' }),
    stdio: 'ignore',
  });
  await waitFor(() => fetch(base + '/api/health').then((r) => r.ok).catch(() => false));
  adminToken = (await api('login', { method: 'POST', body: { username: 'admin', password: 'secret123' } })).json.token;
});
after(() => {
  proc && proc.kill('SIGTERM');
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('serves the app with the server marker and never exposes private files', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<meta name="tbd-server" content="[\d.]+" \/>/);
  assert.equal((await fetch(base + '/js/app.js')).status, 200);
  assert.equal((await fetch(base + '/icons/icon-192.png')).status, 200);
  assert.match(await (await fetch(base + '/sw.js')).text(), /const VERSION = 'tbd-v[\d.]+-[0-9a-f]{10}';/, 'service worker is fingerprinted');
  for (const p of ['/data/db.json', '/data/auth.json', '/server/server.js', '/.git/config', '/package.json', '/tests/core.test.mjs',
    '/%2e%2e/%2e%2e/etc/passwd', '/js/%2e%2e/data/auth.json', '/README.md', '/.gitignore']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test('login: wrong password is rejected, token works, me returns the user', async () => {
  assert.equal((await api('login', { method: 'POST', body: { username: 'admin', password: 'nope' } })).status, 401);
  assert.ok(adminToken);
  const me = await api('me', { token: adminToken });
  assert.equal(me.json.user.username, 'admin');
  assert.equal(me.json.user.role, 'admin');
  assert.equal(me.json.user.hash, undefined, 'never leaks password hash');
  assert.equal((await api('me', { token: 'bogus' })).status, 401);
  assert.equal((await api('sync?since=0')).status, 401, 'data requires sign-in');
});

test('sign-in survives proxies that strip or replace the Authorization header', async () => {
  const none = await fetch(base + '/api/me');
  assert.equal(none.status, 401);
  assert.equal((await none.json()).code, 'no-token', 'tells the app that no token arrived');
  const bad = await fetch(base + '/api/me', { headers: { Authorization: 'Bearer nope' } });
  assert.equal((await bad.json()).code, 'bad-token');
  assert.equal((await fetch(base + '/api/me', { headers: { 'X-TBD-Token': adminToken } })).status, 200, 'custom header');
  const replaced = await fetch(base + '/api/me', { headers: { 'X-TBD-Token': adminToken, Authorization: 'Basic cHJveHk6cHJveHk=' } });
  assert.equal(replaced.status, 200, 'works when a proxy puts its own Authorization header in');
  const viaUrl = await fetch(base + '/api/me?_t=' + encodeURIComponent(adminToken));
  assert.equal(viaUrl.status, 200, 'last resort: token in the URL');
  assert.equal((await viaUrl.json()).user.username, 'admin');
  const poll = await fetch(`${base}/api/sync?since=0&db=&_t=${encodeURIComponent(adminToken)}`);
  assert.equal((await poll.json()).full, true);
});

test('passwords: spaces pasted around them are forgiven, letter case is not', async () => {
  assert.equal((await api('login', { method: 'POST', body: { username: ' Admin ', password: 'secret123 ' } })).status, 200);
  assert.equal((await api('login', { method: 'POST', body: { username: 'admin', password: '\tsecret123\n' } })).status, 200);
  assert.equal((await api('login', { method: 'POST', body: { username: 'admin', password: 'Secret123' } })).status, 401);
  assert.equal((await api('login', { method: 'POST', body: { username: 'admin', password: '   ' } })).status, 401);
  const created = await api('users', { method: 'POST', token: adminToken, body: { username: 'desk2', name: 'Desk Two', role: 'staff', password: '  pass word1 ' } });
  assert.equal(created.status, 200);
  assert.equal((await api('login', { method: 'POST', body: { username: 'desk2', password: 'pass word1' } })).status, 200, 'stored without the outer spaces');
  const tooShort = await api('users', { method: 'POST', token: adminToken, body: { id: created.json.user.id, username: 'desk2', name: 'Renamed', role: 'manager', password: '12' } });
  assert.equal(tooShort.status, 400);
  const u = (await api('users', { token: adminToken })).json.users.find((x) => x.id === created.json.user.id);
  assert.equal(u.name, 'Desk Two', 'a rejected save changes nothing');
  assert.equal(u.role, 'staff');
  assert.equal((await api('users/' + u.id, { method: 'DELETE', token: adminToken })).status, 200);
});

test('login is rate limited after repeated failures', async () => {
  for (let i = 0; i < 10; i++) await api('login', { method: 'POST', body: { username: 'ghost', password: 'x' } });
  const r = await api('login', { method: 'POST', body: { username: 'ghost', password: 'x' } });
  assert.equal(r.status, 429);
});

test('sync: push changes, pull incrementally, long-poll wakes up on change', async () => {
  const first = await api('sync?since=0', { token: adminToken });
  assert.equal(first.json.full, true);
  const { dbId } = first.json;
  const push = await api('sync', {
    method: 'POST', token: adminToken,
    body: { since: first.json.version, db: dbId, ops: [{ op: 'put', col: 'guests', id: 'g1', rec: { id: 'g1', name: 'Ravi', phone: '9000012345' } }] },
  });
  assert.equal(push.status, 200);
  assert.deepEqual(push.json.rejected, []);
  assert.equal(push.json.changes.guests[0].name, 'Ravi');
  assert.equal(push.json.changes.guests[0].updatedBy, 'Admin', 'server stamps the real user');
  const v = push.json.version;

  const t0 = Date.now();
  const waiting = api(`sync?since=${v}&db=${dbId}&wait=10`, { token: adminToken });
  await new Promise((r) => setTimeout(r, 300));
  await api('sync', { method: 'POST', token: adminToken, body: { since: v, db: dbId, ops: [{ op: 'put', col: 'guests', id: 'g2', rec: { id: 'g2', name: 'Lakshmi' } }] } });
  const woke = await waiting;
  assert.ok(Date.now() - t0 < 5000, 'long-poll returned promptly');
  assert.equal(woke.json.changes.guests[0].id, 'g2');

  const del = await api('sync', { method: 'POST', token: adminToken, body: { since: woke.json.version, db: dbId, ops: [{ op: 'del', col: 'guests', id: 'g2' }] } });
  assert.equal(del.json.changes.guests[0]._deleted, true);
  const full = await api('sync?since=0', { token: adminToken });
  assert.ok(full.json.data.guests.some((g) => g.id === 'g1'));
  assert.ok(!full.json.data.guests.some((g) => g.id === 'g2'), 'deleted records are not in snapshots');
});

test('counters are unique even with many devices at once', async () => {
  const results = await Promise.all(Array.from({ length: 25 }, () => api('counter', { method: 'POST', token: adminToken, body: { name: 'booking', start: 1000 } })));
  const values = results.map((r) => r.json.value).sort((a, b) => a - b);
  assert.equal(new Set(values).size, 25);
  assert.equal(values[0], 1001);
  assert.equal(values[24], 1025);
  const peek = await api('counter?name=booking&start=1000', { token: adminToken });
  assert.equal(peek.json.value, 1025);
});

test('roles: staff can run the front desk but not change settings or delete', async () => {
  const created = await api('users', { method: 'POST', token: adminToken, body: { name: 'Ramu', username: 'ramu', role: 'staff', password: 'desk123' } });
  assert.equal(created.status, 200);
  const staff = (await api('login', { method: 'POST', body: { username: 'ramu', password: 'desk123' } })).json.token;
  const s0 = (await api('sync?since=0', { token: staff })).json;
  const r = await api('sync', {
    method: 'POST', token: staff, body: {
      since: s0.version, db: s0.dbId, ops: [
        { op: 'put', col: 'bookings', id: 'b1', rec: { id: 'b1', code: 'BD-1', status: 'reserved' } },
        { op: 'put', col: 'settings', id: 'main', rec: { id: 'main', hotelName: 'Hacked' } },
        { op: 'put', col: 'rooms', id: 'rm1', rec: { id: 'rm1', number: '999' } },
        { op: 'del', col: 'guests', id: 'g1' },
      ],
    },
  });
  assert.deepEqual(r.json.rejected.sort(), ['g1', 'main', 'rm1']);
  assert.equal((await api('users', { token: staff })).status, 403);
  assert.equal((await api('backup', { token: staff })).status, 403);
  assert.equal((await api('counter', { method: 'POST', token: staff, body: { name: 'booking', set: 1 } })).status, 403);
});

test('users: the last admin cannot be removed or demoted', async () => {
  const me = (await api('me', { token: adminToken })).json.user;
  assert.equal((await api('users/' + me.id, { method: 'DELETE', token: adminToken })).status, 400);
  const demote = await api('users', { method: 'POST', token: adminToken, body: { id: me.id, name: 'Admin', username: 'admin', role: 'staff' } });
  assert.equal(demote.status, 400);
  const dup = await api('users', { method: 'POST', token: adminToken, body: { name: 'X', username: 'ramu', role: 'staff', password: 'abcdef' } });
  assert.equal(dup.status, 400, 'usernames are unique');
});

test('backup & restore: replaces data, forces full resync and rebuilds numbering', async () => {
  const before = (await api('sync?since=0', { token: adminToken })).json;
  const backup = await api('backup', { token: adminToken });
  assert.equal(backup.json.app, 'tpt-balaji-delux');
  const data = {
    settings: [{ id: 'main', hotelName: 'Restored Hotel' }],
    bookings: [{ id: 'x1', code: 'BD-1500', invoiceNo: 'BD/26-27/0042', status: 'checked_out' }, { id: 'x2', code: 'BD-1499' }],
    guests: [], rooms: [], roomTypes: [], housekeeping: [], expenses: [],
  };
  const res = await api('restore', { method: 'POST', token: adminToken, body: { data } });
  assert.equal(res.status, 200);
  assert.notEqual(res.json.dbId, before.dbId);
  const stale = await api(`sync?since=${before.version}&db=${before.dbId}`, { token: adminToken });
  assert.equal(stale.json.full, true, 'old devices get a full refresh');
  assert.equal(stale.json.data.settings[0].hotelName, 'Restored Hotel');
  assert.equal((await api('counter', { method: 'POST', token: adminToken, body: { name: 'booking', start: 1000 } })).json.value, 1501);
  assert.equal((await api('counter', { method: 'POST', token: adminToken, body: { name: 'invoice:2026-27', start: 0 } })).json.value, 43);
  assert.ok(fs.readdirSync(path.join(dataDir, 'backups')).some((f) => f.startsWith('before-restore-')), 'safety backup written');
});

test('password change signs out other sessions', async () => {
  const t2 = (await api('login', { method: 'POST', body: { username: 'ramu', password: 'desk123' } })).json.token;
  const t3 = (await api('login', { method: 'POST', body: { username: 'ramu', password: 'desk123' } })).json.token;
  assert.equal((await api('password', { method: 'POST', token: t2, body: { current: 'wrong', next: 'newpass1' } })).status, 400);
  assert.equal((await api('password', { method: 'POST', token: t2, body: { current: 'desk123', next: 'newpass1' } })).status, 200);
  assert.equal((await api('me', { token: t2 })).status, 200, 'current session stays');
  assert.equal((await api('me', { token: t3 })).status, 401, 'other sessions are signed out');
});
