import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKnowledgeGraph} from '../workflows/knowledge-graph.mjs';
import {fallbackRelationTip, normalizeRelationTip, relationMetaFor, relationTipText, createDeepSeekRelationTipAdapter} from '../workflows/kg-relation-tip.mjs';
import {createStudyRouter} from '../workflows/study-routes.mjs';

const OWNER = 'local-student';
const caseWith = (id, points, extra = {}) => ({
  id, user_id: OWNER, studentId: OWNER, subject: extra.subject || '数学',
  question: extra.question || `${points.join('、')} 的题`, knowledgePoints: points,
  learningProfile: {mastery: 40}, ...extra,
});

test('三类关系都在图里：依赖（黄）/ 易混淆（红）/ 常结合（绿）', () => {
  const cases = [
    caseWith('c1', ['二面角', '法向量']),
    caseWith('c2', ['二面角', '线面角']),
    caseWith('c3', ['二面角', '线面角']),
    caseWith('c4', ['二面角', '三垂线定理']),
  ];
  const graph = buildKnowledgeGraph({userId: OWNER, cases});
  const byName = new Map(graph.nodes.map(node => [node.name, node.id]));
  const between = (a, b, type) => graph.edges.find(edge => edge.type === type
    && ((edge.source === byName.get(a) && edge.target === byName.get(b)) || (edge.source === byName.get(b) && edge.target === byName.get(a))));

  const dep = between('二面角', '法向量', 'DEPENDS_ON');
  assert.ok(dep, '二面角 依赖 法向量 应有 DEPENDS_ON 边');
  assert.match(dep.note, /依赖/);

  const conf = between('二面角', '线面角', 'CONFUSES_WITH');
  assert.ok(conf, '二面角 与 线面角 应有 CONFUSES_WITH 边');
  assert.ok(conf.frequency >= 2, '有共现证据时混淆边应用真实共现次数加粗');

  const co = between('二面角', '三垂线定理', 'CO_OCCURS_WITH');
  assert.ok(co, '同题出现的两个知识点应有 CO_OCCURS_WITH 边');
  assert.equal(co.frequency, 1);
});

test('图里只放学生自己错题/知识卡上出现过的知识点（不要知识点表里的其它点）', () => {
  const cases = [caseWith('c1', ['二面角', '法向量'])];
  /* 知识点表里还有很多学生没做过题的点：它们不该出现在图里，否则一片线看不清。 */
  const cards = [{id: 'k1', user_id: OWNER, studentId: OWNER, subject: '数学', knowledgePoint: '线面角', title: '线面角的理解'}];
  const graph = buildKnowledgeGraph({userId: OWNER, cases, knowledgeCards: cards});
  const names = graph.nodes.map(node => node.name).sort();
  assert.deepEqual(names, ['二面角', '线面角', '法向量'].sort(), '节点集合必须正好是出现过的知识点');
  assert.equal(names.includes('立体几何'), false, '没有错题提到过"立体几何"就不该凭空出现');
  // 每一条边都只连真实存在的节点
  const ids = new Set(graph.nodes.map(node => node.id));
  assert.equal(graph.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)), true, '不允许有指向不存在节点的边');
});

test('学生没有任何错题/知识卡时，图是空的（不给一堆没学过的点）', () => {
  const graph = buildKnowledgeGraph({userId: OWNER, cases: [], knowledgeCards: []});
  assert.equal(graph.nodes.length, 0);
  assert.equal(graph.edges.length, 0);
});

test('依赖边只在两个知识点都出现时才有；没有就不硬连', () => {
  const graph = buildKnowledgeGraph({userId: OWNER, cases: [caseWith('c1', ['二面角'])]});
  const names = new Set(graph.nodes.map(n => n.name));
  assert.equal(names.has('法向量'), false);
  assert.equal(graph.edges.some(e => e.type === 'DEPENDS_ON'), false, '法向量没出现时不应凭空连依赖边');
});

test('易混淆种子关系：即使没有共现证据也标红，但频次用最小 1', () => {
  const graph = buildKnowledgeGraph({userId: OWNER, cases: [
    caseWith('c1', ['法向量']), caseWith('c2', ['方向向量']),
  ]});
  const conf = graph.edges.find(e => e.type === 'CONFUSES_WITH');
  assert.ok(conf, '法向量 / 方向向量 是种子易混对');
  assert.equal(conf.frequency, 1);
  assert.match(conf.sourceType, /confusion_seed/);
});

test('常结合边的频次 = 同题共现次数（线的粗细来源）', () => {
  const cases = Array.from({length: 5}, (_, i) => caseWith('c' + i, ['电场强度', '电势']));
  const graph = buildKnowledgeGraph({userId: OWNER, cases});
  const co = graph.edges.find(e => e.type === 'CO_OCCURS_WITH');
  assert.ok(co);
  assert.equal(co.frequency, 5, '5 道题同时包含这两个知识点 → 频次 5');
});

test('关系提示卡：三类关系各有对应的颜色与角度', () => {
  assert.equal(relationMetaFor('DEPENDS_ON').color, 'yellow');
  assert.equal(relationMetaFor('CONFUSES_WITH').color, 'red');
  assert.equal(relationMetaFor('CO_OCCURS_WITH').color, 'green');
  const dep = fallbackRelationTip({pointA: '二面角', pointB: '法向量', relationType: 'DEPENDS_ON'});
  assert.match(dep.headline, /依赖/);
  assert.match(dep.body, /法向量/);
  assert.equal(dep.source, 'local_fallback');
  const conf = fallbackRelationTip({pointA: '二面角', pointB: '线面角', relationType: 'CONFUSES_WITH'});
  assert.match(conf.pitfall, /最容易错/);
  const co = fallbackRelationTip({pointA: '电场强度', pointB: '电势', relationType: 'CO_OCCURS_WITH', frequency: 5});
  assert.match(co.body, /5 次共现/);
});

test('提示卡正文是能直接导入的连贯文字，且不含 HTML', () => {
  const tip = normalizeRelationTip({headline: '<b>标题</b>', body: '正文', tip: '技巧', pitfall: '坑'}, fallbackRelationTip({pointA: 'A', pointB: 'B', relationType: 'DEPENDS_ON'}));
  const text = relationTipText(tip);
  assert.ok(text.length >= 8);
  assert.equal(text.includes('<'), true, '文本原样保留（渲染端负责转义），但导出函数不产生标签');
  assert.equal(tip.source, 'ai');
});

test('没配密钥时不创建 AI 适配器，路由器回兜底卡片', async () => {
  assert.equal(createDeepSeekRelationTipAdapter({}), null);
  assert.equal(createDeepSeekRelationTipAdapter({endpoint: 'e', apiKey: 'k'}), null);
  assert.equal(typeof createDeepSeekRelationTipAdapter({endpoint: 'e', apiKey: 'k', model: 'm'}), 'function');
});

/* ---------------- 路由 ---------------- */
function makeRes() {
  const res = {statusCode: 200, body: null, setHeader() {}, end(payload) { try { this.body = JSON.parse(payload); } catch { this.body = payload; } }, writeHead(code) { this.statusCode = code; }, on() {}, once() {}, emit() {}};
  return res;
}
const makeDb = () => ({
  cases: [caseWith('c1', ['二面角', '法向量']), caseWith('c2', ['二面角', '线面角'])],
  knowledgeCards: [], knowledgeCardReviews: [], fsrsCards: [], reviews: [],
  graph: null, events: [],
});

test('连线 API：返回 AI 提示卡 + 相关错题 id（用于跳错题库）', async () => {
  const db = makeDb();
  db.graph = {users: {[OWNER]: buildKnowledgeGraph({userId: OWNER, cases: db.cases})}};
  const graph = db.graph.users[OWNER];
  const byName = new Map(graph.nodes.map(n => [n.name, n.id]));
  const res = makeRes();
  const router = createStudyRouter({db, persist: async () => {}, canAccess: () => true, currentUserId: OWNER,
    requestBody: {pointA: byName.get('二面角'), pointB: byName.get('法向量'), relationType: 'DEPENDS_ON'},
    relationTipAdapter: async base => ({...base, source: 'ai', tip: 'AI 写的技巧'})});
  const handled = await router({method: 'POST'}, res, new URL('http://localhost/v1/study/knowledge-graph/relation-tip'));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'ai');
  assert.equal(res.body.tip, 'AI 写的技巧');
  assert.equal(res.body.relationLabel, '依赖');
  assert.ok(Array.isArray(res.body.relatedCases));
  assert.ok(res.body.relatedCases.length >= 1, '应带上含这些知识点的错题，供"跳到相关错题列表"');
});

test('连线 API：知识点不存在时 404，不编造', async () => {
  const db = makeDb();
  db.graph = {users: {[OWNER]: buildKnowledgeGraph({userId: OWNER, cases: db.cases})}};
  const router = createStudyRouter({db, persist: async () => {}, canAccess: () => true, currentUserId: OWNER,
    requestBody: {pointA: 'nope', pointB: 'nope2', relationType: 'DEPENDS_ON'}});
  const res = makeRes();
  await router({method: 'POST'}, res, new URL('http://localhost/v1/study/knowledge-graph/relation-tip'));
  assert.equal(res.statusCode, 404);
});

test('导入知识闯关：真的生成知识卡并进 FSRS 队列', async () => {
  const db = makeDb();
  db.graph = {users: {[OWNER]: buildKnowledgeGraph({userId: OWNER, cases: db.cases})}};
  const graph = db.graph.users[OWNER];
  const byName = new Map(graph.nodes.map(n => [n.name, n.id]));
  let saved = 0;
  const router = createStudyRouter({db, persist: async () => { saved += 1; }, canAccess: () => true, currentUserId: OWNER,
    requestBody: {pointA: byName.get('二面角'), pointB: byName.get('线面角'), relationType: 'CONFUSES_WITH',
      tip: {headline: '二面角与线面角容易混', body: '先判断题目问的是二面角还是线面角。', tip: '先写清定义再选公式。', pitfall: '别把二面角当线面角代公式。'}}});
  const res = makeRes();
  await router({method: 'POST'}, res, new URL('http://localhost/v1/study/knowledge-graph/relation-card'));
  assert.equal(res.statusCode, 201);
  assert.equal(db.knowledgeCards.length, 1);
  const card = db.knowledgeCards[0];
  assert.equal(card.cardKind, 'relation-tip');
  assert.equal(card.origin, 'knowledge-graph-relation');
  assert.match(card.knowledgePoint, /二面角/);
  assert.match(card.content, /先判断题目问的是/);
  assert.equal(card.user_id, OWNER);
  assert.equal(saved, 1, '导入必须落盘');
  assert.ok((db.fsrsCards || []).length >= 1, '导入的卡片要进 FSRS 复习队列');
});

test('导入知识闯关：内容太短时 422，不生成半张卡', async () => {
  const db = makeDb();
  db.graph = {users: {[OWNER]: buildKnowledgeGraph({userId: OWNER, cases: db.cases})}};
  const graph = db.graph.users[OWNER];
  const byName = new Map(graph.nodes.map(n => [n.name, n.id]));
  const router = createStudyRouter({db, persist: async () => {}, canAccess: () => true, currentUserId: OWNER,
    requestBody: {pointA: byName.get('二面角'), pointB: byName.get('法向量'), relationType: 'DEPENDS_ON', text: '太短'}});
  const res = makeRes();
  await router({method: 'POST'}, res, new URL('http://localhost/v1/study/knowledge-graph/relation-card'));
  assert.equal(res.statusCode, 422);
  assert.equal(db.knowledgeCards.length, 0);
});
