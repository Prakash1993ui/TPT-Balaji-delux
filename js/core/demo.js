/*
 * Demo data: a realistic month for a 20-room Tirupati hotel, generated relative
 * to today so the dashboard always looks "live". Also contains the helpers
 * used by "Start fresh".
 */
(function (App) {
  'use strict';
  const { U } = App;
  const S = App.Store;

  const SAMPLE_TYPES = [
    { key: 'nac', name: 'Non-AC Double', rate: 900, maxAdults: 2, extraBedRate: 200, amenities: ['Fan', 'TV', 'Hot water'] },
    { key: 'ac', name: 'AC Double', rate: 1400, maxAdults: 2, extraBedRate: 300, amenities: ['AC', 'TV', 'Hot water', 'Wi-Fi'] },
    { key: 'dlx', name: 'AC Deluxe', rate: 1900, maxAdults: 3, extraBedRate: 350, amenities: ['AC', 'Smart TV', 'Hot water', 'Wi-Fi', 'Mini fridge'] },
    { key: 'fam', name: 'AC Family Suite', rate: 2900, maxAdults: 4, extraBedRate: 400, amenities: ['AC', 'Smart TV', 'Hot water', 'Wi-Fi', '4 beds', 'Sofa'] },
  ];
  const SAMPLE_ROOMS = [
    ['101', '1', 'nac'], ['102', '1', 'nac'], ['103', '1', 'nac'], ['104', '1', 'nac'], ['105', '1', 'nac'], ['106', '1', 'nac'],
    ['201', '2', 'ac'], ['202', '2', 'ac'], ['203', '2', 'ac'], ['204', '2', 'ac'], ['205', '2', 'ac'], ['206', '2', 'ac'],
    ['301', '3', 'dlx'], ['302', '3', 'dlx'], ['303', '3', 'dlx'], ['304', '3', 'dlx'], ['305', '3', 'dlx'],
    ['401', '4', 'fam'], ['402', '4', 'fam'], ['403', '4', 'fam'],
  ];
  const FIRST = ['Venkata', 'Lakshmi', 'Suresh', 'Priya', 'Anil', 'Kavitha', 'Rajesh', 'Meenakshi', 'Srinivas', 'Padmavathi',
    'Arjun', 'Divya', 'Ramesh', 'Sunita', 'Karthik', 'Harish', 'Anjali', 'Mohan', 'Sravani', 'Ganesh', 'Nandini', 'Vijay',
    'Bhavana', 'Sanjay', 'Revathi', 'Naveen', 'Swathi', 'Mahesh', 'Deepa', 'Kiran', 'Aruna', 'Satish', 'Geetha', 'Ravi',
    'Sneha', 'Prasad', 'Hema', 'Gopal', 'Keerthi', 'Balaji'];
  const LAST = ['Reddy', 'Rao', 'Naidu', 'Iyer', 'Sharma', 'Kumar', 'Murthy', 'Srinivasan', 'Menon', 'Patel', 'Gupta', 'Hegde',
    'Chowdary', 'Varma', 'Joshi', 'Subramanian', 'Nair', 'Deshmukh', 'Pillai', 'Shetty'];
  const PLACES = [
    ['Hyderabad', 'Telangana'], ['Chennai', 'Tamil Nadu'], ['Bengaluru', 'Karnataka'], ['Nellore', 'Andhra Pradesh'],
    ['Vijayawada', 'Andhra Pradesh'], ['Guntur', 'Andhra Pradesh'], ['Coimbatore', 'Tamil Nadu'], ['Madurai', 'Tamil Nadu'],
    ['Mysuru', 'Karnataka'], ['Pune', 'Maharashtra'], ['Mumbai', 'Maharashtra'], ['Kochi', 'Kerala'], ['Visakhapatnam', 'Andhra Pradesh'],
    ['Warangal', 'Telangana'], ['Kurnool', 'Andhra Pradesh'], ['Vellore', 'Tamil Nadu'], ['Salem', 'Tamil Nadu'],
    ['New Delhi', 'Delhi'], ['Ahmedabad', 'Gujarat'], ['Mangaluru', 'Karnataka'], ['Kakinada', 'Andhra Pradesh'], ['Tiruchirappalli', 'Tamil Nadu'],
  ];

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleTypesAndRooms() {
    const roomTypes = SAMPLE_TYPES.map((tp) => ({
      id: 'rt_' + tp.key, name: tp.name, rate: tp.rate, maxAdults: tp.maxAdults, extraBedRate: tp.extraBedRate,
      amenities: tp.amenities, description: '',
    }));
    const rooms = SAMPLE_ROOMS.map(([number, floor, key]) => ({
      id: 'rm_' + number, number, floor, typeId: 'rt_' + key, active: true, notes: '',
    }));
    return { roomTypes, rooms };
  }

  async function loadDemo() {
    const rnd = mulberry32(20260924);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const weighted = (pairs) => {
      const total = pairs.reduce((t, p) => t + p[1], 0);
      let x = rnd() * total;
      for (const [v, w] of pairs) if ((x -= w) < 0) return v;
      return pairs[0][0];
    };
    const t = U.today();
    const nowMs = Date.now();
    const hoursAgo = (h) => U.dtStr(new Date(nowMs - h * 36e5));

    // --- phase 1: hotel, room types, rooms
    const { roomTypes, rooms } = sampleTypesAndRooms();
    const settings = Object.assign({}, S.DEFAULT_SETTINGS, {
      id: 'main', demo: true, gstin: '37ABCDE1234F1Z5', phone: '0877 000 0000', email: 'frontdesk@example.com',
      address: 'Near Railway Station, Tirupati, Andhra Pradesh', pincode: '517501', legalName: 'TPT Balaji Delux (Demo)',
    });
    await S.replaceAll({ settings: [settings], roomTypes, rooms, housekeeping: [], guests: [], bookings: [], expenses: [] }, { push: true });

    const typeById = new Map(roomTypes.map((x) => [x.id, x]));
    const s = S.settings();

    // --- guests
    const guests = [];
    const usedNames = new Set();
    while (guests.length < 120) {
      const name = pick(FIRST) + ' ' + pick(LAST);
      if (usedNames.has(name)) continue;
      usedNames.add(name);
      const [city, state] = pick(PLACES);
      const idType = weighted([['Aadhaar', 70], ['Driving licence', 14], ['Voter ID', 8], ['Passport', 5], ['PAN card', 3]]);
      const idNumber = idType === 'Aadhaar' ? `${between(2000, 9999)} ${between(1000, 9999)} ${between(1000, 9999)}`
        : idType === 'Driving licence' ? `AP${between(10, 39)} ${between(2010, 2024)}${between(1000000, 9999999)}`
          : idType === 'Passport' ? `${pick(['K', 'M', 'N', 'P', 'T'])}${between(1000000, 9999999)}`
            : idType === 'Voter ID' ? `${pick(['ABC', 'XYZ', 'TPT', 'KLM'])}${between(1000000, 9999999)}`
              : `ABCDE${between(1000, 9999)}F`;
      guests.push({
        id: U.uid('g'), name, phone: '90000' + String(between(10000, 99999)), email: '', idType, idNumber,
        address: '', city, state, gstin: '', company: '', notes: '',
      });
    }
    guests[3].company = 'Srinivasa Tours & Travels';
    guests[3].gstin = '36AABCS1234K1Z9';
    guests[3].notes = 'Travel agent - sends groups most weekends';
    guests[7].notes = 'Prefers ground floor (elderly parents)';

    // --- room allocation helpers
    const occ = new Map(rooms.map((r) => [r.id, new Set()]));
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    function freeRoom(start, nights, typeKey, exclude = []) {
      const cands = rooms.filter((r) => (!typeKey || r.typeId === 'rt_' + typeKey) && !exclude.includes(r.id) && r.number !== '104');
      for (const r of shuffle(cands)) {
        let ok = true;
        for (let i = 0; i < nights; i++) if (occ.get(r.id).has(U.addDays(start, i))) { ok = false; break; }
        if (ok) return r;
      }
      return null;
    }
    const occupy = (roomId, start, nights) => {
      for (let i = 0; i < nights; i++) occ.get(roomId).add(U.addDays(start, i));
    };
    const sourceOf = () => weighted([['Walk-in', 42], ['Phone', 14], ['WhatsApp', 7], ['MakeMyTrip', 10], ['Goibibo', 5],
      ['Booking.com', 6], ['OYO', 5], ['Agoda', 3], ['Travel agent', 5], ['Website', 3]]);
    const modeFor = (src) => (['MakeMyTrip', 'Goibibo', 'Booking.com', 'OYO', 'Agoda'].includes(src) && rnd() < 0.7
      ? 'Online (OTA)' : weighted([['UPI', 50], ['Cash', 36], ['Card', 14]]));
    const purposeOf = () => weighted([['Darshan / pilgrimage', 70], ['Family function', 8], ['Business', 8], ['Medical', 7], ['Tourism', 7]]);

    const bookings = [];
    function makeBooking({ start, checkInAt, nights, typeKey, status, roomsCount = 1, guestIdx }) {
      const chosen = [];
      for (let i = 0; i < roomsCount; i++) {
        const r = freeRoom(start, nights, i === 0 ? typeKey : typeKey, chosen.map((c) => c.id)) || freeRoom(start, nights, null, chosen.map((c) => c.id));
        if (!r) break;
        chosen.push(r);
      }
      if (!chosen.length) return null;
      chosen.forEach((r) => occupy(r.id, start, nights));
      const g = guests[guestIdx != null ? guestIdx : between(0, guests.length - 1)];
      const source = sourceOf();
      const bRooms = chosen.map((r) => {
        const tp = typeById.get(r.typeId);
        const ota = ['MakeMyTrip', 'Goibibo', 'Booking.com', 'OYO', 'Agoda'].includes(source);
        const rate = Math.round((tp.rate * (ota ? 0.92 : 1)) / 10) * 10;
        return {
          roomId: r.id, number: r.number, typeName: tp.name, rate,
          extraBeds: tp.maxAdults >= 3 && rnd() < 0.25 ? 1 : 0, extraBedRate: tp.extraBedRate,
        };
      });
      const maxAdults = U.sum(chosen, (r) => typeById.get(r.typeId).maxAdults);
      const checkIn = checkInAt;
      const checkOut = App.L.plannedCheckOut(checkIn, nights, s);
      const b = {
        id: U.uid('b'), code: '', guestId: g.id, status, checkIn, checkOut, nights,
        plannedCheckIn: checkIn, plannedCheckOut: checkOut,
        actualCheckIn: status === 'checked_in' || status === 'checked_out' ? checkIn : null, actualCheckOut: null,
        rooms: bRooms, adults: Math.max(1, Math.min(maxAdults, between(1, maxAdults))), children: rnd() < 0.35 ? between(1, 2) : 0,
        source, purpose: purposeOf(), notes: '', discountType: 'amount', discountValue: rnd() < 0.1 ? pick([100, 150, 200]) : 0,
        charges: [], payments: [],
      };
      if (rnd() < 0.22) b.charges.push({ id: U.uid('c'), at: U.addHours(checkIn, between(2, 20)), description: pick(['Breakfast', 'Dinner', 'Meals', 'Tea & snacks']), category: 'Food & beverages', amount: pick([180, 240, 360, 450, 600]), qty: 1, gstRate: 5 });
      if (rnd() < 0.1) b.charges.push({ id: U.uid('c'), at: U.addHours(checkIn, between(3, 20)), description: 'Laundry', category: 'Laundry', amount: pick([80, 120, 200, 260]), qty: 1, gstRate: 18 });
      if (rnd() < 0.08) b.charges.push({ id: U.uid('c'), at: U.addHours(checkIn, between(1, 10)), description: 'Taxi to Tirumala', category: 'Travel / taxi', amount: pick([900, 1100, 1300]), qty: 1, gstRate: 5 });
      bookings.push(b);
      return b;
    }
    const payment = (b, at, amount, note) => {
      if (amount > 0) b.payments.push({ id: U.uid('p'), at, amount: U.round2(amount), mode: modeFor(b.source), ref: '', kind: 'payment', note, by: 'Front desk' });
    };

    // --- in-house guests (relative to now so the demo is consistent at any hour)
    const inHouse = [
      { h: 30, n: 2, type: 'ac' }, { h: 26, n: 1, type: 'nac' }, { h: 23.5, n: 1, type: 'dlx' }, { h: 20, n: 2, type: 'fam', rooms: 2, guestIdx: 3 },
      { h: 8, n: 1, type: 'ac' }, { h: 5, n: 2, type: 'dlx' }, { h: 3, n: 1, type: 'nac' }, { h: 44, n: 3, type: 'ac' }, { h: 2, n: 1, type: 'fam' },
    ];
    for (const x of inHouse) {
      const checkInAt = hoursAgo(x.h);
      const b = makeBooking({ start: U.datePart(checkInAt), checkInAt, nights: x.n, typeKey: x.type, status: 'checked_in', roomsCount: x.rooms || 1, guestIdx: x.guestIdx });
      if (!b) continue;
      const est = App.L.computeBill(b, { nights: b.nights }).total;
      payment(b, checkInAt, rnd() < 0.6 ? Math.round((est * pick([0.5, 1])) / 100) * 100 : pick([500, 1000]), 'Paid at check-in');
    }

    // --- arrivals today, a late arrival and future reservations
    const reserve = (dayOffset, nights, type, advance, roomsCount) => {
      const start = U.addDays(t, dayOffset);
      const b = makeBooking({ start, checkInAt: U.combine(start, s.checkInTime), nights, typeKey: type, status: 'reserved', roomsCount });
      if (b && advance) payment(b, hoursAgo(between(20, 200)), advance, 'Advance');
      return b;
    };
    reserve(0, 1, 'ac', 500); reserve(0, 2, 'dlx', 1000); reserve(0, 1, 'nac', 0); reserve(-1, 1, 'ac', 0);
    reserve(1, 2, 'fam', 2000, 2); reserve(1, 1, 'ac', 0); reserve(2, 1, 'dlx', 500); reserve(3, 2, 'nac', 0);
    reserve(5, 1, 'ac', 700); reserve(7, 3, 'dlx', 1500); reserve(9, 1, 'fam', 1000); reserve(12, 2, 'ac', 0);

    // --- past month of completed stays
    for (let d = -32; d <= -1; d++) {
      const day = U.addDays(t, d);
      const dow = U.parse(day).getDay();
      const count = between(4, 7) + (dow === 5 || dow === 6 || dow === 0 ? 3 : 0);
      for (let i = 0; i < count; i++) {
        const nights = weighted([[1, 62], [2, 30], [3, 8]]);
        const checkInAt = U.combine(day, U.pad(between(5, 21)) + ':' + pick(['00', '15', '30', '45']));
        if (U.parse(checkInAt).getTime() + nights * 864e5 > nowMs - 36e5) continue; // must have finished already
        const b = makeBooking({ start: day, checkInAt, nights, typeKey: weighted([['nac', 30], ['ac', 34], ['dlx', 24], ['fam', 12]]), status: 'checked_out', roomsCount: rnd() < 0.08 ? 2 : 1 });
        if (!b) continue;
        const outAt = U.addHours(b.checkOut, -between(0, 90) / 60);
        b.checkOut = outAt;
        b.actualCheckOut = outAt;
        b.billedNights = nights;
        const bill = App.L.computeBill(b, { nights });
        if (rnd() < 0.45) {
          const adv = Math.min(bill.total, pick([500, 1000, 1500]));
          payment(b, checkInAt, adv, 'Paid at check-in');
          payment(b, outAt, bill.total - adv, 'Paid at check-out');
        } else payment(b, outAt, bill.total, 'Paid at check-out');
      }
    }

    // --- cancellations & a no-show
    const cancelled = reserve(4, 2, 'ac', 1000);
    if (cancelled) {
      cancelled.status = 'cancelled';
      cancelled.cancelledAt = hoursAgo(10);
      cancelled.cancelReason = 'Darshan tickets not available';
      cancelled.cancelFee = 200;
      cancelled.payments.push({ id: U.uid('p'), at: hoursAgo(10), amount: 800, mode: 'UPI', ref: '', kind: 'refund', note: 'Refund on cancellation', by: 'Front desk' });
    }
    const ns = makeBooking({ start: U.addDays(t, -3), checkInAt: U.combine(U.addDays(t, -3), s.checkInTime), nights: 1, typeKey: 'nac', status: 'no_show' });
    if (ns) {
      ns.cancelledAt = U.combine(U.addDays(t, -2), '10:00');
      ns.cancelReason = 'Guest did not arrive';
    }

    // --- numbering, invoices (frozen bills)
    const byCreated = U.sortBy(bookings, (b) => b.plannedCheckIn);
    byCreated.forEach((b, i) => {
      b.code = s.bookingPrefix + (1001 + i);
      b.createdAt = Math.min(U.parse(b.plannedCheckIn).getTime() - between(1, 72) * 36e5, nowMs);
      b.updatedAt = b.createdAt;
      b.createdBy = 'Front desk';
    });
    const fyCounters = {};
    for (const b of U.sortBy(bookings.filter((x) => x.status === 'checked_out'), (x) => x.checkOut)) {
      const fy = U.fy(b.checkOut);
      fyCounters[fy] = (fyCounters[fy] || 0) + 1;
      b.invoiceNo = [s.invoicePrefix, U.fyShort(b.checkOut), String(fyCounters[fy]).padStart(4, '0')].join('/');
      b.invoiceDate = b.checkOut;
      const bill = App.L.computeBill(b, { nights: b.billedNights });
      ['received', 'refunded', 'paid', 'balance'].forEach((k) => delete bill[k]);
      b.bill = bill;
      const g = guests.find((x) => x.id === b.guestId);
      b.billTo = { name: g.name, phone: g.phone, email: '', address: g.address, city: g.city, state: g.state, gstin: g.gstin, company: g.company };
      b.issuer = {
        hotelName: s.hotelName, legalName: s.legalName, address: s.address, pincode: s.pincode, phone: s.phone, email: s.email,
        gstin: s.gstin, stateName: s.stateName, stateCode: s.stateCode, sacCode: s.sacCode, invoiceTerms: s.invoiceTerms, invoiceFooter: s.invoiceFooter,
      };
      b.updatedAt = U.parse(b.checkOut).getTime();
    }

    // --- housekeeping
    const housekeeping = [];
    const dirty = new Set();
    bookings
      .filter((b) => b.status === 'checked_out' && U.datePart(b.checkOut) === t)
      .filter((b) => nowMs - U.parse(b.checkOut).getTime() < 3 * 36e5 || rnd() < 0.35) // older check-outs are mostly cleaned already
      .forEach((b) => b.rooms.forEach((r) => dirty.add(r.roomId)));
    const occupiedNow = new Set();
    bookings.filter((b) => b.status === 'checked_in').forEach((b) => b.rooms.forEach((r) => occupiedNow.add(r.roomId)));
    rooms.forEach((r) => {
      if (r.number === '104') housekeeping.push({ id: r.id, status: 'dirty', oos: true, oosReason: 'Geyser not working - technician called', assignedTo: '', note: '' });
      else if (dirty.has(r.id) || (!occupiedNow.has(r.id) && rnd() < 0.05)) housekeeping.push({ id: r.id, status: 'dirty', oos: false, assignedTo: pick(['Lakshmamma', 'Ramu', 'Saritha']), note: '' });
      else housekeeping.push({ id: r.id, status: rnd() < 0.3 ? 'inspected' : 'clean', oos: false, assignedTo: '', note: '' });
    });

    // --- expenses
    const expenses = [];
    const exp = (dayOffset, category, amount, paidTo, mode, note) =>
      expenses.push({ id: U.uid('ex'), date: U.addDays(t, dayOffset), category, amount, paidTo, mode, note: note || '' });
    const monthStart = U.startOfMonth(t);
    const lastMonthStart = U.startOfMonth(U.addDays(monthStart, -1));
    [lastMonthStart, monthStart].forEach((m) => {
      const off = U.diffDays(t, m);
      if (off <= 0 && off > -40) {
        exp(off, 'Salaries', 68000, 'Staff (6)', 'Bank transfer', 'Monthly salaries');
        if (off + 1 <= 0) exp(off + 1, 'Rent', 45000, 'Building owner', 'Bank transfer', 'Monthly rent');
      }
      if (off + 6 <= 0 && off + 6 > -40) {
        exp(off + 6, 'Electricity', 21450, 'APSPDCL', 'UPI', 'Electricity bill');
        exp(off + 6, 'Internet & phone', 1180, 'Broadband', 'UPI');
      }
      if (off + 9 <= 0 && off + 9 > -40) exp(off + 9, 'Water', 2600, 'Water tanker', 'Cash');
    });
    for (let d = -32; d <= 0; d++) {
      if (d % 2 === 0) exp(d, 'Laundry', between(4, 12) * 90, 'Sri Sai Laundry', 'Cash', 'Bed sheets & towels');
      if (d % 7 === -3) exp(d, 'Housekeeping supplies', between(900, 2200), 'Balaji Traders', 'UPI', 'Soaps, cleaning liquids, toiletries');
      if (rnd() < 0.12) exp(d, 'Maintenance & repairs', pick([450, 800, 1200, 2500, 3400]), pick(['Electrician', 'Plumber', 'AC service']), 'Cash', pick(['Fan repair', 'Tap leakage', 'AC gas refill', 'Switch board']));
      if (rnd() < 0.08) exp(d, 'Commission', pick([1200, 1850, 2300]), pick(['MakeMyTrip', 'Booking.com', 'Travel agent']), 'Bank transfer', 'Booking commission');
    }

    // --- phase 2: save everything in one batch
    S.batch(() => {
      guests.forEach((g) => S.put('guests', g));
      bookings.forEach((b) => {
        const keep = { createdAt: b.createdAt, createdBy: b.createdBy };
        S.put('bookings', Object.assign(b, keep));
      });
      housekeeping.forEach((h) => S.put('housekeeping', h));
      expenses.forEach((e) => S.put('expenses', e));
    });
    // numbering continues after the demo (server-side counters in server mode)
    await S.setSeq('booking', 1000 + bookings.length);
    for (const fy of Object.keys(fyCounters)) await S.setSeq('invoice:' + fy, fyCounters[fy]);
    await S.flush();
    return { bookings: bookings.length, guests: guests.length };
  }

  /** Wipe operational data. keepRooms keeps room types & rooms (and the hotel profile unless it is demo data). */
  async function startFresh({ keepRooms = true, profile = null } = {}) {
    const cur = S.settings();
    const main = Object.assign({}, S.DEFAULT_SETTINGS, cur.demo ? {} : cur, profile || {}, { id: 'main', demo: false });
    if (cur.demo && !profile) Object.assign(main, { gstin: '', phone: '', email: '', legalName: '' });
    await S.replaceAll({
      settings: [main],
      roomTypes: keepRooms ? S.all('roomTypes') : [],
      rooms: keepRooms ? S.all('rooms') : [],
      housekeeping: [], guests: [], bookings: [], expenses: [],
    }, { push: true });
  }

  App.Demo = { loadDemo, startFresh, sampleTypesAndRooms, SAMPLE_TYPES };
})(window.App = window.App || {});
