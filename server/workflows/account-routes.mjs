// 个人资料 + 用户偏好
//
// 挂载方式（server.mjs，紧邻 /v1/auth/* 那几行）：
//     const handleAccount = createAccountRouter({db, persist, identity, currentUser: () => authResolution});
//     if (await handleAccount(req, res, url)) return;
//
// 对外接口：
//   PATCH /v1/auth/profile   改姓名 / 班级 / 年级 / 选科
//   GET   /v1/preferences    读当前用户的偏好（每日攻克数量、科目顺序）
//   PUT   /v1/preferences    合并写入偏好
//
// 说明：账号注册/登录本身已经在 identity.mjs + server.mjs 的 /v1/auth/* 里，
// 这里只补「登录之后」的个人资料与偏好，不重复造认证。
import {randomUUID} from 'node:crypto';

export const ACCOUNT_ROUTES = Object.freeze([
  {method: 'PATCH', path: '/v1/auth/profile', desc: '修改姓名 / 班级 / 年级 / 选科'},
  {method: 'GET', path: '/v1/preferences', desc: '读取当前用户的个性化设置'},
  {method: 'PUT', path: '/v1/preferences', desc: '合并保存个性化设置'}
]);

/** 偏好的默认值。前端拿到的永远是这个形状，不用自己兜空。 */
export const DEFAULT_PREFERENCES = Object.freeze({
  // 每个科目每天计划攻克几个知识点，例如 {数学: 2, 语文: 1}
  dailyTargets: {},
  // 归纳页科目的自定义顺序
  subjectOrder: [],
  updatedAt: null
});

const MAX_SUBJECT_ORDER = 20;
const MAX_DAILY_TARGET = 10;
const MAX_TEXT = 200;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req, limitBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) { reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), {code: 'PAYLOAD_TOO_LARGE'})); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('INVALID_JSON'), {code: 'INVALID_JSON'})); }
    });
    req.on('error', reject);
  });
}

/** 把用户传进来的偏好清洗成安全形状：科目名去空、数量夹在 1..10 */
export function normalizePreferences(patch = {}, base = DEFAULT_PREFERENCES) {
  const next = {
    dailyTargets: {...(base.dailyTargets || {})},
    subjectOrder: Array.isArray(base.subjectOrder) ? base.subjectOrder.slice() : [],
    updatedAt: base.updatedAt || null
  };

  if (patch.dailyTargets && typeof patch.dailyTargets === 'object' && !Array.isArray(patch.dailyTargets)) {
    const cleaned = {};
    for (const [subject, value] of Object.entries(patch.dailyTargets)) {
      const name = String(subject || '').trim().slice(0, MAX_TEXT);
      if (!name) continue;
      const count = Math.round(Number(value));
      if (!Number.isFinite(count)) continue;
      cleaned[name] = Math.max(0, Math.min(MAX_DAILY_TARGET, count));
    }
    next.dailyTargets = cleaned;
  }

  if (Array.isArray(patch.subjectOrder)) {
    const seen = new Set();
    const order = [];
    for (const item of patch.subjectOrder) {
      const name = String(item || '').trim().slice(0, MAX_TEXT);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      order.push(name);
      if (order.length >= MAX_SUBJECT_ORDER) break;
    }
    next.subjectOrder = order;
  }

  if (patch.reset === true) return {...DEFAULT_PREFERENCES};
  return next;
}

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {Function} [deps.persist]
 * @param {object} deps.identity            createIdentityModule(...) 的结果
 * @param {Function} [deps.currentUser]     闸门解析出来的 {user, session}（学校模式才有）
 * @param {Function} [deps.sessionToken]    本次请求携带的 Bearer token
 * @param {object} [deps.requestBody]       server.mjs 已解析的请求体（必须复用）
 *
 * 注意：server.mjs 里 authResolution 只在 AUTH_REQUIRED=true（学校模式）时才被赋值，
 * 本地模式它一直是 null。所以这里必须能自己用 token 解析出用户，否则本地模式全部 401。
 */
export function createAccountRouter({db, persist, identity, currentUser = () => null, sessionToken = () => '', requestBody = null} = {}) {
  if (!db) throw new Error('createAccountRouter 需要 db');
  const save = async () => { if (typeof persist === 'function') await persist(); };
  const bodyOf = async req => {
    if (requestBody && typeof requestBody === 'object') return requestBody;
    try { return await readJson(req); } catch { return {}; }
  };
  db.preferences = db.preferences && typeof db.preferences === 'object' ? db.preferences : {};

  const resolveUser = () => {
    const viaGate = currentUser();
    if (viaGate && viaGate.user) return viaGate;
    const token = sessionToken();
    return token && identity && typeof identity.resolve === 'function' ? identity.resolve(token) : null;
  };

  const requireUser = res => {
    const resolved = resolveUser();
    if (!resolved || !resolved.user) {
      sendJson(res, 401, {error: 'AUTHENTICATION_REQUIRED', message: '请先登录。'});
      return null;
    }
    return resolved.user;
  };

  return async function handleAccount(req, res, url) {
    const pathname = url.pathname;
    const method = String(req.method || 'GET').toUpperCase();

    /* ---------- 个人资料 ---------- */
    if (method === 'PATCH' && pathname === '/v1/auth/profile') {
      const user = requireUser(res);
      if (!user) return true;
      if (!identity || typeof identity.updateProfile !== 'function') {
        sendJson(res, 503, {error: 'IDENTITY_UNAVAILABLE'});
        return true;
      }
      try {
        const updated = identity.updateProfile(user.id, await bodyOf(req));
        await save();
        sendJson(res, 200, {ok: true, user: updated});
      } catch (error) {
        const code = String((error && error.message) || error);
        sendJson(res, error?.statusCode || (code === 'PAYLOAD_TOO_LARGE' ? 413 : code === 'INVALID_JSON' ? 400 : 500),
          {error: code, message: code === 'USER_NOT_FOUND' ? '账号不存在。' : '资料没保存成功，请重试。'});
      }
      return true;
    }

    /* ---------- 偏好 ---------- */
    if (pathname === '/v1/preferences') {
      if (method !== 'GET' && method !== 'PUT') return false;
      const user = requireUser(res);
      if (!user) return true;
      const stored = db.preferences[user.id] || DEFAULT_PREFERENCES;

      if (method === 'GET') {
        sendJson(res, 200, {preferences: {...DEFAULT_PREFERENCES, ...stored}});
        return true;
      }
      try {
        const patch = await bodyOf(req);
        const next = normalizePreferences(patch, stored);
        next.updatedAt = new Date().toISOString();
        db.preferences[user.id] = next;
        db.events = Array.isArray(db.events) ? db.events : [];
        db.events.push({id: randomUUID(), type: 'preferences_updated', userId: user.id,
          payload: {dailyTargets: Object.keys(next.dailyTargets).length, subjectOrder: next.subjectOrder.length},
          createdAt: next.updatedAt});
        await save();
        sendJson(res, 200, {ok: true, preferences: next});
      } catch (error) {
        const code = String((error && error.message) || error);
        sendJson(res, code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, {error: code});
      }
      return true;
    }

    return false;
  };
}
