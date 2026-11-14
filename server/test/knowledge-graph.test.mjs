import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKnowledgeGraph, rebuildKnowledgeGraphs, graphForUser} from '../workflows/knowledge-graph.mjs';
import {findModelCache, modelCacheHash, normalizeModelQuestion, rememberModel} from '../workflows/model-cache.mjs';
import {buildHeatmap, knowledgePointOf, subjectOf} from '../workflows/learning-summary.mjs';

test('knowledge graph counts same-question co-occurrence and does not mix users', () => {
  const cases = [
    {id:'a1', user_id:'alice', subject:'数学', question:'Q1', knowledgePoints:['法向量','二面角']},
    {id:'a2', user_id:'alice', subject:'数学', question:'Q2', knowledgePoints:['法向量','二面角']},
    {id:'b1', user_id:'bob', subject:'数学', question:'Q3', knowledgePoints:['法向量','线面角']}
  ];
  const alice = buildKnowledgeGraph({userId:'alice', cases});
  assert.equal(alice.nodes.length, 2);
  assert.equal(alice.coOccurrences[0].frequency, 2);
  assert.ok(alice.edges.some(edge => edge.type === 'CONFUSES_WITH'));
  assert.ok(alice.edges.some(edge => edge.type === 'DEPENDS_ON'));
  const graphs = rebuildKnowledgeGraphs({cases, knowledgeCards:[], knowledgeCardReviews:[], users:[]});
  assert.equal(graphForUser(graphs, 'bob').nodes.some(node => node.name === '二面角'), false);
});

test('knowledge graph contains the same fallback weak points and normalized subjects as the heatmap', () => {
  const cases = [{id:'fallback', user_id:'alice', subject:'数学·几何', unit:'线面角', knowledgePoints:[], origin:'demo_seed'}];
  const heatmap = buildHeatmap({cases, now:new Date('2026-09-26T00:00:00Z')});
  const graph = buildKnowledgeGraph({userId:'alice', cases});
  const heatmapPoint = heatmap[0];
  assert.ok(heatmapPoint, 'the test fixture must produce a heatmap weak point');
  assert.ok(graph.nodes.some(node => node.name === heatmapPoint.knowledgePoint && node.subject === heatmapPoint.subject),
    'every heatmap weak point should have a graph node with the same canonical subject');
  assert.equal(knowledgePointOf(cases[0]), heatmapPoint.knowledgePoint);
  assert.equal(subjectOf(cases[0]), heatmapPoint.subject);
});

test('math knowledge graph relates solid-geometry concepts through real evidence, not semantic neighbours', () => {
  /* 同题出现 → 常结合；种子里已知的先修对 → 依赖。
     以前这里靠"同族语义"补 RELATED_TO 边，数量和真实关系一样多，图上一片线看不清，
     已按用户要求去掉；这条测试改为断言两类真实关系。 */
  const graph = buildKnowledgeGraph({userId:'alice', cases:[{
    id:'solid-a', user_id:'alice', subject:'数学',
    knowledgePoints:['二面角','法向量','点到平面的距离']
  }]});
  const byName = new Map(graph.nodes.map(node => [node.name, node.id]));
  const has = (a, b, type) => graph.edges.some(edge => edge.type === type &&
    ((edge.source === byName.get(a) && edge.target === byName.get(b)) || (edge.source === byName.get(b) && edge.target === byName.get(a))));
  assert.equal(graph.edges.some(edge => edge.type === 'RELATED_TO'), false, '不再生成同族语义边');
  assert.ok(has('二面角', '法向量', 'CO_OCCURS_WITH'), '同题出现的两个知识点要有常结合边');
  assert.ok(has('二面角', '法向量', 'DEPENDS_ON'), '种子里二面角依赖法向量');
  assert.ok(has('二面角', '点到平面的距离', 'CO_OCCURS_WITH'), '二面角与点到平面距离同题共现');
  // 学生错题里出现过的点必须都在，哪怕暂时没连上关系
  assert.equal(graph.nodes.length, 3, '错题里的三个知识点都应出现');
});

test('model cache canonicalizes symbols and returns exact-hash reusable scene metadata', () => {
  assert.equal(normalizeModelQuestion(' 线面角 ∠ABC − 30° ', '数学').text, '线面角角abc-30度');
  assert.equal(modelCacheHash(' A − B ', '数学'), modelCacheHash('A-B', '数学'));
  const cache = [];
  const first = rememberModel(cache, {question:'斜面上质量为 m 的物体', subject:'物理', scene:{type:'incline'}});
  assert.equal(first.reuse_count, 0);
  assert.equal(findModelCache(cache, '斜面上质量为 m 的物体', '物理').scene.type, 'incline');
});
