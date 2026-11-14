import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceTutorSession, buildTutorMessages, createDeepSeekTutorAdapter, createTutorSession, reconcileTutorSession} from '../workflows/tutor-session.mjs';

test('普通线面角题和未知旧 rubric 不得继承 PAC 专题步骤',()=>{
  for(const question of ['直三棱柱中求线面角正弦','正四棱锥中求侧棱与底面夹角']){
    const session=createTutorSession({caseId:'unrelated',context:{question}});
    assert.notEqual(session.learningState.rubricId,'regular_pyramid_line_plane');
    assert.ok(!JSON.stringify(session.learningState).includes('PAC'));
  }
});

test('线面角正弦已推导后，最终化简不能退回重复询问夹角正弦', async () => {
  const session = createTutorSession({
    caseId: 'case-final-simplification',
    context: {question: '正四棱锥中求 BE 与平面 PAC 所成角的正弦'}
  });

  await advanceTutorSession(session, {studentMessage: '我已经建立坐标系，顶点坐标确定，E 是 PC 中点，写出了 BE 的方向向量和平面 PAC 的法向量，并由线面角夹角得到了正弦值。'});
  assert.equal(session.learningState.currentStep, 'simplify');
  assert.ok(session.learningState.completedSteps.includes('angleCheck'));

  const result = await advanceTutorSession(session, {studentMessage: '我已经完成分母有理化和约分，现在是最终化简结果。'});
  assert.equal(result.learningState.currentStep, 'completed');
  assert.doesNotMatch(result.latestTurn.nextQuestion, /夹角|正弦/,
    'the tutor must not ask for the already-completed line-plane sine derivation again');
});

test('每次模型请求都携带原题、必要上下文、结构化学习状态和最新回答', async () => {
  const session = createTutorSession({caseId: 'case-message-contract', context: {question: '正四棱锥中求 BE 与平面 PAC 所成线面角正弦', knowledgePoints: ['线面角']}});
  await advanceTutorSession(session, {studentMessage: '我已经建立坐标系。'});
  const messages = buildTutorMessages(session, '我接着写 E 是 PC 的中点。', {correctness: 'partial', nextQuestion: '占位'});

  assert.equal(messages.length, 5);
  assert.deepEqual(JSON.parse(messages[1].content), {type:'original_problem', parentQuestion:session.context.question, currentSubproblem:session.context.question, subproblemId:'', subproblemTitle:'', subproblemIndex:0, knowledgePoints:['线面角'],handwrittenNotes:[],confirmedErrorCause:'',confirmedErrorCauseEvidence:'',studentSolutionSteps:[],studentStuckPoint:null});
  assert.equal(JSON.parse(messages[2].content).type, 'necessary_chat_context');
  const statePayload = JSON.parse(messages[3].content);
  assert.equal(statePayload.type, 'learning_state');
  assert.equal(statePayload.learningState.currentStep, 'vertices');
  assert.ok(statePayload.learningState.completedSteps.includes('frame'));
  assert.deepEqual(JSON.parse(messages[4].content).type, 'latest_student_answer');
});

test('拍照录入的做题记录与卡点进入陪练上下文，且只带必要字段', () => {
  const session = createTutorSession({caseId:'case-process-record', context:{
    question:'18. 求二面角大小。', knowledgePoints:['平面法向量'],
    solutionSteps:[
      {index:1,label:'建立坐标系',detail:'以 A 为原点建系',formula:'A(0,0,0)',verdict:'correct'},
      {index:2,label:'求平面法向量',detail:'算出 n=(1,1,1)',verdict:'wrong'},
      {index:3,label:'',detail:'',formula:''}
    ],
    stuckPoint:{stepIndex:2,label:'法向量算错后没有继续',status:'wrong',evidence:'手写“算出 n=(1,1,1)”后停笔'}
  }});
  // 判定用的仍是题干本身，做题记录不能改变题目类型判断。
  assert.equal(session.learningState.rubricId, 'generic_math');
  const context = session.context;
  assert.equal(context.solutionSteps.length, 2, '空步骤要丢掉');
  assert.deepEqual(context.solutionSteps[1], {stepIndex:2, label:'求平面法向量', detail:'算出 n=(1,1,1)', formula:'', verdict:'wrong'});
  assert.deepEqual(context.stuckPoint, {stepIndex:2, label:'法向量算错后没有继续', status:'wrong', evidence:'手写“算出 n=(1,1,1)”后停笔'});

  const messages = buildTutorMessages(session, '我重新算一次法向量。', {correctness:'partial', nextQuestion:'占位'});
  const problem = JSON.parse(messages[1].content);
  assert.equal(problem.type, 'original_problem');
  assert.equal(problem.studentSolutionSteps.length, 2);
  assert.equal(problem.studentSolutionSteps[0].formula, 'A(0,0,0)');
  assert.equal(problem.studentStuckPoint.stepIndex, 2);
  assert.match(messages[0].content, /studentStuckPoint/, '行为契约要说明历史线索不代表本轮已改正');
});

test('没有做题记录时不产生空字段，陪练上下文保持原样', () => {
  const session = createTutorSession({caseId:'case-no-record', context:{question:'求二面角大小。'}});
  assert.ok(!('solutionSteps' in session.context));
  assert.ok(!('stuckPoint' in session.context));
  const problem = JSON.parse(buildTutorMessages(session, '我不会。', {correctness:'partial', nextQuestion:'占位'})[1].content);
  assert.deepEqual(problem.studentSolutionSteps, []);
  assert.equal(problem.studentStuckPoint, null);
});

test('小问陪练的模型消息同时携带完整大题与当前小问', () => {
  const parentQuestion = '三棱锥 A-BCD 中，A 的射影为 O，BO⊥CD，且给出两个二面角。(1)证明 AB⊥CD；(2)求线面角；(3)求体积。';
  const session = createTutorSession({caseId:'case-subproblem-message', context:{
    question:'求 AD 与平面 BCD 所成角的正弦值。', parentQuestion,
    subproblemId:'q2', subproblemTitle:'求线面角正弦', subproblemIndex:2,
    rubricId:'triangular_projection_q2'
  }});
  const messages = buildTutorMessages(session, '我先把二面角转为平面角。', {correctness:'partial', nextQuestion:'继续'});
  const problem = JSON.parse(messages[1].content);
  assert.equal(problem.parentQuestion, parentQuestion);
  assert.equal(problem.currentSubproblem, '求 AD 与平面 BCD 所成角的正弦值。');
  assert.equal(problem.subproblemId, 'q2');
  assert.equal(problem.subproblemIndex, 2);
});

test('模型候选回复不能覆盖结构化下一目标，正在化简也不能误判为已完成', async () => {
  const session = createTutorSession({caseId: 'case-model-guard', context: {question: '正四棱锥中求 BE 与平面 PAC 所成角的正弦'}});
  await advanceTutorSession(session, {studentMessage: '我已经建立坐标系，顶点坐标确定，E 是 PC 中点，写出了 BE 的方向向量和平面 PAC 的法向量，并由线面角夹角得到了正弦值。'});
  const result = await advanceTutorSession(session, {studentMessage: '我正在约分和分母有理化。'}, async () => ({
    correctness: 'partial', understanding: '收到。', explanation: '错误的候选推进。', nextQuestion: '如何由夹角得到正弦值？'
  }));

  assert.equal(result.learningState.currentStep, 'simplify');
  assert.doesNotMatch(result.latestTurn.nextQuestion, /夹角|正弦/);
});

test('DeepSeek 适配器实际出站 messages 不会丢失结构化状态', async () => {
  let requestBody;
  const adapter = createDeepSeekTutorAdapter({
    endpoint: 'http://model.test/v1/chat/completions', apiKey: 'test-key', model: 'test-model',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {ok: true, json: async () => ({choices: [{message: {content: JSON.stringify({understanding: '继续。', correctness: 'partial', explanation: '保留现有进度。', nextQuestion: '错误候选问题', directAnswer: ''})}}]})};
    }
  });
  const session = createTutorSession({caseId: 'case-outbound-contract', context: {question: '求线面角正弦'}});
  await advanceTutorSession(session, {studentMessage: '我已经建立坐标系。'}, adapter);

  assert.equal(requestBody.messages.length, 5);
  assert.equal(JSON.parse(requestBody.messages[1].content).type, 'original_problem');
  assert.equal(JSON.parse(requestBody.messages[2].content).type, 'necessary_chat_context');
  assert.equal(JSON.parse(requestBody.messages[3].content).type, 'learning_state');
  assert.equal(JSON.parse(requestBody.messages[4].content).type, 'latest_student_answer');
});

test('历史中已完成法向量与最终化简时会先修复矛盾状态，不能退回第 3 步', async () => {
  const session = createTutorSession({caseId: 'case-reconcile-history', context: {question: '正四棱锥中求 BE 与平面 PAC 所成角的正弦'}});
  session.turns = [
    {studentMessage: '我以底面中心为原点建系，A、B、C、P 坐标都写好了。', correctness: 'correct'},
    {studentMessage: 'E 用 PC 两端点取平均，接着写出了 BE 的方向。', correctness: 'correct'},
    {studentMessage: '我取 PA 和 PC 做叉积得到 n=(0,1,0)，并验了 n·PA=n·PC=0。', correctness: 'correct'},
    {studentMessage: '用 n 和 BE 的内积绝对值除以模长乘积得到线面角正弦。', correctness: 'correct'},
    {studentMessage: '最后已经完成约分和分母有理化。', correctness: 'correct'}
  ];
  session.learningState = {
    currentGoal: 'construct_plane_normal', currentStep: 'planeNormal',
    completedSteps: ['frame', 'vertices', 'midpoint', 'beVector', 'angleCheck', 'simplify'],
    knownResults: [], studentMisconceptions: [], alreadyAskedQuestions: ['要继续检验线面关系，你准备怎样求平面 PAC 的法向量？']
  };
  session.progress = {completedSteps: session.learningState.completedSteps.slice(), currentStep: 'planeNormal'};

  const result = await advanceTutorSession(session, {studentMessage: '最终式我也检查过，数值在 0 到 1 之间。'});
  assert.deepEqual(result.learningState.completedSteps, ['frame', 'vertices', 'midpoint', 'beVector', 'planeNormal', 'angleCheck', 'simplify']);
  assert.equal(result.learningState.currentStep, 'completed');
  assert.equal(new Set(result.learningState.knownResults.map(item => item.stepId)).size, 7);
  assert.doesNotMatch(result.latestTurn.nextQuestion, /法向量|叉积|平面 PAC/);
});

test('提出后续方案只保存为尝试，不能错误补全法向量或最终化简', async () => {
  const session = createTutorSession({caseId: 'case-pending-plan', context: {question: '正四棱锥中求 BE 与平面 PAC 所成角的正弦'}});
  await advanceTutorSession(session, {studentMessage: '我想后面用 PA 和 PC 做叉积试着找 n，然后可能再有理化。'});
  assert.deepEqual(session.learningState.completedSteps, []);
  assert.equal(session.learningState.currentStep, 'frame');
});

test('序列化恢复与长对话不会丢失已完成步骤或重复已问问题', async () => {
  let session = createTutorSession({caseId: 'case-refresh-long-chat', context: {question: '正四棱锥中求 BE 与平面 PAC 所成角的正弦'}});
  await advanceTutorSession(session, {studentMessage: '我已经以底面中心为原点建立坐标系，四个顶点坐标也确定了。'});
  for (let index = 0; index < 14; index += 1) session.turns.push({studentMessage: `补充讨论 ${index}`, correctness: 'partial', nextQuestion: `补充问题 ${index}`});
  session = JSON.parse(JSON.stringify(session));
  const before = session.learningState.completedSteps.slice();
  const previousQuestions = session.learningState.alreadyAskedQuestions.slice();
  await advanceTutorSession(session, {studentMessage: '我现在只是想确认中点公式的含义，还没有算 E。'});
  assert.deepEqual(session.learningState.completedSteps, before);
  assert.ok(previousQuestions.every(question => session.learningState.alreadyAskedQuestions.includes(question)));
  assert.equal(session.learningState.currentStep, 'midpoint');
});

test('学生跳步时只保存后置证据，不会让完成步骤乱序或虚增整题完成度', async () => {
  const session = createTutorSession({caseId: 'case-jump-ahead', context: {question: '正四棱锥中求 BE 与平面 PAC 所成角的正弦'}});
  await advanceTutorSession(session, {studentMessage: '我直接用 n 和 BE 的内积绝对值除以模长乘积，得到了线面角正弦。'});
  assert.deepEqual(session.learningState.completedSteps, []);
  assert.deepEqual(session.learningState.pendingStepIds, ['angleCheck']);
  assert.equal(session.learningState.currentStep, 'frame');
  assert.equal(session.learningState.scoreProgress.percent, 0);
});

test('旧会话矛盾会按真实聊天修成 4/5 得分点，不能把“还没化简”算完成', async () => {
  const session = createTutorSession({caseId: 'case-real-regression', context: {question: '正四棱锥 P-ABCD 中求 BE 与平面 PAC 所成角的正弦'}});
  session.turns = [
    {studentMessage: '我以底面中心为原点建立坐标系，A、B、C、P 坐标都写好了。', correctness: 'correct'},
    {studentMessage: 'E 是 PC 中点，坐标取平均，并写出了 BE 的方向向量。', correctness: 'correct'},
    {studentMessage: '取 PA 和 PC 叉积得到 n，并验证 n 与 PA、PC 的点积都是 0。', correctness: 'correct'},
    {studentMessage: '用 BE 与 n 的内积绝对值除以两个模长，得到线面角的正弦。', correctness: 'correct'},
    {studentMessage: '我还没有完成最后化简，分母有理化这里不确定。', correctness: 'partial'}
  ];
  session.learningState = {
    currentGoal: 'construct_plane_normal', currentStep: 'planeNormal',
    completedSteps: ['frame', 'vertices', 'midpoint', 'beVector', 'simplify'],
    knownResults: [{stepId: 'simplify', summary: '错误的旧记录'}],
    studentMisconceptions: [], alreadyAskedQuestions: []
  };
  session.progress = {completedSteps: session.learningState.completedSteps.slice(), currentStep: 'planeNormal'};

  const state = reconcileTutorSession(session);
  assert.deepEqual(state.completedSteps, ['frame', 'vertices', 'midpoint', 'beVector', 'planeNormal', 'angleCheck']);
  assert.equal(state.currentStep, 'simplify');
  assert.equal(state.scoreProgress.percent, 80);
  assert.deepEqual(state.scoreProgress.completedPartIds, ['coordinates', 'line', 'normal', 'sine']);
  assert.equal(state.knownResults.some(item => item.stepId === 'simplify'), false);
});

test('学生写出经过验证的最终正弦值后应完成本题，不能再追问约分或有理化', async () => {
  const session = createTutorSession({caseId: 'case-final-answer', context: {question: '正四棱锥 P-ABCD 的底面边长为 6，高为 3，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。'}});
  session.learningState.completedSteps = ['frame', 'vertices', 'midpoint', 'beVector', 'planeNormal', 'angleCheck'];
  session.progress.completedSteps = session.learningState.completedSteps.slice();
  const result = await advanceTutorSession(session, {studentMessage: '答案不就是 sinθ = 2/11 倍 √22 吗？'});
  assert.equal(result.learningState.currentStep, 'completed');
  assert.equal(result.learningState.scoreProgress.percent, 100);
  assert.equal(result.latestTurn.correctness, 'correct');
  assert.doesNotMatch(result.latestTurn.nextQuestion, /约分|有理化|化简/);
});

test('恢复旧会话时必须回填全部历史追问，不能因 alreadyAskedQuestions 缺失而重复提问', async () => {
  const session = createTutorSession({caseId: 'case-legacy-question-memory', context: {question: '正四棱锥中求 BE 与平面 PAC 所成角的正弦'}});
  session.learningState.completedSteps = ['frame', 'vertices', 'midpoint', 'beVector', 'planeNormal', 'angleCheck'];
  session.progress.completedSteps = session.learningState.completedSteps.slice();
  session.learningState.alreadyAskedQuestions = [];
  session.turns = [
    {studentMessage: '我已经得到未化简式。', correctness: 'partial', nextQuestion: '请只检查最后一行：约分或分母有理化后，结果是否仍满足正弦值应在 0 到 1 之间？'},
    {studentMessage: '我还在看。', correctness: 'partial', nextQuestion: '不必重推线面角。只看最后的式子：你这一步做的是约分，还是分母有理化？'}
  ];
  const result = await advanceTutorSession(session, {studentMessage: '我暂时还不能确定最后一步。'});
  assert.doesNotMatch(result.latestTurn.nextQuestion, /约分|有理化/);
  assert.match(result.latestTurn.nextQuestion, /已经问过|目前已经得到的式子或结果/);
});

test('整题完成时只根据真实作答证据生成一次复盘并持久化到 learningState', async () => {
  const session = createTutorSession({caseId: 'case-completion-review', context: {question: '正四棱锥 P-ABCD 的底面边长为 6，高为 3，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。'}});
  session.learningState.completedSteps = ['frame', 'vertices', 'midpoint', 'beVector', 'planeNormal', 'angleCheck'];
  session.progress.completedSteps = session.learningState.completedSteps.slice();
  await advanceTutorSession(session, {studentMessage: '我还不确定分母怎么有理化。'});
  const result = await advanceTutorSession(session, {studentMessage: '答案是 sinθ = 2/11 倍 √22。'});
  const review = result.learningState.completionReview;
  assert.equal(result.learningState.scoreProgress.percent, 100);
  assert.ok(review);
  assert.equal(review.source, 'actual_tutor_evidence');
  assert.ok(review.observedDifficulties.some(item => item.message.includes('分母怎么有理化')));
  assert.equal(review.observedDifficulties.some(item => /凭空|假设|未知弱点/.test(item.message)), false);
  const generatedAt = review.generatedAt;
  await advanceTutorSession(result, {studentMessage: '我再看一遍。'});
  assert.equal(result.learningState.completionReview.generatedAt, generatedAt);
});

test('迁移题直接给出方向向量和法向量时不得套用建立坐标系步骤', async () => {
  const session = createTutorSession({
    caseId: 'transfer-given-vectors',
    context: {
      question: '已知直线 l 的方向向量为 (1,2,2)，平面 α 的法向量为 (0,1,0)。求直线 l 与平面 α 所成角的正弦值。',
      knowledgePoints: ['线面角', '方向向量与法向量夹角转换']
    }
  });

  assert.equal(session.learningState.rubricId, 'line_plane_given_vectors');
  assert.equal(session.learningState.currentStep, 'angleRelation');
  assert.equal(session.learningState.progressRubric.some(item => item.id === 'frame'), false);
  assert.equal(session.learningState.progressRubric.some(item => item.id === 'vertices'), false);
});

test('迁移题已给坐标时只保留本题所需得分点，不得出现中点或建立坐标系', async () => {
  const session = createTutorSession({
    caseId: 'transfer-given-coordinates',
    context: {
      question: '在空间直角坐标系中，A(0,0,0)、B(1,0,0)、C(0,1,0)，直线 l 的方向向量为 (1,1,1)。求 l 与平面 ABC 所成角的正弦值，并说明法向量如何得到。',
      knowledgePoints: ['线面角', '平面法向量']
    }
  });

  assert.equal(session.learningState.rubricId, 'line_plane_from_plane_points');
  assert.deepEqual(session.learningState.progressRubric.map(item => item.id), ['planeDirections', 'planeNormal', 'angleCheck', 'simplify']);
});

test('不同迁移题始终生成互不共享进度和已问问题的独立会话', async () => {
  const first = createTutorSession({caseId: 'transfer-near', context: {question: '正四棱锥中求线面角正弦。'}});
  const second = createTutorSession({caseId: 'transfer-variant', context: {question: '已知方向向量和法向量，求线面角正弦。'}});
  await advanceTutorSession(first, {studentMessage: '我已经以底面中心为原点建立坐标系。'});

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.learningState.rubricId, second.learningState.rubricId);
  assert.deepEqual(second.learningState.completedSteps, []);
  assert.deepEqual(second.learningState.alreadyAskedQuestions, []);
});

test('给定向量迁移题连续多轮会明确判错、换问法并持续推进到完成', async () => {
  const session = createTutorSession({
    caseId: 'transfer-dialogue-regression',
    context: {question: '已知直线 l 的方向向量为 (1,2,2)，平面 α 的法向量为 (0,1,0)。求直线 l 与平面 α 所成角的正弦值。'}
  });

  const wrong = await advanceTutorSession(session, {studentMessage: '线面角就是方向向量和法向量的同一个夹角，所以直接用 cos。'});
  assert.equal(wrong.latestTurn.correctness, 'incorrect');
  assert.match(wrong.latestTurn.explanation, /偏差|不是|余角/);
  const firstQuestion = wrong.latestTurn.nextQuestion;

  const stillPartial = await advanceTutorSession(session, {studentMessage: '我还不确定，但应该和这两个角有关。'});
  assert.notEqual(stillPartial.latestTurn.nextQuestion, firstQuestion, '同一问题不得原样重复');

  const relation = await advanceTutorSession(session, {studentMessage: '这两个角互余，所以线面角的正弦等于方向向量与法向量夹角的余弦。'});
  assert.equal(relation.latestTurn.correctness, 'correct');
  assert.equal(relation.learningState.currentStep, 'vectorCalculation');
  assert.match(relation.latestTurn.nextQuestion, /内积|模长/);

  const calculation = await advanceTutorSession(session, {studentMessage: '点积是 2，两个模长分别是 3 和 1。'});
  assert.equal(calculation.latestTurn.correctness, 'correct');
  assert.equal(calculation.learningState.currentStep, 'simplify');

  const final = await advanceTutorSession(session, {studentMessage: '所以最终答案是 sinθ=2/3，并且它在 0 到 1 之间。'});
  assert.equal(final.latestTurn.correctness, 'correct');
  assert.equal(final.learningState.currentStep, 'completed');
  assert.equal(final.learningState.scoreProgress.percent, 100);
  assert.doesNotMatch(final.latestTurn.nextQuestion, /坐标系|法向量如何得到|重新/);
});

test('函数与集合迁移题分别生成自己的得分点，不继承空间几何模板', () => {
  const monotonicity = createTutorSession({caseId: 'transfer-function', context: {question: '用定义证明函数 f(x)=2x+1 在 R 上单调递增。'}});
  const setCase = createTutorSession({caseId: 'transfer-set', context: {question: '全集 U={1,2,3,4,5}，A={1,3,5}，求 A 在 U 中的补集。'}});

  assert.equal(monotonicity.learningState.rubricId, 'function_monotonicity');
  assert.deepEqual(monotonicity.learningState.progressRubric.map(item => item.id), ['domain', 'difference', 'sign', 'conclusion']);
  assert.equal(setCase.learningState.rubricId, 'set_operation');
  assert.deepEqual(setCase.learningState.progressRubric.map(item => item.id), ['universe', 'complement', 'setResult']);
  assert.equal([...monotonicity.learningState.progressRubric, ...setCase.learningState.progressRubric].some(item => item.id === 'frame'), false);
});
