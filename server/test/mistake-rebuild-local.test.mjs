import test from 'node:test';
import assert from 'node:assert/strict';
import {createMistakeAdminRouter} from '../workflows/mistake-admin-routes.mjs';
import {parseStandardPolyhedronText} from '../workflows/polyhedron-geometry-entry.mjs';
import {compilePolyhedronGeometryIR} from '../workflows/polyhedron-geometry-engine.mjs';

function response() {
  return {
    status: 0, body: '',
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); }
  };
}

test('本机旧错题不在服务端时，重建模应原位导入并保留题目身份', async () => {
  const id = '6b1d3dea-3c11-41e6-8ed6-b24b39879102';
  const db = {cases: [], events: []};
  const router = createMistakeAdminRouter({db, persist: async () => {}, currentUserId: 'student-a',
    requestBody: {question: '正四棱锥 P-ABCD 的底面边长为 6，高 PO=4，O 为底面中心，求 PA。',
      localCase: {id, subject: '数学', unit: '空间几何', knowledgePoints: ['棱锥'],
        learningProfile: {mastery: 36}, createdAt: '2026-09-18T00:00:00.000Z'}},
    rebuildModel: async record => {
      record.geometryResult = {solverStatus: 'verified', scene: {kind: 'pyramid'}};
      return {ok: true, case: record, status: 'verified_unique'};
    }});
  const res = response();
  await router({method: 'POST'}, res, new URL(`http://localhost/v1/mistake-cases/${id}/rebuild-model`));
  assert.equal(res.status, 200);
  assert.equal(res.body.case.id, id);
  assert.equal(res.body.case.user_id, 'student-a');
  assert.equal(res.body.case.learningProfile.mastery, 36);
  assert.equal(db.cases.length, 1);
});

test('本机旧错题不能借重建模覆盖其他用户的同 ID 记录', async () => {
  const id = '6b1d3dea-3c11-41e6-8ed6-b24b39879102';
  const db = {cases: [{id, user_id: 'student-b', question: '私有题目'}], events: []};
  const router = createMistakeAdminRouter({db, persist: async () => {}, currentUserId: 'student-a',
    canAccess: item => item.user_id === 'student-a',
    requestBody: {question: '另一道题', localCase: {id, question: '另一道题'}}});
  const res = response();
  await router({method: 'POST'}, res, new URL(`http://localhost/v1/mistake-cases/${id}/rebuild-model`));
  assert.equal(res.status, 404);
  assert.equal(db.cases[0].question, '私有题目');
});

test('后台重建模立刻返回 202，不挂住连接，随后自己跑完', async () => {
  const id = 'check-bg-unit-0001';
  const db = {cases: [], events: []};
  let rebuildStarted = false;
  let releaseRebuild;
  const blocked = new Promise(resolve => { releaseRebuild = resolve; });
  const router = createMistakeAdminRouter({db, persist: async () => {}, currentUserId: 'student-a',
    requestBody: {background: true, question: '正方体棱长为 2，求体积。',
      localCase: {id, question: '正方体棱长为 2，求体积。', subject: '数学'}},
    rebuildModel: async record => {
      rebuildStarted = true;
      await blocked;                       // 卡住建模，证明 HTTP 不会等它
      record.geometryResult = {solverStatus: 'verified', scene: {kind: 'cube'}};
      return {ok: true, case: record, status: 'verified_unique'};
    }});
  const res = response();
  await router({method: 'POST'}, res, new URL(`http://localhost/v1/mistake-cases/${id}/rebuild-model`));
  // 关键断言：建模还卡着，响应已经发出了
  assert.equal(res.status, 202);
  assert.equal(res.body.background, true);
  assert.equal(res.body.status, 'building');
  assert.equal(res.body.case.geometryBuildStatus, 'building');
  assert.match(res.body.message, /后台/);
  assert.equal(db.cases[0].geometryBuildStatus, 'building', '先落盘 building 状态，前端才能显示生成中');
  // 放行后台任务，确认它自己会跑完（几轮微任务之后）
  releaseRebuild();
  for (let i = 0; i < 20 && !rebuildStarted; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(rebuildStarted, true, '后台确实开始建模了');
});

test('正四棱锥的「高 PO=4」与侧棱 PA 查询可在 AI 断网时确定性建模', () => {
  const parsed = parseStandardPolyhedronText('正四棱锥 P-ABCD 的底面边长为 6，高 PO=4，O 为正方形 ABCD 的中心。求侧棱 PA 的长度。');
  assert.equal(parsed.problemIR.solid.apex.P[2], 4);
  assert.deepEqual(parsed.problemIR.queries[0].points, ['P', 'A']);
  const compiled = compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status, 'verified_unique');
  assert.ok(compiled.result.scene);
  assert.ok(Math.abs(compiled.queryResults['segment-length'].value - Math.sqrt(34)) < 1e-9);
});
