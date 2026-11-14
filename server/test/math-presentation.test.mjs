import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');

test('bare LaTeX emitted in tutor feedback is converted into readable math spans', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  assert.match(html, /wrapBareLatex\(/, 'the live renderer must normalize undelimited LaTeX');
  assert.match(html, /<script src="\.\/math-display\.js"><\/script>/, 'the formatter must load before the app renderer');
  const helper = await readFile(path.join(root, 'implementation', 'math-display.js'), 'utf8');
  const window = {};
  vm.runInNewContext(helper, {window});
  const sample = '中点坐标公式：若 𝑃 ( P(x_{1} , ,y_{1} , ,z_{1} ) )、𝑄 ( Q(x_{2},y_{2},z_{2}) )，则中点为 \\frac{x_{1}+x_{2}}{2},\\frac{y_{1}+y_{2}}{2},\\frac{z_{1}+z_{2}}{2}。已有 A(0,0,0)。';
  const formatted = window.EduMathDisplay.wrapBareLatex(sample);
  assert.match(formatted, /\$P\(x_\{1\},y_\{1\},z_\{1\}\)\$/);
  assert.doesNotMatch(formatted, /𝑃\s*\(\s*P\(/, '模型重复输出的点名应合并');
  assert.match(formatted, /\$\\frac\{x_\{1\}\+x_\{2\}\}\{2\},\\frac\{y_\{1\}\+y_\{2\}\}\{2\},\\frac\{z_\{1\}\+z_\{2\}\}\{2\}\$/);
  assert.match(formatted, /已有 A\(0,0,0\)。/);
  assert.equal(window.EduMathDisplay.wrapBareLatex('显式公式 $OM$ 保持原样。'), '显式公式 $OM$ 保持原样。');
  assert.equal(window.EduMathDisplay.wrapBareLatex('不完整的 \\frac{x+1'), '不完整的 \\frac{x+1', '遇到坏公式要保留原文，不能吞字');
});

test('knowledge-card text entry provides a live formatted preview without replacing editable source', async () => {
  const cards = await readFile(path.join(root, 'implementation', 'knowledge-cards.js'), 'utf8');
  assert.match(cards, /data-kc-front-preview[\s\S]*data-kc-preview-body/);
  assert.match(cards, /data-kc-back-preview[\s\S]*data-kc-preview-body/);
  assert.match(cards, /function updatePreview\(field,node\)[\s\S]*body\.textContent\s*=\s*window\.EduMathDisplay/);
  assert.match(cards, /front\.oninput=function\(\)[\s\S]*ui\.newFrontText=front\.value/);
  assert.match(cards, /back\.oninput=function\(\)[\s\S]*ui\.newBackText=back\.value/);
  assert.match(cards, /EduMathDisplay\?\.wrapBareLatex/);
});

test('server exposes the formatter referenced by the page', async () => {
  const server = await readFile(path.join(root, 'server', 'server.mjs'), 'utf8');
  assert.match(server, /url\.pathname\s*===\s*'\/math-display\.js'[\s\S]{0,100}sendStatic\(res,\s*'math-display\.js'/);
});
