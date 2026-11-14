import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePlaneGeometry,createPlaneVisualBinding,planeStepVisuals} from '../workflows/plane-geometry.mjs';
import core from '../../implementation/plane-geometry-core.js';

function record(){
  const record={subject:'数学',question:'圆心(0,0)，半径5，直线x=3，求弦长',aiRubric:{
    steps:[{id:'observe',label:'观察直线',visual:{mode:'highlight',entityIds:['line-l'],labels:[{value:8,text:'答案'}]}}],
    parts:[{id:'part-one',steps:['observe']}]
  }};
  record.planeGeometry=compilePlaneGeometry({...record,confirmed:true,input:{schemaVersion:'plane-ir/v1',
    circle:{id:'circle-c',center:[0,0],radius:5},line:{id:'line-l',coefficients:[1,0,-3]}}});
  return record;
}

test('明确绑定的二维得分点可直接交给本地SVG，输出不夹带答案标签或评分',()=>{
  const m=record();m.aiRubric.planeVisualBinding=createPlaneVisualBinding(m);
  const before=structuredClone(m),result=planeStepVisuals(m);
  assert.equal(result.status,'ready');
  assert.deepEqual(result.steps[0].visual,{mode:'highlight',entityIds:['line-l'],reason:''});
  assert.deepEqual(result.parts[0].visual,result.steps[0].visual);
  const drawing=core.render(m.planeGeometry,result.steps[0].visual);
  assert.equal(drawing.highlighted,1);assert.ok(!drawing.svg.includes('data-plane-result'));
  assert.deepEqual(m,before);
});

test('题干、参数、模型或得分点变化后，旧绑定不随读请求自动翻新',()=>{
  const initial=record();initial.aiRubric.planeVisualBinding=createPlaneVisualBinding(initial);
  for(const change of [m=>m.question+='，求面积',m=>m.planeGeometry.version='old',
    m=>m.aiRubric.steps[0].label='不同思路',m=>{m.planeGeometry=compilePlaneGeometry({...m,confirmed:true,
      input:{...m.planeGeometry.canonicalInput,line:{id:'line-l',coefficients:[1,0,-4]}}});}]){
    const m=structuredClone(initial);change(m);const before=structuredClone(m);
    const result=planeStepVisuals(m);assert.equal(result.status,'text_only');
    assert.equal(result.binding,null);assert.equal(result.steps[0].visual.mode,'text_only');assert.deepEqual(m,before);
  }
  const unbound=record();assert.equal(planeStepVisuals(unbound).steps[0].visual.mode,'text_only');
});

test('未知/混合对象、重复步骤ID和含多个步骤的评分点均不猜高亮',()=>{
  const m=record();
  m.aiRubric.steps=[
    {id:'unknown',visual:{entityIds:['line-l','edge-3d']}},
    {id:'legacy',visual:{highlight:['AB']}},
    {id:'duplicated',visual:{entityIds:['line-l']}},{id:'duplicated',visual:{entityIds:['circle-c']}},
    {id:'invalid-mode',visual:{mode:'execute_code',entityIds:['line-l']}},
    {id:'text',visual:{mode:'text_only',entityIds:['circle-c'],reason:'答案8'}}
  ];
  m.aiRubric.parts=[{id:'ambiguous',steps:['unknown','text']},{id:'duplicate-reference',steps:['duplicated']}];
  m.aiRubric.planeVisualBinding=createPlaneVisualBinding(m);
  const result=planeStepVisuals(m);
  assert.ok(result.steps.every(s=>s.visual.mode==='text_only'));
  assert.ok(result.parts.every(s=>s.visual.mode==='text_only'));
  assert.ok(!JSON.stringify(result).includes('答案8'));
});

test('历史坏结构、缺少模型或空记录读请求不崩溃',()=>{
  for(const m of [null,{}, {...record(),aiRubric:{steps:{not:'array'},parts:null}},
    {...record(),aiRubric:{steps:[null],parts:[null]}}]){
    const result=planeStepVisuals(m);assert.equal(result.status,'text_only');
  }
});

test('历史字段只接受真实实体ID，不用名称猜测；多个明确对象可共同突出',()=>{
  const m=record();m.aiRubric.steps=[
    {id:'old-entities',visual:{entities:['circle-c']}},
    {id:'old-highlight',visual:{highlight:['line-l','point-foot']}},
    {id:'modern-first',visual:{entityIds:['missing'],entities:['line-l']}}
  ];m.aiRubric.parts=[];m.aiRubric.planeVisualBinding=createPlaneVisualBinding(m);
  const result=planeStepVisuals(m);
  assert.deepEqual(result.steps[0].visual.entityIds,['circle-c']);
  assert.deepEqual(result.steps[1].visual.entityIds,['line-l','point-foot']);
  assert.equal(core.render(m.planeGeometry,result.steps[1].visual).highlighted,2);
  assert.equal(result.steps[2].visual.mode,'text_only');
});
