/* 上传页四个 tab 共用同一个容器，哪个模式该显示哪个面板必须显式写清。
   之前的 bug：panel.hidden 写成「不在 PAPER_MODES 里就隐藏」，
   结果「学生共享知识库」渲染完成后被整块藏掉，页面全白。
   这里锁住这段逻辑，并禁止再出现「按模式取反隐藏」的写法。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', 'implementation');

test('真正可见的卡库与错题库都有直接分享按钮', async () => {
  const quiz = await readFile(path.join(root, 'rolling-quiz.js'), 'utf8');
  const mistakes = await readFile(path.join(root, 'mistake-editor.js'), 'utf8');
  assert.match(quiz, /data-rq-lib-share=/);
  assert.match(quiz, /__eduShareToPlaza\(\{cardId: button\.dataset\.rqLibShare\}\)/);
  assert.match(mistakes, /data-me-share=/);
  assert.match(mistakes, /__eduShareToPlaza\(\{caseId: caseId\}\)/);
});

test('共享知识库面板不会被容器逻辑隐藏', async () => {
  const shared = await readFile(path.join(root, 'shared-knowledge.js'), 'utf8');
  // 容器可见性：只有「单题录入」才隐藏右侧面板
  assert.match(shared, /panel\.hidden = ui\.mode === 'mistakes'/, '容器可见性要按模式显式判断');
  assert.doesNotMatch(shared, /panel\.hidden\s*=\s*!PAPER_MODES\.includes/, '不许再按 PAPER_MODES 取反隐藏');
  assert.doesNotMatch(shared, /panel\.hidden\s*=\s*ui\.mode === 'mistakes'\s*\?/, '不要写成三元取反的旧形态');
  // 渲染前兜底取消隐藏，避免 tab 之间复用容器时残留 hidden
  const drawBody = shared.slice(shared.indexOf('function draw(panel) {'), shared.indexOf('function draw(panel) {') + 200);
  assert.match(drawBody, /panel\.hidden = false/, 'draw 开头要先确保容器可见');
  // 三个模式共用一个渲染器，必须显式传入口，不能靠「有没有传答题卡」猜
  assert.match(shared, /window\.__eduPaperEntry = ui\.mode === 'paper' \? 'examPaper' : 'batch'/);
  assert.match(shared, /const PAPER_MODES = \['paper', 'batch'\]/);
});

test('四个子 tab 的文案与顺序稳定', async () => {
  const shared = await readFile(path.join(root, 'shared-knowledge.js'), 'utf8');
  const order = [...shared.matchAll(/data-shared-mode="(\w+)">([^<]+)</g)].map(match => [match[1], match[2]]);
  assert.deepEqual(order, [
    ['mistakes', '单题录入'],
    ['batch', '批量错题'],
    ['paper', '试卷 + 答题卡'],
    ['shared', '学生共享知识库']
  ]);
});

test('共享面板在没有数据时给出可点的发布入口', async () => {
  const shared = await readFile(path.join(root, 'shared-knowledge.js'), 'utf8');
  // 登录后：空状态直接引导发布
  assert.match(shared, /data-shared-open-empty/);
  assert.match(shared, /data-shared-go-mistakes/);
  // 未登录：给出登录入口而不是空白
  assert.match(shared, /data-shared-login>登录后就能发布/);
  assert.match(shared, /shared-plaza-guest/);
  // 游客态下「登录」按钮有多处，必须全部接上事件
  assert.match(shared, /querySelectorAll\('\[data-shared-login\]'\)\.forEach/);
  // 搜索无结果（包括广场整体为空）要显示空状态，找到结果时才隐藏
  assert.match(shared, /empty\.hidden = visible > 0/);
});

test('广场只有知识卡片与错题分享两类，各自按学科筛选', async () => {
  const shared = await readFile(path.join(root, 'shared-knowledge.js'), 'utf8');
  assert.match(shared, /data-shared-category="cards"/, '应能切换到知识卡片');
  assert.match(shared, /data-shared-category="mistakes"/, '应能切换到错题分享');
  assert.match(shared, /categoryItems\s*=\s*ui\.items\.filter\(item\s*=>\s*plazaCategory\(item\)\s*===\s*ui\.category\)/,
    '先按类别分组，旧笔记也应归到知识卡片');
  assert.match(shared, /subjects\s*=\s*\[\.\.\.new Set\(categoryItems\.map\(/,
    '学科筛选只能列出当前类别的学科');
  assert.match(shared, /const filtered\s*=\s*categoryItems\.filter\(/,
    '卡片列表必须同时受类别和学科筛选');
  assert.match(shared, /payload\s*=\s*\{kind:\s*'card',\s*title/,
    '从广场直接发布的知识资料要进入知识卡片类');
});

test('共享附件的前端提示和校验与服务端 300 KB 上限一致', async () => {
  const shared = await readFile(path.join(root, 'shared-knowledge.js'), 'utf8');
  assert.match(shared, /最大 300 KB/);
  assert.match(shared, /ui\.file\.size > 300 \* 1024/);
  assert.doesNotMatch(shared, /2 \* 1024 \* 1024|最大 2 MB|超过 2 MB/);
});
