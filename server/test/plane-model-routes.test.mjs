import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMistakeAdminRouter} from '../workflows/mistake-admin-routes.mjs';
import {createJsonPersistence} from '../workflows/persistence.mjs';
import {createPlaneVisualBinding} from '../workflows/plane-geometry.mjs';

const input={schemaVersion:'plane-ir/v1',circle:{id:'circle-c',center:[0,0],radius:5},line:{id:'line-l',coefficients:[1,0,-3]}};
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'edu-plane-route-'));
  const persistence=createJsonPersistence({filePath:join(dir,'data.json'),defaultValue:()=>({cases:[
    {id:'one',user_id:'a',subject:'数学',question:'圆半径5，直线x=3',studentAnswer:'我的过程',learningProfile:{mastery:20}},
    {id:'two',user_id:'b',subject:'数学',question:'另一人的题'}],events:[]})});
  let db=await persistence.load(),fail=false,writes=0;
  const server=http.createServer(async(req,res)=>{
    const route=createMistakeAdminRouter({db,currentUserId:req.headers['x-test-user']||'a',
      canAccess:()=>true, // even permissive local policy cannot override explicit ownership
      persist:async()=>{writes++;if(fail)throw Error('TEST_DISK_FAILURE');await persistence.save(db);}});
    try{if(!await route(req,res,new URL(req.url,'http://local')))res.writeHead(404).end();}
    catch(error){res.writeHead(500).end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  async function request(method='GET',body,user='a',id='one'){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/mistake-cases/${id}/plane-model`,{
      method,headers:{'content-type':'application/json','x-test-user':user},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  }
  return {request,get db(){return db;},get writes(){return writes;},setFail:v=>fail=v,reload:async()=>{db=await persistence.load();}};
}

test('真实HTTP：确认参数后持久化、重新加载回读，不复制学习进度',async t=>{
  const f=await fixture(t),initial=await f.request();
  assert.equal(initial.status,200);assert.equal(initial.body.status,'none');
  assert.equal(initial.body.question,'圆半径5，直线x=3');assert.equal(initial.body.subject,'数学');
  const body={input,confirmed:true,questionFingerprint:initial.body.questionFingerprint};
  assert.equal((await f.request('POST',{...body,confirmed:false})).status,422);
  const saved=await f.request('POST',body);assert.equal(saved.status,200);
  assert.equal(saved.body.model.solution.chordLength,8);
  const writes=f.writes;
  assert.equal((await f.request('POST',body)).body.reused,true);assert.equal(f.writes,writes);
  await f.reload();
  assert.equal((await f.request()).body.model.solution.chordLength,8);
  assert.equal(f.db.cases[0].studentAnswer,'我的过程');assert.equal(f.db.cases[0].learningProfile.mastery,20);
});

test('真实HTTP：跨账号不可读写；旧题干、版本失效；非法模型不覆盖',async t=>{
  const f=await fixture(t),initial=await f.request();
  const body={input,confirmed:true,questionFingerprint:initial.body.questionFingerprint};
  assert.equal((await f.request('GET',null,'b')).status,404);
  assert.equal((await f.request('POST',body,'b')).status,404);
  assert.equal((await f.request('POST',body)).status,200);
  const before=structuredClone(f.db.cases[0].planeGeometry);
  assert.equal((await f.request('POST',{...body,input:{}})).status,422);
  assert.deepEqual(f.db.cases[0].planeGeometry,before);
  f.db.cases[0].question+='，求别的量';
  assert.equal((await f.request()).body.status,'stale');assert.equal((await f.request()).body.model,null);
  assert.equal((await f.request('POST',body)).status,409);
  f.db.cases[0].question='圆半径5，直线x=3';f.db.cases[0].planeGeometry.version='retired';
  assert.equal((await f.request()).body.status,'stale');
});

test('真实HTTP：落盘失败恢复旧模型，未确认和伪造题干不能写入',async t=>{
  const f=await fixture(t),initial=await f.request();
  assert.equal((await f.request('POST',{input,confirmed:true,question:'伪造'})).status,409);
  f.setFail(true);
  const failed=await f.request('POST',{input,confirmed:true,questionFingerprint:initial.body.questionFingerprint});
  assert.equal(failed.status,503);assert.equal(failed.body.saved,false);
  assert.equal(f.db.cases[0].planeGeometry,undefined);assert.equal((await f.request()).body.status,'none');
  f.setFail(false);
  const body={input,confirmed:true,questionFingerprint:initial.body.questionFingerprint};
  assert.equal((await f.request('POST',body)).status,200);
  const previous=structuredClone(f.db.cases[0].planeGeometry);
  f.setFail(true);
  assert.equal((await f.request('POST',{...body,input:{...input,line:{...input.line,coefficients:[1,0,-4]}}})).status,503);
  assert.deepEqual(f.db.cases[0].planeGeometry,previous);
  f.setFail(false);assert.equal((await f.request('POST',body)).body.reused,true);
});

test('待落盘期间改题：不把旧题模型返回为当前可用模型',async()=>{
  const record={id:'one',user_id:'a',subject:'数学',question:'圆半径5，直线x=3'};
  const db={cases:[record]};
  const {strictQuestionFingerprint}=await import('../workflows/shared-content-fingerprint.mjs');
  const route=createMistakeAdminRouter({db,currentUserId:'a',requestBody:{input,confirmed:true,
    questionFingerprint:strictQuestionFingerprint(record.question,record.subject)},
    persist:async()=>{record.question='圆半径6，直线x=3';}});
  const res={writeHead(status){this.status=status;},end(text){this.body=JSON.parse(text);}};
  await route({method:'POST'},res,new URL('http://local/v1/mistake-cases/one/plane-model'));
  assert.equal(res.status,409);assert.equal(res.body.status,'stale');assert.equal(res.body.model,null);
});

test('真实HTTP：只读返回当前绑定的二维步骤；请求体不能伪造绑定或改写得分点',async t=>{
  const f=await fixture(t),initial=await f.request();
  const body={input,confirmed:true,questionFingerprint:initial.body.questionFingerprint};
  await f.request('POST',body);
  const m=f.db.cases[0];
  m.aiRubric={steps:[{id:'observe',visual:{entityIds:['line-l'],labels:[{value:8}]}}],parts:[{id:'part',steps:['observe']}]};
  m.aiRubric.planeVisualBinding=createPlaneVisualBinding(m);
  const writes=f.writes,original=structuredClone(m.aiRubric);
  const result=(await f.request()).body;
  assert.equal(result.stepVisuals.status,'ready');assert.deepEqual(result.stepVisuals.parts[0].visual.entityIds,['line-l']);
  assert.equal(result.stepVisuals.steps[0].visual.labels,undefined);assert.equal(f.writes,writes);
  assert.equal((await f.request('GET',null,'b')).status,404);
  await f.request('POST',{...body,input:{...input,line:{...input.line,coefficients:[1,0,-4]}},aiRubric:{steps:[]},planeVisualBinding:{forged:true}});
  assert.deepEqual(m.aiRubric,original);
  assert.equal((await f.request()).body.stepVisuals.status,'text_only');
});
