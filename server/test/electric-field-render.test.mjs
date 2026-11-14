import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');

async function loadDraw(showLines = true, mode = 'points', showPotential = false) {
  const source = await readFile(path.join(root, 'implementation', 'electric-field-lab.js'), 'utf8');
  const browser = {
    __registerElectricFieldLab() {},
    addEventListener() {},
    devicePixelRatio: 1,
  };
  const context = {
    window: browser,
    document: { head: { insertAdjacentHTML() {} } },
    localStorage: { getItem: () => JSON.stringify({ showLines, mode, showPotential }) },
    URLSearchParams,
    location: { search: '' },
    console,
  };
  // Expose the real private renderer only inside this test VM; production API stays unchanged.
  vm.runInNewContext(source.replace('  function draw(canvas, fast = false) {', '  window.__drawForTest = draw;\n  function draw(canvas, fast = false) {'), context);
  return browser.__drawForTest;
}

function recordingCanvas() {
  const strokes = [];
  const ctx = new Proxy({
    stroke() { strokes.push(this.strokeStyle); },
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    fillText() {}, arc() {}, fill() {}, closePath() {}, save() {}, restore() {}, setLineDash() {},
  }, { get(target, key) { return target[key] ?? 0; }, set(target, key, value) { target[key] = value; return true; } });
  return { strokes, canvas: { dataset: {}, getContext: () => ctx, getBoundingClientRect: () => ({ width: 600, height: 500 }), set width(_) {}, set height(_) {} } };
}

test('point-charge canvas draws visible electric field lines when enabled', async () => {
  const draw = await loadDraw(true, 'points');
  const { canvas, strokes } = recordingCanvas();
  draw(canvas);
  assert.ok(strokes.filter(style => String(style).startsWith('#3d74dd')).length >= 8,
    'expected the dipole field-line strokes, not just grid/axes');
});

test('drag rendering skips expensive potential contours and samples fewer field-line steps', async () => {
  const draw=await loadDraw(true,'points',true);
  const normal=recordingCanvas(),fast=recordingCanvas();
  draw(normal.canvas,false);
  draw(fast.canvas,true);
  assert.ok(normal.strokes.includes('#d88941aa'),'normal frame should retain the potential contours');
  assert.ok(!fast.strokes.includes('#d88941aa'),'drag frame should omit expensive potential contours');
  assert.ok(fast.strokes.length<normal.strokes.length,'drag frame should do less drawing work');
});

test('field canvas has an always-visible toggle that restores the saved line layer', async () => {
  const source = await readFile(path.join(root, 'implementation', 'electric-field-lab.js'), 'utf8');
  assert.match(source, /className='ef-lines-toggle'/);
  assert.match(source, /state\.showLines=!state\.showLines/);
  assert.match(source, /checkbox\.checked=state\.showLines;persist\(\);repaint\(\)/);
});
