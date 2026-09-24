/*
 * Reservation calendar ("tape chart"): rooms × days with booking bars.
 * Sticky room column and date header; tap an empty cell to book that room.
 */
(function (App) {
  'use strict';
  const { html, useState, useRef, useEffect, U, L, Icon, Button, Segmented, Select, Page, EmptyState, toast } = App;
  const S = App.Store;

  function CalendarPage() {
    App.useStore();
    App.useTick(60000);
    const tablet = App.useMedia(App.BP.tablet);
    const [span, setSpan] = App.usePref('calSpan', 14);
    const [start, setStart] = useState(() => U.addDays(U.today(), -1));
    const [typeId, setTypeId] = useState('');
    const scroller = useRef();
    const t = U.today();
    const days = Array.from({ length: span }, (_, i) => U.addDays(start, i));
    const end = U.addDays(start, span);
    const rooms = L.rooms().filter((r) => !typeId || r.typeId === typeId);
    const rowOf = new Map(rooms.map((r, i) => [r.id, i]));

    useEffect(() => {
      if (scroller.current) scroller.current.scrollLeft = 0;
    }, [start, span]);

    // bars
    const bars = [];
    const free = days.map(() => rooms.length);
    for (const b of S.all('bookings')) {
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      const [s0, e0] = L.stayDates(b);
      if (e0 < start || s0 >= end) continue;
      const si = U.diffDays(start, s0);
      const ei = U.diffDays(start, e0);
      for (const r of b.rooms || []) {
        if (!rowOf.has(r.roomId)) continue;
        for (let i = Math.max(0, si); i < Math.min(span, ei); i++) free[i]--;
        const cs = Math.max(0, si);
        const ce = Math.min(span - 1, ei);
        if (ce < cs || ei < 0) continue;
        const tone = b.status === 'checked_out' ? 'out' : b.status === 'checked_in' ? (L.isOverdue(b) ? 'overdue' : 'in') : 'reserved';
        bars.push({ b, row: rowOf.get(r.roomId), cs, span: ce - cs + 1, left: si >= 0, right: ei <= span - 1, tone, nights: Math.max(1, U.diffDays(s0, e0)) });
      }
    }
    // out-of-order rooms reduce today's availability
    rooms.forEach((r) => {
      const idx = U.diffDays(start, t);
      if (L.hk(r.id).oos && idx >= 0 && idx < span && !L.roomStatus(r.id).booking) free[idx]--;
    });

    const move = (n) => setStart(U.addDays(start, n));
    const label = `${U.fmtDateShort(start)} – ${U.fmtDateShort(U.addDays(end, -1))} ${U.parse(U.addDays(end, -1)).getFullYear()}`;
    const onCell = (room, d) => {
      if (d < t) return toast('That date is in the past', 'info');
      if (L.hk(room.id).oos && d === t) return toast(`Room ${room.number} is out of order`, 'info');
      App.newBooking({ mode: d === t ? 'walkin' : 'reserve', roomId: room.id, date: d });
    };
    const types = L.roomTypes();

    if (!L.rooms().length) return html`<${Page} title="Calendar"><${EmptyState} icon="calendar" title="No rooms yet" text="Add rooms in Settings to use the calendar." /><//>`;

    return html`<${Page} title="Calendar" subtitle="Tap an empty cell to book that room" class="page-calendar"
        actions=${html`<${Button} variant="primary" icon="calendarPlus" onClick=${() => App.newBooking({ mode: 'reserve' })} class="hide-xs">Reservation<//>`}>
      <div class="toolbar cal-toolbar">
        <div class="cal-nav">
          <${Button} icon="chevronLeft" aria-label="Earlier" onClick=${() => move(-Math.max(1, Math.floor(span / 2)))} />
          <${Button} onClick=${() => setStart(U.addDays(t, -1))}>Today<//>
          <${Button} icon="chevronRight" aria-label="Later" onClick=${() => move(Math.max(1, Math.floor(span / 2)))} />
          <input class="input cal-date" type="date" value=${start} onChange=${(e) => e.currentTarget.value && setStart(e.currentTarget.value)} aria-label="Start date" />
        </div>
        <div class="cal-label">${label}</div>
        <div class="grow"></div>
        ${types.length > 1 && tablet && html`<${Select} value=${typeId} onChange=${setTypeId} class="toolbar-select" aria-label="Room type"
          options=${[{ value: '', label: 'All room types' }, ...types.map((x) => ({ value: x.id, label: x.name }))]} />`}
        <${Segmented} size="sm" value=${span} onChange=${setSpan} options=${[{ value: 7, label: '7 days' }, { value: 14, label: '14' }, { value: 30, label: '30' }]} />
      </div>
      <div class="cal-legend">
        <span><i class="dot bar-reserved"></i>Reserved</span><span><i class="dot bar-in"></i>In house</span>
        <span><i class="dot bar-overdue"></i>Overdue</span><span><i class="dot bar-out"></i>Checked out</span>
      </div>
      <div class="tape card" ref=${scroller}>
        <div class="tape-grid" style=${`--days:${span};grid-template-rows:auto auto repeat(${rooms.length}, var(--tape-row))`}>
          <div class="tape-corner" style="grid-row:1 / span 2;grid-column:1">Room</div>
          ${days.map((d, i) => {
            const dow = U.parse(d).getDay();
            return html`<div class=${U.cls('tape-day', d === t && 'is-today', (dow === 0 || dow === 6) && 'is-weekend')} style=${`grid-row:1;grid-column:${i + 2}`}>
              <span>${U.fmtWeekday(d)}</span><strong>${U.parse(d).getDate()}</strong>${(i === 0 || U.parse(d).getDate() === 1) && html`<em>${new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(U.parse(d))}</em>`}
            </div>`;
          })}
          ${days.map((d, i) => html`<div class=${U.cls('tape-free', free[i] <= 0 && 'is-full', d === t && 'is-today')} style=${`grid-row:2;grid-column:${i + 2}`}
              title=${`${U.plural(Math.max(0, free[i]), 'room')} free`}>${Math.max(0, free[i])}<span> free</span></div>`)}
          ${rooms.map((r, ri) => {
            const rt = L.roomType(r.typeId) || {};
            const oos = L.hk(r.id).oos;
            return [
              html`<button type="button" class=${U.cls('tape-room', oos && 'is-oos')} style=${`grid-row:${ri + 3};grid-column:1`} onClick=${() => App.openRoom(r.id)} key=${'r' + r.id}>
                <strong>${r.number}</strong><span>${oos ? 'Out of order' : rt.name || ''}</span></button>`,
              ...days.map((d, i) => html`<button type="button" key=${r.id + d} aria-label=${`Book room ${r.number} on ${U.fmtDate(d)}`}
                class=${U.cls('tape-cell', d === t && 'is-today', d < t && 'is-past')} style=${`grid-row:${ri + 3};grid-column:${i + 2}`} onClick=${() => onCell(r, d)}></button>`),
            ];
          })}
          ${bars.map((x) => html`<button type="button" key=${x.b.id + x.row} class=${U.cls('tape-bar', 'bar-' + x.tone, x.left && 'has-left', x.right && 'has-right')}
              style=${`grid-row:${x.row + 3};grid-column:${x.cs + 2} / span ${x.span}`}
              title=${`${L.guestName(x.b)} · ${x.b.code} · ${U.fmtDateTime(x.b.checkIn)} → ${U.fmtDateTime(x.b.checkOut)}`}
              onClick=${() => App.openBooking(x.b.id)}>
            <span class="bar-name">${L.guestName(x.b)}</span><span class="bar-meta">${x.nights}N</span>
          </button>`)}
        </div>
      </div>
    <//>`;
  }

  App.views = App.views || {};
  App.views.calendar = CalendarPage;
})(window.App = window.App || {});
