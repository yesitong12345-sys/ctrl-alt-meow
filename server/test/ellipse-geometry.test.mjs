import test from 'node:test';
import assert from 'node:assert/strict';
import {compileEllipseGeometry, matchesEllipseGeometry, ellipseEntityCatalog, createEllipseVisualBinding, ellipseStepVisuals} from '../workflows/ellipse-geometry.mjs';

const request={question:'椭圆 x²/25+y²/9=1 与直线 y=2 的交点。',subject:'数学',confirmed:true,input:{schemaVersion:'plane-ellipse/v1',ellipse:{id:'ellipse-e',semiMajor:5,semiMinor:3},line:{id:'line-l',coefficients:[0,1,-2]}}};

test('已确认的椭圆参数绑定题干和版本，变题或变参不复用',()=>{
  const model=compileEllipseGeometry(request);
  assert.equal(model.status,'verified');
  assert.equal(matchesEllipseGeometry(model,request),true);
  assert.equal(matchesEllipseGeometry(model,{...request,question:request.question+' 求弦长'}),false);
  assert.equal(matchesEllipseGeometry(model,{...request,input:{...request.input,line:{id:'line-l',coefficients:[0,1,-1]}}}),false);
  assert.equal(matchesEllipseGeometry({...model,version:'future'},request),false);
  assert.equal(compileEllipseGeometry({...request,confirmed:false}).status,'needs_confirmation');
});

test('椭圆目录只公开稳定对象ID，不公开交点坐标或结果',()=>{
  const record={...request,planeEllipse:compileEllipseGeometry(request)};
  assert.deepEqual(ellipseEntityCatalog(record),[{id:'ellipse-e',type:'ellipse',role:'given'},{id:'line-l',type:'line',role:'given'},{id:'point-i-1',type:'point',role:'intersection'},{id:'point-i-2',type:'point',role:'intersection'}]);
});

test('椭圆步骤提示必须绑定当前题干与实体目录，未知对象降为文字',()=>{
  const record={...request,planeEllipse:compileEllipseGeometry(request),aiRubric:{
    steps:[{id:'observe',visual:{mode:'highlight',entityIds:['line-l']}},{id:'bad',visual:{mode:'highlight',entityIds:['made-up']}}],
    parts:[{id:'part-1',steps:['observe']},{id:'part-2',steps:['bad']}]
  }};
  record.aiRubric.ellipseVisualBinding=createEllipseVisualBinding(record);
  const visuals=ellipseStepVisuals(record);
  assert.equal(visuals.status,'ready');
  assert.deepEqual(visuals.parts[0].visual.entityIds,['line-l']);
  assert.equal(visuals.parts[1].visual.mode,'text_only');
  record.question+='（改题）';
  assert.equal(ellipseStepVisuals(record).status,'text_only');
});
