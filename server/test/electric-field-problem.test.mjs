import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {compileElectricFieldProblem} from '../workflows/electric-field-problem.mjs';

test('a parallel-plate problem compiles to a safe prefilled uniform-field bench', () => {
  const result=compileElectricFieldProblem('两平行金属板相距 d=2cm，电压 U=100V，板间有带正电粒子从左向右以初速度 v0 进入，忽略边缘效应。');
  assert.equal(result.status,'ready_for_confirmation');
  assert.equal(result.spec.source.kind,'parallel_plates');
  assert.equal(result.bench.mode,'uniform');
  assert.equal(result.bench.showMotion,true);
  assert.match(result.confirmation.join(' '),/电场方向/);
});

test('a labelled potential curve stays a reviewable candidate instead of becoming a claimed exact field', () => {
  const result=compileElectricFieldProblem('如图为电势 V 随 x 变化的曲线，图中未标明横纵坐标刻度，求电场方向。');
  assert.equal(result.status,'needs_curve_confirmation');
  assert.equal(result.spec.graph.kind,'potential_position');
  assert.equal(result.bench.profileV,null);
  assert.match(result.notice,/不能用于精确读数/);
});

test('opposite point charges compile to the point-charge bench', () => {
  const result=compileElectricFieldProblem('在 x 轴上相距 2m 的 A、B 两点分别固定 +Q 和 -Q 两个点电荷。');
  assert.equal(result.status,'ready_for_confirmation');
  assert.equal(result.bench.mode,'points');
  assert.equal(result.bench.charges.length,2);
  assert.ok(result.bench.charges.some(item=>item.q>0));
  assert.ok(result.bench.charges.some(item=>item.q<0));
});

test('the learner can interact with an inline electric-field model from the mistake library', async () => {
  const root=path.resolve(import.meta.dirname,'..','..','implementation');
  const lab=await readFile(path.join(root,'electric-field-lab.js'),'utf8');
  const intake=await readFile(path.join(root,'wrong-question-entry.js'),'utf8');
  assert.match(lab,/\/v1\/electric-field\/compile/);
  assert.match(lab,/__openElectricProblem/);
  assert.match(lab,/window\.__eduMountElectricLab = function/);
  assert.match(intake,/data-ef-mini-root/);
  assert.match(intake,/__eduMountElectricLab/);
  assert.match(intake,/data-ef-case-lab/);
});
