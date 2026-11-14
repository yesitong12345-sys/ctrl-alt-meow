import test from 'node:test';
import assert from 'node:assert/strict';

import {createIdentityModule} from '../workflows/identity.mjs';

test('student can register with a pinyin account name and a six-character password', async () => {
  const identity = createIdentityModule({users: [], sessions: []});
  const registered = await identity.register({loginName: 'zhangsan', displayName: '张三', password: 'abc123'});
  assert.equal(registered.user.loginName, 'zhangsan');
  assert.equal(registered.user.displayName, '张三');
});

test('new account name must be longer than five characters', async () => {
  const identity = createIdentityModule({users: [], sessions: []});
  await assert.rejects(identity.register({loginName: 'wu', displayName: '吴同学', password: '123456'}), /INVALID_LOGIN_NAME/);
});

test('registration still rejects passwords shorter than six characters', async () => {
  const identity = createIdentityModule({users: [], sessions: []});
  await assert.rejects(
    identity.register({loginName: 'lisixx', displayName: '李四', password: '12345'}),
    error => error.message === 'PASSWORD_TOO_SHORT' && error.statusCode === 422
  );
});
