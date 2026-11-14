import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHeatmap} from '../workflows/learning-summary.mjs';
import {masteryFromStability} from '../workflows/fsrs-scheduler.mjs';

const mistake = (id, profile, subject = '数学') => ({
  id, subject, knowledgePoints: ['线面角'], learningProfile: profile,
  createdAt: '2026-09-25T00:00:00.000Z'
});

test('错题评分后的 mastery 立即进入归纳热力图', () => {
  const before = buildHeatmap({cases: [mistake('q1', {mastery: 28})]})[0];
  const after = buildHeatmap({cases: [mistake('q1', {mastery: 82})]})[0];
  assert.equal(before.mastery, 28);
  assert.equal(after.mastery, 82);
});

test('旧错题仅有 FSRS stability 时也计算掌握度，未评分知识卡不覆盖它', () => {
  const cell = buildHeatmap({
    cases: [mistake('q1', {fsrs: {stability: 10}})],
    knowledgeCards: [{subject: '数学', knowledgePoint: '线面角', fsrs: null}]
  })[0];
  assert.equal(cell.mastery, masteryFromStability(10));
});

test('同名知识点跨学科不串掌握度', () => {
  const cells = buildHeatmap({cases: [mistake('math', {mastery: 80}), mistake('physics', {mastery: 20}, '物理')]});
  assert.equal(cells.find(cell => cell.subject === '数学').mastery, 80);
  assert.equal(cells.find(cell => cell.subject === '物理').mastery, 20);
});

test('同一知识点聚合知识卡 stability、错题 FSRS stability 和错题 mastery', () => {
  const cell = buildHeatmap({
    cases: [
      mistake('fsrs-case', {fsrs: {stability: 30}, mastery: 12}),
      mistake('mastery-case', {mastery: 80})
    ],
    knowledgeCards: [{subject: '数学', knowledgePoint: '线面角', fsrs: {stability: 2}}]
  })[0];
  const fsrsCaseMastery = Math.round((masteryFromStability(30) + 12) / 2);
  const expected = Math.round((fsrsCaseMastery + 80 + masteryFromStability(2)) / 3);
  assert.equal(cell.mastery, expected);
});
