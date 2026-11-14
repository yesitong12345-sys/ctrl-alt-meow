import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptGeometryIRV3, validateGeometryIRV3} from '../workflows/geometry-ir-v3.mjs';
import {solveGeometryIRV3} from '../workflows/geometry-v3-solver.mjs';
import {readFile} from 'node:fs/promises';

const integer = value => ({op: 'integer', value});

test('v2 圆体经过统一 seam 迁移为可追溯的 geometry-ir/v3', () => {
  const source = {
    schemaVersion: 'geometry-ir/v2',
    problem: {language: 'zh-CN', questionText: '圆柱半径为3，高为5，求体积和表面积。'},
    body: {type: 'right_cylinder', axis: 'z'},
    parameters: {radius: integer(3), height: integer(5)},
    query: {type: 'volume_and_surface_area'}
  };
  const ir = adaptGeometryIRV3(source);
  assert.equal(ir.schemaVersion, 'geometry-ir/v3.0');
  assert.equal(ir.stage, 'normalized');
  assert.equal(ir.entities.find(item => item.role === 'solid').type, 'right_cylinder');
  assert.equal(ir.queries[0].type, 'volume_and_surface_area');
  assert.deepEqual(validateGeometryIRV3(ir), {valid: true, errors: []});
  assert.ok(ir.sourceEvidence[0].content.includes('圆柱'));
});

test('候选事实和悬空引用不能进入统一求解 seam', () => {
  const ir = adaptGeometryIRV3({
    schemaVersion: 'geometry-ir/v2',
    problem: {questionText: '半径为5的球，求体积。'},
    body: {type: 'sphere', axis: 'z'},
    parameters: {radius: integer(5)},
    query: {type: 'volume_and_surface_area'}
  });
  ir.entities[0].status = 'candidate';
  ir.queries[0].subjects = ['missing-body'];
  const result = validateGeometryIRV3(ir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(item => item.code === 'UNCONFIRMED_FACT'));
  assert.ok(result.errors.some(item => item.code === 'DANGLING_REFERENCE'));
});

test('正式四棱锥与球 fixture 都通过运行时契约并保留关键关系', async () => {
  for (const name of ['pyramid.json','sphere-section.json']) {
    const ir=JSON.parse(await readFile(new URL(`../fixtures/geometry-ir-v3/${name}`,import.meta.url),'utf8'));
    assert.deepEqual(validateGeometryIRV3(ir),{valid:true,errors:[]});
  }
  const pyramid=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/pyramid.json',import.meta.url),'utf8'));
  assert.ok(pyramid.constraints.some(item=>item.type==='midpoint'&&item.subjects.join('-')==='E-P-C'));
});

test('统一求解器只读取 v3 事实，修改半径会同步改变精确答案和场景哈希', async () => {
  const fixture=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/sphere-section.json',import.meta.url),'utf8'));
  const first=await solveGeometryIRV3(fixture);
  assert.equal(first.status,'verified');
  assert.equal(first.problemIR.stage,'verified');
  assert.ok(first.problemIR.derivations[0].certificate.answer.displayPlain.includes('4'));
  assert.ok(first.problemIR.scene.elements.length>0);

  const changed=structuredClone(fixture);
  changed.constraints.find(item=>item.name==='radius').value=integer(10);
  changed.constraints.find(item=>item.name==='planeDistance').value=integer(6);
  const second=await solveGeometryIRV3(changed);
  assert.equal(second.status,'verified');
  assert.notEqual(second.result.answer.displayPlain,first.result.answer.displayPlain);
  assert.notEqual(second.problemIR.sceneHash,first.problemIR.sceneHash);
});

test('四棱锥 v3 缺中点关系或查询不匹配时必须拒绝，不能补回固定题型', async () => {
  const fixture=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/pyramid.json',import.meta.url),'utf8'));
  const missingMidpoint=structuredClone(fixture);
  missingMidpoint.constraints=missingMidpoint.constraints.filter(item=>item.type!=='midpoint');
  const missingResult=await solveGeometryIRV3(missingMidpoint);
  assert.equal(missingResult.status,'needs_more_context');
  assert.ok(missingResult.missingFacts.includes('midpoint:E-P-C'));

  const wrongQuery=structuredClone(fixture);
  wrongQuery.queries[0]={id:'query-1',type:'volume',subjects:['solid-1']};
  const wrongResult=await solveGeometryIRV3(wrongQuery);
  assert.equal(wrongResult.status,'unsupported');
  assert.equal(wrongResult.failureCode,'V3_QUERY_NOT_SUPPORTED');

  const wrongRole=structuredClone(fixture);
  const midpoint=wrongRole.constraints.find(item=>item.type==='midpoint');
  midpoint.point='P';midpoint.endpoints=['E','C'];midpoint.subjects=['P','E','C'];
  const wrongRoleResult=await solveGeometryIRV3(wrongRole);
  assert.equal(wrongRoleResult.status,'needs_more_context');
  assert.ok(wrongRoleResult.missingFacts.includes('midpoint:E-P-C'));
});

test('畸形 exact AST 和未定义实体结构不能进入求解器', async () => {
  const fixture=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/sphere-section.json',import.meta.url),'utf8'));
  fixture.constraints.find(item=>item.name==='radius').value={op:'sqrt'};
  const validation=validateGeometryIRV3(fixture);
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.some(item=>item.code==='INVALID_EXACT_EXPRESSION'));
  assert.equal((await solveGeometryIRV3(fixture)).status,'schema_invalid');
});

test('坐标系、实体内部引用和未消费约束必须在求解前被拒绝', async () => {
  const sphere=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/sphere-section.json',import.meta.url),'utf8'));
  sphere.coordinateSystem={dimension:2,handedness:'left',lengthUnit:''};
  assert.equal(validateGeometryIRV3(sphere).valid,false);
  assert.equal((await solveGeometryIRV3(sphere)).status,'schema_invalid');

  const pyramid=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/pyramid.json',import.meta.url),'utf8'));
  pyramid.entities=pyramid.entities.filter(item=>!['A','B','D'].includes(item.id));
  assert.equal(validateGeometryIRV3(pyramid).valid,false);
  const conflict=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/pyramid.json',import.meta.url),'utf8'));
  conflict.constraints.push({...conflict.constraints[2],id:'coincident-P-A',type:'coincident',subjects:['P','A']});
  const conflictResult=await solveGeometryIRV3(conflict);
  assert.equal(conflictResult.status,'unsupported');
  assert.equal(conflictResult.failureCode,'V3_CONSTRAINT_NOT_SUPPORTED');
  const circularConflict=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/sphere-section.json',import.meta.url),'utf8'));
  circularConflict.constraints.push({...circularConflict.constraints[0],id:'unsupported-coincident',type:'coincident',subjects:['solid-1']});
  const circularResult=await solveGeometryIRV3(circularConflict);
  assert.equal(circularResult.status,'unsupported');
  assert.equal(circularResult.failureCode,'V3_CONSTRAINT_NOT_SUPPORTED');
});

test('圆体的已确认辅助构造保留为教学上下文，不阻断已唯一确定的模型', async () => {
  const sphere=JSON.parse(await readFile(new URL('../fixtures/geometry-ir-v3/sphere-section.json',import.meta.url),'utf8'));
  sphere.constraints.push({
    id:'construction-OH-perpendicular-section', type:'perpendicular', subjects:['solid-1'],
    factKind:'assertedFact', status:'confirmed', confidence:1, evidenceRefs:['ev-source'], normalizationRule:'vision-construction'
  });
  const result=await solveGeometryIRV3(sphere);
  assert.equal(result.status,'verified');
  assert.equal(result.result.answer.displayPlain,'截面半径 = 4；截面面积 = 16π');
});
