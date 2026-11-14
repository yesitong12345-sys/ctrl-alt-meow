// FSRS 调度表（fsrs_cards）
//
// 设计：一张调度表服务所有可复习对象，用 ref_type + ref_id 指向被调度的东西。
//   ref_type = 'knowledge_card'  -> ref_id 是 knowledgeCards[].id
//   ref_type = 'wrong_question'  -> ref_id 是 cases[].id
// card 字段保存 py-fsrs 的原始状态（card_id/state/step/stability/difficulty/due/last_review）。
//
// 这样「知识卡片队列」和「错题队列」天然共用同一套排程与同一个入口。
//
// 独立模块：不 import 项目既有 workflow。
import {randomUUID} from 'node:crypto';

export const REF_TYPE = Object.freeze({
  knowledgeCard: 'knowledge_card',
  wrongQuestion: 'wrong_question'
});

export const REF_TYPES = Object.freeze([REF_TYPE.knowledgeCard, REF_TYPE.wrongQuestion]);

/** 初始化调度表；老数据里挂在卡片/错题上的 fsrs 状态会被迁移进来 */
export function ensureFsrsTables(db, {now = new Date()} = {}) {
  if (!db) return {created: 0, migrated: 0};
  db.fsrsCards = Array.isArray(db.fsrsCards) ? db.fsrsCards : [];
  db.reviewEvents = Array.isArray(db.reviewEvents) ? db.reviewEvents : [];

  let migrated = 0;
  const index = new Map(db.fsrsCards.map(item => [`${item.ref_type}::${item.ref_id}`, item]));

  const adopt = (refType, refId, userId, scheduled, fallbackDueAt) => {
    if (!scheduled && !fallbackDueAt) return;
    const key = `${refType}::${refId}`;
    if (index.has(key)) return;
    const card = scheduled && scheduled.card ? scheduled.card : (scheduled && scheduled.card_id != null ? scheduled : null);
    const record = {
      id: randomUUID(),
      ref_type: refType,
      ref_id: refId,
      user_id: userId || 'local-student',
      card: card || null,
      dueAt: (scheduled && scheduled.dueAt) || fallbackDueAt || null,
      intervalDays: (scheduled && scheduled.intervalDays) || 0,
      stability: (scheduled && scheduled.stability) ?? (card && card.stability) ?? null,
      difficulty: (scheduled && scheduled.difficulty) ?? (card && card.difficulty) ?? null,
      state: (scheduled && scheduled.state) || (card ? String(card.state) : null),
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };
    db.fsrsCards.push(record);
    index.set(key, record);
    migrated += 1;
  };

  // 迁移：知识卡上挂着的 fsrs
  for (const card of (db.knowledgeCards || [])) {
    if (card && card.fsrs) adopt(REF_TYPE.knowledgeCard, card.id, card.user_id || card.studentId, card.fsrs, card.fsrs.dueAt);
  }
  // 迁移：错题 learningProfile 上挂着的 fsrs
  for (const record of (db.cases || [])) {
    const profile = (record && record.learningProfile) || {};
    if (profile.fsrs) adopt(REF_TYPE.wrongQuestion, record.id, record.user_id || record.studentId, profile.fsrs, profile.dueAt);
  }

  return {created: db.fsrsCards.length, migrated};
}

const keyOf = (refType, refId) => `${refType}::${refId}`;

export function findFsrsCard(db, refType, refId) {
  ensureFsrsTables(db);
  return db.fsrsCards.find(item => item.ref_type === refType && item.ref_id === refId) || null;
}

/** 取出可直接喂给 py-fsrs 的 card 对象 */
export function fsrsStateOf(db, refType, refId) {
  const record = findFsrsCard(db, refType, refId);
  return record ? record.card || null : null;
}

/** 写入一次评分结果（这是唯一会改动 FSRS 长期调度的地方） */
export function upsertFsrsCard(db, {refType, refId, userId = 'local-student', scheduled, now = new Date()} = {}) {
  ensureFsrsTables(db, {now});
  let record = findFsrsCard(db, refType, refId);
  if (!record) {
    record = {
      id: randomUUID(),
      ref_type: refType,
      ref_id: refId,
      user_id: userId,
      card: null,
      dueAt: null,
      intervalDays: 0,
      stability: null,
      difficulty: null,
      state: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };
    db.fsrsCards.push(record);
  }
  record.card = scheduled.card || record.card;
  record.dueAt = scheduled.dueAt || record.dueAt;
  record.intervalDays = Number.isFinite(Number(scheduled.intervalDays)) ? Number(scheduled.intervalDays) : record.intervalDays;
  record.stability = scheduled.stability ?? record.stability;
  record.difficulty = scheduled.difficulty ?? record.difficulty;
  record.state = scheduled.state || record.state;
  record.lastRating = scheduled.rating ?? record.lastRating ?? null;
  record.lastReviewedAt = now.toISOString();
  record.updated_at = now.toISOString();
  return record;
}

/** 到期（或从未复习）的调度记录 */
export function dueFsrsCards(db, {now = new Date(), refType = null, userId = null} = {}) {
  ensureFsrsTables(db, {now});
  return db.fsrsCards.filter(record => {
    if (refType && record.ref_type !== refType) return false;
    if (userId && record.user_id !== userId) return false;
    if (!record.dueAt) return true;                 // 从未复习过 -> 立即入队
    const stamp = new Date(record.dueAt).getTime();
    if (Number.isNaN(stamp)) return true;
    return stamp <= now.getTime();
  });
}

export function dueCount(db, {now = new Date(), refType = null} = {}) {
  return dueFsrsCards(db, {now, refType}).length;
}

/**
 * 「对不起我刚忘掉了」：把卡片重新排进今天的队列。
 * 关键 —— **不调用 py-fsrs、不写 FSRS 状态**，只记一条事件。
 * 这样一次误判不会把复习间隔打回原形（区别于 Rating.Again = 1）。
 */
export function recordForgetRepeat(db, {refType, refId, userId = 'local-student', now = new Date(), source = 'rolling-quiz'} = {}) {
  ensureFsrsTables(db, {now});
  const event = {
    id: randomUUID(),
    type: 'review_forgot_repeat',
    ref_type: refType,
    ref_id: refId,
    user_id: userId,
    source,
    // 明确标注：本次没有改动长期调度
    fsrsTouched: false,
    dueAtBefore: (findFsrsCard(db, refType, refId) || {}).dueAt || null,
    createdAt: now.toISOString()
  };
  db.reviewEvents.push(event);
  return event;
}

/** 统计某张卡今天被「刚忘掉了」喊回队列几次（前端据此避免死循环） */
export function forgetRepeatCountToday(db, {refType, refId, now = new Date()} = {}) {
  ensureFsrsTables(db, {now});
  const day = now.toISOString().slice(0, 10);
  return db.reviewEvents.filter(event =>
    event.type === 'review_forgot_repeat'
    && event.ref_type === refType
    && event.ref_id === refId
    && String(event.createdAt).slice(0, 10) === day
  ).length;
}

/** 调度表概览（健康检查 / 首页计数用） */
export function fsrsTableStats(db, {now = new Date()} = {}) {
  ensureFsrsTables(db, {now});
  const byType = {};
  for (const type of REF_TYPES) {
    const all = db.fsrsCards.filter(item => item.ref_type === type);
    byType[type] = {
      total: all.length,
      due: dueFsrsCards(db, {now, refType: type}).length,
      tracked: all.filter(item => item.card && item.card.stability).length
    };
  }
  return {byType, total: db.fsrsCards.length, due: dueFsrsCards(db, {now}).length};
}
