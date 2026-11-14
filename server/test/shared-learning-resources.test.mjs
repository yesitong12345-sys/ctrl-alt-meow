import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedCardSnapshot, sharedMistakeSnapshot, importedMistake} from '../workflows/shared-learning-resources.mjs';

test('共享快照不携带身份、复习状态、私人过程与聊天', () => {
  const record = {question: '求函数导数。', subject: '数学', studentAnswer: '原作者作答', correctAnswer: '2x', analysis: '逐项求导', knowledgePoints: ['导数'], errorCauses: ['漏项'], user_id: 'author', learningProfile: {mastery: 99, fsrs: {stability: 20}}, processSteps: [{detail: '私有过程'}], tutorSessions: ['私有聊天'], sourceImage: {hash: 'private-image'}};
  const snapshot = sharedMistakeSnapshot(record);
  const copy = importedMistake({id: 'shared-1', subject: '数学', snapshot}, {id: 'mine', userId: 'recipient', createdAt: '2026-10-11T00:00:00Z'});
  assert.equal(snapshot.user_id, undefined); assert.equal(snapshot.learningProfile, undefined);
  assert.equal(snapshot.processSteps, undefined); assert.equal(snapshot.tutorSessions, undefined);
  assert.equal(copy.studentAnswer, ''); assert.deepEqual(copy.errorCauses, []);
  assert.equal(copy.sharedExampleAnswer, '原作者作答'); assert.equal(copy.correctAnswer, '2x');
  assert.equal(copy.learningProfile.mastery, 0); assert.equal(copy.learningProfile.fsrs, null);
});

test('知识卡完整保存但不共享个人评分与源题归属', () => {
  const snapshot = sharedCardSnapshot({frontContent: '正面'.repeat(2000), backContent: '背面'.repeat(2000), reviewSchedule: {streak: 9}, sourceCaseIds: ['private-case'], fsrs: {stability: 100}});
  assert.equal(snapshot.frontContent.length, 4000); assert.equal(snapshot.backContent.length, 4000);
  assert.equal(snapshot.sourceCaseIds, undefined); assert.equal(snapshot.fsrs, undefined); assert.equal(snapshot.reviewSchedule, undefined);
});

test('旧版共享错题兼容导入，无完整题干时不造假题', () => {
  const opts = {id: 'mine', userId: 'student', createdAt: '2026-10-11T00:00:00Z'};
  const copy = importedMistake({id: 'old', description: '【题目】求导数。\n【我的作答】x\n【参考答案】2x\n【解析/提醒】幂函数求导'}, opts);
  assert.equal(copy.question, '求导数。'); assert.equal(copy.correctAnswer, '2x'); assert.equal(copy.sharedExampleAnswer, 'x');
  assert.equal(importedMistake({description: '只有错因，没有题目'}, opts), null);
});
