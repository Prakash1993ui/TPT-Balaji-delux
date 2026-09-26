// Unit tests for the core (non-UI) modules. Run with:  npm test
// The browser scripts are loaded into Node with minimal stand-ins for window/document/localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function makeLocalStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

async function loadApp() {
  const ctx = {
    console, setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, Map, Set, Uint32Array, crypto: globalThis.crypto,
    structuredClone, queueMicrotask, URL, Blob,
    localStorage: makeLocalStorage(),
    document: { addEventListener() {}, visibilityState: 'visible' },
    location: { protocol: 'http:' },
    navigator: {},
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  for (const f of ['js/core/utils.js', 'js/core/persist.js', 'js/core/store.js', 'js/core/logic.js', 'js/core/demo.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  const App = ctx.App;
  await App.Store.init({ persistName: 'test' + Math.random() });
  return App;
}

test('money formatting & amount in words (Indian system)', async () => {
  const { U } = await loadApp();
  assert.equal(U.money(123456), '₹1,23,456');
  assert.equal(U.money(1234.5), '₹1,234.50');
  assert.equal(U.money(-0), '₹0');
  assert.equal(U.amountInWords(4250.5), 'Rupees Four Thousand Two Hundred Fifty and Fifty Paise Only');
  assert.equal(U.amountInWords(123456789), 'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only');
  assert.equal(U.amountInWords(0), 'Rupees Zero Only');
  assert.equal(U.amountInWords(100000), 'Rupees One Lakh Only');
});

test('dates: local parsing, diffDays, financial year', async () => {
  const { U } = await loadApp();
  assert.equal(U.diffDays('2026-09-24', '2026-09-26'), 2);
  assert.equal(U.diffDays('2026-09-24T23:59', '2026-09-25T00:01'), 1);
  assert.equal(U.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(U.fy('2026-09-24'), '2026-27');
  assert.equal(U.fy('2027-03-31'), '2026-27');
  assert.equal(U.fy('2027-04-01'), '2027-28');
  assert.equal(U.fyShort('2026-09-24'), '26-27');
  assert.deepEqual(Array.from(U.datesBetween('2026-09-29', '2026-10-02')), ['2026-09-29', '2026-09-30', '2026-10-01']);
  assert.equal(U.parse('2026-09-24').getHours(), 0, 'date-only strings must be local midnight');
  assert.equal(U.endOfMonth('2026-02-10'), '2026-02-28');
});

test('stay length: 24-hour and fixed check-out policies', async () => {
  const { L, Store } = await loadApp();
  const h24 = Object.assign({}, Store.settings(), { checkoutMode: '24h', graceMinutes: 60 });
  assert.equal(L.nightsFor('2026-09-24T15:30', '2026-09-25T15:30', h24), 1);
  assert.equal(L.nightsFor('2026-09-24T15:30', '2026-09-25T16:30', h24), 1, 'within 1h grace');
  assert.equal(L.nightsFor('2026-09-24T15:30', '2026-09-25T16:31', h24), 2);
  assert.equal(L.nightsFor('2026-09-24T15:30', '2026-09-24T20:00', h24), 1, 'minimum one day');
  assert.equal(L.plannedCheckOut('2026-09-24T15:30', 2, h24), '2026-09-26T15:30');
  const fixed = Object.assign({}, h24, { checkoutMode: 'fixed', checkOutTime: '11:00', graceMinutes: 60 });
  assert.equal(L.nightsFor('2026-09-24T12:00', '2026-09-26T11:00', fixed), 2);
  assert.equal(L.nightsFor('2026-09-24T12:00', '2026-09-26T11:59', fixed), 2, 'within grace');
  assert.equal(L.nightsFor('2026-09-24T12:00', '2026-09-26T14:00', fixed), 3, 'late check-out adds a night');
  assert.equal(L.nightsFor('2026-09-24T13:00', '2026-09-24T20:00', fixed), 1, 'day use = 1');
  assert.equal(L.plannedCheckOut('2026-09-24T09:00', 2, fixed), '2026-09-26T11:00');
});

test('GST slabs: 5% up to ₹7,500 per night, 18% above (value of supply)', async () => {
  const { L, Store } = await loadApp();
  const s = Store.settings();
  assert.equal(L.gstRateFor(900, s), 5);
  assert.equal(L.gstRateFor(7500, s), 5);
  assert.equal(L.gstRateFor(7501, s), 18);
  assert.equal(L.gstRateFor(7875, Object.assign({}, s, { ratesIncludeGst: true })), 5, 'inclusive 7875 = 7500 + 5%');
  assert.equal(L.gstRateFor(7900, Object.assign({}, s, { ratesIncludeGst: true })), 18);
  assert.equal(L.gstRateFor(9000, Object.assign({}, s, { gstEnabled: false })), 0);
});

test('bill: rooms, extra bed, discount allocation, charges, CGST/SGST, round-off', async () => {
  const { L, Store } = await loadApp();
  Store.put('roomTypes', { id: 'rt1', name: 'AC Deluxe', rate: 1900, extraBedRate: 350 });
  Store.put('roomTypes', { id: 'rt2', name: 'Suite', rate: 7400, extraBedRate: 400 });
  Store.put('rooms', { id: 'r1', number: '301', typeId: 'rt1' });
  Store.put('rooms', { id: 'r2', number: '401', typeId: 'rt2' });
  const b = {
    id: 'x', status: 'reserved', checkIn: '2026-09-24T12:00', checkOut: '2026-09-26T12:00', nights: 2,
    rooms: [{ roomId: 'r1', rate: 1900, extraBeds: 1 }, { roomId: 'r2', rate: 7400, extraBeds: 1 }],
    discountType: 'amount', discountValue: 250,
    charges: [{ id: 'c1', description: 'Dinner', amount: 300, qty: 2, gstRate: 5 }, { id: 'c2', description: 'Late check-out', amount: 500, gstRate: null }],
    payments: [{ id: 'p', amount: 5000, kind: 'payment' }, { id: 'q', amount: 1000, kind: 'refund' }],
  };
  const bill = L.computeBill(b);
  assert.equal(bill.nights, 2);
  assert.equal(bill.lines[0].perNight, 2250);
  assert.equal(bill.lines[1].perNight, 7800);
  assert.equal(bill.roomGross, 20100);
  assert.equal(bill.discount, 250);
  assert.equal(bill.lines[0].discount + bill.lines[1].discount, 250, 'discount fully allocated');
  assert.equal(bill.lines[0].gstRate, 5);
  // 7800/night minus its share of discount is still > 7500 -> 18%
  assert.equal(bill.lines[1].gstRate, 18);
  assert.equal(bill.charges[1].gstRate, 18, 'accommodation-linked charge follows room slab');
  const expectedTax = bill.lines[0].tax + bill.lines[1].tax + 30 + 90;
  assert.equal(Math.round(bill.tax * 100), Math.round(expectedTax * 100));
  assert.equal(Math.round((bill.cgst + bill.sgst) * 100), Math.round(bill.tax * 100));
  assert.equal(bill.total, Math.round(bill.taxable + bill.tax));
  assert.equal(bill.paid, 4000);
  assert.equal(bill.balance, bill.total - 4000);
  // inclusive pricing: total equals the entered amounts
  Store.saveSettings({ ratesIncludeGst: true });
  const incl = L.computeBill(Object.assign({}, b, { discountValue: 0, charges: [] }));
  assert.equal(incl.total, 2 * 2250 + 2 * 7800);
});

test('booking lifecycle: reserve -> check in -> charge -> check out -> invoice', async () => {
  const App = await loadApp();
  const { L, Store, U } = App;
  const { roomTypes, rooms } = App.Demo.sampleTypesAndRooms();
  roomTypes.forEach((t) => Store.put('roomTypes', t));
  rooms.forEach((r) => Store.put('rooms', r));
  const t = U.today();
  const b = await L.createBooking({
    guest: { name: '  Ravi Kumar ', phone: '9000012345', idType: 'Aadhaar', idNumber: '1234 5678 9012' },
    rooms: [{ roomId: 'rm_201', rate: 1400 }], checkIn: U.combine(t, '12:00'), checkOut: U.combine(U.addDays(t, 2), '12:00'),
    nights: 2, adults: 2, source: 'Phone', advance: 1000, advanceMode: 'UPI',
  });
  assert.equal(b.status, 'reserved');
  assert.equal(b.code, 'BD-1001');
  assert.equal(L.guest(b.guestId).name, 'Ravi Kumar');
  assert.equal(L.totals(b).paid, 1000);
  // room is not available for overlapping dates
  assert.equal(L.availability(t, U.addDays(t, 1)).get('rm_201').free, false);
  assert.equal(L.availability(U.addDays(t, 2), U.addDays(t, 3)).get('rm_201').free, true);
  assert.equal(L.roomStatus('rm_201').state, 'arriving');

  const inHouse = L.checkIn(b, { nights: 2 });
  assert.equal(inHouse.status, 'checked_in');
  assert.equal(L.roomStatus('rm_201').state, 'occupied');
  const withCharge = L.addCharge(inHouse, { description: 'Dinner', category: 'Food & beverages', amount: 400, gstRate: 5 });
  assert.equal(withCharge.charges.length, 1);

  const out = await L.checkOut(withCharge, { nights: 2, payment: 1000, paymentMode: 'Cash' });
  assert.equal(out.status, 'checked_out');
  assert.match(out.invoiceNo, /^BD\/\d\d-\d\d\/0001$/);
  assert.equal(out.bill.nights, 2);
  assert.equal(out.bill.total, Math.round(2800 * 1.05 + 400 * 1.05));
  assert.equal(L.billOf(out).paid, 2000);
  assert.equal(L.hk('rm_201').status, 'dirty');
  assert.equal(L.roomStatus('rm_201').state, 'dirty');
  // invoice is frozen: changing tariffs/settings later does not change it
  Store.saveSettings({ gstEnabled: false });
  assert.equal(L.billOf(out).total, out.bill.total);
  const out2 = await L.checkOut(L.checkIn(await L.createBooking({
    guest: { name: 'Second', phone: '9000099999' }, rooms: [{ roomId: 'rm_101', rate: 900 }],
    checkIn: U.combine(t, '12:00'), checkOut: U.combine(U.addDays(t, 1), '12:00'), nights: 1,
  })), {});
  assert.match(out2.invoiceNo, /\/0002$/, 'invoice numbers are sequential');
  assert.equal(out2.code, 'BD-1002');
});

test('cancellation with fee and refund', async () => {
  const App = await loadApp();
  const { L, Store, U } = App;
  const { roomTypes, rooms } = App.Demo.sampleTypesAndRooms();
  roomTypes.forEach((t) => Store.put('roomTypes', t));
  rooms.forEach((r) => Store.put('rooms', r));
  const b = await L.createBooking({
    guest: { name: 'Cancel Me', phone: '9000011111' }, rooms: [{ roomId: 'rm_301', rate: 1900 }],
    checkIn: U.combine(U.addDays(U.today(), 3), '12:00'), checkOut: U.combine(U.addDays(U.today(), 4), '12:00'), nights: 1, advance: 1000,
  });
  const c = L.cancelBooking(b, { reason: 'Plans changed', fee: 200, refund: 800, refundMode: 'UPI' });
  assert.equal(c.status, 'cancelled');
  const bill = L.billOf(c);
  assert.equal(bill.total, 200);
  assert.equal(bill.paid, 200);
  assert.equal(bill.balance, 0);
  assert.equal(L.availability(U.addDays(U.today(), 3), U.addDays(U.today(), 4)).get('rm_301').free, true, 'room released');
});

test('demo data is consistent', async () => {
  const App = await loadApp();
  const { L, Store, U } = App;
  const res = await App.Demo.loadDemo();
  assert.ok(res.bookings > 150, 'plenty of bookings: ' + res.bookings);
  assert.equal(Store.all('rooms').length, 20);
  // no two active bookings share a room on the same night
  const nights = new Map();
  for (const b of L.activeBookings()) {
    const [s, e] = L.stayDates(b);
    for (const d of U.datesBetween(s, e)) for (const r of b.rooms) {
      const k = r.roomId + d;
      assert.ok(!nights.has(k), `double booking ${r.number} on ${d}`);
      nights.set(k, b.code);
    }
  }
  // invoices are unique and sequential per financial year
  const inv = Store.all('bookings').filter((b) => b.invoiceNo).map((b) => b.invoiceNo);
  assert.equal(new Set(inv).size, inv.length);
  // checked-out bills are fully paid
  for (const b of Store.all('bookings').filter((x) => x.status === 'checked_out')) {
    assert.equal(L.billOf(b).balance, 0, 'balance for ' + b.code);
  }
  const d = L.dashboard();
  assert.ok(d.inHouse.length >= 5);
  assert.ok(d.arrivals.length >= 3);
  const r = L.report(U.addDays(U.today(), -29), U.today());
  assert.ok(r.occupancy > 20 && r.occupancy <= 100, 'occupancy ' + r.occupancy);
  const paySum = U.round2(U.sum(r.collections.list, (p) => (p.kind === 'refund' ? -p.amount : +p.amount)));
  assert.equal(paySum, r.collections.net);
  assert.equal(U.round2(r.invoices.cgst + r.invoices.sgst), r.invoices.tax);
  // next booking number continues after demo data
  const next = await Store.nextSeq('booking', 1000);
  assert.equal(next, 1000 + res.bookings + 1);
});

test('backup snapshot round-trip', async () => {
  const App = await loadApp();
  await App.Demo.loadDemo();
  const snap = App.Store.snapshot();
  const counts = Object.fromEntries(Object.entries(snap.data).map(([k, v]) => [k, v.length]));
  await App.Demo.startFresh({ keepRooms: true });
  assert.equal(App.Store.all('bookings').length, 0);
  assert.equal(App.Store.all('rooms').length, 20);
  assert.equal(App.Store.settings().demo, false);
  await App.Store.replaceAll(snap.data);
  for (const [k, n] of Object.entries(counts)) assert.equal(App.Store.all(k).length, n, k);
});

test('guest lookup: phone digits match as one run, names match by words', async () => {
  const { L, Store } = await loadApp();
  Store.put('guests', { id: 'a', name: 'Priya Shetty', phone: '9000059620', idNumber: '2345 6789 5512', city: 'Vizag' });
  Store.put('guests', { id: 'b', name: 'Ravi Kumar', phone: '9000055123', idNumber: '1111 2222 3333', city: 'Chennai' });
  const ids = (q) => Array.from(L.findGuests(q)).map((g) => g.id).sort().join(',');
  assert.equal(ids('90000 55'), 'b');
  assert.equal(ids('55123'), 'b');
  assert.equal(ids('+91 90000 55123'), 'b');
  assert.equal(ids('ravi'), 'b');
  assert.equal(ids('priya vizag'), 'a');
  assert.equal(ids('78955'), 'a', 'ID number digits');
  assert.equal(ids('9000'), 'a,b');
});
