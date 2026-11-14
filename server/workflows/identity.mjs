import {createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt = promisify(scryptCallback);
/* 登录账号既可以是姓名拼音等用户名，也兼容邮箱。
   邮箱分支单独写一条，长度按邮箱上限收紧。 */
const EMAIL_PATTERN = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}$/;
const LOGIN_PATTERN = /^(?:[a-z0-9][a-z0-9._-]{1,31}|[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24})$/;
const PASSWORD_BYTES = 64;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SUBJECTS = 12;

const normalizeLoginName = value => String(value || '').trim().toLowerCase();
const hashSessionToken = token => createHash('sha256').update(String(token)).digest('hex');
const toSubjects = value => {
  const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,，、;；\s]+/);
  const out = [];
  for (const item of list) {
    const text = String(item == null ? '' : item).trim().slice(0, 20);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_SUBJECTS) break;
  }
  return out;
};
const publicUser = user => ({
  id: user.id,
  loginName: user.loginName,
  isEmail: EMAIL_PATTERN.test(String(user.loginName || '')),
  displayName: user.displayName,
  className: user.className || '',
  grade: user.grade || '',
  subjects: Array.isArray(user.subjects) ? user.subjects : [],
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt || null
});

const identityError = (message, statusCode) => Object.assign(new Error(message), {statusCode});

export function createIdentityModule({users, sessions, now = () => new Date().toISOString(), sessionTtlMs = DEFAULT_SESSION_TTL_MS, maxSessionsPerUser = 10}) {
  if (!Array.isArray(users) || !Array.isArray(sessions)) throw new TypeError('IDENTITY_STORAGE_REQUIRED');

  const issueSession = user => {
    const sessionToken = randomBytes(32).toString('base64url');
    const createdAt = now();
    const cutoff = Date.parse(createdAt);
    for (let index = sessions.length - 1; index >= 0; index--) {
      if (!(Date.parse(sessions[index]?.expiresAt) > cutoff)) sessions.splice(index, 1);
    }
    const limit = Math.max(1, Math.min(100, Math.floor(Number(maxSessionsPerUser)) || 10));
    // Keep the newest logins; re-login never creates an unbounded session list.
    const own = sessions.filter(entry => entry.userId === user.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const retire = new Set(own.slice(limit - 1));
    for (let index = sessions.length - 1; index >= 0; index--) {
      if (retire.has(sessions[index])) sessions.splice(index, 1);
    }
    sessions.unshift({
      id: randomBytes(16).toString('hex'),
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + sessionTtlMs).toISOString()
    });
    return {user: publicUser(user), sessionToken, expiresAt: sessions[0].expiresAt};
  };

  return {
    async register({loginName, displayName, password, className, grade, subjects}) {
      const normalizedLogin = normalizeLoginName(loginName);
      // 只限制新注册；历史短账号仍可正常登录。
      if (normalizedLogin.length < 6 || !LOGIN_PATTERN.test(normalizedLogin)) throw identityError('INVALID_LOGIN_NAME', 422);
      if (String(password || '').length < 6) throw identityError('PASSWORD_TOO_SHORT', 422);
      if (users.some(user => user.loginName === normalizedLogin)) throw identityError('LOGIN_NAME_TAKEN', 409);

      const passwordSalt = randomBytes(16).toString('base64url');
      const passwordHash = (await scrypt(String(password), passwordSalt, PASSWORD_BYTES)).toString('base64url');
      const user = {
        id: randomBytes(16).toString('hex'),
        loginName: normalizedLogin,
        displayName: String(displayName || normalizedLogin).trim().slice(0, 40) || normalizedLogin,
        className: String(className || '').trim().slice(0, 40),
        grade: String(grade || '').trim().slice(0, 20),
        subjects: toSubjects(subjects),
        role: 'student',
        passwordSalt,
        passwordHash,
        createdAt: now(),
        updatedAt: null
      };
      users.unshift(user);
      return issueSession(user);
    },

    /** 改姓名 / 班级 / 年级 / 选科。只改传进来的字段，其余保持不动。 */
    updateProfile(userId, patch = {}) {
      const user = users.find(entry => entry.id === userId);
      if (!user) throw identityError('USER_NOT_FOUND', 404);
      if ('displayName' in patch) {
        const value = String(patch.displayName || '').trim().slice(0, 40);
        if (value) user.displayName = value;
      }
      if ('className' in patch) user.className = String(patch.className || '').trim().slice(0, 40);
      if ('grade' in patch) user.grade = String(patch.grade || '').trim().slice(0, 20);
      if ('subjects' in patch) user.subjects = toSubjects(patch.subjects);
      user.updatedAt = now();
      return publicUser(user);
    },

    async login({loginName, password}) {
      const normalizedLogin = normalizeLoginName(loginName);
      const user = users.find(entry => entry.loginName === normalizedLogin);
      if (!user) throw identityError('INVALID_CREDENTIALS', 401);
      const candidate = await scrypt(String(password || ''), user.passwordSalt, PASSWORD_BYTES);
      const expected = Buffer.from(user.passwordHash, 'base64url');
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw identityError('INVALID_CREDENTIALS', 401);
      return issueSession(user);
    },

    resolve(sessionToken) {
      if (!sessionToken) return null;
      const tokenHash = hashSessionToken(sessionToken);
      const session = sessions.find(entry => entry.tokenHash === tokenHash && Date.parse(entry.expiresAt) > Date.now());
      if (!session) return null;
      const user = users.find(entry => entry.id === session.userId);
      return user ? {user: publicUser(user), session} : null;
    },

    revokeAll(userId) {
      if (!userId) return 0;
      let count = 0;
      for (let index = sessions.length - 1; index >= 0; index--) {
        if (sessions[index].userId === userId) { sessions.splice(index, 1); count++; }
      }
      return count;
    },

    revoke(sessionToken) {
      if (!sessionToken) return false;
      const tokenHash = hashSessionToken(sessionToken);
      const index = sessions.findIndex(entry => entry.tokenHash === tokenHash);
      if (index < 0) return false;
      sessions.splice(index, 1);
      return true;
    }
  };
}
