/*
 * Dashboard: today at a glance — occupancy, arrivals, departures, money, housekeeping.
 */
(function (App) {
  'use strict';
  const { html, U, L, Icon, Button, Badge, Card, Stat, EmptyState, Avatar, BarChart, toast } = App;
  const S = App.Store;

  const STATE_ORDER = ['vacant', 'arriving', 'occupied', 'dueout', 'overdue', 'dirty', 'oos'];

  function Banners() {
    const s = S.settings();
    const out = [];
    if (s.demo && S.can('settings')) {
      out.push(html`<div class="banner banner-demo">
        <${Icon} name="sparkles" size=${20} />
        <div class="banner-text"><strong>You're exploring demo data.</strong> Try check-ins, check-outs and invoices freely. When you're ready, start fresh with your own rooms.</div>
        <div class="banner-actions"><${Button} size="sm" variant="primary" onClick=${() => App.navigate('#/settings?tab=data')}>Start fresh<//></div>
      </div>`);
    }
    if (S.mode === 'local' && !s.demo && S.can('backup') && S.all('bookings').length > 0) {
      const last = App.Meta.get('lastBackup', 0);
      if (Date.now() - last > 7 * 864e5) {
        out.push(html`<div class="banner banner-warn">
          <${Icon} name="database" size=${20} />
          <div class="banner-text"><strong>${last ? `Last backup ${U.timeAgo(last)}.` : 'No backup yet.'}</strong> Data is stored only on this device — download a backup file regularly.</div>
          <div class="banner-actions"><${Button} size="sm" onClick=${App.downloadBackup}>Backup now<//></div>
        </div>`);
      }
    }
    return out;
  }

  function RoomStatusStrip({ d }) {
    const total = d.total || 1;
    return html`<div class="status-strip card">
      <div class="status-strip-head">
        <div><div class="strip-title">Rooms right now</div><div class="muted small">${d.occupied} of ${d.total - d.counts.oos} rooms occupied</div></div>
        <${Button} size="sm" variant="ghost" iconRight="chevronRight" onClick=${() => App.navigate('#/rooms')}>Room board<//>
      </div>
      <div class="strip-bar" role="img" aria-label="Room status">
        ${STATE_ORDER.filter((k) => d.counts[k]).map((k) => html`<span class=${'seg-' + k} style=${`flex:${d.counts[k] / total}`} title=${`${L.ROOM_STATE[k].label}: ${d.counts[k]}`}></span>`)}
      </div>
      <div class="strip-legend">
        ${STATE_ORDER.map((k) => html`<button type="button" class="legend-item" onClick=${() => App.navigate('#/rooms?state=' + k)}>
          <i class=${'dot seg-' + k}></i><span>${L.ROOM_STATE[k].label}</span><strong>${d.counts[k]}</strong></button>`)}
      </div>
    </div>`;
  }

  function MoveRow({ b, kind }) {
    const g = L.guest(b.guestId) || {};
    const t = L.totals(b);
    const time = kind === 'arrival' ? b.checkIn : b.checkOut;
    const late = kind === 'arrival' ? L.isLateArrival(b) : L.isOverdue(b);
    return html`<div class="move-row">
      <button type="button" class="move-main" onClick=${() => App.openBooking(b.id)}>
        <${Avatar} name=${L.guestName(b)} size=${38} />
        <div class="move-text">
          <div class="move-title">${L.guestName(b)} ${late && html`<${Badge} tone=${kind === 'arrival' ? 'warn' : 'danger'}>${kind === 'arrival' ? 'Late' : 'Overdue'}<//>`}</div>
          <div class="move-sub"><span class="room-tag">${L.roomNumbers(b)}</span> ${U.relDate(time) !== 'Today' ? U.relDate(time) + ', ' : ''}${U.fmtTime(time)} · ${U.phoneDisplay(g.phone)}</div>
        </div>
        <div class="move-money">${t.balance > 0 ? html`<span class="text-danger">${U.money(t.balance)} due</span>` : html`<span class="text-ok">Paid</span>`}</div>
      </button>
      ${kind === 'arrival'
        ? html`<${Button} size="sm" variant="primary" icon="key" onClick=${() => App.checkInBooking(b.id)}>Check in<//>`
        : html`<${Button} size="sm" variant="primary" icon="doorOpen" onClick=${() => App.checkOutBooking(b.id)}>Check out<//>`}
    </div>`;
  }

  function Dashboard() {
    App.useStore();
    App.useTick(60000);
    const d = L.dashboard();
    const s = S.settings();
    const money = S.can('revenue');
    const dirty = d.rooms.filter((x) => x.hk.status === 'dirty' && !x.booking && !x.hk.oos);
    const overdue = d.inHouse.filter((b) => L.isOverdue(b));
    const chart = d.chart.map((x) => ({ label: U.fmtDateShort(x.date).split(' ')[0], title: U.fmtDayMonth(x.date), value: x.value }));
    const chartTotal = U.sum(d.chart, (x) => x.value);

    if (!d.total) {
      return html`<div class="page"><${Banners} /><${EmptyState} icon="rooms" title="Add your rooms to get started"
        text="Set up room types, tariffs and room numbers. It only takes a minute."
        action=${S.can('settings') && html`<${Button} variant="primary" icon="plus" onClick=${() => App.navigate('#/settings?tab=rooms')}>Add rooms<//>`} /></div>`;
    }

    return html`<div class="page dashboard">
      <div class="page-head">
        <div class="page-titles">
          <h1 class="page-title">${U.greeting()}${S.user && S.user.name && S.user.name !== 'Admin' ? ', ' + S.user.name.split(' ')[0] : ''}</h1>
          <p class="page-subtitle">${new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} · ${s.hotelName}</p>
        </div>
        <div class="page-actions">
          <${Button} icon="calendarPlus" onClick=${() => App.newBooking({ mode: 'reserve' })} class="hide-xs">Reservation<//>
          <${Button} variant="primary" icon="key" onClick=${() => App.newBooking({ mode: 'walkin' })} class="hide-xs">Walk-in check-in<//>
        </div>
      </div>

      <${Banners} />
      ${overdue.length > 0 && html`<button type="button" class="banner banner-danger banner-click" onClick=${() => App.navigate('#/bookings?tab=departures')}>
        <${Icon} name="alert" size=${20} />
        <div class="banner-text"><strong>${U.plural(overdue.length, 'guest')} past check-out time</strong> — ${overdue.slice(0, 3).map((b) => `${L.guestName(b)} (${L.roomNumbers(b)})`).join(', ')}${overdue.length > 3 ? '…' : ''}</div>
        <${Icon} name="chevronRight" size=${18} />
      </button>`}

      <div class=${U.cls('stats', money ? 'stats-6' : 'stats-4')}>
        <${Stat} label="Occupancy" value=${U.pct(Math.round(d.occupancy))} sub=${`${d.occupied} / ${d.total - d.counts.oos} rooms`} icon="percent" tone="brand" onClick=${() => App.navigate('#/rooms')} />
        <${Stat} label="In house" value=${U.plural(d.guestsInHouse, 'guest')} sub=${U.plural(d.inHouse.length, 'booking')} icon="guests" tone="indigo" onClick=${() => App.navigate('#/bookings?tab=inhouse')} />
        <${Stat} label="Arrivals" value=${d.arrivals.length} sub=${`${d.arrivedToday} checked in today`} icon="luggage" tone="info" onClick=${() => App.navigate('#/bookings?tab=arrivals')} />
        <${Stat} label="Departures" value=${d.departures.length} sub=${`${d.departedToday} checked out today`} icon="doorOpen" tone="violet" onClick=${() => App.navigate('#/bookings?tab=departures')} />
        ${money && html`<${Stat} label="Collected today" value=${U.money(d.collectedToday)} sub=${`${U.moneyShort(d.collectedMonth)} this month`} icon="coins" tone="ok" onClick=${() => App.navigate('#/reports')} />`}
        ${money && html`<${Stat} label="Balance due" value=${U.money(d.pendingBalance)} sub="From in-house guests" icon="rupee" tone="warn" onClick=${() => App.navigate('#/bookings?tab=inhouse')} />`}
      </div>

      <${RoomStatusStrip} d=${d} />

      <div class="dash-grid">
        <div class="dash-col">
          <${Card} title="Arrivals" subtitle=${d.arrivals.length ? `${d.arrivals.length} expected today` : 'No more arrivals today'} icon="luggage"
              actions=${html`<${Button} size="sm" variant="ghost" onClick=${() => App.newBooking({ mode: 'reserve' })} icon="plus">Add<//>`} pad=${false}>
            ${d.arrivals.length ? d.arrivals.map((b) => html`<${MoveRow} key=${b.id} b=${b} kind="arrival" />`) : html`<div class="card-empty">All expected guests have arrived.</div>`}
          <//>
          <${Card} title="Departures" subtitle=${d.departures.length ? `${d.departures.length} due to check out` : 'No departures pending'} icon="doorOpen" pad=${false}>
            ${d.departures.length ? d.departures.map((b) => html`<${MoveRow} key=${b.id} b=${b} kind="departure" />`) : html`<div class="card-empty">No guests due to check out.</div>`}
          <//>
        </div>
        <div class="dash-col">
          ${money && html`<${Card} title="Collections" subtitle=${`Last 14 days · ${U.money(chartTotal)}`} icon="trendingUp"
              actions=${S.can('reports') && html`<${Button} size="sm" variant="ghost" iconRight="chevronRight" onClick=${() => App.navigate('#/reports')}>Reports<//>`}>
            <${BarChart} data=${chart} highlightLast />
          <//>`}
          <${Card} title="Upcoming reservations" icon="calendarDays" pad=${false}
              actions=${html`<${Button} size="sm" variant="ghost" iconRight="chevronRight" onClick=${() => App.navigate('#/calendar')}>Calendar<//>`}>
            ${d.upcoming.length ? d.upcoming.map((b) => html`<button type="button" key=${b.id} class="mini-row" onClick=${() => App.openBooking(b.id)}>
                <div class="date-chip"><span>${U.fmtWeekday(b.checkIn)}</span><strong>${U.parse(b.checkIn).getDate()}</strong></div>
                <div class="mini-text"><div class="fw-600">${L.guestName(b)}</div><div class="muted small">Room ${L.roomNumbers(b)} · ${U.plural(b.nights, 'night')} · ${b.source}</div></div>
                <${Icon} name="chevronRight" size=${18} class="muted" />
              </button>`) : html`<div class="card-empty">No upcoming reservations.</div>`}
          <//>
          <${Card} title="Housekeeping" subtitle=${dirty.length ? `${U.plural(dirty.length, 'room')} to clean` : 'All vacant rooms are clean'} icon="housekeeping" pad=${false}
              actions=${html`<${Button} size="sm" variant="ghost" iconRight="chevronRight" onClick=${() => App.navigate('#/housekeeping')}>Open<//>`}>
            ${dirty.length ? html`<div class="hk-quick">${dirty.map((x) => html`<div class="hk-quick-item" key=${x.room.id}>
                <span class="room-tag big">${x.room.number}</span>
                <span class="muted small grow">${x.arriving ? 'Guest arriving' : (L.roomType(x.room.typeId) || {}).name || ''}</span>
                <${Button} size="sm" icon="check" onClick=${() => { L.setHK(x.room.id, { status: 'clean' }); toast(`Room ${x.room.number} marked clean`); }}>Clean<//>
              </div>`)}</div>` : html`<div class="card-empty"><${Icon} name="checkCircle" size=${18} class="text-ok" /> Ready for new guests.</div>`}
          <//>
        </div>
      </div>
    </div>`;
  }

  App.views = App.views || {};
  App.views.dashboard = Dashboard;
})(window.App = window.App || {});
