/* 做题记录（拍照识别出的手写解题过程）的展示契约。
   前端在浏览器里串了很长的 renderLibrary 补丁链，没法在 node 里跑真实 DOM，
   所以这里按项目既有做法断言源码契约：字段被读到、卡点有高亮、面板插在聚焦卡片上。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', 'implementation');
const read = name => readFile(path.join(root, name), 'utf8');

test('错题详情显示做题记录并标出卡点', async () => {
  const page = await read('wrong-question-entry.js');
  assert.match(page, /focused\.processSteps/, '要读错题上的解题过程');
  assert.match(page, /focused\.stuckAt/, '要读卡点');
  assert.match(page, /dataset\.wqRecord/, '面板要有稳定挂点，避免重复插入');
  assert.match(page, /卡点：/, '卡点要有人话标题');
  assert.match(page, /手写原文：/, '卡点要展示引用的手写原文');
  assert.match(page, /进入 AI 陪练会从这一步接着问/, '要告诉学生陪练会接着这一步教，不会从头复述');
  assert.match(page, /card\.append\(panel\)/, '面板要挂到当前聚焦的错题卡片上');
});

test('批量录入页展示逐步骤做题过程与卡点，且样式齐备', async () => {
  const page = await read('paper-upload.js');
  const css = await read('doodle-theme.css');
  assert.match(page, /AI 识别的解题过程/);
  assert.match(page, /item\.stuckAt/, '核对面板要标出卡点');
  assert.match(page, /weakPointClaims/, '要展示带原文的过程证据');
  for (const className of ['paper-steps', 'paper-step', 'paper-stuck', 'paper-weak', 'paper-progress']) {
    assert.match(css, new RegExp(`\\.${className}\\b`), `缺少样式 .${className}`);
  }
  assert.match(css, /\.paper-step\.stuck/, '卡点那一步要高亮');
});

test('批量错题与试卷答题卡使用不同的上传结构', async () => {
  const page = await read('paper-upload.js');
  const css = await read('doodle-theme.css');
  assert.match(page, /paper-upload--batch/, '批量错题有独立的版面标识');
  assert.match(page, /paper-batch-queue/, '批量错题呈现单一照片队列');
  assert.match(page, /paper-upload--exam/, '试卷模式有独立的版面标识');
  assert.match(page, /paper-exam-pairing/, '试卷与答题卡有明确的配对布局');
  assert.match(page, /const answerInput=panel\.querySelector\('\[data-answer-files\]'\);\s*if\(answerInput\)/,
    '批量模式不渲染答题卡控件时，事件绑定仍安全');
  assert.match(css, /\.paper-batch-queue/);
  assert.match(css, /\.paper-exam-pairing/);
});

test('没有 3D 模型时不再渲染整张「AI 参考空间模型」占位卡', async () => {
  const editor = await read('mistake-editor.js');
  const page = await read('index.html');
  // 旧占位卡片的创建代码必须彻底消失（两个渲染路径都要覆盖）
  for (const [name, source] of [['mistake-editor.js', editor], ['index.html（页面脚本）', page]]) {
    assert.doesNotMatch(source, /me-3d-missing/, `${name}：旧的缺少模型占位卡样式已删除`);
    assert.doesNotMatch(source, /me-missing-(body|why|cta)/, `${name}：旧的说明块样式已删除`);
    assert.doesNotMatch(source, /data-me-missing-3d/, `${name}：旧的挂点已删除`);
    assert.doesNotMatch(source, /这次没生成出来/, `${name}：旧的黄色标签文案已删除`);
  }
  assert.doesNotMatch(editor, /insertMissingModelPanel/, '旧的插入函数已删除');
  // 后台建模失败时，占位面板要被收掉，而不是改写成大卡片
  assert.match(page, /placeholder\.remove\(\)/, '失败时收掉占位面板');
  assert.match(page, /mistake\.geometryBuildStatus === 'failed' \|\| !mistake\.geometryBuildStatus/);
  assert.doesNotMatch(page, /placeholder\.innerHTML = '<div class="head"><b>AI 空间模型<\/b><span class="pill warn">/,
    '不许再把占位面板改写成失败卡片');
  // 保留的能力：状态标记 + 原因悬停 + 重新生成按钮 + 生成中占位
  assert.match(editor, /function missingModelBadge\(/);
  assert.match(editor, /function missingModelReason\(/);
  assert.match(editor, /missingModelReason\(record\) \+ ' 核对题干后可点「重新生成 3D 模型」/, '失败原因改到悬停提示里');
  assert.match(editor, /function insertBuildingPanel\(/, '只有生成中才占位');
  assert.match(editor, /record\.geometryBuildStatus !== 'queued' && record\.geometryBuildStatus !== 'building'/, '没有模型且不在生成中时直接不渲染');
  assert.match(editor, /if \(!has3D\) insertBuildingPanel\(card, caseId, record\)/);
  assert.match(editor, /data-me-rebuild=/);
});

test('重新生成 3D 模型改成后台跑，不再要求学生守着页面', async () => {
  const editor = await read('mistake-editor.js');
  const entry = await read('wrong-question-entry.js');
  // 提交时明确要求后台生成
  assert.match(editor, /background: true/);
  assert.match(editor, /开始后在后台生成|你可以先去别的地方/, '浮层里要说明可以离开');
  // 不再有阻塞提示与忙碌锁
  assert.doesNotMatch(editor, /请不要关闭页面。'/, '旧的阻塞提示文案必须消失');
  assert.doesNotMatch(editor, /statusLine\.textContent = '正在让 AI 解析题干/, '旧状态行已删除');
  assert.doesNotMatch(editor, /data-me-rebuild-status/, '旧状态行挂点已删除');
  // 提交成功后：关掉浮层 + 标记生成中 + 交给轮询
  assert.match(editor, /function markBuilding\(record\)/);
  assert.match(editor, /geometryBuildStatus: 'building'/);
  assert.match(editor, /window\.__wqWatchGeometryBuild\(record\.id\)/);
  assert.match(editor, /已在后台开始生成 3D 模型/);
  // 轮询收尾逻辑仍在 wrong-question-entry，并且被暴露出来复用
  assert.match(entry, /async function watchGeometryBuild\(caseId\)/);
  assert.match(entry, /window\.__wqWatchGeometryBuild = watchGeometryBuild/);
  assert.match(entry, /if\(remote\.geometryResult\?\.scene\|\|remote\.geometryBuildStatus==='failed'\)return/);
});

test('选择题与填空题不显示过程分析，解答题看不清时请学生自己写', async () => {
  const page = await read('paper-upload.js');
  const css = await read('doodle-theme.css');
  // 题型三分：选择题 / 填空题 / 解答题
  assert.match(page, /function typeLabel\(item\)/);
  assert.match(page, /type==='fill'\?'填空题'/);
  assert.match(page, /选择题只看最终答案对不对|只看最终答案/);
  // 只有解答题才给「我自己写一遍思路」的输入框
  assert.match(page, /function studentProcessHtml\(item\)/);
  assert.match(page, /if \(item\.type!=='written'\) return ''/, '选择题/填空题不给过程输入框');
  assert.match(page, /data-paper-mine/);
  assert.match(page, /不写就只当题目存下来/);
  assert.match(page, /studentProcess:\(card\.querySelector\('\[data-paper-mine\]'\)/, '学生写的思路要随确认提交');
  assert.match(css, /\.paper-mine\b/);
});

test('归纳页的薄弱点证据面板区分陪练证据与做题记录证据', async () => {
  const page = await read('wrong-question-entry.js');
  assert.match(page, /薄弱点证据/);
  assert.match(page, /evidenceType!=='process_review'/, '要按证据来源分类计数');
  assert.match(page, /做题记录/);
  assert.match(page, /AI 陪练/);
});

test('共享知识库：游客可浏览；知识卡与错题都能直接分享', async () => {
  const shared = await read('shared-knowledge.js');
  const entry = await read('wrong-question-entry.js');
  const cards = await read('knowledge-cards.js');
  const quiz = await read('rolling-quiz.js');
  const editor = await read('mistake-editor.js');
  const css = await read('doodle-theme.css');
  // 游客也能加载广场（不再因为没登录就直接清空）
  assert.match(shared, /window\.__eduShareToPlaza/, '要暴露统一的一键分享入口');
  assert.match(shared, /app\.request\('\/v1\/shared-knowledge'\)/);
  assert.doesNotMatch(shared, /if \(!current\) \{ ui\.items = \[\]; ui\.loadedFor = null; return; \}/,
    '未登录时不该直接清空广场列表');
  // 空状态要能直接发布
  assert.match(shared, /data-shared-open-empty/, '空广场要有发布入口');
  assert.match(shared, /data-shared-open/);
  assert.match(shared, /广场还没有资料/);
  assert.match(shared, /登录后就能发布/, '游客也要看到发布引导');
  // 保留错题制卡能力，但共享错题不再强制先制卡；可见卡库也要有分享入口。
  assert.match(entry, /data-wq-generate-card/);
  assert.match(entry, /__createKnowledgeCardFromMistake/);
  assert.match(cards, /data-kc-share/);
  assert.match(cards, /__eduShareToPlaza\(\{cardId:/);
  assert.match(quiz, /data-rq-lib-share/);
  assert.match(quiz, /__eduShareToPlaza\(\{cardId:/);
  assert.match(editor, /data-me-share/);
  assert.match(editor, /__eduShareToPlaza\(\{caseId:/);
  assert.match(shared, /'\/v1\/shared-knowledge\/share'/);
  // 样式
  assert.match(css, /\.wq-share\b/);
  assert.match(css, /\.shared-plaza-empty-first\b/);
});
