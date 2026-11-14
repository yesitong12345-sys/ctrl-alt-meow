// 复习队列
//
// 负责：把「该复习的东西」挑出来排成队列（知识卡 + 错题），支持全科混合/单科筛选，
// 并封装评分 → py-fsrs 调度 → 是否重新入队 的完整流程。
//
// 评分规则（按需求）：
//     1 忘了 / 2 有点难  => 卡片重新加入当前队列（REPEAT_THRESHOLD = 2）
//     3 还行 / 4 太简单  => 正常进入下一次 FSRS 调度
//
// 独立模块：不 import 项目既有 workflow。
import {
  RATINGS, REPEAT_THRESHOLD, desiredRetentionFor,
  masteryFromStability, masteryScore, reviewCard as fsrsReview, previewRatings, toFsrsCard
} from './fsrs-scheduler.mjs';
import {subjectOf, knowledgePointOf} from './learning-summary.mjs';

export const SUBJECT_ALL = 'all';
export {RATINGS, REPEAT_THRESHOLD};

function stampOf(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/** 知识卡今天是否到期（从未复习过的也算到期） */
export function isCardDue(card, now = new Date()) {
  const due = card && card.reviewSchedule && card.reviewSchedule.dueAt;
  if (!due) return true;
  const stamp = stampOf(due);
  return stamp === null ? true : stamp <= now.getTime();
}

/** 错题今天是否到期（沿用项目 existing learningProfile.dueAt） */
export function isMistakeDue(record, now = new Date()) {
  const due = record && record.learningProfile && record.learningProfile.dueAt;
  if (!due) return true;
  const stamp = stampOf(due);
  return stamp === null ? true : stamp <= now.getTime();
}

function overdueDays(value, now) {
  const stamp = stampOf(value);
  if (stamp === null) return 0;
  return Math.max(0, (now.getTime() - stamp) / 86400000);
}

/** 知识卡 → 队列项 */
export function cardToQueueItem(card, now = new Date()) {
  const stability = card && card.fsrs ? card.fsrs.stability : null;
  return {
    type: 'card',
    id: card.id,
    subject: subjectOf(card),
    knowledgePoint: knowledgePointOf(card),
    title: String(card.title || '').slice(0, 120),
    prompt: String(card.challengePrompt || card.title || '').slice(0, 400),
    answer: String(card.insight || '').slice(0, 600),
    nextTimeAction: String(card.nextTimeAction || '').slice(0, 200),
    mastery: masteryFromStability(stability),
    masteryStatus: card.masteryStatus || 'learning',
    dueAt: (card.reviewSchedule && card.reviewSchedule.dueAt) || null,
    overdueDays: Number(overdueDays(card.reviewSchedule && card.reviewSchedule.dueAt, now).toFixed(2)),
    stability: Number.isFinite(Number(stability)) ? Number(stability) : null,
    sources: card.sourceQuotes || []
  };
}

/** 错题 → 队列项 */
export function mistakeToQueueItem(record, now = new Date()) {
  const profile = record.learningProfile || {};
  return {
    type: 'mistake',
    id: record.id,
    subject: subjectOf(record),
    knowledgePoint: knowledgePointOf(record),
    title: '',
    prompt: String(record.question || '').slice(0, 400),
    answer: String(
      (record.completionReview && record.completionReview.summary)
      || (record.analysis || '')
    ).slice(0, 600),
    nextTimeAction: '',
    mastery: Number(profile.mastery || 0),
    masteryStatus: record.verificationStatus || 'learning',
    dueAt: profile.dueAt || null,
    overdueDays: Number(overdueDays(profile.dueAt, now).toFixed(2)),
    stability: null,
    has3D: Boolean(record.geometryResult && record.geometryResult.scene),
    sources: []
  };
}

/** 知识点权重 >= 这个值，视为「老师标注的高频易错」，自动置顶 */
export const PIN_WEIGHT = 2;

/**
 * 构建复习队列。
 * subject        = SUBJECT_ALL 时为全科混合，否则只看该学科
 * knowledgePoint = 只保留这个知识点的到期内容（前端也可本地筛选）
 * heatmap        = 归纳页的知识点热力图，用来拿「错误频次 × 知识点权重 × 时间衰减」
 * pinnedPoints   = 系统判定的高频易错知识点（通常是优先级最高的那几个），整体置顶
 *
 * 排序优先级（按需求）：
 *     priority = (时间加权错误频次 + 1) × 知识点权重 × 掌握度缺口 × 逾期加成
 * 掌握度越低、错误频次越高、逾期越久 → 排得越前；高频易错知识点整体置顶。
 */
export function buildQueue({
  knowledgeCards = [], cases = [], subject = SUBJECT_ALL, knowledgePoint = null,
  heatmap = [], knowledgeWeights = {}, pinnedPoints = [], now = new Date(), limit = 50
} = {}) {
  const matchesSubject = item => subject === SUBJECT_ALL || subjectOf(item) === subject;
  const pointIndex = new Map();
  for (const cell of heatmap) {
    if (cell && cell.knowledgePoint) pointIndex.set(cell.knowledgePoint, cell);
  }
  const pinnedSet = new Set((pinnedPoints || []).filter(Boolean).map(String));
  const weightFor = point => {
    const value = Number(knowledgeWeights && knowledgeWeights[point]);
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  /** 给队列项补上「为什么排在这里」的全部依据 */
  const decorate = item => {
    const cell = pointIndex.get(item.knowledgePoint) || null;
    const weight = weightFor(item.knowledgePoint);
    const weightedErrors = cell ? Number(cell.weightedErrors) || 0 : 0;
    const errorCount = cell ? Number(cell.errorCount) || 0 : 0;
    const mastery = Number.isFinite(Number(item.mastery))
      ? Number(item.mastery)
      : (cell ? (cell.mastery ?? cell.masteryFallback ?? 50) : 50);
    // 掌握度缺口：0 分 → 1，100 分 → 0；留 0.15 地板，避免满分项权重归零
    const masteryGap = Math.max(0.15, (100 - Math.max(0, Math.min(100, mastery))) / 100);
    // 逾期加成：逾期越久越靠前，但用 log 压住极端值
    const overdueBoost = 1 + Math.log1p(Math.max(0, Number(item.overdueDays) || 0));
    const base = (weightedErrors + 1) * weight;
    const priority = Number((base * (0.4 + 0.6 * masteryGap) * overdueBoost).toFixed(4));
    // 置顶的两种来源：老师标注（权重）或系统判定（高频易错知识点）
    const pinned = weight >= PIN_WEIGHT || pinnedSet.has(String(item.knowledgePoint));
    return Object.assign({}, item, {
      mastery,
      weight,
      weightedErrors,
      errorCount,
      pointPriority: cell ? cell.priority : 0,
      priority,
      pinned
    });
  };

  const items = [];
  for (const card of knowledgeCards) {
    if (!matchesSubject(card)) continue;
    if (!isCardDue(card, now)) continue;
    const item = cardToQueueItem(card, now);
    if (knowledgePoint && item.knowledgePoint !== knowledgePoint) continue;
    items.push(decorate(item));
  }
  for (const record of cases) {
    if (!matchesSubject(record)) continue;
    if (!isMistakeDue(record, now)) continue;
    const item = mistakeToQueueItem(record, now);
    if (knowledgePoint && item.knowledgePoint !== knowledgePoint) continue;
    items.push(decorate(item));
  }

  // 高频易错置顶 → 优先级 → 逾期 → 掌握度 → 知识卡先于错题
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    if (a.type !== b.type) return a.type === 'card' ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });

  const subjects = [...new Set([...knowledgeCards, ...cases].map(subjectOf))].filter(Boolean).sort();
  const totalDue = items.length;
  const limited = items.slice(0, Math.max(1, limit));

  return {
    subject,
    knowledgePoint: knowledgePoint || null,
    generatedAt: now.toISOString(),
    items: limited,
    subjects,
    stats: {
      due: totalDue,
      returned: limited.length,
      cards: limited.filter(item => item.type === 'card').length,
      mistakes: limited.filter(item => item.type === 'mistake').length,
      pinned: limited.filter(item => item.pinned).length,
      subjects
    }
  };
}

/** 评分 <= 2 需要重新入队 */
export function shouldRepeat(rating) {
  return Number(rating) <= REPEAT_THRESHOLD;
}

/**
 * 对一张卡评分：调用 py-fsrs，返回新卡状态与是否重新入队。
 * 注意：FSRS 推后的 due 是「下次正式复习时间」；
 * 评分 <= 2 时卡片同时会被重新塞回当前队列（本轮再练一次），两者不冲突。
 */
export async function rateCard(card, rating, {now = new Date(), examDate = null} = {}) {
  const value = Number(rating);
  if (!Number.isFinite(value) || value < 1 || value > 4) {
    throw new Error('rating 必须是 1~4');
  }
  const result = await fsrsReview(toFsrsCard(card && card.fsrs), value, {now, examDate});
  return {
    rating: value,
    label: (RATINGS.find(item => item.value === value) || {}).label || String(value),
    repeat: shouldRepeat(value),
    card: result.card,
    intervalDays: result.intervalDays,
    dueAt: result.dueAt,
    stability: result.stability,
    difficulty: result.difficulty,
    state: result.state,
    mastery: masteryFromStability(result.stability),
    masteryWithRecency: masteryScore({stability: result.stability, retrievability: result.retrievabilityAfter}),
    retrievabilityBefore: result.retrievabilityBefore,
    retrievabilityAfter: result.retrievabilityAfter,
    desiredRetention: desiredRetentionFor(examDate, now)
  };
}

/** 四档按钮上的间隔提示 */
export async function ratingHints(card, {now = new Date(), examDate = null} = {}) {
  const preview = await previewRatings(toFsrsCard(card && card.fsrs), {now, examDate});
  return preview.items.map(item => {
    const meta = RATINGS.find(entry => entry.value === item.rating) || {};
    return {
      ...meta,
      intervalDays: item.intervalDays,
      dueAt: item.dueAt,
      intervalText: formatInterval(item.intervalDays),
      repeat: shouldRepeat(item.rating)
    };
  });
}

/** 把天数量成人话 */
export function formatInterval(days) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return '今天';
  if (value < 1 / 24) return '稍后';
  if (value < 1) return `${Math.max(1, Math.round(value * 24 * 60))} 分钟`;
  if (value < 30) return `${Math.round(value)} 天`;
  if (value < 365) return `${(value / 30).toFixed(1)} 个月`;
  return `${(value / 365).toFixed(1)} 年`;
}

/** 一轮复习结束后的汇总 */
export function summarizeSession(records = []) {
  const total = records.length;
  const repeated = records.filter(item => shouldRepeat(item.rating)).length;
  const again = records.filter(item => Number(item.rating) === 1).length;
  const mastered = records.filter(item => Number(item.rating) >= 3).length;
  return {
    total,
    repeated,
    again,
    mastered,
    accuracy: total ? Number(((mastered / total) * 100).toFixed(1)) : 0,
    needsUnderstanding: again > 0 || repeated > 0
  };
}
