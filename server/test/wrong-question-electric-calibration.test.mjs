import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = await readFile(path.resolve(import.meta.dirname, '../../implementation/wrong-question-entry.js'), 'utf8');
const server = await readFile(path.resolve(import.meta.dirname, '../server.mjs'), 'utf8');

test('wrong-question electric panel includes editable V(x), Eₓ(x), and x(t) curves', () => {
  assert.match(source, /data-ef-mini-curve-v/);
  assert.match(source, /data-ef-mini-curve-e/);
  assert.match(source, /data-ef-mini-curve-t/);
});

test('finishing calibration locks the model and saves the confirmed state', () => {
  assert.match(source, /dataset\.efMiniCalibrationComplete/);
  assert.match(source, /calibrationLocked/);
  assert.match(source, /完成调制/);
});

test('confirmed calibration collapses to the field canvas while charges remain draggable', () => {
  assert.match(source, /scene\.style\.pointerEvents='auto'/);
  assert.match(source, /scene\.onpointerdown=e=>\{e\.preventDefault\(\)/);
  assert.match(source, /saveElectricModel\(record,\{\.\.\.model,simulation:sim\}\)/);
  assert.match(source, /calibration-locked \.ef-mini-controls/);
  assert.match(source, /calibration-locked \.ef-mini-visual canvas\{height:260px\}/);
});

test('verbose graph interpretation and physics explanation are omitted from mistake cards', () => {
  assert.doesNotMatch(source, /data-ef-mini-analysis/);
  assert.doesNotMatch(source, /explanation\.className='ef-case-principle'/);
  assert.match(source, /card\.append\(panel\)/);
});

test('server persists the three calibrated curves and lock state with the wrong question', () => {
  assert.match(server, /safeProfile\('adjustedPotentialCurve'\)/);
  assert.match(server, /safeProfile\('adjustedFieldCurve'\)/);
  assert.match(server, /typeof incoming\.calibrationLocked==='boolean'/);
});

test('electric model canvases initialize with the mistake card instead of waiting for viewport entry', () => {
  assert.doesNotMatch(source, /__efMiniCanvasObserver/);
  assert.match(source, /root\.isConnected\)drawElectricMini\(root,record,model\)/);
});

test('electric panel occupies the mistake model area and is attached to the saved question', () => {
  assert.match(source, /panel\.className='geometry-scene ef-case-panel'/);
  assert.match(source, /card\.append\(panel\)/);
  assert.match(source, /saveElectricModel\(record,\{\.\.\.model,simulation:sim\}\)/);
  assert.match(source, /v1\/mistake-cases\/.*electric-field-model/);
  assert.match(source, /drafts\/'.*\/confirm/);
  assert.match(source, /state\.mistakes=\[m,/);
});

test('mistake electric panel reuses the lab dipole with independently editable point charges', () => {
  assert.match(source, /charges:\[\{x:-1\.15,y:0,q:1\},\{x:1\.15,y:0,q:-1\}\]/);
  assert.match(source, /sim\.charges\.reduce\(\(field,charge\)/);
  assert.match(source, /data-ef-source-add="-1"/);
  assert.match(source, /dragSourceIndex=sim\.mode==='points'/);
  assert.match(source, /本题电场实验台/);
  assert.match(server, /safeCharges/);
});

test('space geometry is not generated unless selected; focused question offers a small manual CTA', () => {
  assert.match(source, /intake\.model3dPreferenceVersion !== 2\) \{ intake\.model3d=false/);
  assert.match(source, /shouldBuild3d=.*&&intake\.model3d&&/);
  assert.match(source, /className='wq-model-cta'/);
  assert.match(source, /retry\.textContent=.*'生成 3D 模型'/);
});

test('student explicitly confirms calibration before the saved model is locked', () => {
  assert.match(source, /确定完成调制/);
  assert.match(source, /setStatus\('已完成调制并保存/);
});
