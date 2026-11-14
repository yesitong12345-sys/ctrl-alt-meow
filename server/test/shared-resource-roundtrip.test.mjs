import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, rm} from 'node:fs/promises';

test('跨账号分享保留知识卡正反面，错题导入错题库且学习进度独立', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'shared-roundtrip-'));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, ['server.mjs'], {cwd: path.resolve(import.meta.dirname, '..'), windowsHide: true, stdio: 'ignore', env: {...process.env, PORT: String(port), HOST: '127.0.0.1', AUTH_REQUIRED: '1', PORT_PROBE_LIMIT: '1', DATA_FILE: path.join(dir, 'data.json'), MODEL_CONFIG_FILE: path.join(dir, 'no-config.json'), DEEPSEEK_API_KEY: ''}});
  const request = async (route, method = 'GET', body, token) => {
    if (method === 'POST' && ['/v1/shared-knowledge', '/v1/shared-knowledge/share'].includes(route) && body?.sharingConfirmed) body = {source:'测试自编资料',license:'original',...body};
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {method, headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: r.status, body: await r.json()};
  };
  try {
    for (let n = 0; n < 100; n++) { try { if ((await request('/health')).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    const a = (await request('/v1/auth/register', 'POST', {loginName: 'roundtrip-a', password: 'abcdef123', displayName: '甲'})).body;
    const b = (await request('/v1/auth/register', 'POST', {loginName: 'roundtrip-b', password: 'abcdef123', displayName: '乙'})).body;
    assert.ok(a.sessionToken && b.sessionToken);
    const front = '【完整正面】' + '题目条件与公式 $x^2$。'.repeat(240);
    const back = '【完整背面】' + '先找边界，再使用公式。'.repeat(240);
    const made = await request('/v1/study/understanding', 'POST', {title: '我的方法卡', text: back, frontContent: front, backContent: back, subject: '数学', knowledgePoint: '函数'}, a.sessionToken);
    assert.equal(made.status, 201);
    const shared = await request('/v1/shared-knowledge/share', 'POST', {cardId: made.body.card.id, sharingConfirmed: true}, a.sessionToken);
    assert.equal(shared.status, 201);
    const imported = await request(`/v1/shared-knowledge/${shared.body.id}/import`, 'POST', {}, b.sessionToken);
    assert.equal(imported.status, 201);
    assert.equal(imported.body.card.frontContent, front);
    assert.equal(imported.body.card.backContent, back);
    assert.equal(imported.body.card.user_id, b.user.id);
    assert.deepEqual(imported.body.card.sourceCaseIds, []);
    assert.equal(imported.body.card.reviewSchedule.intervalDays, 0);
    const quiz = await request('/v1/study/rolling-quiz?subject=数学', 'GET', undefined, b.sessionToken);
    assert.ok(quiz.body.items.some(item => item.ref_id === imported.body.card.id && item.kind === 'card'));
    assert.equal((await request(`/v1/shared-knowledge/${shared.body.id}/import`, 'POST', {}, b.sessionToken)).body.alreadyImported, true);
    const ingested = await request('/v1/ingestions', 'POST', {questionText: '已知函数 f(x)=x²，求导数。', subject: '数学', modelingMode: 'tutor_only'}, a.sessionToken);
    const id = ingested.body.mistakeCase?.id || ingested.body.draft?.id;
    assert.ok(id);
    const wrong = await request('/v1/shared-knowledge/share', 'POST', {caseId: id, sharingConfirmed: true}, a.sessionToken);
    assert.equal(wrong.status, 201);
    const copy = await request(`/v1/shared-knowledge/${wrong.body.id}/import`, 'POST', {}, b.sessionToken);
    assert.equal(copy.status, 201);
    assert.ok(copy.body.mistakeCase, '错题不能被偷偷变成普通知识卡');
    assert.equal(copy.body.mistakeCase.user_id, b.user.id);
    assert.equal(copy.body.mistakeCase.question, '已知函数 f(x)=x²，求导数。');
    assert.equal(copy.body.mistakeCase.studentAnswer, '');
    assert.equal(copy.body.mistakeCase.sourceSharedKnowledgeId, wrong.body.id);
    assert.equal((await request(`/v1/shared-knowledge/${wrong.body.id}/import`, 'POST', {}, b.sessionToken)).body.alreadyImported, true);
    const list = await request('/v1/shared-knowledge', 'GET', undefined, b.sessionToken);
    assert.equal(list.body.find(x => x.id === wrong.body.id).importedByCurrentUser, true);
    assert.equal((await request('/v1/shared-knowledge/share', 'POST', {cardId: made.body.card.id, sharingConfirmed: true}, b.sessionToken)).status, 404);
  } finally { child.kill(); await new Promise(r => child.once('exit', r)); await rm(dir, {recursive: true, force: true}); }
});
