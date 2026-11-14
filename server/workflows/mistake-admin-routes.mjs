// 错题管理：编辑 / 删除
//
// 独立路由模块：错题 PATCH/DELETE，以及显式参数二维模型和主动重建子路由。
// 现有路由（GET 列表、POST 提交、POST :id/confirm、POST :id/public-template-choice）
// 都在 server.mjs 里更靠前的位置处理，因此不会被本模块影响。
//
// 挂载方式（server.mjs，紧邻 study 路由）：
//     const handleMistakeAdmin = createMistakeAdminRouter({...});
//     if (await handleMistakeAdmin(req, res, url)) return;
//
// 对外接口：
//   PATCH  /v1/mistake-cases/:id   编辑学科 / 单元 / 题型 / 知识点 / 微技能 / 错因 / 题干 / 作答
//   DELETE /v1/mistake-cases/:id   删除错题（级联清理它的陪练会话与来源引用）
import {randomUUID} from 'node:crypto';
import {compilePlaneGeometry, matchesPlaneGeometry, planeStepVisuals} from './plane-geometry.mjs';
import {compileEllipseGeometry, matchesEllipseGeometry, ellipseEntityCatalog, ellipseStepVisuals} from './ellipse-geometry.mjs';
import {strictQuestionFingerprint} from './shared-content-fingerprint.mjs';

export const MISTAKE_ADMIN_PREFIX = '/v1/mistake-cases';

export const MISTAKE_ADMIN_ROUTES = Object.freeze([
  {method: 'GET', path: '/v1/mistake-cases/:id/plane-model', desc: '回读本人二维模型及题干指纹，失效时仅返回状态'},
  {method: 'POST', path: '/v1/mistake-cases/:id/plane-model', desc: '确认显式参数后保存本地计算的二维模型，不调用AI'},
  {method: 'GET', path: '/v1/mistake-cases/:id/ellipse-model', desc: '回读本人椭圆模型及稳定实体目录，失效时只返回状态'},
  {method: 'POST', path: '/v1/mistake-cases/:id/ellipse-model', desc: '确认显式椭圆参数后保存本地计算模型，不调用AI'},
  {method: 'PATCH', path: '/v1/mistake-cases/:id', desc: '编辑错题的学科、题目标识与错因'},
  {method: 'DELETE', path: '/v1/mistake-cases/:id', desc: '删除错题并清理关联记录'},
  {method: 'POST', path: '/v1/mistake-cases/:id/rebuild-model', desc: '用当前题干重新生成 3D 模型'}
]);

/** 可编辑字段白名单 —— 只允许改这些，避免前端误传覆盖几何结果等关键数据 */
export const EDITABLE_FIELDS = Object.freeze([
  'subject', 'unit', 'questionType', 'question', 'studentAnswer',
  'knowledgePoints', 'microSkills', 'errorCauses'
]);

/** 这些字段在界面上对应「题目标识」 */
export const LABEL_FIELDS = Object.freeze(['knowledgePoints', 'microSkills', 'questionType', 'unit']);

const MAX_TEXT = 4000;
const MAX_ITEM = 120;
const MAX_ITEMS = 40;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req, limitBytes = 1024 * 1024) {
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
      try { resolve(JSON.parse(text)); } catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

/** 逗号 / 顿号 / 换行分隔的字符串或数组 → 去重后的干净数组 */
export function toList(value) {
  const raw = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,，、;；\n]+/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const text = String(item == null ? '' : item).trim().slice(0, MAX_ITEM);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function cleanText(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_TEXT);
}

/** 把请求体规范化成补丁对象；只保留白名单字段 */
export function normalizePatch(body = {}) {
  const patch = {};
  const listFields = new Set(['knowledgePoints', 'microSkills', 'errorCauses']);
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    patch[field] = listFields.has(field) ? toList(body[field]) : cleanText(body[field]);
  }
  return patch;
}

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {Function} deps.persist
 * @param {Function} [deps.clock]
 * @param {Function} [deps.canAccess]
 * @param {object} [deps.requestBody] server.mjs 已解析的请求体（POST/PATCH）；必须复用它
 */
export function createMistakeAdminRouter({
  db, persist, clock = () => new Date(), canAccess = () => true,
  requestBody = null, currentUserId = 'local-student',
  rebuildModel = null, rebuildSteps = null
} = {}) {
  if (!db) throw new Error('createMistakeAdminRouter 需要 db');

  const save = async () => { if (typeof persist === 'function') await persist(); };
  const bodyOf = async req => {
    if (requestBody && typeof requestBody === 'object') return requestBody;
    try { return await readJson(req); } catch { return {}; }
  };
  const findCase = id => (db.cases || []).find(item => item.id === id && canAccess(item));

  return async function handleMistakeAdmin(req, res, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith(MISTAKE_ADMIN_PREFIX + '/')) return false;
    const method = String(req.method || 'GET').toUpperCase();

    // Explicit-parameter 2D models are independent of the existing Three.js scene.
    // No recognition, rubric generation or AI fallback is invoked by this route.
    const planeMatch = pathname.match(/^\/v1\/mistake-cases\/([^/]+)\/plane-model$/);
    if (planeMatch && (method === 'GET' || method === 'POST')) {
      let record, previous, previousUpdatedAt, model, modelSavedAt;
      try {
        const body = method === 'POST' ? await bodyOf(req) : null;
        record = findCase(decodeURIComponent(planeMatch[1]));
        // Also enforce ownership in local mode, where canAccess may be permissive.
        if (!record || (record.user_id || record.studentId || 'local-student') !== currentUserId) {
          sendJson(res, 404, {error:'MISTAKE_CASE_NOT_FOUND'}); return true;
        }
        const questionFingerprint = strictQuestionFingerprint(record.question, record.subject);
        const valid = matchesPlaneGeometry(record.planeGeometry, record);
        if (method === 'GET') {
          sendJson(res, 200, {status:valid ? 'ready' : record.planeGeometry ? 'stale' : 'none',
            questionFingerprint,question:record.question,subject:record.subject,
            model:valid ? record.planeGeometry : null,stepVisuals:planeStepVisuals(record)}); return true;
        }
        if (body.questionFingerprint !== questionFingerprint) {
          sendJson(res, 409, {error:'QUESTION_CHANGED',saved:false,questionFingerprint}); return true;
        }
        model = compilePlaneGeometry({question:record.question,subject:record.subject,
          input:body.input,confirmed:body.confirmed});
        if (model.status !== 'verified') {
          sendJson(res, 422, {error:'PLANE_MODEL_NOT_VERIFIED',status:model.status,reason:model.reason,saved:false}); return true;
        }
        if (valid && matchesPlaneGeometry(record.planeGeometry,{...record,input:body.input})) {
          sendJson(res, 200, {status:'ready',model:record.planeGeometry,reused:true,saved:true}); return true;
        }
        previous = record.planeGeometry; previousUpdatedAt = record.updatedAt;
        record.planeGeometry = model; modelSavedAt = clock().toISOString(); record.updatedAt = modelSavedAt;
        await save();
        // A concurrent question edit may invalidate the saved snapshot while I/O runs.
        const stillValid = db.cases.includes(record) && matchesPlaneGeometry(model,record);
        sendJson(res, stillValid ? 200 : 409, {status:stillValid ? 'ready' : 'stale',
          model:stillValid ? model : null,saved:true,reused:false});
      } catch {
        if (model && record?.planeGeometry === model) {
          if (previous === undefined) delete record.planeGeometry; else record.planeGeometry = previous;
          // Do not roll back unrelated edits that completed while persistence was pending.
          if (record.updatedAt === modelSavedAt) record.updatedAt = previousUpdatedAt;
        }
        sendJson(res, 503, {error:'PLANE_MODEL_SAVE_FAILED',saved:false,answerPreserved:true});
      }
      return true;
    }

    // Ellipse models deliberately use the same ownership, fingerprint and rollback
    // guard as line-circle models.  Parameters come from an explicit student
    // confirmation; this endpoint never extracts them from prose or calls AI.
    const ellipseMatch = pathname.match(/^\/v1\/mistake-cases\/([^/]+)\/ellipse-model$/);
    if (ellipseMatch && (method === 'GET' || method === 'POST')) {
      let record, previous, previousUpdatedAt, model, modelSavedAt;
      try {
        const body = method === 'POST' ? await bodyOf(req) : null;
        record = findCase(decodeURIComponent(ellipseMatch[1]));
        if (!record || (record.user_id || record.studentId || 'local-student') !== currentUserId) {
          sendJson(res, 404, {error:'MISTAKE_CASE_NOT_FOUND'}); return true;
        }
        const questionFingerprint = strictQuestionFingerprint(record.question, record.subject);
        const valid = matchesEllipseGeometry(record.planeEllipse, record);
        if (method === 'GET') {
          sendJson(res, 200, {status:valid ? 'ready' : record.planeEllipse ? 'stale' : 'none',
            questionFingerprint, question:record.question, subject:record.subject,
            model:valid ? record.planeEllipse : null,
            entityCatalog:valid ? ellipseEntityCatalog(record) : [],
            stepVisuals:ellipseStepVisuals(record)});
          return true;
        }
        if (body.questionFingerprint !== questionFingerprint) {
          sendJson(res, 409, {error:'QUESTION_CHANGED', saved:false, questionFingerprint}); return true;
        }
        model = compileEllipseGeometry({question:record.question, subject:record.subject,
          input:body.input, confirmed:body.confirmed});
        if (model.status !== 'verified') {
          sendJson(res, 422, {error:'ELLIPSE_MODEL_NOT_VERIFIED', status:model.status, reason:model.reason, saved:false}); return true;
        }
        if (valid && matchesEllipseGeometry(record.planeEllipse, {...record, input:body.input})) {
          sendJson(res, 200, {status:'ready', model:record.planeEllipse,
            entityCatalog:ellipseEntityCatalog(record), reused:true, saved:true}); return true;
        }
        previous = record.planeEllipse; previousUpdatedAt = record.updatedAt;
        record.planeEllipse = model; modelSavedAt = clock().toISOString(); record.updatedAt = modelSavedAt;
        await save();
        const stillValid = db.cases.includes(record) && matchesEllipseGeometry(model, record);
        sendJson(res, stillValid ? 200 : 409, {status:stillValid ? 'ready' : 'stale',
          model:stillValid ? model : null,
          entityCatalog:stillValid ? ellipseEntityCatalog(record) : [], saved:true, reused:false});
      } catch {
        if (model && record?.planeEllipse === model) {
          if (previous === undefined) delete record.planeEllipse; else record.planeEllipse = previous;
          if (record.updatedAt === modelSavedAt) record.updatedAt = previousUpdatedAt;
        }
        sendJson(res, 503, {error:'ELLIPSE_MODEL_SAVE_FAILED', saved:false, answerPreserved:true});
      }
      return true;
    }

    /* ---------- 用当前题干重新生成 3D 模型 ---------- */
    const rebuildMatch = pathname.match(/^\/v1\/mistake-cases\/([^/]+)\/rebuild-model$/);
    if (method === 'POST' && rebuildMatch) {
      const caseId = decodeURIComponent(rebuildMatch[1]);
      const rebuildBody = await bodyOf(req);
      let rebuildTarget = findCase(caseId);
      if (!rebuildTarget && (db.cases || []).some(item => item.id === caseId)) {
        sendJson(res, 404, {error: 'MISTAKE_CASE_NOT_FOUND', caseId}); return true;
      }
      if (typeof rebuildModel !== 'function') {
        sendJson(res, 503, {error: 'REBUILD_UNAVAILABLE', message: '当前服务没有可用的建模通道（未配置 AI Provider）。'});
        return true;
      }
      if (!rebuildTarget) {
        // 旧网页曾只把错题放在浏览器中。学生主动点击“重新生成”时，先把
        // 这一条自己的本机记录按白名单导入，保持 ID 和学习进度，再原位建模。
        // 若 ID 已属于其他账号，绝不覆盖或泄露那条记录。
        const local = rebuildBody?.localCase;
        if (!local || local.id !== caseId || !/^[A-Za-z0-9_-]{8,128}$/.test(caseId)) {
          sendJson(res, 404, {error: 'MISTAKE_CASE_NOT_FOUND', caseId}); return true;
        }
        const imported = normalizePatch(local);
        const question = cleanText(rebuildBody.question || imported.question);
        if (!question) { sendJson(res, 422, {error: 'QUESTION_REQUIRED'}); return true; }
        rebuildTarget = {id: caseId, ...imported, question,
          createdAt: Number.isFinite(Date.parse(local.createdAt)) ? local.createdAt : clock().toISOString(),
          updatedAt: clock().toISOString(), user_id: currentUserId};
        if (local.learningProfile && typeof local.learningProfile === 'object' && !Array.isArray(local.learningProfile)) {
          rebuildTarget.learningProfile = {
            mastery: Math.max(0, Math.min(100, Number(local.learningProfile.mastery) || 0)),
            confidence: Math.max(0, Math.min(5, Number(local.learningProfile.confidence) || 0))
          };
        }
        db.cases.unshift(rebuildTarget);
      }
      try {
        // 允许在同一次请求里带上修正后的题干
        if (rebuildBody && typeof rebuildBody.question === 'string' && rebuildBody.question.trim()) {
          rebuildTarget.question = rebuildBody.question.trim().slice(0, MAX_TEXT);
          rebuildTarget.updatedAt = clock().toISOString();
        }
        /* 后台生成：学生点完就能去干别的（换页、看题、刷新浏览器都不影响）。
           立刻回 202 并把状态置为 building，前端靠轮询 /v1/mistake-cases 看到结果；
           真正的建模在这之后跑，不占用这次 HTTP 连接。 */
        if (rebuildBody && rebuildBody.background === true) {
          rebuildTarget.geometryBuildStatus = 'building';
          rebuildTarget.modelMessage = '正在后台生成 3D 模型，可以先去别的地方；生成好会自动出现在这道题上。';
          rebuildTarget.updatedAt = clock().toISOString();
          await save();
          const target = rebuildTarget;
          setTimeout(() => {
            /* rebuildModel 是把新对象换进 db.cases（不是原地改），
               所以后台跑完必须先 save 再让前端轮询到新对象。 */
            Promise.resolve()
              .then(() => rebuildModel(target, {userId: currentUserId, clock}))
              .catch(() => {})
              .then(() => save().catch(() => {}));
          }, 0);
          sendJson(res, 202, {
            ok: true, background: true, status: 'building',
            case: target,
            message: '已在后台开始生成 3D 模型。可以先去别的地方，生成好会自动出现在这道题上。'
          });
          return true;
        }
        const outcome = await rebuildModel(rebuildTarget, {userId: currentUserId, clock});
        await save();
        if (!outcome || !outcome.ok) {
          sendJson(res, 422, {
            error: 'MODEL_NOT_READY',
            status: (outcome && outcome.status) || 'unknown',
            message: (outcome && outcome.message)
              || '这次重建模没有通过校验。题干里的条件、尺寸或图形关系可能还不够确定，把题干改清楚后再试一次。'
          });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          case: outcome.case || rebuildTarget,
          status: outcome.status || 'verified',
          message: outcome.message || '已重新生成可交互的 3D 模型。'
        });
        return true;
      } catch (error) {
        sendJson(res, 503, {
          error: String((error && error.message) || error),
          errorClass: 'geometry',
          message: '建模通道出错；题目与作答都还在，可以直接重试。'
        });
        return true;
      }
    }

    /* ---------- 重新反推本题得分点 ---------- */
    const stepsMatch = pathname.match(/^\/v1\/mistake-cases\/([^/]+)\/rebuild-steps$/);
    if (method === 'POST' && stepsMatch) {
      const caseId = decodeURIComponent(stepsMatch[1]);
      const target = findCase(caseId);
      if (!target) {
        sendJson(res, 404, {error: 'MISTAKE_CASE_NOT_FOUND', caseId});
        return true;
      }
      if (typeof rebuildSteps !== 'function') {
        sendJson(res, 503, {error: 'STEPS_UNAVAILABLE', message: '当前服务没有可用的得分点反推通道（未配置 AI Provider）。'});
        return true;
      }
      try {
        const outcome = await rebuildSteps(target);
        await save();
        sendJson(res, outcome && outcome.ok ? 200 : 422, {
          ok: Boolean(outcome && outcome.ok),
          status: (outcome && outcome.status) || 'ai_rubric_failed',
          steps: (outcome && outcome.steps) || 0,
          message: outcome && outcome.ok
            ? `已按这道题反推出 ${outcome.steps} 个得分点。`
            : (target.aiStepsMessage || '这次反推没有完成，题目与作答都还在，可以直接重试。'),
          case: target,
        });
        return true;
      } catch (error) {
        sendJson(res, 503, {
          error: String((error && error.message) || error),
          errorClass: 'ai_rubric',
          message: '得分点反推通道出错；题目与作答都还在，可以直接重试。',
        });
        return true;
      }
    }

    const match = pathname.match(/^\/v1\/mistake-cases\/([^/]+)$/);
    if (!match) return false;                     // 其他带子路径的交给既有路由
    if (method !== 'PATCH' && method !== 'DELETE') return false;

    const now = clock();
    const caseId = decodeURIComponent(match[1]);

    try {
      const record = findCase(caseId);
      if (!record) {
        // 旧版网页可能只把错题保存在浏览器里。DELETE 应是幂等的：
        // 服务端确实没有这条记录时，允许客户端清掉自己的本地副本。
        // 已存在但不属于当前用户的 ID 仍返回 404，不能冒充删除成功。
        const existsForAnotherUser = (db.cases || []).some(item => item.id === caseId);
        if (method === 'DELETE' && !existsForAnotherUser) {
          sendJson(res, 200, {ok: true, deletedCaseId: caseId, alreadyAbsent: true,
            removedSessions: 0, removedIngestions: 0, detachedCards: 0,
            message: '服务端已无此错题，本机记录可以移除'});
          return true;
        }
        sendJson(res, 404, {error: 'MISTAKE_CASE_NOT_FOUND', caseId});
        return true;
      }

      // ---------- 编辑 ----------
      if (method === 'PATCH') {
        const patch = normalizePatch(await bodyOf(req));
        const changed = Object.keys(patch);
        if (!changed.length) {
          sendJson(res, 400, {error: 'NO_EDITABLE_FIELD', editable: EDITABLE_FIELDS});
          return true;
        }
        if ('question' in patch && !patch.question) {
          sendJson(res, 422, {error: 'QUESTION_REQUIRED', message: '题干不能为空'});
          return true;
        }
        const before = {};
        for (const field of changed) before[field] = record[field];
        Object.assign(record, patch);
        record.user_id = record.user_id || currentUserId;
        record.updatedAt = now.toISOString();
        record.editHistory = Array.isArray(record.editHistory) ? record.editHistory : [];
        record.editHistory.unshift({
          id: randomUUID(),
          editedAt: record.updatedAt,
          editedBy: currentUserId,
          changedFields: changed,
          before
        });
        record.editHistory = record.editHistory.slice(0, 20);

        db.events = Array.isArray(db.events) ? db.events : [];
        db.events.push({
          id: randomUUID(),
          type: 'mistake_case_edited',
          caseId,
          payload: {changedFields: changed},
          createdAt: record.updatedAt
        });
        await save();
        sendJson(res, 200, {
          ok: true,
          case: record,
          changedFields: changed,
          message: '已保存修改'
        });
        return true;
      }

      // ---------- 删除 ----------
      const index = db.cases.findIndex(item => item.id === caseId);
      db.cases.splice(index, 1);
      db.deletedCaseIds = Array.isArray(db.deletedCaseIds) ? db.deletedCaseIds : [];
      if (!db.deletedCaseIds.includes(caseId)) db.deletedCaseIds.push(caseId);
      db.deletedCaseOwners = db.deletedCaseOwners && typeof db.deletedCaseOwners === 'object' ? db.deletedCaseOwners : {};
      db.deletedCaseOwners[caseId] = record.user_id || record.studentId || currentUserId;

      // 级联清理：陪练会话、录入草稿、来源引用
      const removedSessions = [];
      db.tutorSessions = (db.tutorSessions || []).filter(session => {
        if (session.caseId !== caseId) return true;
        removedSessions.push(session.id);
        return false;
      });
      const removedIngestions = [];
      db.ingestions = (db.ingestions || []).filter(item => {
        if (item.caseId !== caseId) return true;
        removedIngestions.push(item.id);
        return false;
      });
      // 知识卡只解除来源引用，不删卡（卡是知识点的沉淀，可能还有别的来源）
      let detachedCards = 0;
      for (const card of (db.knowledgeCards || [])) {
        if (!Array.isArray(card.sourceCaseIds) || !card.sourceCaseIds.includes(caseId)) continue;
        card.sourceCaseIds = card.sourceCaseIds.filter(id => id !== caseId);
        card.updatedAt = now.toISOString();
        detachedCards += 1;
      }

      db.events = Array.isArray(db.events) ? db.events : [];
      db.events.push({
        id: randomUUID(),
        type: 'mistake_case_deleted',
        caseId,
        payload: {removedSessions: removedSessions.length, removedIngestions: removedIngestions.length, detachedCards},
        createdAt: now.toISOString()
      });
      await save();
      sendJson(res, 200, {
        ok: true,
        deletedCaseId: caseId,
        removedSessions: removedSessions.length,
        removedIngestions: removedIngestions.length,
        detachedCards,
        message: '已删除该错题（关联的陪练会话一并清理；知识卡仅解除来源引用）'
      });
      return true;
    } catch (error) {
      const code = String((error && error.message) || error);
      const status = code === 'PAYLOAD_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 500;
      sendJson(res, status, {error: code, name: (error && error.name) || 'Error', answerPreserved: true});
      return true;
    }
  };
}
