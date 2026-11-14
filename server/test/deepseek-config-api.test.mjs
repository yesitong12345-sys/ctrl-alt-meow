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

const waitForHealth = async base => {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('server did not become healthy');
};

test('本机可以配置 DeepSeek，响应和健康状态都不泄露密钥', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-deepseek-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FILE: path.join(tempDir, 'data.json'),
      MODEL_CONFIG_FILE: path.join(tempDir, 'model-config.json')
    },
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base);
  const apiKey = 'sk-test-key-that-must-never-be-returned';

  const response = await fetch(`${base}/v1/admin/deepseek-config`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({apiKey})
  });
  assert.equal(response.status, 200);
  const configured = await response.json();
  assert.equal(configured.configured, true);
  assert.equal(configured.model, 'deepseek-v4-flash');
  assert.equal(JSON.stringify(configured).includes(apiKey), false);

  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.deepSeekConfigured, true);
  assert.equal(JSON.stringify(health).includes(apiKey), false);
});

test('无效密钥格式被拒绝', async t => {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-deepseek-invalid-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json'), MODEL_CONFIG_FILE: path.join(tempDir, 'model-config.json')},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base);

  const response = await fetch(`${base}/v1/admin/deepseek-config`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({apiKey: 'invalid'})
  });
  assert.equal(response.status, 422);
});
