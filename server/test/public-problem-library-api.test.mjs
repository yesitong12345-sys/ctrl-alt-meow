import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const reservePort = () => new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); }); });
const waitFor = async base => { for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`${base}/health`)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error('server not ready'); };

test('公共题型仅提供去隐私模板，学生确认后才建立引用且个人模型必须重新验证', async t => {
  const port = await reservePort(), tempDir = await mkdtemp(path.join(os.tmpdir(), 'edu-public-library-'));
  const child = spawn(process.execPath, ['server.mjs'], {cwd: path.resolve(import.meta.dirname, '..'), env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')}, windowsHide: true, stdio: 'ignore'});
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`; await waitFor(base);

  const templates = await (await fetch(`${base}/v1/public-problem-templates`)).json();
  assert.ok(templates.some(item => item.id === 'solid-square-pyramid-line-plane-angle-v1'));
  assert.equal(JSON.stringify(templates).includes('studentAnswer'), false);
  const matched = await (await fetch(`${base}/v1/public-problem-templates/match`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({question: '正四棱锥 P-ABCD 的底面是正方形，求 PC 与平面 ABCD 所成角的正弦值。', subject: '数学', unit: '空间几何', knowledgePoints: ['正四棱锥', '线面角']})})).json();
  const match = matched.matches.find(item => item.template.id === 'solid-square-pyramid-line-plane-angle-v1');
  assert.ok(match);

  const created = await (await fetch(`${base}/v1/transfer-items`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: 'private-case', question: '正四棱锥 P-ABCD 的底面是正方形，求 PC 与平面 ABCD 所成角的正弦值。', studentAnswer: '我先建立坐标系。', subject: '数学', unit: '空间几何', knowledgePoints: ['正四棱锥', '线面角'], correctness: 'pending'})})).json();
  assert.equal(created.mistakeCase.publicTemplateReference, undefined);
  const before = await fetch(`${base}/v1/mistake-cases/private-case/public-template-choice`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({templateId: match.template.id, choice: 'use_model'})});
  assert.equal(before.status, 409, '没有已验证个人模型时，不得直接复用公共模型');
  const methodOnly = await fetch(`${base}/v1/mistake-cases/private-case/public-template-choice`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({templateId: match.template.id, choice: 'method_only'})});
  assert.equal(methodOnly.status, 200);
  const cases = await (await fetch(`${base}/v1/mistake-cases`)).json();
  assert.equal(cases[0].publicTemplateReference.choice, 'method_only');
  assert.equal(cases[0].studentAnswer, '我先建立坐标系。', '公共模板不能覆盖学生自己的答题记录');
});
