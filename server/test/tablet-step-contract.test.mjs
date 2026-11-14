import test from 'node:test';
import assert from 'node:assert/strict';
import contract from '../../implementation/step-visual-contract.js';
import {createAiRubricBuilder} from '../workflows/ai-rubric-build.mjs';
const record={question:'正方体中观察 AB 与 AB₁',subject:'数学',verificationStatus:'verified_unique',geometryCompilation:{versionKey:'v1'},geometryResult:{solverStatus:'verified',canonicalCoordinates:{A:[0,0,0],B:[1,0,0],B1:[1,0,1]},scene:{elements:[{id:'edge-ab',type:'segment',points:['A','B']},{id:'edge-ab1',type:'segment',points:['A','B1']},{id:'face-abb1',type:'polyhedron-face',points:['A','B','B1']}]}}};
test('持久实体编号与旧点名都能绑定，未知对象降为文字，模型改变后绑定失效',()=>{
  const rubric={steps:[{id:'s1',hint:'观察这条棱',visual:{mode:'highlight',entityIds:['edge-ab1']}},{id:'s2',visual:{highlight:['AB₁']}},{id:'s3',visual:{mode:'highlight',entityIds:['不存在']}}],parts:[{id:'s1',steps:['s1']}]};
  const bound=contract.bindRubric(rubric,record);
  assert.deepEqual(bound.steps[0].visual.entityIds,['edge-ab1']);assert.deepEqual(bound.steps[1].visual.entityIds,['edge-ab1']);
  assert.equal(bound.steps[2].visual.mode,'text_only');assert.ok(bound.steps[2].visual.reason);
  assert.equal(contract.bindingMatches(bound.visualBinding,record),true);
  const changed=structuredClone(record);changed.geometryResult.canonicalCoordinates.B1[2]=2;
  assert.equal(contract.bindingMatches(bound.visualBinding,changed),false);
  changed.question+='求体积';assert.equal(contract.bindingMatches(bound.visualBinding,changed),false);
});
test('已有得分点补绑定不请求 AI；显式重建才调用，目录随同一次请求提交',async()=>{
  const target={...structuredClone(record),id:'q',aiRubric:{steps:[{id:'s1',label:'观察 AB',visual:{highlight:['AB']}}],parts:[{id:'s1',steps:['s1']}]}};
  let calls=0;
  const builder=createAiRubricBuilder({db:{cases:[target]},persist:async()=>{},createAdapter:()=>async payload=>{calls++;assert.ok(payload.entityCatalog.some(e=>e.id==='edge-ab'));return structuredClone(target.aiRubric);}});
  await builder.build(target);assert.equal(calls,0);assert.equal(target.aiRubric.steps[0].visual.mode,'highlight');
  await builder.build(target,{force:true});assert.equal(calls,1);
  target.geometryCompilation.versionKey='v2';await builder.build(target);assert.equal(calls,1);assert.equal(target.aiRubric.steps[0].visual.mode,'text_only');
});
test('模型不支持和有歧义名称只显示文字，点名保留大小写',()=>{
  const cloned=structuredClone(record);cloned.geometryResult.scene.elements.push({id:'same-ab',type:'segment',points:['A','B']});
  assert.equal(contract.resolveVisual({highlight:['AB']},contract.catalogFor(cloned)).mode,'text_only');
  assert.equal(contract.resolveVisual({entityIds:['EDGE-AB']},contract.catalogFor(record)).mode,'text_only');
  assert.equal(contract.resolveVisual({mode:'text_only'},[]).mode,'text_only');
});
test('AI 等待期间模型版本变化，保存文字步骤而不绑定旧图形指令',async()=>{
  const target={...structuredClone(record),id:'changing'};let release,began;
  const started=new Promise(r=>began=r),delayed=new Promise(r=>release=r);
  const builder=createAiRubricBuilder({db:{cases:[target]},persist:async()=>{},createAdapter:()=>async()=>{began();await delayed;return {steps:[{id:'s',label:'观察棱',visual:{mode:'highlight',entityIds:['edge-ab']}}],parts:[{id:'s',steps:['s']}]};}});
  const job=builder.build(target);await started;target.geometryCompilation.versionKey='v2';release();await job;
  assert.equal(target.aiRubric.steps[0].visual.mode,'text_only');assert.equal(target.aiRubric.visualBinding.modelVersion,'v2');
});
