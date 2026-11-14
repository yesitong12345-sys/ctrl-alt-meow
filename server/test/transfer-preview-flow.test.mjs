import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('三阶迁移先预览生成题目，学生显式开始后才创建记录并进入错题库陪练', async () => {
  const html = await readFile(new URL('../../implementation/index.html', import.meta.url), 'utf8');
  const card = html.slice(html.indexOf('function transferQuestionHtml('), html.indexOf('async function persistTransferAttempt('));
  const start = html.slice(html.indexOf('async function startTransferTutor('), html.indexOf('function renderTaskExecution('));

  assert.match(card, /data-transfer-preview=/);
  assert.match(card, /data-transfer-question-preview/);
  assert.match(card, /data-transfer-start-tutor=/);
  assert.match(start, /if\(!session\.previewed\)return/);
  assert.match(html, /document\.addEventListener\('click',event=>\{let button=event\.target\.closest\('\[data-transfer-preview\]'\)/);
  assert.ok(start.indexOf('if(!session.previewed)return') < start.indexOf('persistTransferAttempt('),
    'preview gating must happen before any transfer case is persisted');
});
