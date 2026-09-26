/*
 * Room board (live status of every room), room drawer and housekeeping page.
 */
(function (App) {
  'use strict';
  const { html, useState, useMemo, U, L, Icon, Button, Badge, Field, Input, Select, Segmented, Toggle, Modal, Page, EmptyState, Avatar, KV, toast, Chips } = App;
  const S = App.Store;

  const FILTERS = ['all', 'vacant', 'arriving', 'occupied', 'dueout', 'overdue', 'dirty', 'oos'];

  function RoomTile({ x }) {
    const { room, state, booking, arriving, next, hk } = x;
    const rt = L.roomType(room.typeId) || {};
    const meta = L.ROOM_STATE[state];
    let body;
    if (booking) {
      const bal = L.totals(booking).balance;
      body = html`<div class="tile-guest">${L.guestName(booking)}</div>
        <div class="tile-sub">${state === 'overdue' ? 'Was due ' : 'Till '}${U.relDate(booking.checkOut) === 'Today' ? U.fmtTime(booking.checkOut) : U.fmtDateShort(booking.checkOut)}</div>
        ${bal > 0 && S.can('revenue') && html`<div class="tile-due">${U.money(bal)} due</div>`}`;
    } else if (state === 'arriving') {
      body = html`<div class="tile-guest">${L.guestName(arriving)}</div><div class="tile-sub">${L.isLateArrival(arriving) ? 'Late · ' : 'Arrives '}${U.fmtTime(arriving.checkIn)}</div>`;
    } else if (state === 'oos') {
      body = html`<div class="tile-sub">${hk.oosReason || 'Under maintenance'}</div>`;
    } else {
      body = html`<div class="tile-sub">${U.money(rt.rate || 0)} / night</div>
        ${next && html`<div class="tile-next">Next: ${U.relDate(next.checkIn)}</div>`}`;
    }
    return html`<button type="button" class=${U.cls('room-tile', 'st-' + state)} onClick=${() => App.openRoom(room.id)} aria-label=${`Room ${room.number}, ${meta.label}`}>
      <div class="tile-head">
        <span class="tile-num">${room.number}</span>
        <span class="tile-state"><${Icon} name=${meta.icon} size=${14} />${meta.label}</span>
      </div>
      <div class="tile-type">${rt.name || ''}</div>
      <div class="tile-body">${body}</div>
      ${hk.status === 'dirty' && state !== 'dirty' && state !== 'oos' && html`<span class="tile-flag" title="Needs cleaning"><${Icon} name="brush" size=${13} /></span>`}
    </button>`;
  }

  function RoomsPage({ route }) {
    App.useStore();
    App.useTick(60000);
    const [typeId, setTypeId] = useState('');
    const [group, setGroup] = App.usePref('roomsGroup', true);
    const filter = FILTERS.includes(route.query.state) ? route.query.state : 'all';
    const setFilter = (f) => App.navigate(f === 'all' ? '#/rooms' : '#/rooms?state=' + f);
    const all = L.rooms().map((r) => Object.assign({ room: r }, L.roomStatus(r.id)));
    const counts = { all: all.length };
    FILTERS.slice(1).forEach((k) => (counts[k] = all.filter((x) => x.state === k).length));
    const list = all.filter((x) => (filter === 'all' || x.state === filter) && (!typeId || x.room.typeId === typeId));
    const floors = group ? U.groupBy(list, (x) => String(x.room.floor ?? '')) : new Map([['', list]]);
    const types = L.roomTypes();

    if (!all.length) {
      return html`<${Page} title="Rooms"><${EmptyState} icon="rooms" title="No rooms yet" text="Add room types and room numbers in Settings."
        action=${S.can('settings') && html`<${Button} variant="primary" icon="plus" onClick=${() => App.navigate('#/settings?tab=rooms')}>Add rooms<//>`} /><//>`;
    }
    return html`<${Page} title="Rooms" subtitle=${`${counts.vacant} vacant · ${counts.occupied + counts.dueout + counts.overdue} occupied · ${counts.arriving} arriving`}
        actions=${html`<${Button} icon="calendar" onClick=${() => App.navigate('#/calendar')} class="hide-xs">Calendar<//>
          <${Button} variant="primary" icon="key" onClick=${() => App.newBooking({ mode: 'walkin' })} class="hide-xs">Walk-in<//>`}>
      <div class="chips chips-scroll room-filters">
        ${FILTERS.map((k) => html`<button type="button" class=${U.cls('chip', filter === k && 'is-on', k !== 'all' && 'chip-' + k)} onClick=${() => setFilter(k)}>
          ${k !== 'all' && html`<i class=${'dot seg-' + k}></i>`}${k === 'all' ? 'All rooms' : L.ROOM_STATE[k].label}<span class="chip-count">${counts[k]}</span></button>`)}
      </div>
      <div class="toolbar">
        ${types.length > 1 && html`<${Select} value=${typeId} onChange=${setTypeId} class="toolbar-select" aria-label="Room type"
          options=${[{ value: '', label: 'All room types' }, ...types.map((t) => ({ value: t.id, label: t.name }))]} />`}
        <div class="grow"></div>
        <${Segmented} size="sm" value=${group ? 'floor' : 'flat'} onChange=${(v) => setGroup(v === 'floor')}
          options=${[{ value: 'floor', label: 'By floor', icon: 'building' }, { value: 'flat', label: 'All', icon: 'grid' }]} />
      </div>
      ${!list.length && html`<${EmptyState} icon="search" title="No rooms match this filter" />`}
      ${[...floors.entries()].sort((a, b) => U.natCmp(a[0], b[0])).map(([floor, items]) => html`<section class="floor" key=${floor}>
        ${group && html`<h2 class="floor-title">${floor === '' ? 'Other' : /^\d+$/.test(floor) ? (floor === '0' ? 'Ground floor' : `Floor ${floor}`) : floor}<span class="muted"> · ${U.plural(items.length, 'room')}</span></h2>`}
        <div class="room-grid">${items.map((x) => html`<${RoomTile} key=${x.room.id} x=${x} />`)}</div>
      </section>`)}
    <//>`;
  }

  // ------------------------------------------------------------------ room drawer
  function RoomDetail({ close, id }) {
    App.useStore();
    const [reason, setReason] = useState(() => L.hk(id).oosReason || '');
    const room = L.room(id);
    if (!room) return html`<${Modal} title="Room" kind="drawer" onClose=${() => close()}><${EmptyState} title="Room not found" /><//>`;
    const x = L.roomStatus(id);
    const rt = L.roomType(room.typeId) || {};
    const meta = L.ROOM_STATE[x.state];
    const upcoming = U.sortBy(L.activeBookings().filter((b) => b.status === 'reserved' && b.rooms.some((r) => r.roomId === id)), (b) => b.checkIn).slice(0, 5);
    const recent = U.sortBy(S.all('bookings').filter((b) => b.status === 'checked_out' && b.rooms.some((r) => r.roomId === id)), (b) => b.checkOut, -1).slice(0, 3);

    const actions = [];
    if (x.booking) actions.push(html`<${Button} variant="primary" icon="doorOpen" onClick=${() => App.checkOutBooking(x.booking.id)}>Check out<//>`);
    else if (x.arriving) actions.push(html`<${Button} variant="primary" icon="key" onClick=${() => App.checkInBooking(x.arriving.id)}>Check in ${L.guestName(x.arriving).split(' ')[0]}<//>`);
    else if (!x.hk.oos) actions.push(html`<${Button} variant="primary" icon="key" onClick=${() => { close(); App.newBooking({ mode: 'walkin', roomId: id }); }}>Walk-in<//>`);
    actions.push(html`<${Button} icon="calendarPlus" onClick=${() => { close(); App.newBooking({ mode: 'reserve', roomId: id, date: U.addDays(U.today(), x.booking ? 1 : 0) }); }}>Reserve<//>`);

    return html`<${Modal} kind="drawer" size="md" icon="rooms" onClose=${() => close()}
        title=${`Room ${room.number}`} subtitle=${html`${rt.name || ''} · <${Badge} tone=${meta.tone} dot>${meta.label}<//>`} footer=${actions}>
      ${x.booking && html`<section class="panel">
        <div class="panel-head"><h3>Current guest</h3><button type="button" class="link-btn" onClick=${() => App.openBooking(x.booking.id)}>Open booking</button></div>
        <${App.BookingCard} b=${x.booking} />
      </section>`}
      ${x.arriving && !x.booking && html`<section class="panel">
        <div class="panel-head"><h3>Arriving</h3></div>
        <${App.BookingCard} b=${x.arriving} />
      </section>`}

      <section class="panel">
        <div class="panel-head"><h3>Housekeeping</h3>${x.hk.at && html`<span class="muted small">Updated ${U.fmtDateTime(x.hk.at)}${x.hk.by ? ' · ' + x.hk.by : ''}</span>`}</div>
        <${Segmented} full value=${x.hk.status || 'clean'} onChange=${(v) => { L.setHK(id, { status: v }); toast(`Room ${room.number}: ${L.HK_STATUS[v].label}`); }}
          options=${[{ value: 'dirty', label: 'Dirty', icon: 'brush' }, { value: 'clean', label: 'Clean', icon: 'sparkles' }, { value: 'inspected', label: 'Inspected', icon: 'badgeCheck' }]} />
        <${Toggle} label="Out of order" hint="Blocks the room from new bookings (e.g. repairs)" checked=${!!x.hk.oos}
          onChange=${(v) => L.setHK(id, { oos: v, oosReason: v ? reason || 'Maintenance' : '' })} />
        ${x.hk.oos && html`<${Field} label="Reason"><${Input} value=${reason} onChange=${setReason} onBlur=${() => L.setHK(id, { oosReason: reason })} placeholder="e.g. AC repair" /><//>`}
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Room info</h3></div>
        <${KV} items=${[
          ['Type', rt.name],
          ['Tariff', `${U.money(rt.rate || 0)} / night`],
          ['Extra bed', rt.extraBedRate ? U.money(rt.extraBedRate) : '—'],
          ['Max adults', rt.maxAdults],
          ['Floor', room.floor],
          (rt.amenities || []).length > 0 && ['Amenities', (rt.amenities || []).join(', ')],
          room.notes && ['Notes', room.notes],
        ]} />
      </section>

      ${upcoming.length > 0 && html`<section class="panel">
        <div class="panel-head"><h3>Upcoming</h3></div>
        ${upcoming.map((b) => html`<button type="button" class="mini-row" onClick=${() => App.openBooking(b.id)}>
          <div class="date-chip"><span>${U.fmtWeekday(b.checkIn)}</span><strong>${U.parse(b.checkIn).getDate()}</strong></div>
          <div class="mini-text"><div class="fw-600">${L.guestName(b)}</div><div class="muted small">${U.fmtDateShort(b.checkIn)} → ${U.fmtDateShort(b.checkOut)} · ${b.code}</div></div>
        </button>`)}
      </section>`}
      ${recent.length > 0 && html`<section class="panel">
        <div class="panel-head"><h3>Recent stays</h3></div>
        ${recent.map((b) => html`<button type="button" class="mini-row" onClick=${() => App.openBooking(b.id)}>
          <div class="mini-text"><div class="fw-600">${L.guestName(b)}</div><div class="muted small">${U.fmtDateShort(b.checkIn)} → ${U.fmtDateShort(b.checkOut)} · ${b.invoiceNo || b.code}</div></div>
          <${Icon} name="chevronRight" size=${18} class="muted" />
        </button>`)}
      </section>`}
    <//>`;
  }

  // ------------------------------------------------------------------ housekeeping page
  function HousekeepingPage() {
    App.useStore();
    App.useTick(60000);
    const wide = App.useMedia(App.BP.wide);
    const [filter, setFilter] = useState('dirty');
    const all = L.rooms().map((r) => Object.assign({ room: r }, L.roomStatus(r.id)));
    const counts = {
      dirty: all.filter((x) => x.hk.status === 'dirty' && !x.hk.oos).length,
      clean: all.filter((x) => x.hk.status !== 'dirty' && !x.hk.oos).length,
      oos: all.filter((x) => x.hk.oos).length,
      all: all.length,
    };
    const list = all.filter((x) => filter === 'all' ? true : filter === 'oos' ? x.hk.oos : filter === 'dirty' ? x.hk.status === 'dirty' && !x.hk.oos : x.hk.status !== 'dirty' && !x.hk.oos);
    const staff = U.uniq(S.all('housekeeping').map((h) => h.assignedTo).filter(Boolean));
    const occLabel = (x) => (x.booking ? (x.state === 'dueout' || x.state === 'overdue' ? 'Due out' : 'Occupied') : x.arriving ? 'Arriving today' : 'Vacant');

    function markAllClean() {
      const targets = list.filter((x) => x.hk.status === 'dirty' && !x.booking);
      S.batch(() => targets.forEach((x) => L.setHK(x.room.id, { status: 'clean' })));
      toast(`${U.plural(targets.length, 'room')} marked clean`);
    }

    return html`<${Page} title="Housekeeping" subtitle=${`${counts.dirty} to clean · ${counts.oos} out of order`}
        actions=${filter === 'dirty' && counts.dirty > 0 && html`<${Button} icon="checkCircle" onClick=${markAllClean}>Mark vacant rooms clean<//>`}>
      <div class="tabs-scroll">
        <${Segmented} value=${filter} onChange=${setFilter} class="tabs"
          options=${[{ value: 'dirty', label: 'To clean', count: counts.dirty }, { value: 'clean', label: 'Clean', count: counts.clean }, { value: 'oos', label: 'Out of order', count: counts.oos }, { value: 'all', label: 'All', count: counts.all }]} />
      </div>
      <datalist id="tbd-hk-staff">${staff.map((n) => html`<option value=${n} />`)}</datalist>
      ${!list.length ? html`<${EmptyState} icon="checkCircle" title=${filter === 'dirty' ? 'All rooms are clean' : 'Nothing here'} text=${filter === 'dirty' ? 'Rooms become “dirty” automatically when guests check out.' : ''} />`
        : html`<div class=${wide ? 'hk-grid' : 'card-list'}>${list.map((x) => html`<div class=${U.cls('hk-card', x.hk.oos && 'is-oos')} key=${x.room.id}>
            <div class="hk-top">
              <button type="button" class="room-tag big" onClick=${() => App.openRoom(x.room.id)}>${x.room.number}</button>
              <div class="grow"><div class="fw-600">${(L.roomType(x.room.typeId) || {}).name || ''}</div>
                <div class="muted small">${occLabel(x)}${x.booking ? ' · ' + L.guestName(x.booking) : ''}${x.hk.oos ? ' · ' + (x.hk.oosReason || 'Out of order') : ''}</div></div>
              <${Badge} tone=${x.hk.oos ? 'muted' : L.HK_STATUS[x.hk.status || 'clean'].tone} dot>${x.hk.oos ? 'Out of order' : L.HK_STATUS[x.hk.status || 'clean'].label}<//>
            </div>
            <${Segmented} full size="sm" value=${x.hk.status || 'clean'} onChange=${(v) => L.setHK(x.room.id, { status: v })}
              options=${[{ value: 'dirty', label: 'Dirty' }, { value: 'clean', label: 'Clean' }, { value: 'inspected', label: 'Inspected' }]} />
            <div class="hk-bottom">
              <input class="input input-sm" placeholder="Assign to…" list="tbd-hk-staff" value=${x.hk.assignedTo || ''}
                onChange=${(e) => L.setHK(x.room.id, { assignedTo: e.currentTarget.value.trim() })} aria-label=${'Assign room ' + x.room.number} />
              <label class="check-inline"><input type="checkbox" checked=${!!x.hk.oos} onChange=${(e) => L.setHK(x.room.id, { oos: e.currentTarget.checked, oosReason: e.currentTarget.checked ? 'Maintenance' : '' })} /> Out of order</label>
            </div>
          </div>`)}</div>`}
    <//>`;
  }

  App.openRoom = (id) => App.openModal(RoomDetail, { id });
  App.views = App.views || {};
  App.views.rooms = RoomsPage;
  App.views.housekeeping = HousekeepingPage;
})(window.App = window.App || {});
