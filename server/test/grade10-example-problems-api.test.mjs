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

const waitFor = async base => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('server not ready');
};

test('配置例题按真实上传链路入库，并为可建模题保存经验证的三维场景', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'edu-grade10-examples-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(base);

  const response = await fetch(`${base}/v1/grade10-example-problems/g10-solid-prism-volume/start`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'
  });
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.origin, 'configured_example_upload');
  assert.equal(created.excludeFromLearningAnalytics, false);
  assert.equal(created.uploadTrace.internalReview, 'passed');
  assert.equal(created.problemSpec.tutorRubricId, 'grade10_prism_volume');
  assert.equal(created.geometryResult.solverStatus, 'verified');
  assert.equal(created.geometryResult.verification.answerUnique, true);
  assert.equal(created.geometryResult.verification.embeddingUnique, false);
  assert.ok(created.geometryResult.scene.frameEdges.length >= 9);
  const exact = node => node.op === 'integer' ? node.value : node.op === 'rational' ? node.p / node.q : NaN;
  const xyz = name => created.geometryResult.canonicalCoordinates[name].map(exact);
  const [a,b,c,a1] = ['A','B','C','A1'].map(xyz);
  const ab = b.map((value,index)=>value-a[index]), ac = c.map((value,index)=>value-a[index]);
  const cross = [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  const baseArea = Math.hypot(...cross)/2, height = Math.hypot(...a1.map((value,index)=>value-a[index]));
  assert.equal(baseArea,12);
  assert.equal(height,5);
  assert.equal(baseArea*height,60);
  assert.equal(created.geometryResult.scene.frameEdges.every(edge=>edge.every(name=>created.geometryResult.canonicalCoordinates[name])),true);

  const cases = await (await fetch(`${base}/v1/mistake-cases`)).json();
  assert.equal(cases.some(item => item.id === created.id), true);
  const replay = await fetch(`${base}/v1/grade10-example-problems/g10-solid-prism-volume/start`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'
  });
  assert.equal(replay.status, 200, '重复打开同一道配置例题时应复用同一真实题目记录');
  assert.equal((await replay.json()).id, created.id);
});

test('批量导入例题包含单选和多选，并为每个选项建立独立得分点', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'edu-grade10-choice-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(tempDir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(base);

  const catalog = await (await fetch(`${base}/v1/grade10-example-problems`)).json();
  const imported = await (await fetch(`${base}/v1/grade10-example-problems/import-all`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'
  })).json();
  const single = imported.cases.find(item => item.problemSpec?.questionKind === 'single_choice');
  const multiple = imported.cases.find(item => item.problemSpec?.questionKind === 'multiple_choice');
  assert.deepEqual(imported.cases.map(item=>item.configuredExampleId).sort(),catalog.map(item=>item.id).sort());
  assert.equal(imported.cases.every(item=>item.origin==='configured_example_upload'&&item.excludeFromLearningAnalytics===false&&item.uploadTrace?.internalReview==='passed'&&item.problemSpec?.scoringRubric?.length),true);
  assert.ok(single);
  assert.ok(multiple);
  assert.deepEqual(single.problemSpec.scoringRubric.map(item => item.id), ['judge_A', 'judge_B', 'judge_C', 'judge_D', 'final_selection']);
  assert.match(multiple.problemSpec.scoringRubric.at(-1).hint, /漏选|多选/);
  const stored = await (await fetch(`${base}/v1/mistake-cases`)).json();
  assert.deepEqual(stored.filter(item=>item.origin==='configured_example_upload').map(item=>item.configuredExampleId).sort(),catalog.map(item=>item.id).sort());
  const session=await (await fetch(`${base}/v1/tutor/sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({caseId:single.id,context:{question:single.question,choiceAnswer:['A']},initialStudentMessage:'A 正确，因为数量积为 0'})})).json();
  assert.deepEqual(session.context.choiceAnswer,single.problemSpec.choiceAnswer,'标准答案必须来自服务端题目记录，不能信任客户端篡改');
  assert.equal(session.latestTurn.correctness,'incorrect');
});
