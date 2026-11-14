import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const implementationRoot = path.resolve(import.meta.dirname, '..', '..', 'implementation');

test('web client provides account login without persisting the session in learning state', async () => {
  const html = await readFile(path.join(implementationRoot, 'index.html'), 'utf8');
  const accountScript = await readFile(path.join(implementationRoot, 'account-settings.js'), 'utf8');

  assert.match(html, /<script src="\.\/account-settings\.js"><\/script>/);
  assert.match(html, /window\.__eduAuthSessionToken\s*\|\|\s*state\.apiToken/);
  assert.match(accountScript, /sessionStorage/);
  assert.match(accountScript, /\/v1\/auth\/register/);
  assert.match(accountScript, /\/v1\/auth\/login/);
  assert.match(accountScript, /\/v1\/auth\/logout/);
  assert.doesNotMatch(accountScript, /localStorage\.setItem/);
  assert.match(accountScript, /setAttribute\('data-tab','account-settings'\)/);
  assert.match(accountScript, /ui\.authRequired\?'<p class="muted">学校多人模式由服务器管理员统一配置模型密钥/);
  assert.match(html, /if\(feature\.requiresLogin\(\)\)state\.tab='account-settings'/);
});

test('school website gates the first view and resumes login without a browser-readable persistent token', async () => {
  const html = await readFile(path.join(implementationRoot, 'index.html'), 'utf8');
  const account = await readFile(path.join(implementationRoot, 'account-settings.js'), 'utf8');
  assert.match(html, /auth-pending/);
  assert.match(html, /feature\.requiresLogin\(\)/);
  assert.match(account, /sessionStorage\.removeItem\(SESSION_KEY\)/);
  assert.match(account, /ui\.authRequired&&!ui\.user/);
  assert.doesNotMatch(account, /localStorage\.setItem\(SESSION_KEY/);
});

test('three-stage transfer shows three choices and one start button without repeated descriptions', async () => {
  const html = await readFile(path.join(implementationRoot, 'index.html'), 'utf8');
  const card = html.match(/function transferQuestionHtml\(task,question\)[\s\S]*?(?=\n  async function persistTransferAttempt)/)?.[0] || '';
  const wizard = await readFile(path.join(implementationRoot, 'loop-wizard.js'), 'utf8');
  assert.match(wizard, /① 近迁移/);
  assert.match(wizard, /② 变式迁移/);
  assert.match(wizard, /③ 混合迁移/);
  assert.match(card, /session\.previewed\?`<div class="transfer-question-preview"[\s\S]*?<p>\$\{esc\(question\.question\)\}<\/p>/,
    '先展示新生成题的预览，学生显式开始后才进入陪练');
  assert.match(card, /先预览这道根据本题知识点生成的新题/);
  assert.doesNotMatch(card, /data-transfer-answer|data-transfer-submit-only|待作答|完整解答/);
  assert.match(card, /data-transfer-start-tutor/);
  assert.equal((card.match(/data-transfer-start-tutor=/g) || []).length, 1);
});

test('registration copy accepts a pinyin account and documents the six-character minimum', async () => {
  const accountScript = await readFile(path.join(implementationRoot, 'account-settings.js'), 'utf8');
  assert.match(accountScript, /账号名称（新注册至少 6 位，可填姓名拼音）/);
  assert.match(accountScript, /placeholder="例如：zhangsan"/);
  assert.match(accountScript, /密码至少需要 6 个字符/);
  assert.doesNotMatch(accountScript, /至少 10 个字符/);
});

test('student password remains masked by default and has a visible toggle', async () => {
  const accountScript = await readFile(path.join(implementationRoot, 'account-settings.js'), 'utf8');
  assert.match(accountScript, /data-account-password type="password"/);
  assert.match(accountScript, /data-account-toggle-password/);
  assert.match(accountScript, /aria-pressed/);
  assert.match(accountScript, /ui\.passwordVisible/);
});
