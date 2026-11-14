// 归纳页数据聚合
//
// 输入项目现有的数据（错题 / 知识卡 / 陪练会话 / 笔记 / 录入记录），
// 输出归纳页需要的全部结构：知识点热力图、错因分布、今日最该复习、
// 薄弱点来源标记，以及「知识点 → 错题 → 解析」的连续下钻链路。
//
// 优先级算法（按需求）：
//     priority = 错误频次 × 知识点权重 × 时间衰减
//     时间衰减：30 天前的错误权重减半 => decay = 0.5 ^ (daysAgo / 30)
//
// 独立模块：不 import 项目既有 workflow，避免与并行开发冲突。
import {masteryFromStability} from './fsrs-scheduler.mjs';
import {knowledgePointId} from './my-understanding.mjs';

/** 时间衰减半衰期（天）：30 天前权重减半 */
export const DECAY_HALF_LIFE_DAYS = 30;

/** 薄弱点来源标签 */
export const SOURCE_TAGS = Object.freeze({
  tutor: {key: 'tutor', label: '来自 AI 陪练', hint: 'AI 陪练过程中暴露的卡点'},
  note: {key: 'note', label: '来自手写笔记', hint: '手写笔记/错题本里记录的内容'},
  intake: {key: 'intake', label: '来自录入预判', hint: '录入题目时系统预判的薄弱点'},
  review: {key: 'review', label: '来自复习表现', hint: 'FSRS 复习中反复答错'}
});

const DAY_MS = 86400000;

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function daysAgo(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / DAY_MS);
}

/** 时间衰减：30 天前的错误权重减半 */
export function timeDecay(ageInDays, halfLifeDays = DECAY_HALF_LIFE_DAYS) {
  if (!Number.isFinite(ageInDays) || ageInDays <= 0) return 1;
  return Math.pow(0.5, ageInDays / halfLifeDays);
}

/* 录入预判会把几何 IR 的实体类型名写进 knowledgePoints（point / segment / plane /
   prism / pyramid …），这些是机器内部标识，不是学生要复习的知识点。
   若不剔除，热力图顶部会被 "point 错误 9 次" 这类格子占据。
   —— 只在这里过滤展示层，不改动原始数据。 */
const IR_TYPE_TOKENS = new Set([
  'point', 'points', 'segment', 'segments', 'line', 'lines', 'plane', 'planes',
  'prism', 'pyramid', 'polygon', 'polyhedron', 'face', 'faces', 'vertex', 'vertices',
  'edge', 'edges', 'circle', 'cylinder', 'cone', 'sphere', 'solid', 'element', 'elements',
  'vector', 'vectors', 'triangle', 'square', 'rectangle', 'angle', 'dihedral', 'none', 'null'
]);

function isUsableKnowledgePoint(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return false;
  if (IR_TYPE_TOKENS.has(text.toLowerCase())) return false;
  // 纯英文/符号的条目标识一律不算知识点
  if (/^[a-z0-9\s_\-./]+$/i.test(text)) return false;
  return true;
}

/** 取主要知识点。
 *  注意两种数据形态：错题是 knowledgePoints（复数字段），知识卡是 knowledgePoint（单数）。
 *  只读复数会让知识卡全部落进「未归类的知识点」。 */
export function knowledgePointOf(record) {
  const points = Array.isArray(record && record.knowledgePoints) ? record.knowledgePoints : [];
  const usable = points.filter(isUsableKnowledgePoint);
  if (usable.length) return String(usable[0]).trim();
  const single = record && record.knowledgePoint;
  if (isUsableKnowledgePoint(single)) return String(single).trim();
  const unit = String((record && record.unit) || '').trim();
  if (unit && !/^空间几何$/.test(unit)) return unit;
  return '空间几何（待细分）';
}

export function subjectOf(record) {
  const subject = String((record && record.subject) || '').trim();
  if (!subject || subject === '数学·几何') return '数学';
  return subject;
}

/* 「原卷 / 真题」分类。
   数据里目前没有试卷字段，所以按「来源类型 + 录入批次」把同一份卷子还原成一组：
   同一天批量录入的题默认视为同一份原卷；确定性构造题 / AI 参考题 / 变式训练各自成组。
   如果以后数据里真的补上了 paperTitle / paper 字段，优先用真实卷名。 */
const ORIGIN_PAPER = [
  {test: /configured_example|public_template/i, key: 'textbook', label: '教材例题库'},
  {test: /deterministic/i, key: 'deterministic', label: '本地构造题（原卷）'},
  {test: /deepseek/i, key: 'ai_reference', label: 'AI 生成参考题'},
  {test: /transfer_training/i, key: 'transfer', label: '三阶变式训练'},
  {test: /upload|manual/i, key: 'upload', label: '手动上传'}
];

/** 一道错题属于哪份「原卷 / 真题」 */
export function paperOf(record) {
  const explicit = String((record && (record.paperTitle || record.paper || record.examTitle)) || '').trim();
  if (explicit) return {key: 'paper:' + explicit, label: explicit};
  const origin = String((record && (record.origin || record.source)) || '').trim();
  for (const entry of ORIGIN_PAPER) {
    if (entry.test.test(origin)) return {key: entry.key, label: entry.label};
  }
  const stamp = toDate(record && (record.createdAt || record.updatedAt));
  if (!stamp) return {key: 'unknown', label: '未分类原卷'};
  const day = stamp.toISOString().slice(0, 10);
  return {key: 'batch:' + day, label: day + ' 录入的原卷'};
}

/** 该错题属于哪些薄弱点来源 */
export function sourcesOf(record, context = {}) {
  const tags = new Set();
  const caseId = record && record.id;
  const sessions = context.tutorSessions || [];
  const noteSources = context.noteSources || [];
  const ingestions = context.ingestions || [];
  const reviews = context.knowledgeCardReviews || [];

  if (sessions.some(session => session && session.caseId === caseId)) tags.add('tutor');
  if (noteSources.some(note => note && (note.caseId === caseId || (note.sourceCaseIds || []).includes(caseId)))) tags.add('note');
  if (ingestions.some(item => item && item.caseId === caseId)) tags.add('intake');
  // 复习中答错过的知识点也算一个来源
  if (reviews.some(review => review && (review.sourceCaseIds || []).includes(caseId) && review.correctness && review.correctness !== 'correct')) {
    tags.add('review');
  }
  if (!tags.size) tags.add('intake');
  return [...tags].map(key => SOURCE_TAGS[key]).filter(Boolean);
}

/** 统计每条错题的「错误频次权重」（带时间衰减） */
export function errorWeightOf(record, now = new Date()) {
  const age = daysAgo(record && (record.updatedAt || record.createdAt), now);
  return timeDecay(age === null ? 0 : age);
}

/** 从知识卡里取出 FSRS 的 stability（兼容几种存放位置） */
export function stabilityOf(card) {
  const candidates = [
    card && card.fsrs && card.fsrs.stability,
    card && card.reviewSchedule && card.reviewSchedule.stability,
    card && card.stability
  ];
  for (const value of candidates) {
    if (value === null || value === undefined || value === '') continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

/** 错题复习后的掌握度：同时吸收 FSRS stability 和已有 mastery。 */
function mistakeMasteryOf(record) {
  const profile = record && record.learningProfile;
  if (!profile || typeof profile !== 'object') return null;
  const samples = [];
  const stability = stabilityOf(profile);
  if (stability !== null) samples.push(masteryFromStability(stability));
  if (profile.mastery !== null && profile.mastery !== undefined && profile.mastery !== '') {
    const mastery = Number(profile.mastery);
    if (Number.isFinite(mastery)) samples.push(Math.min(100, Math.max(0, mastery)));
  }
  return samples.length
    ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
    : null;
}

/**
 * 构建知识点热力图。
 * 每个格子 = 一个知识点，含错误频次（时间加权）、掌握度、优先级、来源标记。
 */
export function buildHeatmap({cases = [], knowledgeCards = [], now = new Date(), knowledgeWeights = {}, context = {}} = {}) {
  const masterySamples = new Map();
  const addMastery = (record, point, mastery) => {
    if (!point || !Number.isFinite(mastery)) return;
    const key = `${subjectOf(record)}::${point}`;
    if (!masterySamples.has(key)) masterySamples.set(key, []);
    masterySamples.get(key).push(mastery);
  };
  for (const card of knowledgeCards) {
    const point = String((card && card.knowledgePoint) || '').trim();
    if (!point) continue;
    const stability = stabilityOf(card);
    if (stability !== null) addMastery(card, point, masteryFromStability(stability));
  }
  for (const record of cases) {
    addMastery(record, knowledgePointOf(record), mistakeMasteryOf(record));
  }
  const masters = new Map([...masterySamples].map(([key, values]) => [
    key,
    Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  ]));

  const buckets = new Map();
  for (const record of cases) {
    const point = knowledgePointOf(record);
    const subject = subjectOf(record);
    const key = `${subject}::${point}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key, subject, knowledgePoint: point,
        errorCount: 0, weightedErrors: 0, caseIds: [], lastErrorAt: null,
        errorCauses: new Map(), sources: new Map()
      });
    }
    const bucket = buckets.get(key);
    const weight = errorWeightOf(record, now);
    bucket.errorCount += 1;
    bucket.weightedErrors += weight;
    bucket.caseIds.push(record.id);
    const stamp = toDate(record.updatedAt || record.createdAt);
    if (stamp && (!bucket.lastErrorAt || stamp > bucket.lastErrorAt)) bucket.lastErrorAt = stamp;
    for (const cause of (record.errorCauses || [])) {
      const text = String(cause || '').trim();
      if (!text) continue;
      bucket.errorCauses.set(text, (bucket.errorCauses.get(text) || 0) + 1);
    }
    for (const tag of sourcesOf(record, context)) {
      bucket.sources.set(tag.key, (bucket.sources.get(tag.key) || 0) + 1);
    }
  }

  /* 复习记录按「题目 id」归堆，用来统计每个知识点的已练 / 独立完成 / 提示次数。
     数据来源：db.knowledgeCardReviews（每次评分都写一条，含 rating 与 reviewedAt）。 */
  const reviewsByCase = new Map();
  for (const review of (context.knowledgeCardReviews || [])) {
    const key = String((review && (review.ref_id || review.cardId)) || '');
    if (!key) continue;
    if (!reviewsByCase.has(key)) reviewsByCase.set(key, []);
    reviewsByCase.get(key).push(review);
  }
  const sessionCaseIds = new Set((context.tutorSessions || []).map(item => String((item && item.caseId) || '')).filter(Boolean));

  const practiceOf = caseIds => {
    const timeOf = value => { const parsed = toDate(value); return parsed ? parsed.getTime() : 0; };
    const list = [];
    let tutored = 0;
    for (const id of caseIds) {
      (reviewsByCase.get(String(id)) || []).forEach(review => list.push(review));
      if (sessionCaseIds.has(String(id))) tutored += 1;
    }
    list.sort((a, b) => timeOf(b && b.reviewedAt) - timeOf(a && a.reviewedAt));
    const independent = list.filter(review => Number(review.rating) >= 3).length;
    const hinted = list.filter(review => Number(review.rating) <= 2).length;
    // 连续答对（熟练）的次数：从最近一次往前数
    let streak = 0;
    for (const review of list) {
      if (Number(review.rating) >= 3) streak += 1; else break;
    }
    return {
      practiced: list.length,
      independent,
      hinted,
      streak,
      tutored,
      lastReviewedAt: list.length ? (list[0].reviewedAt || null) : null
    };
  };

  const cells = [];
  for (const bucket of buckets.values()) {
    const weight = Number(knowledgeWeights[bucket.knowledgePoint] ?? knowledgeWeights[bucket.key] ?? 1) || 1;
    const priority = Number((bucket.weightedErrors * weight).toFixed(4));
    const mastery = masters.has(bucket.key) ? masters.get(bucket.key) : null;
    const practice = practiceOf(bucket.caseIds);
    cells.push({
      key: bucket.key,
      subject: bucket.subject,
      knowledgePoint: bucket.knowledgePoint,
      errorCount: bucket.errorCount,
      weightedErrors: Number(bucket.weightedErrors.toFixed(4)),
      weight,
      priority,
      mastery,
      // 掌握度未知时，用「错误频次」粗略折算，保证热力图不会出现空洞
      masteryFallback: mastery === null ? Math.max(8, 60 - bucket.errorCount * 8) : null,
      lastErrorAt: bucket.lastErrorAt ? bucket.lastErrorAt.toISOString() : null,
      daysSinceLastError: bucket.lastErrorAt ? Math.round(daysAgo(bucket.lastErrorAt, now)) : null,
      caseIds: bucket.caseIds,
      topCause: [...bucket.errorCauses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      // 我的进步要用的练习统计
      ...practice,
      // 连续 3 次复习都答对且熟练 → 已攻克
      mastered: practice.streak >= 3,
      sources: [...bucket.sources.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({...SOURCE_TAGS[key], count}))
    });
  }
  cells.sort((a, b) => b.priority - a.priority);
  return cells;
}

/** 错因分布（饼图数据） */
export function buildErrorCauseDistribution(cases = [], now = new Date()) {
  const counts = new Map();
  let total = 0;
  for (const record of cases) {
    const causes = (record.errorCauses || []).map(item => String(item || '').trim()).filter(Boolean);
    const list = causes.length ? causes : ['未标注错因'];
    const weight = errorWeightOf(record, now);
    for (const cause of list) {
      counts.set(cause, (counts.get(cause) || 0) + weight);
      total += weight;
    }
  }
  const items = [...counts.entries()]
    .map(([cause, weight]) => ({cause, weight: Number(weight.toFixed(4)), percent: total ? Number((weight / total * 100).toFixed(1)) : 0}))
    .sort((a, b) => b.weight - a.weight);
  return {items, total: Number(total.toFixed(4))};
}

/** 今日最该复习的知识点（按优先级算法取前三；已到期的只做小幅加权） */
export function pickTopFocus(cells, {limit = 3, dueCards = []} = {}) {
  const duePoints = new Set(dueCards.map(card => String((card && card.knowledgePoint) || '').trim()).filter(Boolean));
  return [...cells]
    .map(cell => {
      const isDue = duePoints.has(cell.knowledgePoint);
      return {
        ...cell,
        isDue,
        /* 以前这里给到期项加 1e6，结果「到期」完全压过优先级算法：
           只要有几张知识卡到期，最该复习的三个知识点就被换成它们的知识点。
           现在改成 25% 的小幅加权——到期仍然优先，但排序主体仍是
           优先级（错误频次 × 知识点权重 × 时间衰减）。 */
        sortKey: Number((cell.priority * (isDue ? 1.25 : 1)).toFixed(4)),
        reason: isDue
          ? 'FSRS 已到期，先复习它'
          : cell.errorCount >= 2 ? `错过 ${cell.errorCount} 次的反复卡点`
            : '近期新出现的薄弱点'
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, limit);
}

/** 知识点 → 错题 → 解析 的连续下钻 */
export function buildDrilldown(cells, cases = [], {now = new Date(), context = {}} = {}) {
  const byId = new Map(cases.map(item => [item.id, item]));
  return cells.map(cell => ({
    key: cell.key,
    subject: cell.subject,
    knowledgePoint: cell.knowledgePoint,
    priority: cell.priority,
    weight: cell.weight,
    errorCount: cell.errorCount,
    mastery: cell.mastery ?? cell.masteryFallback,
    sources: cell.sources,
    mistakes: cell.caseIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(record => ({
        id: record.id,
        question: String(record.question || '').slice(0, 200),
        studentAnswer: String(record.studentAnswer || '').slice(0, 200),
        errorCauses: record.errorCauses || [],
        has3D: Boolean(record.geometryResult && record.geometryResult.scene),
        createdAt: record.createdAt || null,
        // 逐题来源：录入预判 / AI 陪练 / 手写笔记 / 复习表现
        sources: sourcesOf(record, context),
        // 「原卷 / 真题」分组，用于下钻列表里的分类
        paper: paperOf(record),
        // 「解析」层：优先用复盘，其次用错因/思路警示
        analysis: {
          summary: String(
            (record.completionReview && record.completionReview.summary)
            || (record.errorThoughtInsight && record.errorThoughtInsight.warning)
            || (record.analysis || '')
          ).slice(0, 400),
          completedSteps: (record.completionReview && record.completionReview.completedSteps) || [],
          observedDifficulties: (record.completionReview && record.completionReview.observedDifficulties) || []
        }
      }))
  }));
}

/** 归纳页总入口 */
export function buildSummary({cases = [], knowledgeCards = [], tutorSessions = [], noteSources = [], ingestions = [], knowledgeCardReviews = [], now = new Date(), examDate = null, knowledgeWeights = {}} = {}) {
  const context = {tutorSessions, noteSources, ingestions, knowledgeCardReviews};
  const referenceNow = toDate(now) || new Date();
  const heatmap = buildHeatmap({cases, knowledgeCards, now: referenceNow, knowledgeWeights, context});
  const errorCauses = buildErrorCauseDistribution(cases, referenceNow);
  const casesBySubject = new Map();
  for (const record of cases) {
    const subject = subjectOf(record);
    if (!casesBySubject.has(subject)) casesBySubject.set(subject, []);
    casesBySubject.get(subject).push(record);
  }
  const errorCausesBySubject = Object.fromEntries(
    [...casesBySubject].map(([subject, subjectCases]) =>
      [subject, buildErrorCauseDistribution(subjectCases, referenceNow)])
  );
  const dueCards = knowledgeCards.filter(card => {
    const due = card && card.reviewSchedule && card.reviewSchedule.dueAt;
    if (!due) return false;
    return new Date(due).getTime() <= referenceNow.getTime();
  });
  const topToday = pickTopFocus(heatmap, {limit: 3, dueCards});
  const drilldown = buildDrilldown(heatmap, cases, {now: referenceNow, context});

  const totalErrors = heatmap.reduce((sum, cell) => sum + cell.errorCount, 0);
  const masteredCount = heatmap.filter(cell => (cell.mastery ?? cell.masteryFallback) >= 80).length;

  return {
    generatedAt: referenceNow.toISOString(),
    examDate: examDate || null,
    totals: {
      knowledgePoints: heatmap.length,
      errors: totalErrors,
      cards: knowledgeCards.length,
      dueCards: dueCards.length,
      mastered: masteredCount,
      weak: heatmap.filter(cell => (cell.mastery ?? cell.masteryFallback) < 60).length
    },
    heatmap,
    errorCauses,
    errorCausesBySubject,
    topToday,
    drilldown,
    // 第三个模块：学科 → 知识点 逐层浏览
    taxonomy: buildTaxonomy({heatmap, knowledgeCards}),
    // 雷达图：默认按知识点铺轴，可切按学科
    radar: {
      byKnowledgePoint: buildRadar(heatmap, {by: 'knowledgePoint', limit: 8}),
      bySubject: buildRadar(heatmap, {by: 'subject', limit: 8})
    }
  };
}

/**
 * 学科 → 详细知识点 的两层结构（归纳页第三个模块用）。
 * 「一直点点」就是在这里：点学科展开它的知识点，再点知识点看它下面的错题。
 */
export function buildTaxonomy({heatmap = [], knowledgeCards = []} = {}) {
  const cardsByPoint = new Map();
  for (const card of knowledgeCards) {
    const point = String((card && card.knowledgePoint) || '').trim();
    if (!point) continue;
    cardsByPoint.set(point, (cardsByPoint.get(point) || 0) + 1);
  }

  const subjects = new Map();
  for (const cell of heatmap) {
    const list = subjects.get(cell.subject) || [];
    list.push(cell);
    subjects.set(cell.subject, list);
  }

  const average = list => list.length
    ? Math.round(list.reduce((sum, item) => sum + (item.mastery ?? item.masteryFallback ?? 0), 0) / list.length)
    : 0;

  return [...subjects.entries()].map(([subject, cells]) => {
    const sorted = [...cells].sort((a, b) => b.priority - a.priority);
    const errors = sorted.reduce((sum, cell) => sum + cell.errorCount, 0);
    return {
      subject,
      knowledge_point_count: sorted.length,
      error_count: errors,
      mastery: average(sorted),
      priority: Number(sorted.reduce((sum, cell) => sum + cell.priority, 0).toFixed(4)),
      children: sorted.map(cell => ({
        knowledge_point_id: knowledgePointId(cell.knowledgePoint),
        knowledgePoint: cell.knowledgePoint,
        error_count: cell.errorCount,
        weighted_errors: cell.weightedErrors,
        mastery: cell.mastery ?? cell.masteryFallback,
        has_fsrs: cell.mastery !== null,
        priority: cell.priority,
        card_count: cardsByPoint.get(cell.knowledgePoint) || 0,
        mistake_count: cell.caseIds.length,
        case_ids: cell.caseIds,
        last_error_at: cell.lastErrorAt,
        days_since_last_error: cell.daysSinceLastError,
        top_cause: cell.topCause,
        sources: cell.sources
      }))
    };
  }).sort((a, b) => b.priority - a.priority);
}

/** 雷达图：每个轴是一个知识点（或学科）的掌握度，越靠外越扎实 */
export function buildRadar(heatmap = [], {by = 'knowledgePoint', limit = 8} = {}) {
  const groups = new Map();
  for (const cell of heatmap) {
    const label = by === 'subject' ? cell.subject : cell.knowledgePoint;
    const list = groups.get(label) || [];
    list.push(cell);
    groups.set(label, list);
  }
  const axes = [...groups.entries()].map(([label, cells]) => {
    const mastery = Math.round(cells.reduce((sum, cell) => sum + (cell.mastery ?? cell.masteryFallback ?? 0), 0) / cells.length);
    const errors = cells.reduce((sum, cell) => sum + cell.errorCount, 0);
    return {
      label,
      mastery,
      errors,
      knowledgePoints: cells.length,
      priority: Number(cells.reduce((sum, cell) => sum + cell.priority, 0).toFixed(4)),
      // 薄弱程度：掌握度越低越长，方便一眼看出哪块最短
      weakness: Math.max(0, 100 - mastery)
    };
  }).sort((a, b) => b.priority - a.priority).slice(0, Math.max(3, limit));
  return {by, axes};
}
