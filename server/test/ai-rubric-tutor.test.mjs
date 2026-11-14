import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceTutorSession, createTutorSession} from '../workflows/tutor-session.mjs';
import {normalizeAiRubric} from '../workflows/ai-rubric.mjs';

/* 一道普通题：没有几何编译数据，按原逻辑只会拿到 generic_math 的固定四步。 */
const plainQuestion = '在正方体 ABCD-A1B1C1D1 中，求直线 AC1 与平面 ABCD 所成角的余弦值。';

const aiRubric = normalizeAiRubric({
  steps: [
    {label: '确定底面与侧棱关系', goal: '认出正方体的垂直关系', keywords: ['正方体', '垂直'], nextQuestion: '哪些棱互相垂直？'},
    {label: '写出各顶点坐标', goal: '按棱长设坐标', keywords: ['坐标', '棱长'], nextQuestion: '坐标怎么设？'},
    {label: '求 AC1 的方向向量', goal: '终点减起点', keywords: ['方向向量', 'AC1'], nextQuestion: '方向向量是多少？'},
    {label: '求平面 ABCD 的法向量', goal: '底面的法向量是竖直方向', keywords: ['法向量', '平面'], nextQuestion: '法向量取哪个？'},
    {label: '代入线面角公式并检验', goal: '用方向向量与法向量夹角的余弦', keywords: ['余弦', '检验'], nextQuestion: '结果在范围内吗？'},
  ],
}, plainQuestion);

test('陪练得分点取用 AI 反推结果，而不是通用模板', () => {
  const session = createTutorSession({
    caseId: 'case-ai',
    context: {question: plainQuestion, subject: '数学', aiRubric},
  });
  const ids = session.learningState ? session.learningState.progressRubric.map(p => p.id) : [];
  assert.deepEqual(ids, ['ai_1', 'ai_2', 'ai_3', 'ai_4', 'ai_5'],
    '应该用 AI 反推的 5 个得分点，而不是 generic_math 的固定步骤');
  const labels = session.learningState.progressRubric.map(p => p.title);
  assert.equal(labels[0], '确定底面与侧棱关系');
  assert.equal(session.learningState.currentStep, 'ai_1');
});

test('没有 AI 反推时行为不变（回落到原有模板 / 编译推导）', () => {
  const session = createTutorSession({
    caseId: 'case-plain',
    context: {question: plainQuestion, subject: '数学'},
  });
  const ids = session.learningState.progressRubric.map(p => p.id);
  assert.ok(ids.length > 0);
  assert.equal(ids.some(id => String(id).startsWith('ai_')), false, '没有 AI 结果时不应该凭空冒出 ai_ 步骤');
});

test('AI 步骤能用关键词判定完成：学生说到这一步就推进（走真实 advance）', async () => {
  const session = createTutorSession({
    caseId: 'case-ai-2',
    context: {question: plainQuestion, subject: '数学', aiRubric},
  });
  assert.equal(session.learningState.currentStep, 'ai_1');
  assert.equal(session.learningState.progressRubric.length, 5);

  // 学生说出了第 1 步的关键词（正方体 / 垂直），本地判定应当完成这一步
  await advanceTutorSession(session, {studentMessage: '正方体里底面和侧棱是互相垂直的'}, null);
  assert.equal(session.learningState.completedSteps.includes('ai_1'), true,
    '说出关键词后第 1 步应被记为完成');
  assert.equal(session.learningState.currentStep, 'ai_2', '应推进到第 2 步');

  // 完全无关的话不应推进
  const before = session.learningState.currentStep;
  await advanceTutorSession(session, {studentMessage: '老师我今天心情不太好'}, null);
  assert.equal(session.learningState.currentStep, before, '没说到关键词时不应推进');
});
