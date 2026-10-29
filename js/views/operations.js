(function (App) {
  'use strict';
  const { html, useState, U, Button, Field, Input, Select, Textarea, MoneyInput, Page, Card, toast } = App;
  const S = App.Store;
  function Operations() {
    App.useStore();
    const [tab, setTab] = useState('maintenance');
    const manager = S.can('reports');
    const tabs = [{value:'maintenance',label:'Maintenance'}, ...(manager ? [
      {value:'closing',label:'Day closing'}, {value:'rates',label:'Seasonal rates'}, {value:'activity',label:'Activity history'}] : [])];
    return html`<${Page} title="Operations" subtitle="Maintenance, seasonal tariffs and daily handover">
      <div class="toolbar"><${Select} aria-label="Operations section" value=${tab} onChange=${setTab} options=${tabs} /></div>
      ${tab === 'maintenance' ? html`<${Maintenance} />` : manager && tab === 'closing' ? html`<${Closing} />`
        : manager && tab === 'rates' ? html`<${Rates} />` : manager && tab === 'activity' ? html`<${Activity} />` : null}
    <//>`;
  }
  function Closing() {
    const [date,setDate] = useState(U.today()), [opening,setOpening] = useState(''), [counted,setCounted] = useState(''), [note,setNote] = useState(''), [error,setError] = useState('');
    const totals = App.Ops.reconcile(date,+opening || 0), saved = S.get('dayClosings',date);
    const changed = saved && JSON.stringify(App.Ops.reconcile(date,saved.opening)) !== JSON.stringify({modes:saved.modes,cashExpenses:saved.cashExpenses,expectedCash:saved.expectedCash});
    function save() { try { App.Ops.closeDay(date,opening,counted,note); setError(''); toast('Day closing recorded'); } catch(e) { setError(e.message); } }
    return html`<${Card} title="Daily cash reconciliation">
      <p class="muted">Record a permanent handover snapshot. Later financial edits remain possible and are flagged here; this does not lock the accounting day.</p>
      <${Field} label="Business date"><${Input} type="date" value=${date} max=${U.today()} onChange=${setDate} /><//>
      ${saved ? html`<p>Closed by ${saved.closedBy} · ${saved.closedAt}</p><p>Opening ${U.money(saved.opening)} · Expected ${U.money(saved.expectedCash)} · Counted ${U.money(saved.counted)} · Difference ${U.money(saved.difference)}</p><p>${saved.note}</p>
        ${changed && html`<p role="alert">Financial entries have changed since closing. Review Activity history and the current reports against this snapshot.</p>`}`
        : html`<${Field} label="Opening cash"><${MoneyInput} value=${opening} onChange=${setOpening} /><//>
        <p>Net receipts by mode (after refunds):</p>${Object.entries(totals.modes).map(([m,v]) => html`<p>${m}: ${U.money(v)}</p>`)}
        <p>Cash expenses: ${U.money(totals.cashExpenses)} · Expected drawer: <strong>${U.money(totals.expectedCash)}</strong></p>
        <${Field} label="Counted cash"><${MoneyInput} value=${counted} onChange=${setCounted} /><//>
        <${Field} label="Handover notes / explanation of difference"><${Textarea} value=${note} onChange=${setNote} /><//>
        ${error && html`<p role="alert">${error}</p>`}<${Button} variant="primary" onClick=${save}>Record day closing<//>`}
      <h3>Previous closings</h3>${S.all('dayClosings').slice().sort((a,b)=>b.date.localeCompare(a.date)).map(c => html`<p><button class="btn" onClick=${()=>setDate(c.date)}>${c.date}</button> ${c.closedBy} · Difference ${U.money(c.difference)}</p>`)}
    <//>`;
  }
  function Rates() {
    const [name,setName]=useState(''), [typeId,setType]=useState(''), [from,setFrom]=useState(U.today()), [to,setTo]=useState(U.today()), [rate,setRate]=useState(''), [days,setDays]=useState('all'), [error,setError]=useState('');
    function save() {
      if (!name.trim() || !S.get('roomTypes',typeId) || !from || !to || from>to || rate==='' || !Number.isFinite(+rate) || +rate<0) return setError('Enter a name, room type, valid dates and a non-negative tariff');
      S.put('ratePlans',{name:name.trim(),typeId,from,to,rate:+rate,days:days==='weekend'?[0,6]:days==='weekday'?[1,2,3,4,5]:[]});
      setName('');setRate('');setError('');toast('Rate plan saved');
    }
    return html`<${Card} title="Seasonal and weekend rates"><p class="muted">Tariff is selected by arrival date and applies to the whole stay. Shorter date ranges take priority, then more specific arrival days, then the newest plan. Existing bookings keep their agreed tariff.</p>
      <${Field} label="Plan name"><${Input} value=${name} onChange=${setName} /><//>
      <${Field} label="Room type"><${Select} value=${typeId} onChange=${setType} options=${[{value:'',label:'Choose room type'},...S.all('roomTypes').map(t=>({value:t.id,label:t.name}))]} /><//>
      <${Field} label="From"><${Input} type="date" value=${from} onChange=${setFrom} /><//><${Field} label="To"><${Input} type="date" value=${to} onChange=${setTo} /><//>
      <${Field} label="Arrival days"><${Select} value=${days} onChange=${setDays} options=${[{value:'all',label:'Every day'},{value:'weekend',label:'Saturday and Sunday'},{value:'weekday',label:'Monday to Friday'}]} /><//>
      <${Field} label="Tariff per night"><${MoneyInput} value=${rate} onChange=${setRate} /><//>
      ${error && html`<p role="alert">${error}</p>`}<${Button} variant="primary" onClick=${save}>Add rate plan<//>
      ${S.all('ratePlans').map(p=>html`<div class="card"><strong>${p.name}</strong><p>${(S.get('roomTypes',p.typeId)||{}).name} · ${p.from} – ${p.to} · ${U.money(p.rate)} · ${p.days.length ? p.days.length===2?'Weekends':'Weekdays':'Every day'}</p><${Button} onClick=${()=>S.remove('ratePlans',p.id)}>Remove plan<//></div>`)}
    <//>`;
  }
  function Maintenance() {
    const [title,setTitle]=useState(''), [roomId,setRoom]=useState(''), [assignee,setAssignee]=useState(''), [due,setDue]=useState(''), [priority,setPriority]=useState('Normal'), [error,setError]=useState('');
    function save() { if (!title.trim()) return setError('Describe the issue'); S.put('maintenance',{title:title.trim(),roomId,assignedTo:assignee.trim(),due,priority,status:'Open'});setTitle('');setError('');toast('Maintenance ticket added'); }
    return html`<${Card} title="Maintenance tickets"><p class="muted">Track repairs and follow-up. Use the room board separately to put a room out of order or return it to service.</p>
      <${Field} label="Issue"><${Input} value=${title} onChange=${setTitle} /><//>
      <${Field} label="Room"><${Select} value=${roomId} onChange=${setRoom} options=${[{value:'',label:'Common area'},...S.all('rooms').map(r=>({value:r.id,label:'Room '+r.number}))]} /><//>
      <${Field} label="Assigned to"><${Input} value=${assignee} onChange=${setAssignee} /><//><${Field} label="Due date"><${Input} type="date" value=${due} onChange=${setDue} /><//>
      <${Field} label="Priority"><${Select} value=${priority} onChange=${setPriority} options=${['Normal','Urgent']} /><//>
      ${error && html`<p role="alert">${error}</p>`}<${Button} variant="primary" onClick=${save}>Add ticket<//>
      ${S.all('maintenance').slice().sort((a,b)=>(a.status==='Resolved')-(b.status==='Resolved') || b.createdAt-a.createdAt).map(t=>html`<div class="card"><strong>${t.title}</strong><p>${t.roomId?'Room '+(S.get('rooms',t.roomId)||{}).number:'Common area'} · ${t.priority} · ${t.assignedTo||'Unassigned'} · ${t.due||'No deadline'}</p>
        <${Select} aria-label=${'Status for '+t.title} value=${t.status} onChange=${status=>S.patch('maintenance',t.id,{status,resolvedAt:status==='Resolved'?new Date().toISOString():null})} options=${['Open','In progress','Resolved']} /></div>`)}
    <//>`;
  }
  function Activity() {
    const [q,setQ]=useState('');
    const rows=S.all('activity').slice().sort((a,b)=>b.at.localeCompare(a.at)).filter(a=>[a.actor,a.collection,a.recordId,a.action,...a.fields].join(' ').toLowerCase().includes(q.toLowerCase()));
    function exportCsv() { U.download('activity-history.csv',U.toCSV(rows,[{label:'Time',value:a=>a.at},{label:'User',value:a=>a.actor},{label:'Action',value:a=>a.action},{label:'Collection',value:a=>a.collection},{label:'Record',value:a=>a.recordId},{label:'Changed fields',value:a=>a.fields.join(', ')}]),'text/csv;charset=utf-8'); }
    return html`<${Card} title="Activity history"><p class="muted">History starts with this version. Tracks changed field names without copying guest identity details. Server mode records the signed-in user; local mode records this device's Admin. Backup restores can replace history.</p>
      <${Field} label="Search user, action or record"><${Input} value=${q} onChange=${setQ} /><//><${Button} onClick=${exportCsv}>Export CSV<//>
      <p>${rows.length} events</p>${rows.slice(0,200).map(a=>html`<div class="card"><strong>${a.action} · ${a.collection}</strong><p>${a.actor} · ${a.at} · ${a.recordId}</p><p class="muted">${a.fields.join(', ')}</p></div>`)}
      ${rows.length>200 && html`<p>Showing the latest 200 matches. Export CSV for the complete history.</p>`}
    <//>`;
  }
  App.views = App.views || {};
  App.views.operations=Operations;
})(window.App = window.App || {});
