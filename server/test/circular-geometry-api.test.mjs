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
  server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); });
});
const waitFor = async (check, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if (await check()) return; } catch {} await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('server not ready');
};

test('圆体文字题进入错题库时模型、答案和题目共用 geometry-ir/v2', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-circular-'));
  const child = spawn(process.execPath, ['server.mjs'], {cwd: path.resolve(import.meta.dirname, '..'), env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')}, windowsHide: true, stdio: 'ignore'});
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);

  const response = await fetch(`${base}/v1/circular-geometry/solve`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({questionText: '半径为 5 的球，球心到截平面的距离为 3，求截面圆的半径和面积。', studentAnswer: '我想到连球心和截面圆心。'})});
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.status, 'verified');
  assert.equal(body.mistakeCase.geometryResult.solverStatus, 'verified');
  assert.equal(body.mistakeCase.correctAnswer, '截面半径 = 4；截面面积 = 16π');
  assert.equal(body.mistakeCase.problemSpec.schemaVersion, 'geometry-ir/v2');
  assert.equal(body.mistakeCase.geometryIR.schemaVersion, 'geometry-ir/v4');
  assert.equal(body.mistakeCase.geometryIR.compatibility.sourceSchemaVersion, 'geometry-ir/v2');
  assert.equal(body.mistakeCase.geometryResult.scene.elements.some(item => item.type === 'section-circle'), true);
});

test('圆体文本缺少建模条件时仅说明真正缺失项', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-circular-missing-'));
  const child = spawn(process.execPath, ['server.mjs'], {cwd: path.resolve(import.meta.dirname, '..'), env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')}, windowsHide: true, stdio: 'ignore'});
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const response = await fetch(`${base}/v1/circular-geometry/solve`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({questionText: '圆锥的半径为 3，求体积。'})});
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.status, 'needs_more_context');
  assert.deepEqual(body.missingItems.map(item => item.label), ['圆锥高']);
  assert.ok(body.missingItems.every(item => typeof item.whyNeeded === 'string' && item.whyNeeded.length > 0));
  assert.equal(body.missingItems[0].prompt, '请补充圆锥高。');
});

test('直径与半径等价：完整圆体题目不再要求补充', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-circular-diameter-'));
  const child = spawn(process.execPath, ['server.mjs'], {cwd: path.resolve(import.meta.dirname, '..'), env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')}, windowsHide: true, stdio: 'ignore'});
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const response = await fetch(`${base}/v1/circular-geometry/solve`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({questionText: '圆柱的底面直径为 6，高为 4，求体积和表面积。'})});
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.status, 'verified');
  assert.equal(body.mistakeCase.problemSpec.parameters.radius.value, 3);
  assert.equal(body.mistakeCase.problemSpec.parameters.height.value, 4);
});

test('母线加半径可导出圆锥的高，不算缺失条件', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-circular-slant-'));
  const child = spawn(process.execPath, ['server.mjs'], {cwd: path.resolve(import.meta.dirname, '..'), env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')}, windowsHide: true, stdio: 'ignore'});
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  const response = await fetch(`${base}/v1/circular-geometry/solve`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({questionText: '圆锥的底面半径为 3，母线为 5，求体积和表面积。'})});
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.status, 'verified');
  assert.equal(body.mistakeCase.problemSpec.parameters.radius.value, 3);
  assert.equal(body.mistakeCase.problemSpec.parameters.height.op, 'sqrt');
});
