// 学习归纳 / 复习队列 / 我的理解 —— 独立路由模块
//
// 设计目标：**完全不改 server.mjs 的内部逻辑**，只由它在请求分发处挂一行：
//
//     import {createStudyRouter} from './workflows/study-routes.mjs';
//     const handleStudy = createStudyRouter({db, persist, canAccess: canAccessPersonalRecord});
//     // ...在 404 之前：
//     if (await handleStudy(req, res, url)) return;
//
// 对外接口：
//   GET  /v1/study/summary                     归纳页（热力图/错因分布/今日置顶/学科-知识点/雷达图）
//   GET  /v1/study/review-queue?subject=all    复习队列（全科混合或单科）
//   GET  /v1/study/rolling-quiz?subject=all    卡片滚动测验队列（按 due 排序）
//   POST /v1/study/review                      评分 → py-fsrs 调度（写入 fsrs_cards 表）
//   POST /v1/study/forgot                      「刚忘掉了」重新排队，不改动 FSRS 长期调度
//   GET  /v1/study/rating-hints/:cardId        评分按钮上的间隔提示
//   GET  /v1/study/understanding-prompt        取「我的理解」引导语
//   POST /v1/study/understanding               保存「我的理解」为 KnowledgeCard
//   GET  /v1/study/taxonomy                    学科 → 知识点 逐层
//   GET  /v1/study/radar                       雷达图数据
//   GET  /v1/study/fsrs-table                  fsrs_cards 表概览
//   GET  /v1/study/fsrs-health                 FSRS 桥健康检查
import {randomUUID} from 'node:crypto';
import {buildSummary, buildTaxonomy, buildRadar, buildHeatmap, knowledgePointOf} from './learning-summary.mjs';
import {buildQueue, rateCard, ratingHints, summarizeSession, SUBJECT_ALL, RATINGS} from './review-queue.mjs';
import {fsrsHealth, masteryFromStability} from './fsrs-scheduler.mjs';
import {
  UNDERSTANDING_TRIGGERS, buildUnderstandingPrompt, shouldPromptUnderstanding,
  toKnowledgeCard, attachFsrsState, isUnderstandingTrigger
} from './my-understanding.mjs';
import {
  REF_TYPE, ensureFsrsTables, findFsrsCard, fsrsStateOf, upsertFsrsCard,
  dueFsrsCards, recordForgetRepeat, forgetRepeatCountToday, fsrsTableStats
} from './fsrs-store.mjs';
import {buildRollingQuiz, QUIZ_OPTIONS, shouldAskUnderstanding, summarizeRolling} from './rolling-quiz.mjs';
import {graphForUser} from './knowledge-graph.mjs';
import {fallbackRelationTip, relationMetaFor, relationTipText} from './kg-relation-tip.mjs';

/* 知识网络图只在「真有人要读它」的时候才算。
   以前服务端每次 persist() 都会全量重建（遍历全部用户的全部错题），
   于是「共享广场发一张卡」这种跟知识网络毫无关系的操作，也会把所有人的错题重算一遍。
   现在由 server.mjs 提供一个懒重建入口：读图时若是脏的就重建，否则直接给缓存。
   老调用方（测试里直接塞 db.graph 的）没有这个方法，就退回读 db.graph。 */
function currentGraph(db) {
  if (db && typeof db.graphNow === 'function') return db.graphNow();
  return db && db.graph;
}


/* 知识网络连线支持的三种关系，与图上颜色一一对应。 */
const RELATION_TYPES = new Set(['DEPENDS_ON', 'CONFUSES_WITH', 'CO_OCCURS_WITH', 'RELATED_TO']);

export const STUDY_ROUTE_PREFIX = '/v1/study';

export const STUDY_ROUTES = Object.freeze([
  {method: 'GET', path: '/v1/study/summary', desc: '归纳页聚合数据（含学科-知识点与雷达图）'},
  {method: 'GET', path: '/v1/study/review-queue', desc: '复习队列（支持 subject / knowledgePoint 筛选，按错误频次×权重×时间衰减排序）'},
  {method: 'GET', path: '/v1/study/rolling-quiz', desc: '卡片滚动测验队列（按 due 排序）'},
  {method: 'GET', path: '/v1/study/daily-plan-preferences', desc: '读取本人今日学科与知识点选择'},
  {method: 'PUT', path: '/v1/study/daily-plan-preferences', desc: '保存本人每日知识点数量与闯关模式'},
  {method: 'POST', path: '/v1/study/review', desc: '评分并交给 py-fsrs 调度，写入 fsrs_cards'},
  {method: 'POST', path: '/v1/study/forgot', desc: '「刚忘掉了」重新排队，不改动长期调度'},
  {method: 'GET', path: '/v1/study/rating-hints/:cardId', desc: '评分按钮上的间隔提示'},
  {method: 'GET', path: '/v1/study/understanding-prompt', desc: '「我的理解」引导语'},
  {method: 'POST', path: '/v1/study/understanding', desc: '保存「我的理解」卡片'},
  {method: 'GET', path: '/v1/study/taxonomy', desc: '学科 → 知识点 逐层浏览'},
  {method: 'POST', path: '/v1/study/knowledge-graph/relation-tip', desc: '点知识网络连线时，给出两个知识点的 AI 衔接提示卡'},
  {method: 'POST', path: '/v1/study/knowledge-graph/relation-card', desc: '把衔接提示卡导入知识闯关（存成知识卡并进 FSRS 复习队列）'},
  {method: 'GET', path: '/v1/study/radar', desc: '雷达图数据'},
  {method: 'GET', path: '/v1/study/fsrs-table', desc: 'fsrs_cards 表概览'},
  {method: 'GET', path: '/v1/study/fsrs-health', desc: 'FSRS 桥健康检查'}
]);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req, limitBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch (error) { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

/** 只保留今天或更早到期的卡片，用于「今日待复习」计数 */
function isDueToday(value, now) {
  if (!value) return true;
  const stamp = new Date(value).getTime();
  if (Number.isNaN(stamp)) return true;
  return stamp <= now.getTime();
}

export function normalizeDailyPlanPreferences(input = {}) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const counts = {};
  for (const [subject, value] of Object.entries(object(input.counts)).slice(0, 20)) {
    if (!subject || subject.length > 30) continue;
    const amount = Number(value);
    counts[subject] = Number.isFinite(amount) ? Math.max(0, Math.min(10, Math.floor(amount))) : 2;
  }
  const subjectOrder = Array.isArray(input.subjectOrder)
    ? [...new Set(input.subjectOrder.filter(value => typeof value === 'string' && value.length > 0 && value.length <= 30))].slice(0, 20)
    : [];
  const lists = source => {
    const result = {};
    for (const [subject, values] of Object.entries(object(source)).slice(0, 20)) {
      if (!subject || subject.length > 30 || !Array.isArray(values)) continue;
      result[subject] = [...new Set(values.filter(value => typeof value === 'string' && value.length <= 160))].slice(0, 50);
    }
    return result;
  };
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.selectedDate || '')) ? input.selectedDate : '';
  return {
    counts,
    subjectOrder,
    pinned: lists(input.pinned),
    excluded: lists(input.excluded),
    selectedDate,
    focusSubject: String(input.focusSubject || 'all').slice(0, 30),
    challengeMode: input.challengeMode === 'single' ? 'single' : 'all',
    challengeSubject: String(input.challengeSubject || '').slice(0, 30)
  };
}

/**
 * 创建路由处理器。
 * @param {object} deps
 * @param {object} deps.db          服务端数据对象（直接读写，与既有路由一致）
 * @param {Function} deps.persist   持久化函数
 * @param {Function} [deps.clock]   取当前时间
 * @param {Function} [deps.canAccess] 记录可见性判断（沿用项目的 canAccessPersonalRecord）
 */
export function createStudyRouter({db, persist, clock = () => new Date(), canAccess = () => true,
  requestBody = null, currentUserId = 'local-student', relationTipAdapter = null} = {}) {
  /* 同一对知识点只问一次模型；换用户/换关系类型各自缓存。 */
  const relationTipCache = new Map();
  if (!db) throw new Error('createStudyRouter 需要 db');

  const visible = list => (Array.isArray(list) ? list.filter(item => canAccess(item)) : []);
  const save = async () => { if (typeof persist === 'function') await persist(); };

  /* 复习队列里既有知识卡也有错题。错题没有独立的 FSRS 卡，
     就把 FSRS 状态挂在它自己的 learningProfile.fsrs 上，两者共用同一套 py-fsrs 调度。
     否则错题评分会 404 —— 队列里一半的项点不动。 */
  const resolveReviewTarget = cardId => {
    ensureFsrsTables(db);
    const cardIndex = (db.knowledgeCards || []).findIndex(card => card.id === cardId && canAccess(card));
    if (cardIndex >= 0) {
      const refType = REF_TYPE.knowledgeCard;
      return {
        kind: 'card', refType, refId: cardId, index: cardIndex,
        fsrs: fsrsStateOf(db, refType, cardId) || db.knowledgeCards[cardIndex].fsrs || null
      };
    }
    const caseIndex = (db.cases || []).findIndex(item => item.id === cardId && canAccess(item));
    if (caseIndex >= 0) {
      const refType = REF_TYPE.wrongQuestion;
      const profile = db.cases[caseIndex].learningProfile || {};
      return {
        kind: 'mistake', refType, refId: cardId, index: caseIndex,
        fsrs: fsrsStateOf(db, refType, cardId) || profile.fsrs || null
      };
    }
    return null;
  };

  return async function handleStudyRequest(req, res, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith(STUDY_ROUTE_PREFIX)) return false;

    const now = clock();
    const method = String(req.method || 'GET').toUpperCase();

    try {
      if (method === 'GET' && pathname === '/v1/study/knowledge-graph') {
    const graph = graphForUser(currentGraph(db), currentUserId);
        sendJson(res, 200, graph);
        return true;
      }
      /* 点知识网络上的连线：给出这两个知识点的衔接提示卡。
         已经生成过的直接回缓存；没配密钥时回本地兜底卡片，不留空面板。 */
      if (method === 'POST' && pathname === '/v1/study/knowledge-graph/relation-tip') {
        const body = requestBody === null ? await readJson(req) : requestBody;
    const graph = graphForUser(currentGraph(db), currentUserId);
        const nodeById = new Map((graph.nodes || []).map(node => [node.id, node]));
        const pointA = String(body.pointA || ''), pointB = String(body.pointB || '');
        const nodeA = nodeById.get(pointA), nodeB = nodeById.get(pointB);
        if (!nodeA || !nodeB) { sendJson(res, 404, {error: 'KNOWLEDGE_POINT_NOT_FOUND'}); return true; }
        const relationType = RELATION_TYPES.has(body.relationType) ? body.relationType : 'RELATED_TO';
        const edge = (graph.edges || []).find(item => item.type === relationType
          && ((item.source === pointA && item.target === pointB) || (item.source === pointB && item.target === pointA)));
        const frequency = Number(edge?.frequency ?? body.frequency) || 1;
        const base = fallbackRelationTip({pointA: nodeA.name, pointB: nodeB.name, relationType, frequency, subject: nodeA.subject});
        const cacheKey = `${currentUserId}|${relationType}|${[pointA, pointB].sort().join(':')}`;
        /* 生成一张要 9~14 秒，所以落库缓存：同一对学生第二次点开是秒开，重启也不丢。
           内存缓存只是省一次查库。 */
        db.kgRelationTips = Array.isArray(db.kgRelationTips) ? db.kgRelationTips : [];
        const stored = db.kgRelationTips.find(item => item.key === cacheKey);
        if (stored && stored.tip) relationTipCache.set(cacheKey, stored.tip);
        /* 区分两种"不是 AI 写的"：
           - ai_not_configured：服务端真的没配密钥（这时才该告诉学生是配置问题）
           - ai_failed：配了但这次没成功（把真实原因带上，别谎报"没密钥"） */
        let tipSource = 'ai';
        if (!relationTipCache.has(cacheKey)) {
          if (typeof relationTipAdapter !== 'function') {
            relationTipCache.set(cacheKey, {...base, source: 'ai_not_configured'});
          } else {
            try {
              const generated = await relationTipAdapter(base);
              relationTipCache.set(cacheKey, generated);
              db.kgRelationTips = [{key: cacheKey, user_id: currentUserId, pointA: nodeA.name, pointB: nodeB.name,
                relationType, tip: generated, updatedAt: now.toISOString()},
                ...db.kgRelationTips.filter(item => item.key !== cacheKey)].slice(0, 2000);
              await save();
            } catch (error) {
              tipSource = 'ai_failed';
              relationTipCache.set(cacheKey, {...base, source: 'ai_failed', aiError: String(error?.message || error).slice(0, 120)});
            }
          }
        }
        const tip = relationTipCache.get(cacheKey) || base;
        const caseIds = [...new Set([...(edge?.caseIds || []), ...(nodeA.caseIds || []), ...(nodeB.caseIds || [])])].slice(0, 30);
        const relatedCases = caseIds
          .map(id => (db.cases || []).find(item => item.id === id && canAccess(item)))
          .filter(Boolean)
          .map(item => ({id: item.id, question: String(item.question || '').slice(0, 60), subject: item.subject || ''}));
        sendJson(res, 200, {...tip, relatedCases, cached: relationTipCache.has(cacheKey)});
        return true;
      }
      /* 把这张衔接提示卡导入知识闯关（= 存成知识卡并进 FSRS 复习队列） */
      if (method === 'POST' && pathname === '/v1/study/knowledge-graph/relation-card') {
        const body = requestBody === null ? await readJson(req) : requestBody;
    const graph = graphForUser(currentGraph(db), currentUserId);
        const nodeById = new Map((graph.nodes || []).map(node => [node.id, node]));
        const nodeA = nodeById.get(String(body.pointA || '')), nodeB = nodeById.get(String(body.pointB || ''));
        if (!nodeA || !nodeB) { sendJson(res, 404, {error: 'KNOWLEDGE_POINT_NOT_FOUND'}); return true; }
        const relationType = RELATION_TYPES.has(body.relationType) ? body.relationType : 'RELATED_TO';
        const meta = relationMetaFor(relationType);
        const tip = body.tip && typeof body.tip === 'object' ? body.tip : null;
        const text = body.text ? String(body.text) : (tip ? relationTipText({
          headline: String(tip.headline || ''), body: String(tip.body || ''), solution: String(tip.solution || ''),
          tip: String(tip.tip || ''), pitfall: String(tip.pitfall || ''), pointA: nodeA.name, pointB: nodeB.name,
        }) : '');
        let card;
        try {
          card = toKnowledgeCard({
            text,
            knowledgePoint: `${nodeA.name} × ${nodeB.name}`,
            subject: body.subject || nodeA.subject || '数学',
            sourceCaseIds: Array.isArray(body.caseIds) ? body.caseIds.slice(0, 10) : [],
            trigger: 'self_complete',
            title: `${nodeA.name} 与 ${nodeB.name} 的${meta.label}关系`,
            nextTimeAction: String(tip?.solution || tip?.tip || '').slice(0, 200),
            now,
            studentId: currentUserId,
            aiExplanation: String(body.aiExplanation || tip?.body || '').slice(0, 1200),
          });
        } catch (error) {
          if (error.code === 'UNDERSTANDING_TOO_SHORT') {
            sendJson(res, 422, {error: 'RELATION_CARD_TOO_SHORT', message: '这张卡片内容太短，先展开提示卡再导入。'});
            return true;
          }
          throw error;
        }
        card.cardKind = 'relation-tip';
        card.origin = 'knowledge-graph-relation';
        card.relationType = relationType;
        card.relationLabel = meta.label;
        card.pointA = nodeA.name;
        card.pointB = nodeB.name;
        card.studentId = currentUserId;
        card.user_id = currentUserId;
        db.knowledgeCards = Array.isArray(db.knowledgeCards) ? db.knowledgeCards : [];
        db.knowledgeCards.unshift(card);
        ensureFsrsTables(db, {now});
        const scheduled = upsertFsrsCard(db, {
          refType: REF_TYPE.knowledgeCard, refId: card.id, userId: currentUserId,
          scheduled: {card: null, dueAt: card.reviewSchedule && card.reviewSchedule.dueAt, intervalDays: 0, stability: null, difficulty: null, state: 'New'},
          now,
        });
        await save();
        sendJson(res, 201, {card, queued: true,
          fsrsCard: scheduled ? {id: scheduled.id, dueAt: scheduled.dueAt} : null,
          message: `已导入知识闯关：${nodeA.name} × ${nodeB.name}`});
        return true;
      }
      if (method === 'GET' && pathname === '/v1/study/daily-plan-preferences') {
        const record = (db.dailyStudyPlanPreferences || []).find(item => item.user_id === currentUserId);
        sendJson(res, 200, {preferences: record ? normalizeDailyPlanPreferences(record.preferences) : null});
        return true;
      }
      if (method === 'PUT' && pathname === '/v1/study/daily-plan-preferences') {
        const body = requestBody === null ? await readJson(req) : requestBody;
        const preferences = normalizeDailyPlanPreferences(body);
        db.dailyStudyPlanPreferences = Array.isArray(db.dailyStudyPlanPreferences) ? db.dailyStudyPlanPreferences : [];
        const index = db.dailyStudyPlanPreferences.findIndex(item => item.user_id === currentUserId);
        const record = {user_id: currentUserId, preferences, updatedAt: now.toISOString()};
        if (index < 0) db.dailyStudyPlanPreferences.push(record);
        else db.dailyStudyPlanPreferences[index] = record;
        await save();
        sendJson(res, 200, {preferences});
        return true;
      }
      // ---------- 归纳页 ----------
      if (method === 'GET' && pathname === '/v1/study/summary') {
        const examDate = url.searchParams.get('examDate') || null;
        const summary = buildSummary({
          cases: visible(db.cases),
          knowledgeCards: visible(db.knowledgeCards),
          tutorSessions: visible(db.tutorSessions),
          noteSources: visible(db.noteSources),
          ingestions: visible(db.ingestions),
          knowledgeCardReviews: visible(db.knowledgeCardReviews),
          now,
          examDate,
          // 老师/系统标注的知识点权重：优先级公式里的「知识点权重」
          knowledgeWeights: db.knowledgePointWeights || {}
        });
        sendJson(res, 200, {
          ...summary,
          ratings: RATINGS,
          understandingTriggers: UNDERSTANDING_TRIGGERS
        });
        return true;
      }

      // ---------- 复习队列 ----------
      if (method === 'GET' && pathname === '/v1/study/review-queue') {
        const subject = url.searchParams.get('subject') || SUBJECT_ALL;
        const knowledgePoint = url.searchParams.get('knowledgePoint') || null;
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const knowledgeCards = visible(db.knowledgeCards);
        const cases = visible(db.cases);
        const knowledgeWeights = db.knowledgePointWeights || {};
        // 队列优先级要用到知识点的「错误频次 × 权重 × 时间衰减」，所以先算一遍热力图
        const heatmap = buildHeatmap({cases, knowledgeCards, now, knowledgeWeights});
        // 系统判定的高频易错 = 当前科目里优先级最高的 3 个知识点，整组置顶
        const scopedHeat = subject === SUBJECT_ALL
          ? heatmap
          : heatmap.filter(cell => cell.subject === subject);
        const pinnedPoints = [...scopedHeat]
          .sort((a, b) => b.priority - a.priority)
          .slice(0, 3)
          .map(cell => cell.knowledgePoint);
        const queue = buildQueue({
          knowledgeCards,
          cases,
          subject,
          knowledgePoint,
          heatmap,
          knowledgeWeights,
          pinnedPoints,
          now,
          limit
        });
        sendJson(res, 200, {...queue, pinnedPoints, ratings: RATINGS});
        return true;
      }

      // ---------- 四档评分 ----------
      if (method === 'POST' && pathname === '/v1/study/review') {
        const body = requestBody === null ? await readJson(req) : requestBody;
        const cardId = body.cardId || body.card_id;
        const rating = Number(body.rating);
        const examDate = body.examDate || null;
        if (!cardId) { sendJson(res, 400, {error: 'MISSING_CARD_ID'}); return true; }
        if (!(rating >= 1 && rating <= 4)) { sendJson(res, 400, {error: 'INVALID_RATING', allowed: [1, 2, 3, 4]}); return true; }

        const target = resolveReviewTarget(cardId);
        if (!target) { sendJson(res, 404, {error: 'REVIEW_TARGET_NOT_FOUND', cardId}); return true; }

        const scheduled = await rateCard({fsrs: target.fsrs}, rating, {now, examDate});
        let updated;
        db.knowledgeCardReviews = db.knowledgeCardReviews || [];
        if (target.kind === 'card') {
          updated = attachFsrsState(db.knowledgeCards[target.index], scheduled);
          db.knowledgeCards[target.index] = updated;
        } else {
          // 错题：FSRS 状态写回它自己的 learningProfile，并同步项目既有字段
          const record = db.cases[target.index];
          const profile = record.learningProfile || {};
          record.learningProfile = {
            ...profile,
            fsrs: scheduled.card,
            dueAt: scheduled.dueAt,
            mastery: scheduled.mastery,
            interval: scheduled.intervalDays,
            lastResult: scheduled.label,
            reviews: Number(profile.reviews || 0) + 1
          };
          record.updatedAt = now.toISOString();
          updated = {id: cardId, fsrs: scheduled.card, masteryStatus: profile.masteryStatus || 'learning'};
        }
        // 这里也是全项目唯一改动 FSRS 长期调度的地方：写进 fsrs_cards 表
        const fsrsRecord = upsertFsrsCard(db, {
          refType: target.refType, refId: target.refId, userId: currentUserId, scheduled, now
        });
        db.knowledgeCardReviews.unshift({
          id: randomUUID(),
          cardId,
          user_id: currentUserId,
          studentId: currentUserId,
          targetKind: target.kind,
          ref_type: target.refType,
          ref_id: target.refId,
          fsrs_card_id: fsrsRecord.id,
          sourceCaseIds: target.kind === 'card' ? [...(db.knowledgeCards[target.index].sourceCaseIds || [])] : [cardId],
          rating,
          label: scheduled.label,
          repeat: scheduled.repeat,
          intervalDays: scheduled.intervalDays,
          stability: scheduled.stability,
          dueAt: scheduled.dueAt,
          reviewedAt: now.toISOString(),
          source: 'fsrs-review-queue'
        });
        await save();

        // 评分 >= 3（还行 / 太简单）时，请学生用自己的话把知识点讲一遍
        // 注意用 knowledgePointOf 取知识点：它会过滤掉 point/segment 这类几何 IR 标识
        const targetPoint = target.kind === 'card'
          ? knowledgePointOf(db.knowledgeCards[target.index])
          : knowledgePointOf(db.cases[target.index]);
        const alreadyHasCard = (db.knowledgeCards || []).some(card =>
          String(card.knowledgePoint || '') === targetPoint
          && String(card.content || card.insight || '').trim());
        const askUnderstanding = shouldAskUnderstanding({rating, alreadyHasCard, trigger: 'review_passed'});

        sendJson(res, 201, {
          card: updated,
          rating: scheduled.rating,
          label: scheduled.label,
          repeat: scheduled.repeat,
          intervalDays: scheduled.intervalDays,
          intervalText: (await import('./review-queue.mjs')).formatInterval(scheduled.intervalDays),
          dueAt: scheduled.dueAt,
          stability: scheduled.stability,
          mastery: scheduled.mastery,
          retrievabilityBefore: scheduled.retrievabilityBefore,
          retrievabilityAfter: scheduled.retrievabilityAfter,
          desiredRetention: scheduled.desiredRetention,
          fsrsCard: {
            id: fsrsRecord.id,
            ref_type: fsrsRecord.ref_type,
            ref_id: fsrsRecord.ref_id,
            dueAt: fsrsRecord.dueAt,
            stability: fsrsRecord.stability
          },
          knowledgePoint: targetPoint,
          askUnderstanding
        });
        return true;
      }

      // ---------- 卡片滚动测验队列（按 due 排序，支持全科/单科） ----------
      if (method === 'GET' && pathname === '/v1/study/rolling-quiz') {
        const subject = url.searchParams.get('subject') || SUBJECT_ALL;
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60));
        ensureFsrsTables(db, {now});
        const quiz = buildRollingQuiz({
          knowledgeCards: visible(db.knowledgeCards),
          cases: visible(db.cases),
          fsrsCards: db.fsrsCards,
          subject, now, limit
        });
        sendJson(res, 200, quiz);
        return true;
      }

      // ---------- 「对不起，我刚忘掉了」 ----------
      // 关键：只把卡片排回今天的队列，**不调用 py-fsrs、不写 FSRS 状态**，
      // 长期复习间隔原样保留 —— 避免一次误判把间隔打回原形。
      if (method === 'POST' && pathname === '/v1/study/forgot') {
        const body = requestBody === null ? await readJson(req) : requestBody;
        const refId = body.refId || body.cardId;
        if (!refId) { sendJson(res, 400, {error: 'MISSING_REF_ID'}); return true; }
        const refType = body.refType
          || ((db.cases || []).some(item => item.id === refId) ? REF_TYPE.wrongQuestion : REF_TYPE.knowledgeCard);
        const allowed = refType === REF_TYPE.knowledgeCard
          ? (db.knowledgeCards || []).some(card => card.id === refId && canAccess(card))
          : (db.cases || []).some(item => item.id === refId && canAccess(item));
        if (!allowed) { sendJson(res, 404, {error: 'REVIEW_TARGET_NOT_FOUND', refId}); return true; }

        ensureFsrsTables(db, {now});
        const before = findFsrsCard(db, refType, refId);
        const event = recordForgetRepeat(db, {refType, refId, userId: currentUserId, now, source: 'rolling-quiz'});
        const after = findFsrsCard(db, refType, refId);
        await save();
        sendJson(res, 200, {
          ok: true,
          queued: true,
          ref_type: refType,
          ref_id: refId,
          fsrsTouched: false,
          dueAtBefore: before ? before.dueAt : null,
          dueAtAfter: after ? after.dueAt : null,
          unchanged: (before ? before.dueAt : null) === (after ? after.dueAt : null),
          repeatToday: forgetRepeatCountToday(db, {refType, refId, now}),
          eventId: event.id,
          message: '已排回今天的队列；长期复习间隔没有变化。'
        });
        return true;
      }

      // ---------- 学科 → 知识点 逐层 / 雷达图 ----------
      if (method === 'GET' && (pathname === '/v1/study/taxonomy' || pathname === '/v1/study/radar')) {
        const summary = buildSummary({
          cases: visible(db.cases),
          knowledgeCards: visible(db.knowledgeCards),
          tutorSessions: visible(db.tutorSessions),
          noteSources: visible(db.noteSources),
          ingestions: visible(db.ingestions),
          knowledgeCardReviews: visible(db.knowledgeCardReviews),
          now,
          examDate: url.searchParams.get('examDate') || null
        });
        sendJson(res, 200, pathname.endsWith('radar')
          ? {radar: summary.radar, generatedAt: summary.generatedAt}
          : {taxonomy: summary.taxonomy, radar: summary.radar, generatedAt: summary.generatedAt});
        return true;
      }

      // ---------- fsrs_cards 表概览 ----------
      if (method === 'GET' && pathname === '/v1/study/fsrs-table') {
        ensureFsrsTables(db, {now});
        const stats = fsrsTableStats(db, {now});
        sendJson(res, 200, {
          stats,
          rows: db.fsrsCards.slice(0, 100).map(record => ({
            id: record.id,
            ref_type: record.ref_type,
            ref_id: record.ref_id,
            user_id: record.user_id,
            dueAt: record.dueAt,
            stability: record.stability,
            difficulty: record.difficulty,
            state: record.state,
            updated_at: record.updated_at
          })),
          recentEvents: (db.reviewEvents || []).slice(-10).reverse()
        });
        return true;
      }

      // ---------- 评分按钮提示 ----------
      const hintsMatch = pathname.match(/^\/v1\/study\/rating-hints\/([^/]+)$/);
      if (method === 'GET' && hintsMatch) {
        const hintId = decodeURIComponent(hintsMatch[1]);
        const target = resolveReviewTarget(hintId);
        if (!target) { sendJson(res, 404, {error: 'REVIEW_TARGET_NOT_FOUND', cardId: hintId}); return true; }
        const examDate = url.searchParams.get('examDate') || null;
        const hints = await ratingHints({fsrs: target.fsrs}, {now, examDate});
        sendJson(res, 200, {cardId: hintId, hints});
        return true;
      }

      // ---------- 我的理解：引导语 ----------
      if (method === 'GET' && pathname === '/v1/study/understanding-prompt') {
        const caseId = url.searchParams.get('caseId') || null;
        const trigger = url.searchParams.get('trigger') || 'self_complete';
        const record = caseId ? visible(db.cases).find(item => item.id === caseId) : null;
        const knowledgePoint = url.searchParams.get('knowledgePoint')
          || (record ? knowledgePointOf(record) : '')
          || '';
        const existing = (db.knowledgeCards || []).some(card => String(card.knowledgePoint || '') === String(knowledgePoint || ''));
        const prompt = buildUnderstandingPrompt({
          knowledgePoint,
          subject: (record && record.subject) || '数学',
          trigger,
          caseQuestion: (record && record.question) || ''
        });
        sendJson(res, 200, {
          ...prompt,
          alreadyHasCard: existing,
          shouldPrompt: shouldPromptUnderstanding({trigger, alreadyHasCard: existing, force: url.searchParams.get('force') === '1'}),
          triggers: UNDERSTANDING_TRIGGERS
        });
        return true;
      }

      // ---------- 我的理解：保存 ----------
      if (method === 'POST' && pathname === '/v1/study/understanding') {
        const body = requestBody === null ? await readJson(req) : requestBody;
        const sourceCaseIds = (Array.isArray(body.sourceCaseIds) ? body.sourceCaseIds : (body.caseId ? [body.caseId] : []));
        if (sourceCaseIds.some(caseId => !visible(db.cases).some(item => item.id === caseId))) {
          sendJson(res, 404, {error: 'SOURCE_CASE_NOT_FOUND'}); return true;
        }
        const trigger = isUnderstandingTrigger(body.trigger) ? body.trigger : 'self_complete';
        // 知识卡只沉淀知识点；关联错题只保留 ID，不把原题或完整解析复制到卡片。
        // 但正面为空时必须用关联错题的原题干回填，否则空 challengePrompt 会一路进复习队列。
        const frontSourceCase = sourceCaseIds.length
          ? visible(db.cases).find(item => item.id === sourceCaseIds[0])
          : null;
        const card = toKnowledgeCard({
          text: body.text,
          knowledgePoint: body.knowledgePoint,
          subject: body.subject || '数学',
          sourceCaseIds,
          evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs : [],
          trigger,
          title: body.title || '',
          nextTimeAction: body.nextTimeAction || '',
          frontContent: Object.hasOwn(body, 'frontContent') ? body.frontContent : undefined,
          sourceQuestion: frontSourceCase ? String(frontSourceCase.question || '') : '',
          backContent: body.backContent || '',
          now,
          studentId: currentUserId,
          aiExplanation: body.aiExplanation || ''
        });
        card.studentId = currentUserId;
        card.user_id = currentUserId;
        db.knowledgeCards = db.knowledgeCards || [];
        db.knowledgeCards.unshift(card);

        // 新卡片同时进调度表：ref_type=knowledge_card, ref_id=卡片ID
        ensureFsrsTables(db, {now});
        const scheduledRecord = upsertFsrsCard(db, {
          refType: REF_TYPE.knowledgeCard,
          refId: card.id,
          userId: currentUserId,
          scheduled: {
            card: null,
            dueAt: card.reviewSchedule && card.reviewSchedule.dueAt,
            intervalDays: 0,
            stability: null,
            difficulty: null,
            state: 'New'
          },
          now
        });
        await save();
        sendJson(res, 201, {
          card,
          fsrsCard: {
            id: scheduledRecord.id,
            ref_type: scheduledRecord.ref_type,
            ref_id: scheduledRecord.ref_id,
            dueAt: scheduledRecord.dueAt
          },
          queued: true,
          message: '已把你的理解存成知识卡，并放进复习队列。'
        });
        return true;
      }

      // ---------- FSRS 健康检查 ----------
      if (method === 'GET' && pathname === '/v1/study/fsrs-health') {
        const health = await fsrsHealth();
        const cards = visible(db.knowledgeCards);
        sendJson(res, health.available ? 200 : 503, {
          ...health,
          cards: cards.length,
          tracked: cards.filter(card => card.fsrs && card.fsrs.stability).length,
          dueToday: cards.filter(card => isDueToday(card.reviewSchedule && card.reviewSchedule.dueAt, now)).length
        });
        return true;
      }

      sendJson(res, 404, {error: 'STUDY_ROUTE_NOT_FOUND', path: pathname, routes: STUDY_ROUTES});
      return true;
    } catch (error) {
      const code = String((error && error.message) || error);
      const status = code === 'PAYLOAD_TOO_LARGE' ? 413
        : code === 'INVALID_JSON' ? 400
          : (error && error.code) === 'FSRS_UNAVAILABLE' ? 503
            : (error && error.code) === 'UNDERSTANDING_TOO_SHORT' ? 422
              : 500;
      sendJson(res, status, {
        error: code,
        name: (error && error.name) || 'Error',
        errorClass: (error && error.code) === 'FSRS_UNAVAILABLE' ? 'fsrs' : 'study-api',
        answerPreserved: true,
        detail: (error && error.detail) || null
      });
      return true;
    }
  };
}

export {summarizeSession, masteryFromStability};
