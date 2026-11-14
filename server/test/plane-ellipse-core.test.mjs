import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../../implementation/plane-ellipse-core.js';

const input = (line = [0, 1, -2]) => ({schemaVersion: 'plane-ellipse/v1', ellipse: {id: 'ellipse-e', semiMajor: 5, semiMinor: 3}, line: {id: 'line-l', coefficients: line}});

test('标准椭圆与直线稳定给出两交点、相切和相离，不依赖斜率形式', () => {
  const secant = core.compile(input());
  assert.equal(secant.status, 'verified');
  assert.equal(secant.solution.relation, 'secant');
  assert.deepEqual(secant.solution.intersectionIds, ['point-i-1', 'point-i-2']);
  assert.ok(Math.abs(secant.scene.elements.find(x => x.id === 'point-i-1').position[0] + Math.sqrt(125 / 9)) < 1e-9);
  assert.equal(core.compile(input([0, 1, -3])).solution.relation, 'tangent');
  assert.equal(core.compile(input([0, 1, -4])).solution.relation, 'separate');
  assert.equal(core.compile(input([1, 0, -4])).solution.relation, 'secant', '竖直线不能依赖斜率形式');
});

test('椭圆核心拒绝退化参数与近切不确定输入，SVG只高亮有效实体且结果服从门禁', () => {
  for (const changed of [
    {...input(), ellipse: {id: 'ellipse-e', semiMajor: 3, semiMinor: 3}},
    {...input(), ellipse: {id: 'ellipse-e', semiMajor: 3, semiMinor: 4}},
    {...input(), line: {id: 'line-l', coefficients: [0, 0, 1]}}
  ]) assert.notEqual(core.compile(changed).status, 'verified');
  const model = core.compile(input());
  const hidden = core.render(model, {entityIds: ['ellipse-e']});
  assert.equal(hidden.svg.includes('data-conic-result="true"'), false);
  const shown = core.render(model, {entityIds: ['ellipse-e'], completed: true, answerUnlocked: true});
  assert.equal(shown.svg.includes('data-conic-result="true"'), true);
  assert.equal(core.render(model, {entityIds: ['bad-id']}).mode, 'text_only');
});
