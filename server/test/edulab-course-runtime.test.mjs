import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateSkillCourse, skillCatalog} from '../workflows/edulab-course-runtime.mjs';

const serverDir = path.resolve(import.meta.dirname, '..');

test('解析几何课程在运行时调用原库 SymPy 生成器', async t => {
  const uiRoot = await mkdtemp(path.join(os.tmpdir(), 'edulab-runtime-'));
  t.after(() => rm(uiRoot, {recursive: true, force: true}));
  const result = await generateSkillCourse({kind: 'analytic', key: 'ellipse_dot_range', serverDir, uiRoot});
  assert.equal(result.exactKernel, true);
  const html = await readFile(path.join(uiRoot, result.url.replace(/^\/skills\//, 'skills/')), 'utf8');
  assert.match(html, /id="param-slider"/);
  assert.match(html, /id="geometry-canvas"/);
});

test('随机课程只能从原库注册表中选择并生成', async t => {
  const uiRoot = await mkdtemp(path.join(os.tmpdir(), 'edulab-random-'));
  t.after(() => rm(uiRoot, {recursive: true, force: true}));
  const result = await generateSkillCourse({kind: 'chemistry', seed: 7, serverDir, uiRoot});
  assert.ok(skillCatalog('chemistry').includes(result.key));
  const html = await readFile(path.join(uiRoot, result.url.replace(/^\/skills\//, 'skills/')), 'utf8');
  assert.match(html, /id="reaction-slider"/);
  assert.match(html, /原子守恒/);
});
