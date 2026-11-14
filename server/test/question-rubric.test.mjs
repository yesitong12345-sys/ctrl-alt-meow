import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQuestionRubric} from '../workflows/question-rubric.mjs';
import {advanceTutorSession, createTutorSession} from '../workflows/tutor-session.mjs';

test('单选题按每个选项与最终选择生成真实得分点', () => {
  const result = buildQuestionRubric('单项选择题：下列说法正确的是（ ）\nA. a·b=0\nB. a=b\nC. |a|=0\nD. a与b同向');
  assert.equal(result.questionKind, 'single_choice');
  assert.deepEqual(result.options.map(option => option.label), ['A', 'B', 'C', 'D']);
  assert.deepEqual(result.parts.map(part => part.id), ['judge_A', 'judge_B', 'judge_C', 'judge_D', 'final_selection']);
  assert.match(result.parts[0].hint, /判断.*A.*理由/);
  assert.match(result.parts.at(-1).label, /唯一/);
});

test('多选题逐项判断后汇总全部正确选项', () => {
  const result = buildQuestionRubric('多项选择题：下列结论正确的有（ ）\nA. 直线与平面平行\nB. 直线在平面内\nC. 两平面垂直\nD. 两直线异面');
  assert.equal(result.questionKind, 'multiple_choice');
  assert.equal(result.parts.length, 5);
  assert.match(result.parts.at(-1).label, /全部/);
  assert.match(result.parts.at(-1).hint, /漏选|多选/);
});

test('AI 陪练的 learningState 持久保存选择题的选项级得分点', () => {
  const question = '单选题：若 a·b=0，且 a、b 均为非零向量，则（ ）\nA. a与b垂直\nB. a与b平行\nC. a=b\nD. |a|=|b|';
  const session = createTutorSession({caseId: 'choice-case', context: {question}});
  assert.equal(session.learningState.rubricId, 'choice_question');
  assert.deepEqual(session.learningState.progressRubric.map(part => part.id), ['judge_A', 'judge_B', 'judge_C', 'judge_D', 'final_selection']);
  assert.equal(session.learningState.currentStep, 'judge_A');
});

test('已知标准选择时，错误的逐项判断不能被误记为完成', () => {
  const rubric = buildQuestionRubric('单项选择题：下列结论正确的是：\nA. a 与 b 平行\nB. a 与 b 垂直\nC. a=b\nD. |a|=|b|', {correctOptionLabels:['B']});
  const judgeA = rubric.steps.find(step => step.id === 'judge_A');
  const judgeB = rubric.steps.find(step => step.id === 'judge_B');
  assert.equal(judgeA.detect('A 正确，因为数量积为 0'), false);
  assert.equal(judgeA.detect('A 错误，因为数量积为 0 代表垂直'), true);
  assert.equal(judgeB.detect('B 正确，因为数量积为 0 代表垂直'), true);
  assert.equal(judgeB.detect('B 错误'), false);
});

test('选择题陪练明确指出逐项判断错误，且不会推进得分点', async () => {
  const question = '单项选择题：下列结论正确的是：\nA. a 与 b 平行\nB. a 与 b 垂直\nC. a=b\nD. |a|=|b|';
  const session = createTutorSession({caseId:'choice-feedback',context:{question,choiceAnswer:['B']}});
  await advanceTutorSession(session,{studentMessage:'A 正确，因为数量积为 0'});
  assert.equal(session.latestTurn.correctness,'incorrect');
  assert.match(session.latestTurn.explanation,/选项 A.*判断.*不正确|标准结论/);
  assert.equal(session.learningState.completedSteps.includes('judge_A'),false);
  assert.equal(session.learningState.currentStep,'judge_A');
});

test('单选题逐项判断到最终选择持续推进，完成后不倒退重复提问', async () => {
  const question = '单项选择题：下列结论正确的是：\nA. a 与 b 平行\nB. a 与 b 垂直\nC. a=b\nD. |a|=|b|';
  const session = createTutorSession({caseId:'choice-complete',context:{question,choiceAnswer:['B']}});
  for (const answer of ['A 错误，因为数量积为 0 表示垂直','B 正确，因为数量积为 0 的非零向量垂直','C 错误，因为垂直不代表相等','D 错误，因为题目没有模长相等条件','最终选择：B']) {
    await advanceTutorSession(session,{studentMessage:answer});
  }
  assert.deepEqual(session.learningState.completedSteps,['judge_A','judge_B','judge_C','judge_D','final_selection']);
  assert.equal(session.learningState.currentStep,'completed');
  assert.equal(session.learningState.scoreProgress.percent,100);
  const restored = JSON.parse(JSON.stringify(session));
  assert.equal(restored.learningState.currentStep,'completed');
  assert.equal(restored.learningState.completedSteps.includes('judge_A'),true);
});

test('多选最终答案漏选或多选不能完成，正确全集才能完成', () => {
  const rubric=buildQuestionRubric('多项选择题：下列正确的是：\nA. 结论甲\nB. 结论乙\nC. 结论丙\nD. 结论丁',{correctOptionLabels:['A','C']});
  const final=rubric.steps.find(step=>step.id==='final_selection');
  assert.equal(final.detect('最终选择：A'),false);
  assert.equal(final.detect('最终选择：A、B、C'),false);
  assert.equal(final.detect('最终选择：A、C'),true);
});

test('真实 OCR 常见选项符号仍能识别为逐项得分点', () => {
  for(const question of [
    '单选题：选择正确项 (A) 甲 (B) 乙 (C) 丙 (D) 丁',
    '单选题：选择正确项 A、甲 B．乙 C: 丙 D项 丁'
  ]) assert.deepEqual(buildQuestionRubric(question).options.map(item=>item.label),['A','B','C','D']);
});

test('配置例题的真实数值与各自陪练 rubric 保持一致', async () => {
  const cases=[
    {rubricId:'grade10_vector_dot',question:'已知 a=(1,2)，b=(2,-1)，判断是否垂直。',answer:'向量 a=(1,2)，向量 b=(2,-1)'},
    {rubricId:'grade10_prism_volume',question:'直三棱柱底面积 12，高 5，求体积。',answer:'底面积是 12，高是 5'},
    {rubricId:'grade10_statistics',question:'数据 2,3,3,5,7 的平均数与中位数。',answer:'数据已从小到大排序为 2,3,3,5,7'}
  ];
  for(const item of cases){
    const session=createTutorSession({caseId:item.rubricId,context:{question:item.question,rubricId:item.rubricId}});
    await advanceTutorSession(session,{studentMessage:item.answer});
    assert.equal(session.learningState.completedSteps.length,1,item.rubricId);
  }
});
