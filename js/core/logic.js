/*
 * Hotel domain logic: room status, availability, stay length, GST billing,
 * booking actions (reserve / check-in / check-out / cancel) and reports.
 *
 * Booking record
 * {
 *   id, code, guestId, status: reserved | checked_in | checked_out | cancelled | no_show,
 *   checkIn, checkOut            best known times ('YYYY-MM-DDTHH:mm'); actual once they happen
 *   plannedCheckIn, plannedCheckOut, actualCheckIn, actualCheckOut,
 *   nights                        planned nights
 *   rooms: [{ roomId, number, typeName, rate, extraBeds, extraBedRate }]
 *   adults, children, source, purpose, notes,
 *   discountType: 'amount' | 'percent', discountValue,
 *   charges:  [{ id, at, description, category, amount, qty, gstRate }]
 *   payments: [{ id, at, amount, mode, ref, note, kind: 'payment' | 'refund', by }]
 *   // after check-out (immutable invoice snapshot)
 *   billedNights, invoiceNo, invoiceDate, bill, billTo, issuer
 *   // after cancellation
 *   cancelledAt, cancelReason, cancelFee
 * }
 */
(function (App) {
  'use strict';
  const { U } = App;
  const S = App.Store;

  const BOOKING_STATUS = {
    reserved: { label: 'Reserved', tone: 'info' },
    checked_in: { label: 'In house', tone: 'indigo' },
    checked_out: { label: 'Checked out', tone: 'muted' },
    cancelled: { label: 'Cancelled', tone: 'danger' },
    no_show: { label: 'No-show', tone: 'warn' },
  };
  const ROOM_STATE = {
    vacant: { label: 'Vacant', tone: 'ok', icon: 'doorOpen' },
    dirty: { label: 'Dirty', tone: 'warn', icon: 'brush' },
    arriving: { label: 'Arriving', tone: 'info', icon: 'luggage' },
    occupied: { label: 'Occupied', tone: 'indigo', icon: 'bed' },
    dueout: { label: 'Due out', tone: 'violet', icon: 'clock' },
    overdue: { label: 'Overdue', tone: 'danger', icon: 'alert' },
    oos: { label: 'Out of order', tone: 'muted', icon: 'wrench' },
  };
  const HK_STATUS = {
    clean: { label: 'Clean', tone: 'ok' },
    dirty: { label: 'Dirty', tone: 'warn' },
    inspected: { label: 'Inspected', tone: 'info' },
  };

  // Memoisation that resets whenever the store changes.
  let memoVersion = -1;
  const memoMap = new Map();
  function memo(key, fn) {
    if (memoVersion !== S.version) {
      memoMap.clear();
      memoVersion = S.version;
    }
    if (memoMap.has(key)) return memoMap.get(key);
    const v = fn();
    memoMap.set(key, v);
    return v;
  }

  // ---------------------------------------------------------------- lookups
  const room = (id) => S.get('rooms', id);
  const roomType = (id) => S.get('roomTypes', id);
  const guest = (id) => S.get('guests', id);
  const rooms = () =>
    memo('rooms', () => S.all('rooms').filter((r) => r.active !== false).sort((a, b) => U.natCmp(a.number, b.number)));
  const allRoomsSorted = () => memo('allRooms', () => [...S.all('rooms')].sort((a, b) => U.natCmp(a.number, b.number)));
  const roomTypes = () => memo('types', () => U.sortBy(S.all('roomTypes'), (t) => +t.rate || 0));
  const floors = () => memo('floors', () => U.uniq(rooms().map((r) => String(r.floor ?? ''))).sort(U.natCmp));
  const guestName = (b) => (b && ((guest(b.guestId) || {}).name || (b.billTo && b.billTo.name))) || 'Guest';
  const guestOf = (b) => guest(b.guestId) || b.billTo || {};
  const roomNumbers = (b) =>
    (b.rooms || []).map((r) => (room(r.roomId) || {}).number || r.number || '?').sort(U.natCmp).join(', ');
  const hk = (roomId) => S.get('housekeeping', roomId) || { id: roomId, status: 'clean', oos: false };

  // ---------------------------------------------------------------- stay length
  function nightsFor(checkIn, checkOut, s = S.settings()) {
    const a = U.parse(checkIn), b = U.parse(checkOut);
    if (!a || !b || b <= a) return 1;
    const grace = (+s.graceMinutes || 0) / 60;
    if (s.checkoutMode === '24h') {
      const hours = (b - a) / 36e5 - grace;
      return Math.max(1, Math.ceil(hours / 24 - 1e-9));
    }
    let n = U.diffDays(a, b);
    const [h, m] = String(s.checkOutTime || '11:00').split(':').map(Number);
    const limit = new Date(b.getFullYear(), b.getMonth(), b.getDate(), h || 0, m || 0).getTime() + grace * 36e5;
    if (n >= 1 && b.getTime() > limit) n += 1; // stayed past check-out time
    return Math.max(1, n);
  }
  function plannedCheckOut(checkIn, nights, s = S.settings()) {
    nights = Math.max(1, +nights || 1);
    if (s.checkoutMode === '24h') return U.addHours(checkIn, 24 * nights);
    return U.combine(U.addDays(U.datePart(checkIn), nights), s.checkOutTime || '11:00');
  }
  /** Nights occupied as date strings [start, end). In-house guests past check-out still hold the room tonight. */
  function stayDates(b) {
    const start = U.datePart(b.checkIn);
    let end = U.datePart(b.checkOut);
    if (U.diffDays(start, end) < 1) end = U.addDays(start, 1);
    if (b.status === 'checked_in') {
      const tomorrow = U.addDays(U.today(), 1);
      if (end < tomorrow) end = tomorrow;
    }
    return [start, end];
  }
  function isOverdue(b, at = Date.now()) {
    if (b.status !== 'checked_in') return false;
    return at > U.parse(b.checkOut).getTime() + (+S.settings().graceMinutes || 0) * 60000;
  }
  const isDueToday = (b) => b.status === 'checked_in' && U.datePart(b.checkOut) <= U.today();
  const isArrivalDue = (b) => b.status === 'reserved' && U.datePart(b.checkIn) <= U.today();
  const isLateArrival = (b) => b.status === 'reserved' && U.datePart(b.checkIn) < U.today();

  // ---------------------------------------------------------------- availability
  const ACTIVE = new Set(['reserved', 'checked_in']);
  const activeBookings = () => memo('active', () => S.all('bookings').filter((b) => ACTIVE.has(b.status)));
  function overlaps(b, start, end) {
    const [s0, e0] = stayDates(b);
    return s0 < end && start < e0;
  }
  function roomConflicts(roomId, start, end, excludeId) {
    return activeBookings().filter(
      (b) => b.id !== excludeId && (b.rooms || []).some((r) => r.roomId === roomId) && overlaps(b, start, end)
    );
  }
  /** Map roomId -> { free, conflicts, oos } for nights [start, end). */
  function availability(start, end, excludeId) {
    return memo(`avail:${start}:${end}:${excludeId || ''}`, () => {
      const out = new Map();
      const includesToday = start <= U.today() && U.today() < end;
      for (const r of rooms()) {
        const conflicts = roomConflicts(r.id, start, end, excludeId);
        const oos = !!hk(r.id).oos && includesToday;
        out.set(r.id, { free: !conflicts.length && !oos, conflicts, oos });
      }
      return out;
    });
  }

  // ---------------------------------------------------------------- room status board
  function roomStatus(roomId) {
    return memo(`rs:${roomId}:${U.now()}`, () => {
      const t = U.today();
      const mine = activeBookings().filter((b) => (b.rooms || []).some((r) => r.roomId === roomId));
      const inHouse = mine.find((b) => b.status === 'checked_in') || null;
      const reservations = U.sortBy(mine.filter((b) => b.status === 'reserved'), (b) => b.checkIn);
      const arriving = reservations.find((b) => U.datePart(b.checkIn) <= t) || null;
      const next = reservations.find((b) => U.datePart(b.checkIn) > t) || null;
      const h = hk(roomId);
      let state;
      if (inHouse) state = isOverdue(inHouse) ? 'overdue' : isDueToday(inHouse) ? 'dueout' : 'occupied';
      else if (h.oos) state = 'oos';
      else if (arriving) state = 'arriving';
      else if (h.status === 'dirty') state = 'dirty';
      else state = 'vacant';
      return { state, booking: inHouse, arriving, next, hk: h };
    });
  }

  // ---------------------------------------------------------------- GST & billing
  function gstRateFor(perNight, s = S.settings()) {
    if (!s.gstEnabled) return 0;
    const slabs = [...(s.gstSlabs || [])].sort(
      (a, b) => (a.upTo == null || a.upTo === '' ? Infinity : +a.upTo) - (b.upTo == null || b.upTo === '' ? Infinity : +b.upTo)
    );
    for (const sl of slabs) {
      const rate = +sl.rate || 0;
      const taxable = s.ratesIncludeGst ? perNight / (1 + rate / 100) : perNight;
      if (sl.upTo == null || sl.upTo === '' || taxable <= +sl.upTo + 1e-9) return rate;
    }
    return 0;
  }
  function paymentsSummary(b) {
    let received = 0, refunded = 0;
    for (const p of b.payments || []) {
      if (p.kind === 'refund') refunded += +p.amount || 0;
      else received += +p.amount || 0;
    }
    return { received: U.round2(received), refunded: U.round2(refunded), paid: U.round2(received - refunded) };
  }
  function computeBill(b, opts = {}) {
    const s = S.settings();
    const nights = Math.max(1, +(opts.nights || b.billedNights || b.nights) || nightsFor(b.checkIn, b.checkOut, s));
    const incl = !!(s.ratesIncludeGst && s.gstEnabled);
    const lines = (b.rooms || []).map((r) => {
      const rm = room(r.roomId);
      const rt = rm && roomType(rm.typeId);
      const bedRate = r.extraBedRate != null && r.extraBedRate !== '' ? +r.extraBedRate : rt ? +rt.extraBedRate || 0 : 0;
      const perNight = U.round2((+r.rate || 0) + (+r.extraBeds || 0) * bedRate);
      return {
        roomId: r.roomId,
        number: (rm && rm.number) || r.number || '?',
        typeName: (rt && rt.name) || r.typeName || '',
        rate: +r.rate || 0,
        extraBeds: +r.extraBeds || 0,
        bedRate,
        perNight,
        nights,
        gross: U.round2(perNight * nights),
      };
    });
    const roomGross = U.round2(U.sum(lines, (l) => l.gross));
    let discount = 0;
    if (+b.discountValue > 0) {
      discount = b.discountType === 'percent'
        ? (roomGross * Math.min(100, +b.discountValue)) / 100
        : Math.min(roomGross, +b.discountValue);
    }
    discount = U.round2(discount);
    const taxRows = {};
    const addTax = (rate, taxable, tax) => {
      const t = taxRows[rate] || (taxRows[rate] = { rate, taxable: 0, tax: 0 });
      t.taxable += taxable;
      t.tax += tax;
    };
    let allocated = 0;
    lines.forEach((l, i) => {
      l.discount = i === lines.length - 1 ? U.round2(discount - allocated) : roomGross ? U.round2((discount * l.gross) / roomGross) : 0;
      allocated = U.round2(allocated + l.discount);
      l.net = U.round2(l.gross - l.discount);
      l.gstRate = gstRateFor(l.net / l.nights, s);
      l.taxable = incl ? U.round2(l.net / (1 + l.gstRate / 100)) : l.net;
      l.tax = incl ? U.round2(l.net - l.taxable) : U.round2((l.taxable * l.gstRate) / 100);
      addTax(l.gstRate, l.taxable, l.tax);
    });
    const accommodationRate = lines.length ? Math.max(...lines.map((l) => l.gstRate)) : gstRateFor(0, s);
    const charges = (b.charges || []).map((c) => {
      const gross = U.round2((+c.amount || 0) * (+c.qty || 1));
      const rate = !s.gstEnabled ? 0 : c.gstRate == null || c.gstRate === '' ? accommodationRate : +c.gstRate || 0;
      const taxable = incl ? U.round2(gross / (1 + rate / 100)) : gross;
      const tax = incl ? U.round2(gross - taxable) : U.round2((taxable * rate) / 100);
      addTax(rate, taxable, tax);
      return Object.assign({}, c, { gross, gstRate: rate, taxable, tax });
    });
    const chargesGross = U.round2(U.sum(charges, (c) => c.gross));
    const taxable = U.round2(U.sum(lines, (l) => l.taxable) + U.sum(charges, (c) => c.taxable));
    const tax = U.round2(U.sum(lines, (l) => l.tax) + U.sum(charges, (c) => c.tax));
    const cgst = U.round2(tax / 2);
    const sgst = U.round2(tax - cgst);
    const exact = U.round2(taxable + tax);
    const total = Math.round(exact);
    const taxes = Object.values(taxRows)
      .filter((t) => t.taxable > 0 || t.tax > 0)
      .map((t) => {
        const tx = U.round2(t.tax);
        const c = U.round2(tx / 2);
        return { rate: t.rate, taxable: U.round2(t.taxable), tax: tx, cgst: c, sgst: U.round2(tx - c) };
      })
      .sort((a, b) => a.rate - b.rate);
    const pay = paymentsSummary(b);
    return {
      nights, lines, roomGross, discount, roomNet: U.round2(roomGross - discount), charges, chargesGross,
      taxable, tax, cgst, sgst, taxes, exact, roundOff: U.round2(total - exact), total,
      received: pay.received, refunded: pay.refunded, paid: pay.paid, balance: U.round2(total - pay.paid),
      gstEnabled: !!s.gstEnabled, inclusive: incl,
    };
  }
  /** Bill for any booking: frozen invoice after check-out, live folio before. */
  function billOf(b) {
    return memo(`bill:${b.id}:${b.updatedAt}:${b.status === 'checked_in' ? U.now() : ''}`, () => {
      const pay = paymentsSummary(b);
      if (b.status === 'checked_out' && b.bill) {
        return Object.assign({}, b.bill, pay, { balance: U.round2(b.bill.total - pay.paid) });
      }
      if (b.status === 'cancelled' || b.status === 'no_show') {
        const fee = U.round2(+b.cancelFee || 0);
        return {
          nights: 0, lines: [], charges: [], roomGross: 0, discount: 0, roomNet: 0, chargesGross: 0, taxable: fee, tax: 0,
          cgst: 0, sgst: 0, taxes: [], exact: fee, roundOff: 0, total: fee, cancelled: true,
          received: pay.received, refunded: pay.refunded, paid: pay.paid, balance: U.round2(fee - pay.paid),
        };
      }
      const nights = b.status === 'checked_in' ? Math.max(b.nights || 1, liveNights(b)) : b.nights;
      return computeBill(b, { nights });
    });
  }
  /** Nights chargeable if the guest checked out right now (never less than planned is decided by caller). */
  function liveNights(b) {
    if (b.status !== 'checked_in') return b.nights || 1;
    const end = Math.max(Date.now(), U.parse(b.checkOut).getTime());
    return nightsFor(b.checkIn, U.dtStr(new Date(end)));
  }
  const totals = (b) => {
    const bill = billOf(b);
    return { total: bill.total, paid: bill.paid, balance: bill.balance };
  };

  // ---------------------------------------------------------------- payments ledger
  const allPayments = () =>
    memo('payments', () => {
      const out = [];
      for (const b of S.all('bookings')) for (const p of b.payments || []) out.push(Object.assign({ booking: b }, p));
      return out.sort((a, b) => (a.at < b.at ? 1 : -1));
    });

  // ---------------------------------------------------------------- actions
  const pid = () => U.uid('p');
  function upsertGuest(g) {
    const clean = Object.assign({}, g, {
      name: (g.name || '').trim(),
      phone: (g.phone || '').trim(),
      idNumber: (g.idNumber || '').trim(),
    });
    if (clean.id && S.get('guests', clean.id)) return S.put('guests', Object.assign({}, S.get('guests', clean.id), clean));
    delete clean.id;
    return S.put('guests', clean);
  }
  function roomEntry(r) {
    const rm = room(r.roomId);
    const rt = rm && roomType(rm.typeId);
    return {
      roomId: r.roomId,
      number: rm ? rm.number : r.number,
      typeName: rt ? rt.name : r.typeName || '',
      rate: +r.rate || 0,
      extraBeds: +r.extraBeds || 0,
      extraBedRate: r.extraBedRate != null && r.extraBedRate !== '' ? +r.extraBedRate : rt ? +rt.extraBedRate || 0 : 0,
    };
  }

  /** Create a reservation, or a walk-in that is checked in immediately. */
  async function createBooking(input) {
    const s = S.settings();
    const seq = await S.nextSeq('booking', 1000);
    const g = upsertGuest(input.guest);
    const nowS = U.now();
    const walkIn = !!input.checkInNow;
    const checkIn = walkIn ? nowS : input.checkIn;
    const nights = Math.max(1, +input.nights || 1);
    const checkOut = walkIn && s.checkoutMode === '24h' ? plannedCheckOut(nowS, nights, s) : input.checkOut;
    const payments = [];
    if (+input.advance > 0) {
      payments.push({
        id: pid(), at: nowS, amount: U.round2(+input.advance), mode: input.advanceMode || 'Cash', ref: input.advanceRef || '',
        kind: 'payment', note: walkIn ? 'Paid at check-in' : 'Advance', by: S.user.name,
      });
    }
    return S.put('bookings', {
      code: (s.bookingPrefix || '') + seq,
      guestId: g.id,
      status: walkIn ? 'checked_in' : 'reserved',
      checkIn, checkOut, nights,
      plannedCheckIn: input.checkIn, plannedCheckOut: input.checkOut,
      actualCheckIn: walkIn ? nowS : null, actualCheckOut: null,
      rooms: input.rooms.map(roomEntry),
      adults: +input.adults || 1, children: +input.children || 0,
      source: input.source || 'Walk-in', purpose: input.purpose || '', notes: input.notes || '',
      discountType: input.discountType || 'amount', discountValue: +input.discountValue || 0,
      charges: [], payments,
    });
  }

  function updateBooking(b, changes) {
    const next = Object.assign({}, b, changes);
    if (changes.rooms) next.rooms = changes.rooms.map(roomEntry);
    return S.put('bookings', next);
  }

  function checkIn(b, opts = {}) {
    const s = S.settings();
    const nowS = U.now();
    const nights = Math.max(1, +(opts.nights || b.nights) || 1);
    const checkOut = plannedCheckOut(nowS, nights, s);
    const next = Object.assign({}, b, {
      status: 'checked_in', checkIn: nowS, actualCheckIn: nowS, checkOut, nights,
    });
    if (opts.rooms) next.rooms = opts.rooms.map(roomEntry);
    if (+opts.payment > 0) {
      next.payments = [...(b.payments || []), {
        id: pid(), at: nowS, amount: U.round2(+opts.payment), mode: opts.paymentMode || 'Cash', ref: opts.paymentRef || '',
        kind: 'payment', note: 'Paid at check-in', by: S.user.name,
      }];
    }
    return S.put('bookings', next);
  }

  function issuerSnapshot(s) {
    const keys = ['hotelName', 'legalName', 'address', 'pincode', 'phone', 'email', 'gstin', 'stateName', 'stateCode', 'sacCode', 'invoiceTerms', 'invoiceFooter'];
    const o = {};
    keys.forEach((k) => (o[k] = s[k]));
    return o;
  }

  /** Final check-out: freezes the invoice and marks rooms dirty. */
  async function checkOut(b, opts = {}) {
    const s = S.settings();
    const outAt = U.now();
    const next = Object.assign({}, b, { status: 'checked_out', checkOut: outAt, actualCheckOut: outAt });
    if (opts.discountType != null) next.discountType = opts.discountType;
    if (opts.discountValue != null) next.discountValue = +opts.discountValue || 0;
    if (+opts.payment > 0) {
      next.payments = [...(b.payments || []), {
        id: pid(), at: outAt, amount: U.round2(+opts.payment), mode: opts.paymentMode || 'Cash', ref: opts.paymentRef || '',
        kind: 'payment', note: 'Paid at check-out', by: S.user.name,
      }];
    }
    const nights = Math.max(1, +opts.nights || nightsFor(b.checkIn, outAt, s));
    next.billedNights = nights;
    const bill = computeBill(next, { nights });
    const seq = await S.nextSeq('invoice:' + U.fy(outAt), 0);
    next.invoiceNo = [s.invoicePrefix, U.fyShort(outAt), String(seq).padStart(4, '0')].filter(Boolean).join('/');
    next.invoiceDate = outAt;
    const frozen = Object.assign({}, bill);
    ['received', 'refunded', 'paid', 'balance'].forEach((k) => delete frozen[k]);
    next.bill = frozen;
    const g = guest(b.guestId) || {};
    next.billTo = {
      name: g.name || 'Guest', phone: g.phone || '', email: g.email || '', address: g.address || '', city: g.city || '',
      state: g.state || '', gstin: g.gstin || '', company: g.company || '',
    };
    next.issuer = issuerSnapshot(s);
    S.batch(() => {
      S.put('bookings', next);
      for (const r of next.rooms || []) {
        S.put('housekeeping', Object.assign({}, hk(r.roomId), { id: r.roomId, status: 'dirty', at: outAt, by: S.user.name }));
      }
    });
    return S.get('bookings', next.id);
  }

  function cancelBooking(b, opts = {}) {
    const nowS = U.now();
    const next = Object.assign({}, b, {
      status: opts.noShow ? 'no_show' : 'cancelled',
      cancelledAt: nowS,
      cancelReason: opts.reason || '',
      cancelFee: U.round2(+opts.fee || 0),
    });
    if (+opts.refund > 0) {
      next.payments = [...(b.payments || []), {
        id: pid(), at: nowS, amount: U.round2(+opts.refund), mode: opts.refundMode || 'Cash', ref: '',
        kind: 'refund', note: 'Refund on cancellation', by: S.user.name,
      }];
    }
    return S.put('bookings', next);
  }

  function addPayment(b, p) {
    return S.put('bookings', Object.assign({}, b, {
      payments: [...(b.payments || []), {
        id: pid(), at: p.at || U.now(), amount: U.round2(+p.amount), mode: p.mode || 'Cash', ref: p.ref || '',
        note: p.note || '', kind: p.kind === 'refund' ? 'refund' : 'payment', by: S.user.name,
      }],
    }));
  }
  const removePayment = (b, id) => S.put('bookings', Object.assign({}, b, { payments: (b.payments || []).filter((p) => p.id !== id) }));
  function addCharge(b, c) {
    return S.put('bookings', Object.assign({}, b, {
      charges: [...(b.charges || []), {
        id: U.uid('c'), at: c.at || U.now(), description: (c.description || c.category || 'Charge').trim(),
        category: c.category || 'Other', amount: U.round2(+c.amount), qty: +c.qty || 1,
        gstRate: c.gstRate === '' || c.gstRate == null ? null : +c.gstRate, by: S.user.name,
      }],
    }));
  }
  const removeCharge = (b, id) => S.put('bookings', Object.assign({}, b, { charges: (b.charges || []).filter((c) => c.id !== id) }));
  function setHK(roomId, changes) {
    return S.put('housekeeping', Object.assign({}, hk(roomId), changes, { id: roomId, at: U.now(), by: S.user.name }));
  }

  // ---------------------------------------------------------------- guests
  function guestHistory(guestId) {
    return memo('gh:' + guestId, () => {
      const list = U.sortBy(S.all('bookings').filter((b) => b.guestId === guestId), (b) => b.checkIn, -1);
      const stays = list.filter((b) => b.status === 'checked_out' || b.status === 'checked_in');
      const spent = U.sum(list.filter((b) => b.status === 'checked_out'), (b) => billOf(b).total);
      return { bookings: list, stays: stays.length, spent, last: stays[0] || null };
    });
  }
  function findGuests(q, limit = 8) {
    q = String(q || '').trim();
    const d = U.digits(q);
    // phone-like query (only digits, spaces, + or -): match the digits as one run in phone / ID number
    const phoneLike = d.length >= 3 && /^[\d\s+()-]+$/.test(q);
    const found = S.all('guests').filter((g) => phoneLike
      ? U.digits(g.phone).includes(d.length > 10 && d.startsWith('91') ? d.slice(2) : d) || U.digits(g.idNumber).includes(d)
      : U.matches(q, g.name, g.city, g.company, g.email, g.idNumber, g.phone));
    // phones that start with the typed digits first
    return phoneLike ? U.sortBy(found, (g) => (U.digits(g.phone).startsWith(d) ? 0 : 1)).slice(0, limit) : found.slice(0, limit);
  }

  // ---------------------------------------------------------------- dashboard
  function dashboard() {
    return memo('dash:' + U.now(), () => {
      const t = U.today();
      const rs = rooms().map((r) => Object.assign({ room: r }, roomStatus(r.id)));
      const counts = {};
      Object.keys(ROOM_STATE).forEach((k) => (counts[k] = 0));
      rs.forEach((x) => counts[x.state]++);
      const bookings = S.all('bookings');
      const inHouse = bookings.filter((b) => b.status === 'checked_in');
      const occupiedIds = new Set();
      inHouse.forEach((b) => (b.rooms || []).forEach((r) => occupiedIds.add(r.roomId)));
      const arrivals = U.sortBy(bookings.filter(isArrivalDue), (b) => b.checkIn);
      const departures = U.sortBy(inHouse.filter(isDueToday), (b) => b.checkOut);
      const arrivedToday = bookings.filter((b) => b.actualCheckIn && U.datePart(b.actualCheckIn) === t && b.status !== 'cancelled').length;
      const departedToday = bookings.filter((b) => b.status === 'checked_out' && U.datePart(b.checkOut) === t).length;
      const pays = allPayments();
      const net = (p) => (p.kind === 'refund' ? -1 : 1) * (+p.amount || 0);
      const collectedToday = U.sum(pays.filter((p) => U.datePart(p.at) === t), net);
      const monthStart = U.startOfMonth(t);
      const collectedMonth = U.sum(pays.filter((p) => U.datePart(p.at) >= monthStart && U.datePart(p.at) <= t), net);
      const days = U.datesBetween(U.addDays(t, -13), U.addDays(t, 1));
      const byDay = new Map(days.map((d) => [d, 0]));
      pays.forEach((p) => {
        const d = U.datePart(p.at);
        if (byDay.has(d)) byDay.set(d, byDay.get(d) + net(p));
      });
      const pendingBalance = U.sum(inHouse, (b) => Math.max(0, billOf(b).balance));
      const upcoming = U.sortBy(bookings.filter((b) => b.status === 'reserved' && U.datePart(b.checkIn) > t), (b) => b.checkIn).slice(0, 6);
      const total = rs.length;
      const sellable = total - counts.oos;
      return {
        rooms: rs, counts, total,
        occupied: occupiedIds.size,
        occupancy: sellable > 0 ? (occupiedIds.size / sellable) * 100 : 0,
        inHouse, guestsInHouse: U.sum(inHouse, (b) => (+b.adults || 0) + (+b.children || 0)),
        arrivals, departures, arrivedToday, departedToday, upcoming,
        collectedToday, collectedMonth, pendingBalance,
        chart: days.map((d) => ({ date: d, value: U.round2(byDay.get(d)) })),
      };
    });
  }

  // ---------------------------------------------------------------- reports
  function report(start, end) {
    return memo(`report:${start}:${end}`, () => {
      const endEx = U.addDays(end, 1);
      const inRange = (d) => d >= start && d < endEx;
      const days = U.datesBetween(start, endEx);
      const roomCount = rooms().length;
      const perDay = new Map(days.map((d) => [d, { date: d, occupied: 0, roomRevenue: 0, collected: 0, expenses: 0, arrivals: 0 }]));
      const bookings = S.all('bookings');

      for (const b of bookings) {
        if (b.status !== 'checked_in' && b.status !== 'checked_out') continue;
        const [s0, e0] = stayDates(b);
        if (e0 <= start || s0 >= endEx) continue;
        const bill = billOf(b);
        const dateNights = Math.max(1, U.diffDays(s0, e0));
        const perNightRevenue = U.sum(bill.lines || [], (l) => l.taxable) / dateNights;
        const roomsInBooking = (b.rooms || []).length;
        for (const d of U.datesBetween(s0 > start ? s0 : start, e0 < endEx ? e0 : endEx)) {
          const x = perDay.get(d);
          if (!x) continue;
          x.occupied += roomsInBooking;
          x.roomRevenue += perNightRevenue;
        }
        const ci = U.datePart(b.actualCheckIn || b.checkIn);
        if (perDay.has(ci)) perDay.get(ci).arrivals += 1;
      }

      const payments = allPayments().filter((p) => inRange(U.datePart(p.at)));
      const byMode = {};
      let collected = 0, refunds = 0;
      for (const p of payments) {
        const amt = +p.amount || 0;
        const d = perDay.get(U.datePart(p.at));
        if (p.kind === 'refund') {
          refunds += amt;
          if (d) d.collected -= amt;
        } else {
          collected += amt;
          byMode[p.mode || 'Other'] = (byMode[p.mode || 'Other'] || 0) + amt;
          if (d) d.collected += amt;
        }
      }

      const expenses = S.all('expenses').filter((e) => inRange(e.date));
      const byCategory = {};
      for (const e of expenses) {
        byCategory[e.category || 'Other'] = (byCategory[e.category || 'Other'] || 0) + (+e.amount || 0);
        const d = perDay.get(e.date);
        if (d) d.expenses += +e.amount || 0;
      }

      const invoices = U.sortBy(
        bookings.filter((b) => b.status === 'checked_out' && b.invoiceNo && inRange(U.datePart(b.invoiceDate || b.checkOut))),
        (b) => b.invoiceDate || b.checkOut
      );
      const invRows = invoices.map((b) => ({ b, bill: billOf(b) }));
      const taxBySlab = {};
      for (const { bill } of invRows) {
        for (const t of bill.taxes || []) {
          const x = taxBySlab[t.rate] || (taxBySlab[t.rate] = { rate: t.rate, taxable: 0, cgst: 0, sgst: 0, tax: 0 });
          x.taxable += t.taxable; x.cgst += t.cgst; x.sgst += t.sgst; x.tax += t.tax;
        }
      }

      const created = bookings.filter((b) => inRange(U.datePart(b.plannedCheckIn || b.checkIn)));
      const bySource = {};
      for (const b of created) {
        if (b.status === 'cancelled' || b.status === 'no_show') continue;
        const k = b.source || 'Walk-in';
        const x = bySource[k] || (bySource[k] = { source: k, bookings: 0, revenue: 0 });
        x.bookings += 1;
        x.revenue += billOf(b).total;
      }
      const cancellations = bookings.filter((b) => (b.status === 'cancelled' || b.status === 'no_show') && inRange(U.datePart(b.cancelledAt || b.checkIn)));

      const dayRows = [...perDay.values()].map((d) => Object.assign(d, {
        roomRevenue: U.round2(d.roomRevenue), collected: U.round2(d.collected), expenses: U.round2(d.expenses),
        occupancy: roomCount ? (d.occupied / roomCount) * 100 : 0,
      }));
      const roomNights = U.sum(dayRows, (d) => d.occupied);
      const roomRevenue = U.round2(U.sum(dayRows, (d) => d.roomRevenue));
      const available = roomCount * days.length;
      const expenseTotal = U.round2(U.sum(expenses, (e) => e.amount));
      return {
        start, end, days: dayRows, roomCount, roomNights, available,
        occupancy: available ? (roomNights / available) * 100 : 0,
        adr: roomNights ? roomRevenue / roomNights : 0,
        revpar: available ? roomRevenue / available : 0,
        roomRevenue,
        invoices: {
          list: invRows, count: invRows.length,
          taxable: U.round2(U.sum(invRows, (x) => x.bill.taxable)),
          cgst: U.round2(U.sum(invRows, (x) => x.bill.cgst)),
          sgst: U.round2(U.sum(invRows, (x) => x.bill.sgst)),
          tax: U.round2(U.sum(invRows, (x) => x.bill.tax)),
          total: U.round2(U.sum(invRows, (x) => x.bill.total)),
          bySlab: Object.values(taxBySlab).sort((a, b) => a.rate - b.rate),
        },
        collections: { total: U.round2(collected), refunds: U.round2(refunds), net: U.round2(collected - refunds), byMode, list: payments },
        expenses: { total: expenseTotal, byCategory, list: expenses },
        net: U.round2(collected - refunds - expenseTotal),
        sources: Object.values(bySource).sort((a, b) => b.bookings - a.bookings),
        cancellations,
      };
    });
  }

  // ---------------------------------------------------------------- search
  function search(q) {
    q = (q || '').trim();
    if (!q) return { guests: [], bookings: [], rooms: [] };
    const bookings = U.sortBy(
      S.all('bookings').filter((b) => {
        const g = guest(b.guestId) || {};
        return U.matches(q, b.code, b.invoiceNo, g.name, g.phone, roomNumbers(b));
      }),
      (b) => b.checkIn, -1
    ).slice(0, 8);
    return {
      guests: findGuests(q, 6),
      bookings,
      rooms: rooms().filter((r) => U.matches(q, 'room ' + r.number, (roomType(r.typeId) || {}).name)).slice(0, 6),
    };
  }

  App.L = {
    BOOKING_STATUS, ROOM_STATE, HK_STATUS,
    memo, room, roomType, guest, rooms, allRoomsSorted, roomTypes, floors, guestName, guestOf, roomNumbers, hk,
    nightsFor, plannedCheckOut, stayDates, isOverdue, isDueToday, isArrivalDue, isLateArrival, liveNights,
    activeBookings, availability, roomConflicts, roomStatus,
    gstRateFor, computeBill, billOf, totals, paymentsSummary, allPayments,
    upsertGuest, createBooking, updateBooking, checkIn, checkOut, cancelBooking,
    addPayment, removePayment, addCharge, removeCharge, setHK,
    guestHistory, findGuests, dashboard, report, search,
  };
})(window.App = window.App || {});
