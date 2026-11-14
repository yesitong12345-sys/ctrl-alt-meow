import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

test('错题库不应在打开时阻塞主线程或进入公共题型匹配重渲染循环', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  const templates = await readFile(path.join(root, 'implementation', 'public-problem-templates.js'), 'utf8');

  assert.doesNotMatch(html, /JSON\.stringify\(m\)\.includes\(state\.query\)/,
    'empty search must not serialize every complete mistake record, including images and scene data');
  assert.match(html, /!query\|\|searchable\(m\)\.includes\(query\)/,
    'library search must stay on small, textual fields only');
  assert.match(html, /data-load-three=/,
    'a verified case must retain a retry control if WebGL cannot mount');
  assert.match(html, /mountFocusedLibraryGeometry/,
    'opening a verified mistake must automatically replace the SVG fallback with its interactive canvas');
  assert.match(html, /querySelector\('\[data-case-three\]'\)/,
    'automatic mounting must be limited to the single opened mistake instead of every library card');
  assert.match(html, /if\(!container\.isConnected\)\{dispose\(\);return\}/,
    'detached 3D containers must release their renderer instead of leaking animation loops');
  assert.doesNotMatch(html, /if\(state\.focusMistakeId&&!String\(state\.query\|\|''\)\.trim\(\)\)\{[^}]*state\.query=/,
    'focusing a newly uploaded case must never silently turn into a library search filter');
  assert.doesNotMatch(html, /state\.query=m\.question\.slice\(/,
    'jumping to one case must open that case without hiding every other mistake');

  assert.doesNotMatch(templates, /JSON\.stringify\(item\)\.includes\(app\.state\.query/,
    'public template decoration must not reintroduce whole-record serialization');
  assert.match(templates, /if \(!cases\.length\) return false;/,
    'matching must distinguish no work from an actual async update');
  assert.match(templates, /then\(function \(updated\) \{ if \(updated && app\.state\.tab === 'library'\) app\.render\(\); \}\)/,
    'a completed match queue must not recursively rerender the library forever');
});

test('旧记录若可被确定性验证，应在错题库恢复时补回 3D，而不是永久停留在 learning_without_3d', async () => {
  const server = await readFile(path.join(root, 'server', 'server.mjs'), 'utf8');
  assert.match(server, /repairLegacyGeometryCase/,
    'the server must have a deterministic migration for previously failed but now supported geometry records');
  assert.match(server, /parseCircularGeometryText\(legacy\.question/,
    'the migration must reparse complete cylinder, cone and sphere text with the current verified engine');
  assert.match(server, /geometryResult:\s*repaired\.result\s*\|\|\s*repaired\.geometryResult/,
    'a successful migration must persist the verified result on the same personal mistake record');
});

test('语音修正前后的同一题应只显示已验证版本，并把旧焦点迁移到新模型', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /function canonicalMistakeKey\(item\)/,
    'hydration must compare the mathematical identity of corrected speech input, not raw whitespace only');
  assert.match(html, /function compareMistakeSyncPriority\(left,right\)/,
    'hydration must have an explicit precedence rule for competing versions of one case');
  /* 排序必须按 geometryResult.solverStatus 判定"有可用 3D 模型"，而不是 verificationStatus。
     AI 参考模型的 verificationStatus 是 'ai_reference'、solverStatus 才是 'reference'；
     旧断言写 verificationStatus==='verified' 会把参考模型题全部判为低优先级，
     叠加时间升序后新题沉底，用户在首屏看不到（误以为没有写入错题库）。 */
  assert.match(html, /\['verified','reference'\]\.includes\(item\?\.geometryResult\?\.solverStatus\)&&item\?\.geometryResult\?\.scene/,
    'a verified or AI-reference SceneSpec must outrank an older learning-only duplicate');
  assert.match(html, /supersededCaseIds/,
    'the client must remember which failed case id was superseded');
  assert.match(html, /state\.focusMistakeId=resolveSupersededCaseId\(state\.focusMistakeId\)/,
    'an open failed duplicate must be redirected to the verified successor');
  assert.match(html, /state\.libraryDetailId=resolveSupersededCaseId\(state\.libraryDetailId\)/,
    'the expanded library card must be redirected to the verified successor');
});

test('教师演示模式只呈现已验证 3D 题，并使用安静的教材式空间模型', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  assert.match(html, /demo3DOnly/,
    'the library must expose a non-destructive 3D-only demo mode');
  assert.match(html, /solverStatus\s*===\s*['"]verified['"]/,
    'demo filtering must be based on verified geometry, not a subject keyword');
  assert.match(html, /geometry-scene\{[^}]*background:#f7f4ed/,
    'the geometry panel should use a warm textbook-paper surface');
  assert.doesNotMatch(html, /\.geometry-scene circle\{fill:#f8c95c/,
    'points must not be rendered as distracting yellow circles');
  assert.doesNotMatch(html, /scene\.background=new THREE\.Color\(0x0f2440\)/,
    'interactive geometry must not fall back to the dark navy stage');
});
