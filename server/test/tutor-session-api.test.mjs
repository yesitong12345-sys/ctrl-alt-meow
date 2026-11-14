import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const {port} = server.address();
    server.close(() => resolve(port));
  });
});

const waitFor = async (check, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('server did not start');
};

test('AI 陪练保持多轮状态并逐轮评价后继续提问', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);

  const createdResponse = await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      caseId: 'case-1',
      context: {knowledgePoints: ['线面角'], question: '求 BE 与平面 PAC 所成角的正弦值。'}
    })
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.status, 'waiting_for_student');
  assert.deepEqual(created.transitions.map(item => item.to), ['tutoring', 'waiting_for_student']);

  const firstResponse = await fetch(`${base}/v1/tutor/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage: '我想先以底面中心为原点建立空间直角坐标系。'})
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.status, 'waiting_for_student');
  assert.equal(first.latestTurn.correctness, 'partial');
  assert.match(first.latestTurn.understanding, /底面中心|坐标系/);
  assert.ok(first.latestTurn.explanationSentences >= 1 && first.latestTurn.explanationSentences <= 3);
  assert.equal(first.latestTurn.revealsFullAnswer, false);
  assert.match(first.latestTurn.encouragement, /\u771f\u806a\u660e|\u771f\u5389\u5bb3|\u6709\u6bc5\u529b|\u5f88\u68d2|\u975e\u5e38\u975e\u5e38\u597d|\u6700\u52c7\u6562/);
  assert.match(first.latestTurn.nextQuestion, /[？?]/);
  assert.deepEqual(first.transitions.slice(-2).map(item => item.to), ['evaluating', 'waiting_for_student']);

  const secondResponse = await fetch(`${base}/v1/tutor/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage: '然后把 E 当成 PC 的中点写出坐标。'})
  });
  const second = await secondResponse.json();
  assert.equal(second.turns.length, 2);
  assert.equal(second.status, 'waiting_for_student');

  const completedResponse = await fetch(`${base}/v1/tutor/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({action: 'complete'})
  });
  const completed = await completedResponse.json();
  assert.equal(completed.status, 'completed');
});

test('学生询问相关概念时，陪练先回答再继续引导', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-answer-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const created = await (await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({caseId: 'case-answer', context: {question: '求线面角', knowledgePoints: ['线面角']}})
  })).json();
  const response = await fetch(`${base}/v1/tutor/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage: '平面的法向量是什么？'})
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.latestTurn.responseMode, 'answer_then_guide');
  assert.match(result.latestTurn.directAnswer, /法向量/);
  assert.ok(result.latestTurn.nextQuestion.length > 0);
  assert.equal(result.latestTurn.revealsFullAnswer, false);
});

test('首次发送在创建会话的响应中就返回评价与下一问', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-first-turn-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const response = await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      caseId: 'case-first-turn',
      context: {question: '求线面角', knowledgePoints: ['线面角']},
      initialStudentMessage: '我想先建立坐标系。'
    })
  });
  const session = await response.json();
  assert.equal(response.status, 201);
  assert.equal(session.turns.length, 1);
  assert.equal(session.latestTurn.studentMessage, '我想先建立坐标系。');
  assert.ok(session.latestTurn.explanation.length > 0);
  assert.ok(session.latestTurn.nextQuestion.length > 0);
  assert.equal(session.status, 'waiting_for_student');
});

test('同一道错题跨页面恢复时继续最近的未完成陪练会话', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-resume-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const start = async initialStudentMessage => (await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({caseId: 'case-resume', context: {question: '求线面角'}, initialStudentMessage})
  })).json();
  const first = await start('我先建立坐标系。');
  const resumed = await start('再确定中点 E。');
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.turns.length, 2);
  assert.equal(resumed.latestTurn.studentMessage, '再确定中点 E。');
});

test('同一道大题的不同小问使用独立会话并分别恢复', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-subproblems-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const question = '三棱锥 A-BCD 中：(1)证明 AB⊥CD；(2)求线面角正弦；(3)求体积。';
  const start = async (subproblemId, rubricId, initialStudentMessage) => (await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      caseId: 'case-three-parts',
      context: {question, parentQuestion: question, subproblemId, rubricId},
      initialStudentMessage
    })
  })).json();

  const first = await start('q1', 'triangular_projection_q1', '我先用 AO 垂直底面。');
  const second = await start('q2', 'triangular_projection_q2', '我先把二面角化成平面角。');
  const resumedFirst = await start('q1', 'triangular_projection_q1', '再利用 BO 垂直 CD。');

  assert.notEqual(first.id, second.id);
  assert.equal(first.context.subproblemId, 'q1');
  assert.equal(second.context.subproblemId, 'q2');
  assert.equal(first.learningState.rubricId, 'triangular_projection_q1');
  assert.equal(second.learningState.rubricId, 'triangular_projection_q2');
  assert.equal(resumedFirst.id, first.id);
  assert.equal(resumedFirst.turns.length, 2);

  await fetch(`${base}/v1/tutor/sessions/${second.id}/events`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action:'complete'})
  });
  const restoredCompleted = await start('q2', 'triangular_projection_q2');
  assert.equal(restoredCompleted.id, second.id);
  assert.equal(restoredCompleted.status, 'completed');
});

test('学生完成当前步骤后，下一问推进到尚未完成的步骤', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-progress-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const created = await (await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({caseId: 'case-progress', context: {question: '正四棱锥 P-ABCD 中，E 为 PC 中点，求 BE 与平面 PAC 所成角的正弦'}})
  })).json();
  const send = async studentMessage => (await fetch(`${base}/v1/tutor/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage})
  })).json();
  await send('我先以底面中心为原点建立坐标系。');
  const progressed = await send('\u6211\u5df2\u7ecf\u628a A\u3001B\u3001C\u3001P \u7684\u5750\u6807\u5199\u51fa\u6765\u4e86\u3002');
  assert.equal(progressed.latestTurn.correctness, 'correct');
  assert.match(progressed.latestTurn.nextQuestion, /E|中点/);
  assert.doesNotMatch(progressed.latestTurn.nextQuestion, /请用.*A|先把.*A/);
});

test('学生部分正确时先承接思路、纠正偏差并给出可继续的小提示', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-partial-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const created = await (await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({caseId: 'case-partial', context: {question: '正四棱锥 P-ABCD 中，E 为 PC 中点，求 BE 与平面 PAC 所成角的正弦'}})
  })).json();
  const result = await (await fetch(`${base}/v1/tutor/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage: '我觉得 E 是 PC 的中点，所以把 P 和 C 的坐标相加就可以了，但不确定要不要除以 2。'})
  })).json();
  assert.equal(result.latestTurn.correctness, 'partial');
  assert.match(result.latestTurn.understanding, /E|中点/);
  assert.match(result.latestTurn.explanation, /平均|2/);
  assert.match(result.latestTurn.nextQuestion, /E|坐标/);
  assert.equal(result.latestTurn.revealsFullAnswer, false);
  assert.match(result.latestTurn.encouragement, /\u975e\u5e38\u975e\u5e38\u597d|\u6700\u52c7\u6562|\u4e86\u4e0d\u8d77|\u95ea\u95ea\u53d1\u5149/,
    '满级夸夸版的第一句必须有明显、热烈的情感鼓励');
});

test('同义转述的已完成步骤也会推进到下一步，而不是卡在固定措辞', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-paraphrase-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const created = await (await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({caseId: 'case-paraphrase', context: {question: '正四棱锥 P-ABCD 中，E 为 PC 中点，求 BE 与平面 PAC 所成角的正弦'}})
  })).json();
  const send = async studentMessage => (await fetch(`${base}/v1/tutor/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage})
  })).json();
  await send('\u6211\u5148\u4ee5\u5e95\u9762\u4e2d\u5fc3\u4e3a\u539f\u70b9\u5efa\u7acb\u5750\u6807\u7cfb\u3002');
  const progressed = await send('\u56db\u4e2a\u9876\u70b9\u4f4d\u7f6e\u90fd\u786e\u5b9a\u4e86\u3002');
  assert.equal(progressed.latestTurn.correctness, 'correct');
  assert.match(progressed.latestTurn.nextQuestion, /E|中点/);
  assert.ok(progressed.progress.completedSteps.includes('frame'));
  assert.ok(progressed.progress.completedSteps.includes('vertices'));
});

test('学生只表达计划或推测时，陪练不会脑补为已经完成', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-tutor-intent-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const session = await (await fetch(`${base}/v1/tutor/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({caseId: 'case-intent', context: {question: '\u7a7a\u95f4\u51e0\u4f55\u5750\u6807\u6cd5'}})
  })).json();
  const result = await (await fetch(`${base}/v1/tutor/sessions/${session.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage: '\u6211\u60f3\u5148\u4ee5\u5e95\u9762\u4e2d\u5fc3\u4e3a\u539f\u70b9\u5efa\u7acb\u5750\u6807\u7cfb\uff0c\u4f46\u8fd8\u6ca1\u60f3\u597d\u600e\u4e48\u9009\u8f74\u3002'})
  })).json();
  assert.equal(result.latestTurn.correctness, 'partial');
  assert.deepEqual(result.progress.completedSteps, []);
  assert.doesNotMatch(result.latestTurn.understanding, /\u5df2\u7ecf|\u5b8c\u6210|\u5199\u51fa/);
  assert.match(result.latestTurn.explanation, /\u9009\u8f74|\u8f74/);
});
