import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {generateVerifiedRandomGeometry, isCleanExactGeometryAnswer} from '../workflows/geometry-random-registry.mjs';

const pythonBin = process.env.PYTHON_BIN || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');

test('连续四个种子覆盖四棱锥、圆柱、圆锥和球且全部通过统一 IR', async () => {
  const results = [];
  for (const seed of [0, 1, 2, 3]) results.push(await generateVerifiedRandomGeometry(seed, {pythonBin}));
  assert.deepEqual(results.map(item => item.modelKind).sort(), ['cone', 'cylinder', 'pyramid', 'sphere']);
  for (const item of results) {
    assert.equal(item.status, 'verified');
    assert.equal(item.problemIR.schemaVersion, 'geometry-ir/v3.0');
    assert.equal(item.problemIR.stage, 'verified');
    assert.equal(item.problemIR.verification.status, 'verified');
    assert.ok(item.result.scene.elements.length > 0);
    assert.equal(item.randomization.clean, true);
  }
});

test('规整答案按 exact AST 判断，首个候选不合格时会真实重掷', async () => {
  assert.equal(isCleanExactGeometryAnswer({op:'sqrt',arg:{op:'integer',value:2}}),true);
  assert.equal(isCleanExactGeometryAnswer({op:'decimal',value:1.4}),false);
  const result=await generateVerifiedRandomGeometry(1,{acceptAnswer:(_answer,{attempt})=>attempt>0});
  assert.equal(result.status,'verified');
  assert.equal(result.randomization.attempts,2);
  assert.equal(result.randomization.rejectedCount,1);
});
