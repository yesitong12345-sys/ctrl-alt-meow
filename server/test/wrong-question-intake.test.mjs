import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  createDeepSeekIntakeAdapter, createDoubaoIntakeAdapter, createIntakeDraft, confirmWrongQuestion, parseImageData,
  weakPointFromTutorTurn, recordTutorSignals
} from '../workflows/wrong-question-intake.mjs';
import {buildTutorMessages, createTutorSession} from '../workflows/tutor-session.mjs';

const modelAnswer = {question:'已知函数 f(x)=x²，求 f(2)。',handwriting:['我算成 3'],subject:'数学',
  knowledgePoints:['函数求值'],errorCause:'计算失误',errorCauseEvidence:'手写“我算成 3”',answer:'4',steps:['代入 x=2','计算 2²=4']};
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const port = () => new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value))})});
const post = (base,route,body)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('豆包图像请求包含手写隔离指令和严格结构，确认时保存学生修正', async()=>{
  let body;
  const adapter=createDoubaoIntakeAdapter({apiKey:'test-key',visionModel:'test-vision',fetchImpl:async(_url,options)=>{
    body=JSON.parse(options.body);
    return json({choices:[{message:{content:JSON.stringify(modelAnswer)}}]});
  }});
  const recognized=await adapter({imageData:'data:image/png;base64,aGVsbG8='});
  assert.match(body.messages[0].content[0].text,/手写部分单独标注/);
  assert.equal(body.messages[0].content[1].type,'image_url');
  assert.equal(body.response_format.type,'json_schema');
  assert.equal(recognized.handwriting[0],'我算成 3');
  const draft=createIntakeDraft({studentId:'student-7',source:'image',imageHash:'hash',preview:recognized});
  const record=confirmWrongQuestion(draft,{question:'已知函数 f(x)=x²，求 f(3)。',subject:'数学',errorCause:'规则不熟',errorCauseEvidence:'手写“我算成 3”，未按平方规则计算',knowledgePoints:['代入求值']});
  assert.equal(record.question,'已知函数 f(x)=x²，求 f(3)。');
  assert.deepEqual(record.errorCauses,['规则不熟']);
  assert.deepEqual(record.studentCorrections.changedFields.sort(),['errorCause','errorCauseEvidence','knowledgePoints','question']);
  assert.equal(record.aiSuggestion.question,modelAnswer.question);
  assert.equal(record.handwrittenNotes[0],'我算成 3');
  assert.equal(draft.user_id,'student-7');
  assert.equal(record.user_id,'student-7');
});

test('DeepSeek 图片识别兼容常见字段名，空白作答不产生错因',async()=>{
  let payload;
  const adapter=createDeepSeekIntakeAdapter({apiKey:'test-key',endpoint:'https://example.test/chat/completions',visionModel:'deepseek-flash',fetchImpl:async(_url,options)=>{
    payload=JSON.parse(options.body);
    return json({choices:[{message:{content:JSON.stringify({recognized_text:'求二面角大小。',handwriting:[],subject:'高中数学',knowledge_points:['二面角'],errorCause:'审题偏差',errorCauseEvidence:'模型猜测',structured_analysis:{answer:'60°',steps:['建立垂面']}})}}]});
  }});
  const preview=await adapter({imageData:'data:image/jpeg;base64,AA=='});
  assert.equal(payload.messages[0].content[1].type,'image_url');
  assert.match(payload.messages[0].content[0].text,/"knowledgePoints"/);
  assert.equal(preview.question,'求二面角大小。');
  assert.equal(preview.subject,'数学');
  assert.deepEqual(preview.knowledgePoints,['二面角']);
  assert.equal(preview.errorCause,'');
  assert.equal(preview.errorCauseEvidence,'');
});

test('DeepSeek text intake accepts a school question without Doubao',async()=>{
  let payload;
  const adapter=createDeepSeekIntakeAdapter({apiKey:'test-key',endpoint:'https://example.test/chat/completions',model:'deepseek-flash',fetchImpl:async(_url,options)=>{
    payload=JSON.parse(options.body);
    return json({choices:[{message:{content:JSON.stringify({question:'求 f(2) 的值',handwriting:[],subject:'数学',knowledgePoints:['函数求值'],errorCause:''})}}]});
  }});
  const preview=await adapter({questionText:'求 f(2) 的值'});
  assert.equal(payload.model,'deepseek-flash');
  assert.equal(preview.question,'求 f(2) 的值');
  assert.equal(preview.errorCause,'');
});

test('手写错因必须引用手写原文，确认后交给陪练',()=>{
  const draft=createIntakeDraft({source:'image',preview:modelAnswer});
  assert.throws(()=>confirmWrongQuestion(draft,{errorCause:'规则不熟',errorCauseEvidence:'模型自行推断'}),/引用手写笔记/);
  const record=confirmWrongQuestion(draft,{errorCause:'规则不熟',errorCauseEvidence:'手写“我算成 3”，平方规则尚不熟练'});
  const session=createTutorSession({caseId:record.id,context:{question:record.question,
    handwrittenNotes:record.handwrittenNotes,confirmedErrorCause:record.errorCauses[0],
    confirmedErrorCauseEvidence:record.errorCauseEvidence}});
  const messages=buildTutorMessages(session,'我想重新试试。',{correctness:'partial',nextQuestion:'先代入多少？'});
  assert.match(messages[1].content,/我算成 3/);
  assert.match(messages[1].content,/规则不熟/);
  const blank=createIntakeDraft({source:'image',preview:{...modelAnswer,handwriting:[]}});
  assert.deepEqual(confirmWrongQuestion(blank,{errorCause:'计算失误'}).errorCauses,[]);
});

test('无学生作答证据时不强制生成错因；薄弱点引用真实学生回答',()=>{
  const draft=createIntakeDraft({source:'text',preview:{...modelAnswer,errorCause:'知识漏洞',errorCauseEvidence:''}});
  assert.equal(draft.preview.errorCause,'');
  const weak=weakPointFromTutorTurn({id:'s1',caseId:'q1',context:{subject:'数学',knowledgePoints:['函数']},learningState:{currentGoal:'求值'}},
    {id:'t1',studentMessage:'我不知道这里为什么要代入。',correctness:'partial',explanation:'先确认自变量的值。'},{});
  assert.equal(weak.evidenceQuote,'我不知道这里为什么要代入。');
  assert.equal(weak.signal,'回答不完整');
  assert.equal(weakPointFromTutorTurn({id:'s1',caseId:'q1'},{studentMessage:'代入 2 得 4',correctness:'correct'},{}),null);
  assert.equal(weakPointFromTutorTurn({id:'s1',caseId:'q1'},{studentMessage:'代入 2 得 4',correctness:'correct'},
    {responseDelayMs:120000,revisionCount:5}),null,'停顿和修改不再单独构成薄弱点');
  assert.throws(()=>parseImageData('data:text/plain;base64,YQ=='));
});

test('陪练只记答错、明确求提示、AI 反馈和真实独立完成',()=>{
  const session={studentId:'student-7',caseId:'q1',turns:[],learningState:{scoreProgress:{percent:0}}};
  const wrong={id:'t1',studentMessage:'这里应该用余弦',correctness:'incorrect',explanation:'这里两个角互余，应先判断所求角。'};
  session.turns.push(wrong);
  recordTutorSignals(session,{studentMessage:wrong.studentMessage},wrong);
  assert.equal(session.observedSignals.wrongAnswers.length,1);
  assert.equal(session.observedSignals.hintRequestCount,0);
  assert.equal(session.observedSignals.aiMisconceptions[0].turnId,'t1');
  const hint={id:'t2',studentMessage:'请给我一步提示',correctness:'partial',explanation:'先找投影。'};
  session.turns.push(hint);
  recordTutorSignals(session,{studentMessage:hint.studentMessage},hint);
  assert.equal(session.observedSignals.hintRequestCount,1);
  session.learningState.scoreProgress.percent=100;
  const final={id:'t3',studentMessage:'结果是正确的',correctness:'correct',explanation:'这一步做对了。'};
  session.turns.push(final);
  recordTutorSignals(session,{studentMessage:final.studentMessage},final);
  assert.equal(session.observedSignals.finalOutcome,'completed_with_hints');
  const independent={studentId:'student-8',caseId:'q2',turns:[],learningState:{scoreProgress:{percent:100}}};
  recordTutorSignals(independent,{studentMessage:'答案与过程如下'},{id:'t4',studentMessage:'答案与过程如下',correctness:'correct'});
  assert.equal(independent.observedSignals.finalOutcome,'independent');
});

test('无豆包密钥时保留手动核对草稿；确认写入现有错题库且重试幂等',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'edu-wq-'));
  const assignedPort=await port();
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(assignedPort),DATA_FILE:path.join(temp,'data.json'),INTAKE_IMAGE_ROOT:path.join(temp,'uploads'),
      DOUBAO_API_KEY:'',DOUBAO_VISION_MODEL:'',DOUBAO_TEXT_MODEL:'',DEEPSEEK_API_KEY:'',MODEL_CONFIG_FILE:path.join(temp,'no-model-config.json'),AUTH_REQUIRED:'0'},
    windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();await rm(temp,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${assignedPort}`;
  for(let n=0;n<100;n++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,50))}
  const previewResponse=await post(base,'/v1/wrong-questions/preview',{source:'text',questionText:'求 f(2) 的值'});
  assert.equal(previewResponse.status,201);
  const preview=await previewResponse.json();
  assert.equal(preview.draft.recognitionStatus,'needs_manual');
  assert.equal(preview.draft.preview.question,'求 f(2) 的值');
  const confirmUrl=`/v1/wrong-questions/drafts/${preview.draft.id}/confirm`;
  const confirmed=await post(base,confirmUrl,{question:'求 f(2) 的值',subject:'数学',knowledgePoints:['函数求值'],errorCause:''});
  assert.equal(confirmed.status,201);
  const record=(await confirmed.json()).mistakeCase;
  assert.equal(record.origin,'student_confirmed_intake');
  assert.equal(record.user_id,'local-student');
  const repeated=await post(base,confirmUrl,{question:'其他题'});
  assert.equal((await repeated.json()).mistakeCase.id,record.id);
  const cases=await(await fetch(base+'/v1/mistake-cases')).json();
  assert.equal(cases.filter(item=>item.id===record.id).length,1);
  const persisted=JSON.parse(await readFile(path.join(temp,'data.json'),'utf8'));
  assert.equal(persisted.cases.find(item=>item.id===record.id).studentCorrections.values.subject,'数学');
  const imageData='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z9sAAAAASUVORK5CYII=';
  const photo=await(await post(base,'/v1/wrong-questions/preview',{source:'image',imageData,fileName:'test.png'})).json();
  assert.equal(photo.draft.recognitionStatus,'needs_manual');
  const savedImage=await fetch(base+'/v1/wrong-questions/images/'+photo.draft.imageHash);
  assert.equal(savedImage.status,200);
  assert.equal(savedImage.headers.get('content-type'),'image/png');
  const photoConfirmed=await post(base,`/v1/wrong-questions/drafts/${photo.draft.id}/confirm`,{
    question:'已知函数 f(x)=x²，求 f(2)。',subject:'数学',handwriting:['我算成 3'],
    errorCause:'计算失误',errorCauseEvidence:'手写“我算成 3”',knowledgePoints:['函数求值'],retainSourceImage:true});
  assert.equal(photoConfirmed.status,201);
  const photoCase=(await photoConfirmed.json()).mistakeCase;
  const photoTutor=await(await post(base,'/v1/tutor/sessions',{caseId:photoCase.id})).json();
  assert.deepEqual(photoTutor.context.handwrittenNotes,['我算成 3']);
  assert.equal(photoTutor.context.confirmedErrorCause,'计算失误');
  assert.equal(photoTutor.context.confirmedErrorCauseEvidence,'手写“我算成 3”');
  assert.equal(photoCase.sourceImage.hash,photo.draft.imageHash,'勾选后错题记录保留原题图引用');
  const distinctImageData='data:image/png;base64,'+Buffer.concat([Buffer.from(imageData.split(',')[1],'base64'),Buffer.from([0])]).toString('base64');
  const discardPhoto=await(await post(base,'/v1/wrong-questions/preview',{source:'image',imageData:distinctImageData,fileName:'discard.png'})).json();
  const discardHash=discardPhoto.draft.imageHash;
  const discarded=await post(base,`/v1/wrong-questions/drafts/${discardPhoto.draft.id}/confirm`,{
    question:'另一道题',subject:'数学',knowledgePoints:['函数求值'],retainSourceImage:false});
  assert.equal(discarded.status,201);
  assert.equal((await discarded.json()).mistakeCase.sourceImage,null,'未勾选时错题记录不保留原题图');
  assert.equal((await fetch(base+'/v1/wrong-questions/images/'+discardHash)).status,404,'没有其他记录引用时原图随未保留选项清理');
  const tutor=await(await post(base,'/v1/tutor/sessions',{caseId:record.id})).json();
  const streamed=await post(base,`/v1/tutor/sessions/${tutor.id}/events/stream`,{studentMessage:'我不知道为什么代入。',interactionEvidence:{responseDelayMs:95000,revisionCount:3}});
  assert.match(streamed.headers.get('content-type'),/text\/event-stream/);
  const events=await streamed.text();
  assert.match(events,/event: status/);
  assert.match(events,/event: session/);
  const weakPoints=await(await fetch(base+'/v1/weak-points')).json();
  assert.ok(weakPoints.some(item=>item.caseId===record.id&&item.evidenceQuote==='我不知道为什么代入。'));
});
