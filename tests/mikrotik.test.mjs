import {test} from 'node:test';
import assert from 'node:assert/strict';
import router from '../server/mikrotik.js';
const env={MIKROTIK_URL:'https://router.internal',MIKROTIK_USERNAME:'api',MIKROTIK_PASSWORD:'secret',MIKROTIK_HOTSPOT_PROFILE:'hotel'};
const record={roomId:'rm1',username:'room101-abc',password:'Abcdefgh23456789'};
test('MikroTik creates only a managed hotspot user and confirms activation after success',async()=>{
  const calls=[];
  const result=await router.activate(record,env,async(url,opts)=>{
    calls.push({url:String(url),...opts,body:JSON.parse(opts.body)});
    return {ok:true,status:200,json:async()=>calls.length===1?[]:{'.id':'*1'}};
  });
  assert.equal(calls[1].method,'PUT');
  assert.equal(calls[1].body.comment,'tbd-room:rm1');
  assert.equal(calls[1].body.profile,'hotel');
  assert.equal(result.state,'Active on MikroTik hotspot');
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('MikroTik rejects unconfigured, insecure, foreign-account and failed activation',async()=>{
  await assert.rejects(()=>router.activate(record,{}),/not configured/);
  await assert.rejects(()=>router.activate(record,{...env,MIKROTIK_URL:'http://router'}),/HTTPS/);
  await assert.rejects(()=>router.activate(record,env,async()=>({ok:true,status:200,json:async()=>[{name:record.username,comment:'someone else'}]})),/another account/);
  await assert.rejects(()=>router.activate(record,env,async()=>({ok:false,status:403})),/failed/);
});
