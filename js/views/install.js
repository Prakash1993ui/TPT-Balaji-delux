/* Install and share the PWA without transmitting hotel or guest records. */
(function(App){
  'use strict';
  const {html,useState,Page,Card,Button,Field,Input,Modal,U,toast}=App;
  function appUrl(){
    const local=location.protocol==='file:'||['localhost','127.0.0.1','::1'].includes(location.hostname);
    const url=new URL(local?'https://prakash1993ui.github.io/TPT-Balaji-delux/':'.',location.href);
    url.username='';url.password='';url.search='';url.hash='';return url.href;
  }
  function InstallContent(){
    const install=App.useInstall(),[error,setError]=useState('');
    const url=appUrl();
    async function share(){
      try{
        if(navigator.share)await navigator.share({title:'TPT Balaji Delux Hotel Manager',text:'Install the hotel manager on Android or iPhone.',url});
        else {await navigator.clipboard.writeText(url);toast('App link copied — paste it into WhatsApp or a message');}
      }catch(e){if(e.name!=='AbortError')setError('Sharing is unavailable. Copy the app link below manually.');}
    }
    async function copy(){try{await navigator.clipboard.writeText(url);toast('App link copied');}catch(e){setError('Select and copy the app link below.');}}
    function guide(){U.download('Balaji-Android-iPhone-install-guide.txt',[
      'TPT Balaji Delux — Android and iPhone app',url,'',
      'ANDROID: Open the link in Chrome. Use Install app when offered, or Chrome menu > Add to Home screen > Install.',
      'IPHONE/IPAD: Open the link in Safari. Tap Share > Add to Home Screen > Add. If offered, leave Open as Web App enabled.',
      'After the first online visit, open the app from its home-screen icon. Previously loaded screens work offline.',
      'Share this link, not hotel backup files. In local mode each device has separate hotel data. Use the hotel server address and staff login for shared data.',
      'This is an installable web app, not an APK or App Store download.'
    ].join('\n'),'text/plain;charset=utf-8');}
    return html`<p>Install Balaji Delux on your phone for a home-screen icon, an app-style window and offline access after the first online visit.</p>
      ${install.installed?html`<p role="status"><strong>The app is running in installed mode.</strong></p>`:install.canPrompt?html`<${Button} variant="primary" icon="download" onClick=${install.prompt}>Install app<//>`:html`<p class="muted">Use the steps for your device below. Installation options depend on your browser.</p>`}
      <div class="report-grid"><${Card} title="Android"><ol><li>Open the app link in Chrome.</li><li>Tap <strong>Install app</strong> if offered. Otherwise open Chrome's menu and choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li><li>Confirm installation and open Balaji Delux from the home screen.</li></ol><//>
      <${Card} title="iPhone and iPad"><ol><li>Open the app link in Safari.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li><li>If shown, keep <strong>Open as Web App</strong> enabled. Tap <strong>Add</strong>.</li></ol><//></div>
      <${Field} label="App link"><${Input} value=${url} readOnly onFocus=${e=>e.currentTarget.select()} /><//>
      <div class="toolbar"><${Button} variant="primary" onClick=${share}>Share app<//><${Button} onClick=${copy}>Copy app link<//><${Button} icon="download" onClick=${guide}>Download install guide<//></div>
      ${error&&html`<p role="alert">${error}</p>`}
      <p class="muted">Sharing sends only the app link. It does not send guest records, photos or Wi-Fi passwords. In local mode each device keeps its own data. For shared hotel data, install from your hotel server's address and sign in with a staff account.</p>
      <p class="muted">This is an installable web app. An Android APK or an Apple App Store release requires a separately signed native build.</p>`;
  }
  function InstallPage(){return html`<${Page} title="Install & share" subtitle="For Android, iPhone, iPad and computers"><${Card} title="Take Balaji Delux with you"><${InstallContent}/><//><//>`;}
  function InstallModal({close}){return html`<${Modal} title="Install & share the app" size="lg" onClose=${()=>close()}><${InstallContent}/><//>`;}
  App.openInstall=()=>App.openModal(InstallModal,{});
  App.views=App.views||{};App.views.install=InstallPage;
})(window.App=window.App||{});
