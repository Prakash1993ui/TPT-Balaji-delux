/* Private customer feedback and photographic inspection records. */
(function (App) {
  'use strict';
  const { html, useState, U, Page, Card, Field, Input, Select, Textarea, Button, toast } = App;
  const S = App.Store;
  const categories = ['General review', 'Cleaning', 'Damage', 'Maintenance', 'Other'];
  const statuses = ['New', 'Investigating', 'Action taken', 'Resolved'];
  const evidenceTypes = ['Issue / before', 'After cleaning / repair', 'Other evidence'];

  async function preparePhoto(file, stage) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Use JPG, PNG or WebP photos');
    if (file.size > 20 * 1024 * 1024) throw new Error('Each original photo must be smaller than 20 MB');
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve,reject)=> { const i = new Image(); i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Could not read this photo'));i.src=url; });
      const scale = Math.min(1,1200 / Math.max(image.naturalWidth,image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      let quality=0.8, data=canvas.toDataURL('image/jpeg',quality);
      while (data.length>240000 && quality>0.25) { quality-=0.1;data=canvas.toDataURL('image/jpeg',quality); }
      if (data.length>240000) throw new Error('Photo is too detailed. Choose a smaller photo');
      return {id:U.uid('photo'),name:file.name.slice(0,150),data,stage,caption:'',uploadedAt:new Date().toISOString()};
    } finally { URL.revokeObjectURL(url); }
  }
  function Reviews() {
    App.useStore();
    const [category,setCategory]=useState('General review'),[rating,setRating]=useState('5'),[roomId,setRoom]=useState(''),[guest,setGuest]=useState(''),[bookingCode,setBooking]=useState(''),[comment,setComment]=useState(''),[photos,setPhotos]=useState([]),[stage,setStage]=useState(evidenceTypes[0]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[filter,setFilter]=useState('All'),[query,setQuery]=useState('');
    const [selected,setSelected]=useState(null),[reply,setReply]=useState('');
    const review=selected&&S.get('reviews',selected);
    const list=S.all('reviews').slice().sort((a,b)=>b.createdAt-a.createdAt).filter(r=>(filter==='All'||r.status===filter)&&[r.guestName,r.bookingCode,r.comment,r.category,(S.get('rooms',r.roomId)||{}).number].join(' ').toLowerCase().includes(query.toLowerCase()));
    async function upload(event) {
      const files=Array.from(event.currentTarget.files || []);event.currentTarget.value='';
      if (!files.length) return;
      if (files.length+photos.length>3) return setError('Attach up to 3 photos per review');
      setBusy(true);setError('');
      try { const next=[];for(const f of files) next.push(await preparePhoto(f,stage));setPhotos(old=>[...old,...next]); }
      catch(e) {setError(e.message);}finally{setBusy(false);}
    }
    async function save() {
      if (!comment.trim()) return setError('Add a review or describe the issue');
      if (comment.length>4000) return setError('Keep the review under 4,000 characters');
      setBusy(true);
      try {
        S.put('reviews',{category,rating:+rating,roomId,guestName:guest.trim(),bookingCode:bookingCode.trim(),comment:comment.trim(),photos,status:'New',responses:[],reportedAt:new Date().toISOString()});
        await S.flush();setComment('');setGuest('');setBooking('');setPhotos([]);setError('');toast('Customer review saved');
      }catch(e){setError(e.message);}finally{setBusy(false);}
    }
    async function uploadFollowup(event) {
      const files=Array.from(event.currentTarget.files||[]);event.currentTarget.value='';
      if (!review || !files.length) return;
      if (files.length+(review.photos||[]).length>3) return setError('Up to 3 photos total per review');
      setBusy(true);setError('');
      try {const next=[];for(const file of files)next.push(await preparePhoto(file,stage));
        S.patch('reviews',review.id,{photos:[...(review.photos||[]),...next]});await S.flush();toast('Follow-up photos saved');
      }catch(e){setError(e.message);}finally{setBusy(false);}
    }
    function addReply() {
      if (!review || !reply.trim()) return;
      if (reply.length>2000) return toast('Keep follow-up under 2,000 characters','error');
      if ((review.responses||[]).length>=50) return toast('This review has reached 50 notes','error');
      S.patch('reviews',review.id,{responses:[...(review.responses||[]),{id:U.uid('reply'),text:reply.trim(),by:S.user.name,at:new Date().toISOString()}]});setReply('');toast('Follow-up added');
    }
    return html`<${Page} title="Customer reviews" subtitle="Guest feedback, cleaning checks and damage photos">
      <${Card} title="Add a review or report an issue"><p class="muted">Private hotel records. Staff can record customer feedback here; nothing is published online. Photos are resized copies—keep original files separately if needed. Avoid faces, identity documents and payment details.</p>
      <div class="form-grid">
        <${Field} label="Category"><${Select} value=${category} onChange=${setCategory} options=${categories} /><//>
        <${Field} label="Customer rating"><${Select} value=${rating} onChange=${setRating} options=${[5,4,3,2,1].map(n=>({value:String(n),label:n+' / 5'}))} /><//>
        <${Field} label="Room"><${Select} value=${roomId} onChange=${setRoom} options=${[{value:'',label:'Common area / no room'},...S.all('rooms').map(r=>({value:r.id,label:'Room '+r.number}))]} /><//>
        <${Field} label="Customer name (optional)"><${Input} maxLength="100" value=${guest} onChange=${setGuest} /><//>
        <${Field} label="Booking reference (optional)"><${Input} maxLength="100" value=${bookingCode} onChange=${setBooking} /><//>
      </div>
      <${Field} label="Review / issue description" required><${Textarea} maxLength="4000" value=${comment} onChange=${setComment} /><//>
      <${Field} label="Photo evidence type"><${Select} value=${stage} onChange=${setStage} options=${evidenceTypes} /><//>
      <${Field} label="Attach photos (up to 3)" hint="JPG, PNG or WebP. Choose a photo or use your phone camera."><input class="input" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled=${busy||photos.length>=3} onChange=${upload} /><//>
      <div class="evidence-grid">${photos.map(p=>html`<div class="evidence-card"><img src=${p.data} alt=${p.stage} /><p>${p.name} · ${p.stage}</p><${Field} label="Photo caption"><${Input} maxLength="200" value=${p.caption} onChange=${caption=>setPhotos(old=>old.map(x=>x.id===p.id?{...x,caption}:x))} /><//><${Button} onClick=${()=>setPhotos(old=>old.filter(x=>x.id!==p.id))}>Remove photo<//></div>`)}</div>
      ${error&&html`<p role="alert">${error}</p>`}<${Button} variant="primary" disabled=${busy} onClick=${save}>${busy?'Preparing…':'Save review'}<//>
      <//>
      <${Card} title="Reviews and follow-up"><div class="toolbar"><${Field} label="Search reviews"><${Input} value=${query} onChange=${setQuery} /><//><${Field} label="Filter status"><${Select} value=${filter} onChange=${setFilter} options=${['All',...statuses]} /><//></div>
      ${!list.length&&html`<p class="muted">No reviews match this filter.</p>`}
      ${list.map(r=>html`<div class="card"><strong>${r.rating}/5 · ${r.category} · ${r.status}</strong><p>${r.roomId?'Room '+(S.get('rooms',r.roomId)||{}).number:'Common area'} · ${r.guestName||'Anonymous customer'} ${r.bookingCode?'· '+r.bookingCode:''}</p><p class="review-comment">${r.comment}</p><p class="muted">Recorded by ${r.createdBy} · ${r.reportedAt}</p>
        <div class="evidence-grid">${(r.photos||[]).map(p=>html`<figure class="evidence-card"><a href=${p.data} target="_blank" rel="noopener"><img src=${p.data} alt=${p.caption||p.stage} loading="lazy" /></a><figcaption>${p.stage} · ${p.caption||p.name}<br/>Added ${p.uploadedAt}</figcaption></figure>`)}</div>
        <${Field} label="Review status"><${Select} value=${r.status} onChange=${status=>S.patch('reviews',r.id,{status,resolvedAt:status==='Resolved'?new Date().toISOString():null})} options=${statuses} /><//>
        ${(r.responses||[]).map(x=>html`<p class="review-comment"><strong>${x.by}</strong> · ${x.at}<br/>${x.text}</p>`)}
        <${Button} onClick=${()=>{setSelected(r.id);setReply('');}}>Follow-up / add after photos<//>
      </div>`)}
      ${review&&html`<div class="card"><h3>Follow-up: ${review.category}</h3><p class="muted">Internal note; this is not sent to the customer.</p><${Field} label="Evidence type"><${Select} value=${stage} onChange=${setStage} options=${evidenceTypes} /><//><${Field} label="Add follow-up photos"><input class="input" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled=${busy} onChange=${uploadFollowup} /><//><${Field} label="Staff follow-up"><${Textarea} value=${reply} maxLength="2000" onChange=${setReply} /><//><${Button} onClick=${addReply}>Save follow-up<//><${Button} onClick=${()=>setSelected(null)}>Close<//></div>`}
      <//>
    <//>`;
  }
  App.views=App.views||{};App.views.reviews=Reviews;
})(window.App = window.App || {});
