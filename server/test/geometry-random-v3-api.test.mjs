import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const reservePort = () => new Promise((resolve, reject) => { const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port));}); });
const waitFor = async (check) => { const deadline=Date.now()+10000;while(Date.now()<deadline){try{if(await check())return}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('server not ready'); };

test('首页随机入口返回统一 v3 圆柱预览且不污染真实错题库', async t => {
  const port=await reservePort(),tempDir=await mkdtemp(path.join(os.tmpdir(),'edu-random-v3-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),DATA_FILE:path.join(tempDir,'data.json')},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();await rm(tempDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;await waitFor(async()=>(await fetch(`${base}/health`)).ok);
  const response=await fetch(`${base}/v1/geometry/random-v3`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({seed:1})});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.modelKind,'cylinder');
  assert.equal(body.problemIR.schemaVersion,'geometry-ir/v3.0');
  assert.equal(body.problemIR.verification.status,'verified');
  assert.equal(body.mistakeCase.geometryResult.scene.elements.some(item=>item.type==='cylinder'),true);
  assert.equal(body.mistakeCase.origin,'verified_random_preview');
  assert.equal(body.mistakeCase.excludeFromLearningAnalytics,true);
  assert.equal(body.workflowStatus,'preview');
  const casesResponse=await fetch(`${base}/v1/mistake-cases`);
  assert.equal(casesResponse.status,200);
  assert.deepEqual(await casesResponse.json(),[]);

  const startHeaders={'content-type':'application/json','idempotency-key':'random-start-1'};
  const startResponse=await fetch(`${base}/v1/geometry/random-v3/start`,{method:'POST',headers:startHeaders,body:JSON.stringify({seed:body.randomization.seed})});
  assert.equal(startResponse.status,201);
  const started=await startResponse.json();
  assert.equal(started.mistakeCase.origin,'verified_random_practice');
  assert.equal(started.mistakeCase.excludeFromLearningAnalytics,false);
  assert.equal(started.mistakeCase.verificationStatus,'verified');
  const persisted=await (await fetch(`${base}/v1/mistake-cases`)).json();
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].id,started.mistakeCase.id);
  const replay=await fetch(`${base}/v1/geometry/random-v3/start`,{method:'POST',headers:startHeaders,body:JSON.stringify({seed:body.randomization.seed})});
  assert.equal(replay.status,200);
  const replayBody=await replay.json();
  assert.equal(replayBody.mistakeCase.id,started.mistakeCase.id);
  assert.equal((await (await fetch(`${base}/v1/mistake-cases`)).json()).length,1);

  const concurrentHeaders={'content-type':'application/json','idempotency-key':'random-start-concurrent'};
  const concurrentBody=JSON.stringify({seed:body.randomization.seed});
  const concurrent=await Promise.all([1,2].map(()=>fetch(`${base}/v1/geometry/random-v3/start`,{method:'POST',headers:concurrentHeaders,body:concurrentBody})));
  assert.deepEqual(concurrent.map(item=>item.status).sort(),[200,201]);
  const concurrentPayloads=await Promise.all(concurrent.map(item=>item.json()));
  assert.equal(concurrentPayloads[0].mistakeCase.id,concurrentPayloads[1].mistakeCase.id);
  assert.equal((await (await fetch(`${base}/v1/mistake-cases`)).json()).length,2);
});
