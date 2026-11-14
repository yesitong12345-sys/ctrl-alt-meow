import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiRubricBuilder} from '../workflows/ai-rubric-build.mjs';
import {compilePlaneGeometry,planeStepVisuals} from '../workflows/plane-geometry.mjs';
import {createJsonPersistence} from '../workflows/persistence.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function record(){
  const m={id:'plane-build',user_id:'student-a',subject:'数学',question:'圆心(0,0)，半径5，直线x=3，求弦长',studentAnswer:'私人过程'};
  m.planeGeometry=compilePlaneGeometry({...m,confirmed:true,input:{schemaVersion:'plane-ir/v1',circle:{id:'circle-c',center:[0,0],radius:5},line:{id:'line-l',coefficients:[1,0,-3]}}});return m;
}
const rubric=()=>({source:'ai_reverse',steps:[
  {id:'ai_1',label:'观察直线',visual:{mode:'highlight',entityIds:['line-l'],labels:[{value:8}]}},
  {id:'ai_2',label:'观察圆',visual:{mode:'highlight',entityIds:['circle-c']}},
  {id:'ai_3',label:'无法对应',visual:{mode:'highlight',entityIds:['invented']}}
],parts:[{id:'p1',steps:['ai_1']},{id:'p2',steps:['ai_2']},{id:'p3',steps:['ai_3']}]});

test('首次反推携带二维目录，保存后读取可高亮，复用不再次请求模型',async()=>{
  const m=record(),db={cases:[m]};let calls=0;
  const builder=createAiRubricBuilder({db,persist:async()=>{},createAdapter:()=>async input=>{
    calls++;assert.equal(input.modelDimension,'2d');assert.equal(input.studentAnswer,undefined);
    assert.ok(input.entityCatalog.some(e=>e.id==='line-l'&&e.type==='line'));
    assert.ok(input.entityCatalog.some(e=>e.id==='circle-c'&&e.type==='circle'));
    assert.equal(input.modelParameters.circle.radius,5);return rubric();
  }});
  assert.equal((await builder.build(m)).ok,true);
  let result=planeStepVisuals(m);assert.equal(result.status,'ready');
  assert.deepEqual(result.parts[0].visual.entityIds,['line-l']);
  assert.equal(result.steps[2].visual.mode,'text_only');assert.equal(m.aiRubric.steps[0].visual.labels,undefined);
  const saved=structuredClone(m.aiRubric);
  assert.equal((await builder.build(m)).reused,true);assert.equal(calls,1);
  assert.deepEqual(m.aiRubric,saved);assert.equal(planeStepVisuals(m).status,'ready');
});

test('生成期间模型参数变化，不给旧响应盖新绑定',async()=>{
  const m=record();let release,began;
  const started=new Promise(r=>began=r),wait=new Promise(r=>release=r);
  const builder=createAiRubricBuilder({db:{cases:[m]},persist:async()=>{},createAdapter:()=>async()=>{began();await wait;return rubric();}});
  const pending=builder.build(m);await started;
  m.planeGeometry=compilePlaneGeometry({...m,confirmed:true,input:{...m.planeGeometry.canonicalInput,line:{id:'line-l',coefficients:[1,0,-4]}}});
  release();assert.equal((await pending).ok,true);
  assert.equal(m.aiRubric.planeVisualBinding,undefined);assert.equal(planeStepVisuals(m).status,'text_only');
  assert.ok(m.aiRubric.steps.every(s=>s.visual.mode==='text_only'));
});

test('旧二维得分点无绑定时不自动付费、不伪造新绑定',async()=>{
  const m=record();m.aiRubric=rubric();const before=structuredClone(m.aiRubric);
  const builder=createAiRubricBuilder({db:{cases:[m]},persist:async()=>{},createAdapter:()=>{throw Error('SHOULD_NOT_CREATE_ADAPTER');}});
  assert.equal((await builder.build(m)).reused,true);assert.deepEqual(m.aiRubric,before);
  assert.equal(planeStepVisuals(m).status,'text_only');
});

test('生成成功或抛错期间归属变化，不给另一账号写入结果或失败状态',async()=>{
  for(const fails of [false,true]){
    const m=record();let release,began;const wait=new Promise(r=>release=r),started=new Promise(r=>began=r);
    const db={cases:[m]},builder=createAiRubricBuilder({db,persist:async()=>{},createAdapter:()=>async()=>{began();await wait;if(fails)throw Error('TEST_PROVIDER_FAILURE');return rubric();}});
    const pending=builder.build(m);await started;
    const replacement={...record(),user_id:'student-b',aiStepsStatus:'not_requested'};db.cases[0]=replacement;
    release();assert.equal((await pending).status,'stale_owner');
    assert.equal(replacement.aiStepsStatus,'not_requested');assert.equal(replacement.aiRubric,undefined);
  }
});

test('真实适配器请求构造与规范化后落临时磁盘，重新加载仍有有效二维提示',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'plane-rubric-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const db={cases:[record()]},persistence=createJsonPersistence({filePath:join(dir,'data.json'),defaultValue:()=>({cases:[]})});
  let calls=0;
  const builder=createAiRubricBuilder({db,persist:()=>persistence.save(db),modelConfig:{endpoint:'https://example.invalid',apiKey:'test-not-a-key',model:'fake',fetchImpl:async(url,options)=>{
    calls++;const text=JSON.parse(options.body).messages[0].content[0].text;
    assert.ok(text.includes('二维直线与圆'));assert.ok(text.includes('"id":"circle-c"'));assert.ok(!text.includes('私人过程'));
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(rubric())}}]})};
  }}});
  assert.equal((await builder.build(db.cases[0])).ok,true);assert.equal(calls,1);
  const restored=await persistence.load(),result=planeStepVisuals(restored.cases[0]);
  assert.equal(result.status,'ready');assert.deepEqual(result.steps[0].visual.entityIds,['line-l']);
  assert.equal(result.steps[2].visual.mode,'text_only');
});
