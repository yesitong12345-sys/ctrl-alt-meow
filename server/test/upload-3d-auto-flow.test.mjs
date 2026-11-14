import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('选中 3D 后确认入库自动建模，错题库重试按钮直接重建而不绕回录入页', async () => {
  const entry = await readFile(new URL('../../implementation/wrong-question-entry.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../../implementation/index.html', import.meta.url), 'utf8');

  assert.match(entry, /intake\.model3d=Boolean\(document\.querySelector\('#wq-model3d'\)\?\.checked\)/);
  assert.match(entry, /shouldBuild3d=String\(subject\|\|''\)\.trim\(\)\.startsWith\('数学'\)&&intake\.model3d/);
  assert.match(entry, /ensureGeometryModel\(m\.id,question\)/);
  assert.match(entry, /geometryBuildStatus='building'/);
  assert.match(entry, /data-retry-geometry/);
  assert.match(entry, /retry\.onclick=\(\)=>ensureGeometryModel\(focused\.id,focused\.question\)/);
  assert.doesNotMatch(entry, /retry\.onclick=\(\)=>\{intake\.mode='text'/);
  assert.match(entry, /几何模型生成中|重试生成 3D 模型/);
});
