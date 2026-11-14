import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {solveConfirmedGeometry} from '../workflows/deterministic-geometry-solver.mjs';

const pythonBin = process.env.PYTHON_BIN || path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
);

const goldenRequest = {
  schemaVersion: 'geometry-ir/v1',
  caseId: 'case-pyramid-001',
  revision: 1,
  lockedTemplate: {templateId: 'regular-quad-pyramid-be-pac', version: 1},
  problem: {language: 'zh-CN', questionText: '正四棱锥黄金题'},
  entities: [
    {id: 'body1', type: 'body', bodyType: 'regular_quad_pyramid', apex: 'P', baseVertices: ['A', 'B', 'C', 'D'], lockedByTemplate: true},
    ...['P', 'A', 'B', 'C', 'D', 'E'].map(id => ({id, type: 'point'})),
    {id: 'BE', type: 'segment', points: ['B', 'E'], lockedByTemplate: true},
    {id: 'PAC', type: 'plane', points: ['P', 'A', 'C'], lockedByTemplate: true}
  ],
  relations: [
    {id: 'r-base', type: 'base_edge', args: {body: 'body1', value: {op: 'integer', value: 2}}, confirmationStatus: 'confirmed', valueOrigin: 'manual_correction', evidenceRegion: null},
    {id: 'r-height', type: 'height', args: {body: 'body1', value: {op: 'integer', value: 1}}, confirmationStatus: 'confirmed', valueOrigin: 'manual_correction', evidenceRegion: null},
    {id: 'r-mid', type: 'midpoint', args: {point: 'E', endpoints: ['P', 'C'], resultRole: 'midpointPC'}, confirmationStatus: 'confirmed', valueOrigin: 'fixture', lockedByTemplate: true, evidenceRegion: null}
  ],
  query: {type: 'line_plane_angle_sin', line: 'BE', plane: 'PAC', lockedByTemplate: true}
};

test('已确认的黄金题通过 Node→Python seam 返回 verified 结果', async () => {
  const result = await solveConfirmedGeometry(goldenRequest, {pythonBin});

  assert.equal(result.solverStatus, 'verified');
  assert.equal(result.answer.displayPlain, '2√22/11');
  assert.equal(result.scene.frameEdges.length, 8);
  assert.deepEqual(result.scene.grid, {
    unit: 1,
    size: 4,
    divisions: 4,
    plane: 'z=0',
    valueSource: 'canonicalCoordinates',
    alignment: 'base_edge_xy'
  });
  assert.deepEqual(result.scene.dimensions.map(item => ({id: item.id, label: item.label, source: item.valueSource})), [
    {id: 'base-edge', label: '底边 a = 2', source: 'relations.r-base.args.value'},
    {id: 'height', label: '高 h = 1', source: 'relations.r-height.args.value'}
  ]);
  // A side of length 2 must sit on two unit grid intervals, not on a
  // diagonal whose projected length is visually ambiguous to a student.
  assert.deepEqual(result.canonicalCoordinates.A, [
    {op: 'integer', value: -1}, {op: 'integer', value: -1}, {op: 'integer', value: 0}
  ]);
  assert.deepEqual(result.canonicalCoordinates.B, [
    {op: 'integer', value: 1}, {op: 'integer', value: -1}, {op: 'integer', value: 0}
  ]);
  assert.equal(result.scene.pedagogy.schemaVersion, 'pedagogical-visualization/v3');
  assert.ok(result.scene.pedagogy.emphasis.lines.some(item => item.kind === 'line' && item.entityRefs.join('-') === 'B-E'));
  assert.ok(result.scene.pedagogy.emphasis.faces.some(item => item.kind === 'plane' && item.entityRefs.join('-') === 'P-A-C'));
});

test('不同查询结构不会被错误派发到黄金题 adapter', async () => {
  const request = structuredClone(goldenRequest);
  request.entities.find(entity => entity.id === 'BE').points = ['A', 'E'];

  const result = await solveConfirmedGeometry(request, {pythonBin});

  assert.equal(result.solverStatus, 'unsupported');
  assert.equal('answer' in result, false);
});

test('CLI 超时会终止求解且不泄露部分答案', async () => {
  const result = await solveConfirmedGeometry(goldenRequest, {pythonBin, timeoutMs: 1, retry: false});

  assert.equal(result.solverStatus, 'solver_failed');
  assert.equal(result.failureCode, 'SOLVER_TIMEOUT');
  assert.equal('answer' in result, false);
});

test('unit grid and nearby dimensions are generated from the submitted geometry IR', async () => {
  const request = structuredClone(goldenRequest);
  request.relations.find(relation => relation.id === 'r-base').args.value = {op: 'integer', value: 10};
  request.relations.find(relation => relation.id === 'r-height').args.value = {op: 'integer', value: 7};

  const result = await solveConfirmedGeometry(request, {pythonBin});

  assert.equal(result.solverStatus, 'verified');
  assert.deepEqual(result.scene.grid, {
    unit: 1,
    size: 12,
    divisions: 12,
    plane: 'z=0',
    valueSource: 'canonicalCoordinates',
    alignment: 'base_edge_xy'
  });
  assert.deepEqual(result.scene.dimensions.map(item => ({id: item.id, points: item.points, label: item.label})), [
    {id: 'base-edge', points: ['A', 'B'], label: '底边 a = 10'},
    {id: 'height', points: ['P', 'O'], label: '高 h = 7'}
  ]);
});
