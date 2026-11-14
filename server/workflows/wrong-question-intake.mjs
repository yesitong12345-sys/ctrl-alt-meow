import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const ERROR_CAUSES = Object.freeze(['概念不清', '规则不熟', '审题偏差', '策略选错', '计算失误', '粗心惯性', '知识漏洞']);
export const SUBJECTS = Object.freeze(['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '未分类']);
const IMAGE_DATA = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const WRONG_QUESTION_SCHEMA = {
  type:'object', additionalProperties:false,
  required:['question','handwriting','subject','knowledgePoints','errorCause','errorCauseEvidence','answer','steps'],
  properties:{
    question:{type:'string'}, handwriting:{type:'array',items:{type:'string'}},
    subject:{type:'string',enum:SUBJECTS}, knowledgePoints:{type:'array',items:{type:'string'}},
    errorCause:{type:'string',enum:['',...ERROR_CAUSES]}, errorCauseEvidence:{type:'string'},
    answer:{type:'string'}, steps:{type:'array',items:{type:'string'}}
  }
};

const string = (value, limit = 8000) => String(value ?? '').trim().slice(0, limit);
const unique = (values, limit = 12, itemLimit = 120) => [...new Set((Array.isArray(values) ? values : []).map(value => string(value, itemLimit)).filter(Boolean))].slice(0, limit);
const compactEvidence = value => string(value, 1000).replace(/[\s“”‘’'"「」『』]/g,'').toLowerCase();
function citesHandwriting(evidence, handwriting) {
  const citations = [...String(evidence || '').matchAll(/[“‘'"「『]([^”’'"」』]{3,100})[”’'"」』]/g)].map(match=>compactEvidence(match[1]));
  if (citations.length) return citations.some(quote=>quote.length>=3 && handwriting.some(note=>compactEvidence(note).includes(quote)));
  const normalizedEvidence=compactEvidence(evidence);
  return handwriting.some(note=>compactEvidence(note).length>=3 && normalizedEvidence.includes(compactEvidence(note)));
}

export function validateWrongQuestionPreview(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('VISION_RESPONSE_INVALID');
  for (const field of WRONG_QUESTION_SCHEMA.required) if (!(field in raw)) throw new Error(`VISION_RESPONSE_MISSING_${field}`);
  if (!Array.isArray(raw.handwriting) || !Array.isArray(raw.knowledgePoints) || !Array.isArray(raw.steps)) throw new Error('VISION_RESPONSE_INVALID_ARRAY');
  const subject = SUBJECTS.includes(raw.subject) ? raw.subject : '未分类';
  const handwriting = unique(raw.handwriting, 30, 1000);
  const evidence = string(raw.errorCauseEvidence, 360);
  // 错因只能从学生真实写下的过程判断；空白答题区不做“画像式”猜测。
  const cause = handwriting.length && citesHandwriting(evidence,handwriting) && ERROR_CAUSES.includes(raw.errorCause) ? raw.errorCause : '';
  return {
    question:string(raw.question), handwriting, subject,
    knowledgePoints:unique(raw.knowledgePoints), errorCause:cause, errorCauseEvidence:cause ? evidence : '',
    answer:string(raw.answer, 2000), steps:unique(raw.steps, 20)
  };
}

export function parseImageData(value) {
  const match = IMAGE_DATA.exec(String(value || ''));
  if (!match) throw Object.assign(new Error('请上传 JPG、PNG 或 WebP 图片'), {statusCode:400});
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('图片压缩后仍超过 8 MB，请重新拍摄或裁剪'), {statusCode:413});
  const kind = match[1].toLowerCase();
  const valid = kind === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : kind === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid) throw Object.assign(new Error('图片内容与格式不符，请重新选择'), {statusCode:400});
  return {mimeType:`image/${kind}`, bytes, hash:createHash('sha256').update(bytes).digest('hex')};
}

const PROMPT = `请识别图片中的全部文字内容，包括印刷体和手写笔记。
手写部分单独标注，格式为[手写]xxx[/手写]。
同时输出：科目预判、知识点标签、错因预判（7类）、题目结构化解析（题干、答案、解题步骤）。
错因只可在图片中有学生作答、批注或明显错误证据时预判；只有题目没有学生作答时，errorCause 和 errorCauseEvidence 都输出空字符串。题目答案及步骤不可从看不清的区域猜测；不确定就留空。保持题目原有数学符号、上下标和单位。handwriting 数组只放手写原文，不把手写内容混入印刷题干。七类错因：概念不清、规则不熟、审题偏差、策略选错、计算失误、粗心惯性、知识漏洞。只输出符合 Schema 的 JSON。`;
const DEEPSEEK_PROMPT = `${PROMPT}
请严格使用以下八个英文键名，不要改成 recognized_text、knowledge_points 或 structured_analysis：
{"question":"完整题干和选项","handwriting":["逐条手写原文"],"subject":"数学","knowledgePoints":["知识点"],"errorCause":"","errorCauseEvidence":"","answer":"","steps":[]}
subject 只能是语文、数学、英语、物理、化学、生物、政治、历史、地理、未分类。没有手写作答时 handwriting 必须为 []，错因和依据必须为空。若提出错因，errorCauseEvidence 必须用引号引用 handwriting 中实际出现的原文，再说明由此推断的卡点；不能根据题干难度猜错因。`;

function normalizeDeepSeekPreview(raw) {
  const source = raw?.result && typeof raw.result==='object' ? raw.result : raw;
  if (!source || typeof source!=='object' || Array.isArray(source)) throw new Error('VISION_RESPONSE_INVALID');
  const analysis = source.structured_analysis && typeof source.structured_analysis==='object' ? source.structured_analysis : {};
  const subjectText = string(source.subject || source.subject_guess || source.predicted_subject, 40);
  const subject = SUBJECTS.find(item=>item!=='未分类' && subjectText.includes(item)) || '未分类';
  const rawHandwriting = source.handwriting ?? source.handwritten_notes ?? source.handwrittenNotes ?? [];
  const handwriting = Array.isArray(rawHandwriting) ? rawHandwriting.map(item=>typeof item==='string'?item:item?.text)
    : [...String(rawHandwriting).matchAll(/\[手写\]([\s\S]*?)\[\/手写\]/g)].map(match=>match[1]);
  const question = source.question ?? source.recognized_text ?? source.question_text ?? analysis.question ?? '';
  if (!string(question)) throw new Error('VISION_RESPONSE_MISSING_question');
  return validateWrongQuestionPreview({question,handwriting,subject,
    knowledgePoints:source.knowledgePoints ?? source.knowledge_points ?? source.knowledge_tags ?? [],
    errorCause:source.errorCause ?? source.error_cause ?? '',
    errorCauseEvidence:source.errorCauseEvidence ?? source.error_cause_evidence ?? '',
    answer:source.answer ?? analysis.answer ?? '', steps:source.steps ?? analysis.steps ?? []});
}

async function callArkSdk(payload, config) {
  const script = fileURLToPath(new URL('../python/doubao_intake_sdk.py', import.meta.url));
  return new Promise((resolve,reject)=>{
    const child=spawn(config.pythonBin || 'python',[script],{windowsHide:true,
      env:{...process.env,DOUBAO_API_KEY:config.apiKey},stdio:['pipe','pipe','pipe']});
    let output='',errorOutput='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill()},config.timeoutMs || 45000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk});
    child.stderr.on('data',chunk=>{errorOutput+=chunk.slice(0,1000)});
    child.stdin.on('error',()=>{});
    child.once('error',error=>{clearTimeout(timer);reject(error)});
    child.once('close',code=>{clearTimeout(timer);
      if(timedOut)return reject(new Error('DOUBAO_SDK_TIMEOUT'));
      if(code===75)return reject(Object.assign(new Error('DOUBAO_SDK_UNAVAILABLE'),{code:'DOUBAO_SDK_UNAVAILABLE'}));
      if(code!==0)return reject(new Error(errorOutput || `DOUBAO_SDK_EXIT_${code}`));
      try{resolve(JSON.parse(output))}catch{reject(new Error('DOUBAO_SDK_INVALID_RESPONSE'))}
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export function createDeepSeekIntakeAdapter(config = {}) {
  return async ({imageData, questionText = ''}) => {
    if (!config.endpoint || !config.apiKey || !(imageData ? config.visionModel : config.model))
      throw Object.assign(new Error('DEEPSEEK_INTAKE_NOT_CONFIGURED'), {code:'DEEPSEEK_INTAKE_NOT_CONFIGURED'});
    const content = imageData
      ? [{type:'text',text:DEEPSEEK_PROMPT}, {type:'image_url',image_url:{url:imageData,detail:'high'}}]
      : `${DEEPSEEK_PROMPT}\n以下是学生输入的题目文字，请只按文字中的证据抽取：\n${string(questionText,16000)}`;
    const requestBody = {model:imageData ? config.visionModel : config.model,
      messages:[{role:'user',content}],temperature:0,response_format:{type:'json_object'}};
    let lastError;
    for (let attempt=0; attempt<3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(()=>controller.abort(), config.timeoutMs || 45000);
      try {
        const response = await (config.fetchImpl || fetch)(config.endpoint, {
          method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},
          signal:controller.signal,body:JSON.stringify(requestBody)
        });
        if (!response.ok) {
          const error = Object.assign(new Error(`DEEPSEEK_INTAKE_HTTP_${response.status}`), {code:`DEEPSEEK_INTAKE_HTTP_${response.status}`});
          if (response.status < 500 && response.status !== 429) throw error;
          lastError=error;
        } else {
          const body=await response.json();
          const answer=body?.choices?.[0]?.message?.content;
          const parsed=typeof answer==='string' ? JSON.parse(answer.replace(/^```json\s*|\s*```$/g,'')) : answer;
          return normalizeDeepSeekPreview(parsed);
        }
      } catch(error) {
        if (error?.name==='AbortError') lastError=Object.assign(new Error('DEEPSEEK_INTAKE_TIMEOUT'),{code:'DEEPSEEK_INTAKE_TIMEOUT'});
        else if (/JSON|VISION_RESPONSE|Unexpected token/i.test(String(error?.message||'')))
          lastError=Object.assign(new Error('DEEPSEEK_INTAKE_INVALID_RESPONSE'),{code:'DEEPSEEK_INTAKE_INVALID_RESPONSE'});
        else lastError=error;
        if (/DEEPSEEK_INTAKE_HTTP_(401|402|403)/.test(lastError.code||'')) throw lastError;
      } finally {clearTimeout(timer)}
      if (attempt<2) await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
    throw lastError || new Error('DEEPSEEK_INTAKE_FAILED');
  };
}

export function createDoubaoIntakeAdapter(config = {}) {
  const endpoint = config.endpoint || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  return async ({imageData, questionText = ''}) => {
    if (!config.apiKey || !(imageData ? config.visionModel : config.textModel)) throw new Error('DOUBAO_NOT_CONFIGURED');
    const content = imageData
      ? [{type:'text',text:PROMPT}, {type:'image_url',image_url:{url:imageData,detail:'high'}}]
      : `${PROMPT}\n以下是学生输入的题目文字，请只按文字中的证据抽取：\n${string(questionText, 16000)}`;
    const payload={model:imageData ? config.visionModel : config.textModel,
      messages:[{role:'user',content}],temperature:0,
      response_format:{type:'json_schema',json_schema:{name:'wrong_question_preview',strict:true,schema:WRONG_QUESTION_SCHEMA}}};
    let body=null;
    if (!config.fetchImpl && config.useSdk !== false) {
      try {body=await callArkSdk(payload,config)}
      catch(error){if(error.code!=='DOUBAO_SDK_UNAVAILABLE' && error.code!=='ENOENT')throw error}
    }
    if(!body){
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs || 45000);
      let response;
      try {
        response = await (config.fetchImpl || fetch)(endpoint, {
          method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},
          signal:controller.signal,body:JSON.stringify(payload)
        });
      } finally {clearTimeout(timer)}
      if(!response.ok)throw Object.assign(new Error(`DOUBAO_HTTP_${response.status}`),{statusCode:502});
      body=await response.json();
    }
    const answer = body?.choices?.[0]?.message?.content;
    const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
    return validateWrongQuestionPreview(parsed);
  };
}

export function createIntakeDraft({studentId, source, fileName, imageHash, imageMimeType, supplementaryImageHash, supplementaryImageMimeType, supplementaryImageName, preview, recognitionStatus = 'suggested', recognitionProvider = '', rawQuestion = ''}) {
  return {id:randomUUID(), studentId:studentId || 'local-student', user_id:studentId || 'local-student', source,
    fileName:string(fileName, 180), imageHash:imageHash || null, imageMimeType:imageMimeType || null,
    supplementaryImageHash:supplementaryImageHash || null,supplementaryImageMimeType:supplementaryImageMimeType || null,supplementaryImageName:string(supplementaryImageName,180),
    rawQuestion:string(rawQuestion, 16000), recognitionProvider:string(recognitionProvider,40),
    preview:validateWrongQuestionPreview(preview), recognitionStatus, status:'awaiting_confirmation', createdAt:new Date().toISOString()};
}

export function confirmWrongQuestion(draft, corrections = {}) {
  if (!draft || draft.status !== 'awaiting_confirmation') throw Object.assign(new Error('INTAKE_DRAFT_NOT_AVAILABLE'), {statusCode:404});
  const original = draft.preview;
  const subject = SUBJECTS.includes(corrections.subject) ? corrections.subject : original.subject;
  const points = unique(corrections.knowledgePoints ?? original.knowledgePoints);
  const question = string(corrections.question ?? original.question);
  if (!question) throw Object.assign(new Error('请先核对并填写题目文字'), {statusCode:400});
  const handwriting = unique(corrections.handwriting ?? original.handwriting, 30, 1000);
  const requestedCause = ERROR_CAUSES.includes(corrections.errorCause) ? corrections.errorCause : '';
  const cause = handwriting.length ? requestedCause : '';
  const errorCauseEvidence = cause ? string(corrections.errorCauseEvidence || original.errorCauseEvidence,360) : '';
  if (cause && !citesHandwriting(errorCauseEvidence,handwriting))
    throw Object.assign(new Error('请在错因依据中引用手写笔记里的原文，或将错因设为待确认'), {statusCode:400});
  const changed = ['question','subject','errorCause','errorCauseEvidence','knowledgePoints','handwriting'].filter(key => JSON.stringify(({question,subject,errorCause:cause,errorCauseEvidence,knowledgePoints:points,handwriting})[key]) !== JSON.stringify(original[key]));
  /* 上传时识别出的解析（参考结论 + 解题步骤）要跟着原题一起进错题库：
     否则入库后只剩题干，学生想看解析还得再开一次陪练。
     来源必须写明，并且标明「未经核对」——不能让 AI 的推导冒充学生自己的结论，
     也不可能据此覆盖 correctAnswer（那会变成一份没人核对过的标准答案）。 */
  const aiAnswer = string(original.answer, 1200);
  const aiSteps = Array.isArray(original.steps) ? original.steps.map(step => string(step, 600)).filter(Boolean).slice(0, 12) : [];
  const aiAnalysis = [
    aiAnswer ? `参考结论：${aiAnswer}` : '',
    aiSteps.length ? `解题步骤：\n${aiSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}` : ''
  ].filter(Boolean).join('\n');
  return {
    id:randomUUID(), studentId:draft.studentId, user_id:draft.user_id || draft.studentId, subject, unit:points[0] || subject,
    question, handwrittenNotes:handwriting, studentAnswer:'待开始真实作答',
    correctAnswer:'', analysis: aiAnalysis ? `AI 解析（上传时识别，未经学生核对，可能有错）：\n${aiAnalysis}` : '待 AI 陪练过程中核对学生实际解题证据。',
    aiSuggestedAnswer:original.answer, aiSuggestedSteps:original.steps,
    knowledgePoints:points,
    microSkills:[], errorCauses:cause ? [cause] : [], errorCauseEvidence,
    source:draft.source, sourceImage:draft.imageHash ? {hash:draft.imageHash,fileName:draft.fileName,mimeType:draft.imageMimeType} : null,
    supplementaryImage:draft.supplementaryImageHash ? {hash:draft.supplementaryImageHash,fileName:draft.supplementaryImageName||'题目附件图',mimeType:draft.supplementaryImageMimeType||'image/jpeg'} : null,
    origin:'student_confirmed_intake', verificationStatus:'student_confirmed',
    aiSuggestion:{...original}, studentCorrections:{changedFields:changed, values:{question,subject,errorCause:cause,errorCauseEvidence,knowledgePoints:points,handwriting}},
    createdAt:new Date().toISOString(), confirmedAt:new Date().toISOString()
  };
}

export function weakPointFromTutorTurn(session, turn) {
  if (!turn?.studentMessage || !session?.caseId) return null;
  const quote = string(turn.studentMessage, 360);
  const misunderstanding = turn.correctness === 'incorrect';
  const partial = turn.correctness === 'partial';
  if (!misunderstanding && !partial) return null;
  const signal = misunderstanding ? '回答错误' : '回答不完整';
  const owner=session.user_id || session.studentId || 'local-student';
  return {id:randomUUID(), studentId:owner, user_id:owner, caseId:session.caseId,
    sessionId:session.id, turnId:turn.id, subject:session.context?.subject || '未分类',
    knowledgePoint:session.context?.knowledgePoints?.[0] || '', microSkill:session.learningState?.currentGoal || '',
    signal,evidenceType:'answer_evaluation',evidenceQuote:quote,
    feedback:string(turn.explanation, 540),createdAt:new Date().toISOString()};
}

const explicitHintRequest = value => {
  const message=string(value, 360);
  return !/不(?:要|需要|用).*提示|无需提示/.test(message)
    && /(?:请|能否|可以|给我|想看|需要|来个|要).{0,12}(?:提示|线索)|(?:提示|线索).{0,6}(?:一下|一步|一点)|告诉我关键条件/.test(message);
};

export function recordTutorSignals(session, input, turn) {
  if (!session || !turn?.id || !turn.studentMessage) return session?.observedSignals || null;
  const owner=session.user_id || session.studentId || 'local-student';
  const signals=session.observedSignals ||= {user_id:owner,caseId:session.caseId,
    wrongAnswers:[],hintRequests:[],hintRequestCount:0,aiMisconceptions:[],
    independentlyCompleted:false,finalOutcome:'in_progress'};
  signals.user_id=owner;
  if(turn.correctness==='incorrect' && !signals.wrongAnswers.some(item=>item.turnId===turn.id))
    signals.wrongAnswers.push({turnId:turn.id,studentAnswer:string(turn.studentMessage,360)});
  if(explicitHintRequest(input?.studentMessage || turn.studentMessage)
      && !signals.hintRequests.some(item=>item.turnId===turn.id))
    signals.hintRequests.push({turnId:turn.id,studentRequest:string(turn.studentMessage,360)});
  signals.hintRequestCount=signals.hintRequests.length;
  if(turn.correctness==='incorrect' && string(turn.explanation)
      && !signals.aiMisconceptions.some(item=>item.turnId===turn.id))
    signals.aiMisconceptions.push({turnId:turn.id,studentAnswer:string(turn.studentMessage,360),
      aiFeedback:string(turn.explanation,540)});
  const finished=Number(session.learningState?.scoreProgress?.percent)===100 && turn.correctness==='correct';
  if(finished){
    signals.independentlyCompleted=signals.hintRequestCount===0 && signals.wrongAnswers.length===0;
    signals.finalOutcome=signals.independentlyCompleted?'independent'
      :signals.hintRequestCount>0?'completed_with_hints':'completed_after_correction';
    signals.completedTurnId=turn.id;
  }
  return signals;
}
