import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityModule} from '../workflows/identity.mjs';

test('序列化重启保留登录，仅存哈希；退出所有设备不影响其他用户', async () => {
  const db = {users: [], sessions: []};
  let identity = createIdentityModule(db);
  const a = await identity.register({loginName: 'student-a', password: 'abcdef123'});
  const a2 = await identity.login({loginName: 'student-a', password: 'abcdef123'});
  const b = await identity.register({loginName: 'student-b', password: 'abcdef123'});
  const encoded = JSON.stringify(db);
  assert.ok(!encoded.includes(a.sessionToken), '数据不能保存明文登录令牌');
  identity = createIdentityModule(JSON.parse(encoded));
  assert.equal(identity.resolve(a.sessionToken).user.id, a.user.id);
  assert.equal(identity.revokeAll(a.user.id), 2);
  assert.equal(identity.resolve(a.sessionToken), null);
  assert.equal(identity.resolve(a2.sessionToken), null);
  assert.equal(identity.resolve(b.sessionToken).user.id, b.user.id);
});

test('到期会话不能登录，签发新会话时清理过期记录并限制同账号会话数', async () => {
  const db = {users: [], sessions: [{tokenHash: 'expired', userId: 'old', expiresAt: '2000-01-01T00:00:00Z'}]};
  const identity = createIdentityModule({...db, maxSessionsPerUser: 2});
  const first = await identity.register({loginName: 'student-expire', password: 'abcdef123'});
  assert.equal(db.sessions.some(s => s.tokenHash === 'expired'), false);
  const second = await identity.login({loginName: 'student-expire', password: 'abcdef123'});
  const third = await identity.login({loginName: 'student-expire', password: 'abcdef123'});
  assert.equal(identity.resolve(first.sessionToken), null);
  assert.ok(identity.resolve(second.sessionToken) && identity.resolve(third.sessionToken));
  db.sessions.forEach(s => {s.expiresAt = '2000-01-01T00:00:00Z';});
  assert.equal(identity.resolve(third.sessionToken), null);
});
