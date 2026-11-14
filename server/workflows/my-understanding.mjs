// 「我的理解」卡片
//
// 学生把知识点用「自己的话」讲出来，这段自述会被固化成一张 KnowledgeCard，
// 立刻进入个人 FSRS 复习队列 —— 这是从「做对题」到「真的懂了」的关键一步。
//
// 触发时机（按需求，四个入口）：
//   1. tutor_complete  AI 陪练完成后
//   2. answer_correct  系统检测到学生已经说出正确答案
//   3. self_complete   学生自己点了「已完成」
//   4. transfer        二阶 / 三阶迁移环节中弹出
//
// 独立模块：不 import 项目既有 workflow。
import {randomUUID} from 'node:crypto';

/** 四个触发入口 */
export const UNDERSTANDING_TRIGGERS = Object.freeze([
  {
    key: 'tutor_complete',
    label: 'AI 陪练完成',
    hint: '刚才这题是你一步步推出来的，现在把它压缩成一句话。'
  },
  {
    key: 'answer_correct',
    label: 'AI 判定答对',
    hint: '你已经说出正确答案了，趁热把它变成自己的话。'
  },
  {
    key: 'self_complete',
    label: '学生标记已完成',
    hint: '你标记了已完成，用一句话把这次的理解固定下来。'
  },
  {
    key: 'transfer',
    label: '迁移环节（二阶 / 三阶）',
    hint: '同一个方法换到新题也能用，说明你已经抽出规律了 —— 写下来。'
  }
]);

export function isUnderstandingTrigger(key) {
  return UNDERSTANDING_TRIGGERS.some(item => item.key === key);
}

/**
 * 是否应该弹出「我的理解」输入框。
 * 学生已经写过同一个知识点的理解时不重复打扰（除非他主动要求）。
 */
export function shouldPromptUnderstanding({trigger, alreadyHasCard = false, force = false} = {}) {
  if (force) return true;
  if (!isUnderstandingTrigger(trigger)) return false;
  return !alreadyHasCard;
}

/** 生成给学生看的引导语 */
export function buildUnderstandingPrompt({knowledgePoint, subject = '数学', trigger = 'tutor_complete', caseQuestion = ''} = {}) {
  const meta = UNDERSTANDING_TRIGGERS.find(item => item.key === trigger) || UNDERSTANDING_TRIGGERS[0];
  const point = String(knowledgePoint || '').trim() || '这个知识点';
  const question = String(caseQuestion || '').trim().slice(0, 60);
  return {
    trigger: meta.key,
    triggerLabel: meta.label,
    knowledgePoint: point,
    subject,
    question: `${meta.hint}\n\n用你自己的话，总结一下「${point}」：它是解决什么问题的？关键判断是什么？下次遇到同类题你第一步会做什么？`,
    placeholder: '例如：看到线面角，先把斜线投影到平面上，再在直角三角形里用对边比斜边……',
    sourceQuestion: question,
    // 学生可以点「暂时跳过」，但跳过会被记录，方便以后补
    allowSkip: true
  };
}

/** 保存前的校验与清洗 */
export function normalizeUnderstanding(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return {
    text: value,
    length: value.length,
    // 太短说明还没真正表达清楚，前端据此提示「再多说一点」
    tooShort: value.length < 8,
    ok: value.length >= 8
  };
}

/** 知识点的稳定标识：同一个知识点在不同卡片/错题上得到同一个 id */
export function knowledgePointId(point) {
  const text = String(point == null ? '' : point).trim();
  if (!text) return 'kp:unknown';
  return 'kp:' + text.replace(/\s+/g, '').slice(0, 60);
}

/**
 * 把学生的自述固化成一张 KnowledgeCard。
 * 结构与项目现有 knowledge-card-engine 产出的卡片保持一致，
 * 额外挂一个 fsrs 字段存放 py-fsrs 的调度状态。
 */
export function toKnowledgeCard({
  text,
  knowledgePoint,
  subject = '数学',
  sourceCaseIds = [],
  evidenceRefs = [],
  trigger = 'self_complete',
  title = '',
  nextTimeAction = '',
  frontContent,
  sourceQuestion = '',
  backContent = '',
  now = new Date(),
  idFactory = randomUUID,
  studentId = 'local-student',
  aiExplanation = ''
} = {}) {
  const normalized = normalizeUnderstanding(text);
  if (!normalized.ok) {
    const error = new Error('学生对知识点的自述太短，无法形成卡片');
    error.code = 'UNDERSTANDING_TOO_SHORT';
    error.length = normalized.length;
    throw error;
  }
  const point = String(knowledgePoint || '').trim() || '未归类的知识点';
  const created = now instanceof Date ? now : new Date(now);
  const iso = created.toISOString();
  const sentence = normalized.text.slice(0, 600);
  const answer = String(backContent || sentence).trim().slice(0, 8000);
  /* 正面内容的取值顺序（2026-10-05「正面内容整批丢失」事故后定死，别再退回旧写法）：
     1. 前端明确给的正面素材；
     2. 前端没给、或者只给了空串/空白 —— 用 sourceCaseIds 反查到的原题干回填「题目：…」并附知识点。
        空串绝不能原样落库：那会让 challengePrompt 变成空字符串，前端再兜一层，
        把「正面丢了」伪装成一句正常提问。
     3. 连原题干都查不到，才退回通用回忆线索，并用 frontSource 标出这是兜底。 */
  const explicitFront = String(frontContent === undefined || frontContent === null ? '' : frontContent).trim();
  const sourceQuestionText = String(sourceQuestion || '').trim();
  const hasRealPoint = point !== '未归类的知识点';
  const backfilledFront = [
    sourceQuestionText ? `题目：${sourceQuestionText}` : '',
    hasRealPoint ? `知识点：${point}` : ''
  ].filter(Boolean).join('\n\n');
  const frontSource = explicitFront ? 'client' : (sourceQuestionText ? 'source-case' : 'generic-fallback');
  // 兜底句不再写成一句像样的提问（旧的「你还记得自己怎么理解「X」的吗？」会把
  // 「正面丢了」伪装成正常显示），只给一条中性的回忆线索。
  const cue = (explicitFront || backfilledFront || `回忆「${point}」的关键结论和第一步做法。`).slice(0, 8000);
  const authorId = String(studentId || 'local-student');
  return {
    id: idFactory(),
    /* ---- 规范字段：与 knowledge_cards 表结构一致 ---- */
    content: answer,                                    // 兼容旧卡字段；背面内容为学生确认的卡片答案
    ai_explanation: String(aiExplanation || '').slice(0, 1200), // 下栏「AI 补充」= 标准解析
    knowledge_point_id: knowledgePointId(point),        // 知识点标识
    wrong_question_id: Array.isArray(sourceCaseIds) && sourceCaseIds.length ? sourceCaseIds[0] : null,
    author_id: authorId,
    created_at: iso,
    /* ---- 兼容项目既有字段 ---- */
    studentId: authorId,
    subject,
    knowledgePoint: point,
    microSkill: title || `${point}的自述理解`,
    cardKind: 'self-explanation',
    title: String(title || sentence.slice(0, 40)),
    // 滚动测验的出题面 = 学生自己写的话，做成回忆线索
    challengePrompt: cue,
    frontContent: cue,
    // 正面内容从哪来：client / source-case / generic-fallback。排查时先看它，别靠猜。
    frontSource,
    backContent: answer,
    insight: answer,
    nextTimeAction: String(nextTimeAction || '下次先按自己的话复述一遍，再去套公式。'),
    evidenceRefs,
    sourceCaseIds,
    sourceQuotes: [answer],
    recurrenceCount: 1,
    starredAsRecurring: false,
    favorite: false,
    masteryStatus: 'learning',
    // 与项目既有字段兼容：先按「今天到期」入队，真正调度交给 FSRS
    reviewSchedule: {dueAt: iso, intervalDays: 0, streak: 0, lastResult: null},
    origin: 'my-understanding',
    understandingTrigger: isUnderstandingTrigger(trigger) ? trigger : 'self_complete',
    createdAt: iso,
    updatedAt: iso,
    // py-fsrs 的调度状态（首次复习时由 fsrs_bridge 填充）
    fsrs: null
  };
}

/** 把一张卡片上的 FSRS 结果写回去 */
export function attachFsrsState(card, scheduled) {
  if (!card) return card;
  const stability = scheduled && Number(scheduled.stability);
  const dueAt = scheduled && scheduled.dueAt;
  return {
    ...card,
    fsrs: scheduled || null,
    masteryStatus: Number.isFinite(stability) && stability >= 14 ? 'mastered' : 'learning',
    reviewSchedule: {
      ...(card.reviewSchedule || {}),
      dueAt: dueAt || (card.reviewSchedule && card.reviewSchedule.dueAt) || null,
      intervalDays: scheduled && Number.isFinite(Number(scheduled.intervalDays)) ? Number(scheduled.intervalDays) : (card.reviewSchedule && card.reviewSchedule.intervalDays) || 0,
      lastResult: scheduled && scheduled.rating ? (Number(scheduled.rating) >= 3 ? 'correct' : 'incorrect') : (card.reviewSchedule && card.reviewSchedule.lastResult) || null,
      lastReviewedAt: scheduled ? new Date().toISOString() : (card.reviewSchedule && card.reviewSchedule.lastReviewedAt) || null
    },
    updatedAt: new Date().toISOString()
  };
}
