import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const pythonBin = process.env.PYTHON_BIN || path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
);

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
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('timed out waiting for server state');
};

test('学生确认正四棱锥参数后，HTTP 工作流求解并回写错题案例', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-geometry-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json'), PYTHON_BIN: pythonBin},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);

  const invalidResponse = await fetch(`${base}/v1/ingestions`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'manual', templateId: 'regular-quad-pyramid-be-pac', templateVersion: 1, parameters: {}})
  });
  assert.equal(invalidResponse.status, 422);

  const ingestionResponse = await fetch(`${base}/v1/ingestions`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'manual',
      templateId: 'regular-quad-pyramid-be-pac',
      templateVersion: 1,
      parameters: {
        baseEdge: {op: 'integer', value: 2},
        height: {op: 'integer', value: 1}
      }
    })
  });
  assert.equal(ingestionResponse.status, 201);
  const ingestion = await ingestionResponse.json();
  assert.equal(ingestion.workflowStatus, 'awaiting_confirmation');
  assert.equal(ingestion.revision, 1);

  const confirmResponse = await fetch(`${base}/v1/mistake-cases/${ingestion.caseId}/confirm`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'idempotency-key': 'test-golden-confirm'},
    body: JSON.stringify({
      expectedRevision: 1,
      acceptedTemplateVersion: 1,
      confirmedRelationIds: ['r-base', 'r-height']
    })
  });
  assert.equal(confirmResponse.status, 202);
  const confirmation = await confirmResponse.json();
  const replayResponse = await fetch(`${base}/v1/mistake-cases/${ingestion.caseId}/confirm`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'idempotency-key': 'test-golden-confirm'},
    body: JSON.stringify({
      expectedRevision: 1,
      acceptedTemplateVersion: 1,
      confirmedRelationIds: ['r-base', 'r-height']
    })
  });
  assert.equal(replayResponse.status, 202);
  assert.equal((await replayResponse.json()).workflowId, confirmation.workflowId);

  const secondIngestionResponse = await fetch(`${base}/v1/ingestions`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'manual', templateId: 'regular-quad-pyramid-be-pac', templateVersion: 1,
      parameters: {baseEdge: {op: 'integer', value: 3}, height: {op: 'integer', value: 2}}
    })
  });
  const secondIngestion = await secondIngestionResponse.json();
  const secondConfirmResponse = await fetch(`${base}/v1/mistake-cases/${secondIngestion.caseId}/confirm`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'idempotency-key': 'test-golden-confirm'},
    body: JSON.stringify({expectedRevision: 1, acceptedTemplateVersion: 1, confirmedRelationIds: ['r-base', 'r-height']})
  });
  assert.equal(secondConfirmResponse.status, 202);
  assert.notEqual((await secondConfirmResponse.json()).workflowId, confirmation.workflowId);

  const workflow = await waitFor(async () => {
    const response = await fetch(`${base}/v1/workflows/geometry/${confirmation.workflowId}`);
    const value = await response.json();
    return value.workflowStatus === 'completed' ? value : null;
  });
  assert.equal(workflow.solverStatus, 'verified');
  assert.equal(workflow.result.answer.displayPlain, '2√22/11');
  assert.equal(workflow.mistakeCase.correctAnswer, '2√22/11');
});
