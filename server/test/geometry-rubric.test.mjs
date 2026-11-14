import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGeometryRubric, tutorGeometryContext} from '../workflows/geometry-rubric.mjs';
import {advanceTutorSession, createTutorSession} from '../workflows/tutor-session.mjs';

/* 真实球截面题：解题步骤里带真实数值，题目只问“截面圆的半径和面积”。 */
const SPHERE_CASE = {
  question: '球的半径为 5，球心到截平面的距离为 3，求截面圆的半径和面积。',
  solutionOutline: [
    '设球半径 R=5，球心 O 到截面的距离 d=3。',
    '设截面圆半径为 r，球心、截面圆圆心与截面圆上任一点构成直角三角形，满足 R^2=r^2+d^2。',
    '所以 r=√(5^2-3^2)=√16=4。',
    '截面圆面积 S=πr^2=π·4^2=16π。'
  ],
  geometryIR: {queries: [{id: 'query-1', kind: 'section_circle', quote: '求截面圆的半径和面积'}]},
  correctAnswer: '截面半径 = 4；截面面积 = 16π',
  knowledgePoints: ['空间几何']
};

/* 正六棱柱题：编译结果里只有“题目所问的量”，且带标准答案。 */
const PRISM_QUERY_CASE = {
  question: '正六棱柱 ABCDEF-A1B1C1D1E1F1 的底面边长为 3，侧棱长为 6，求该棱柱的体积与体对角线 AF1 的长度。',
  geometryIR: {
    queries: [
      {id: 'query-volume', kind: 'volume', quote: '求该棱柱的体积', expected: '81√3'},
      {id: 'query-af1-length', kind: 'length', quote: '体对角线 AF1的长度', expected: '3√5'}
    ]
  }
};

/* 家长反馈的真实题目：证明步骤里出现 BC1、BCC1B1 这类带数字的点名，
   且一步里有多个候选量（法向量、方向向量、被解出的参数）。 */
const DIRECT_PRISM_CASE = {
  question: '直三棱柱 ABC-A₁B₁C₁ 中，∠ACB=90°，AC=BC，D、E 分别为 AB、AC₁ 的中点。证明 DE∥平面 BCC₁B₁；若 CC₁=2，DE 与平面 ACC₁A₁ 成 45° 角，求 DE 到平面 BCC₁B₁ 的距离。',
  solutionOutline: [
    '连接 BC1。因为 D 是 AB 中点，E 是 AC1 中点，所以在△ABC1中 DE 是中位线，故 DE∥BC1。',
    '又 B、C、C1 都在平面 BCC1B1 内，所以 BC1⊂平面 BCC1B1。DE 不在该平面内，因此 DE∥平面 BCC1B1。',
    '平面 ACC1A1 为 y=0，法向量为 (0,1,0)。线面角 45° 给出 (a/2)/sqrt(a^2/4+1)=sin45°=√2/2，解得 a=2。',
    '于是 D=(1,1,0)，E=(1,0,1)，DE 方向为 (0,-1,1)。',
    'DE 到平面 BCC1B1 的距离等于 |1|=1。'
  ],
  geometryIR: {queries: [{id: 'query-distance', kind: 'distance', statement: '求 DE 到平面 BCC1B1 的距离', answer: 1}]}
};

test('对象名提取失败时不退化成“求1”，证明类步骤给出关系结论且不硬塞数值', () => {
  const rubric = buildGeometryRubric(DIRECT_PRISM_CASE);
  const labels = rubric.parts.map(part => part.label);
  assert.deepEqual(labels.slice(0, 2), ['第1步 证明 DE∥BC1', '第2步 证明 DE∥平面 BCC1B1']);
  assert.equal(labels.some(label => /求\s*1|求关键结果/.test(label)), false);
  assert.equal(labels.some(label => /求\s*\d$/.test(label)), false);

  const first = rubric.steps.find(step => step.id === 'outline_1');
  const second = rubric.steps.find(step => step.id === 'outline_2');
  assert.equal(first.knownResult, '已完成本步证明：DE∥BC1');
  assert.equal(second.knownResult, '已完成本步证明：DE∥平面 BCC1B1');
  assert.doesNotMatch(first.knownResult, /=/, '证明步骤不生成数值型“已求出”');
  assert.doesNotMatch(first.understanding, /得到\s*\d/);
  // 证明类按结论里的点线面名判定：写到 DE 与 BC1 的关系才算完成。
  assert.equal(first.detect('所以在三角形ABC1中，DE平行于BC1'), true);
  assert.equal(first.detect('因为D、E分别是中点'), false);
  assert.equal(second.detect('BC1在平面BCC1B1内，DE不在该平面内，所以DE∥平面BCC1B1'), true);
  assert.equal(second.detect('这题要用中位线定理'), false);
  // 提示语不直接写出要证的结论。
  assert.doesNotMatch(rubric.parts[0].hint, /DE∥BC1/);
});

test('一步里有多个候选量时，取值与量名语义一致，不把法向量或方向向量当标量结果', () => {
  const rubric = buildGeometryRubric(DIRECT_PRISM_CASE);
  const byIndex = index => rubric.steps.find(step => step.id === `outline_${index}`);

  // “线面角的正弦值”取三角函数值 √2/2，而不是同一行里的法向量 (0,1,0)。
  const sine = byIndex(3);
  assert.match(sine.knownResult, /线面角的正弦值 = √2\/2/);
  assert.doesNotMatch(sine.knownResult, /\(0,1,0\)/);
  assert.equal(sine.detect('sin45°=√2/2'), true);
  assert.equal(sine.detect('法向量是(0,1,0)'), false);

  // 方向向量属于向量类量名，取它自己的 (0,-1,1)，而不是随便一个点坐标。
  const direction = byIndex(4);
  assert.match(direction.knownResult, /DE 方向 = \(0,-1,1\)/);
  assert.equal(direction.detect('DE 方向向量是 (0,-1,1)'), true);

  // 距离是标量结果：取 1，只写别的数字（例如法向量里的 0/1）不算完成。
  const distance = byIndex(5);
  assert.match(distance.knownResult, /距离 = 1$/);
  assert.equal(distance.detect('所以 DE 到平面 BCC1B1 的距离是 1'), true);
  assert.equal(distance.detect('法向量是(0,1,0)'), false);
});

test('被解出的参数取该参数自己的值，不取同一步里其它点的坐标', () => {
  const rubric = buildGeometryRubric({
    question: '解得参数并写出坐标。',
    solutionOutline: ['解得 a=2，因此 AC=BC=2，坐标化为 A=(2,0,0)，B=(0,2,0)，D=(1,1,0)，E=(1,0,1)。']
  });
  const step = rubric.steps[0];
  assert.match(rubric.parts[0].label, /求 a/);
  assert.match(step.knownResult, /a = 2$/);
  assert.doesNotMatch(step.knownResult, /\(1,0,1\)/);
  assert.equal(step.detect('解得 a=2'), true);
  assert.equal(step.detect('E 的坐标是 (1,0,1)'), false);
});

test('有 solutionOutline 的题按每一步生成得分点，数量与解题步骤一致', () => {
  const rubric = buildGeometryRubric({...SPHERE_CASE, geometryIR: null});
  assert.equal(rubric.source, 'solutionOutline');
  assert.equal(rubric.steps.length, SPHERE_CASE.solutionOutline.length);
  assert.equal(rubric.parts.length, SPHERE_CASE.solutionOutline.length);
  assert.deepEqual(rubric.parts.map(part => part.id), ['outline_1', 'outline_2', 'outline_3', 'outline_4']);
  for (const part of rubric.parts) assert.deepEqual(part.steps, [part.id]);

  // 得分点说的是这一步真正在算什么，并带真实数值，而不是“结合题目条件判断”。
  assert.match(rubric.parts[0].label, /明确.*已知条件.*半径 R/);
  assert.match(rubric.parts[1].label, /关系式.*R\^2=r\^2\+d\^2/);
  assert.match(rubric.parts[2].label, /求半径 r/);
  assert.match(rubric.parts[3].label, /求面积 S/);
  assert.match(rubric.parts[3].hint, /πr\^2=π·4\^2/);
  assert.equal(rubric.parts.some(part => /结合题目条件判断/.test(part.hint)), false);
  assert.equal(rubric.parts.some(part => /结合题目条件/.test(part.hint)), false);
});

test('有 queries 的题按题目实际所问的量生成“求某量”的得分点，并用 answer 判定', () => {
  const rubric = buildGeometryRubric(PRISM_QUERY_CASE);
  assert.equal(rubric.source, 'queries');
  assert.equal(rubric.parts.length, 2);
  assert.match(rubric.parts[0].label, /求该棱柱的体积/);
  assert.match(rubric.parts[1].label, /体对角线 AF1/);
  assert.match(rubric.parts[1].hint, /体对角线 AF1的长度/);

  const volume = rubric.steps.find(step => step.id === 'query_1');
  assert.equal(volume.detect('棱柱的体积是 81√3'), true);
  assert.equal(volume.detect('体积我还没算出来'), false);
  const af1 = rubric.steps.find(step => step.id === 'query_2');
  assert.equal(af1.detect('AF1 = 3√5'), true);
  assert.equal(af1.detect('AF1 = 3√3'), false);
  assert.equal(af1.detect(''), false);
});

test('题目所问的量正好由某一步算出时合并为同一个得分点，不重复计分', () => {
  const rubric = buildGeometryRubric({
    question: '正六棱柱 ABCDEF-A1B1C1D1E1F1 的底面边长为 3，侧棱长为 6，求该棱柱的体积。',
    solutionOutline: [
      '正六棱柱底面是边长为 3 的正六边形，底面积 S=(3√3/2)*3^2=27√3/2。',
      '棱柱的高等于侧棱长 6，所以体积 V=S*h=(27√3/2)*6=81√3。'
    ],
    geometryIR: {queries: [{id: 'query-volume', kind: 'volume', quote: '求该棱柱的体积', expected: '81√3'}]}
  });
  assert.equal(rubric.parts.length, 2, '题目所问的体积已由第 2 步算出，不再新增重复得分点');
  assert.deepEqual(rubric.parts[1].steps, ['outline_2', 'query_1']);
  const merged = rubric.steps.find(step => step.id === 'query_1');
  assert.match(merged.knownResult, /求该棱柱的体积.*81√3/);
});

test('数据缺失时优雅退回最小可用得分点，不抛异常', () => {
  const empty = buildGeometryRubric();
  assert.deepEqual(empty.parts, []);
  assert.deepEqual(empty.steps, []);
  assert.equal(empty.source, 'none');

  const minimal = buildGeometryRubric({
    question: '球的半径为 5，求截面圆半径。',
    knowledgePoints: ['球的截面'],
    correctAnswer: '截面半径 = 4'
  });
  assert.equal(minimal.source, 'knowledgePoints');
  assert.ok(minimal.parts.length >= 1);
  assert.match(minimal.parts[0].label, /球的截面/);
  assert.equal(minimal.steps[0].detect('截面半径 = 4'), true);
  assert.equal(minimal.steps[0].detect('我还不知道'), false);
});

test('只有结构化几何事实（derivation）时用 factCodes 兜底生成骨架得分点', () => {
  const rubric = buildGeometryRubric({
    question: '球的半径为 5，球心到截平面的距离为 3，求截面圆的半径和面积。',
    geometryResult: {
      derivation: [
        {stepId: 'frame', factCodes: ['SPHERE_CENTER_RADIUS']},
        {stepId: 'answer', factCodes: ['SECTION_RADIUS_PYTHAGORAS']}
      ]
    }
  });
  assert.equal(rubric.source, 'derivation');
  assert.equal(rubric.parts.length, 2);
  assert.match(rubric.parts[0].label, /确定球心、球半径/);
  assert.match(rubric.parts[1].label, /勾股定理/);
  const step = rubric.steps.find(item => item.id === 'derivation_2');
  assert.equal(step.detect('用勾股定理求截面圆半径'), true);
  assert.equal(step.detect('完全无关的一句话'), false);
});

test('每个步骤都满足 tutor 的步骤契约，detect 按真实关键量判定', () => {
  const rubric = buildGeometryRubric(SPHERE_CASE);
  const keys = ['detect', 'explanation', 'followUpQuestion', 'goal', 'id', 'knownResult', 'nextQuestion', 'understanding'];
  for (const step of rubric.steps) {
    assert.deepEqual(Object.keys(step).sort(), keys);
    assert.equal(typeof step.detect, 'function');
    assert.ok(step.goal.length > 0);
    assert.ok(step.nextQuestion.length > 0);
    assert.ok(step.followUpQuestion.length > 0);
    assert.ok(step.knownResult.length > 0);
  }
  for (const part of rubric.parts) {
    assert.ok(part.id && part.label && part.hint);
    assert.ok(part.steps.length > 0);
    assert.ok(part.steps.every(id => rubric.steps.some(step => step.id === id)));
  }

  const stepR = rubric.steps.find(step => step.id === 'outline_3');
  assert.equal(stepR.detect('所以 r=√(5^2-3^2)=√16=4'), true);
  assert.equal(stepR.detect('截面圆半径 r 等于 4'), true);
  assert.equal(stepR.detect('这里用勾股定理'), false, '只有方法没有关键量不能算完成');
  assert.equal(stepR.detect(''), false);

  const stepArea = rubric.steps.find(step => step.id === 'outline_4');
  assert.equal(stepArea.detect('面积 S=16π'), true);
  assert.equal(stepArea.detect('面积是 16'), false);
});

test('解答题（constructed_response）有几何编译数据时不再得到空得分点', () => {
  const context = tutorGeometryContext(SPHERE_CASE);
  const session = createTutorSession({caseId: 'case-sphere', context});
  assert.equal(session.learningState.questionKind, 'constructed_response');
  assert.ok(session.learningState.progressRubric.length >= SPHERE_CASE.solutionOutline.length);
  assert.deepEqual(session.learningState.progressRubric.map(part => part.id),
    ['outline_1', 'outline_2', 'outline_3', 'outline_4', 'query_1']);
  assert.equal(session.learningState.currentStep, 'outline_1');
  assert.equal(session.learningState.currentGoal, 'complete_outline_step_1');
  const titles = session.learningState.progressRubric.map(part => `${part.title}|${part.hint}`).join(' ');
  assert.match(titles, /半径 r/);
  assert.match(titles, /16π|π·4\^2/);
  assert.doesNotMatch(titles, /结合题目条件判断/);
});

test('解答题逐轮按真实关键量推进得分点，全部完成后进度为 100%', async () => {
  const session = createTutorSession({caseId: 'case-sphere-progress', context: tutorGeometryContext(SPHERE_CASE)});
  await advanceTutorSession(session, {studentMessage: '我还不知道这题要用哪个公式？'});
  assert.deepEqual(session.learningState.completedSteps, []);

  await advanceTutorSession(session, {studentMessage: '设球半径 R=5，球心到截面的距离 d=3。'});
  assert.deepEqual(session.learningState.completedSteps, ['outline_1']);

  await advanceTutorSession(session, {studentMessage: '球心、截面圆圆心与截面圆上任一点构成直角三角形，满足 R^2=r^2+d^2。'});
  assert.deepEqual(session.learningState.completedSteps, ['outline_1', 'outline_2']);

  await advanceTutorSession(session, {studentMessage: '所以 r=√(5^2-3^2)=√16=4。'});
  assert.deepEqual(session.learningState.completedSteps, ['outline_1', 'outline_2', 'outline_3']);

  await advanceTutorSession(session, {studentMessage: '截面圆面积 S=πr^2=π·4^2=16π。'});
  await advanceTutorSession(session, {studentMessage: '截面圆半径是 4，截面圆面积是 16π。'});
  assert.equal(session.learningState.scoreProgress.percent, 100);
  assert.equal(session.learningState.currentStep, 'completed');
});

test('没有几何编译数据时原有 rubric 档案与选择题目得分点完全不变', () => {
  const pac = createTutorSession({caseId: 'plain-pac', context: {question: '正四棱锥 P-ABCD 中，E 为 PC 中点，求 BE 与平面 PAC 所成角的正弦'}});
  assert.equal(pac.learningState.rubricId, 'regular_pyramid_line_plane');
  assert.deepEqual(pac.learningState.progressRubric.map(part => part.id), ['coordinates', 'line', 'normal', 'sine', 'simplify']);

  const generic = createTutorSession({caseId: 'plain-generic', context: {question: '空间几何坐标法'}});
  assert.equal(generic.learningState.rubricId, 'generic_math');
  assert.deepEqual(generic.learningState.progressRubric.map(part => part.id), ['target', 'method', 'derivation', 'result']);

  const choice = createTutorSession({
    caseId: 'plain-choice',
    context: {question: '单选题：若 a·b=0，且 a、b 均为非零向量，则（ ）\nA. a与b垂直\nB. a与b平行\nC. a=b\nD. |a|=|b|'}
  });
  assert.equal(choice.learningState.rubricId, 'choice_question');
  assert.deepEqual(choice.learningState.progressRubric.map(part => part.id), ['judge_A', 'judge_B', 'judge_C', 'judge_D', 'final_selection']);
});

test('tutorGeometryContext 只携带得分点需要的几何编译字段', () => {
  const context = tutorGeometryContext(SPHERE_CASE);
  assert.deepEqual(context.solutionOutline, SPHERE_CASE.solutionOutline);
  assert.equal(context.geometryIR.queries.length, 1);
  assert.equal(context.geometryIR.queries[0].quote, '求截面圆的半径和面积');
  assert.equal(context.correctAnswer, '截面半径 = 4；截面面积 = 16π');
  assert.equal('analysis' in context, false);
  assert.equal('studentAnswer' in context, false);
  assert.equal(tutorGeometryContext({question: '只有题干，没有编译结果'}), null);
});
