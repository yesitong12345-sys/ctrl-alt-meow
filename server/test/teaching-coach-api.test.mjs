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

const waitFor = async (url, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('server did not start');
};

test('教学决策 API 返回独立技能计划且不改写立体几何工作流', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-coach-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json'), MODEL_CONFIG_FILE: path.join(tempDir, 'model-config.json'), DEEPSEEK_API_KEY: ''},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/health`);

  const response = await fetch(`${base}/v1/teaching-coach/plan`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({questionText: '圆 O 外一点 P 引切线 PA，A 为切点。', studentMessage: '不知道如何开始'})
  });
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.skill, 'edu-analytic-geometry');
  assert.ok(plan.visualization.constructions.some(item => item.role === 'auxiliary-radius'));

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.workflow, 'geometry_learning_workflow');

  const coursePage = await fetch(`${base}/skills/analytic/ellipse_dot_range.html`);
  assert.equal(coursePage.status, 200);
  assert.match(await coursePage.text(), /解析几何互动学习/);
});

test('教学决策 API 要求题目或结构化 IR', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-coach-validation-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json'), MODEL_CONFIG_FILE: path.join(tempDir, 'model-config.json'), DEEPSEEK_API_KEY: ''},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/health`);
  const response = await fetch(`${base}/v1/teaching-coach/plan`, {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
  assert.equal(response.status, 422);
});

test('教学教练会话通过 API 持续回流学生操作', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-coach-session-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json'), MODEL_CONFIG_FILE: path.join(tempDir, 'model-config.json'), DEEPSEEK_API_KEY: ''},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/health`);
  const created = await (await fetch(`${base}/v1/teaching-coach/sessions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({questionText: '圆 O 外一点 P 引切线 PA，A 为切点。'})
  })).json();
  assert.equal(created.currentPhase, 'observation');
  const response = await fetch(`${base}/v1/teaching-coach/sessions/${created.id}/events`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({studentMessage: '我先找到了圆心 O、切点 A 和切线 PA。'})
  });
  assert.equal(response.status, 200);
  const advanced = await response.json();
  assert.equal(advanced.turns.length, 1);
  assert.equal(advanced.currentPhase, 'hint');
});
