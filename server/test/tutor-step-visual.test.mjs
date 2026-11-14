import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');

async function loadEntitiesForStep() {
  const source = await readFile(path.join(root, 'implementation', 'tutor-step-visual.js'), 'utf8');
  const browser = {};
  const context = {
    window: browser,
    document: { createElement() { return {style: {}}; }, head: { appendChild() {} } },
    console,
  };
  vm.runInNewContext(
    source.replace('  function entitiesForStep(step, result) {', '  window.__entitiesForStep = entitiesForStep;\n  function entitiesForStep(step, result) {'),
    context
  );
  return browser.__entitiesForStep;
}

test('label 直接含点名（AC=6√2）时按点对高亮对应线段', async () => {
  const entitiesForStep = await loadEntitiesForStep();
  const result = {
    canonicalCoordinates: { A: [0, 0, 0], B: [0, 6, 0], C: [6, 0, 0] },
    scene: { elements: [
      {id: 'edge-ab', type: 'segment', points: ['A', 'B']},
      {id: 'edge-ac', type: 'segment', points: ['A', 'C']},
    ]},
  };
  const ids = Array.from(entitiesForStep({visual: {labels: [{text: 'AC', value: '6√2'}]}}, result));
  assert.deepEqual(ids, ['edge-ac']);
});

test('AB₁ 不会误命中 AB：下标点名按完整 token 匹配',async()=>{
  const entitiesForStep=await loadEntitiesForStep();
  const result={canonicalCoordinates:{A:[0,0,0],B:[2,0,0],B1:[2,0,2]},scene:{elements:[{id:'ab',type:'segment',points:['A','B']},{id:'ab1',type:'segment',points:['A','B1']}]}};
  assert.deepEqual(Array.from(entitiesForStep({visual:{labels:[{text:'AB₁',value:'2√2'}]}},result)),['ab1']);
});

test('label 只有量类型（半径=5 + entity 截面圆）时按值匹配截面圆', async () => {
  const entitiesForStep = await loadEntitiesForStep();
  const result = {
    canonicalCoordinates: {},
    scene: { elements: [
      {id: 'edge-ab', type: 'segment', points: ['A', 'B']},
      {id: 'section-1', type: 'section-circle', radius: 5},
      {id: 'section-2', type: 'section-circle', radius: 3},
    ]},
  };
  const ids = Array.from(entitiesForStep({visual: {labels: [{text: '半径', value: '5', entity: '截面圆'}]}}, result));
  assert.deepEqual(ids, ['section-1']);
});

test('内角没有实体映射时不随意高亮整类面', async () => {
  const entitiesForStep = await loadEntitiesForStep();
  const result = {
    canonicalCoordinates: {},
    scene: { elements: [{id: 'face-1', type: 'polyhedron-face', points: ['A', 'B', 'C']}]},
  };
  const ids = Array.from(entitiesForStep({visual: {labels: [{text: '内角', value: '60°'}]}}, result));
  assert.deepEqual(ids, []);
});

test('步骤文字没有点名、highlight 留空，也能靠 label 的值认到实体（求截面圆半径场景）', async () => {
  const entitiesForStep = await loadEntitiesForStep();
  const result = {
    canonicalCoordinates: { A: [0, 0, 0], B: [6, 0, 0] },
    scene: { elements: [
      {id: 'edge-ab', type: 'segment', points: ['A', 'B']},
      {id: 'section-1', type: 'section-circle', radius: 5},
    ]},
  };
  const step = {label: '求截面圆半径', goal: '用正弦定理求半径', visual: {highlight: [], focus: 'radius', labels: [{text: '半径', value: '5', entity: '截面圆'}]}};
  const ids = Array.from(entitiesForStep(step, result));
  assert.deepEqual(ids, ['section-1']);
});

test('步骤文字只提「高」没点名，靠 dimensions 的 points 认到高对应线段', async () => {
  const entitiesForStep = await loadEntitiesForStep();
  const result = {
    canonicalCoordinates: { A: [0, 0, 0], A1: [0, 0, 5], B: [1, 0, 0] },
    scene: {
      dimensions: [{id: 'height', points: ['A', 'A1'], label: '高 5 cm'}],
      elements: [
        {id: 'edge-aa1', type: 'segment', points: ['A', 'A1']},
        {id: 'edge-ab', type: 'segment', points: ['A', 'B']},
      ],
    },
  };
  const step = {label: '求棱柱的高', goal: '高是两底面间的距离'};
  const ids = Array.from(entitiesForStep(step, result));
  assert.ok(ids.includes('edge-aa1'), '应该高亮高对应的线段 A-A1，实际：' + JSON.stringify(ids));
});
