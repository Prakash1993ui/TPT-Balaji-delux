/*
 * New walk-in check-in / advance reservation form, also used to edit a booking.
 */
(function (App) {
  'use strict';
  const { html, useState, useMemo, U, L, Icon, Button, Badge, Field, Input, MoneyInput, Select, Textarea, Segmented, Stepper, Modal, Avatar, toast } = App;
  const S = App.Store;

  const emptyGuest = () => ({ id: null, name: '', phone: '', email: '', idType: 'Aadhaar', idNumber: '', address: '', city: '', state: '', gstin: '', company: '' });

  function BookingForm({ close, preset = {}, booking }) {
    App.useStore();
    const s = S.settings();
    const editing = !!booking;
    const inHouse = editing && booking.status === 'checked_in';
    const wide = App.useMedia(App.BP.wide);

    const [mode, setMode] = useState(editing ? (inHouse ? 'walkin' : 'reserve') : preset.mode || 'walkin');
    const walkIn = mode === 'walkin';
    const [guest, setGuest] = useState(() => {
      const g = (booking && L.guest(booking.guestId)) || (preset.guestId && L.guest(preset.guestId));
      return g ? Object.assign(emptyGuest(), g) : emptyGuest();
    });
    const [date, setDate] = useState(editing ? U.datePart(booking.checkIn) : preset.date || U.today());
    const [time, setTime] = useState(editing ? U.timeStr(booking.checkIn) : s.checkInTime || '12:00');
    const [nights, setNights] = useState(editing ? booking.nights || 1 : preset.nights || 1);
    const [adults, setAdults] = useState(editing ? booking.adults || 1 : 2);
    const [children, setChildren] = useState(editing ? booking.children || 0 : 0);
    const [selected, setSelected] = useState(() => {
      if (editing) return booking.rooms.map((r) => ({ roomId: r.roomId, rate: String(r.rate), extraBeds: r.extraBeds || 0 }));
      if (preset.roomId) {
        const rm = L.room(preset.roomId);
        const rt = rm && L.roomType(rm.typeId);
        return rm ? [{ roomId: rm.id, rate: String(rt ? rt.rate : 0), extraBeds: 0 }] : [];
      }
      return [];
    });
    const [typeFilter, setTypeFilter] = useState('');
    const [source, setSource] = useState(editing ? booking.source : walkIn ? 'Walk-in' : 'Phone');
    const [purpose, setPurpose] = useState(editing ? booking.purpose || '' : (s.purposes || [])[0] || '');
    const [notes, setNotes] = useState(editing ? booking.notes || '' : '');
    const [discountType, setDiscountType] = useState(editing ? booking.discountType || 'amount' : 'amount');
    const [discountValue, setDiscountValue] = useState(editing && booking.discountValue ? String(booking.discountValue) : '');
    const [advance, setAdvance] = useState('');
    const [advanceMode, setAdvanceMode] = useState((s.paymentModes || ['Cash'])[0]);
    const [advanceRef, setAdvanceRef] = useState('');
    const [showMore, setShowMore] = useState(!!(guest.email || guest.address || guest.gstin || guest.company));
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [lookup, setLookup] = useState('');

    // --- derived stay times
    const nowS = U.now();
    const checkIn = inHouse ? booking.checkIn : walkIn ? nowS : U.combine(date, time);
    const checkOut = L.plannedCheckOut(checkIn, nights, s);
    const startDate = U.datePart(checkIn);
    const endDate = (() => {
      const e = U.datePart(checkOut);
      return U.diffDays(startDate, e) < 1 ? U.addDays(startDate, 1) : e;
    })();
    const avail = L.availability(startDate, endDate, editing ? booking.id : null);

    const draft = {
      id: 'draft', status: 'reserved', checkIn, checkOut, nights,
      rooms: selected.map((r) => ({ roomId: r.roomId, rate: +r.rate || 0, extraBeds: r.extraBeds })),
      discountType, discountValue: +discountValue || 0, charges: editing ? booking.charges : [], payments: editing ? booking.payments : [],
    };
    const bill = L.computeBill(draft, { nights });
    const adv = +advance || 0;

    const matches = useMemo(() => {
      const q = lookup.trim();
      if (guest.id || q.length < 2) return [];
      return L.findGuests(q, 5);
    }, [lookup, guest.id]);

    const types = L.roomTypes();
    const capacity = U.sum(selected, (r) => {
      const rm = L.room(r.roomId);
      const rt = rm && L.roomType(rm.typeId);
      return (rt ? +rt.maxAdults || 2 : 2) + (+r.extraBeds || 0);
    });

    function setG(k, v) {
      setGuest((g) => Object.assign({}, g, { [k]: v }));
      if (k === 'phone' || k === 'name') setLookup(v);
    }
    function pickGuest(g) {
      setGuest(Object.assign(emptyGuest(), g));
      setLookup('');
      setShowMore(!!(g.email || g.address || g.gstin || g.company));
    }
    function toggleRoom(rm) {
      const on = selected.find((x) => x.roomId === rm.id);
      if (on) setSelected(selected.filter((x) => x.roomId !== rm.id));
      else {
        const rt = L.roomType(rm.typeId);
        setSelected([...selected, { roomId: rm.id, rate: String(rt ? rt.rate : 0), extraBeds: 0 }]);
      }
    }
    const setRoom = (roomId, k, v) => setSelected(selected.map((x) => (x.roomId === roomId ? Object.assign({}, x, { [k]: v }) : x)));

    function validate() {
      const e = {};
      if (!guest.name.trim()) e.name = 'Guest name is required';
      const d = U.digits(guest.phone);
      if (!d) e.phone = 'Phone number is required';
      else if (d.length < 10) e.phone = 'Enter a valid 10-digit mobile number';
      if (walkIn && !inHouse && s.requireIdAtCheckIn && !guest.idNumber.trim()) e.idNumber = 'ID proof is required at check-in';
      if (!selected.length) e.rooms = 'Select at least one room';
      const busy = selected.filter((r) => avail.get(r.roomId) && !avail.get(r.roomId).free);
      if (busy.length) e.rooms = `Room ${busy.map((r) => (L.room(r.roomId) || {}).number).join(', ')} is not available for these dates`;
      if (selected.some((r) => !(+r.rate >= 0) || r.rate === '')) e.rooms = 'Enter a tariff for every room';
      if (!walkIn && !editing && date < U.today()) e.date = 'Reservation date cannot be in the past';
      if (adv > bill.total && bill.total > 0) e.advance = 'Advance is more than the total bill';
      setErrors(e);
      return !Object.keys(e).length;
    }

    async function save() {
      if (!validate()) {
        toast('Please fix the highlighted fields', 'error');
        return;
      }
      setSaving(true);
      try {
        if (editing) {
          const g = L.upsertGuest(guest);
          const changes = {
            guestId: g.id, nights, adults, children, source, purpose, notes, discountType, discountValue: +discountValue || 0,
            rooms: selected.map((r) => ({ roomId: r.roomId, rate: +r.rate || 0, extraBeds: r.extraBeds })),
            checkOut,
          };
          if (!inHouse) Object.assign(changes, { checkIn, plannedCheckIn: checkIn, plannedCheckOut: checkOut });
          L.updateBooking(booking, changes);
          toast('Booking updated');
          close(booking.id);
        } else {
          const b = await L.createBooking({
            guest, rooms: selected.map((r) => ({ roomId: r.roomId, rate: +r.rate || 0, extraBeds: r.extraBeds })),
            checkIn, checkOut, nights, adults, children, source, purpose, notes, discountType, discountValue: +discountValue || 0,
            advance: adv, advanceMode, advanceRef, checkInNow: walkIn,
          });
          toast(walkIn ? `Checked in · Room ${L.roomNumbers(b)}` : `Reservation ${b.code} saved`, 'success', {
            action: { label: 'View', onClick: () => App.openBooking(b.id) },
          });
          close(b.id);
        }
      } catch (err) {
        console.error(err);
        toast(err.message || 'Could not save', 'error');
      } finally {
        setSaving(false);
      }
    }

    const title = editing ? `Edit booking ${booking.code}` : walkIn ? 'Walk-in check-in' : 'New reservation';

    // ------------------------------------------------ sections
    const guestSection = html`<section class="form-section">
      <h3 class="form-section-title"><${Icon} name="user" size=${18} /> Guest</h3>
      ${guest.id && html`<div class="guest-pill">
        <${Avatar} name=${guest.name} size=${36} />
        <div class="guest-pill-text"><strong>${guest.name}</strong><span>${U.phoneDisplay(guest.phone)} · ${U.plural(L.guestHistory(guest.id).stays, 'previous stay')}</span></div>
        <${Button} size="sm" variant="ghost" onClick=${() => { setGuest(emptyGuest()); setLookup(''); }}>Change<//>
      </div>`}
      <div class="grid-2">
        <${Field} label="Mobile number" required error=${errors.phone}>
          <input class="input" type="tel" inputmode="tel" autocomplete="off" placeholder="10-digit mobile" value=${guest.phone}
            onInput=${(e) => setG('phone', e.currentTarget.value)} data-autofocus=${!editing && !guest.id} />
        <//>
        <${Field} label="Guest name" required error=${errors.name}>
          <input class="input" autocomplete="off" placeholder="Full name as on ID" value=${guest.name} onInput=${(e) => setG('name', e.currentTarget.value)} />
        <//>
      </div>
      ${matches.length > 0 && html`<div class="lookup">
        <div class="lookup-title"><${Icon} name="history" size=${14} /> Returning guest? Tap to fill details</div>
        ${matches.map((g) => html`<button type="button" class="lookup-item" onClick=${() => pickGuest(g)}>
          <${Avatar} name=${g.name} size=${32} />
          <span class="lookup-text"><strong>${g.name}</strong><span>${U.phoneDisplay(g.phone)}${g.city ? ' · ' + g.city : ''}</span></span>
          <span class="lookup-meta">${U.plural(L.guestHistory(g.id).stays, 'stay')}</span>
        </button>`)}
      </div>`}
      <div class="grid-2c">
        <${Field} label="ID proof">
          <${Select} value=${guest.idType} onChange=${(v) => setG('idType', v)} options=${s.idTypes} />
        <//>
        <${Field} label="ID number" required=${walkIn && s.requireIdAtCheckIn} error=${errors.idNumber}>
          <input class="input" autocomplete="off" placeholder=${guest.idType === 'Aadhaar' ? 'XXXX XXXX XXXX' : 'ID number'} value=${guest.idNumber}
            onInput=${(e) => setG('idNumber', e.currentTarget.value)} />
        <//>
        <${Field} label="City">
          <input class="input" placeholder="e.g. Chennai" value=${guest.city} onInput=${(e) => setG('city', e.currentTarget.value)} />
        <//>
        <${Field} label="State">
          <input class="input" placeholder="e.g. Tamil Nadu" value=${guest.state} onInput=${(e) => setG('state', e.currentTarget.value)} list="tbd-states" />
        <//>
      </div>
      ${!showMore ? html`<button type="button" class="link-btn" onClick=${() => setShowMore(true)}><${Icon} name="plus" size=${16} /> Email, address, company GST</button>`
        : html`<div class="grid-2">
          <${Field} label="Email"><input class="input" type="email" value=${guest.email} onInput=${(e) => setG('email', e.currentTarget.value)} /><//>
          <${Field} label="Address"><input class="input" value=${guest.address} onInput=${(e) => setG('address', e.currentTarget.value)} /><//>
          <${Field} label="Company (for GST invoice)"><input class="input" value=${guest.company} onInput=${(e) => setG('company', e.currentTarget.value)} /><//>
          <${Field} label="Company GSTIN"><input class="input" value=${guest.gstin} maxlength="15" onInput=${(e) => setG('gstin', e.currentTarget.value.toUpperCase())} /><//>
        </div>`}
    </section>`;

    const stayWhen = walkIn || inHouse
      ? html`<div class="stay-now"><${Icon} name="clock" size=${18} /><div><span class="muted">Check-in</span><strong>${inHouse ? U.fmtDateTimeFull(checkIn) : 'Now · ' + U.fmtTime(nowS)}</strong></div></div>`
      : html`<div class="grid-2c">
          <${Field} label="Check-in date" error=${errors.date}><${Input} type="date" value=${date} min=${editing ? undefined : U.today()} onChange=${setDate} /><//>
          <${Field} label="Expected arrival"><${Input} type="time" value=${time} onChange=${setTime} /><//>
        </div>`;

    const staySection = html`<section class="form-section">
      <h3 class="form-section-title"><${Icon} name="calendarDays" size=${18} /> Stay</h3>
      ${stayWhen}
      <div class="grid-3 stay-grid">
        <${Field} as="div" label=${s.checkoutMode === '24h' ? 'Days (24 h)' : 'Nights'}><${Stepper} value=${nights} min=${1} max=${60} onChange=${setNights} label="Nights" /><//>
        <${Field} as="div" label="Adults"><${Stepper} value=${adults} min=${1} max=${30} onChange=${setAdults} label="Adults" /><//>
        <${Field} as="div" label="Children"><${Stepper} value=${children} min=${0} max=${20} onChange=${setChildren} label="Children" /><//>
      </div>
      <div class="checkout-hint"><${Icon} name="doorOpen" size=${16} /> Check-out <strong>${U.fmtDayMonth(checkOut)}, ${U.fmtTime(checkOut)}</strong>
        <span class="muted">${s.checkoutMode === '24h' ? '(24-hour check-out)' : ''}</span></div>
    </section>`;

    const visibleRooms = L.rooms().filter((r) => !typeFilter || r.typeId === typeFilter);
    const freeCount = [...avail.values()].filter((a) => a.free).length;
    const roomsSection = html`<section class="form-section">
      <h3 class="form-section-title"><${Icon} name="rooms" size=${18} /> Rooms <span class="muted">· ${freeCount} free for ${U.plural(U.diffDays(startDate, endDate), 'night')}</span></h3>
      ${types.length > 1 && html`<div class="chips chips-scroll">
        <button type="button" class=${U.cls('chip', !typeFilter && 'is-on')} onClick=${() => setTypeFilter('')}>All types</button>
        ${types.map((t) => html`<button type="button" class=${U.cls('chip', typeFilter === t.id && 'is-on')} onClick=${() => setTypeFilter(typeFilter === t.id ? '' : t.id)}>
          ${t.name} <span class="chip-count">${U.money(t.rate)}</span></button>`)}
      </div>`}
      <div class="room-picker">
        ${visibleRooms.map((rm) => {
          const a = avail.get(rm.id) || { free: true };
          const on = selected.some((x) => x.roomId === rm.id);
          const rt = L.roomType(rm.typeId);
          const why = a.oos ? 'Out of order' : a.conflicts && a.conflicts.length ? 'Booked · ' + L.guestName(a.conflicts[0]) : '';
          return html`<button type="button" class=${U.cls('pick-room', on && 'is-on', !a.free && !on && 'is-busy')} disabled=${!a.free && !on}
              title=${why || (rt ? rt.name : '')} aria-pressed=${on} onClick=${() => toggleRoom(rm)}>
            <span class="pick-num">${rm.number}</span>
            <span class="pick-type">${!a.free && !on ? (a.oos ? 'Out of order' : 'Booked') : rt ? rt.name : ''}</span>
            ${on && html`<span class="pick-check"><${Icon} name="check" size=${14} stroke=${3} /></span>`}
          </button>`;
        })}
        ${!visibleRooms.length && html`<div class="muted">No rooms yet. Add rooms in Settings → Rooms & rates.</div>`}
      </div>
      ${errors.rooms && html`<div class="field-error">${errors.rooms}</div>`}
      ${selected.length > 0 && html`<div class="sel-rooms">
        ${selected.map((r) => {
          const rm = L.room(r.roomId) || {};
          const rt = L.roomType(rm.typeId) || {};
          return html`<div class="sel-room">
            <div class="sel-room-name"><strong>Room ${rm.number}</strong><span class="muted">${rt.name || ''}</span></div>
            <${Field} label="Tariff / night" class="sel-rate"><${MoneyInput} value=${r.rate} onChange=${(v) => setRoom(r.roomId, 'rate', v)} /><//>
            <${Field} as="div" label=${`Extra bed ${rt.extraBedRate ? '(' + U.money(rt.extraBedRate) + ')' : ''}`} class="sel-beds"><${Stepper} value=${r.extraBeds} min=${0} max=${4} onChange=${(v) => setRoom(r.roomId, 'extraBeds', v)} label="Extra beds" /><//>
            <${Button} variant="ghost" icon="trash" class="sel-remove" aria-label=${'Remove room ' + rm.number} onClick=${() => toggleRoom(rm)} />
          </div>`;
        })}
        ${adults + children > capacity + 1 && html`<div class="warn-note"><${Icon} name="alert" size=${16} /> ${adults + children} guests for ${U.plural(capacity, 'bed')}. Consider an extra bed or another room.</div>`}
      </div>`}
    </section>`;

    const detailsSection = html`<section class="form-section">
      <h3 class="form-section-title"><${Icon} name="clipboard" size=${18} /> Details</h3>
      <div class="grid-2">
        <${Field} label="Booking source"><${Select} value=${source} onChange=${setSource} options=${U.uniq([...(s.sources || []), source].filter(Boolean))} /><//>
        <${Field} label="Purpose of visit"><${Select} value=${purpose} onChange=${setPurpose} options=${U.uniq([...(s.purposes || []), purpose].filter(Boolean))} placeholder="—" /><//>
      </div>
      <${Field} label="Notes"><${Textarea} rows=${2} value=${notes} onChange=${setNotes} placeholder="Special requests, darshan timing, vehicle number…" /><//>
    </section>`;

    const summary = html`<section class="form-section summary-box">
      <h3 class="form-section-title"><${Icon} name="rupee" size=${18} /> Payment</h3>
      <div class="sum-lines">
        ${bill.lines.map((l) => html`<div class="sum-line"><span>Room ${l.number} · ${U.money(l.perNight)} × ${l.nights}</span><span>${U.money(l.gross)}</span></div>`)}
        ${!bill.lines.length && html`<div class="sum-line muted"><span>No room selected</span><span>—</span></div>`}
        <div class="discount-row">
          <span>Discount</span>
          <${Segmented} size="sm" value=${discountType} onChange=${setDiscountType} options=${[{ value: 'amount', label: '₹' }, { value: 'percent', label: '%' }]} />
          <input class="input input-sm" type="number" inputmode="decimal" min="0" placeholder="0" value=${discountValue} onInput=${(e) => setDiscountValue(e.currentTarget.value)} aria-label="Discount" />
        </div>
        ${bill.discount > 0 && html`<div class="sum-line"><span>Discount</span><span>− ${U.money(bill.discount)}</span></div>`}
        ${editing && bill.chargesGross > 0 && html`<div class="sum-line"><span>Extra charges</span><span>${U.money(bill.chargesGross)}</span></div>`}
        ${bill.taxes.filter((t) => t.tax > 0).map((t) => html`<div class="sum-line muted"><span>GST ${t.rate}% (CGST ${t.rate / 2}% + SGST ${t.rate / 2}%)</span><span>${U.money(t.tax)}</span></div>`)}
        ${bill.roundOff !== 0 && html`<div class="sum-line muted"><span>Round off</span><span>${U.money(bill.roundOff, 2)}</span></div>`}
        <div class="sum-line sum-total"><span>Total</span><span>${U.money(bill.total)}</span></div>
        ${editing && bill.paid > 0 && html`<div class="sum-line"><span>Paid so far</span><span>${U.money(bill.paid)}</span></div>`}
      </div>
      ${!editing && html`<div class="advance">
        <div class="grid-2c">
          <${Field} label=${walkIn ? 'Amount received now' : 'Advance received'} error=${errors.advance}>
            <${MoneyInput} value=${advance} onChange=${setAdvance} placeholder="0" />
          <//>
          <${Field} label="Mode"><${Select} value=${advanceMode} onChange=${setAdvanceMode} options=${s.paymentModes} /><//>
        </div>
        ${adv > 0 && advanceMode !== 'Cash' && html`<${Field} label="Reference (UPI / txn id)"><${Input} value=${advanceRef} onChange=${setAdvanceRef} placeholder="Optional" /><//>`}
        <div class="quick-amounts">
          ${bill.total > 0 && [0.5, 1].map((f) => html`<button type="button" class="chip" onClick=${() => setAdvance(String(Math.round(bill.total * f)))}>${f === 1 ? 'Full' : '50%'} · ${U.money(Math.round(bill.total * f))}</button>`)}
        </div>
        <div class="sum-line sum-balance"><span>Balance ${walkIn ? 'at check-out' : 'on arrival'}</span><span>${U.money(Math.max(0, bill.total - adv))}</span></div>
      </div>`}
    </section>`;

    const footer = html`<div class="footer-total"><span class="muted">Total</span><strong>${U.money(bill.total)}</strong></div>
      <${Button} onClick=${() => close()}>Cancel<//>
      <${Button} variant="primary" icon=${walkIn && !editing ? 'key' : 'check'} loading=${saving} onClick=${save}>
        ${editing ? 'Save changes' : walkIn ? 'Check in' : 'Save reservation'}
      <//>`;

    return html`<${Modal} title=${title} subtitle=${editing ? L.guestName(booking) : 'All fields marked * are required'} size="xl" kind="dialog" locked
        onClose=${() => close()} footer=${footer} class="booking-form">
      ${!editing && html`<${Segmented} full value=${mode} onChange=${(m) => { setMode(m); setSource(m === 'walkin' ? 'Walk-in' : source === 'Walk-in' ? 'Phone' : source); }}
        options=${[{ value: 'walkin', label: 'Walk-in check-in', icon: 'key' }, { value: 'reserve', label: 'Advance booking', icon: 'calendarPlus' }]} class="mode-switch" />`}
      <div class="form-layout">
        <div class="form-main">${guestSection}${staySection}${roomsSection}${detailsSection}${!wide && summary}</div>
        ${wide && html`<aside class="form-side">${summary}</aside>`}
      </div>
      <datalist id="tbd-states">${INDIAN_STATES.map((st) => html`<option value=${st} />`)}</datalist>
    <//>`;
  }

  const INDIAN_STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands',
    'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

  App.INDIAN_STATES = INDIAN_STATES;
  App.newBooking = (preset = {}) => App.openModal(BookingForm, { preset });
  App.editBooking = (id) => {
    const b = S.get('bookings', id);
    if (b) return App.openModal(BookingForm, { booking: b });
  };
})(window.App = window.App || {});
