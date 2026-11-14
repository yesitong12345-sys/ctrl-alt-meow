import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityModule} from '../workflows/identity.mjs';

test('注册接受六位密码，仍拒绝五位密码', async () => {
  const identity = createIdentityModule({users: [], sessions: []});
  await assert.rejects(identity.register({loginName: 'short5', password: '12345'}), /PASSWORD_TOO_SHORT/);
  const result = await identity.register({loginName: 'valid6', password: '123456'});
  assert.equal(result.user.loginName, 'valid6');
});
