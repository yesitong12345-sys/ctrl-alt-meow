import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const {port} = server.address();
    server.close(() => resolve(port));
  });
});

const waitForHealth = async base => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('server did not become healthy');
};

test('真实上传直通展示 DeepSeek 候选坐标，标记为未验证参考并持久缓存且不重复调用模型', async t => {
  const modelPort = await reservePort();
  let modelCalls = 0;
  const candidate = {
    schemaVersion: 'geometry-compile-response/v1',
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [{id: 'A', kind: 'point'}, {id: 'B', kind: 'point'}, {id: 'AB', kind: 'segment', points: ['A', 'B']}],
      explicitFacts: [{id: 'f-ab', kind: 'quantity', name: 'AB', value: 3, evidenceRefs: ['ev-ab']}],
      derivedFacts: [],
      constraints: [{id: 'c-ab', kind: 'distance', points: ['A', 'B'], value: 3, hard: true, factRefs: ['f-ab']}],
      queries: [{id: 'q1', kind: 'construct', target: 'AB'}],
      evidence: [{id: 'ev-ab', kind: 'text', quote: 'AB=3'}]
    },
    solutionOutline: ['令 A 为原点，将 AB 放在 x 轴上。'],
    finalAnswer: {displayPlain: 'AB=3', latex: 'AB=3'},
    modelingParameters: {identifiability: 'representative'},
    coordinateSystem: {dimension: 3, handedness: 'right', canonical: true},
    candidateCoordinates: {A: [0, 0, 0], B: [3, 0, 0]},
    suggestedConstructions: [],
    visualFocus: ['AB'], highlightEntities: ['A', 'B'], annotations: [], constructionDisplayPlan: [],
    subproblemVisualization: [{id: 'q1-view', queryId: 'q1', label: '建立 AB 模型', highlightEntities: ['A', 'B'], annotationIds: []}],
    visibilitySequence: [{id: 'base', layers: ['base'], visible: true}, {id: 'focus-q1', layers: ['focus'], visible: true}],
    sourceCoverage: [{clauseId:'clause-1',status:'explicit_fact',refs:['f-ab']}],
    unresolvedItems: [],
    confidence: {overall: 0.98, ocr: 0.98}
  };
  const modelServer = http.createServer((req, res) => {
    modelCalls += 1;
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(candidate)}}]}));
  });
  await new Promise(resolve => modelServer.listen(modelPort, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => modelServer.close(resolve)));

  const appPort = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-trusted-geometry-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(appPort),
      DATA_FILE: path.join(tempDir, 'data.json'),
      MODEL_CONFIG_FILE: path.join(tempDir, 'model-config.json'),
      DEEPSEEK_API_KEY: 'sk-test-trusted-geometry',
      DEEPSEEK_ENDPOINT: `http://127.0.0.1:${modelPort}/chat/completions`
    },
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${appPort}`;
  await waitForHealth(base);

  const upload = async () => fetch(`${base}/v1/ingestions`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText: '已知 AB=3，建立一个空间模型。'})
  });
  const first = await upload();
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.mistakeCase.verificationStatus, 'ai_reference');
  assert.equal(firstBody.mistakeCase.geometryCompilation.executionPath, 'deepseek_direct_unreviewed');
  assert.equal(firstBody.mistakeCase.geometryResult.scene.schemaVersion, 'geometry-scene/v3');
  assert.equal(firstBody.geometryCompilation.status, 'ai_reference');
  assert.equal(firstBody.geometryCompilation.stage, 'completed');
  assert.equal(firstBody.geometryCompilation.validationReport.pass, false);
  assert.equal(firstBody.geometryCompilation.validationReport.skipped, true);
  assert.equal(firstBody.geometryCompilation.sceneSpec.schemaVersion, 'geometry-scene/v3');
  assert.equal(firstBody.geometryCompilation.solution.outline[0], '令 A 为原点，将 AB 放在 x 轴上。');

  const second = await upload();
  assert.equal(second.status, 201);
  const secondBody = await second.json();
  assert.equal(secondBody.mistakeCase.geometryCompilation.executionPath, 'persistent_cache');
  assert.equal(secondBody.geometryCompilation.cacheHit, true);
  assert.equal(modelCalls, 1);
});
