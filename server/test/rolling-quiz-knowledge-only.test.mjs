import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRollingQuiz} from '../workflows/rolling-quiz.mjs';
import {createStudyRouter} from '../workflows/study-routes.mjs';
import {readFileSync} from 'node:fs';
import {QUIZ_OPTIONS} from '../workflows/rolling-quiz.mjs';
import {runInNewContext} from 'node:vm';

test('rolling quiz tests knowledge cards without copying original questions', () => {
  const cases = [{id: 'case-1', subject: '数学', question: '原题全文不应出现在卡片上', knowledgePoints: ['线面角']}];
  const knowledgeCards = [{id: 'card-1', subject: '数学', knowledgePoint: '线面角',
    content: '先找投影，再找夹角。', challengePrompt: '原题全文不应出现在卡片上', sourceCaseIds: ['case-1']}];
  const result = buildRollingQuiz({knowledgeCards, cases, now: new Date('2026-09-25T00:00:00Z')});
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, 'card');
  assert.equal(result.items[0].front.knowledgePoint, '线面角');
  assert.equal(result.items[0].front.wrongQuestionId, 'case-1');
  assert.equal(result.items[0].front.wrongQuestion, undefined);
  assert.doesNotMatch(JSON.stringify(result.items[0]), /原题全文/);
  assert.equal(result.stats.mistakes, 0);
});

test('edited front and back content are used verbatim by the quiz faces', () => {
  const result = buildRollingQuiz({knowledgeCards: [{id:'card-edit',subject:'物理',knowledgePoint:'电场',
    frontContent:'正面：先判断电势沿 x 如何变化。',backContent:'背面：场强等于电势对位置导数的负值。',
    content:'旧的理解内容',ai_explanation:'旧的解析'}]});
  assert.equal(result.items[0].front.cue,'正面：先判断电势沿 x 如何变化。');
  assert.equal(result.items[0].back.myUnderstanding,'背面：场强等于电势对位置导数的负值。');
  assert.equal(result.items[0].back.aiExplanation,'','自定义背面内容应作为完整背面，避免旧解析混入');
});

test('front content preserves exactly the selected full question and points, and honors an intentionally empty front', () => {
  const selected = '题目：两个正方形所在平面互相垂直，求中点连线长度。\n\n知识点：平面垂直\n\n解题方法：利用公共边建系，再用中点坐标与距离公式';
  const result = buildRollingQuiz({knowledgeCards: [
    {id:'card-selected',subject:'数学',knowledgePoint:'平面垂直',frontContent:selected,challengePrompt:'不得自动抄入的旧题干'},
    {id:'card-empty',subject:'数学',knowledgePoint:'平面垂直',frontContent:'',challengePrompt:'不得回退到旧题干'},
    {id:'card-legacy',subject:'数学',knowledgePoint:'平面垂直'}
  ]});
  const byId = new Map(result.items.map(item => [item.ref_id, item]));
  assert.equal(byId.get('card-selected').front.cue, selected);
  assert.equal(byId.get('card-empty').front.cue, '', '取消全部勾选后不可偷偷补回知识点');
  assert.match(byId.get('card-legacy').front.cue, /平面垂直/, '旧卡缺 frontContent 时保留兼容提示');
  const client = readFileSync(new URL('../../implementation/rolling-quiz.js', import.meta.url), 'utf8');
  const face = client.slice(client.indexOf('function faceHtml('), client.indexOf('function deckHtml('));
  assert.match(face, /rq-front-content/);
  assert.match(face, /front\.cue/);
  assert.doesNotMatch(face, /front\.knowledgePoint \|\| item\.knowledgePoint/, '知识点不得绕过勾选单独显示');
});

test('daily knowledge-card challenge displays the exact selected front text', () => {
  const client = readFileSync(new URL('../../implementation/knowledge-cards.js', import.meta.url), 'utf8');
  const challenge = client.slice(client.indexOf('function challenge(card)'), client.indexOf('function libraryCard(card)'));
  assert.match(challenge, /card\.frontContent/);
  assert.match(challenge, /kc-front-prompt/);
  assert.doesNotMatch(challenge, /请用自己的话说明这个知识点的含义/);
});

test('a wrong question alone never becomes a knowledge-card quiz item', () => {
  const result = buildRollingQuiz({cases: [{id: 'case-1', subject: '数学', question: '原题'}]});
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.subjects, []);
});

test('saved understanding links to the original case without copying its question or solution', async () => {
  const db = {cases: [{id: 'case-1', user_id: 'student-1', subject: '数学',
    question: '私有原题全文', analysis: '私有原题完整答案'}], knowledgeCards: []};
  const handler = createStudyRouter({db, currentUserId: 'student-1', canAccess: () => true,
    persist: async () => {}, requestBody: {text: '先找投影，再判断直线与投影的夹角。',
      knowledgePoint: '线面角', subject: '数学', sourceCaseIds: ['case-1'], trigger: 'tutor_complete'}});
  const response = {status: 0, body: null, writeHead(status) { this.status = status; },
    end(text) { this.body = JSON.parse(text); }};
  await handler({method: 'POST'}, response, new URL('http://localhost/v1/study/understanding'));
  assert.equal(response.status, 201);
  assert.deepEqual(response.body.card.sourceCaseIds, ['case-1']);
  assert.equal(response.body.queued, true);
  assert.doesNotMatch(JSON.stringify(response.body.card), /私有原题全文|私有原题完整答案/);
  assert.equal(db.fsrsCards.length, 1);
});

test('saving a knowledge card preserves an explicitly selected front exactly, including empty', async () => {
  for (const frontContent of ['题目：完整原题\n\n知识点：平面垂直\n\n方法：建立空间坐标系', '']) {
    const db = {cases: [], knowledgeCards: []};
    const handler = createStudyRouter({db, currentUserId: 'student-1', canAccess: () => true,
      persist: async () => {}, requestBody: {text: '学生自己的完整理解：先建系，再求中点坐标。', frontContent,
        knowledgePoint: '平面垂直', subject: '数学'}});
    const response = {status: 0, body: null, writeHead(status) { this.status = status; },
      end(value) { this.body = JSON.parse(value); }};
    await handler({method: 'POST'}, response, new URL('http://localhost/v1/study/understanding'));
    assert.equal(response.status, 201);
    assert.equal(response.body.card.frontContent, frontContent);
  }
});

test('all three card ratings call the FSRS review route and return the next interval', async () => {
  for (const rating of [1, 2, 3]) {
    const db = {cases: [], knowledgeCards: [{id: `card-${rating}`, user_id: 'student-1',
      subject: '数学', knowledgePoint: '线面角', content: '先看投影。'}]};
    const handler = createStudyRouter({db, currentUserId: 'student-1', canAccess: () => true,
      persist: async () => {}, requestBody: {cardId: `card-${rating}`, rating}});
    const response = {status: 0, body: null, writeHead(status) { this.status = status; },
      end(text) { this.body = JSON.parse(text); }};
    await handler({method: 'POST'}, response, new URL('http://localhost/v1/study/review'));
    assert.equal(response.status, 201);
    assert.equal(response.body.rating, rating);
    assert.match(response.body.intervalText, /天|分钟|小时|今天/);
    assert.equal(db.fsrsCards.length, 1);
    assert.equal(db.knowledgeCardReviews[0].rating, rating);
  }
});

test('a previously saved FSRS state without card_id can still be rated', async () => {
  const db = {cases: [], knowledgeCards: [{id: 'card-legacy', user_id: 'student-1',
    subject: '数学', knowledgePoint: '线面角', content: '先看投影。',
    fsrs: {state: 'Review', stability: 2, difficulty: 5, due: '2026-09-24T00:00:00Z',
      last_review: '2026-09-22T00:00:00Z'}}]};
  const handler = createStudyRouter({db, currentUserId: 'student-1', canAccess: () => true,
    persist: async () => {}, requestBody: {cardId: 'card-legacy', rating: 2},
    clock: () => new Date('2026-09-25T00:00:00Z')});
  const response = {status: 0, body: null, writeHead(status) { this.status = status; },
    end(value) { this.body = JSON.parse(value); }};
  await handler({method: 'POST'}, response, new URL('http://localhost/v1/study/review'));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.ok(response.body.card.fsrs.card.card_id);
  assert.equal(response.body.card.fsrs.card.stability > 0, true);
});

test('front choices are reversible previews; only back-side ratings call FSRS', () => {
  assert.deepEqual(QUIZ_OPTIONS.map(option => option.rating), [null, null, null]);
  const client = readFileSync(new URL('../../implementation/rolling-quiz.js', import.meta.url), 'utf8');
  for (const key of ['remembered', 'fuzzy', 'forgot']) {
    assert.match(client, new RegExp(`previewAnswer\\('${key}'\\)`));
  }
  assert.match(client, /data-rq-undo/);
  assert.match(client, /submitRating\(currentItem\(\), 1\)/);
  assert.match(client, /submitRating\(currentItem\(\), 2\)/);
  assert.match(client, /submitRating\(currentItem\(\), 3\)/);
});

test('preview knowledge-card library exposes edit and delete actions for owned cards', () => {
  const client = readFileSync(new URL('../../implementation/rolling-quiz.js', import.meta.url), 'utf8');
  assert.match(client, /data-rq-lib-edit/, 'library cards need a visible edit action');
  assert.match(client, /data-rq-lib-delete/, 'library cards need a visible delete action');
  assert.match(client, /querySelectorAll\('\[data-rq-lib-edit\]'\)/, 'edit action must be bound in the preview library');
  assert.match(client, /querySelectorAll\('\[data-rq-lib-delete\]'\)/, 'delete action must be bound in the preview library');
  assert.match(client, /正面内容（学生先看到的提示）/);
  assert.match(client, /背面内容（翻卡后看到的答案与理解）/);
  assert.match(client, /data-rq-edit-preview="frontContent"/);
  assert.match(client, /data-rq-edit-preview="backContent"/);
  assert.match(client, /typesetEditPreviews\(preview\.parentNode\)/, '输入正反面时应即时更新并排版预览');
  const library = client.slice(client.indexOf('function libraryHtml()'), client.indexOf('/* ---------------- 数据 */'));
  assert.match(library, /if\s*\(ui\.libraryEdit\)\s*grouped\s*=\s*''/, '进入编辑态时应收起长卡片列表，让编辑表单直接进入视口');
});

test('card-edit previews show front and back as separate faces and update from typing', async () => {
  const client = readFileSync(new URL('../../implementation/knowledge-cards.js', import.meta.url), 'utf8');
  assert.match(client, /data-kc-edit-preview="frontContent"/);
  assert.match(client, /data-kc-edit-preview="backContent"/);
  assert.match(client, /preview\.textContent=input\.value;typesetChallengeFronts\(preview\.parentNode\)/);
  const plan = readFileSync(new URL('../../implementation/plan-page.js', import.meta.url), 'utf8');
  assert.match(plan, /data-pp-card-overview/);
  assert.match(plan, /window\.__openKnowledgeCardLibrary\(\)/, '计划页入口应打开个人卡库，而非开始闯关');
});

test('opening card overview from Plan renders a library-only view and returns to its origin', async () => {
  const client = readFileSync(new URL('../../implementation/rolling-quiz.js', import.meta.url), 'utf8');
  let feature;
  const window = {__registerRollingQuiz(value) { feature = value; }};
  const document = {createElement() { return {textContent: ''}; }, head: {appendChild() {}}};
  runInNewContext(client, {window, document, Date, Set, Math, Promise, encodeURIComponent, setTimeout, clearTimeout});
  const state = {tab: 'plan'};
  const app = {state, save() {}, render() {}, esc(value) { return String(value); },
    request: async path => path === '/v1/knowledge-cards' ? [{id:'card-1',subject:'数学',title:'平面垂直',frontContent:'正面',backContent:'背面'}] : {items:[],subjects:[]}};
  feature.activate(app);
  feature.openLibrary();
  await new Promise(resolve => setTimeout(resolve, 0));
  const closeButton = {};
  const view = {className:'',innerHTML:'',querySelector() { return null; },querySelectorAll(selector) { return selector === '[data-rq-lib-close]' ? [closeButton] : []; }};
  feature.renderQuiz(view);
  assert.match(view.innerHTML, /我的知识卡片/);
  assert.doesNotMatch(view.innerHTML, /卡片滚动测验|开始今日大闯关/);
  assert.equal(typeof closeButton.onclick, 'function');
  closeButton.onclick();
  assert.equal(state.tab, 'plan');
  assert.match(client, /data-rq-exit/);
  feature.openForSubject('数学');
  feature.renderQuiz(view);
  await new Promise(resolve => setTimeout(resolve, 15));
  const exitButton = {};
  view.querySelectorAll = selector => selector === '[data-rq-exit]' ? [exitButton] : [];
  feature.renderQuiz(view);
  assert.match(view.innerHTML, /data-rq-exit/);
  assert.equal(typeof exitButton.onclick, 'function');
  exitButton.onclick();
  assert.equal(state.tab, 'plan');
});
