import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..', 'implementation');

test('both upload paths send an expired or missing student session to login instead of showing a review failure', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const intake = await readFile(path.join(root, 'wrong-question-entry.js'), 'utf8');
  const account = await readFile(path.join(root, 'account-settings.js'), 'utf8');
  const centralRequest = html.match(/async function requestAt\(base,path,options=\{\}\)[\s\S]*?(?=\n  async function request\()/)?.[0] || '';
  const intakeCall = intake.match(/async function call\(path, body\)[\s\S]*?(?=\n  async function compressPhoto)/)?.[0] || '';
  assert.match(centralRequest, /AUTHENTICATION_REQUIRED/);
  assert.match(intakeCall, /AUTHENTICATION_REQUIRED/);
  assert.match(centralRequest, /window\.__eduRequireLogin/);
  assert.match(account, /app\.state\.tab='account-settings'/);
  assert.match(account, /rememberPendingUpload\(\)/);
  assert.match(intake, /state\.tab='account-settings'/);
});

test('expired session preserves typed question across the login reload and clears the stale token', async () => {
  const source = await readFile(path.join(root, 'account-settings.js'), 'utf8');
  const values = new Map([['educompanion.student.session', 'expired-token']]);
  const sessionStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const activate = (state, userId = 'student-1') => {
    const window = {__eduAccountChanged: async () => {}};
    let feature;
    window.__registerAccountSettings = candidate => { feature = candidate; };
    vm.runInNewContext(source, {window, sessionStorage, document: {querySelector: () => null}, location: {protocol: 'http:', hostname: 'example.test'}});
    feature.activate({state, request: async path => path === '/health' ? {authRequired: true} : {user: {id: userId}}, render: () => {}});
    return window;
  };
  const before = {tab: 'upload', geometryTextQuestion: '求线面角', geometryTextAnswer: '先作垂线', wqIntake: {questionText: '求线面角', mode: 'text'}};
  const first = activate(before);
  first.__eduCurrentOwner = 'student-1';
  await first.__eduRequireLogin();
  assert.equal(before.tab, 'account-settings');
  assert.equal(values.has('educompanion.student.session'), false);
  assert.equal(JSON.parse(values.get('educompanion.pending.upload')).questionText, '求线面角');

  values.set('educompanion.student.session', 'new-token');
  const after = {tab: 'home'};
  activate(after);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(after.geometryTextQuestion, '求线面角');
  assert.equal(after.geometryTextAnswer, '先作垂线');
  assert.equal(after.wqIntake.questionText, '求线面角');
  assert.equal(values.has('educompanion.pending.upload'), false);

  values.set('educompanion.student.session', 'expired-again');
  const privateDraft = {tab: 'upload', geometryTextQuestion: 'A 的私人草稿', wqIntake: {questionText: 'A 的私人草稿', mode: 'text'}};
  const second = activate(privateDraft);
  second.__eduCurrentOwner = 'student-1';
  await second.__eduRequireLogin();
  values.set('educompanion.student.session', 'student-2-token');
  const otherStudent = {tab: 'home'};
  activate(otherStudent, 'student-2');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(otherStudent.geometryTextQuestion, undefined);
  assert.equal(values.has('educompanion.pending.upload'), false);
});
