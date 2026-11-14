import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';

const freePort = () => new Promise(resolve => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
});

async function startServer(prefix, data = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), prefix));
  const port = await freePort();
  await writeFile(path.join(temp, 'data.json'), JSON.stringify(data), 'utf8');
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, HOST: '127.0.0.1', PORT: String(port), PORT_PROBE_LIMIT: '1', AUTH_REQUIRED: '1',
      DATA_FILE: path.join(temp, 'data.json'), DEEPSEEK_API_KEY: ''},
    stdio: 'ignore', windowsHide: true
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'server should start');
  return {child, base, temp};
}

const api = base => async (pathname, method = 'GET', body, token) => {
  if (method === 'POST' && pathname === '/v1/shared-knowledge' && body?.sharingConfirmed) body = {source:'测试自编资料',license:'original',...body};
  const response = await fetch(base + pathname, {method,
    headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})});
  return {status: response.status, body: await response.json().catch(() => null)};
};

test('共享附件上限 300 KB：刚好放行、超一点就拒绝并说明原因', async () => {
  const {child, base, temp} = await startServer('edu-share-limit-');
  const json = api(base);
  try {
    const user = await json('/v1/auth/register', 'POST', {loginName: 'limit-a', displayName: '小限', password: 'SecurePass123!'});
    assert.equal(user.status, 201);
    const token = user.body.sessionToken;
    const publish = fileData => ({title: '函数笔记', subject: '数学', knowledgePoint: '单调性', description: '定义法',
      fileName: 'notes.txt', fileType: 'text/plain', fileData, sharingConfirmed: true});

    // 300 KB 整（300*1024 字节）应当放行
    const exact = Buffer.alloc(300 * 1024, 0x61).toString('base64');
    const okResult = await json('/v1/shared-knowledge', 'POST', publish(exact), token);
    assert.equal(okResult.status, 201, '正好 300 KB 应该能发布');

    // 多 1 字节就拒绝，并且要告诉学生怎么绕过（放网盘写链接）
    const over = Buffer.alloc(300 * 1024 + 1, 0x61).toString('base64');
    const tooBig = await json('/v1/shared-knowledge', 'POST', publish(over), token);
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.error, 'SHARED_FILE_TOO_LARGE_OR_INVALID');
    assert.match(String(tooBig.body.message || ''), /300 KB/, '要明确说清上限是多少');

    // 列表里永远不能带附件正文（否则逛广场就等于把所有人的附件都拉下来）
    const list = await json('/v1/shared-knowledge', 'GET', null, token);
    assert.equal(list.status, 200);
    assert.equal(list.body.every(item => item.fileData === undefined), true, '列表不能携带 fileData');
    assert.equal(list.body[0].hasAttachment, true);
  } finally { child.kill(); await rm(temp, {recursive: true, force: true}); }
});

test('发布共享卡不会重建知识网络图（图只随错题/知识卡变）', async () => {
  /* 用户的要求：上传一张共享卡，不该把全部用户的全部错题重算一遍。
     这里在服务端源码层面锁住调用点，并验证懒重建入口存在且被读图路由使用。 */
  const {readFile} = await import('node:fs/promises');
  const serverSource = await readFile(path.resolve(import.meta.dirname, '../server.mjs'), 'utf8');
  const studySource = await readFile(path.resolve(import.meta.dirname, '../workflows/study-routes.mjs'), 'utf8');

  // persist() 里的重建必须受脏标记控制，不能无条件跑
  assert.match(serverSource, /if \(knowledgeGraphDirty\) \{\s*db\.graph = rebuildKnowledgeGraphs/,
    'persist() 里只有图脏了才重建');
  // 共享广场的路由不得把图标脏
  const shareSection = serverSource.slice(serverSource.indexOf("url.pathname === '/v1/shared-knowledge'"));
  assert.equal(/touchKnowledgeGraph\(\)/.test(shareSection.slice(0, 4000)), false,
    '共享广场的发布/删除不该标记知识网络图脏');
  // 读图路由必须走懒重建入口
  assert.equal(/graphForUser\(db\.graph/.test(studySource), false, '读图不能再直接读 db.graph');
  assert.match(studySource, /graphForUser\(currentGraph\(db\)/, '读图要走 currentGraph 懒重建');

  // 真跑一遍：发一张卡 + 读图，两边都要正常工作
  const {child, base, temp} = await startServer('edu-share-graph-');
  const json = api(base);
  try {
    const user = await json('/v1/auth/register', 'POST', {loginName: 'graph-a', displayName: '小图', password: 'SecurePass123!'});
    assert.equal(user.status, 201);
    const token = user.body.sessionToken;
    const published = await json('/v1/shared-knowledge', 'POST',
      {title: '二面角整理', subject: '数学', knowledgePoint: '二面角', description: '法向量法', sharingConfirmed: true}, token);
    assert.equal(published.status, 201);
    const graph = await json('/v1/study/knowledge-graph', 'GET', null, token);
    assert.equal(graph.status, 200, '发布共享卡之后读图仍然可用');
    assert.ok(Array.isArray(graph.body.nodes), '图结构正常');
  } finally { child.kill(); await rm(temp, {recursive: true, force: true}); }
});
