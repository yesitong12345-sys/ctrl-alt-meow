import test from 'node:test';
import assert from 'node:assert/strict';
import {createMistakeAdminRouter} from '../workflows/mistake-admin-routes.mjs';
import {createAiRubricBuilder} from '../workflows/ai-rubric-build.mjs';
import {aiRubricProfile} from '../workflows/ai-rubric.mjs';

const aiRubric = {
  source: 'ai_reverse',
  question: '一道立体几何题',
  steps: [
    {id: 'ai_1', label: '建立空间直角坐标系', hint: '以底面中心为原点', goal: '建系', keywords: ['坐标系', '原点'], nextQuestion: '原点选哪？'},
    {id: 'ai_2', label: '写出关键点坐标', hint: '把边长落到坐标', goal: '写坐标', keywords: ['坐标', '边长'], nextQuestion: '坐标是多少？'},
    {id: 'ai_3', label: '求平面法向量', hint: '叉积', goal: '求法向量', keywords: ['法向量', '叉积'], nextQuestion: '法向量是多少？'},
    {id: 'ai_4', label: '代入线面角公式', hint: '注意正弦', goal: '求正弦', keywords: ['正弦', '线面角'], nextQuestion: '正弦值？'},
  ],
  parts: [
    {id: 'ai_1', label: '建立空间直角坐标系', hint: '以底面中心为原点', steps: ['ai_1']},
    {id: 'ai_2', label: '写出关键点坐标', hint: '把边长落到坐标', steps: ['ai_2']},
    {id: 'ai_3', label: '求平面法向量', hint: '叉积', steps: ['ai_3']},
    {id: 'ai_4', label: '代入线面角公式', hint: '注意正弦', steps: ['ai_4']},
  ],
};

function makeRes() {
  const captured = {code: null, body: null};
  const res = {
    statusCode: 200,
    setHeader() {},
    end(payload) { try { captured.body = JSON.parse(payload); } catch { captured.body = payload; } },
    writeHead(code) { this.statusCode = code; },
    on() {},
    once() {},
    emit() {},
  };
  return {res, captured, code: () => res.statusCode};
}

test('重新反推得分点：路由把结果与状态回给前端', async () => {
  const db = {cases: [{id: 'case-1', subject: '数学', question: '一道立体几何题', user_id: 'local-student'}], events: []};
  let calls = 0;
  const handle = createMistakeAdminRouter({
    db, persist: async () => {},
    rebuildSteps: async target => {
      calls += 1;
      target.aiRubric = aiRubric;
      target.aiStepsStatus = 'ready';
      target.aiStepsMessage = '';
      return {ok: true, status: 'ready', steps: aiRubric.steps.length};
    },
  });
  const {res, captured} = makeRes();
  const handled = await handle({method: 'POST'}, res, new URL('http://localhost/v1/mistake-cases/case-1/rebuild-steps'));
  assert.equal(handled, true);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(captured.body.ok, true);
  assert.equal(captured.body.steps, 4);
  assert.match(captured.body.message, /4 个得分点/);
});

test('重新反推得分点：题目不存在时 404，未接线时 503', async () => {
  const db = {cases: [], events: []};
  const handle404 = createMistakeAdminRouter({db, persist: async () => {}, rebuildSteps: async () => ({ok: true})});
  const a = makeRes();
  await handle404({method: 'POST'}, a.res, new URL('http://localhost/v1/mistake-cases/missing/rebuild-steps'));
  assert.equal(a.res.statusCode, 404);

  const db2 = {cases: [{id: 'case-2', subject: '数学', question: 'q'}], events: []};
  const handle503 = createMistakeAdminRouter({db: db2, persist: async () => {}});
  const b = makeRes();
  await handle503({method: 'POST'}, b.res, new URL('http://localhost/v1/mistake-cases/case-2/rebuild-steps'));
  assert.equal(b.res.statusCode, 503);
  assert.equal(b.captured.body.error, 'STEPS_UNAVAILABLE');
});

test('反推管线：数学题成功写入 data-only rubric，陪练读回来带 detect', async () => {
  const db = {cases: [{id: 'c1', subject: '数学', question: '一道立体几何题', knowledgePoints: ['空间向量']}], events: []};
  const builder = createAiRubricBuilder({
    db, persist: async () => {},
    modelConfig: {endpoint: 'e', apiKey: 'k', model: 'm'},
    createAdapter: () => async () => aiRubric,
    recordEvent: event => db.events.push(event),
  });
  const outcome = await builder.build(db.cases[0]);
  assert.equal(outcome.ok, true);
  assert.equal(db.cases[0].aiStepsStatus, 'ready');
  assert.equal(db.cases[0].aiRubric.steps.length, 4);
  assert.equal(JSON.stringify(db.cases[0].aiRubric).includes('function'), false, '库里必须只有纯数据');

  const profile = aiRubricProfile(db.cases[0]);
  assert.equal(profile.steps.length, 4);
  assert.equal(typeof profile.steps[0].detect, 'function');
  assert.equal(profile.steps[2].detect('我先求平面的法向量，用的是叉积'), true);
  assert.equal(db.events.some(e => e.type === 'mistake_case_ai_rubric_ready'), true);
});

test('反推管线：非数学物理标记 skipped；没配密钥标记 failed 且可重试', async () => {
  const db = {cases: [
    {id: 'c1', subject: '语文', question: '阅读题'},
    {id: 'c2', subject: '物理', question: '电场题'},
  ], events: []};
  const builder = createAiRubricBuilder({
    db, persist: async () => {}, modelConfig: {}, createAdapter: () => null,
  });
  const a = await builder.build(db.cases[0]);
  assert.equal(a.status, 'skipped');
  assert.equal(db.cases[0].aiStepsStatus, 'skipped');

  const b = await builder.build(db.cases[1]);
  assert.equal(b.status, 'ai_rubric_not_configured');
  assert.equal(db.cases[1].aiStepsStatus, 'failed');
  assert.match(db.cases[1].aiStepsMessage, /通用兜底/);
});

test('反推管线：适配器抛错时写 failed 并保留题目，不冒泡成 500', async () => {
  const db = {cases: [{id: 'c1', subject: '数学', question: 'q'}], events: []};
  const builder = createAiRubricBuilder({
    db, persist: async () => {},
    modelConfig: {endpoint: 'e', apiKey: 'k', model: 'm'},
    createAdapter: () => async () => { throw Object.assign(new Error('AI_RUBRIC_HTTP_429'), {code: 'AI_RUBRIC_HTTP_429'}); },
    recordEvent: event => db.events.push(event),
  });
  const outcome = await builder.build(db.cases[0]);
  assert.equal(outcome.ok, false);
  assert.equal(db.cases[0].aiStepsStatus, 'failed');
  assert.match(db.cases[0].aiStepsMessage, /AI_RUBRIC_HTTP_429/);
  assert.equal(db.events.some(e => e.type === 'mistake_case_ai_rubric_failed'), true);
});

test('等待反推期间题干改变，不把旧结果保存成新题的公共得分点', async () => {
  const record={id:'changed',question:'求边长 2 的体积',subject:'数学',studentAnswer:'私人错误过程'};
  let release, began;
  const started=new Promise(r=>began=r), delayed=new Promise(r=>release=r);
  const builder=createAiRubricBuilder({db:{cases:[record]},persist:async()=>{},createAdapter:()=>async input=>{assert.equal(input.studentAnswer,undefined);began();await delayed;return structuredClone(aiRubric);}});
  const running=builder.build(record);await started;record.question='求边长 3 的体积';release();
  assert.equal((await running).status,'stale_question');assert.equal(record.aiRubric,undefined);
});

test('反推管线：同一道题并发只跑一次', async () => {
  const db = {cases: [{id: 'c1', subject: '数学', question: 'q'}], events: []};
  let calls = 0;
  const builder = createAiRubricBuilder({
    db, persist: async () => {},
    modelConfig: {endpoint: 'e', apiKey: 'k', model: 'm'},
    createAdapter: () => async () => { calls += 1; await new Promise(r => setTimeout(r, 20)); return aiRubric; },
  });
  const [x, y] = await Promise.all([builder.build(db.cases[0]), builder.build(db.cases[0])]);
  assert.equal(calls, 1, '并发重复调用应复用同一次任务');
  assert.equal(x.ok, true);
  assert.equal(y.ok, true);
});
