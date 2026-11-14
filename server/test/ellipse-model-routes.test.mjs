import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMistakeAdminRouter} from '../workflows/mistake-admin-routes.mjs';
import {createJsonPersistence} from '../workflows/persistence.mjs';

const input={schemaVersion:'plane-ellipse/v1',ellipse:{id:'ellipse-e',semiMajor:5,semiMinor:3},line:{id:'line-l',coefficients:[0,1,-2]}};

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'edu-ellipse-route-'));
  const persistence=createJsonPersistence({filePath:join(dir,'data.json'),defaultValue:()=>({cases:[
    {id:'one',user_id:'a',subject:'数学',question:'椭圆 x²/25+y²/9=1 与直线 y=2 的交点',studentAnswer:'我的过程',learningProfile:{mastery:20}},
    {id:'two',user_id:'b',subject:'数学',question:'另一人的椭圆题'}]})});
  let db=await persistence.load(),fail=false,writes=0;
  const server=http.createServer(async(req,res)=>{
    const route=createMistakeAdminRouter({db,currentUserId:req.headers['x-test-user']||'a',canAccess:()=>true,
      persist:async()=>{writes++;if(fail)throw Error('TEST_DISK_FAILURE');await persistence.save(db);}});
    if(!await route(req,res,new URL(req.url,'http://local')))res.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  async function request(method='GET',body,user='a',id='one'){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/mistake-cases/${id}/ellipse-model`,{
      method,headers:{'content-type':'application/json','x-test-user':user},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  return {request,get db(){return db;},get writes(){return writes;},setFail:v=>fail=v,reload:async()=>{db=await persistence.load();}};
}

test('真实HTTP：确认椭圆参数后持久化回读，目录只含稳定ID且不复制学习进度',async t=>{
  const f=await fixture(t),initial=await f.request();
  assert.equal(initial.status,200);assert.equal(initial.body.status,'none');
  const body={input,confirmed:true,questionFingerprint:initial.body.questionFingerprint};
  assert.equal((await f.request('POST',{...body,confirmed:false})).status,422);
  const saved=await f.request('POST',body);assert.equal(saved.status,200);
  assert.deepEqual(saved.body.entityCatalog.map(item=>item.id),['ellipse-e','line-l','point-i-1','point-i-2']);
  const writes=f.writes;
  assert.equal((await f.request('POST',body)).body.reused,true);assert.equal(f.writes,writes);
  await f.reload();
  assert.equal((await f.request()).body.model.solution.intersectionIds.length,2);
  assert.equal(f.db.cases[0].studentAnswer,'我的过程');assert.equal(f.db.cases[0].learningProfile.mastery,20);
});

test('真实HTTP：跨账号、旧题干、错误参数和落盘失败都不能写坏椭圆快照',async t=>{
  const f=await fixture(t),initial=await f.request();
  const body={input,confirmed:true,questionFingerprint:initial.body.questionFingerprint};
  assert.equal((await f.request('GET',null,'b')).status,404);
  assert.equal((await f.request('POST',body,'b')).status,404);
  assert.equal((await f.request('POST',body)).status,200);
  const before=structuredClone(f.db.cases[0].planeEllipse);
  assert.equal((await f.request('POST',{...body,input:{}})).status,422);
  assert.deepEqual(f.db.cases[0].planeEllipse,before);
  f.db.cases[0].question+='，求弦长';
  assert.equal((await f.request()).body.status,'stale');assert.equal((await f.request()).body.model,null);
  f.db.cases[0].question='椭圆 x²/25+y²/9=1 与直线 y=2 的交点';
  f.setFail(true);
  const changedInput={...input,line:{id:'line-l',coefficients:[0,1,-1]}};
  assert.equal((await f.request('POST',{...body,input:changedInput})).status,503);
  assert.deepEqual(f.db.cases[0].planeEllipse,before);
});
