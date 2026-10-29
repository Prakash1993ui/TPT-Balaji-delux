'use strict';
// Router credentials stay in environment variables; never sent to browser clients.
function configured(env = process.env) {
  return !!(env.MIKROTIK_URL && env.MIKROTIK_USERNAME && env.MIKROTIK_PASSWORD);
}
async function activate(record, env = process.env, request = fetch) {
  if (!configured(env)) throw new Error('MikroTik is not configured on the hotel server');
  const base = new URL(env.MIKROTIK_URL);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Configure an HTTPS MikroTik URL without credentials or query parameters');
  const marker = 'tbd-room:' + record.roomId;
  async function call(path, method, body) {
    const response = await request(new URL('/rest/ip/hotspot/' + path, base), {
      method, redirect:'error', signal:AbortSignal.timeout(8000),
      headers:{Authorization:'Basic '+Buffer.from(env.MIKROTIK_USERNAME+':'+env.MIKROTIK_PASSWORD).toString('base64'),'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Router request failed ('+response.status+'). Check connection, certificate and API permissions');
    return response.status===204 ? null : response.json();
  }
  const users = await call('user/print','POST',{'.proplist':'.id,name,comment','.query':['name='+record.username]});
  if (!Array.isArray(users)) throw new Error('Unexpected router response');
  const existing=users.find(u=>u.name===record.username);
  if (existing && existing.comment!==marker) throw new Error('This hotspot username belongs to another account; choose a new room credential');
  const values={name:record.username,password:record.password,comment:marker,profile:env.MIKROTIK_HOTSPOT_PROFILE || 'default'};
  if (existing) await call('user/'+encodeURIComponent(existing['.id']),'PATCH',values);
  else await call('user','PUT',values);
  return {activatedAt:new Date().toISOString(),state:'Active on MikroTik hotspot'};
}
module.exports={configured,activate};
