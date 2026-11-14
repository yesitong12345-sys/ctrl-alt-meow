import test from 'node:test';
import assert from 'node:assert/strict';
import {createMistakeAdminRouter} from '../workflows/mistake-admin-routes.mjs';

function response() {
  return {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); }
  };
}

test('deleting a browser-only legacy mistake succeeds when the server has no matching case', async () => {
  const db = {cases: [], events: []};
  const res = response();
  const router = createMistakeAdminRouter({db, persist: async () => {}});
  await router({method: 'DELETE'}, res, new URL('http://localhost/v1/mistake-cases/local-legacy-123'));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.alreadyAbsent, true);
  assert.deepEqual(db.cases, []);
});

test('deleting a case owned by another student does not report success', async () => {
  const db = {cases: [{id: 'private-case-123', user_id: 'student-b'}], events: []};
  const res = response();
  const router = createMistakeAdminRouter({db, persist: async () => {},
    canAccess: item => item.user_id === 'student-a'});
  await router({method: 'DELETE'}, res, new URL('http://localhost/v1/mistake-cases/private-case-123'));
  assert.equal(res.status, 404);
  assert.equal(db.cases.length, 1);
});

test('deleting an existing case removes only its dependent sessions and detaches cards', async () => {
  const db = {
    cases: [{id: 'owned-case-123', user_id: 'student-a'}, {id: 'keep-case-456', user_id: 'student-a'}],
    tutorSessions: [{id: 'session-1', caseId: 'owned-case-123'}, {id: 'session-2', caseId: 'keep-case-456'}],
    ingestions: [{id: 'ingestion-1', caseId: 'owned-case-123'}],
    knowledgeCards: [{id: 'card-1', sourceCaseIds: ['owned-case-123', 'keep-case-456']}],
    events: []
  };
  let saved = 0;
  const res = response();
  const router = createMistakeAdminRouter({db, persist: async () => { saved += 1; },
    canAccess: item => item.user_id === 'student-a'});
  await router({method: 'DELETE'}, res, new URL('http://localhost/v1/mistake-cases/owned-case-123'));
  assert.equal(res.status, 200);
  assert.equal(res.body.alreadyAbsent, undefined);
  assert.equal(res.body.removedSessions, 1);
  assert.equal(saved, 1);
  assert.deepEqual(db.cases.map(item => item.id), ['keep-case-456']);
  assert.deepEqual(db.deletedCaseIds, ['owned-case-123']);
  assert.equal(db.deletedCaseOwners['owned-case-123'], 'student-a');
  assert.deepEqual(db.tutorSessions.map(item => item.id), ['session-2']);
  assert.deepEqual(db.ingestions, []);
  assert.deepEqual(db.knowledgeCards[0].sourceCaseIds, ['keep-case-456']);
});
