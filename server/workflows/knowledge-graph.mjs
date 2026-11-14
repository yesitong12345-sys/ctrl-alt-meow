import {createHash} from 'node:crypto';
import {knowledgePointOf, subjectOf} from './learning-summary.mjs';

/*
 * 知识网络的边分三类，和学生在图上的颜色一一对应：
 *   DEPENDS_ON      依赖    —— A 依赖 B（B 没掌握，A 学不会）       黄色
 *   CONFUSES_WITH   易混淆  —— 学生老把 A 和 B 搞混                红色
 *   CO_OCCURS_WITH  常结合  —— A 和 B 在考试里经常一起出现         绿色
 *
 * 线的粗细统一由「这两个知识点同时出现的频率」决定，也就是共现次数；
 * 依赖关系是课程先修关系，没有统计频次，固定最细。
 */

/* 依赖关系：先修知识（B 是 A 的前置）。课程层面的高置信结论，不按题型名硬匹配；
   只有题目里真的出现了同名知识点，才会连成边。 */
const DEPENDENCY_SEEDS = [
  ['数学', '二面角', '法向量'],
  ['数学', '线面角', '法向量'],
  ['数学', '线面角', '空间向量'],
  ['数学', '二面角', '空间向量'],
  ['数学', '点到平面距离', '法向量'],
  ['数学', '点到平面距离', '平面方程'],
  ['数学', '异面直线所成角', '空间向量'],
  ['数学', '面面垂直', '线面垂直'],
  ['数学', '线面垂直', '线线垂直'],
  ['数学', '三垂线定理', '线面垂直'],
  ['数学', '棱锥体积', '底面积'],
  ['数学', '棱锥体积', '锥体高'],
  ['数学', '函数单调性', '导数'],
  ['数学', '数列求和', '等差数列'],
  ['数学', '数列求和', '等比数列'],
  ['数学', '圆锥曲线', '直线方程'],
  ['物理', '带电粒子运动', '电场力'],
  ['物理', '带电粒子运动', '牛顿第二定律'],
  ['物理', '电场强度', '库仑定律'],
  ['物理', '电势', '电场力做功'],
  ['物理', '洛伦兹力', '磁场'],
  ['物理', '电磁感应', '楞次定律'],
];

/* 易混淆关系：这两个知识点学生确实容易混。这里只声明"容易混"（颜色标红）；
   是否真的混了，仍然由学生自己的错题证据统计。 */
const CONFUSION_SEEDS = [
  ['数学', '二面角', '线面角'],
  ['数学', '二面角', '面面角'],
  ['数学', '线面角', '异面直线所成角'],
  ['数学', '法向量', '方向向量'],
  ['数学', '点到平面距离', '点到直线距离'],
  ['数学', '极值', '最值'],
  ['数学', '充分条件', '必要条件'],
  ['物理', '电场强度', '电势'],
  ['物理', '电场力', '电场强度'],
  ['物理', '速度', '加速度'],
  ['物理', '动能', '动量'],
];

const clean = value => String(value || '').normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
const pointId = (subject, name) => createHash('sha256').update(`${clean(subject)}\0${clean(name).toLocaleLowerCase()}`).digest('hex').slice(0, 20);
const ownerOf = record => String(record?.user_id || record?.studentId || 'local-student');
const pairKey = (a, b) => [a, b].sort().join(':');
const excluded = record => !record;
const geometryFamilies = name => {
  const text = String(name || '');
  return {
    space:/空间|立体|多面体|棱锥|棱柱/.test(text),
    angle:/角|二面|线面/.test(text),
    distance:/距离|点面距|点到平面/.test(text),
    vector:/法向量|空间向量|向量/.test(text),
    perpendicular:/垂直|垂线/.test(text)
  };
};

function curriculumRelated(a, b) {
  if (a.subject !== '数学' || b.subject !== '数学') return false;
  const x = geometryFamilies(a.name), y = geometryFamilies(b.name);
  const isDihedral = name => /二面角/.test(name);
  const isPlaneDistance = name => /点到平面|点面距离/.test(name);
  const isSolidGeometry = name => /立体几何|空间几何/.test(name);
  const aName = String(a.name || ''), bName = String(b.name || '');
  // Keep only a few high-confidence study links; broad "space geometry" matches
  // made an unreadable near-complete yellow mesh in real student graphs.
  if ((isSolidGeometry(aName) && isDihedral(bName)) || (isSolidGeometry(bName) && isDihedral(aName))) return true;
  if ((isDihedral(aName) && isPlaneDistance(bName)) || (isDihedral(bName) && isPlaneDistance(aName))) return true;
  if ((x.angle && y.vector) || (y.angle && x.vector)) return true;
  if ((x.distance && y.vector) || (y.distance && x.vector)) return true;
  return (x.perpendicular && y.vector) || (y.perpendicular && x.vector);
}

/** Build one student's graph. The JSON representation is the migration seam for a future Neo4j adapter. */
export function buildKnowledgeGraph({userId, cases = [], knowledgeCards = [], reviews = [], now = new Date()} = {}) {
  const scopedCases = cases.filter(item => ownerOf(item) === String(userId) && !excluded(item));
  const scopedCards = knowledgeCards.filter(item => ownerOf(item) === String(userId));
  const nodes = new Map();
  const pairs = new Map();
  /* 图里只放"学生自己错题/知识卡上真的出现过的知识点"。
     以前会把知识点表里的其它点也塞进来，图上密密麻麻全是学生没学过的点，
     线也连成一片，看着凌乱、也没法用来复习。 */
  const ownPointNames = new Set();
  for (const item of scopedCases) {
    for (const point of [...(item.knowledgePoints || []), item.knowledgePoint, knowledgePointOf(item)]) {
      const name = clean(point);
      if (name) ownPointNames.add(name);
    }
  }
  for (const card of scopedCards) {
    const name = clean(card.knowledgePoint || card.title);
    if (name) ownPointNames.add(name);
  }
  const ensureNode = (subject, rawName, record, caseId = null) => {
    const name = clean(rawName);
    if (!name || name.length > 100 || /^(point|segment|line|plane|unknown|未分类|待归纳)$/i.test(name)) return null;
    if (!ownPointNames.has(name)) return null;
    const id = pointId(subject, name);
    let node = nodes.get(id);
    if (!node) { node = {id, name, subject: clean(subject) || '未分类', difficulty: null, mastery_avg: null, caseIds: [], hasVisualization: false, reviewedToday: false, _mastery: [], _difficulty: []}; nodes.set(id, node); }
    if (caseId && !node.caseIds.includes(caseId)) node.caseIds.push(caseId);
    // FSRS stability is measured in days, not a percentage; never treat it as mastery.
    const mastery = Number(record?.learningProfile?.mastery ?? record?.mastery);
    if (Number.isFinite(mastery)) node._mastery.push(Math.max(0, Math.min(100, mastery <= 1 ? mastery * 100 : mastery)));
    const difficulty = Number(record?.difficulty ?? record?.learningProfile?.difficulty);
    if (Number.isFinite(difficulty)) node._difficulty.push(difficulty);
    if (record?.geometryBuildStatus === 'ready' || record?.geometryResult?.scene || record?.geometryCompilation?.sceneSpec) node.hasVisualization = true;
    return node;
  };
  for (const item of scopedCases) {
    // Keep node membership aligned with the heatmap: it accepts plural tags,
    // a singular tag, and finally the unit as a fallback, and canonicalizes subjects.
    const subject = subjectOf(item);
    const primaryPoint = knowledgePointOf(item);
    const points = [...new Set([...(item.knowledgePoints || []).map(clean), clean(item.knowledgePoint), primaryPoint].filter(Boolean))];
    const itemNodes = points.map(point => ensureNode(subject, point, item, item.id)).filter(Boolean);
    for (let i = 0; i < itemNodes.length; i++) for (let j = i + 1; j < itemNodes.length; j++) {
      const key = pairKey(itemNodes[i].id, itemNodes[j].id), entry = pairs.get(key) || {a: itemNodes[i], b: itemNodes[j], count: 0, caseIds: []};
      entry.count++; entry.caseIds.push(item.id); pairs.set(key, entry);
    }
  }
  for (const card of scopedCards) ensureNode(subjectOf(card), card.knowledgePoint || card.title, card, card.mistakeId || null);
  const reviewed = new Set();
  const today = now.toISOString().slice(0, 10);
  const reviewedCaseIds = new Set(reviews.filter(item => ownerOf(item) === String(userId) && String(item.reviewedAt || item.createdAt || '').slice(0, 10) === today).flatMap(item => [item.ref_id, item.cardId, ...(item.sourceCaseIds || [])]).filter(Boolean));
  for (const node of nodes.values()) {
    node.reviewedToday = node.caseIds.some(id => reviewedCaseIds.has(id)) || scopedCards.some(card => (card.knowledgePoint || card.title) === node.name && reviewedCaseIds.has(card.id));
    node.mastery_avg = node._mastery.length ? Math.round(node._mastery.reduce((a, b) => a + b, 0) / node._mastery.length) : null;
    node.difficulty = node._difficulty.length ? Number((node._difficulty.reduce((a, b) => a + b, 0) / node._difficulty.length).toFixed(2)) : null;
    delete node._mastery; delete node._difficulty;
  }
  const edges = [];
  const coOccurrences = [];
  for (const pair of pairs.values()) {
    const base = {id:`co:${pair.a.id}:${pair.b.id}`, source:pair.a.id, target:pair.b.id, frequency:pair.count, sourceType:'student_wrong_question_cooccurrence', caseIds:pair.caseIds};
    edges.push({...base, type:'CO_OCCURS_WITH'});
    coOccurrences.push({pointA_id:pair.a.id, pointB_id:pair.b.id, frequency:pair.count, source:base.sourceType, last_updated:now.toISOString()});
    // 同一道错题里反复一起出错是"混淆"的弱证据，不是 AI 结论。
    if (pair.count >= 2) edges.push({...base, id:`conf:${pair.a.id}:${pair.b.id}`, type:'CONFUSES_WITH', frequency:pair.count, sourceType:'repeated_same_student_errors'});
  }
  const bySubjectName = new Map([...nodes.values()].map(node => [`${node.subject}|${node.name}`, node]));
  const addEdge = (edge) => {
    const key = pairKey(edge.source, edge.target);
    if (edges.some(item => item.type === edge.type && pairKey(item.source, item.target) === key)) return;
    edges.push(edge);
  };
  // 依赖：课程先修关系（黄色，最细）
  for (const [subject, dependent, prerequisite] of DEPENDENCY_SEEDS) {
    const from = bySubjectName.get(`${subject}|${dependent}`), to = bySubjectName.get(`${subject}|${prerequisite}`);
    if (from && to) addEdge({id:`dep:${from.id}:${to.id}`, source:from.id, target:to.id, type:'DEPENDS_ON',
      frequency:1, sourceType:'curated_curriculum_seed', note:`${dependent} 依赖 ${prerequisite}`});
  }
  // 易混淆：课程层面已知的易混对（红色）。有学生共现证据时用共现次数加粗。
  for (const [subject, a, b] of CONFUSION_SEEDS) {
    const from = bySubjectName.get(`${subject}|${a}`), to = bySubjectName.get(`${subject}|${b}`);
    if (!from || !to) continue;
    const observed = pairs.get(pairKey(from.id, to.id));
    addEdge({id:`conf-seed:${from.id}:${to.id}`, source:from.id, target:to.id, type:'CONFUSES_WITH',
      frequency:observed ? observed.count : 1,
      sourceType: observed ? 'confusion_seed+student_cooccurrence' : 'confusion_seed',
      caseIds: observed ? observed.caseIds : [],
      note:`${a} 和 ${b} 容易混`});
  }
  /* 图里只保留三类有明确含义的关系：
       依赖（先修）、易混淆、常结合（同题共现次数）。
     RELATED_TO（"同族语义相近"）已删除 —— 它既不是先修、也不是学生真会混、
     更不是考试一起考，只是按关键词聚类，所以既不可解释也没用：
     学生看到"平面与平面垂直的性质 ↔ 二面角…"这种一对，只会问"这跟我有什么关系"。
     另外 curriculumRelated() 现在也不再被使用。 */
  const bestByPair = new Map();
  for (const edge of edges) {
    if (!['DEPENDS_ON', 'CONFUSES_WITH', 'CO_OCCURS_WITH'].includes(edge.type)) continue;
    const key = `${edge.type}|${pairKey(edge.source, edge.target)}`;
    const current = bestByPair.get(key);
    if (!current || (Number(edge.frequency) || 1) > (Number(current.frequency) || 1)) bestByPair.set(key, edge);
  }
  const deduped = [...bestByPair.values()];
  /* 孤立点不画（学生看着一堆没连线的点更乱），但**学生错题里真的出现过的知识点要保留**：
     它只是还没和别的点建立关系，不代表不该出现在自己的知识网络里。 */
  const linked = new Set();
  for (const edge of deduped) { linked.add(edge.source); linked.add(edge.target); }
  const visibleNodes = [...nodes.values()].filter(node => linked.has(node.id) || (node.caseIds || []).length);
  const visibleIds = new Set(visibleNodes.map(node => node.id));
  const visibleEdges = deduped.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  return {schemaVersion:1, provider:'json', user_id:String(userId), nodes:visibleNodes, edges:visibleEdges, coOccurrences, generatedAt:now.toISOString()};
}

export function rebuildKnowledgeGraphs(db, now = new Date()) {
  const userIds = new Set([
    ...(db.cases || []).map(ownerOf), ...(db.knowledgeCards || []).map(ownerOf),
    ...(db.knowledgeCardReviews || []).map(ownerOf), ...(db.users || []).map(user => String(user.id))
  ]);
  const users = {};
  for (const userId of userIds) users[userId] = buildKnowledgeGraph({userId, cases:db.cases, knowledgeCards:db.knowledgeCards, reviews:db.knowledgeCardReviews, now});
  return {schemaVersion:1, provider:'json', users, generatedAt:now.toISOString()};
}

export function graphForUser(graph, userId) {
  return graph?.users?.[String(userId)] || {schemaVersion:1, provider:'json', user_id:String(userId), nodes:[], edges:[], coOccurrences:[], generatedAt:null};
}
