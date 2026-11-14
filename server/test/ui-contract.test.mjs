import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');

test('网页脚本使用后台自动复核、多轮陪练和真实单位网格', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  const inlineScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc=/.test(match[1]));

  for (const [index, match] of inlineScripts.entries()) {
    const source = match[2].replace(/^\s*import\s+\*\s+as\s+THREE\s+from\s+['"].+?['"];?/m, 'const THREE = {};');
    assert.doesNotThrow(() => new vm.Script(source, {filename: `inline-script-${index}.js`}));
  }
  assert.match(html, /three\.module\.js/);
  assert.match(html, /id="deepseek-key" type="password"/);
  assert.match(html, /vendor\/katex\/katex\.min\.js/,
    'the app must load KaTeX from a local asset, including under file://');
  assert.match(html, /renderMathInElement/,
    'rendered learning content must be passed through KaTeX auto-render');
  assert.match(html, /function renderDelimitedMath\(root\)/,
    'KaTeX must still directly render delimited text when auto-render is unavailable');
  assert.match(html, /data-latex=/,
    'deterministic mathematical results must use a LaTeX source rather than plain text');
  assert.match(html, /id="save-deepseek"/);
  assert.match(html, /id="geometry-text-question"/);
  assert.match(html, /id="analyze-text-question"/);
  assert.match(html, /data-modeling-mode="model_first"/);
  assert.match(html, /data-modeling-mode="tutor_only"/);
  assert.match(html, /modelingMode:state\.geometryLearningMode/,
    'every geometry submission must carry the student-selected 3D policy');
  assert.match(html, /id="random-clean-problem"/);
  assert.match(html, /id="auto-review-status"/);
  assert.match(html, /后台自动复核/);
  assert.match(html, /解析并优先生成 3D/);
  assert.match(html, /开始纯 AI 陪练/);
  assert.match(html, /source:\s*'text'/);
  assert.match(html, /\/v1\/geometry\/random-problems/);
  assert.match(html, /\/v1\/tutor\/sessions/);
  assert.match(html, /data-tutor-status/);
  assert.match(html, /tutorHtml=function\(m\)\{[\s\S]*?return`<section class="tutor"/,
    'the active tutor transcript must stay open across every turn');
  assert.match(html, /turn\.directAnswer/,
    'answer-then-guide turns must show the direct answer in the transcript');
  assert.match(html, /initialStudentMessage:studentMessage/,
    'the first student response must be evaluated in the create-session request');
  assert.match(html, /state\.focusMistakeId&&state\.pendingFocusScroll/,
    'ordinary tutor rerenders must not scroll the page to the focused mistake');
  assert.match(html, /waiting_for_student/);
  assert.match(html, /function paintTutor\(mid\)/,
    'sending a tutor message must repaint only the current tutor panel');
  const scoreWrapperStart = html.indexOf('const sendTutorWithScore=sendTutor');
  const tutorSendStart = html.lastIndexOf('sendTutor=async function(mid,text){', scoreWrapperStart);
  const activeTutorSend = html.slice(tutorSendStart, scoreWrapperStart);
  assert.match(activeTutorSend, /paintTutor\(mid\)/,
    'the active send handler must update the fixed conversation panel');
  assert.doesNotMatch(activeTutorSend, /\brender\(\)/,
    'the active send handler must not rebuild the page while a message is sent');
  assert.match(html, /发送未完成：\$\{esc\(session\.error\)\}/,
    'a failed send must be visible and preserve the student input');
  assert.match(html, /new THREE\.GridHelper/);
  assert.match(html, /result\.scene\.dimensions/);
  assert.match(html, /element\.style==='focus'\?'focus'/,
    'queried vectors must remain visible even while the optional auxiliary-line layer is off');
  assert.doesNotMatch(html, /normalAidFromIr|ir-normal-arrow|normal-vector-PAC/,
    'the 3D model must not retain the reverted auxiliary-vector rendering additions');
  assert.match(html, /function scoreRubric\(m\)/,
    'each mistake must expose a problem-specific scoring-point rubric');
  assert.doesNotMatch(html, /solverStatus\s*===?\s*['"]verified['"]\)\)return\[/,
    'a verified 3D model must not activate the historical PAC scoring rubric for an unrelated problem');
  assert.match(html, /triangular_pyramid_projection_dihedral/,
    'projection-and-dihedral tetrahedron questions need their own scoring rubric');
  assert.doesNotMatch(html, /得分部分完成/,
    'the progress label must describe actual problem scoring points, not generic interaction parts');
  assert.match(html, /function liveScoreProgressHtml\(m\)/,
    'the active tutor must render the current problem scoring-point progress');
  assert.match(html, /role="progressbar"[^>]*aria-valuenow=/,
    'live solution progress must be exposed as an accessible progress bar');
  assert.match(html, /data-live-score-part=/,
    'students must see which problem-specific scoring parts are complete and current');
  assert.match(html, /function structuredSubproblems\(m\)/,
    'large problems must expose their numbered subquestions as top-level progress items');
  assert.match(html, /data-subproblem-select=/,
    'each subquestion must open its own complete tutoring session');
  assert.match(html, /function tutorSessionKey\(m,subproblem\)/,
    'subquestion tutor state must use a stable composite identity');
  /* 产品决策：3D 模型不可以在挂载时自动切换到某个小问的辅助图形 ——
     学生第一眼必须看到完整图形。这里断言挂载路径里没有自动套用高亮的调用。 */
  const switcherSource = html.slice(
    html.indexOf('function attachSubproblemSwitcher'),
    html.indexOf('window.__attachGeometrySubproblemSwitcher')
  );
  assert.ok(switcherSource.length > 0, '小问切换条必须存在');
  assert.doesNotMatch(switcherSource, /^\s*if \(activeId\) applySubproblemView/m,
    '挂载 3D 时不得自动套用某个小问的高亮，必须先显示完整图形');
  assert.match(html, /data-subproblem-view=/, '3D 面板顶部必须提供小问选择按钮');
  assert.match(html, /preferSubproblemFocus/, '选择小问后必须真正聚焦该问用到的图形');
  assert.match(html, /session\.learningState=remote\.learningState/,
    'each tutor response must persist the server-verified learning state before repainting');
  assert.match(html, /function refreshTutorState\(mid\)/,
    'a restored page must fetch the server-reconciled learning state before showing progress');
  assert.doesNotMatch(html, /data-score-complete=/,
    'solution completion must not be manually inflated from the student UI');
  const scoreProgressSource = html.slice(html.indexOf('function scoreProgress(m)'), html.indexOf('function scoreDraftFor(m)'));
  assert.doesNotMatch(scoreProgressSource, /book\.completed/,
    'legacy manual completion data must not inflate live solution progress');
  const scoreTutorSend = html.slice(html.indexOf('const sendTutorWithScore=sendTutor'), html.indexOf('const scoreRenderSession='));
  assert.doesNotMatch(scoreTutorSend, /paintTutor\(mid\)/,
    'the score wrapper must not repaint twice and cancel the progress animation');
  assert.match(html, /这是本题得分点完成度，不是 AI 工作流程/,
    'the progress bar must describe solution scoring-point completion rather than system workflow progress');
  assert.match(html, /系统可先生成分点草稿；只有你实际写出，或陪练出现已验证证据，才会计入/,
    'generated score-point suggestions must never be silently counted as student progress');
  assert.match(html, /function errorThoughtProfile\(m\)/,
    'incorrect student reasoning must be analysed as structured learning evidence');
  assert.match(html, /function completionReviewHtml\(learningState\)/,
    'a completed tutor session must render its persisted, evidence-based review');
  assert.match(html, /function persistCompletionReview\(m,learningState(?:,subproblem=null)?\)/,
    'completion review must be saved into the existing local mistake and plan state');
  assert.match(html, /<details class="turn completed-turn"/,
    'completed scoring-point conversations must collapse while remaining expandable');
  assert.match(html, /错误思路归纳/,
    'reasoning warnings must flow into the clustering view');
  assert.match(html, /思路修复任务/,
    'reasoning warnings must flow into the adaptive plan');
  assert.match(html, /session\.status==='completed'\?errorInsightHtml\(m\):''/,
    'reasoning warnings must stay out of the active tutoring page until a training round ends');
  const svgFallbackSource = html.slice(html.indexOf('function svgFallback'), html.indexOf('function safeSvgFallback'));
  assert.match(svgFallbackSource, /245-p\[2\]\*scale-p\[1\]\*scale\*\.34/,
    'the SVG fallback must use one shared spatial unit scale for x, y and z');
  assert.doesNotMatch(svgFallbackSource, /p\[2\]\*78/,
    'the SVG fallback must not retain the fixed-height projection that distorted 3:6 proportions');
  assert.doesNotMatch(svgFallbackSource, /marker-end|learningAids/,
    'the SVG fallback must retain the previously approved grid-and-frame rendering only');
  assert.match(html, /data-mistake-id=/, 'mistake cards must expose a stable DOM identity');
  assert.match(html, /state\.query\s*=\s*''/, 'successful upload must clear stale search filters');
  assert.match(html, /state\.focusMistakeId\s*=\s*solved\.id/, 'successful upload must focus the created case');
  const finishIngestionSource = html.slice(
    html.indexOf('async function finishAutomaticIngestion'),
    html.indexOf('renderUpload=function(v)', html.indexOf('async function finishAutomaticIngestion'))
  );
  assert.match(finishIngestionSource, /state\.demo3DOnly\s*=\s*false/,
    'a newly ingested learning-only case must not remain hidden by the classroom 3D-only filter');
  assert.match(html, /if\(focused&&!mountable\)state\.demo3DOnly=false/,
    'a previously submitted learning-only case must become visible again after refresh');
  assert.match(html, /'verified','reference'\]\.includes\(item\.geometryResult\.solverStatus\)/,
    'the classroom 3D filter must also expose renderable AI reference models, not only strictly verified ones');
  assert.match(html, /__dshReferenceSupport/,
    'the 3D mount layer must accept solverStatus="reference" results from the direct-model pipeline');
  assert.match(html, /geometry-label-layer/, '3D scene must render labels over the model');
  assert.match(html, /\.annotation-label\{[^}]*position:absolute/,
    'teaching annotations must follow their projected 3D object instead of flowing at the top-left');
  assert.match(html, /\.annotation-label\{[^}]*background:transparent[^}]*border:0/,
    'teaching annotations must be lightweight text rather than a long blocking strip');
  assert.doesNotMatch(html, /dimensions\.some\(item=>[^\n]*gridDistance\(item\)/,
    'display-only dimension metadata must never block mounting an otherwise verified, rotatable model');
  assert.match(html, /scene\.pedagogy/, 'the renderer must consume the verified pedagogical visualization layer');
  assert.match(html, /data-axis-grid="x"/, 'the model must retain the independent X grid button');
  assert.match(html, /data-axis-grid="y"/, 'the model must retain the independent Y grid button');
  assert.match(html, /data-axis-grid="z"/, 'the model must retain the independent Z grid button');
  assert.match(html, /data-three-view="perspective"/, 'the compact toolbar must retain perspective view');
  assert.doesNotMatch(html, /data-three-view="grid"/, 'the model toolbar must not expose a second top-view strip');
  assert.match(html, /class="three-toolbar"/, '3D controls must share one compact edge toolbar');
  assert.match(html, /\.three-toolbar\{[^}]*width:58px/, 'the control box must stay narrow and not span the model');
  assert.doesNotMatch(html, /<span class="three-badge">交互模型/, 'a full-width model title strip must not cover the canvas');
  assert.doesNotMatch(html, /three-badge/, 'the removed top strip must not remain as a style or markup layer');
  assert.match(html, /axisGridGroups|axisGridState|addCoordinateGrid/,
    'the three selectable coordinate grid planes must remain available');
  assert.doesNotMatch(html, /addAxis\(|className[^\n]*axis-label|,'axis-label'/,
    'selecting a coordinate grid must not add X/Y/Z letters over the model');
  assert.match(html, /addLine\(element,0x8d98a0,'dimensions'\)/,
    'the length switch must control both dimension labels and dimension lines');
  assert.match(html, /class="measure-toggle"[^>]*aria-pressed="true"/,
    'the compact toolbar must expose one unambiguous length switch');
  assert.match(html, /LineDashedMaterial/, 'verified auxiliary constructions must be visually distinct from original edges');
  assert.match(html, /annotation\.kind==='rightAngle'/, 'a verified right angle must render as a geometric square mark, not only text');
  assert.match(html, /semanticRole==='sphereBody'/, 'sphere translucency must be controlled as its own semantic object');
  assert.match(html, /semanticRole==='sectionPlane'/, 'the section plane must receive an independent translucent face');
  assert.match(html, /semanticRole==='sectionDisk'/, 'the actual section disk must be distinct from the optional mathematical plane');
  assert.match(html, /semanticRole==='sectionBoundary'/, 'the section boundary must receive an independent overlay style');
  assert.match(html, /new THREE\.LineLoop/, 'section boundaries must use a crisp solid line overlay');
  assert.match(html, /semanticRole==='sectionCenter'/, 'the section center must render as an independent point marker');
  assert.match(html, /semanticRole==='sphereCenter'/, 'the sphere center must render as an independent point marker');
  assert.match(html, /semanticRole==='centerToSectionDistance'/, 'the verified center distance must receive object-level emphasis');
  assert.doesNotMatch(html, /object\.scale\.setScalar\(1\.08\)/, 'teaching emphasis must never change mathematical display proportions');
  assert.doesNotMatch(html, /semanticRole==='sphereBody'[\s\S]{0,240}opacity=\.18/, 'section emphasis must not make the sphere body disappear');
  assert.doesNotMatch(html, /semanticEmphasis=\{faces:\[\],sections:\[\],boundaries:\[\],lines:\[\],points:\[\],distanceMarkers:\[\]\}/,
    'verified query-driven highlights must not be globally disabled');
  assert.match(html, /placedLabels/, 'projected labels must automatically avoid collisions');
  assert.match(html, /point-label/, '3D scene must label vertices beside their points');
  assert.match(html, /measure-label/, '3D scene must place dimensions beside their segments');
  assert.match(html, /\.project\(camera\)/, 'labels must follow the projected 3D positions');
  assert.doesNotMatch(html, /EduLab/, 'the product UI and stored presentation metadata must not expose the referenced website name');
  assert.doesNotMatch(html, /已验证空间模型<\/b><span class="pill good">\$\{esc\(m\.correctAnswer\)/, 'the model header must not reveal the answer');
  assert.doesNotMatch(html, /result\.scene\.grid\s*\|\|/, 'the renderer must not synthesize a default grid outside the IR');
  assert.doesNotMatch(html, /gridConfig&&gridConfig\.unit===1/, 'the renderer must accept the IR grid unit instead of hard-coding one unit');
  assert.match(html, /window\.__recordLearningEvent=event/);
  assert.doesNotMatch(html, /sk-[a-f0-9]{32}/i);
});

test('旧版已验证错题缺少单位网格时不会让错题页崩溃', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /function safeSvgFallback\(result\)/,
    'strict IR validation needs a per-model rendering boundary');
  assert.match(html, /safeSvgFallback\(m\.geometryResult\)/,
    'mistake cards must use the safe rendering boundary');
  assert.match(html, /不会使用默认网格/,
    'legacy data must remain recoverable without inventing geometry');
});

test('DeepSeek 直通参考模型使用同一 Three.js 面板，不再被已验证 IR 门槛拒绝', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /solverStatus===['"]reference['"]/,
    'ai_reference must be an explicit renderable mode');
  assert.match(html, /valueSource===['"]candidateCoordinates['"]/,
    'the reference grid must be allowed to follow DeepSeek candidate coordinates');
  assert.match(html, /isReference\|\|validPair\(scene\.queryLine\)/,
    'reference scenes must not require the verified-only queryLine field');
  assert.match(html, /isReference\|\|scene\.dimensions\.length/,
    'reference scenes must not require verified numerical dimensions');
});

test('计划是唯一决策中心，任务绑定真实错题的微技能与复习时间', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /const HIGH_SCHOOL_SKILL_LIBRARY=/);
  assert.match(html, /function buildDiagnosticPlanTasks\(\)/);
  assert.match(html, /function renderDecisionPlan\(v\)/);
  assert.match(html, /function renderTaskExecution\(task\)/);
  assert.match(html, /今天优先修复/);
  assert.match(html, /接下来怎么复习/);
  assert.match(html, /我的学习资源/);
  assert.match(html, /我的进步/);
  assert.match(html, /label:'① 近迁移'/);
  assert.match(html, /label:'② 变式迁移'/);
  assert.match(html, /label:'③ 混合迁移'/);
  assert.match(html, /data-plan-open/);
  assert.match(html, /data-complete-task/);
  assert.match(html, /function hydrateServerMistakes\(\)/,
    'verified server-side mistake cases must hydrate into the local planning state');
  assert.match(html, /\/v1\/mistake-cases/);
  assert.match(html, /合并 hydration 期间新提交的本地记录/,
    'an older hydration response must not overwrite a case submitted while it was in flight');
  assert.match(html, /if\(!localById\.has\(local\.id\)\)\s*localById\.set\(local\.id,local\)/,
    'hydration must preserve locally-created mistake records');
  assert.match(html, /verificationStatus:remoteCase\.verificationStatus\|\|local\?\.verificationStatus/,
    'a verified server upgrade must replace a stale local learning-only status');
  assert.match(html, /visualization:remoteCase\.visualization\|\|local\?\.visualization/,
    'a verified server model must replace a stale local no-model visualization');
  assert.match(html, /function transferQuestionsFor\(task,m\)/);
  assert.match(html, /data-transfer-start-tutor/);
  assert.doesNotMatch(html, /同一知识点与方法，换一道题练习/);
  assert.match(html, /上次：/);
  assert.match(html, /本次：/);
  assert.doesNotMatch(html, /第\$\{t\.day\}天/);
});

test('三阶迁移、错题库、归纳与计划共享同一条真实训练记录', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /function apiBaseForRequest\(\)/,
    'file 页面必须使用可恢复的本机 API 地址');
  assert.match(html, /输入没有丢失；请稍后重试/,
    '网络失败必须明确说明输入没有丢失');
  assert.match(html, /if\(REMOTE_SERVER_PAGE\)return location\.origin/,
    '公网页面必须只请求当前站点');
  assert.doesNotMatch(html, /fallback=androidShell\?null:'http:\/\/127\.0\.0\.1:4180'/,
    '公网请求失败不得回退访问者本机');
  assert.match(html, /await request\('\/v1\/transfer-items'/,
    '迁移陪练开始前必须先落成真实错题记录');
  assert.match(html, /state\.pendingTutorStart=\{caseId:transferCase\.id,studentAnswer\}/,
    'AI 陪练必须把迁移错题交给错题库的正常陪练流程');
  assert.match(html, /function upsertTransferMistake\(remoteCase\)/,
    '服务端迁移记录必须回流本地错题、归纳和计划状态');
  assert.match(html, /function renderDiagnosticClusters\(v\)/);
  assert.match(html, /全部 → 学科 → 单元 → 知识点 → 错因 → 题型/);
  assert.match(html, /气泡只来自真实错题/);
  assert.match(html, /学生原话 \/ 答题证据/);
  assert.match(html, /AI 判断的具体薄弱点/);
  assert.match(html, /function progressRows\(\)/);
  assert.match(html, /独立完成：\$\{row\.before\.independent\} → \$\{row\.after\.independent\}/);
  assert.match(html, /提示次数：\$\{row\.before\.hints\} → \$\{row\.after\.hints\}/);
  assert.match(html, /来自真实作答、正确性与提示记录/);
});

test('配置例题只从上传页走原生上传链路，不在启动时批量造错题', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  const feature = await readFile(path.join(root, 'implementation', 'grade10-example-library.js'), 'utf8');

  assert.doesNotMatch(feature, /\/import-all/,
    '例题模块不得在页面启动时批量导入完整错题');
  assert.match(feature, /analyze-text-question/,
    '示范题必须复用上传页原有的文本题目提交按钮');
  assert.match(html, /item\.origin!==['"]configured_example_upload['"]/,
    '旧批量示范记录不得在启动时重新灌入错题库');
  /* 原约束是"错题库不得同时挂载所有 WebGL 场景"。
     现在详情里的题目会在渲染后自动挂载成可旋转画布（否则新提交的模型只剩静态示意图，
     必须手点按钮才变画布）。所以这里改为检验真实语义：
     自动挂载必须存在、必须跳过已有画布的容器、且必须逐题判断后才挂载。 */
  const autoMountSource = html.slice(
    html.indexOf('function autoMountGeometryStages'),
    html.indexOf('function answerBlockHtml') > html.indexOf('function autoMountGeometryStages')
      ? html.indexOf('function answerBlockHtml')
      : html.indexOf('function autoMountGeometryStages') + 2000
  );
  assert.ok(autoMountSource.length > 0, '详情里的模型必须自动挂载成可旋转画布，不能只留静态示意图');
  assert.match(autoMountSource, /querySelector\('canvas'\)/,
    '自动挂载必须跳过已经是画布的容器，避免重复挂载');
  assert.match(autoMountSource, /mistake\.geometryResult\.scene/,
    '自动挂载必须先确认该题真的有可用模型');
  assert.doesNotMatch(autoMountSource, /state\.mistakes\.forEach[^]*__mountDeterministicThree/,
    '不得对错题库里每道题都挂载画布，只处理当前详情');
  assert.doesNotMatch(html, /Compatibility fallback/,
    '废弃的兼容托底代码应从页面中彻底移除');
});

test('几何归入数学单元且迁移题从类型简介进入错题库陪练', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /function normalizeAcademicCase\(mistake\)/,
    '历史与新增错题必须经过统一的学科、单元规范化');
  assert.match(html, /if\(m\.subject==='数学·几何'\)m\.subject='数学'/,
    '数学几何必须合并进数学学科');
  assert.match(html, /m\.unit==='立体几何'.*'空间几何'/,
    '立体几何历史数据必须归入空间几何单元');
  assert.doesNotMatch(html, /data-transfer-submit-only=/,
    '迁移简介不应要求学生再次填写原题完整答案');
  assert.match(html, /data-transfer-start-tutor=/,
    '迁移题必须提供开启 AI 陪练入口');
  assert.match(html, /async function persistTransferAttempt\(/,
    '进入陪练时仍需创建真实迁移错题');
  assert.match(html, /state\.tab='library'/,
    '开启陪练后必须自动跳转错题库');
  assert.match(html, /state\.focusMistakeId=transferCase\.id/,
    '跳转后必须聚焦刚创建的迁移错题');
  assert.match(html, /state\.pendingTutorStart=/,
    '错题库必须接管刚创建题目的正常 AI 陪练流程');
  assert.match(html, /async function syncTransferTutorAttempt\(/,
    '错题库中的后续陪练结果必须继续回写同一条迁移记录');
});

test('化学教学能力在网页中有可见入口并连接多轮教练与按需可视化', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /data-tab="chem"/, '底部导航必须提供可见的化学入口');
  assert.match(html, /function renderChemLab\(v\)/, '化学入口必须渲染真实学习页面');
  assert.match(html, /id="chem-question"/, '学生必须可以输入化学题目');
  assert.match(html, /\/v1\/teaching-coach\/sessions/, '化学页必须创建持久化教学教练会话');
  assert.match(html, /\/events/, '学生后续回答必须回流同一会话');
  assert.match(html, /conservation-table/, '页面必须能呈现配平与守恒教学');
  assert.match(html, /electron-transfer-map/, '页面必须能呈现电子转移教学');
  assert.match(html, /reaction-coordinate/, '页面必须能呈现反应能量教学');
  assert.match(html, /molecular-mechanism-3d/, '页面必须能呈现按需 3D 机理教学');
  assert.match(html, /window\.__mountChemistryDemo/, '选择 3D 时必须挂载真实 Three.js 演示');
  assert.match(html, /为什么现在展示这个/, '可视化必须说明教学调用理由');
});

test('解析几何与化学以独立课程页完整接入原库互动引擎', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  assert.match(html, /data-tab="analytic"/, '解析几何必须有独立导航入口');
  assert.match(html, /2D Canvas \+ KaTeX \+ 数据驱动参数引擎/);
  assert.match(html, /文字输入/);
  assert.match(html, /图片上传/);
  assert.match(html, /随机题目/);
  assert.match(html, /iframe class="skill-frame"/, '学科专属引擎不能被通用面板替代');
  assert.match(html, /location\.protocol==='file:'[\s\S]*?runtime=saved\.match/,
    '直接打开本地 index.html 时必须把已缓存的服务器课程 URL 恢复为真实存在的随包课程文件');
  assert.match(html, /skill-frame-title/, '互动课程必须有明确的可视化面板标题');
  assert.match(html, /analytic-shell/, '解析几何应把动态面板与交互画板置于同一个优先显示的工作区');
  assert.match(html, /动态面板、交互几何画板与实时读数保持同屏联动/, '解析几何页面必须明确说明滑块、读数和画板会一起变化');
  assert.match(html, /grid-template-areas:"frame" "entry"/, '窄屏时互动滑块画板必须位于长表单之前');
  assert.match(html, /\/v1\/chemistry\/assess/, '化学输入必须做能力审查，不能强套固定动画');
  assert.match(html, /if\(kind==='chemistry'&&!isImage\)[\s\S]*?teaching-coach\/sessions[\s\S]*?if\(kind==='chemistry'&&isImage\)[\s\S]*?chemistry\/assess/,
    '图片化学题必须先视觉提取，再审查提取出的反应；不能用文件名提前拦截');
  assert.match(html, /skill-frame-empty/, '不支持的化学输入必须移除旧动画，不能继续显示无关反应');
  assert.match(html, /generateRuntimeCourse[\s\S]*?capabilityAssessment=null/, '选择有效固定课程或随机题时必须解除先前的能力阻塞状态');
  assert.match(html, /openBundledCourse/, '固定完整课程必须能直接打开随包 HTML，不应依赖学习服务器在线生成');
  assert.match(html, /button\.dataset\.skillCourse\)\)/, '六门课程按钮必须直接切换对应随包互动页');
  assert.match(html, /ellipse_dot_range/);
  assert.match(html, /hyperbola_ecc_range/);
  assert.match(html, /combustion_ch4/);
  assert.match(html, /esterification/);
  assert.match(html, /\/v1\/teaching-coach\/sessions/);

  const analytic = await readFile(path.join(root, 'implementation', 'skills', 'analytic', 'ellipse_dot_range.html'), 'utf8');
  assert.match(analytic, /id="param-slider"/);
  assert.match(analytic, /id="geometry-canvas"/);
  assert.match(analytic, /id="rangebar-block"/);
  assert.match(analytic, /source:'edulab-skill'.*parameter_changed/,
    '画板参数与实时读数必须回流父页面供陪练使用');

  const chemistry = await readFile(path.join(root, 'implementation', 'skills', 'chemistry', 'combustion_ch4.html'), 'utf8');
  assert.match(chemistry, /id="reaction-slider"/);
  assert.match(chemistry, /id="canvas-container"/);
  assert.match(chemistry, /原子守恒/);
  assert.match(chemistry, /source:'edulab-skill'.*reaction_progress_changed/,
    '反应进度与步骤必须回流同题陪练会话');
  const electrolysis = await readFile(path.join(root, 'implementation', 'skills', 'chemistry', 'electrolysis_water.html'), 'utf8');
  assert.match(electrolysis, /"equation": "2\\\\,\\\\text\{H\}_2\\\\text\{O\}/, '水电解课程必须呈现真实配平方程');
  assert.match(electrolysis, /id="reaction-slider"/, '水电解必须有可拖动的反应进度');
  assert.match(electrolysis, /体积比约 2:1/, '水电解课程必须解释氢氧气体积比');
});

test('圆柱、圆锥、球使用已验证的圆体 IR 与专属 Three.js 实体渲染', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');

  assert.match(html, /圆柱、圆锥、球学习实验室/);
  assert.match(html, /\/v1\/circular-geometry\/solve/);
  assert.match(html, /geometry-ir\/v2/);
  assert.match(html, /window\.__safeGeometrySvgFallback/, '圆体入口必须使用已导出的安全 SVG 兜底');
  assert.match(html, /new THREE\.CylinderGeometry/);
  assert.match(html, /new THREE\.ConeGeometry/);
  assert.match(html, /new THREE\.SphereGeometry/);
  assert.match(html, /new THREE\.LineLoop/, '球截面必须由精确截圆的清晰实线边界表示');
});

test('空间模型拖拽采用受控平滑视角并可一键复位', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  assert.match(html, /data-reset-view/, '模型工具栏必须提供明确的视角复位按钮');
  assert.match(html, /targetRotationX/, '拖拽旋转应使用目标角与阻尼，避免视角生硬跳动');
  assert.match(html, /Math\.max\(-1\.12,Math\.min\(1\.12/, '垂直旋转必须限制俯仰角，避免模型翻转迷失');
  assert.match(html, /is-dragging/, '拖拽时应提供抓取状态反馈');
});

test('首页随机规整题进入统一 v3 四模型注册表', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  assert.match(html, /\/v1\/geometry\/random-v3/);
  assert.match(html, /开始作答并加入错题库/);
  assert.match(html, /result\.mistakeCase/);
  assert.match(html, /randomGeometryPreview/);
  assert.match(html, /\/v1\/geometry\/random-v3\/start/);
  assert.match(html, /四棱锥、圆柱、圆锥和球/);
});

test('闭环页提供证据知识卡、真实回忆闯关和文本笔记入口', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  const cards = await readFile(path.join(root, 'implementation', 'knowledge-cards.js'), 'utf8');
  assert.match(html, /knowledge-cards\.js/);
  assert.match(html, /querySelectorAll\('\[data-card\]'\).*remove/,
    '旧的固定模板思维卡按钮必须停止使用');
  assert.match(cards, /知识卡只能从已完成的真实陪练或真实笔记中提炼/);
  assert.match(cards, /不会用演示内容凑卡/);
  assert.match(cards, /data-kc-review/);
  assert.match(cards, /结论已隐藏/);
  assert.match(cards, /回答正确.*部分正确.*回答错误/s);
  assert.match(cards, /accept=\"\.txt,\.md,text\/plain,text\/markdown\"/);
  assert.match(cards, /你的回答已保留，可以直接重试/);
  assert.match(cards, /知识卡能力变化/);
  assert.match(cards, /不计入原始错题数量/);
  assert.match(html, /state\.tab==='card-challenge'/);
  assert.match(cards, /开始知识卡闯关/);
  assert.match(cards, /function renderRotation/);
  assert.match(cards, /逐张回忆、作答与反馈/);
});

test('统一上传入口把数学错题接回 3D 流程，旧场景可恢复且归纳复习共用入口', async () => {
  const html = await readFile(path.join(root, 'implementation', 'index.html'), 'utf8');
  const entry = await readFile(path.join(root, 'implementation', 'wrong-question-entry.js'), 'utf8');
  const study = await readFile(path.join(root, 'implementation', 'study-insights.js'), 'utf8');
  const css = await readFile(path.join(root, 'implementation', 'doodle-theme.css'), 'utf8');
  assert.match(entry, /String\(subject\|\|''\)\.trim\(\)\.startsWith\('数学'\)&&intake\.model3d/);
  assert.match(entry, /intake\.questionText=text\.value/);
  assert.match(entry, /call\('\/v1\/wrong-questions\/preview'/);
  assert.match(entry, /shouldBuild3d/);
  assert.match(entry, /#wq-combine-weak/);
  assert.match(css, /\.wq-upload-layout>\.wq-legacy-engine\{display:none!important\}/);
  assert.match(html, /hasModel=Boolean\(m\.geometryResult&&m\.geometryResult\.scene\)/);
  assert.match(html, /旧错题可能已保存完整场景与坐标/);
  assert.match(study, /combined\.textContent = '归纳·复习'/);
  assert.match(study, /subjectDistributionHtml\(\)/);
});
