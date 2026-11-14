import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {createPaperAnalysisAdapter,normalizePaperAnalysis,confirmPaperItems,paperWeakPointsFromCases,dedupeWeakPoints,paperPreflight,paperAutoFill} from '../workflows/paper-intake.mjs';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z9sAAAAASUVORK5CYII=';
const port=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value))})});
const post=(base,route,body,token='')=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});

const SCORE_ANALYSIS={subject:'数学',questions:[  {number:'1',type:'choice',question:'1. 求 f(2)，A. 2 B. 4',studentAnswer:'A',correctAnswer:'B',
    status:'wrong',markEvidence:'红笔圈出 A',weakPoints:['函数求值'],explanation:'学生选 A，标准答案 B。',paperPage:1,answerPage:1},
  {number:'2',type:'written',question:'2. 证明平行',studentAnswer:'写了第一步',status:'wrong',
    weakPoints:['线面平行'],explanation:'可能未完成证明'}]};
const RECORD_ANALYSIS={subject:'数学',questions:[
  {number:'1',type:'choice',question:'1. 求 f(2)，A. 2 B. 4',studentAnswer:'A',correctAnswer:'B',
    status:'wrong',markEvidence:'红笔圈出 A',weakPoints:['函数求值'],explanation:'学生选 A，标准答案 B。',paperPage:1,answerPage:1},
  {number:'18',type:'written',question:'18. 求二面角大小。',studentAnswer:'写到 cosθ=√3/2 就停了',paperPage:1,
    processSteps:[{label:'建立坐标系',detail:'以 A 为原点建系',formula:'A(0,0,0)',verdict:'correct'}],
    stuckAt:{stepIndex:1,label:'建系后没有继续',status:'wrong',evidence:'手写“以 A 为原点建系”后停笔'},
    weakPointClaims:[{knowledgePoint:'平面法向量',evidence:'手写“以 A 为原点建系”',stepIndex:1}],
    errorCause:'计算失误',errorCauseEvidence:'手写“以 A 为原点建系”后与后续步骤矛盾',
    weakPoints:['平面法向量','二面角'],explanation:'建系之后没有继续写。'}]};
/* 立体几何题：勾了「需要 3D 模型」应该能真的建出正方体场景（走本地确定性构造）。 */
const CUBE_ANALYSIS={subject:'数学',questions:[
  {number:'5',type:'written',question:'正方体 ABCD-A1B1C1D1 的棱长为 2，求它的体积。',
    studentAnswer:'V=2³=8',status:'wrong',markEvidence:'红笔圈出 8'}]};

test('paper analysis keeps uncertain scoring ungraded and does not invent weak points',()=>{
  const result=normalizePaperAnalysis(SCORE_ANALYSIS);
  assert.equal(result.questions[0].status,'wrong');
  // 选择题不看过程、也不从题干难度反推薄弱点：只有解答题才谈得上卡点和错因
  assert.deepEqual(result.questions[0].weakPoints,[]);
  assert.deepEqual(result.questions[0].processSteps,[]);
  assert.equal(result.questions[0].stuckAt,null);
  assert.equal(result.questions[0].errorCause,'');
  assert.equal(result.questions[0].needsStudentProcess,false,'选择题不请学生补过程');
  assert.equal(result.questions[1].status,'needs_review');
  assert.deepEqual(result.questions[1].weakPoints,[]);
  assert.equal(result.questions[1].explanation,'');
  assert.equal(result.questions[1].needsStudentProcess,true,'解答题读不到过程时要请学生自己写');
  const draft={id:'draft-1',source:'paper_batch',subject:'数学',questions:result.questions,paperImages:[],answerImages:[]};
  const cases=confirmPaperItems(draft,{selectedIds:[result.questions[0].id],corrections:{
    [result.questions[0].id]:{question:'核对后的题干',studentAnswer:'A'}}},'student-a');
  assert.equal(cases.length,1);
  assert.equal(cases[0].question,'核对后的题干');
  assert.equal(cases[0].user_id,'student-a');
  assert.deepEqual(cases[0].errorCauses,[]);
  assert.deepEqual(cases[0].aiSuggestedWeakPoints,[]);
});

test('recognizes verbatim handwritten margin annotations and persists the confirmed crop image reference',()=>{
  const result=normalizePaperAnalysis({subject:'数学',questions:[{
    number:'3',type:'choice',question:'3. 题目',studentAnswer:'C',correctAnswer:'C',
    handwrittenAnnotations:['这里截距不为 0','y=5/3 x'],judgementReason:'学生写“截距不为 0”后，结论与条件一致。'}]});
  assert.deepEqual(result.questions[0].marginNotes,['这里截距不为 0','y=5/3 x']);
  const rationaleOnly=normalizePaperAnalysis({subject:'数学',questions:[{
    number:'7',question:'7. 判断截距。',studentAnswer:'C',
    judgementReason:'学生括号内写“C”，旁注写“截距不为0，y+x=8” “y=kx，y=5/3 x”，所以选 C。'}]});
  assert.deepEqual(rationaleOnly.questions[0].marginNotes,['截距不为0，y+x=8','y=kx，y=5/3 x'],
    '模型把旁注只写进判断依据时，应提取其明确引用的旁注原文');
  const draft={id:'draft-crop',source:'paper_batch',subject:'数学',paperImages:[],answerImages:[],questions:result.questions};
  const crop={hash:'a'.repeat(64),mimeType:'image/jpeg',fileName:'第3题.jpg'};
  const [record]=confirmPaperItems(draft,{selectedIds:[result.questions[0].id],corrections:{
    [result.questions[0].id]:{question:'3. 题目',marginNotes:'这里截距不为 0\ny=5/3 x',questionImage:crop}}},'student-a');
  assert.deepEqual(record.marginNotes,['这里截距不为 0','y=5/3 x']);
  assert.deepEqual(record.sourceImage,crop);
});

test('a cropped exam-page image is stored with its selected wrong question and can be read back',async t=>{
  const temp=await mkdtemp(path.join(path.resolve(import.meta.dirname,'..'),'.test-paper-crop-'));
  const provider=createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({subject:'数学',questions:[{
      number:'3',type:'choice',question:'3. 题目',studentAnswer:'C',correctAnswer:'C',status:'correct',paperPage:1}]})}}]}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const assignedPort=await port();
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,
    PORT:String(assignedPort),AUTH_REQUIRED:'0',API_TOKEN:'',DATA_FILE:path.join(temp,'data.json'),INTAKE_IMAGE_ROOT:path.join(temp,'uploads'),
    MODEL_CONFIG_FILE:path.join(temp,'no-model.json'),DEEPSEEK_API_KEY:'test',
    DEEPSEEK_ENDPOINT:`http://127.0.0.1:${provider.address().port}/chat/completions`,DEEPSEEK_VISION_MODEL:'deepseek-flash'},
    windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();provider.close();await rm(temp,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${assignedPort}`;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,50))}
  const preview=await post(base,'/v1/papers/preview',{paperImages:[image],mode:'batch'});
  assert.equal(preview.status,201,await preview.clone().text());
  const draft=(await preview.json()).draft;
  const item=draft.questions[0];
  const confirmed=await post(base,`/v1/papers/drafts/${draft.id}/confirm`,{
    selectedIds:[item.id],corrections:{[item.id]:{marginNotes:'蓝色旁注原文'}},questionImages:{[item.id]:image}});
  assert.equal(confirmed.status,201,await confirmed.clone().text());
  const [record]=(await confirmed.json()).mistakeCases;
  assert.deepEqual(record.marginNotes,['蓝色旁注原文']);
  assert.ok(record.sourceImage?.hash);
  const response=await fetch(`${base}/v1/wrong-questions/images/${record.sourceImage.hash}`);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(image.split(',')[1],'base64'));
});

test('选择题与填空题不看过程，只按答案判对错',()=>{
  const result=normalizePaperAnalysis({subject:'数学',questions:[
    // 选择题：模型硬塞过程也要丢掉
    {number:'1',type:'choice',question:'1. 选哪个？A.1 B.2',studentAnswer:'A',correctAnswer:'B',
      processSteps:[{label:'不该有',detail:'选择题没有过程'}],stuckAt:{stepIndex:1,label:'不该有',evidence:'不该有'},
      weakPointClaims:[{knowledgePoint:'不该有',evidence:'不该有'}],weakPoints:['不该有'],
      judgement:'wrong',judgementReason:'学生写“A”但正确是 B'},
    // 填空题：答案不一致就是错，但不给过程
    {number:'2',type:'fill',question:'2. 填空：x=____',studentAnswer:'3',correctAnswer:'4',
      processSteps:[{label:'不该有',detail:'填空题没有过程'}],weakPoints:['不该有']},
    // 填空题：读不出答案时不动手
    {number:'3',type:'fill',question:'3. 填空：y=____',studentAnswer:'',correctAnswer:'5'},
    // 填空题：答案一致就是对
    {number:'4',type:'fill',question:'4. 填空：z=____',studentAnswer:'6',correctAnswer:'6'}]});
  const [choice,fillWrong,fillBlank,fillRight]=result.questions;
  assert.equal(choice.type,'choice');
  assert.equal(choice.status,'wrong');
  assert.deepEqual(choice.processSteps,[]);
  assert.equal(choice.stuckAt,null);
  assert.deepEqual(choice.weakPoints,[]);
  assert.equal(choice.needsStudentProcess,false);
  assert.equal(fillWrong.type,'fill');
  assert.equal(fillWrong.status,'wrong','填空题两边都写得出且不同就是错');
  assert.deepEqual(fillWrong.processSteps,[]);
  assert.deepEqual(fillWrong.weakPoints,[]);
  assert.equal(fillBlank.status,'needs_review','答案读不出来时不判错');
  assert.equal(fillRight.status,'correct');
});

test('解答题读不到过程时请学生自己写，学生写了就收进做题记录',()=>{
  const result=normalizePaperAnalysis({subject:'数学',questions:[
    {number:'18',type:'written',question:'18. 求二面角大小。',studentAnswer:'',processSteps:[]}]});
  assert.equal(result.questions[0].needsStudentProcess,true);

  // 学生自己写了一遍思路 → 存成做题记录、并作为薄弱点证据
  const draft={id:'draft-s',source:'paper_batch',subject:'数学',paperImages:[],answerImages:[],
    questions:result.questions};
  const [record]=confirmPaperItems(draft,{selectedIds:[result.questions[0].id],corrections:{
    [result.questions[0].id]:{question:'18. 求二面角大小。',studentProcess:'我先建系写了 A(0,0,0)，然后算到法向量那里就不会了'}}},'student-s');
  assert.equal(record.studentProcessSource,'student_typed');
  assert.match(record.analysis,/我先建系/);
  assert.equal(record.needsStudentProcess,false,'学生写过了就不再提示补过程');
  const ownPoints=paperWeakPointsFromCases([record]);
  assert.equal(ownPoints.length,1,'学生自述的做题记录也要生成薄弱点');
  assert.equal(ownPoints[0].evidenceSource,'student_self_report');
  assert.equal(ownPoints[0].signal,'学生自述卡点');
  assert.match(ownPoints[0].evidenceQuote,/我先建系/);

  // 学生不写 → 只当题目入库，不硬猜
  const [bare]=confirmPaperItems(draft,{selectedIds:[result.questions[0].id],corrections:{
    [result.questions[0].id]:{question:'18. 求二面角大小。'}}},'student-s');
  assert.equal(bare.studentProcessSource,'none');
  assert.doesNotMatch(bare.analysis,/我先建系/);
  assert.deepEqual(bare.knowledgePoints,[],'学生不表达就不生成薄弱点');
});

/* 这一组锁住「本批识别暂未完成」的根因：
   实测 2 页 1 题就要 48 秒，reasoning_tokens 占 completion_tokens 的 94%。
   所以失败原因必须能被区分出来、能回传到前端，而不是一律报同一句话。 */
test('识别失败要把真实原因带出来：空正文/坏 JSON/供应商报错/超时各自可分辨',async()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR42u3NMQEAAAgDoC251a3gLzSgmXBPFEVRFEVRFEVRFEXxWnwXTQGx6TZ8AAAAAElFTkSuQmCC';
  const makeAdapter=fetchImpl=>createPaperAnalysisAdapter({endpoint:'https://example.test',apiKey:'k',model:'m',fetchImpl,timeoutMs:1200});
  const respond=(status,body)=>async()=>new Response(JSON.stringify(body),{status});
  const capture=async fetchImpl=>{
    try{await makeAdapter(fetchImpl)({paperImages:[image],answerImages:[]});return null}
    catch(error){return error}
  };

  // 模型把预算花在推理上，正文为空 —— 以前会变成 JSON.parse('') 的语法错误，毫无指向性
  const empty=await capture(respond(200,{choices:[{finish_reason:'length',message:{content:''}}],usage:{completion_tokens:16000}}));
  assert.equal(empty.code,'PAPER_MODEL_EMPTY_OUTPUT');
  assert.match(empty.message,/生成预算被推理用尽/);
  assert.match(empty.message,/completion_tokens=16000/);

  // 正文不是 JSON —— 至少要把模型说的原话带出来
  const badJson=await capture(respond(200,{choices:[{finish_reason:'stop',message:{content:'抱歉，我看不清这张图'}}]}));
  assert.equal(badJson.code,'PAPER_MODEL_BAD_JSON');
  assert.match(badJson.message,/我看不清这张图/);

  // 供应商 400 的 message 以前被整条丢掉，现在必须带出来
  const http400=await capture(respond(400,{error:{message:'unsupported image format'}}));
  assert.equal(http400.code,'PAPER_MODEL_HTTP_400');
  assert.match(http400.message,/unsupported image format/);

  // 401 不重试：只调一次
  let calls=0;
  const http401=await capture(async()=>{calls+=1;return new Response(JSON.stringify({error:{message:'invalid api key'}}),{status:401})});
  assert.equal(http401.code,'PAPER_MODEL_HTTP_401');
  assert.equal(calls,1,'鉴权失败不该重试');

  // 超时要能说清"单次超过多少秒"
  const timeout=await capture(()=>new Promise((_,reject)=>setTimeout(()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),30)));
  assert.equal(timeout.code,'PAPER_MODEL_TIMEOUT');
  assert.match(timeout.message,/单次超过/);
});

test('推理吃满预算时提高 max_tokens 重试一次',async()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJUlEQVR42u3NMQEAAAgDoC251a3gLzSgmXBPFEVRFEVRFEVRFEXxWnwXTQGx6TZ8AAAAAElFTkSuQmCC';
  const budgets=[];
  const adapter=createPaperAnalysisAdapter({endpoint:'https://example.test',apiKey:'k',model:'m',timeoutMs:2000,
    fetchImpl:async(_url,options)=>{
      budgets.push(JSON.parse(options.body).max_tokens);
      // 第一次：预算被推理吃光，正文为空；第二次：正常返回
      const first=budgets.length===1;
      return new Response(JSON.stringify(first
        ?{choices:[{finish_reason:'length',message:{content:''}}],usage:{completion_tokens:32000}}
        :{choices:[{finish_reason:'stop',message:{content:JSON.stringify({subject:'数学',questions:[{number:'1',question:'q',status:'wrong'}]})}}]}),{status:200})}});
  const result=await adapter({paperImages:[image],answerImages:[]});
  /* 基线改成 32000：实测这份提示词单页要推理 12k~16k tokens，从 16000 起步会让
     第一次尝试经常把预算烧在推理上、正文为空，白等 70 秒再重试。 */
  assert.deepEqual(budgets,[32000,48000],'第二次必须用更大的生成预算');
  assert.ok(budgets[1]>budgets[0],'重试要用更大的预算');
  assert.equal(result.questions.length,1);
});

test('快速模式：用短提示词、不预判薄弱点，超时预算也更短',async()=>{
  let payload=null;
  const adapter=createPaperAnalysisAdapter({endpoint:'https://example.test',apiKey:'k',model:'m',fast:true,
    fetchImpl:async(_url,options)=>{
      payload=JSON.parse(options.body);
      return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({subject:'数学',
        questions:[{number:'1',type:'written',question:'求二面角大小',studentAnswer:'',correctAnswer:'',status:'needs_review'}]})}}]}),{status:200})}});
  const result=await adapter({paperImages:['data:image/png;base64,AA=='],answerImages:[]});
  const promptText=payload.messages[0].content[0].text;
  assert.ok(promptText.length<900,`快速模式必须用短提示词（实际 ${promptText.length} 字）`);
  assert.doesNotMatch(promptText,/weakPointClaims/,'快速模式不再要求薄弱点声明');
  assert.equal(result.questions.length,1);
  assert.deepEqual(result.questions[0].weakPoints,[],'快速模式不预判薄弱点');
  assert.equal(result.questions[0].needsStudentProcess,true,'解答题没读到过程时仍标记需要学生自述');
});

/* 答案来源分三档，直接决定学生看到的是不是「标准答案」，也决定 AI 敢不敢下判断。
   printed（卷上印的）> provided（另外上传/手输的）> derived（AI 自己推的，必须承认可能是错的）。 */test('答案来源分三档：印的/另传的/AI 推的，AI 推的必须承认把握不足', () => {
  const base = {subject: '数学', questions: []};
  const one = extra => ({number: '1', question: '1. 求二面角大小。', type: 'choice', studentAnswer: 'A', ...extra});

  // 卷子上印着答案 → printed，不需要置信度
  const printed = normalizePaperAnalysis({...base, questions: [one({correctAnswer: 'B', answerSource: 'printed'})]});
  assert.equal(printed.questions[0].answerSource, 'printed');
  assert.equal(printed.questions[0].answerConfidence, undefined, 'printed 不该带置信度');

  // 图片上没答案、AI 自己推出来 → 必须 derived，且读不到置信度时按 low 处理
  const derived = normalizePaperAnalysis({...base, questions: [one({correctAnswer: 'B', answerSource: 'derived'})]});
  assert.equal(derived.questions[0].answerSource, 'derived');
  assert.equal(derived.questions[0].answerConfidence, 'low', '没给 confidence 时按最低把握处理，宁可多提醒一次');

  // AI 说自己有把握 → 如实保留 high
  const confident = normalizePaperAnalysis({...base, questions: [one({correctAnswer: 'B', answerSource: 'derived', answerConfidence: 'high'})]});
  assert.equal(confident.questions[0].answerConfidence, 'high');

  // 模型没给 answerSource 时按「有没有答案」兜底
  const inherited = normalizePaperAnalysis({...base, questions: [one({correctAnswer: 'B'}), {...one({}), number: '2'}]});
  assert.equal(inherited.questions[0].answerSource, 'printed', '有答案但没标来源 → 按印刷答案兜底');
  assert.equal(inherited.questions[1].answerSource, 'derived');

  // 推导关键步骤与旁注只在有内容时保留，且旁注不混进解题过程
  const rich = normalizePaperAnalysis({...base, questions: [one({
    correctAnswer: 'B', answerSource: 'derived', answerConfidence: 'medium',
    correctAnswerSteps: ['先取法向量', '再判断锐角还是钝角'], marginNotes: ['这里我算错了符号']})]});
  assert.deepEqual(rich.questions[0].correctAnswerSteps, ['先取法向量', '再判断锐角还是钝角']);
  assert.deepEqual(rich.questions[0].marginNotes, ['这里我算错了符号']);
  assert.equal(rich.questions[0].processSteps.some(step => String(step.detail || '').includes('算错了符号')), false,
    '旁注不能混进解题过程');
});

test('确认入库时：学生改过的答案算「另传的」，且不再挂着 AI 的置信度', () => {
  const draft = {id: 'd1', source: 'paper_batch', subject: '数学',
    questions: [{id: 'q1', number: '1', type: 'written', question: '1. 求体积。', studentAnswer: '我写的是 8',
      correctAnswer: '12', answerSource: 'derived', answerConfidence: 'low',
      processSteps: [], stuckAt: null, weakPoints: [], weakPointClaims: []}]};
  // 学生没动答案 → 沿用 derived
  const kept = confirmPaperItems(draft, {selectedIds: ['q1']}, 'stu-1')[0];
  assert.equal(kept.answerSource, 'derived', '学生没改就沿用识别阶段的来源');
  assert.equal(kept.answerConfidence, 'low');
  // 学生手动把答案改掉（12 → 12.5）→ 那就是他自己确认过的答案，可信度升到 provided
  const fixed = confirmPaperItems(draft, {selectedIds: ['q1'], corrections: {q1: {correctAnswer: '12.5'}}}, 'stu-1')[0];
  assert.equal(fixed.correctAnswer, '12.5');
  assert.equal(fixed.answerSource, 'provided', '学生手动改过 → 视为他自己确认的答案');
  assert.equal(fixed.answerConfidence, undefined, 'provided 不该继续挂着 AI 的置信度');
  // 学生「改回和 AI 一样」等于没改，仍然算 AI 推的（不能靠这个把置信度洗掉）
  const same = confirmPaperItems(draft, {selectedIds: ['q1'], corrections: {q1: {correctAnswer: '12'}}}, 'stu-1')[0];
  assert.equal(same.answerSource, 'derived');
  assert.equal(same.answerConfidence, 'low');
});

test('vision request sends paper pages before answer pages',async()=>{
  let payload;
  const adapter=createPaperAnalysisAdapter({endpoint:'https://example.test',apiKey:'test',model:'deepseek-flash',
    fetchImpl:async(_url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(RECORD_ANALYSIS)}}]}),{status:200})}});
  const result=await adapter({paperImages:['paper-one','paper-two'],answerImages:['answer-one']});
  assert.equal(payload.messages[0].content[1].image_url.url,'paper-one');
  assert.equal(payload.messages[0].content[2].image_url.url,'paper-two');
  assert.equal(payload.messages[0].content[4].image_url.url,'answer-one');
  assert.equal(result.questions.length,2);
  assert.equal(result.questions[1].stuckAt.label,'建系后没有继续','识别到的卡点要出现在归一化结果里');
});

test('批量错题：AI 自己读手写作业判对错，判不清交回学生',()=>{
  const result=normalizePaperAnalysis({subject:'物理',questions:[
    // 没有批改痕迹、没有得分，AI 读学生写的结论判错——理由引用了手写原文
    {number:'1',question:'1. 求加速度。',type:'written',studentAnswer:'a=F/m=20/2=5 m/s²',
      judgement:'wrong',judgementReason:'学生写到“a=F/m=20/2=5 m/s²”，把 20 N 当成合外力，漏了摩擦力 2 N'},
    // AI 判对，理由同样引用原文
    {number:'2',question:'2. 求速度。',type:'written',studentAnswer:'v=at=2×3=6 m/s',
      judgement:'correct',judgementReason:'学生写“v=at=2×3=6 m/s”，代入与单位都正确'},
    // 理由引用不到学生原文 → 不许下判断，交回学生
    {number:'3',question:'3. 求功率。',type:'written',studentAnswer:'P=W/t',
      judgement:'wrong',judgementReason:'这道题比较难，学生应该不会'},
    // 照片模糊：AI 明确说看不清
    {number:'4',question:'4. 求位移。',type:'written',studentAnswer:'',
      status:'needs_review',judgementReason:''}]});
  const [wrong,correct,uncited,blurry]=result.questions;
  assert.equal(wrong.status,'wrong','AI 判定做错要生效');
  assert.equal(wrong.aiJudgement,'wrong');
  assert.match(wrong.aiJudgementReason,/漏了摩擦力/);
  assert.equal(correct.status,'correct','AI 判定做对要生效');
  assert.equal(correct.aiJudgement,'correct');
  assert.equal(uncited.status,'needs_review','理由没引用原文时不许下判断');
  assert.equal(uncited.aiJudgement,'needs_review');
  assert.equal(blurry.status,'needs_review','看不清的题交给学生');
  assert.equal(blurry.aiJudgement,'needs_review');
});

test('批改痕迹与得分优先于 AI 自主判断',()=>{
  const result=normalizePaperAnalysis({subject:'数学',questions:[
    {number:'1',question:'有红笔批改的题',type:'written',studentAnswer:'写了过程',markEvidence:'红笔写 −2',
      judgement:'correct',judgementReason:'学生写“写了过程”，看起来对',status:'wrong'},
    {number:'2',question:'逐题得分不满分',type:'written',studentAnswer:'写了过程',score:2,maxScore:5,
      judgement:'correct',judgementReason:'学生写“写了过程”，看起来对'},
    {number:'3',question:'AI 说对但批改说错',type:'written',studentAnswer:'写了过程',markEvidence:'红笔打叉',status:'correct'}]});
  assert.equal(result.questions[0].status,'wrong','有批改证据时以证据为准');
  assert.equal(result.questions[1].status,'wrong','逐题丢分就是做错');
  assert.equal(result.questions[2].status,'correct','学生/AI 说对但无丢分证据时不做错处理');
});

test('一页多题：同一页上的两道题各自成条并保留页码',()=>{
  const result=normalizePaperAnalysis({subject:'数学',questions:[
    {number:'1',question:'一页第一题',paperPage:3,studentAnswer:'A',status:'correct'},
    {number:'2',question:'一页第二题',paperPage:3,studentAnswer:'B',status:'correct'}]});
  assert.equal(result.questions.length,2);
  assert.deepEqual(result.questions.map(item=>item.paperPage),[3,3]);
  assert.deepEqual(result.questions.map(item=>item.number),['1','2']);
});

test('做题记录逐步骤保留，卡点必须引用手写原文',()=>{
  const result=normalizePaperAnalysis({subject:'数学',questions:[{
    number:'18',type:'written',question:'18. 求二面角大小。',studentAnswer:'写到 cosθ=√3/2 就停了',paperPage:2,
    processSteps:[
      {label:'建立坐标系',detail:'以 A 为原点建系',formula:'A(0,0,0)',verdict:'correct'},
      {label:'求法向量',detail:'算出 n=(1,1,1)',formula:'n=(1,1,1)',verdict:'wrong'}],
    stuckAt:{stepIndex:2,label:'法向量算错后没继续',status:'wrong',evidence:'手写“算出 n=(1,1,1)”后停笔'},
    weakPointClaims:[{knowledgePoint:'平面法向量',evidence:'手写“算出 n=(1,1,1)”',stepIndex:2},
      {knowledgePoint:'凭空猜测的知识点',evidence:'我觉得他这里不会',stepIndex:2}],
    errorCause:'计算失误',errorCauseEvidence:'手写“算出 n=(1,1,1)”后结果与标准答案不符',
    explanation:'第 2 步法向量算错，后面没有继续。'}]});
  const item=result.questions[0];
  assert.equal(item.processSteps.length,2);
  assert.equal(item.processSteps[1].formula,'n=(1,1,1)');
  assert.equal(item.stuckAt.stepIndex,2);
  assert.equal(item.stuckAt.status,'wrong');
  assert.deepEqual(item.weakPointClaims.map(claim=>claim.knowledgePoint),['平面法向量'],'没有引用手写原文的薄弱点必须丢弃');
  assert.equal(item.weakPoints[0],'平面法向量','卡点所在知识点排第一');
  assert.equal(item.errorCause,'计算失误');
  assert.ok(item.explanation.includes('法向量'));
});

test('没有手写过程就没有卡点、错因和薄弱点',()=>{
  const result=normalizePaperAnalysis({subject:'物理',questions:[{
    number:'5',type:'written',question:'5. 求加速度。',studentAnswer:'',processSteps:[],
    stuckAt:{stepIndex:1,label:'不会',evidence:'学生看起来卡住了'},
    weakPointClaims:[{knowledgePoint:'牛顿第二定律',evidence:'题目很难，应该不会'}],
    errorCause:'概念不清',errorCauseEvidence:'题目难度较高'}]});
  const item=result.questions[0];
  assert.deepEqual(item.processSteps,[]);
  assert.equal(item.stuckAt,null);
  assert.deepEqual(item.weakPoints,[]);
  assert.deepEqual(item.weakPointClaims,[]);
  assert.equal(item.errorCause,'');
  assert.equal(item.explanation,'');
});

test('做题记录转成薄弱点记录，去重后不重复写入',()=>{
  const plain=confirmPaperItems(
    {id:'draft-plain',source:'paper_batch',subject:'数学',paperImages:[],answerImages:[],
      questions:[{id:'q-plain',number:'1',question:'没有手写过程的题',studentAnswer:'',correctAnswer:'',
        processSteps:[],stuckAt:null,weakPoints:['函数求值'],weakPointClaims:[],errorCause:'',status:'wrong'}]},
    {selectedIds:['q-plain']},'student-a');
  assert.deepEqual(paperWeakPointsFromCases(plain),[],'没有过程记录的题不产生薄弱点');

  const draft={id:'draft-p',source:'paper_batch',subject:'数学',paperImages:[],answerImages:[],
    questions:[{id:'q1',number:'18',type:'written',question:'求二面角',studentAnswer:'写到 cosθ=√3/2 就停了',
      processSteps:[{index:1,label:'建系',detail:'以 A 为原点建系',formula:'A(0,0,0)',verdict:'correct'}],
      stuckAt:{stepIndex:1,label:'法向量算错',status:'wrong',evidence:'手写“以 A 为原点建系”后停笔'},
      weakPoints:['平面法向量'],weakPointClaims:[{knowledgePoint:'平面法向量',evidence:'手写“以 A 为原点建系”',stepIndex:1}],
      errorCause:'计算失误',errorCauseEvidence:'手写“以 A 为原点建系”',explanation:'第 1 步之后没有继续',status:'wrong'}]};
  const cases=confirmPaperItems(draft,{selectedIds:['q1']},'student-a');
  assert.deepEqual(cases[0].errorCauses,['计算失误'],'带原文引用的错因要写进 case，才能进错因分布');
  assert.equal(cases[0].processSteps.length,1);
  assert.equal(cases[0].stuckAt.stepIndex,1);
  const points=paperWeakPointsFromCases(cases);
  assert.equal(points.length,1);
  assert.equal(points[0].evidenceType,'process_review');
  assert.equal(points[0].signal,'步骤出错');
  assert.equal(points[0].knowledgePoint,'平面法向量');
  assert.equal(points[0].evidenceQuote,'手写“以 A 为原点建系”后停笔');
  assert.equal(points[0].caseId,cases[0].id);
  assert.equal(points[0].user_id,'student-a');
  assert.equal(points[0].errorCause,'计算失误');
  assert.deepEqual(dedupeWeakPoints(points,points),[],'同题同知识点不重复写');
  assert.equal(dedupeWeakPoints([],points).length,1);
});

test('upload page exposes paper intake beside single-question intake',async()=>{
  const root=path.resolve(import.meta.dirname,'..','..','implementation');
  const html=await readFile(path.join(root,'index.html'),'utf8');
  const tabs=await readFile(path.join(root,'shared-knowledge.js'),'utf8');
  const page=await readFile(path.join(root,'paper-upload.js'),'utf8');
  assert.match(html,/paper-upload\.js/);
  assert.match(tabs,/data-shared-mode="paper">试卷 \+ 答题卡/);
  assert.match(tabs,/data-shared-mode="batch">批量错题/);
  assert.match(tabs,/试卷上传尚未加载/);
  assert.match(tabs,/__eduPaperEntry/,'两个入口共用一个渲染器，要显式传入口');
  assert.match(page,/data-paper-files/);
  assert.match(page,/data-answer-files/);
  assert.match(page,/data-paper-confirm/);
  assert.match(page,/data-paper-remove/);
  assert.match(page,/data-paper-analyze/);
  assert.match(page,/AI 识别的解题过程/);
  assert.match(page,/data-paper-crop/, '每道题都可以从关联试卷页裁切自己的题图');
  assert.match(page,/从本次上传的第 .*页原图裁切/, '题图入口要明确复用本次上传原图，不让学生误以为需要二次上传');
  assert.match(page,/data-paper-image-file/, '每道题也可以从相册附加题图');
  assert.match(page,/questionImages/, '题图要随逐题确认请求上传');
  const editor=await readFile(path.resolve(import.meta.dirname,'..','..','implementation','mistake-editor.js'),'utf8');
  assert.match(editor,/data-me-paper-source/, '错题详情需要显示已保存题图与识别旁注');
  assert.match(page,/draftId:draft\.id/,'多批识别要追加到同一份草稿');
  assert.match(page,/你来定/,'判不清的题要明确交回学生');
  assert.match(page,/data-paper-select-unknown/);
  assert.match(page,/examPaper && !ui\.answerFiles\.length/,'试卷上传要强制答题卡');
  assert.match(page,/mode:mode\(\)/,'请求要带上入口模式');
});

test('多批上传同一份草稿：一页多题、页号平移、跨批去重',async t=>{
  const temp=await mkdtemp(path.join(path.resolve(import.meta.dirname,'..'),'.test-edu-paper-batch-'));
  const pageOne={subject:'化学',questions:[
    {number:'1',question:'1. 配平方程。',type:'written',paperPage:1,studentAnswer:'写了反应物'},
    {number:'2',question:'2. 求物质的量。',type:'written',paperPage:1,studentAnswer:'n=0.5 mol'}]};
  const pageTwo={subject:'化学',questions:[
    {number:'3',question:'3. 求浓度。',type:'written',paperPage:1,studentAnswer:'c=0.1 mol/L',
      processSteps:[{label:'先算物质的量',detail:'n=0.05 mol',verdict:'correct'}],
      stuckAt:{stepIndex:1,label:'单位换算后没继续',status:'blocked',evidence:'手写“n=0.05 mol”后停笔'},
      weakPointClaims:[{knowledgePoint:'物质的量浓度',evidence:'手写“n=0.05 mol”',stepIndex:1}],
      errorCause:'计算失误',errorCauseEvidence:'手写“n=0.05 mol”后未继续计算浓度'}]};
  let call=0;
  const provider=createServer(async(req,res)=>{for await(const _ of req){}
    call+=1;
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(call===1?pageOne:pageTwo)}}]}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const assignedPort=await port();
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(assignedPort),DATA_FILE:path.join(temp,'data.json'),INTAKE_IMAGE_ROOT:path.join(temp,'uploads'),
      MODEL_CONFIG_FILE:path.join(temp,'no-model.json'),AUTH_REQUIRED:'1',DEEPSEEK_API_KEY:'test',
      DEEPSEEK_ENDPOINT:`http://127.0.0.1:${provider.address().port}/chat/completions`,DEEPSEEK_VISION_MODEL:'deepseek-flash'},
    windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();provider.close();await rm(temp,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${assignedPort}`;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,50))}
  const student=(await(await post(base,'/v1/auth/register',{loginName:'batch-a',displayName:'batch-a',password:'PaperTest!2026'})).json());

  const first=await post(base,'/v1/papers/preview',{paperImages:[image],mode:'batch'},student.sessionToken);
  assert.equal(first.status,201);
  const firstDraft=(await first.json()).draft;
  assert.equal(firstDraft.questions.length,2,'一页两道题要各自成条');
  assert.deepEqual(firstDraft.questions.map(item=>item.paperPage),[1,1]);
  assert.equal(firstDraft.mode,'batch','不拍答题卡时是批量错题模式');

  const second=await post(base,'/v1/papers/preview',{paperImages:[image],draftId:firstDraft.id},student.sessionToken);
  assert.equal(second.status,200);
  const merged=(await second.json()).draft;
  assert.equal(merged.questions.length,3);
  assert.deepEqual(merged.questions.map(item=>item.paperPage),[1,1,2],'第二批的页码要接着第一批平移');
  const stuckQuestion=merged.questions[2];
  assert.equal(stuckQuestion.stuckAt.stepIndex,1);
  assert.deepEqual(stuckQuestion.weakPoints,['物质的量浓度']);
  assert.equal(merged.subject,'化学');

  const confirmed=await post(base,`/v1/papers/drafts/${merged.id}/confirm`,
    {selectedIds:[stuckQuestion.id],corrections:{[stuckQuestion.id]:{studentAnswer:'手写过程已核对'}}},student.sessionToken);
  assert.equal(confirmed.status,201);
  const body=await confirmed.json();
  assert.equal(body.mistakeCases.length,1);
  assert.equal(body.mistakeCases[0].unit,'物质的量浓度');
  assert.equal(body.weakPoints.length,1);
  assert.equal(body.weakPoints[0].signal,'过程卡点');
  const stored=JSON.parse(await readFile(path.join(temp,'data.json'),'utf8'));
  assert.equal(stored.cases.filter(item=>item.origin==='student_confirmed_paper').length,1);
  assert.equal(stored.weakPoints.length,1);
});

test('上传前预检：说清是照片问题、分题问题还是模型问题',()=>{
  // 只拍到题目、没有手写也没有批改 → warn。但这是选择题：核对选项就能定，不该被要求补做题笔记。
  const onlyQuestion=paperPreflight({paperImageCount:1,analysis:{subject:'数学',questions:[
    {number:'4',type:'choice',status:'needs_review',processSteps:[],stuckAt:null,aiJudgement:'needs_review',aiJudgementReason:'图片仅含题目页，未见手写作答或批改痕迹'}]}});
  assert.equal(onlyQuestion.level,'warn');
  assert.equal(onlyQuestion.subject,'数学');
  assert.equal(onlyQuestion.questionCount,1);
  assert.equal(onlyQuestion.needsReviewCount,1);
  assert.equal(onlyQuestion.withProcessCount,0);
  assert.equal(onlyQuestion.writtenCount,0);
  assert.equal(onlyQuestion.needsProcessPhoto,false,'选择题不需要补拍做题笔记');
  assert.match(onlyQuestion.advice.join(' '),/不需要做题笔记/);
  assert.doesNotMatch(onlyQuestion.advice.join(' '),/写了解题过程的那一页/);
  assert.match(onlyQuestion.advice.join(' '),/试卷 \+ 答题卡/);

  // 解答题相反：解答题读不到手写过程时，仍然要请学生补拍那一页
  const writtenQuestion=paperPreflight({paperImageCount:1,analysis:{subject:'数学',questions:[
    {number:'18',type:'written',status:'needs_review',processSteps:[],stuckAt:null,aiJudgement:'needs_review',aiJudgementReason:'未见手写作答'}]}});
  assert.equal(writtenQuestion.writtenCount,1);
  assert.equal(writtenQuestion.needsProcessPhoto,true);
  assert.match(writtenQuestion.advice.join(' '),/写了解题过程的那一页/);

  // 混合批次：建议要分别说清「哪几道要补过程、哪几道只要核对答案」
  const mixed=paperPreflight({paperImageCount:1,analysis:{subject:'数学',questions:[
    {number:'1',type:'choice',status:'needs_review',processSteps:[],stuckAt:null},
    {number:'2',type:'written',status:'needs_review',processSteps:[],stuckAt:null}]}});
  assert.match(mixed.advice.join(' '),/2 道题会标成「你来定」/);
  assert.match(mixed.advice.join(' '),/其中 1 道是解答题/);
  assert.match(mixed.advice.join(' '),/另外 1 道是选择题\/填空题/);

  // 读到做题过程 → good
  const good=paperPreflight({paperImageCount:1,analysis:{subject:'数学',questions:[
    {number:'18',type:'written',status:'wrong',processSteps:[{index:1}],stuckAt:{stepIndex:1},aiJudgement:'wrong',aiJudgementReason:'学生写到 n=0.05 mol 后停笔'}]}});
  assert.equal(good.level,'good');
  assert.equal(good.withProcessCount,1);
  assert.equal(good.needsReviewCount,0);

  // 没读出题目 → bad，并给出可执行建议
  const empty=paperPreflight({paperImageCount:1,error:Object.assign(new Error('PAPER_NO_QUESTIONS_RECOGNIZED'),{code:'PAPER_NO_QUESTIONS_RECOGNIZED'})});
  assert.equal(empty.level,'bad');
  assert.match(empty.advice.join(' '),/靠近题目/);
  assert.equal(empty.error.code,'PAPER_NO_QUESTIONS_RECOGNIZED');

  // 模型/配置出错 → bad，且把原因翻成人话
  const timeout=paperPreflight({paperImageCount:5,error:Object.assign(new Error('PAPER_MODEL_TIMEOUT: 单次超过 300 秒未返回'),{code:'PAPER_MODEL_TIMEOUT'})});
  assert.equal(timeout.level,'bad');
  assert.equal(timeout.error.code,'PAPER_MODEL_TIMEOUT');
  assert.match(timeout.error.hint,/一次少传几页/);
  // 只传 1~2 页时不能再用「少传几页」打发学生：要如实说清是模型这次推理慢
  const singlePageTimeout=paperPreflight({paperImageCount:1,error:Object.assign(new Error('PAPER_MODEL_TIMEOUT: 单次超过 180 秒未返回'),{code:'PAPER_MODEL_TIMEOUT'})});
  assert.equal(singlePageTimeout.error.code,'PAPER_MODEL_TIMEOUT');
  assert.match(singlePageTimeout.error.hint,/不是因为你传得多/);
  assert.doesNotMatch(singlePageTimeout.error.hint,/一次少传几页/);
  const noKey=paperPreflight({paperImageCount:1,error:Object.assign(new Error('PAPER_MODEL_NOT_CONFIGURED'),{code:'PAPER_MODEL_NOT_CONFIGURED'})});
  assert.match(noKey.error.hint,/还没配置视觉模型/);
  const auth=paperPreflight({paperImageCount:1,error:Object.assign(new Error('PAPER_MODEL_HTTP_401: invalid key'),{code:'PAPER_MODEL_HTTP_401'})});
  assert.match(auth.error.hint,/API Key 无效/);
  assert.equal(paperPreflight({paperImageCount:0}).level,'bad');
});

test('归纳信息自动填充：汇总知识点与错因',()=>{
  const fill=paperAutoFill([
    {weakPoints:['二面角','平面法向量'],errorCause:'计算失误'},
    {weakPoints:['二面角'],errorCause:'概念不清'},
    {weakPoints:[],errorCause:''}
  ]);
  assert.deepEqual(fill.knowledgePoints,['二面角','平面法向量']);
  assert.deepEqual(fill.errorCauses,['计算失误','概念不清']);
  assert.deepEqual(paperAutoFill([]).knowledgePoints,[]);
});

test('学生在批量页改过的科目/知识点/错因要写进入库结果',()=>{
  const draft={id:'draft-fill',source:'paper_batch',subject:'数学',paperImages:[],answerImages:[],
    questions:[{id:'q1',number:'1',type:'written',question:'原题干',studentAnswer:'',correctAnswer:'',
      processSteps:[],stuckAt:null,weakPoints:['AI猜的知识点'],weakPointClaims:[],errorCause:'',status:'needs_review'}]};
  const [record]=confirmPaperItems(draft,{selectedIds:['q1'],corrections:{q1:{
    question:'核对后的题干',subject:'物理',errorCause:'审题偏差',knowledgePoints:'匀变速直线运动、受力分析'}}},'student-x');
  assert.equal(record.subject,'物理','学生改的科目要生效');
  assert.deepEqual(record.knowledgePoints,['匀变速直线运动','受力分析']);
  assert.equal(record.unit,'匀变速直线运动','第一个知识点作为归类单元');
  assert.deepEqual(record.errorCauses,['审题偏差']);
  assert.deepEqual(record.studentCorrections.values,{subject:'物理',knowledgePoints:['匀变速直线运动','受力分析'],errorCause:'审题偏差'});

  // 学生没动归纳信息时保持 AI 的预判
  const [untouched]=confirmPaperItems(draft,{selectedIds:['q1'],corrections:{q1:{question:'只改题干'}}},'student-x');
  assert.equal(untouched.subject,'数学');
  assert.deepEqual(untouched.knowledgePoints,['AI猜的知识点']);
  assert.equal(untouched.studentCorrections,undefined,'没改就不留痕');
});

test('paper preview persists, selected questions confirm once, and draft recovers after refresh',async t=>{
  const temp=await mkdtemp(path.join(path.resolve(import.meta.dirname,'..'),'.test-edu-paper-'));
  let activeAnalysis=SCORE_ANALYSIS;
  const provider=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(activeAnalysis)}}]}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const assignedPort=await port();
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(assignedPort),DATA_FILE:path.join(temp,'data.json'),INTAKE_IMAGE_ROOT:path.join(temp,'uploads'),
      MODEL_CONFIG_FILE:path.join(temp,'no-model.json'),AUTH_REQUIRED:'1',DEEPSEEK_API_KEY:'test',
      DEEPSEEK_ENDPOINT:`http://127.0.0.1:${provider.address().port}/chat/completions`,DEEPSEEK_VISION_MODEL:'deepseek-flash'},
    windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();provider.close();await rm(temp,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${assignedPort}`;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,50))}
  const register=async loginName=>(await(await post(base,'/v1/auth/register',{loginName,displayName:loginName,password:'PaperTest!2026'})).json());
  const studentA=await register('paper-a'),studentB=await register('paper-b');
  const response=await post(base,'/v1/papers/preview',{paperImages:[image],answerImages:[image]},studentA.sessionToken);
  assert.equal(response.status,201,await response.clone().text());
  const {draft}=await response.json();
  assert.equal(draft.questions[0].status,'wrong');
  assert.equal(draft.questions[1].status,'needs_review');
  const latest=await(await fetch(base+'/v1/papers/drafts/latest',{headers:{authorization:`Bearer ${studentA.sessionToken}`}})).json();
  assert.equal(latest.draft.id,draft.id);
  const otherLatest=await(await fetch(base+'/v1/papers/drafts/latest',{headers:{authorization:`Bearer ${studentB.sessionToken}`}})).json();
  assert.equal(otherLatest.draft,null);
  const imageRoute=`/v1/papers/images/${draft.paperImages[0].hash}`;
  const ownedImage=await fetch(base+imageRoute,{headers:{authorization:`Bearer ${studentA.sessionToken}`}});
  assert.equal(ownedImage.status,200);
  assert.equal(ownedImage.headers.get('content-type'),'image/png');
  assert.equal((await fetch(base+imageRoute,{headers:{authorization:`Bearer ${studentB.sessionToken}`}})).status,404);
  const selectedIds=[draft.questions[0].id];
  const route=`/v1/papers/drafts/${draft.id}/confirm`;
  assert.equal((await post(base,route,{selectedIds},studentB.sessionToken)).status,404);
  const confirmed=await post(base,route,{selectedIds,corrections:{[selectedIds[0]]:{question:'已核对的第 1 题',studentAnswer:'A',marginNotes:'这里截距不为 0'}},
    questionImages:{[selectedIds[0]]:image}},studentA.sessionToken);
  assert.equal(confirmed.status,201);
  const first=(await confirmed.json()).mistakeCases;
  assert.equal(first.length,1);
  assert.equal(first[0].question,'已核对的第 1 题');
  assert.deepEqual(first[0].marginNotes,['这里截距不为 0']);
  assert.equal(first[0].sourceImage.mimeType,'image/png');
  const cropRoute=`/v1/wrong-questions/images/${first[0].sourceImage.hash}`;
  assert.equal((await fetch(base+cropRoute,{headers:{authorization:`Bearer ${studentA.sessionToken}`}})).status,200,
    '本题裁切图入库后，原账号可以在错题详情读取');
  assert.equal((await fetch(base+cropRoute,{headers:{authorization:`Bearer ${studentB.sessionToken}`}})).status,404,
    '本题裁切图必须按用户隔离');
  const repeated=await(await post(base,route,{selectedIds},studentA.sessionToken)).json();
  assert.equal(repeated.mistakeCases[0].id,first[0].id);
  const otherCases=await(await fetch(base+'/v1/mistake-cases',{headers:{authorization:`Bearer ${studentB.sessionToken}`}})).json();
  assert.equal(otherCases.length,0);
  const stored=JSON.parse(await readFile(path.join(temp,'data.json'),'utf8'));
  assert.equal(stored.cases.filter(item=>item.origin==='student_confirmed_paper').length,1);

  /* 分批录入：第一批 1 页题目 + 答题卡，第二批只传题目页并带上 draftId，
     两次识别汇总到同一份草稿；同一批内容重复上传时按「题号 + 题干」去重，
     页码按整份草稿续排；不配答题卡也能识别。 */
  const firstResponse=await post(base,'/v1/papers/preview',{paperImages:[image],answerImages:[image],mode:'exam_paper'},studentA.sessionToken);
  assert.equal(firstResponse.status,201);
  const firstDraft=(await firstResponse.json()).draft;
  assert.equal(firstDraft.batchCount,1);
  assert.equal(firstDraft.mode,'exam_paper');
  assert.equal(firstDraft.questions[0].paperPage,1);
  assert.equal(firstDraft.questions.length,2);
  const missingAnswer=await post(base,'/v1/papers/preview',{paperImages:[image],mode:'exam_paper'},studentA.sessionToken);
  assert.equal(missingAnswer.status,400,'试卷上传强制要答题卡');
  assert.match((await missingAnswer.json()).error,/答题卡/);
  const secondResponse=await post(base,'/v1/papers/preview',{paperImages:[image],draftId:firstDraft.id},studentA.sessionToken);
  assert.equal(secondResponse.status,200,'第二批沿用第一份草稿');
  const secondBody=await secondResponse.json();
  assert.equal(secondBody.draft.id,firstDraft.id);
  assert.equal(secondBody.batchCount,2);
  assert.equal(secondBody.questionCount,2,'同号同题的重复上传不进草稿');
  assert.equal(secondBody.draft.questions.length,2);
  assert.equal(secondBody.draft.paperImages.length,2,'第二批的照片仍然追加到草稿');
  assert.equal(secondBody.draft.answerImages.length,1);
  assert.equal(secondBody.draft.mode,'exam_paper','追加批次不改已选模式');
  const thirdResponse=await post(base,'/v1/papers/preview',{paperImages:[image],mode:'batch'},studentA.sessionToken);
  assert.equal(thirdResponse.status,201,'不带 draftId 时不追加到旧草稿');
  const otherDraft=(await thirdResponse.json()).draft;
  assert.notEqual(otherDraft.id,firstDraft.id);
  assert.equal(otherDraft.mode,'batch','批量错题：只拍题目页也能识别');
  assert.equal(otherDraft.questions.length,2);
  const foreignAppend=await post(base,'/v1/papers/preview',{paperImages:[image],draftId:otherDraft.id},studentB.sessionToken);
  assert.equal(foreignAppend.status,201,'别人的 draftId 不能被追加');
  assert.notEqual((await foreignAppend.json()).draft.id,otherDraft.id);

  /* 做题记录 → 薄弱点：确认入库时就写入，并且能在 /v1/weak-points 里查到。 */
  activeAnalysis=RECORD_ANALYSIS;
  const intakeDraft=(await(await post(base,'/v1/papers/preview',
    {paperImages:[image],answerImages:[image]},studentA.sessionToken)).json()).draft;
  const recordQuestion=intakeDraft.questions.find(item=>item.processSteps.length);
  assert.ok(recordQuestion,'假模型返回的手写过程要出现在草稿里');
  assert.equal(recordQuestion.stuckAt.stepIndex,1);
  assert.ok(recordQuestion.weakPoints.includes('平面法向量'));
  const recordConfirm=await post(base,`/v1/papers/drafts/${intakeDraft.id}/confirm`,
    {selectedIds:[recordQuestion.id],corrections:{[recordQuestion.id]:{studentAnswer:'以 A 为原点建系'}}},studentA.sessionToken);
  assert.equal(recordConfirm.status,201);
  const recordBody=await recordConfirm.json();
  assert.equal(recordBody.mistakeCases.length,1);
  assert.ok(Array.isArray(recordBody.weakPoints)&&recordBody.weakPoints.length>0,'确认时要生成薄弱点');
  assert.equal(recordBody.weakPoints[0].evidenceType,'process_review');
  assert.equal(recordBody.weakPoints[0].caseId,recordBody.mistakeCases[0].id);
  const weakPoints=await(await fetch(base+'/v1/weak-points',{headers:{authorization:`Bearer ${studentA.sessionToken}`}})).json();
  assert.ok(weakPoints.some(item=>item.caseId===recordBody.mistakeCases[0].id&&item.evidenceType==='process_review'),
    '做题记录反推的薄弱点要能被薄弱点接口查到');
  assert.deepEqual(recordBody.mistakeCases[0].errorCauses,['计算失误']);
  const persistedAfter=JSON.parse(await readFile(path.join(temp,'data.json'),'utf8'));
  assert.ok(persistedAfter.weakPoints.some(item=>item.caseId===recordBody.mistakeCases[0].id),'薄弱点要落盘');
  const otherWeakPoints=await(await fetch(base+'/v1/weak-points',{headers:{authorization:`Bearer ${studentB.sessionToken}`}})).json();
  assert.equal(otherWeakPoints.filter(item=>item.caseId===recordBody.mistakeCases[0].id).length,0,'薄弱点按用户隔离');

  /* 做题记录要真的进学习闭环：接进 AI 陪练上下文，并出现在归纳页的热力图/雷达图里。 */
  const recordCase=recordBody.mistakeCases[0];
  const tutor=await(await post(base,'/v1/tutor/sessions',{caseId:recordCase.id},studentA.sessionToken)).json();
  assert.equal(tutor.context.stuckPoint.evidence,'手写“以 A 为原点建系”后停笔','陪练上下文要带卡点原文');
  assert.equal(tutor.context.stuckPoint.stepIndex,1);
  assert.equal(tutor.context.solutionSteps.length,1);
  assert.equal(tutor.context.solutionSteps[0].formula,'A(0,0,0)');
  assert.equal(tutor.context.confirmedErrorCause,'计算失误');
  const summary=await(await fetch(base+'/v1/study/summary',{headers:{authorization:`Bearer ${studentA.sessionToken}`}})).json();
  const cell=summary.heatmap.find(item=>item.knowledgePoint==='平面法向量');
  assert.ok(cell,'做题记录反推的知识点要出现在热力图');
  assert.equal(cell.subject,'数学');
  assert.ok(cell.caseIds.includes(recordCase.id));
  assert.equal(cell.topCause,'计算失误','错因也要进错因分布');
  assert.ok(summary.radar.byKnowledgePoint.axes.some(axis=>axis.label==='平面法向量'),
    '雷达图要按知识点铺到这个卡点');
  assert.ok(summary.topToday.some(item=>item.knowledgePoint==='平面法向量')||summary.heatmap[0].knowledgePoint==='平面法向量',
    '卡点知识点要能排进优先修复');

  /* 勾了「需要 3D 模型」的立体几何题：入库时就排队生成，不用之后再回错题库一题题点。 */
  activeAnalysis=CUBE_ANALYSIS;
  const cubeDraft=(await(await post(base,'/v1/papers/preview',{paperImages:[image],mode:'batch'},studentA.sessionToken)).json()).draft;
  const cubeItem=cubeDraft.questions[0];
  assert.ok(cubeItem,'要有识别出的题');
  const cubeConfirm=await post(base,`/v1/papers/drafts/${cubeDraft.id}/confirm`,
    {selectedIds:[cubeItem.id],model3dCaseIds:[cubeItem.id],corrections:{[cubeItem.id]:{question:cubeItem.question}}},studentA.sessionToken);
  assert.equal(cubeConfirm.status,201);
  const cubeBody=await cubeConfirm.json();
  const cubeCase=cubeBody.mistakeCases[0];
  assert.deepEqual(cubeBody.geometryQueue.map(item=>item.id),[cubeCase.id],`勾选的题要进建模队列（subject=${cubeCase.subject} buildStatus=${cubeCase.geometryBuildStatus} queue=${JSON.stringify(cubeBody.geometryQueue)}）`);
  assert.equal(cubeCase.geometryModelRequested,true);
  // 后台任务可能在响应发出前就把状态推进到 building，两者都算「已排队」
  assert.ok(['queued','building'].includes(cubeCase.geometryBuildStatus),`期望 queued 或 building，实际 ${cubeCase.geometryBuildStatus}`);
  assert.match(cubeCase.modelMessage,/3D 模型/);
  // 后台真的会建出模型（本地正方体构造，几秒内完成）
  let built=null;
  for(let attempt=0;attempt<40;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1500));
    const list=await(await fetch(base+'/v1/mistake-cases',{headers:{authorization:`Bearer ${studentA.sessionToken}`}})).json();
    const found=list.find(item=>item.id===cubeCase.id);
    if(found&&(found.geometryResult?.scene||found.geometryBuildStatus==='failed')){built=found;break}
  }
  assert.ok(built,'应该能轮询到这道题的建模结果');
  assert.ok(built.geometryResult?.scene,'勾选后要真的生成出 3D 场景');
  assert.notEqual(built.geometryBuildStatus,'queued');
});
