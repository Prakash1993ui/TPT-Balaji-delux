/* New operational record validation is identical in browser and server mode. */
(function(root) {
  'use strict';
  function validateRecord(col, rec) {
    if (col === 'reviews') {
      if (!rec || typeof rec.comment !== 'string' || !rec.comment.trim() || rec.comment.length > 4000) throw new Error('Enter a review under 4,000 characters');
      if (!Number.isInteger(rec.rating) || rec.rating<1 || rec.rating>5) throw new Error('Rating must be between 1 and 5');
      if (!['General review','Cleaning','Damage','Maintenance','Other'].includes(rec.category) || !['New','Investigating','Action taken','Resolved'].includes(rec.status)) throw new Error('Invalid review category or status');
      if (!Array.isArray(rec.photos) || rec.photos.length>3) throw new Error('Attach up to 3 photos');
      for (const p of rec.photos) {
        if (typeof p.data !== 'string' || p.data.length>240000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(p.data)) throw new Error('Photo must be a supported JPEG copy');
        if (typeof p.caption !== 'string' || p.caption.length>200) throw new Error('Keep photo captions under 200 characters');
      }
      if (!Array.isArray(rec.responses) || rec.responses.length>50 || rec.responses.some(x=>typeof x.text!=='string'||x.text.length>2000)) throw new Error('Use up to 50 follow-up notes, under 2,000 characters each');
      if (JSON.stringify(rec).length>950000) throw new Error('Review storage limit exceeded');
    }
    if (col === 'wifiAccess') {
      const shared=rec.mode==='shared';
      if (typeof rec.ssid!=='string' || !rec.ssid.trim() || new TextEncoder().encode(rec.ssid).length>32) throw new Error('Wi-Fi network name must be 1–32 bytes');
      if(shared) {
        if (!['room','hotel'].includes(rec.scope) || rec.id!==(rec.scope==='hotel'?'shared-hotel':'shared-room:'+rec.roomId) || (rec.scope==='room'&&!rec.roomId)) throw new Error('Choose the shared Wi-Fi room or hotel scope');
        if (typeof rec.password!=='string' || !((rec.password.length>=8&&rec.password.length<=63)||/^[a-fA-F0-9]{64}$/.test(rec.password))) throw new Error('Shared Wi-Fi password must be 8–63 characters or a 64-digit hexadecimal key');
      } else {
        if (!rec.roomId || rec.id!==rec.roomId || typeof rec.password!=='string' || !/^[A-Za-z0-9]{16}$/.test(rec.password)) throw new Error('Invalid room Wi-Fi credentials');
        if (typeof rec.username!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(rec.username)) throw new Error('Use simple room numbers for hotspot usernames');
      }
    }
    if (col === 'ratePlans') {
      if (typeof rec.name!=='string'||!rec.name.trim()||!rec.typeId||!/^\d{4}-\d{2}-\d{2}$/.test(rec.from)||!/^\d{4}-\d{2}-\d{2}$/.test(rec.to)||rec.from>rec.to||!Number.isFinite(rec.rate)||rec.rate<0||!Array.isArray(rec.days)||rec.days.some(d=>!Number.isInteger(d)||d<0||d>6)) throw new Error('Invalid seasonal rate plan');
    }
  }
  if (typeof module!=='undefined'&&module.exports) module.exports=validateRecord;
  else {root.App=root.App||{};root.App.validateRecord=validateRecord;}
})(typeof window!=='undefined'?window:globalThis);
