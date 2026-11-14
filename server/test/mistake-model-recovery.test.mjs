import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../../implementation/index.html', import.meta.url), 'utf8');
const start = html.indexOf('/* BEGIN identical-own-model-recovery */');
const end = html.indexOf('/* END identical-own-model-recovery */');

function recovery() {
  assert.ok(start >= 0 && end > start, '错题库应有同题模型恢复层');
  const context = vm.createContext({Map});
  vm.runInContext(`${html.slice(start, end)};this.recover = recoverIdenticalVerifiedModels`, context);
  return context.recover;
}

test('同一学生同题的旧记录保留身份与进度，并恢复已验证 3D 面板数据', () => {
  const recover = recovery();
  const old = {id:'old',question:'正四棱锥 $P-ABCD$ 的底面边长为 $6$，高 $PO=4$，$O$ 为正方形 $ABCD$ 的中心。求侧棱 $PA$ 的长度。',learningProfile:{mastery:36}};
  const verified = {id:'new',question:'正四棱锥 P-ABCD 的底面边长为 6，高 PO=4，O 为正方形 ABCD 的中心。求侧棱 PA 的长度。',geometryResult:{solverStatus:'verified',scene:{schemaVersion:'geometry-scene/v3'}},modelStatus:'verified'};
  const [restored] = recover([old, verified]);
  assert.equal(restored.id, 'old');
  assert.equal(restored.learningProfile.mastery, 36);
  assert.equal(restored.geometryResult.scene.schemaVersion, 'geometry-scene/v3');
  assert.equal(restored.modelRecoveredFromCaseId, 'new');
});

test('尺寸不同或参考模型未验证时，不得借用其他题的坐标', () => {
  const recover = recovery();
  const old = {id:'old',question:'正四棱锥 P-ABCD 的底面边长为 4，高 PO=4，求 PA 的长度。'};
  const wrongSize = {id:'different',question:'正四棱锥 P-ABCD 的底面边长为 6，高 PO=4，求 PA 的长度。',geometryResult:{solverStatus:'verified',scene:{}}};
  const unverified = {id:'reference',question:old.question,geometryResult:{solverStatus:'reference',scene:{}}};
  assert.equal(recover([old, wrongSize, unverified])[0].geometryResult, undefined);
});

test('不同学生或不同题图不得借用同文题干的空间模型', () => {
  const recover = recovery();
  const question = '正四棱锥 P-ABCD 的底边长为 6，高为 4，求 PA。';
  const source = {id:'source',question,subject:'数学',user_id:'student-A',imageHash:'image-A',geometryResult:{solverStatus:'verified',scene:{}}};
  assert.equal(recover([{id:'other-student',question,subject:'数学',user_id:'student-B',imageHash:'image-A'},source])[0].geometryResult, undefined);
  assert.equal(recover([{id:'other-picture',question,subject:'数学',user_id:'student-A',imageHash:'image-B'},source])[0].geometryResult, undefined);
  assert.equal(recover([{id:'unowned',question,subject:'数学'},source], true)[0].geometryResult, undefined);
});

test('错题列表优先显示已有 3D 的题，失败的旧提交不能占据首屏', () => {
  const sortStart = html.indexOf('function compareMistakeSyncPriority(left,right)');
  const sortEnd = html.indexOf('async function hydrateServerMistakes()', sortStart);
  assert.ok(sortStart >= 0 && sortEnd > sortStart);
  const context = vm.createContext({});
  vm.runInContext(`${html.slice(sortStart, sortEnd)};this.compare = compareMistakeSyncPriority`, context);
  const records = [
    {id:'failed-new',modelStatus:'needs_more_context',createdAt:'2026-09-25T10:00:00Z'},
    {id:'verified-old',geometryResult:{solverStatus:'verified',scene:{}},createdAt:'2026-09-20T10:00:00Z'},
    {id:'reference',geometryResult:{solverStatus:'reference',scene:{}},createdAt:'2026-09-24T10:00:00Z'}
  ];
  assert.deepEqual(records.sort(context.compare).map(item => item.id),
    ['reference','verified-old','failed-new']);
  assert.match(html, /recoverIdenticalVerifiedModels\(\[\.\.\.representatives,\.\.\.collapsed\][^;]*\)\.sort\(compareMistakeSyncPriority\)/,
    'same-question model recovery must run before display sorting');
});
