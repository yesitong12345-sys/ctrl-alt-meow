import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});

test('wrong-question Good review immediately updates persisted profile and summary heatmap', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'edu-summary-review-'));
  const dataFile = path.join(temp, 'data.json');
  await writeFile(dataFile, JSON.stringify({
    cases: [{
      id: 'reviewed-case',
      user_id: 'local-student',
      studentId: 'local-student',
      subject: '数学',
      knowledgePoints: ['一元一次方程'],
      question: '解方程 x+1=2',
      learningProfile: {mastery: 52, reviews: 0},
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z'
    }]
  }), 'utf8');
  const port = await reservePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: dataFile, AUTH_REQUIRED: '0', PYTHON_BIN: 'python'},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => { child.kill(); await rm(temp, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const reviewedResponse = await fetch(`${base}/v1/study/review`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({cardId: 'reviewed-case', rating: 3})
  });
  const reviewedText = await reviewedResponse.text();
  assert.equal(reviewedResponse.status, 201, reviewedText);
  const reviewed = JSON.parse(reviewedText);
  assert.notEqual(reviewed.mastery, 52);

  const summary = await (await fetch(`${base}/v1/study/summary`)).json();
  assert.equal(summary.heatmap[0].mastery, reviewed.mastery);
  const persisted = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(persisted.cases[0].learningProfile.mastery, reviewed.mastery);
  assert.equal(persisted.cases[0].learningProfile.fsrs.stability, reviewed.stability);
});
