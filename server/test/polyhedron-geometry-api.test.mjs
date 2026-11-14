import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); });
});

async function withServer(t) {
  const port = await reservePort(), tempDir = await mkdtemp(path.join(os.tmpdir(), 'edu-polyhedron-'));
  const child = spawn(process.execPath, ['server.mjs'], {cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),DATA_FILE:path.join(tempDir,'data.json'),MODEL_CONFIG_FILE:path.join(tempDir,'model.json'),DEEPSEEK_API_KEY:''},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();await rm(tempDir,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${port}`,deadline=Date.now()+10000;
  while(Date.now()<deadline){try{if((await fetch(base+'/health')).ok)return base}catch{}await new Promise(resolve=>setTimeout(resolve,60))}
  throw new Error('server start timeout');
}

test('服务端可编译通用棱锥并确定性计算点面距离',async t=>{
  const base=await withServer(t);
  const response=await fetch(base+'/v1/polyhedron-geometry/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({problemIR:{
    schemaVersion:'geometry-ir/polyhedron-v1',
    solid:{kind:'pyramid',base:{A:[0,0,0],B:[4,0,0],C:[4,3,0],D:[0,3,0]},apex:{P:[2,1,6]}},
    queries:[{id:'height',kind:'point_plane_distance',point:'P',plane:['A','B','D']}]
  }})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.status,'verified_unique');
  assert.equal(result.queryResults.height.value,6);
  assert.equal(result.result.scene.frameEdges.length,8);
});

test('无交集截平面不会伪造截面模型',async t=>{
  const base=await withServer(t);
  const response=await fetch(base+'/v1/polyhedron-geometry/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cube',edge:2},queries:[{id:'section',kind:'polyhedron_section',plane:{normal:[0,0,1],offset:9}}]
  })});
  assert.equal(response.status,409);
  const result=await response.json();
  assert.equal(result.status,'validation_failed');
  assert.equal(result.error,'SECTION_NOT_DEFINED');
});

test('真实文字上传的直三棱柱自动进入错题库并携带可旋转 SceneSpec',async t=>{
  const base=await withServer(t),questionText='在直三棱柱 ABC-A1B1C1 中，底面 ABC 是以 A 为直角的三角形，AB=3，AC=4，侧棱 AA1=5，求直线 BC1 与平面 ABC 所成角。';
  const response=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText,studentAnswer:'我想先看投影。'})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.status,'verified');
  assert.equal(result.mistakeCase.origin,'polyhedron_geometry_deterministic');
  assert.equal(result.mistakeCase.geometryResult.modelKind,'prism');
  assert.equal(result.mistakeCase.geometryResult.scene.frameEdges.length,9);
  assert.equal(result.mistakeCase.geometryIR.schemaVersion,'geometry-ir/v4');
  assert.equal(result.mistakeCase.geometryIR.compatibility.sourceSchemaVersion,'geometry-ir/polyhedron-v1');
  assert.equal(result.mistakeCase.visualization.interactive,true);
  assert.equal(result.modelingMode,'model_first');
  assert.ok(result.modelAttemptTrace.some(attempt=>attempt.status==='verified'));
});

test('学生可明确选择仅 AI 问答且仍创建独立学习记录',async t=>{
  const base=await withServer(t),questionText='在直三棱柱 ABC-A1B1C1 中，AB=3，AC=4，AA1=5，求直线 BC1 与平面 ABC 所成角。';
  const response=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText,modelingMode:'tutor_only'})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.modelingMode,'tutor_only');
  assert.equal(result.mistakeCase.verificationStatus,'learning_without_3d');
  assert.equal(result.mistakeCase.modelStatus,'skipped_by_student');
  assert.equal(result.mistakeCase.visualization.renderer,'none');
});

test('根式中点向量题直接上传后生成同题可旋转模型',async t=>{
  const base=await withServer(t),questionText='在直三棱柱ABC-A1B1C1中，AC=AB=AA1=√2，BC=2AE=2，E为BC的中点，求向量AE与A1C夹角的余弦值。';
  const response=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.status,'verified');
  assert.equal(result.mistakeCase.question,questionText);
  assert.equal(result.mistakeCase.geometryResult.modelKind,'prism');
  assert.ok(Math.abs(result.queryResults['vector-angle'].cosine-0.5)<1e-9);
  assert.ok(result.mistakeCase.geometryResult.scene.elements.some(element=>element.id==='vector-focus-A-E'));
});

test('补充 E 为 BC 中点后升级原记录而不是另建或停留在无模型状态',async t=>{
  const base=await withServer(t),questionText='在直三棱柱ABC-A1B1C1中，AC=AB=AA1=√2，BC=2AE=2，求向量AE与A1C夹角的余弦值。';
  const firstResponse=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText})});
  assert.equal(firstResponse.status,202);
  const first=await firstResponse.json();
  const response=await fetch(`${base}/v1/ingestions/${first.id}/supplements`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({supplementText:'E 为 BC 的中点'})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.caseId,first.caseId);
  assert.equal(result.status,'verified');
  assert.equal(result.mistakeCase.geometryResult.modelKind,'prism');
  assert.ok(Math.abs(result.queryResults['vector-angle'].cosine-0.5)<1e-9);
  const retryResponse=await fetch(`${base}/v1/ingestions/${first.id}/supplements`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({supplementText:'E 为 BC 的中点'})});
  assert.equal(retryResponse.status,200);
  const retry=await retryResponse.json();
  assert.equal(retry.supplementHistory.length,1,'重复点击重试不能反复追加同一补充条件');
  assert.equal((retry.draft.question.match(/补充信息：/g)||[]).length,1);
});

test('正四面体语音标点题必须入库并生成两条目标直线',async t=>{
  const base=await withServer(t),questionText='正四面体ABCD中，M，N分别是ABCD的中点，直线B，N与D，M夹角的余弦值为多少';
  const response=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText,modelingMode:'model_first'})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.status,'verified');
  assert.equal(result.mistakeCase.question,questionText.replace(/([A-Z]\d?)\s*[、,，]\s*([A-Z]\d?)(?=\s*(?:与|和|夹角|向量|直线|分别|$))/gi,'$1$2'));
  assert.equal(result.mistakeCase.geometryResult.solverStatus,'verified');
  assert.deepEqual(result.mistakeCase.geometryResult.scene.queryLines,[['B','N'],['D','M']]);
  assert.ok(result.mistakeCase.geometryResult.scene.elements.some(element=>element.id==='vector-focus-B-N'));
  assert.ok(result.mistakeCase.geometryResult.scene.elements.some(element=>element.id==='vector-focus-D-M'));
});

test('DeepSeek 网络不可用时 OABC 正四面体仍由本地通用构造器生成 3D',async t=>{
  const base=await withServer(t),questionText='已知，棱长为1的正四面体OABC.E，F分别是AB，OC的中点，求证，E, F垂直于AB和EF垂直于OC';
  const response=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText,modelingMode:'model_first'})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.status,'verified');
  assert.equal(result.mistakeCase.geometryResult.modelKind,'pyramid');
  assert.equal(result.goalResult.status,'proved');
  assert.deepEqual(result.mistakeCase.geometryResult.scene.queryLines,[['E','F'],['A','B'],['O','C']]);
  assert.ok(result.modelAttemptTrace.some(item=>item.stage==='deterministic_polyhedron'&&item.status==='verified'));
});

test('DeepSeek 不可用时完整平行六面体题仍由本地构造器生成并入库',async t=>{
  const base=await withServer(t);
  const questionText='在平行六面体ABCD-A1B1C1D1中，AB=4，AD=4，AA1=5，∠DAB=60°，∠BAA1=60°，∠DAA1=60°，M、N分别为D1C1、C1B1的中点，求证MN⊥AC1。';
  const response=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText,modelingMode:'model_first'})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.status,'verified');
  assert.equal(result.mistakeCase.geometryResult.modelKind,'parallelepiped');
  assert.equal(result.queryResults['vector-relation'].perpendicular,true);
  assert.equal(result.goalResult.status,'proved');
  assert.equal(result.mistakeCase.goalResult.status,'proved');
  assert.deepEqual(result.mistakeCase.geometryResult.scene.queryLines,[['M','N'],['A','C1']]);
  assert.ok(result.modelAttemptTrace.some(item=>item.stage==='deterministic_polyhedron'&&item.status==='verified'));
});

test('补充中的明确点名更正会修订原题并在同一记录生成模型',async t=>{
  const base=await withServer(t);
  const questionText='在平行六面体ABCD-A1B1C1D1中，AB=4，AD=4，AA1=5，∠DAB=60°，∠BAAE=60°，∠DAE=60°，M、N分别为D1C1、C1B1的中点，求证MN⊥AC1。';
  const firstResponse=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText})});
  assert.equal(firstResponse.status,202);
  const first=await firstResponse.json();
  const response=await fetch(`${base}/v1/ingestions/${first.id}/supplements`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({supplementText:'更正：BAAE 改为 BAA1，DAE 改为 DAA1'})});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.caseId,first.caseId);
  assert.equal(result.status,'verified');
  assert.match(result.mistakeCase.question,/BAA1=60°/);
  assert.doesNotMatch(result.mistakeCase.question,/BAAE=60°/);
  assert.equal(result.queryResults['vector-relation'].perpendicular,true);
  assert.equal(result.supplementHistory[0].kind,'correction');
});

test('浏览器真实语音文本可经上传 API 生成二层平行六面体模型',async t=>{
  const base=await withServer(t),questionText='平行六面体ABCD-a 2 B 2 C 2 D2中，AB=4，ad=4a，a2=5，角DAB等于六十度，角BAA2=60°，角DAA2=60°，M到N分别为D2C2，C2B2的中点，求证，M, N垂直于AC2';
  const response=await fetch(base+'/v1/ingestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText,modelingMode:'model_first'})});
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.status,'verified');
  assert.equal(result.mistakeCase.geometryResult.modelKind,'parallelepiped');
  assert.equal(result.goalResult.status,'proved');
  assert.deepEqual(result.mistakeCase.geometryResult.scene.queryLines,[['M','N'],['A','C2']]);
});
