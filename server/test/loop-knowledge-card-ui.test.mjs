import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('闭环最后一步从当前错题初始化知识点和来源，再绑定保存按钮', async () => {
  const source = await readFile(new URL('../../implementation/loop-wizard.js', import.meta.url), 'utf8');
  const wizard = source.slice(source.indexOf('function wizardify(view)'), source.indexOf('function applyStep(view'));
  assert.match(wizard, /ui\.understanding\s*=\s*\{knowledgePoint:.*sourceCaseId:/);
  assert.ok(wizard.indexOf('ui.understanding =') < wizard.lastIndexOf('bind(view, questions)'), '保存按钮绑定前必须初始化知识点');
  assert.match(source, /subject: ui\.understanding\.subject/);
  assert.match(source, /error\.code !== 'SOURCE_CASE_NOT_FOUND'/);
});

test('迁移面板只移动任务操作区，不把第一题的开始按钮复制到外面', async () => {
  const wizard = await readFile(new URL('../../implementation/loop-wizard.js', import.meta.url), 'utf8');
  assert.match(wizard, /evidence\.querySelector\(':scope > \.row'\)/);
  const page = await readFile(new URL('../../implementation/index.html', import.meta.url), 'utf8');
  const card = page.slice(page.indexOf('function transferQuestionHtml('), page.indexOf('async function persistTransferAttempt('));
  assert.doesNotMatch(card, /<p>\$\{summary\}<\/p>/);
  assert.equal((card.match(/data-transfer-start-tutor=/g) || []).length, 1);
});

test('闭环保存后刷新知识卡数据并提供直达知识卡库入口', async () => {
  const wizard = await readFile(new URL('../../implementation/loop-wizard.js', import.meta.url), 'utf8');
  assert.match(wizard, /await\s+app\.request\('\/v1\/knowledge-cards'\)/);
  assert.match(wizard, /data-lw-open-card-library/);
});

test('闭环知识卡素材选项保留可读文本宽度，正面内容支持多行完整查看', async () => {
  const wizard = await readFile(new URL('../../implementation/loop-wizard.js', import.meta.url), 'utf8');
  assert.match(wizard, /\.lw-card-composer \.lw-source-option input\[type="checkbox"\][^{]*\{[^}]*width:18px!important[^}]*flex:0 0 18px!important/s, '复选框必须覆盖文本框的整行宽度和内边距');
  assert.match(wizard, /\.lw-card-composer \.lw-source-option span\{[^}]*flex:1 1 auto!important[^}]*min-width:0!important/s, '素材文字必须获得剩余宽度而非被挤成竖排');
  assert.match(wizard, /<textarea data-lw-front[^>]*>.*?<\/textarea>/s, '长题干正面应使用多行文本框');
});

test('陪练沉淀默认只存个人知识卡，保存后直达个人卡库', async () => {
  const page = await readFile(new URL('../../implementation/index.html', import.meta.url), 'utf8');
  const cards = await readFile(new URL('../../implementation/knowledge-cards.js', import.meta.url), 'utf8');
  const tutorCardAction = page.slice(page.indexOf("document.querySelectorAll('[data-tutor-card]')"), page.indexOf('/* 点得分点'));
  assert.match(page, /tutorTurns:session\.turns\|\|\[\]/);
  assert.doesNotMatch(tutorCardAction, /【题目】|【我的错误答案】|__eduShareToPlaza/);
  assert.match(tutorCardAction, /window\.__createKnowledgeCardFromMistake/);
  assert.match(tutorCardAction, /knowledgeCardSources\(m,session\)/);
  assert.match(cards, /默认只进个人库；勾选后才同步到共享广场/);
  assert.match(cards, /data-kc-share-after/);
  assert.match(cards, /sharingConfirmed:true/);
  assert.ok(cards.indexOf("app.request('/v1/study/understanding'") < cards.indexOf("app.request('/v1/shared-knowledge/share'"), '必须先持久化个人卡，再执行可选分享');
  assert.match(cards, /window\.__openKnowledgeCardLibrary\(savedCard\.id\)/);
  assert.match(cards, /data-kc-subject/);
  assert.match(cards, /data-kc-edit=/);
  assert.match(cards, /正面内容（学生先看到的提示）/);
  assert.match(cards, /背面内容（翻卡后看到的答案与理解）/);
  assert.match(cards, /data-kc-delete=/);
});

test('生成知识卡时可勾选正面来源与 AI 陪练背面片段，并分别编辑后保存', async () => {
  const cards = await readFile(new URL('../../implementation/knowledge-cards.js', import.meta.url), 'utf8');
  const page = await readFile(new URL('../../implementation/index.html', import.meta.url), 'utf8');
  assert.match(page, /caseQuestion:m\.question/, '题目要作为可选择的正面来源传入');
  assert.match(page, /knowledgePoints:m\.knowledgePoints\|\|\[\]/, '题目关联的全部知识点都应可供选择');
  assert.match(page, /microSkills:m\.microSkills\|\|\[\]/, '具体解题方法要点应可供选择');
  assert.match(page, /tutorTurns:session\.turns/, '逐轮对话要作为可选择的素材传入');
  assert.match(page, /knowledge-cards\.js\?v=20261005-question-preservation/);
  assert.match(page, /loop-wizard\.js\?v=20261005-question-preservation/);
  assert.match(cards, /student-turn-/, '学生每轮提问可单独选');
  assert.match(cards, /相关知识点/);
  assert.match(cards, /解题方法要点/);
  assert.match(cards, /ai-answer-/, 'AI 每轮回答可单独选');
  assert.match(cards, /ai-understanding-/, 'AI 每轮引导可单独选');
  assert.match(cards, /kc-composer-grid/, '必须展示正反面卡片编辑区');
  assert.match(cards, /renderMathInElement\(body/, '预览必须排版公式');
  assert.match(cards, /data-kc-front-option/);
  assert.match(cards, /data-kc-back-option/);
  assert.match(cards, /data-kc-front-content/);
  assert.match(cards, /data-kc-back-content/);
  assert.match(cards, /frontContent:.*frontContent/s);
  assert.match(cards, /backContent:.*backContent/s);
  const routes = await readFile(new URL('../../server/workflows/study-routes.mjs', import.meta.url), 'utf8');
  const cardsWorkflow = await readFile(new URL('../../server/workflows/my-understanding.mjs', import.meta.url), 'utf8');
  assert.match(routes, /frontContent: Object\.hasOwn\(body, 'frontContent'\) \? body\.frontContent : undefined/);
  assert.match(routes, /backContent: body\.backContent/);
  assert.match(cardsWorkflow, /frontContent: cue/);
  assert.match(cardsWorkflow, /backContent: answer/);
  const wizard = await readFile(new URL('../../implementation/loop-wizard.js', import.meta.url), 'utf8');
  assert.match(wizard, /data-lw-card-library-entry/, '闭环页面应有直接打开个人知识卡库的入口');
  assert.match(wizard, /data-lw-'\+side\+'-choice/);
  assert.match(wizard, /frontContent: frontContent/);
  assert.match(wizard, /function cardSourceOptions\(record, point, caseId, sourceQuestion\)/,
    '错题记录 ID 未匹配时仍需使用当前任务页上的原题全文');
  assert.match(wizard, /sourceQuestion = node\.textContent\.replace/,
    '必须先从当前任务展示内容读取原题，再尝试关联服务器错题');
  assert.match(wizard, /ui\.understanding\.question !== originalQuestion/,
    '同一个知识点切换到不同题目时不能复用旧的卡片草稿');
  assert.match(wizard, /selectedQuestion&&!frontContent\.includes\(selectedQuestion\.text\)/,
    '保存前应以勾选状态为准，确保选中的完整题目确实进入正面');
  assert.match(cards, /selectedQuestion&&!frontContent\.includes\(selectedQuestion\.text\)/,
    '错题库直达知识卡也必须在提交前兜底写入已勾选原题');
  assert.match(wizard, /function addBoth\(id,label,value\)/, '错因、错答和正确答案两面都应能选择');
  assert.match(wizard, /AI 讲解原文/, '闭环编辑器应保留逐轮讲解引用');
});

test('两轮陪练逐条进入正反面候选，不自动塞入长篇讲解', async () => {
  const source = await readFile(new URL('../../implementation/knowledge-cards.js', import.meta.url), 'utf8');
  const window = {__registerKnowledgeCards(feature){this.feature = feature}};
  const document = {createElement(){return {textContent:''}},head:{appendChild(){}}};
  runInNewContext(source, {window, document, Date, Set});
  const app = {state:{tab:'library'},save(){},render(){},request:async()=>[]};
  window.feature.activate(app);
  window.__createKnowledgeCardFromMistake({caseId:'case-1',knowledgePoint:'中点坐标',knowledgePoints:['中点坐标','平面垂直'],microSkills:['先用公共边建立空间直角坐标系','用中点坐标公式求中点连线'],caseQuestion:'求 O 的坐标',weakPoint:'不会用中点公式',errorCauses:['坐标关系混淆'],studentAnswer:'O=(0,0)',correctAnswer:'O=(3,3)',tutorTurns:[{studentMessage:'第一轮问题',directAnswer:'第一轮回答',understanding:'第一轮引导',explanation:'本题两个正方形共用边 AD，适合用空间坐标法。',nextQuestion:'第一轮追问'},{studentMessage:'第二轮问题',directAnswer:'暂不公布最终数值；先建坐标系。',understanding:'你已经明确表示这题目前不会，且没有写出可确认的解题步骤；我们需要从建系开始。',explanation:'第二轮真正的公式解释',nextQuestion:'第二轮追问'}]});
  const draft = app.state.pendingKnowledgeCard;
  assert.equal(app.state.tab,'knowledge-card-new');
  assert.deepEqual(Array.from(draft.frontOptions.filter(item=>item.id.startsWith('student-turn-')),item=>item.text),['我的问题/作答：第一轮问题','我的问题/作答：第二轮问题']);
  assert.equal(draft.frontOptions.find(item=>item.id==='related-knowledge-1').text,'知识点：平面垂直');
  assert.equal(draft.frontOptions.find(item=>item.id==='method-0').text,'解题方法：先用公共边建立空间直角坐标系');
  assert.equal(draft.frontOptions.find(item=>item.id==='method-0').checked,true,'具体方法默认纳入正面，避免只留下过于笼统的知识点名');
  const selectedFront=app.state.pendingKnowledgeCard.frontOptions.filter(item=>item.checked).map(item=>item.text).join('\n\n');
  for(const expected of ['题目：求 O 的坐标','知识点：中点坐标','解题方法：先用公共边建立空间直角坐标系'])assert.ok(selectedFront.includes(expected),`正面完整保留已选素材：${expected}`);
  assert.equal(draft.backOptions.find(item=>item.id==='method-back-1').text,'解题方法：用中点坐标公式求中点连线');
  assert.equal(draft.frontOptions.find(item=>item.id==='error-cause-0').text,'错因：坐标关系混淆');
  assert.equal(draft.backOptions.find(item=>item.id==='error-cause-back-0').text,'错因：坐标关系混淆');
  assert.equal(draft.frontOptions.find(item=>item.id==='wrong-answer').text,'我当时写的是：O=(0,0)');
  assert.equal(draft.backOptions.find(item=>item.id==='wrong-answer-back').text,'我当时写的是：O=(0,0)');
  assert.equal(draft.frontOptions.find(item=>item.id==='correct-answer').text,'正确答案：O=(3,3)');
  assert.equal(draft.backOptions.find(item=>item.id==='correct-answer-back').text,'正确答案：O=(3,3)');
  assert.deepEqual(Array.from(draft.backOptions.filter(item=>item.id.startsWith('ai-understanding-')),item=>item.text),['第一轮引导']);
  assert.equal(draft.backOptions.find(item=>item.id==='ai-explanation-0').text,'本题两个正方形共用边 AD，适合用空间坐标法。','保留真正的 AI 讲解原文引用');
  assert.equal(draft.backOptions.some(item=>item.text.includes('暂不公布最终数值')),false,'陪练状态提示不要进入卡片来源');
  assert.equal(draft.backOptions.some(item=>item.text.includes('你已经明确表示这题目前不会')),false,'“当前不会”等流程复述不要进入卡片来源');
  assert.ok(draft.backOptions.every(item=>!item.checked));
});

test('错题库传入不完整正面素材时仍补齐原题，并尊重学生显式取消', async () => {
  const source = await readFile(new URL('../../implementation/knowledge-cards.js', import.meta.url), 'utf8');
  const window = {__registerKnowledgeCards(feature) { this.feature = feature; }};
  const document = {createElement() { return {textContent: ''}; }, head: {appendChild() {}}};
  runInNewContext(source, {window, document, Date, Set});
  const app = {state:{tab:'library'},save(){},render(){},request:async()=>[]};
  window.feature.activate(app);
  const details = {caseId:'case-1',knowledgePoint:'平面垂直',subject:'数学',caseQuestion:'原题全文：求线段 OM 的长度。',
    frontOptions:[{id:'knowledge-point',label:'对应知识点',text:'知识点：平面垂直',checked:true}],
    backOptions:[{id:'ai-explanation',label:'AI 讲解',text:'先建立空间直角坐标系，再求中点坐标。',checked:true}]};
  window.__createKnowledgeCardFromMistake(details);
  let draft = app.state.pendingKnowledgeCard;
  assert.ok(draft.frontOptions.some(item => item.id === 'question' && item.text === '题目：原题全文：求线段 OM 的长度。' && item.checked),
    '已有其他正面选项不能让原题素材消失');
  assert.ok(uiFrontText(app.state).includes('原题全文：求线段 OM 的长度。'));

  app.state.tab = 'library';
  window.__createKnowledgeCardFromMistake({...details,frontOptions:[...details.frontOptions,{id:'question',label:'本题题目',text:'题目：原题全文：求线段 OM 的长度。',checked:false}]});
  draft = app.state.pendingKnowledgeCard;
  assert.equal(draft.frontOptions.find(item => item.id === 'question').checked, false, '学生主动取消原题时不能强制加回');
});

function uiFrontText(state) {
  return state.pendingKnowledgeCard.frontOptions.filter(item => item.checked).map(item => item.text).join('\n\n');
}
