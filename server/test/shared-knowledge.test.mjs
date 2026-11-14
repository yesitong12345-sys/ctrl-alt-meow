import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';

const freePort = () => new Promise(resolve => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => {
    const port = socket.address().port;
    socket.close(() => resolve(port));
  });
});

test('一键分享自己的错题与知识卡，不能分享别人的', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'edu-share-one-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const caseId = 'case-share-source';
  /* 直接写一份带做题记录和卡点的错题数据再启服务：做题记录是拍照录入产生的，
     不是 PATCH 能编辑的字段，所以不能靠 API 造。
     归属写成 'seed-owner'，两个学生都不是它的主人，才能验证「不能分享别人的」。 */
  await writeFile(path.join(temp, 'data.json'), JSON.stringify({cases: [{
    id: caseId, user_id: 'seed-owner', studentId: 'seed-owner', subject: '数学', unit: '立体几何',
    question: '求二面角大小。', studentAnswer: '以 A 为原点建系', correctAnswer: '60°',
    knowledgePoints: ['二面角'], microSkills: [], errorCauses: ['概念不清'],
    analysis: '建系后没有继续求法向量。', origin: 'student_confirmed_paper', source: 'paper_batch',
    processSteps: [{index: 1, label: '建系', detail: '以 A 为原点建系', formula: 'A(0,0,0)', verdict: 'correct'}],
    stuckAt: {stepIndex: 1, label: '建系后没继续', status: 'wrong', evidence: '手写“以 A 为原点建系”后停笔'},
    createdAt: new Date().toISOString()
  }]}), 'utf8');
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, HOST: '127.0.0.1', PORT: String(port), PORT_PROBE_LIMIT: '1', AUTH_REQUIRED: '1', DATA_FILE: path.join(temp, 'data.json'), DEEPSEEK_API_KEY: ''},
    stdio: 'ignore', windowsHide: true
  });
  const json = async (pathname, method = 'GET', body, token) => {
    if (method === 'POST' && ['/v1/shared-knowledge', '/v1/shared-knowledge/share'].includes(pathname) && body?.sharingConfirmed) body = {source:'测试自编资料',license:'original',...body};
    const response = await fetch(base + pathname, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: response.status, body: await response.json()};
  };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'server should start');
    const a = await json('/v1/auth/register', 'POST', {loginName: 'share-a', displayName: '小甲', password: 'SecurePass123!'});
    const b = await json('/v1/auth/register', 'POST', {loginName: 'share-b', displayName: '小乙', password: 'SecurePass123!'});
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    // 这份数据不属于任何学生：谁都不该能分享它
    assert.equal((await json(`/v1/mistake-cases/${caseId}`, 'PATCH', {question: '想改别人的题'}, a.body.sessionToken)).status, 404);
    assert.equal((await json('/v1/shared-knowledge/share', 'POST', {caseId, sharingConfirmed: true}, b.body.sessionToken)).status, 404);

    // 小甲自己录一道错题，它才是「自己的东西」
    const ingested = await json('/v1/ingestions', 'POST', {questionText: '求异面直线所成角。', subject: '数学', modelingMode: 'tutor_only'}, a.body.sessionToken);
    assert.ok([200, 201].includes(ingested.status), `ingestions 应该可用，实际 ${ingested.status}`);
    const ownId = ingested.body.mistakeCase?.id || ingested.body.draft?.id;
    assert.ok(ownId, '要拿到自己错题的 id');

    // 分享自己的错题
    const shared = await json('/v1/shared-knowledge/share', 'POST', {caseId: ownId, sharingConfirmed: true}, a.body.sessionToken);
    assert.equal(shared.status, 201);
    assert.equal(shared.body.kind, 'misconception');
    assert.equal(shared.body.subject, '数学');
    assert.match(shared.body.title, /异面直线/);
    assert.match(shared.body.description, /【题目】/);
    assert.equal(shared.body.sourceRef.caseId, ownId);
    assert.equal(shared.body.fileData, undefined);

    // 重复分享同一个来源是幂等的
    const again = await json('/v1/shared-knowledge/share', 'POST', {caseId: ownId, sharingConfirmed: true}, a.body.sessionToken);
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyShared, true);
    assert.equal((await json('/v1/shared-knowledge')).body.length, 1);

    // 不能分享别人的错题
    assert.equal((await json('/v1/shared-knowledge/share', 'POST', {caseId: ownId, sharingConfirmed: true}, b.body.sessionToken)).status, 404);
    // 未确认公开也不行
    assert.equal((await json('/v1/shared-knowledge/share', 'POST', {caseId: ownId}, a.body.sessionToken)).status, 422);
    // 未登录更不行
    assert.equal((await json('/v1/shared-knowledge/share', 'POST', {caseId: ownId, sharingConfirmed: true})).status, 401);
    // 没给来源
    assert.equal((await json('/v1/shared-knowledge/share', 'POST', {sharingConfirmed: true}, a.body.sessionToken)).status, 400);

    // 游客能逛到这份资料，但看不到「我收藏过」这种个人信息
    const guest = await json('/v1/shared-knowledge');
    assert.equal(guest.status, 200);
    assert.equal(guest.body.length, 1);
    assert.equal(guest.body[0].importedByCurrentUser, false);
    assert.equal(guest.body[0].hasAttachment, false);
    // 关键词与学科筛选
    assert.equal((await json('/v1/shared-knowledge?q=异面直线')).body.length, 1);
    assert.equal((await json('/v1/shared-knowledge?q=完全不相干的词')).body.length, 0);
    assert.equal((await json('/v1/shared-knowledge?subject=物理')).body.length, 0);
    assert.equal((await json('/v1/shared-knowledge?kind=misconception')).body.length, 1);
    assert.equal((await json('/v1/shared-knowledge?kind=card')).body.length, 0);
  } finally { child.kill(); await rm(temp, {recursive: true, force: true}); }
});

test('students can publish shared materials without allowing other students to delete them', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'edu-shared-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, HOST: '127.0.0.1', PORT: String(port), PORT_PROBE_LIMIT: '1', AUTH_REQUIRED: '1', DATA_FILE: path.join(temp, 'data.json'), DEEPSEEK_API_KEY: ''},
    stdio: 'ignore', windowsHide: true
  });
  const json = async (pathname, method = 'GET', body, token) => {
    if (method === 'POST' && ['/v1/shared-knowledge', '/v1/shared-knowledge/share'].includes(pathname) && body?.sharingConfirmed) body = {source:'测试自编资料',license:'original',...body};
    const response = await fetch(base + pathname, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: response.status, body: await response.json()};
  };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'server should start');
    // 广场是公开内容：未登录可以浏览（只是空列表），发布/详情/收藏仍然要登录。
    assert.equal((await json('/v1/shared-knowledge')).status, 200);
    assert.deepEqual((await json('/v1/shared-knowledge')).body, []);
    assert.equal((await json('/v1/shared-knowledge', 'POST', {title: 'x', subject: '数学', description: 'y', sharingConfirmed: true})).status, 401);
    const a = await json('/v1/auth/register', 'POST', {loginName: 'shared-a', displayName: '小甲', password: 'SecurePass123!'});
    const b = await json('/v1/auth/register', 'POST', {loginName: 'shared-b', displayName: '小乙', password: 'SecurePass123!'});
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    const fileData = Buffer.from('我的知识点笔记', 'utf8').toString('base64');
    const publication = {kind: 'card', title: '函数笔记', subject: '数学', knowledgePoint: '单调性', description: '定义法', fileName: 'notes.txt', fileType: 'text/plain', fileData};
    assert.equal((await json('/v1/shared-knowledge', 'POST', publication, a.body.sessionToken)).status, 422);
    const created = await json('/v1/shared-knowledge', 'POST', {...publication, sharingConfirmed: true}, a.body.sessionToken);
    assert.equal(created.status, 201);
    assert.equal(created.body.fileData, undefined);
    const listed = await json('/v1/shared-knowledge', 'GET', null, b.body.sessionToken);
    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].kind, 'card');
    assert.equal(listed.body[0].fileData, undefined);
    assert.equal(listed.body[0].importedByCurrentUser, false);
    assert.equal((await json('/v1/shared-knowledge?kind=card&subject=数学', 'GET', null, b.body.sessionToken)).body.length, 1);
    assert.equal((await json('/v1/shared-knowledge?kind=card&subject=物理', 'GET', null, b.body.sessionToken)).body.length, 0);
    assert.equal((await json('/v1/shared-knowledge?kind=misconception', 'GET', null, b.body.sessionToken)).body.length, 0);
    const fetched = await json('/v1/shared-knowledge/' + created.body.id, 'GET', null, b.body.sessionToken);
    assert.equal(fetched.body.fileData, fileData);
    const imported = await json('/v1/shared-knowledge/' + created.body.id + '/import', 'POST', {}, b.body.sessionToken);
    assert.equal(imported.status, 201);
    assert.equal(imported.body.imported, true);
    assert.equal(imported.body.card.user_id, b.body.user.id);
    assert.equal(imported.body.card.studentId, b.body.user.id);
    assert.equal(imported.body.card.favorite, true);
    assert.equal(imported.body.card.sourceSharedKnowledgeId, created.body.id);
    assert.match(imported.body.card.insight, /定义法/);
    assert.match(imported.body.card.insight, /我的知识点笔记/);
    const repeatedImport = await json('/v1/shared-knowledge/' + created.body.id + '/import', 'POST', {}, b.body.sessionToken);
    assert.equal(repeatedImport.status, 200);
    assert.equal(repeatedImport.body.card.id, imported.body.card.id, 'import should be idempotent per student');
    const ownCards = await json('/v1/knowledge-cards', 'GET', null, b.body.sessionToken);
    assert.equal(ownCards.status, 200);
    assert.equal(ownCards.body.length, 1);
    assert.equal(ownCards.body[0].id, imported.body.card.id);
    const quiz = await json('/v1/study/rolling-quiz?subject=all', 'GET', null, b.body.sessionToken);
    assert.equal(quiz.status, 200);
    assert.ok(quiz.body.items.some(item => item.ref_id === imported.body.card.id && item.kind === 'card'), 'imported card should enter the challenge queue');
    assert.equal((await json('/v1/knowledge-cards', 'GET', null, a.body.sessionToken)).body.length, 0, 'import must not add a card to its author or other accounts');
    assert.equal((await json('/v1/shared-knowledge', 'GET', null, b.body.sessionToken)).body[0].importedByCurrentUser, true);
    // 小乙导入后也能主动分享自己的这张知识卡；小甲应能看见，但不能删。
    const reshared = await json('/v1/shared-knowledge/share', 'POST', {cardId: imported.body.card.id, sharingConfirmed: true}, b.body.sessionToken);
    assert.equal(reshared.status, 201);
    assert.equal(reshared.body.kind, 'card');
    assert.equal(reshared.body.subject, '数学');
    assert.equal((await json('/v1/shared-knowledge', 'GET', null, a.body.sessionToken)).body.length, 2);
    assert.equal((await json('/v1/shared-knowledge/' + reshared.body.id, 'DELETE', null, a.body.sessionToken)).status, 403);
    assert.equal((await json('/v1/shared-knowledge/' + created.body.id, 'DELETE', null, b.body.sessionToken)).status, 403);
    assert.equal((await json('/v1/shared-knowledge/' + created.body.id, 'DELETE', null, a.body.sessionToken)).status, 200);
    assert.deepEqual((await json('/v1/shared-knowledge', 'GET', null, b.body.sessionToken)).body.map(item => item.id), [reshared.body.id]);
  } finally {
    child.kill();
    await rm(temp, {recursive: true, force: true});
  }
});

test('共享知识卡重启后仍在广场，另一账号可按学科找到并导入', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'edu-shared-persist-'));
  const dataFile = path.join(temp, 'data.json');
  const start = async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {...process.env, HOST: '127.0.0.1', PORT: String(port), PORT_PROBE_LIMIT: '1',
        AUTH_REQUIRED: '1', DATA_FILE: dataFile, DEEPSEEK_API_KEY: ''},
      stdio: 'ignore', windowsHide: true
    });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'server should start');
    const json = async (pathname, method = 'GET', body, token) => {
      if (method === 'POST' && ['/v1/shared-knowledge', '/v1/shared-knowledge/share'].includes(pathname) && body?.sharingConfirmed) body = {source:'测试自编资料',license:'original',...body};
      const response = await fetch(base + pathname, {method,
        headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})},
        ...(body ? {body: JSON.stringify(body)} : {})});
      return {status: response.status, body: await response.json()};
    };
    return {child, json};
  };
  let service;
  try {
    service = await start();
    const a = await service.json('/v1/auth/register', 'POST', {loginName: 'persist-a', displayName: '测试甲', password: 'SecurePass123!'});
    assert.equal(a.status, 201);
    const published = await service.json('/v1/shared-knowledge', 'POST', {
      kind: 'card', title: '电势知识卡', subject: '物理', knowledgePoint: '电势',
      description: '沿电场线方向电势降低。', sharingConfirmed: true
    }, a.body.sessionToken);
    assert.equal(published.status, 201);
    const id = published.body.id;
    const oldChild = service.child;
    const stopped = once(oldChild, 'exit');
    oldChild.kill();
    await stopped;
    service = await start();
    const b = await service.json('/v1/auth/register', 'POST', {loginName: 'persist-b', displayName: '测试乙', password: 'SecurePass123!'});
    assert.equal(b.status, 201);
    const list = await service.json('/v1/shared-knowledge?kind=card&subject=物理', 'GET', null, b.body.sessionToken);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map(item => item.id), [id]);
    const imported = await service.json(`/v1/shared-knowledge/${id}/import`, 'POST', {}, b.body.sessionToken);
    assert.equal(imported.status, 201);
    assert.equal(imported.body.card.user_id, b.body.user.id);
    const quiz = await service.json('/v1/study/rolling-quiz?subject=物理', 'GET', null, b.body.sessionToken);
    assert.ok(quiz.body.items.some(item => item.ref_id === imported.body.card.id && item.kind === 'card'));
  } finally {
    if (service?.child && service.child.exitCode === null) {
      const stopped = once(service.child, 'exit');
      service.child.kill();
      await stopped;
    }
    await rm(temp, {recursive: true, force: true});
  }
});
