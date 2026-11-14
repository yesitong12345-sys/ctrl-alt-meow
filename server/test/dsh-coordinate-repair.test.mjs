// DSH: deterministic test for the "empty coordinates -> automatic follow-up" repair.
// Uses a fake fetch so the behaviour is proven without depending on model luck.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekGeometryCompilerAdapter, hasRenderableCoordinates} from '../workflows/geometry-trusted-pipeline.mjs';

/* 真实的失败形态：模型建好了点/线/小问，却把坐标留空，
   而且没有说明原因（不诚实省略）。这时才值得补问。 */
const emptyCandidate = () => ({
  schemaVersion: 'geometry-compile-response/v1',
  geometryIR: {
    schemaVersion: 'geometry-ir/v4',
    entities: [
      {id: 'A', kind: 'point'}, {id: 'B', kind: 'point'}, {id: 'C', kind: 'point'},
      {id: 'segment-AB', kind: 'segment', points: ['A', 'B']},
      {id: 'segment-BC', kind: 'segment', points: ['B', 'C']}
    ],
    explicitFacts: [{id: 'fact-1', summary: '三角形 ABC', evidenceRefs: [{id: 'ev-1', kind: 'text', quote: 'ABC'}]}],
    derivedFacts: [],
    constraints: [{id: 'c-1', kind: 'length', points: ['A', 'B'], value: 1, hard: true, factRefs: ['fact-1']}],
    queries: [{id: 'q-1', kind: 'length', target: {points: ['B', 'C']}}],
    evidence: [{id: 'ev-1', kind: 'text', quote: 'ABC'}]
  },
  sourceCoverage: [], unresolvedItems: [],
  candidateCoordinates: null,
  /* 合同要求：只要存在 query，就必须给出解题步骤和最终答案。
     这里的缺陷只是"没有坐标"，不是"没有解题"。 */
  solutionOutline: [{step: 1, text: '按已知长度建立坐标系'}],
  finalAnswer: {displayPlain: '待由坐标复核', latex: ''}
});

/* 反向用例：模型明确说明了为什么给不出坐标，属于诚实省略，不应再补问。 */
const explainedEmptyCandidate = () => ({
  ...emptyCandidate(),
  unresolvedItems: ['题目缺少真实尺度，无法确定唯一坐标']
});

const goodCandidate = () => ({
  schemaVersion: 'geometry-compile-response/v1',
  geometryIR: {
    schemaVersion: 'geometry-ir/v4',
    entities: [
      {id: 'A', kind: 'point'}, {id: 'B', kind: 'point'}, {id: 'C', kind: 'point'},
      {id: 'segment-AB', kind: 'segment', points: ['A', 'B']},
      {id: 'segment-BC', kind: 'segment', points: ['B', 'C']}
    ],
    explicitFacts: [{id: 'fact-1', summary: '三角形 ABC', evidenceRefs: [{id: 'ev-1', kind: 'text', quote: 'ABC'}]}],
    derivedFacts: [],
    constraints: [{id: 'c-1', kind: 'length', points: ['A', 'B'], value: 1, hard: true, factRefs: ['fact-1']}],
    queries: [{id: 'q-1', kind: 'length', target: {points: ['B', 'C']}}],
    evidence: [{id: 'ev-1', kind: 'text', quote: 'ABC'}]
  },
  sourceCoverage: [], unresolvedItems: [],
  candidateCoordinates: {A: [0, 0, 0], B: [1, 0, 0], C: [0, 1, 0]},
  subproblemVisualization: [{queryId: 'q-1', highlightEntities: ['B', 'C']}],
  solutionOutline: [{step: 1, text: '建系'}],
  finalAnswer: {displayPlain: '1', latex: '1'}
});

const jsonResponse = payload => ({
  ok: true, status: 200,
  headers: {get: () => null},
  json: async () => ({choices: [{message: {content: JSON.stringify(payload)}}]})
});

const context = {
  input: {questionText: '在三角形 ABC 中，AB=1，求 BC。', studentAnswer: ''},
  normalized: {inputHash: 'test-hash', semanticClauses: [], quantityMentions: [], parameterMentions: [], ratioMentions: [], structuralMentions: [], conditionAtoms: [], queryMentions: [], midpointMentions: [], relationMentions: [], optionQueries: [], imageHash: null},
  stageBudgetMs: 60000
};

test('空坐标会触发一次补问，并在补问成功后返回可用坐标', async () => {
  const calls = [];
  const adapter = createDeepSeekGeometryCompilerAdapter({
    endpoint: 'https://example.invalid/chat/completions',
    apiKey: 'test-key',
    model: 'test-model',
    maxAttempts: 1,
    timeoutMs: 30000,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      const text = body.messages[0].content[0].text;
      calls.push(text);
      // 第一次照常返回空坐标；补问（含“补问”标记）返回可用坐标。
      return jsonResponse(text.includes('【补问：坐标缺失，必须给出具体数值】') ? goodCandidate() : emptyCandidate());
    }
  });

  const result = await adapter(context);
  assert.equal(calls.length, 2, '应当只发两次请求：首次 + 一次补问');
  assert.ok(hasRenderableCoordinates(result), '补问后必须拿到可渲染坐标');
  assert.deepEqual(result.candidateCoordinates.B, [1, 0, 0]);
  assert.equal(result.coordinatesRepaired, true);
});

test('没有可渲染坐标时 hasRenderableCoordinates 判定为 false', () => {
  assert.equal(hasRenderableCoordinates(null), false);
  assert.equal(hasRenderableCoordinates({geometryIR: {}, candidateCoordinates: null}), false);
  assert.equal(hasRenderableCoordinates({geometryIR: {}, candidateCoordinates: {}}), false);
  assert.equal(hasRenderableCoordinates({geometryIR: {}, candidateCoordinates: {A: [0, 'x', 0]}}), false);
  assert.equal(hasRenderableCoordinates({geometryIR: {}, candidateCoordinates: {A: [0, 0, 0]}}), true);
});

test('模型明确说明缺少条件的空坐标不再重复追问', async () => {
  let calls = 0;
  const adapter = createDeepSeekGeometryCompilerAdapter({
    endpoint: 'https://example.invalid/chat/completions', apiKey: 'test-key', model: 'test-model',
    maxAttempts: 1, timeoutMs: 30000,
    fetchImpl: async () => { calls += 1; return jsonResponse(explainedEmptyCandidate()); }
  });
  const result = await adapter(context);
  assert.equal(calls, 1, '诚实省略只应调用一次模型');
  assert.equal(hasRenderableCoordinates(result), false);
});
