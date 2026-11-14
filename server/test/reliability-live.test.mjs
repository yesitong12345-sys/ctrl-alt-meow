import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {backup} from '../../deployment/tencent-demo/backup.mjs';
import {restore} from '../../deployment/tencent-demo/restore.mjs';

test('真实服务重启保持两账号登录；单设备及全部设备退出持久生效', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'edu-session-live-'));
  const port = await new Promise(resolve => {const server = net.createServer(); server.listen(0, '127.0.0.1', () => {const value = server.address().port; server.close(() => resolve(value));});});
  const base = `http://127.0.0.1:${port}`, dataFile = path.join(root, 'data.json');
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['server.mjs'], {cwd: path.resolve(import.meta.dirname, '..'), windowsHide: true, stdio: 'ignore', env: {...process.env, HOST: '127.0.0.1', PORT: String(port), PORT_PROBE_LIMIT: '1', AUTH_REQUIRED: '1', DATA_FILE: dataFile, MODEL_CONFIG_FILE: path.join(root, 'absent.json'), DEEPSEEK_API_KEY: ''}});
    for (let attempt = 0; attempt < 100; attempt++) {try {if ((await fetch(base + '/health')).ok) return;} catch {} await new Promise(r => setTimeout(r, 50));}
    throw new Error('TEST_SERVER_NOT_READY');
  };
  const stop = async () => {if (child && child.exitCode === null) {const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited;}};
  const request = async (route, token, method = 'GET', body) => {
    const result = await fetch(base + route, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: result.status, body: result.status === 204 ? null : await result.json()};
  };
  try {
    await start();
    const register = async name => {const response = await request('/v1/auth/register', '', 'POST', {loginName: name, password: 'abcdef123', displayName: name}); assert.equal(response.status, 201); return response.body;};
    const a = await register('session-a'), b = await register('session-b');
    const second = await request('/v1/auth/login', '', 'POST', {loginName: 'session-a', password: 'abcdef123'});
    const a2 = second.body.sessionToken;
    const ingested = await request('/v1/ingestions', a.sessionToken, 'POST', {questionText: '本账号自己的题目：求函数导数。', subject: '数学', modelingMode: 'tutor_only'});
    assert.ok(ingested.body.mistakeCase || ingested.body.draft);
    await stop();
    const stored = await readFile(dataFile, 'utf8');
    assert.ok(!stored.includes(a.sessionToken)); assert.ok(JSON.parse(stored).authSessions.length >= 3);
    await start();
    assert.equal((await request('/v1/auth/me', a.sessionToken)).status, 200);
    assert.equal((await request('/v1/auth/me', b.sessionToken)).status, 200);
    assert.equal((await request('/v1/mistake-cases', b.sessionToken)).body.length, 0);
    assert.equal((await request('/v1/mistake-cases', a.sessionToken)).body.length, 1);
    assert.equal((await request('/v1/auth/logout', a.sessionToken, 'POST', {})).status, 204);
    assert.equal((await request('/v1/auth/me', a.sessionToken)).status, 401);
    assert.equal((await request('/v1/auth/me', a2)).status, 200);
    // Attempting to supply another user's id must not revoke that user's sessions.
    assert.equal((await request('/v1/auth/logout', a2, 'POST', {allDevices: true, userId: b.user.id})).status, 204);
    await stop(); await start();
    assert.equal((await request('/v1/auth/me', a2)).status, 401);
    assert.equal((await request('/v1/auth/me', b.sessionToken)).status, 200);
    assert.equal((await request('/v1/auth/logout', '', 'POST', {allDevices: true})).status, 401);
  } finally {await stop(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await rm(root, {recursive: true, force: true});}
});

test('隔离恢复演练：题目、知识卡正反面和图片完整恢复，当前文件仍可找回', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'edu-restore-drill-'));
  const live = path.join(workspace, 'live'), backups = path.join(workspace, 'backups'), uploads = path.join(live, 'uploads');
  await mkdir(uploads, {recursive: true});
  const dataFile = path.join(live, 'data.json');
  const original = {users: [{id: 'test-owner'}], cases: [{id: 'q1', user_id: 'test-owner', question: '原始题干', sourceImage: {hash: 'fixture'}}], knowledgeCards: [{id: 'k1', user_id: 'test-owner', frontContent: '完整正面 $x^2$', backContent: '完整背面 2x'}], authSessions: []};
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL0kAAAAASUVORK5CYII=', 'base64');
  try {
    await writeFile(dataFile, JSON.stringify(original)); await writeFile(path.join(uploads, 'fixture.png'), png);
    await backup({root: backups, dataFile, uploadDir: uploads, now: new Date('2026-10-11T00:00:00Z')});
    const changed = {users: [], cases: [], knowledgeCards: []};
    await writeFile(dataFile, JSON.stringify(changed)); await writeFile(path.join(uploads, 'fixture.png'), Buffer.from('modified'));
    const result = await restore({backupId: '2026-10-11T00-00-00-000Z', root: live, backups, serviceActive: () => false});
    assert.deepEqual(JSON.parse(await readFile(dataFile, 'utf8')), original);
    assert.deepEqual(await readFile(path.join(uploads, 'fixture.png')), png);
    assert.deepEqual(JSON.parse(await readFile(result.preserved, 'utf8')), changed);
    assert.equal(await readFile(path.join(result.preservedUploads, 'fixture.png'), 'utf8'), 'modified');
  } finally {assert.equal(path.dirname(workspace), path.resolve(os.tmpdir())); await rm(workspace, {recursive: true, force: true});}
});
