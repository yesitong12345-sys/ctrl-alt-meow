import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {solveConfirmedGeometry} from '../workflows/deterministic-geometry-solver.mjs';
import {parseCircularGeometryText} from '../workflows/circular-geometry-entry.mjs';

test('网页保存的 LaTeX 数学模式数值仍能识别为圆体精确参数', () => {
  const parsed = parseCircularGeometryText('圆柱的底面半径为 $3$，高为 $4$。求这个圆柱的体积与表面积。');
  assert.equal(parsed.status, undefined);
  assert.equal(parsed.body.type, 'right_cylinder');
  assert.deepEqual(parsed.parameters.radius, {op: 'integer', value: 3});
  assert.deepEqual(parsed.parameters.height, {op: 'integer', value: 4});
});

const pythonBin = process.env.PYTHON_BIN || path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
);

const integer = value => ({op: 'integer', value});
const circular = (bodyType, parameters, query) => ({
  schemaVersion: 'geometry-ir/v2',
  problem: {language: 'zh-CN', questionText: '圆体确定性测试题'},
  body: {type: bodyType, axis: 'z'},
  parameters,
  query
});

test('圆柱体积和表面积由精确 IR 求解并生成圆柱场景', async () => {
  const result = await solveConfirmedGeometry(circular('right_cylinder', {radius: integer(3), height: integer(5)}, {type: 'volume_and_surface_area'}), {pythonBin});
  assert.equal(result.solverStatus, 'verified');
  assert.equal(result.answer.displayPlain, '体积 = 45π；表面积 = 48π');
  assert.equal(result.scene.elements.some(item => item.type === 'cylinder'), true);
  assert.equal(result.verification.embeddingUnique, true);
});

test('圆锥母线、体积和表面积由同一份圆锥 IR 精确计算', async () => {
  const result = await solveConfirmedGeometry(circular('right_cone', {radius: integer(3), height: integer(4)}, {type: 'volume_and_surface_area'}), {pythonBin});
  assert.equal(result.solverStatus, 'verified');
  assert.equal(result.answer.displayPlain, '母线 = 5；体积 = 12π；表面积 = 24π');
  assert.equal(result.scene.elements.some(item => item.type === 'cone'), true);
});

test('球的截面由球心到平面距离精确验证，超出球面则拒绝建模', async () => {
  const verified = await solveConfirmedGeometry(circular('sphere', {radius: integer(5), planeDistance: integer(3)}, {type: 'section_circle'}), {pythonBin});
  assert.equal(verified.solverStatus, 'verified');
  assert.equal(verified.answer.displayPlain, '截面半径 = 4；截面面积 = 16π');
  assert.equal(verified.scene.elements.some(item => item.type === 'section-circle'), true);

  const impossible = await solveConfirmedGeometry(circular('sphere', {radius: integer(3), planeDistance: integer(4)}, {type: 'section_circle'}), {pythonBin});
  assert.equal(impossible.solverStatus, 'contradictory');
  assert.equal(impossible.failureCode, 'SECTION_PLANE_OUTSIDE_SPHERE');
});

test('圆柱轴截面面积是解析矩形而不是渲染近似值', async () => {
  const result = await solveConfirmedGeometry(circular('right_cylinder', {radius: integer(2), height: integer(7)}, {type: 'axis_section'}), {pythonBin});
  assert.equal(result.solverStatus, 'verified');
  assert.equal(result.answer.displayPlain, '轴截面面积 = 28');
  assert.equal(result.scene.elements.some(item => item.type === 'section-rectangle'), true);
});

test('球的大圆与圆柱平行底面截面都生成经过验证的截面模型', async () => {
  const greatCircle = await solveConfirmedGeometry(parseCircularGeometryText('半径为 5 的球，截面过球心，求截面面积'), {pythonBin});
  assert.equal(greatCircle.solverStatus, 'verified');
  assert.equal(greatCircle.answer.displayPlain, '截面半径 = 5；截面面积 = 25π');
  const cylinderSectionIR = parseCircularGeometryText('半径为 3，高为 5 的圆柱，求平行于底面的截面面积。');
  assert.equal(cylinderSectionIR.status, undefined);
  assert.equal(cylinderSectionIR.query.type, 'parallel_base_section');
  const cylinderSection = await solveConfirmedGeometry(cylinderSectionIR, {pythonBin});
  assert.equal(cylinderSection.solverStatus, 'verified');
  assert.equal(cylinderSection.answer.displayPlain, '平行底面截面面积 = 9π');
  assert.equal(cylinderSection.scene.elements.some(item => item.type === 'section-circle'), true);
});

test('球截面直径和球心距可反推出球半径，不再误把截面直径当球直径', async () => {
  const parsed = parseCircularGeometryText('平面截一球得到直径是6的圆面，球心到这个平面的距离是4，求球体积。');
  assert.equal(parsed.status, undefined);
  assert.deepEqual(parsed.parameters.radius, {op: 'integer', value: 5});
  assert.deepEqual(parsed.parameters.planeDistance, {op: 'integer', value: 4});
  assert.equal(parsed.query.type, 'section_circle');
  const solved = await solveConfirmedGeometry(parsed, {pythonBin});
  assert.equal(solved.solverStatus, 'verified');
  assert.equal(solved.answer.displayPlain, '截面半径 = 3；截面面积 = 9π');
});

test('球截面半径不会被通用“半径”匹配误认成球半径', async () => {
  const parsed = parseCircularGeometryText('球的截面圆半径为3，球心到该平面的距离为4，求球的体积。');
  assert.deepEqual(parsed.parameters.radius, {op: 'integer', value: 5});
  assert.deepEqual(parsed.parameters.planeDistance, {op: 'integer', value: 4});
  const solved = await solveConfirmedGeometry(parsed, {pythonBin});
  assert.equal(solved.solverStatus, 'verified');
});

test('视觉候选中的球截面结构会归一到与文本相同的精确 IR', async () => {
  const parsed = parseCircularGeometryText('如图，球被平面截得圆，求截面面积。', '', {
    bodyType: 'sphere',
    quantities: {
      radius: {value: 5, confidence: 0.98, evidence: '题干“球半径为5”'},
      planeDistance: {value: 3, confidence: 0.96, evidence: '图中 OH=3'}
    },
    query: 'section_circle',
    section: {kind: 'plane_section', throughCenter: false},
    constructions: [{kind: 'connect_center_to_section_center', reason: '球心到截平面垂线经过截面圆心', dependsOn: ['OH']}]
  });
  assert.equal(parsed.body.type, 'sphere');
  assert.equal(parsed.query.type, 'section_circle');
  assert.equal(parsed.constructionCandidates.length, 1);
  const solved = await solveConfirmedGeometry(parsed, {pythonBin});
  assert.equal(solved.solverStatus, 'verified');
  assert.equal(solved.answer.displayPlain, '截面半径 = 4；截面面积 = 16π');
});

test('低置信度视觉尺寸不能绕过缺失信息检查', () => {
  const parsed = parseCircularGeometryText('如图，球被平面截得圆。', '', {
    bodyType: 'sphere',
    quantities: {radius: {value: 5, confidence: 0.3}, planeDistance: {value: 3, confidence: 0.2}},
    query: 'section_circle', section: {kind: 'plane_section'}
  });
  assert.equal(parsed.status, 'needs_more_context');
});
