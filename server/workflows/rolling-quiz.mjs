// 卡片滚动测验
//
// 规格（按需求）：
//   · 卡片队列按 due 排序
//   · 正面只展示知识点与回忆提示；原题仍留在错题库，不复制进闯关
//   · 点「记住了」后翻转，展示完整卡片：上栏「我的理解」= 学生原话，下栏「AI 补充」= 标准解析
//   · 再确认一次是否真的记住
//   · 正面三种判断都只是可撤回的预判；背面才选择最终 FSRS 评分
//   · 最终选「不会」时写入 Rating.Again，并在本轮末尾再练一次
//   · 知识卡使用 FSRS 排程，支持全科混合 / 单科筛选
//
// 独立模块：只依赖 fsrs 相关模块与 learning-summary 的纯函数。
import {masteryFromStability} from './fsrs-scheduler.mjs';
import {REF_TYPE} from './fsrs-store.mjs';
import {subjectOf, knowledgePointOf, stabilityOf} from './learning-summary.mjs';

export const SUBJECT_ALL = 'all';

/** 正面三个选项只是自我预判；翻面核对后的最终评分才写入 FSRS。 */
export const QUIZ_OPTIONS = Object.freeze([
  {key: 'remembered', label: '记住了', rating: null, hint: '先翻到背面核对，尚未评分'},
  {key: 'fuzzy', label: '有点模糊', rating: null, hint: '先翻到背面核对，尚未评分'},
  {key: 'forgot', label: '对不起，我刚忘掉了', rating: null, hint: '先翻到背面核对，尚未评分'}
]);

export function optionByKey(key) {
  return QUIZ_OPTIONS.find(item => item.key === key) || null;
}

function stampOf(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/** 调度表里按 ref 找 due */
function dueMap(fsrsCards = []) {
  const map = new Map();
  for (const record of fsrsCards) {
    map.set(`${record.ref_type}::${record.ref_id}`, record);
  }
  return map;
}

/** 知识卡 → 测验卡 */
function cardToQuizItem(card, {scheduled}) {
  const point = knowledgePointOf(card);
  const wrongId = card.wrong_question_id
    || (Array.isArray(card.sourceCaseIds) && card.sourceCaseIds.length ? card.sourceCaseIds[0] : null);
  const stability = scheduled && scheduled.card ? scheduled.card.stability : stabilityOf(card);
  return {
    ref_type: REF_TYPE.knowledgeCard,
    ref_id: card.id,
    kind: 'card',
    subject: subjectOf(card),
    knowledgePoint: point,
    knowledge_point_id: card.knowledge_point_id || null,
    // ---- 正面 ----
    front: {
      knowledgePoint: point,
      subject: subjectOf(card),
      wrongQuestionId: wrongId || null,
      // 显式保存的正面内容（包括空字符串）必须尊重用户勾选；仅旧卡缺字段时才兼容生成提示。
      cue: card.frontContent !== undefined && card.frontContent !== null
        ? String(card.frontContent).trim()
        : `你能用自己的话解释「${point}」，并说出它的适用条件吗？`
    },
    // ---- 背面 ----
    back: {
      myUnderstanding: String(card.backContent || card.content || card.insight || '').slice(0, 8000),
      aiExplanation: card.backContent ? '' : String(card.ai_explanation || '').slice(0, 1200),
      nextTimeAction: String(card.nextTimeAction || '').slice(0, 200),
      memoryHook: String(card.memoryHook || '').slice(0, 200)
    },
    mastery: masteryFromStability(stability),
    dueAt: (scheduled && scheduled.dueAt) || (card.reviewSchedule && card.reviewSchedule.dueAt) || null,
    intervalDays: scheduled ? scheduled.intervalDays : (card.reviewSchedule && card.reviewSchedule.intervalDays) || 0,
    overdueDays: 0,
    hasAuthorNote: Boolean(String(card.content || card.insight || '').trim())
  };
}

/**
 * 构建滚动测验队列。
 * 排序：从未复习过的排最前，其次按 due 由早到晚（越逾期越靠前）。
 */
export function buildRollingQuiz({
  knowledgeCards = [], cases = [], fsrsCards = [],
  subject = SUBJECT_ALL, now = new Date(), limit = 60
} = {}) {
  const scheduled = dueMap(fsrsCards);
  const matches = item => subject === SUBJECT_ALL || subjectOf(item) === subject;
  const items = [];

  for (const card of knowledgeCards) {
    if (!matches(card)) continue;
    const record = scheduled.get(`${REF_TYPE.knowledgeCard}::${card.id}`) || null;
    items.push(cardToQuizItem(card, {scheduled: record}));
  }

  for (const item of items) {
    const stamp = stampOf(item.dueAt);
    item.dueStamp = stamp;
    item.overdueDays = stamp === null ? 0 : Math.max(0, Number(((now.getTime() - stamp) / 86400000).toFixed(2)));
    item.neverReviewed = stamp === null;
  }

  items.sort((a, b) => {
    // 1) 从未复习过的排最前
    if (a.neverReviewed !== b.neverReviewed) return a.neverReviewed ? -1 : 1;
    // 2) 其余按 due 由早到晚
    if (a.dueStamp !== b.dueStamp) return (a.dueStamp || 0) - (b.dueStamp || 0);
    // 3) 掌握度低的优先
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return String(a.ref_id).localeCompare(String(b.ref_id));
  });

  const subjects = [...new Set(knowledgeCards.map(subjectOf))].filter(Boolean).sort();
  const dueItems = items.filter(item => item.neverReviewed || (item.dueStamp !== null && item.dueStamp <= now.getTime()));
  const queue = (dueItems.length ? dueItems : items).slice(0, Math.max(1, limit));

  return {
    subject,
    generatedAt: now.toISOString(),
    options: QUIZ_OPTIONS,
    subjects,
    stats: {
      total: items.length,
      due: dueItems.length,
      cards: queue.filter(item => item.kind === 'card').length,
      mistakes: 0,
      neverReviewed: items.filter(item => item.neverReviewed).length
    },
    items: queue
  };
}

/**
 * 学生读完之后是否该请他写「我的理解」。
 * 需求：复习评分 >= 3 后提示。
 */
export function shouldAskUnderstanding({rating, alreadyHasCard = false, trigger = 'review_passed'} = {}) {
  if (alreadyHasCard) return false;
  return Number(rating) >= 3 && ['review_passed', 'answer_correct', 'tutor_complete', 'self_complete', 'transfer'].includes(trigger);
}

/** 复习一轮后的汇总 */
export function summarizeRolling(records = []) {
  const total = records.length;
  const forgot = records.filter(item => item.action === 'forgot').length;
  const fuzzy = records.filter(item => Number(item.rating) === 2).length;
  const passed = records.filter(item => Number(item.rating) >= 3).length;
  return {
    total,
    passed,
    fuzzy,
    forgot,
    // 「刚忘掉了」不算错，它只是排回今天的队列
    accuracy: total ? Number((passed / total * 100).toFixed(1)) : 0,
    needsUnderstanding: passed > 0
  };
}
