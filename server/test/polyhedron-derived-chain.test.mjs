import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePolyhedronGeometryIR} from '../workflows/polyhedron-geometry-engine.mjs';
import contract from '../../implementation/step-visual-contract.js';
import {sharedModelResources,applySharedResources} from '../workflows/shared-model-snapshot.mjs';
import {strictQuestionFingerprint} from '../workflows/shared-content-fingerprint.mjs';
import {TRUSTED_GEOMETRY_VERSION_KEY as version} from '../workflows/geometry-trusted-pipeline.mjs';
import {derivedChainIR} from './fixtures/polyhedron-derived-chain.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('已验证中点和垂足可继续参与求角、求距离与下一步构造',()=>{
  const compiled=compilePolyhedronGeometryIR(derivedChainIR());
  assert.equal(compiled.status,'verified_unique',compiled.error);
  close(compiled.queryResults.angle.sine,2/3);
  close(compiled.queryResults.dihedral.degrees,90);
  close(compiled.queryResults.distance.value,1);
  assert.deepEqual(compiled.queryResults['next-midpoint'].coordinates,[1.5,1,1]);
  assert.deepEqual(compiled.queryResults.foot.coordinates,[1.5,1,0]);
  close(compiled.queryResults['height-angle'].degrees,90);
  close(compiled.queryResults.height.value,1);
  assert.ok(compiled.result.verification.checks.every(c=>c.pass));
});

test('辅助点不能覆盖原顶点或前一步点，也不允许提前引用未来点',()=>{
  for(const pointId of ['A','M']) {
    const ir=derivedChainIR();
    ir.queries=ir.queries.slice(0,1).concat({id:'collision',kind:'point_on_segment',segment:['B','C'],parameter:.5,pointId});
    const result=compilePolyhedronGeometryIR(ir);
    assert.equal(result.status,'validation_failed');
    assert.match(result.error,/DERIVED_POINT_ID_COLLISION/);
    assert.equal(result.result,undefined,'拒绝时不能返回可共享的校验模型');
  }
  const ir=derivedChainIR();[ir.queries[0],ir.queries[1]]=[ir.queries[1],ir.queries[0]];
  const result=compilePolyhedronGeometryIR(ir);
  assert.equal(result.status,'validation_failed');assert.match(result.error,/UNKNOWN_POINT:M/);
});

test('派生步骤的校验不通过时不能输出 verified 模型',()=>{
  const ir=derivedChainIR();
  ir.queries=ir.queries.slice(0,1).concat({id:'zero-length',kind:'segment_length',points:['M','M']});
  const result=compilePolyhedronGeometryIR(ir);
  assert.equal(result.status,'validation_failed');
  assert.ok(result.validation.checks.some(c=>c.id==='query:zero-length'&&!c.pass));
  assert.equal(result.result,undefined);
});

test('辅助点实体绑定公共步骤并跨账号复制，题目或模型版本不匹配时不复用',()=>{
  const compiled=compilePolyhedronGeometryIR(derivedChainIR());
  const record={question:'正方体棱长为2，M是AB中点，N是MC1中点，H是N到底面ABD的垂足，求相关角与距离。',
    subject:'数学',user_id:'author',verificationStatus:compiled.status,
    geometryResult:compiled.result,geometryCompilation:{versionKey:version}};
  record.aiRubric=contract.bindRubric({scope:'public_question',fingerprint:strictQuestionFingerprint(record.question,record.subject),
    steps:[{id:'mid',label:'观察中点M',visual:{mode:'highlight',entityIds:['point-M']}},
      {id:'foot',label:'观察垂足',visual:{mode:'highlight',entityIds:['construction-N-H']}}]},record);
  const resources=sharedModelResources(record,{modelVersion:version,rubricConfirmed:true});
  assert.ok(resources.model);
  const copy=applySharedResources({question:record.question,subject:record.subject,user_id:'recipient',learningProfile:{mastery:0}}, {resources},version);
  assert.equal(copy.geometryCompilation.executionPath,'shared_snapshot');
  assert.equal(contract.bindingMatches(copy.aiRubric.visualBinding,copy),true);
  const catalog=contract.catalogFor(copy);
  assert.deepEqual(contract.resolveVisual(copy.aiRubric.steps[1].visual,catalog).entityIds,['construction-N-H']);
  assert.equal(copy.user_id,'recipient');assert.equal(copy.learningProfile.mastery,0);
  const changed=applySharedResources({question:record.question+'另求体积',subject:'数学'}, {resources},version);
  assert.equal(changed.geometryResult,null);
  const outdated=applySharedResources({question:record.question,subject:'数学'}, {resources},version+'-future');
  assert.equal(outdated.geometryResult,null);
});

test('派生长度默认模型仅显示对象名，已验证数值单独保留供答案门禁使用',()=>{
  const compiled=compilePolyhedronGeometryIR(derivedChainIR());
  const dims=compiled.result.scene.dimensions.filter(d=>String(d.valueSource).startsWith('queries.'));
  assert.ok(dims.length>=2);
  for(const dimension of dims){
    assert.equal(dimension.label,dimension.points.join(''));
    assert.equal(dimension.value,1);
  }
});
