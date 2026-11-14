import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyRouter, normalizeDailyPlanPreferences} from '../workflows/study-routes.mjs';

function response() {
  return {status: 0, body: null,
    writeHead(status) { this.status = status; },
    end(body) { this.body = JSON.parse(body); }};
}

test('daily plan preferences clamp counts and retain manual selections', () => {
  const result = normalizeDailyPlanPreferences({
    counts: {数学: 3, 语文: 999}, pinned: {数学: ['数学::线面角', '数学::线面角']},
    excluded: {数学: ['数学::空间几何']}, challengeMode: 'single', challengeSubject: '语文',
    selectedDate: '2026-09-25'
  });
  assert.equal(result.counts.数学, 3);
  assert.equal(result.counts.语文, 10);
  assert.deepEqual(result.pinned.数学, ['数学::线面角']);
  assert.deepEqual(result.excluded.数学, ['数学::空间几何']);
  assert.equal(result.challengeMode, 'single');
});

test('daily plan preferences are stored per student', async () => {
  const db = {dailyStudyPlanPreferences: []};
  let saves = 0;
  const url = new URL('http://localhost/v1/study/daily-plan-preferences');
  const alice = createStudyRouter({db, currentUserId: 'alice', requestBody: {counts: {数学: 2}}, persist: async () => { saves++; }});
  const bob = createStudyRouter({db, currentUserId: 'bob', requestBody: {counts: {语文: 1}}, persist: async () => { saves++; }});
  const aliceSaved = response();
  await alice({method: 'PUT'}, aliceSaved, url);
  const bobSaved = response();
  await bob({method: 'PUT'}, bobSaved, url);
  const aliceRead = response();
  await alice({method: 'GET'}, aliceRead, url);
  assert.equal(aliceRead.body.preferences.counts.数学, 2);
  assert.equal(aliceRead.body.preferences.counts.语文, undefined);
  const bobRead = response();
  await bob({method: 'GET'}, bobRead, url);
  assert.equal(bobRead.body.preferences.counts.语文, 1);
  assert.equal(saves, 2);
});

test('daily plan stores each subject quota and the student-chosen subject order', () => {
  const result = normalizeDailyPlanPreferences({
    counts: {数学: 2, 化学: 0},
    subjectOrder: ['数学', '化学', '数学', '语文']
  });
  assert.equal(result.counts.数学, 2);
  assert.equal(result.counts.化学, 0);
  assert.deepEqual(result.subjectOrder, ['数学', '化学', '语文']);
});
