/* Shared Wi-Fi details and optional room hotspot credentials. */
(function (App) {
  'use strict';
  const { html, useState, useEffect, Page, Card, Field, Input, Select, Button, toast } = App;
  const S = App.Store;
  function Wifi() {
    App.useStore();
    const [router,setRouter]=useState(null),[busy,setBusy]=useState(false);
    const [mode,setMode]=useState('shared-room'),[roomId,setRoom]=useState(''),[ssid,setSsid]=useState(''),[password,setPassword]=useState(''),[visible,setVisible]=useState(false),[error,setError]=useState('');
    useEffect(()=>{if(S.mode==='server')App.Sync.wifiStatus().then(setRouter).catch(()=>setRouter(null));},[]);
    const rooms=S.all('rooms').filter(r=>r.active!==false);
    const shared=mode!=='hotspot', hotelWide=mode==='shared-hotel';
    const key=hotelWide?'shared-hotel':roomId?(shared?'shared-room:'+roomId:roomId):'';
    const current=key&&S.get('wifiAccess',key);
    const label=hotelWide?'All rooms':roomId?'Room '+(S.get('rooms',roomId)||{}).number:'Choose room';
    useEffect(()=>{const old=key&&S.get('wifiAccess',key);setSsid(old?old.ssid:'');setPassword(old?old.password:'');setVisible(false);setError('');},[mode,roomId]);
    async function save() {
      if (!hotelWide&&!S.get('rooms',roomId)) return setError('Choose a room');
      if (!ssid.trim()) return setError('Enter the Wi-Fi network name (SSID)');
      if(shared&&!S.can('reports'))return setError('Ask a manager to save shared Wi-Fi details');
      try {
        const next=shared?{id:key,roomId:hotelWide?'':roomId,mode:'shared',scope:hotelWide?'hotel':'room',ssid:ssid.trim(),password,state:'Saved shared Wi-Fi details',generatedAt:new Date().toISOString()}
          :{id:roomId,roomId,mode:'hotspot',ssid:ssid.trim(),username:'room'+S.get('rooms',roomId).number+'-'+App.Ops.wifiPassword().slice(0,6),password:App.Ops.wifiPassword(),state:'Generated — router setup required',generatedAt:new Date().toISOString()};
        S.put('wifiAccess',next);await S.flush();setVisible(!shared);setError('');toast(shared?'Shared password saved for all guests':'Room password generated; activate it before issuing');
      }catch(e){setError(e.message);}
    }
    async function activate() {
      setBusy(true);setError('');
      try {
        if (App.Sync.pendingCount) throw new Error('Wait for changes to sync before activating');
        const result=await App.Sync.activateWifi(roomId);S.applyRemote({wifiAccess:[result.record]});toast('Room credentials activated on MikroTik');
      }catch(e){setError(e.message);}finally{setBusy(false);}
    }
    const detailLines=()=>[S.settings().hotelName,label,'Wi-Fi: '+current.ssid,...(shared?[]:['Hotspot username: '+current.username]),'Password: '+current.password,
      ...(shared?['Use the same Wi-Fi password for all guests.']:['Reception: activate these details on the router before giving this slip to the guest.'])];
    async function copy() {
      if(!current)return;
      try {await navigator.clipboard.writeText(detailLines().join('\n'));toast('Wi-Fi details copied');}
      catch(e){setError('Copy is unavailable. Reveal the password and copy it manually');}
    }
    function print() {
      if (!current) return;
      const root=document.getElementById('print-root'),card=document.createElement('div');card.style.padding='32px';
      for(const text of detailLines()) {const line=document.createElement('p');line.textContent=text;card.appendChild(line);}
      root.replaceChildren(card);document.documentElement.classList.add('is-printing');
      const cleanup=()=>{document.documentElement.classList.remove('is-printing');root.replaceChildren();window.removeEventListener('afterprint',cleanup);};
      window.addEventListener('afterprint',cleanup);window.print();
    }
    function selectSaved(w){setMode(w.mode==='shared'?(w.scope==='hotel'?'shared-hotel':'shared-room'):'hotspot');setRoom(w.roomId||'');setSsid(w.ssid);setPassword(w.password);setVisible(false);}
    return html`<${Page} title="Room Wi-Fi" subtitle="Shared passwords for guests, or separate room hotspot logins">
      <${Card} title="Guest Wi-Fi access">
      <${Field} label="Access type"><${Select} value=${mode} onChange=${setMode} options=${[{value:'shared-room',label:'Normal Wi-Fi — same password for everyone in a room'},{value:'shared-hotel',label:'Normal Wi-Fi — one password for all hotel guests'},{value:'hotspot',label:'Separate room hotspot login — instant generator'}]} /><//>
      ${shared?html`<p class="muted">Enter the existing Wi-Fi name and password configured on your router. All guests ${hotelWide?'in the hotel':'in this room'} use the same saved password. Guests can join normally without a hotspot username. Saving here does not change the router.</p>`
        :html`<p class="muted">Generates secure 16-character portal passwords. Activate each on a configured MikroTik HotSpot router. This is a portal login, not a separate Wi-Fi encryption key.</p><p><strong>Recommended setup:</strong> MikroTik RouterOS 7 HotSpot gateway (hAP ax³ is an example), with wired access points added after a hotel coverage survey.</p><p class="muted">${S.mode!=='server'?'Local mode: run the hotel server to enable router activation.':router&&router.configured?'MikroTik connection configured.':'MikroTik is not configured on the hotel server.'} See docs/WIFI-SETUP.md for installation steps.</p>`}
      ${!hotelWide&&html`<${Field} label="Room"><${Select} value=${roomId} onChange=${setRoom} options=${[{value:'',label:'Choose room'},...rooms.map(r=>({value:r.id,label:'Room '+r.number}))]} /><//>`}
      <${Field} label="Wi-Fi network name (SSID)"><${Input} value=${ssid} maxLength="32" onChange=${setSsid} /><//>
      ${shared&&html`<${Field} label="Existing shared Wi-Fi password" hint="8–63 characters, or a 64-digit hexadecimal WPA key. Enter the password already set on the router."><${Input} type=${visible?'text':'password'} value=${password} onChange=${setPassword} maxLength="64" autocomplete="off" /><//><${Button} onClick=${()=>setVisible(!visible)}>${visible?'Hide':'Show'} entered password<//>`}
      ${error&&html`<p role="alert">${error}</p>`}<${Button} variant="primary" disabled=${busy||(shared&&!S.can('reports'))} onClick=${save}>${shared?'Save shared Wi-Fi password':current?'Generate replacement password':'Generate password'}<//>
      ${current&&html`<div class="card"><h3>${label}</h3><p><strong>${current.state}</strong></p><p>Network: ${current.ssid}</p>${!shared&&html`<p>Hotspot username: ${current.username}</p>`}
        <${Field} label="Saved password"><${Input} type=${visible?'text':'password'} value=${current.password} readOnly autocomplete="off" /><//>
        <${Button} onClick=${()=>setVisible(!visible)}>${visible?'Hide':'Show'} saved password<//><${Button} onClick=${copy}>Copy details<//>
        ${!shared&&S.can('reports')&&router&&router.configured&&html`<${Button} disabled=${busy} onClick=${activate}>${busy?'Activating…':'Activate on MikroTik'}<//>`}
        <${Button} onClick=${print}>Print Wi-Fi slip<//><p class="muted">Saved ${current.generatedAt} by ${current.updatedBy}. ${shared?'This password is reused for all guests until a manager updates it.':'Generating a replacement does not revoke the old router account.'}</p></div>`}
      <h3>Saved Wi-Fi details</h3>${S.all('wifiAccess').map(w=>html`<p><button class="btn" onClick=${()=>selectSaved(w)}>${w.scope==='hotel'?'All rooms':'Room '+(S.get('rooms',w.roomId)||{}).number} ${w.mode==='shared'?'· Shared':'· Hotspot'}</button> · ${w.ssid}</p>`)}
      <p class="muted">Passwords are saved with hotel data and included in backups. Restrict access to hotel devices and backups.</p>
      <//>
    <//>`;
  }
  App.views=App.views||{};App.views.wifi=Wifi;
})(window.App=window.App||{});
