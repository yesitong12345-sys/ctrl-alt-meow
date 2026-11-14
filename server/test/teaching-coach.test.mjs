import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceTeachingCoachSession,
  createTeachingCoachSession,
  createTeachingCoach,
  createDeepSeekProblemUnderstandingAdapter,
  createLocalProblemUnderstandingAdapter
} from '../workflows/teaching-coach.mjs';

test('切线题会从几何关系主动推出圆心到切点的辅助半径', async () => {
  const coach = createTeachingCoach();
  const result = await coach.plan({
    questionText: '圆 O 外一点 P 引圆的切线 PA，A 为切点，证明相关长度关系。',
    studentMessage: '我看不出来切线条件能怎么用'
  });

  assert.equal(result.subject, 'math');
  assert.equal(result.skill, 'edu-analytic-geometry');
  assert.equal(result.knowledgePoint, '圆与切线');
  const radius = result.visualization.constructions.find(item => item.type === 'segment' && item.a === 'O' && item.b === 'A');
  assert.ok(radius, '应主动连接圆心与切点');
  assert.match(radius.reason, /半径.*切线|垂直/);
  assert.ok(radius.revealAt > 0, '辅助线应随教学步骤出现');
  assert.ok(result.teachingPath.some(step => step.phase === 'operation'));
});

test('立体几何只委托现有模块，普通非目标学科不会被误路由', async () => {
  const coach = createTeachingCoach();
  const solid = await coach.plan({questionText: '在正四棱锥中求线面角。'});
  assert.equal(solid.skill, 'edu-solid-geometry');
  assert.equal(solid.visualization.delegatedEndpoint, '/v1/workflows/geometry');
  const unsupported = await coach.plan({questionText: '求函数 f(x) 的最大值。'});
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.skill, null);
});

test('教学教练多轮会话保存阶段和已显示的辅助构造', async () => {
  const coach = createTeachingCoach();
  const session = await createTeachingCoachSession({
    caseId: 'circle-case-1',
    questionText: '圆 O 外一点 P 引切线 PA，A 为切点。'
  }, coach);
  assert.equal(session.currentPhase, 'observation');
  await advanceTeachingCoachSession(session, {studentMessage: '我看到了圆心、切点和切线。'}, coach);
  assert.equal(session.currentPhase, 'hint');
  await advanceTeachingCoachSession(session, {studentMessage: '我想连接 OA。'}, coach);
  assert.equal(session.currentPhase, 'hint', '只提出计划时不能自动算作完成');
  await advanceTeachingCoachSession(session, {studentMessage: '我连接了 OA，并知道 OA 垂直 PA。'}, coach);
  assert.equal(session.currentPhase, 'operation');
  assert.ok(session.revealedConstructionIds.some(id => id.startsWith('radius-')));
  assert.equal(session.turns.length, 3);
  assert.match(session.turns[1].teacherResponse, /计划|实际操作/);
  assert.ok(session.turns.every(turn => typeof turn.teacherResponse === 'string' && turn.teacherResponse.length > 0));
});

test('解析几何不强套建系步骤，而按题目已有坐标规划', async () => {
  const coach = createTeachingCoach();
  const result = await coach.plan({
    questionText: '已知圆 C: x^2+y^2-4x=0，直线 l 过点 P(3,1)，求 l 与圆相切时的斜率。',
    studentMessage: '我已经把圆化成了标准方程'
  });

  assert.equal(result.skill, 'edu-analytic-geometry');
  assert.ok(!result.scoringRubric.some(item => /建立坐标系/.test(item.title)));
  assert.ok(result.scoringRubric.some(item => /圆心|半径/.test(item.title)));
  assert.ok(result.visualization.constructions.some(item => item.id === 'candidate-tangent'));
  assert.ok(result.visualization.boardPatch.derived.some(item => item.type === 'line_through_slope'));
  assert.equal(result.scoringRubric.reduce((sum, item) => sum + item.weight, 0), 100);
});

test('化学配平卡点优先使用守恒表而不是强制生成 3D 动画', async () => {
  const coach = createTeachingCoach();
  const result = await coach.plan({
    questionText: '配平 Fe + O2 → Fe3O4，并说明依据。',
    studentMessage: '氧原子数量总是配不齐'
  });

  assert.equal(result.subject, 'chemistry');
  assert.equal(result.skill, 'edu-chem-reaction');
  assert.equal(result.visualization.mode, 'conservation-table');
  assert.equal(result.visualization.use3d, false);
  assert.match(result.visualization.rationale, /守恒|配平/);
  assert.deepEqual(result.visualization.teachingData.elements, ['Fe', 'O']);
  assert.equal(result.visualization.teachingData.source, 'teaching-preview');
});

test('有机反应机理需要空间过程时保留化学 3D 引擎', async () => {
  const coach = createTeachingCoach();
  const result = await coach.plan({
    questionText: '解释酯化反应中羧酸与醇的断键、成键和质子转移过程。',
    studentMessage: '我分不清哪个键先断，原子最后去了哪里'
  });

  assert.equal(result.visualization.mode, 'molecular-mechanism-3d');
  assert.equal(result.visualization.use3d, true);
  assert.equal(result.visualization.engine, 'mechanism');
  assert.ok(result.teachingPath.some(step => step.phase === 'verification'));
});

test('已有结构化 IR 时以 IR 为事实源，不用题型关键词覆盖它', async () => {
  const understand = createLocalProblemUnderstandingAdapter();
  const ir = await understand({
    questionText: '请解答下题。',
    problemIR: {
      subject: 'math',
      domain: 'circle',
      knowledgePoint: '圆与切线',
      targetRelations: [{type: 'prove_perpendicular', objects: ['OA', 'PA']}],
      entities: [{id: 'O', type: 'circle_center'}, {id: 'A', type: 'tangent_point'}, {id: 'P', type: 'point'}],
      relations: [{type: 'tangent_at', line: 'PA', circle: 'O', point: 'A'}]
    }
  });

  assert.equal(ir.domain, 'circle');
  assert.equal(ir.relations[0].type, 'tangent_at');
  assert.equal(ir.provenance, 'provided-ir');
});

test('不完整的外部 IR 会被安全归一化而不是让规划器崩溃', async () => {
  const coach = createTeachingCoach();
  const result = await coach.plan({problemIR: {subject: 'math', domain: 'circle', relations: null, targets: 'solve'}});
  assert.deepEqual(result.problemIR.relations, []);
  assert.deepEqual(result.problemIR.targets, []);
  assert.equal(result.scoringRubric.reduce((sum, item) => sum + item.weight, 0), 100);
});

test('未配置视觉模型时图片入口明确标记不可识图，不伪造解析', async () => {
  const adapter = createDeepSeekProblemUnderstandingAdapter({}, createLocalProblemUnderstandingAdapter());
  const ir = await adapter({questionText: '请解析图片题目', imageDataUrl: 'data:image/png;base64,AA=='});
  assert.equal(ir.visualInputStatus, 'vision-model-not-configured');
  assert.equal(ir.provenance, 'local-visual-fallback');
});

test('互动课操作证据会随学生回答保存在同一教学会话', async () => {
  const session = await createTeachingCoachSession({questionText: '椭圆焦点弦的数量积范围'}, createTeachingCoach());
  await advanceTeachingCoachSession(session, {
    studentMessage: '我拖到 30 度后发现数量积变小了',
    interactionEvidence: {kind: 'analytic', event: 'parameter_changed', value: 30, readouts: [{id: 'dot', scalar: -1.5}]}
  }, createTeachingCoach());
  assert.equal(session.turns.at(-1).interactionEvidence.value, 30);
  assert.equal(session.turns.at(-1).interactionEvidence.readouts[0].id, 'dot');
  assert.match(session.turns.at(-1).teacherResponse, /参数调到了 30/);
});

test('视觉服务请求失败时必须显式标记失败，不能静默冒充识图成功', async () => {
  const adapter = createDeepSeekProblemUnderstandingAdapter({
    visionEndpoint: 'http://127.0.0.1:1/v1/chat/completions', visionApiKey: 'test-key', visionModel: 'qwen-test'
  }, createLocalProblemUnderstandingAdapter());
  const ir = await adapter({questionText: '图片中的解析几何题', imageDataUrl: 'data:image/png;base64,AA=='});
  assert.equal(ir.visualInputStatus, 'vision-request-failed');
});
