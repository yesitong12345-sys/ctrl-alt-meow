import {randomUUID} from 'node:crypto';
import {ERROR_CAUSES} from './wrong-question-intake.mjs';

const text = (value, limit = 8000) => String(value ?? '').trim().slice(0, limit);
/* 知识点/错因这类多值字段：模型给数组，学生在核对页里手输的是「、」分隔的字符串，
   两种都要能收，否则学生改过的值会被静默丢成空数组。 */
const list = (value, limit = 8) => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[,，、;；\s]+/);
  return [...new Set(raw.map(item => text(item, 120)).filter(Boolean))].slice(0, limit);
};
const marginNoteList = value => {
  const raw=Array.isArray(value)?value:String(value??'').split(/\r?\n/);
  return [...new Set(raw.map(item=>text(item,500)).filter(Boolean))].slice(0,20);
};
function quotedMarginNotesFromReason(value) {
  const reason=String(value||'');
  const marker=/(?:旁注|批注|题干旁|题目旁)(?:写(?:着|有)?|标注|标出|是|为)?\s*/g;
  const match=marker.exec(reason);
  if(!match)return [];
  let tail=reason.slice(marker.lastIndex).trimStart();
  const notes=[];
  for(let count=0;count<20;count++){
    const quote=/^([“‘「『"'])(.*?)([”’」』"'])/s.exec(tail);
    if(!quote)break;
    const note=quote[2].trim();if(note)notes.push(note);
    tail=tail.slice(quote[0].length).trimStart();
  }
  return notes;
}
const subjects = new Set(['语文','数学','英语','物理','化学','生物','政治','历史','地理','未分类']);
const errorCauses = new Set(ERROR_CAUSES);

/* 一页一题也走这里：一页多题只是「questions 数量变多」，不做两套解析。
   单次最多 12 页/类；超过 8 MB 由前端分批，分批的每一批都在服务端追加到同一份草稿。 */
export const PAPER_MAX_PAGES_PER_BATCH = 12;
export const PAPER_MAX_QUESTIONS = 120;

/* 做题记录（手写解题过程）不是「又一个字段」，而是薄弱点唯一允许的证据来源。
   模型必须逐条抄下学生手写原文；抄不出原文的步骤一律丢弃。 */
const STEP_LABEL_LIMIT = 160;
const STEP_DETAIL_LIMIT = 400;
const STEP_LIMIT = 24;
const WEAK_POINT_LIMIT = 6;
const MAX_HANDWRITING_CHARS = 4000;

const compactEvidence = value => text(value, 1000).replace(/[\s“”‘’'"「」『』]/g, '').toLowerCase();

/** 做题记录必须引用学生手写原文。引用用引号括起来，或整段包含某一步原文。 */
export function citesHandwriting(evidence, handwriting) {
  const notes = (Array.isArray(handwriting) ? handwriting : [handwriting]).map(compactEvidence).filter(item => item.length >= 3);
  if (!notes.length) return false;
  const raw = text(evidence, 1000);
  const citations = [...raw.matchAll(/[“‘'"「『]([^”’'"」』]{3,100})[”’'"」』]/g)].map(match => compactEvidence(match[1])).filter(Boolean);
  if (citations.length) return citations.some(quote => notes.some(note => note.includes(quote)));
  const normalized = compactEvidence(raw);
  if (normalized.length < 3) return false;
  return notes.some(note => normalized.includes(note));
}

/** 学生实际写下来的东西：作答区原文 + 解题过程的每一步。空白答题区不产生任何证据。 */
export function handwritingEvidenceOf(item = {}) {
  const notes = [text(item.studentAnswer, 3000),
    ...(Array.isArray(item.processSteps) ? item.processSteps.flatMap(step => [step && step.label, step && step.detail]) : [])];
  return [...new Set(notes.map(note => text(note, 1000)).filter(Boolean))].slice(0, 30);
}

function normalizeProcessSteps(raw) {
  const steps = (Array.isArray(raw) ? raw : []).slice(0, STEP_LIMIT).map((step, index) => {
    if (!step || typeof step !== 'object') return null;
    const label = text(step.label ?? step.step, STEP_LABEL_LIMIT);
    const detail = text(step.detail ?? step.text ?? step.work, STEP_DETAIL_LIMIT);
    const formula = text(step.formula ?? step.equation, 200);
    const key = text(step.key, 80);
    const verdict = step.verdict === 'correct' || step.verdict === 'wrong' ? step.verdict : '';
    if (!label && !detail && !formula) return null;
    return {index: index + 1, ...(key ? {key} : {}), label, detail, formula, verdict};
  }).filter(Boolean);
  const total = steps.reduce((sum, step) => sum + [step.label, step.detail, step.formula].join('').length, 0);
  return total > MAX_HANDWRITING_CHARS ? steps.slice(0, 8) : steps;
}

/* 卡点只在「引用到了学生真实写下的原文」时才留。抄不出原文的卡点一律丢掉——
   和单题录入同一个标准：空白答题区不做画像式猜测。 */
function normalizeStuckPoint(raw, steps, handwriting) {
  if (!raw || typeof raw !== 'object') return null;
  const rawStep = Number(raw.stepIndex ?? raw.step);
  const stepIndex = Number.isInteger(rawStep) && rawStep >= 1 && rawStep <= Math.max(steps.length, STEP_LIMIT) ? rawStep : null;
  const evidence = text(raw.evidence ?? raw.evidenceQuote, 400);
  const label = text(raw.label ?? raw.summary, STEP_LABEL_LIMIT);
  const status = raw.status === 'blocked' ? 'blocked' : raw.status === 'wrong' ? 'wrong' : '';
  if (!evidence || (!label && !status) || !citesHandwriting(evidence, handwriting)) return null;
  return {stepIndex, ...(label ? {label} : {}), ...(status ? {status} : {}), evidence};
}

function normalizeWeakPointClaim(raw, handwriting) {
  const evidence = text(raw.evidence ?? raw.evidenceQuote, 300);
  const point = text(raw.knowledgePoint ?? raw.point, 120);
  if (!point || !evidence || !citesHandwriting(evidence, handwriting)) return null;
  return {knowledgePoint: point, evidence, stepIndex: Number.isInteger(Number(raw.stepIndex)) && Number(raw.stepIndex) >= 1 ? Number(raw.stepIndex) : null};
}

function errorCauseFromClaim(raw, handwriting) {
  const cause = text(raw && (raw.errorCause ?? raw.cause), 40);
  if (!errorCauses.has(cause)) return '';
  const evidence = text(raw && (raw.errorCauseEvidence ?? raw.evidence), 360);
  return evidence && citesHandwriting(evidence, handwriting) ? cause : '';
}

/* 只有解答题（非选择题、非填空题）才谈得上「做题过程」。
   选择题、填空题只看最终答案对不对，不给过程、不给卡点、也不反推薄弱点。 */
export const isProcessQuestion = type => type === 'written';

export function normalizePaperAnalysis(raw) {
  if (!raw || !Array.isArray(raw.questions)) throw new Error('PAPER_ANALYSIS_INVALID');
  const subject = subjects.has(raw.subject) ? raw.subject : '未分类';
  const seen = new Set();
  const questions = raw.questions.slice(0, PAPER_MAX_QUESTIONS).map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const question = text(item.question);
    if (!question) return null;
    const number = text(item.number || String(index + 1), 40);
    const key = `${number}:${question}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const type = item.type === 'choice' ? 'choice' : item.type === 'fill' || item.type === 'blank' ? 'fill' : 'written';
    const studentAnswer = text(item.studentAnswer, 3000);
    /* 答案来源分三档，按可信度从高到低：
         printed  —— 图片上印着标准答案（教师用卷、答案页）：直接采信
         provided —— 另外上传了一份答案页，或学生手动输入：采信
         derived  —— 图片上没有答案，由 AI 自己算出来的：**标注为「可能是错的」**
       判对错时三档都用，但 derived 的结论必须让前端能标出来，
       不能和标准答案一样笃定，否则学生会被 AI 的错答教错。 */
    const answerSource = ['printed', 'provided', 'derived'].includes(String(item.answerSource || ''))
      ? String(item.answerSource)
      : (String(item.correctAnswer || '').trim() ? 'printed' : 'derived');
    const correctAnswer = text(item.correctAnswer, 1000);
    /* AI 对自己推导的把握。只有 derived 才需要，且只允许三档；读不出来当 low 处理，
       宁可在界面上多提醒一次"可能是错的"，也不要让学生以为这是标准答案。 */
    const answerConfidence = answerSource === 'derived'
      ? (['high', 'medium', 'low'].includes(String(item.answerConfidence || '')) ? String(item.answerConfidence) : 'low')
      : '';
    /* 推导关键步骤 + 题干旁批注：都只在有内容时保留 */
    const correctAnswerSteps = list(item.correctAnswerSteps ?? item.answerSteps, 12);
    const marginNotes = marginNoteList(item.marginNotes ?? item.marginNote ?? item.handwrittenAnnotations
      ?? item.studentAnnotations ?? item.blueInkNotes ?? quotedMarginNotesFromReason(item.judgementReason ?? item.reason));
    const markEvidence = text(item.markEvidence, 500);
    const rawScore=Number(item.score),rawMax=Number(item.maxScore);
    const maxScore=Number.isFinite(rawMax) && rawMax>0 ? rawMax : null;
    const score=Number.isFinite(rawScore) && rawScore>=0 && (maxScore===null || rawScore<=maxScore)
      && item.score!=='' && item.score!==null ? rawScore : null;
    const explicitLoss = score !== null && maxScore !== null && maxScore > 0 && score >= 0 && score < maxScore;
    const picked=studentAnswer.toUpperCase().replace(/\s/g,'');
    const expected=correctAnswer.toUpperCase().replace(/\s/g,'');
    const choiceMismatch=type==='choice' && /^[A-D]{1,4}$/.test(picked) && /^[A-D]{1,4}$/.test(expected) && picked!==expected;
    /* 填空题只看最终答案：两边都写得出来且不一样就是错。
       字迹或答案读不出来时不动手，交给学生核对。 */
    const fillMismatch = type==='fill' && picked.length >= 1 && expected.length >= 1
      && picked.replace(/\s/g,'') !== expected.replace(/\s/g,'') && picked.length <= 60 && expected.length <= 60;
    const explicitWrong = explicitLoss || choiceMismatch || fillMismatch || (item.status === 'wrong' && Boolean(markEvidence));
    /* 选择题/填空题两边都明确写出来且一致时，答案这一项就算对上了。
       解答题不适用：最后一步写对不代表过程对。 */
    const explicitRight = type !== 'written'
      && !explicitWrong && !markEvidence && !choiceMismatch && !fillMismatch
      && picked.length >= 1 && expected.length >= 1 && picked === expected;
    // 手写过程本身就是「做错/没做完」的证据：解答题先有过程、再有结论。
    // 选择题和填空题没有过程可谈，模型硬给也丢掉。
    const processSteps = isProcessQuestion(type) ? normalizeProcessSteps(item.processSteps ?? item.steps ?? item.solutionSteps) : [];
    const hasProcess = processSteps.length > 0;
    const handwriting = [...new Set([studentAnswer, ...processSteps.flatMap(step => [step.label, step.detail, step.formula])]
      .map(note => text(note, 1000)).filter(Boolean))].slice(0, 30);
    /* 批量错题入口没有批改痕迹可依，只能靠 AI 读学生的手写作业自己判对错。
       允许它下判断，但必须给出引用学生原文的理由；理由引用不到原文就退回「交给学生定」。 */
    const judgementRaw = item.judgement === 'wrong' || item.judgement === 'correct' ? item.judgement : '';
    const judgementReason = text(item.judgementReason ?? item.reason, 400);
    const judgement = judgementRaw && judgementReason && citesHandwriting(judgementReason, handwriting) ? judgementRaw : '';
    const status = explicitWrong ? 'wrong'
      : item.status === 'correct' || explicitRight ? 'correct'
      : judgement || (hasProcess ? 'wrong' : 'needs_review');
    const stuckAt = isProcessQuestion(type) ? normalizeStuckPoint(item.stuckAt, processSteps, handwriting) : null;
    const weakPointClaims = isProcessQuestion(type)
      ? (Array.isArray(item.weakPointClaims) ? item.weakPointClaims : []).slice(0, WEAK_POINT_LIMIT)
        .map(claim => normalizeWeakPointClaim(claim, handwriting)).filter(Boolean)
      : [];
    /* 解答题读不到学生自己的过程时，不要硬猜：让前端请学生自己写一遍思路，
       再由 AI 从他的表达里提薄弱点和错因；学生不写就只当题目入库。 */
    const needsStudentProcess = isProcessQuestion(type) && !hasProcess;
    const inferredPoints = (status === 'wrong' || hasProcess) && isProcessQuestion(type) ? list(item.weakPoints) : [];
    const citedPoints = weakPointClaims.map(claim => claim.knowledgePoint).filter(point => !inferredPoints.includes(point));
    // 卡点所在知识点排第一：热力图按第一个知识点归格，卡点必须落在最显眼的位置。
    const stuckPoint = stuckAt && weakPointClaims[0] ? weakPointClaims[0].knowledgePoint : '';
    const points = [...new Set([stuckPoint, ...citedPoints, ...inferredPoints].filter(Boolean))].slice(0, 12);
    const errorCause = isProcessQuestion(type)
      ? errorCauseFromClaim({errorCause:item.errorCause, errorCauseEvidence:item.errorCauseEvidence ?? item.causeEvidence}, handwriting) : '';
    const explanation = text(item.explanation, 900);
    const hasEvidence = status === 'wrong' || hasProcess || Boolean(stuckAt);
    // 中文解释优先给「为什么判错/判对」：学生要能一眼看出 AI 的依据，判不清的会说 needs_review。
    const reason = text(judgementReason || item.explanation, 400);
    return {id:randomUUID(),number,type,question,studentAnswer,correctAnswer,answerSource,
      ...(answerConfidence ? {answerConfidence} : {}),
      ...(correctAnswerSteps.length ? {correctAnswerSteps} : {}),
      ...(marginNotes.length ? {marginNotes} : {}),
      processSteps,stuckAt,
      errorCause,
      score,maxScore,markEvidence,status,
      aiJudgement:judgement || (status === 'needs_review' ? 'needs_review' : status),
      aiJudgementReason:reason,
      // 前端据此显示「你自己写一遍思路」输入框；写了就由 AI 从他的表达里提薄弱点
      needsStudentProcess,
      weakPoints:hasEvidence ? points : [],
      weakPointClaims:hasEvidence ? weakPointClaims : [],
      explanation:hasEvidence ? explanation : '',
      paperPage:Number.isInteger(item.paperPage) && item.paperPage > 0 ? item.paperPage : null,
      answerPage:Number.isInteger(item.answerPage) && item.answerPage > 0 ? item.answerPage : null};
  }).filter(Boolean);
  if (!questions.length) throw new Error('PAPER_NO_QUESTIONS_RECOGNIZED');
  return {subject,questions};
}

/* 图片按顺序平铺，模型只能靠位置判断「第几页」，所以页面顺序必须在文字里说清。
   两种入口共用这一条提示词，靠图片组合区分：
   ① 只给题目页（批量错题）= 没有批改痕迹，必须由 AI 读学生手写作业自己判对错，
      判不清就老实说 needs_review，交给学生自己定；
   ② 试卷页 + 答题卡页 = 结合两者按题号配对，以批改痕迹和逐题得分为准。 */
const PAPER_PROMPT = `你在核对一位学生的错题照片，并从中还原他真实的做题记录。
图片按顺序给出：先是试卷/题目页，再是答题卡页（如果有）。一页上可能有多道题，一道题可能有 (1)(2)(3) 多个小问，必须逐题、逐小问单独识别成 questions 里的一条，不能把整页合成一条。
先判断题型：选择题给 type="choice"，填空题给 type="fill"，解答题/证明题/计算题给 type="written"。
- 选择题和填空题只看最终答案：不要输出 processSteps、stuckAt、weakPointClaims，也不要写 explanation 里的分步过程；只判断答案对不对。
- 解答题才要给 processSteps 和 stuckAt：这是「做题过程」分析，只有解答题才有。
判断每道题做对还是做错，按你手上有的证据来：
- 有答题卡、红笔批改或逐题得分时，以批改痕迹和得分为准，并抄下批改原文到 markEvidence。
- 解答题只有题目页和手写作业、没有批改痕迹时，你要自己读学生写的过程和结论来判断：算错、漏解、结论错、没做完都算 wrong；过程与结论都对算 correct。
- 判断必须给出 judgementReason，并引用学生真实写下的原文（如「学生写到 n=0.05 mol 后直接得 c=0.1 mol/L，没有除以体积」）。引用不到原文就不要下判断，把 judgement 留空。
- 手写太潦草、照片模糊、被遮挡、看不到作答时，不要猜：把 judgement 留空、status 给 needs_review，processSteps 给 []，系统会请学生自己写一遍思路，或直接当题目存下来。
对每一题，先抄题干，再抄学生真实写下的解题过程：
- processSteps：按学生实际书写顺序逐步骤记录。label 写这一步在做什么（如「设直线 l 的方程」），detail 尽量抄手写原文，formula 只填这一步写出的式子，verdict 在能看出对错时填 correct 或 wrong，看不出就留空。看不到手写过程就留空数组，绝不补写标准解法。
- stuckAt：学生的过程卡在哪、或哪一步开始出错。evidence 必须用引号引用 processSteps 或 studentAnswer 里真实出现的原文，例如「写到“所以 x=3”后停笔」。抄不出原文就把 stuckAt 写成 null，或写成 {}。
- weakPointClaims：由上面的过程证据反推的薄弱点，每条必须带 knowledgePoint 和 evidence；evidence 同样必须引用学生真实写下的原文。没有过程证据就不要输出这一项。
- 答案分三种来源，必须用 answerSource 如实标注，不许含糊：
  · printed  —— 图片上印着标准答案（教师用卷、答案页、批改写上的正确答案）
  · derived  —— 图片上没有答案，你自己把这道题**算/推**出来。**必须标 derived。**
  · 空字符串 —— 你既没看到答案，也没把握推出来，就不要填 correctAnswer
  没有印刷答案时，选择题、填空题、解答题都要求你自己推出来并填 derived；
  推不出来（题目条件不全、图看不清）就留空，绝不硬猜。
- answerConfidence 只在 derived 时填 high / medium / low：这是你对这次推导的把握。
  把握不足就如实写 low —— 前端会把 derived 的答案标成「AI 推导，可能是错的」。
- marginNotes：逐题识别题干旁边/题目边缘的手写批注、旁注或老师圈画旁写的字，包含蓝色笔迹；逐条逐字抄录，并按实际所属题号归属。
  这是学生当时的思路痕迹，和正文解题过程分开；不要把 judgementReason、解释或推断的错因复制成批注；没有可靠读到就留空数组。
- explanation 要写清「为什么学生这样答是错的」：选择题点明他选的选项错在哪、正确选项依据是什么。
- errorCause 只能从这七类里选：概念不清、规则不熟、审题偏差、策略选错、计算失误、粗心惯性、知识漏洞。选错因必须同时给出 errorCauseEvidence 并引用手写原文；没有手写作答时 errorCause 和 errorCauseEvidence 都留空字符串。
- 空白答题区什么都不算：没有手写过程、没有批改痕迹的题，status 给 needs_review，processSteps 给 []，weakPoints 给 []，绝不做画像式猜测。
- 按题号配对试卷与答题卡；不确定的对应关系保留 needs_review。只有总分不能推断逐题得分。选择题只在学生选项与明确正确选项不同时判错。
输出 JSON：{"subject":"数学","questions":[{"number":"1","type":"choice 或 fill 或 written","question":"完整题干及选项","studentAnswer":"实际作答，无法辨认留空","processSteps":[{"label":"这一步在做什么","detail":"手写原文","formula":"这一步的式子","verdict":"correct 或 wrong 或 空"}],"stuckAt":{"stepIndex":2,"label":"卡在哪里","status":"blocked 或 wrong","evidence":"引用手写原文"},"correctAnswer":"印刷答案，或你自己推导出的答案","answerSource":"printed 或 derived 或 空","answerConfidence":"high 或 medium 或 low（仅 derived）","correctAnswerSteps":["推导关键步骤，仅 derived 时给"],"marginNotes":["属于本题的手写旁注原文（蓝色笔迹也要识别）"],"score":null,"maxScore":null,"markEvidence":"批改证据原文，缺失留空","status":"wrong/correct/needs_review","judgement":"wrong/correct/空","judgementReason":"引用学生原文说明为什么判对或判错","weakPoints":["有过程证据支持的知识点"],"weakPointClaims":[{"knowledgePoint":"知识点","evidence":"引用手写原文","stepIndex":2}],"errorCause":"","errorCauseEvidence":"","explanation":"引用作答或批改证据，说明哪一步开始出错；不确定留空","paperPage":1,"answerPage":1}]}。只输出 JSON。`;

/* 识别一批试卷的真实耗时（实测）：2 页、1 道题 = 37 秒，
   其中 reasoning_tokens 7479 / completion_tokens 7843 —— 也就是约 95% 的生成预算
   花在"想"上面，正文只占 1156 字符。所以：
   ① 超时不能给 120 秒。12 页一批时 120 秒必然超时，而超时后会再重试一次 → 240 秒仍然失败，
      学生看到的就是"本批识别暂未完成"。
   ② max_tokens=16000 是 reasoning + 正文共享的。题目一多，reasoning 先把预算吃完，
      finish_reason 变成 length、content 为空 → JSON.parse('') 抛错 → 又是同一句报错。
   ③ 失败原因以前既不记也不回传，所以只能提示"可重试"，无法定位。 */
/* 快速模式提示词：只拿「题干 / 作答 / 对错 / 卷面答案」。
   实测（DeepSeek，整页 1289×1080，同一张图反复跑）：
   · 完整提示词 65~150 秒（推理 12k~16k tokens）
   · 这份短提示词 7~15 秒
   代价是「薄弱点 / 卡点 / 判错依据」不预判——这本来就是产品允许的状态
   （薄弱点必须引用手写原文，读不到就不预判），深度分析可以之后再做。 */
const PAPER_FAST_PROMPT = `你是高中试卷识别器。读图后只输出严格 JSON：
{"subject":"数学","questions":[{"number":"1","type":"choice 或 fill 或 written","question":"完整题干及选项","studentAnswer":"学生实际作答原文，看不清留空","correctAnswer":"卷面上印着的答案，没有留空","status":"wrong 或 correct 或 needs_review"}]}
一页多题必须逐题列出，不要合并成一条；选择题只在学生所选与明确正确选项不同时判 wrong；看不清就 needs_review。
不要输出解题过程、薄弱点、判错依据或任何解释文字，只输出 JSON。`;

const PAPER_ATTEMPT_TIMEOUT_MS = Number(process.env.PAPER_ANALYSIS_TIMEOUT_MS) || 300000;
/* 快速模式本来就快，超时给短的，失败了也能立刻告诉学生，不用等两分钟。 */
const PAPER_FAST_TIMEOUT_MS = Number(process.env.PAPER_FAST_TIMEOUT_MS) || 60000;
/* 单页实测 60~150 秒（模型把绝大部分时间花在推理上）。原来的 90 秒 + 25 秒/页
   让单页只有 115 秒预算，正好卡在实测区间里 → 撞线后要再重试一次，
   学生等 2~4 分钟还是看到「超时」。改成更贴近实测的预算，并可用环境变量压回。 */
const PAPER_ANALYSIS_BASE_MS = Number(process.env.PAPER_ANALYSIS_BASE_MS) || 150000;
const PAPER_ANALYSIS_PER_PAGE_MS = Number(process.env.PAPER_ANALYSIS_PER_PAGE_MS) || 30000;
/* 实测（DeepSeek，整页 1289×1080）：这份提示词让模型推理 12k~16k tokens，
   而 reasoning 与正文共享 max_tokens。原来的 [16000, 32000] 意味着第一次尝试经常
   把预算全烧在推理上、正文为空（finish_reason=length）→ 白等 70 秒再重试一次。
   第一次就给 32000（实测该模型接受 64000），让第一次尝试大概率直接出结果。 */
const PAPER_MAX_TOKENS = [32000, 48000];
const PAPER_RETRY_DELAY_MS = [0, 3000];
const PAPER_RETRYABLE_STATUS = [429, 500, 502, 503, 504];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class PaperAnalysisError extends Error {
  constructor(code, detail, cause) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PaperAnalysisError';
    this.code = code;
    this.detail = detail || '';
    if (cause) this.cause = cause;
  }
}

export function createPaperAnalysisAdapter(config = {}) {
  return async ({paperImages,answerImages}) => {
    if (!config.apiKey || !config.endpoint || !config.model) throw new PaperAnalysisError('PAPER_MODEL_NOT_CONFIGURED');
    const fast = Boolean(config.fast);
    const prompt = fast ? PAPER_FAST_PROMPT : PAPER_PROMPT;
    const content = [{type:'text',text:prompt},
      ...paperImages.map((url,index)=>({type:'image_url',image_url:{url,detail:'original'}})),
      {type:'text',text:'以上为试卷；以下按顺序为答题卡。'},
      ...answerImages.map(url=>({type:'image_url',image_url:{url,detail:'original'}}))];
    const pageCount = paperImages.length + answerImages.length;
    // 页数越多，模型要读要写的越多；单页本身已经需要一两分钟，所以基线给足。
    // 快速模式走短提示词，预算收紧到 PAPER_FAST_TIMEOUT_MS，失败得快、提示得早。
    const timeoutMs = config.timeoutMs || (fast
      ? Math.min(PAPER_ATTEMPT_TIMEOUT_MS, PAPER_FAST_TIMEOUT_MS)
      : Math.min(PAPER_ATTEMPT_TIMEOUT_MS, PAPER_ANALYSIS_BASE_MS + pageCount * PAPER_ANALYSIS_PER_PAGE_MS));
    let lastError;
    for (let attempt=0;attempt<2;attempt++) {
      const attemptStarted = Date.now();
      let attemptOutcome = 'ok';
      if (PAPER_RETRY_DELAY_MS[attempt]) await sleep(PAPER_RETRY_DELAY_MS[attempt]);
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try {
        const response=await (config.fetchImpl || fetch)(config.endpoint,{method:'POST',
          headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},
          body:JSON.stringify({model:config.model,messages:[{role:'user',content}],temperature:0,
            max_tokens:PAPER_MAX_TOKENS[Math.min(attempt, PAPER_MAX_TOKENS.length - 1)],
            response_format:{type:'json_object'}}),          signal:controller.signal});
        if (!response.ok) {
          // 以前这里只留了状态码，服务端返回的 message 被丢掉了 —— 那正是唯一能定位问题的信息
          const bodyText = await response.text().catch(() => '');
          const detail = bodyText.slice(0, 300).replace(/\s+/g, ' ');
          const error=new PaperAnalysisError(`PAPER_MODEL_HTTP_${response.status}`, detail);
          attemptOutcome = error.code;
          if (!PAPER_RETRYABLE_STATUS.includes(response.status)) throw error;
          lastError=error;continue;
        }
        const result=await response.json();
        const choice=result?.choices?.[0] || {};
        const output=choice.message?.content;
        // 空正文：以前会走到 JSON.parse('') 抛 SyntaxError，报错信息毫无指向性
        if (typeof output !== 'string' || !output.trim()) {
          const reason=choice.finish_reason || 'unknown';
          const used=result?.usage?.completion_tokens;
          const why=reason === 'length'
            ? '生成预算被推理用尽，正文为空'
            : `模型没有返回正文（finish_reason=${reason}）`;
          const error=new PaperAnalysisError('PAPER_MODEL_EMPTY_OUTPUT',
            `${why}${used ? `；completion_tokens=${used}` : ''}${reason === 'length' ? '，已提高上限重试' : ''}`);
          lastError=error;
          attemptOutcome=error.code;
          continue;
        }
        let parsed;
        try { parsed=JSON.parse(output.replace(/^```json\s*|\s*```$/g,'').trim()); }
        catch (error) { lastError=new PaperAnalysisError('PAPER_MODEL_BAD_JSON', output.slice(0, 200).replace(/\s+/g, ' '), error); attemptOutcome=lastError.code; continue; }
        return normalizePaperAnalysis(parsed);
      } catch(error) {
        if (error?.name === 'AbortError') lastError=new PaperAnalysisError('PAPER_MODEL_TIMEOUT', `单次超过 ${Math.round(timeoutMs / 1000)} 秒未返回`);
        else lastError=error;
        attemptOutcome = lastError.code || lastError.name || 'failed';
        if (/PAPER_MODEL_HTTP_(401|402|403)/.test(String(error.message))) break;
      } finally {
        clearTimeout(timer);
        /* 每次尝试的真实耗时必须记下来：一次整页分析动辄一两分钟，
           没有这行日志时，"超时"到底是模型慢、图片大还是墙钟预算太紧，只能靠猜。
           outcome 用本轮自己的结果（不能用 lastError——成功返回时它还留着上一轮的错）。 */
        console.info('[paper-intake] attempt', JSON.stringify({
          attempt: attempt + 1, model: config.model, detail: 'original', fast,
          pageCount, timeoutMs, elapsedMs: Date.now() - attemptStarted,
          maxTokens: PAPER_MAX_TOKENS[Math.min(attempt, PAPER_MAX_TOKENS.length - 1)],
          outcome: attemptOutcome
        }));
      }
    }
    throw lastError || new PaperAnalysisError('PAPER_MODEL_FAILED');
  };
}

/* 把识别失败的原因翻成人话。以前前端只会说「本批识别暂未完成」，
   学生没法判断是照片糊了、题目分不开，还是模型/网络的问题。 */
export function describePaperModelError(error, {pageCount = 0} = {}) {
  const code = String(error?.code || '');
  const detail = String(error?.detail || error?.message || '');
  /* 实测（DeepSeek 官方，整页 1289×1080，三个参数组合反复跑）：
     这份「逐题抄手写过程 + 逐题薄弱点 + 逐题判错依据」的提示词会让模型每次推理
     12k~16k tokens，单页真实耗时 60~150 秒（同一张图、同一个模型，短提示词只要 7 秒）。
     所以超时的原因是「这一页要读的东西多、模型这次推理久」，跟页数无关。
     只传 1~2 页时再劝「少传几页」纯属答非所问，学生只会觉得系统在推卸。 */
  const fewPages = pageCount > 0 && pageCount <= 2;
  const table = {
    PAPER_MODEL_NOT_CONFIGURED: '学习服务还没配置视觉模型，去「我的 → 服务与模型配置」填一次 Key 就能识别。',
    PAPER_MODEL_TIMEOUT: fewPages
      ? '这次是模型返回太慢：这一页要逐题读题目、手写过程和判错依据，单页通常要 60~150 秒，模型偶尔更久。不是因为你传得多（你只传了这一页）。可以直接点「仍然试着识别一次」；如果反复这样，把你要的那道题裁出来再传会快很多。'
      : '这一批照片太多或太复杂，模型超时了。建议一次少传几页（3~4 页最稳）再试。',
    PAPER_MODEL_EMPTY_OUTPUT: fewPages
      ? '模型这次把生成预算都花在推理上、没写出正文。直接点「仍然试着识别一次」；如果反复这样，把这一页裁成只含你要的那道题再传。'
      : '模型把生成预算用光了、没写出结果。请减少这一批的页数后重试。',
    PAPER_MODEL_BAD_JSON: '模型返回的内容不是合法结构，通常是题目太密集或字迹太乱。建议一页只拍 1~2 道题再试。',
    PAPER_NO_QUESTIONS_RECOGNIZED: '照片里没有读出任何题目。多半是拍得太远、太糊、反光，或者只拍到了封面/页眉。请靠近题目、正对拍、保证光线均匀。'
  };
  if (table[code]) return {code, hint: table[code], detail: detail.slice(0, 300)};
  const http = code.match(/PAPER_MODEL_HTTP_(\d+)/);
  if (http) {
    const status = Number(http[1]);
    const hint = status === 401 || status === 403 ? 'API Key 无效或没有该模型权限，去「我的 → 服务与模型配置」换一个 Key。'
      : status === 402 ? '账号额度不足，去模型服务商充值后再试。'
      : status === 429 ? '请求太频繁，等半分钟再试。'
      : status >= 500 ? '模型服务端出错，过一会儿再试。'
      : '模型请求被拒绝，检查模型名与 Key 是否正确。';
    return {code, hint, detail: detail.slice(0, 300)};
  }
  return {code: code || 'PAPER_MODEL_FAILED', hint: '识别没成功，请重试；如果连续失败，把这一批的页数减到 1~2 页。', detail: detail.slice(0, 300)};
}

/* 上传前预检：不问「识别成功了吗」，而是直接回答学生最关心的三个问题——
   照片能不能看清、题目有没有分开、我的做题过程有没有读到。
   level 只用三档：good（能直接用）/ warn（能用但要你补）/ bad（这组照片得重拍）。 */
export function paperPreflight({paperImageCount = 0, answerImageCount = 0, analysis = null, error = null} = {}) {
  const problems = [];
  const advice = [];
  if (!paperImageCount) {
    return {level: 'bad', subject: '未分类', questionCount: 0, needsReviewCount: 0, withProcessCount: 0,
      writtenCount: 0, needsProcessPhoto: false,
      questions: [], advice: ['先选至少 1 页题目照片。'], problems: ['没有题目照片'], error: null};
  }
  if (error) {
    const described = describePaperModelError(error, {pageCount: Number(paperImageCount || 0) + Number(answerImageCount || 0)});
    return {level: 'bad', subject: '未分类', questionCount: 0, needsReviewCount: 0, withProcessCount: 0,
      writtenCount: 0, needsProcessPhoto: false,
      questions: [], advice: [described.hint], problems: ['识别没有成功'], error: described};
  }
  const questions = (analysis?.questions || []).map(item => ({
    number: item.number, type: item.type,
    status: item.status,
    hasProcess: item.processSteps.length > 0,
    hasStuckPoint: Boolean(item.stuckAt),
    needsStudentProcess: Boolean(item.needsStudentProcess),
    judgement: item.aiJudgement || item.status,
    reason: (item.aiJudgementReason || '').slice(0, 200)
  }));
  if (!questions.length) {
    return {level: 'bad', subject: analysis?.subject || '未分类', questionCount: 0, needsReviewCount: 0, withProcessCount: 0,
      writtenCount: 0, needsProcessPhoto: false,
      questions: [], advice: ['靠近题目重拍：一页只放 1~2 道题，正对、别反光、保证光线均匀。', '如果只拍到封面或页眉，请翻到有题目的那一页重拍。'],
      problems: ['这一批没有读出题目'], error: null};
  }
  const needsReviewCount = questions.filter(item => item.status === 'needs_review').length;
  const withProcessCount = questions.filter(item => item.hasProcess).length;
  const needsStudentProcessCount = questions.filter(item => item.needsStudentProcess).length;
  /* 做题过程只对解答题有意义（isProcessQuestion = type==='written'）。
     以前这里不分题型：只要「这批没有读到任何手写过程」就让学生再补拍一张做题笔记，
     只传选择题/填空题的人被逼着去拍一张根本不存在的东西。判「你来定」也一样——
     选择题核对所选选项、填空题核对最终答案就能定，不需要笔记。 */
  const writtenQuestions = questions.filter(item => isProcessQuestion(item.type));
  const writtenMissingProcess = writtenQuestions.filter(item => !item.hasProcess);
  const writtenNeedsReviewCount = questions.filter(item => item.status === 'needs_review' && isProcessQuestion(item.type)).length;
  const objectiveNeedsReviewCount = needsReviewCount - writtenNeedsReviewCount;
  if (needsReviewCount) {
    problems.push(`${needsReviewCount} 道题没有读到判错依据`);
    if (writtenNeedsReviewCount) {
      advice.push(`这 ${needsReviewCount} 道题会标成「你来定」：其中 ${writtenNeedsReviewCount} 道是解答题，把写了解题过程的那一页一起拍进来，AI 就能判对错、并找出卡点。`
        + (objectiveNeedsReviewCount ? `另外 ${objectiveNeedsReviewCount} 道是选择题/填空题，核对最终答案或所选选项就能定，不需要做题笔记。` : ''));
    } else {
      advice.push(`这 ${needsReviewCount} 道题会标成「你来定」：都是选择题/填空题，核对最终答案或所选选项就能定，不需要做题笔记。`);
    }
  }
  if (!withProcessCount && writtenMissingProcess.length) {
    advice.push('这批的解答题没有读到任何手写解题过程；把学生写了解答的那一页也拍上，才能反推薄弱点。');
  } else if (!writtenQuestions.length) {
    /* 全是选择题/填空题：明确告诉学生「不用补笔记」，否则他会以为系统漏了什么。 */
    advice.push('这批全是选择题/填空题：只看最终答案对不对，不需要做题笔记。');
  }
  if (needsStudentProcessCount) {
    advice.push(`有 ${needsStudentProcessCount} 道解答题读不清手写：识别后可以让学生自己把思路打一遍（选择题和填空题不需要），AI 会从他的表达里提薄弱点和错因；不想写就直接当题目存下来。`);
  }
  if (!answerImageCount && !withProcessCount) {
    /* 只传一张练习题的照片也会命中这里。原来的写法（「改用试卷 + 答题卡并上传答题卡」）
       读起来像系统替学生换了流程，学生手上根本没有答题卡。改成明确的二选一：要么补答题卡
       换逐题得分，要么就按错题存下来——后者才是绝大多数练习题的情况。 */
    advice.push('如果你手上还有红笔批改过的答题卡，可以改用「试卷 + 答题卡」并上传答题卡，AI 才会按逐题得分判分；只是想把这几道练习题存成错题，现在这样继续就行。');
  }
  return {level: problems.length ? 'warn' : 'good', subject: analysis?.subject || '未分类',
    questionCount: questions.length, needsReviewCount, withProcessCount, needsStudentProcessCount,
    /* 前端据此决定要不要显示「补拍做题过程那一页」：只有还存在没读到过程的解答题时才有意义。 */
    writtenCount: writtenQuestions.length, needsProcessPhoto: writtenMissingProcess.length > 0,
    questions, advice, problems, error: null};
}

/* 归纳信息自动填充：科目、知识点、错因从识别结果汇总，学生只做微调。 */
export function paperAutoFill(questions = []) {
  const points = [];
  const causes = [];
  for (const item of questions) {
    for (const point of (item.weakPoints || [])) if (point && !points.includes(point)) points.push(point);
    if (item.errorCause && !causes.includes(item.errorCause)) causes.push(item.errorCause);
  }
  return {subject: '', knowledgePoints: points.slice(0, 8), errorCauses: causes.slice(0, 3)};
}

export function confirmPaperItems(draft, input, owner) {
  if (!draft || draft.source !== 'paper_batch') throw new Error('PAPER_DRAFT_NOT_FOUND');
  const selected = Array.isArray(input.selectedIds) ? [...new Set(input.selectedIds)] : [];
  if (!selected.length || selected.length > PAPER_MAX_QUESTIONS) throw new Error('PAPER_SELECTION_REQUIRED');
  const corrections = input.corrections && typeof input.corrections === 'object' ? input.corrections : {};
  return selected.map(id => {
    const item=draft.questions.find(candidate=>candidate.id===id);
    if (!item) throw new Error('PAPER_ITEM_NOT_FOUND');
    const correction=corrections[id] || {};
    const question=text(correction.question ?? item.question);
    if (!question) throw new Error('PAPER_QUESTION_REQUIRED');
    const studentAnswer=text(correction.studentAnswer ?? item.studentAnswer,3000);
    const correctAnswer=text(correction.correctAnswer ?? item.correctAnswer,1000);
    /* 学生在核对界面手动改了答案，那这份答案就是他自己确认的，可信度等同于另外上传的答案页。
       没改就沿用识别阶段的来源（printed / provided / derived）。 */
    const answerSource = String(correction.correctAnswer || '').trim() && String(correction.correctAnswer).trim() !== String(item.correctAnswer || '').trim()
      ? 'provided'
      : (['printed', 'provided', 'derived'].includes(String(item.answerSource || '')) ? String(item.answerSource) : 'derived');
    /* 置信度只在「答案还是 AI 推的那份」时才有意义：
       学生一旦自己改过答案，那份答案的可信度由他自己负责，不该再挂 AI 的把握程度。 */
    const answerConfidence = answerSource === 'derived'
      ? (['high', 'medium', 'low'].includes(String(item.answerConfidence || '')) ? String(item.answerConfidence) : 'low')
      : '';
    const correctAnswerSteps = Array.isArray(correction.correctAnswerSteps) ? list(correction.correctAnswerSteps, 12)
      : (Array.isArray(item.correctAnswerSteps) ? list(item.correctAnswerSteps, 12) : []);
    /* 题干旁的批注单独一段，不混进解题过程：两件事，混在一起 AI 反而不好用。 */
    const marginNotes = correction.marginNotes !== undefined ? marginNoteList(correction.marginNotes)
      : marginNoteList(item.marginNotes);
    const processSteps = Array.isArray(item.processSteps) ? item.processSteps : [];
    const stuckAt = item.stuckAt || null;
    /* 归纳信息允许学生在核对时改：AI 自动填的科目/知识点/错因只是预判，
       热力图和错因分布都按这里最终确认的值统计。 */
    const subject = subjects.has(correction.subject) ? correction.subject : draft.subject;
    const correctedPoints = correction.knowledgePoints === undefined ? null : list(correction.knowledgePoints);
    const correctedCause = errorCauses.has(correction.errorCause) ? correction.errorCause : '';
    // 卡点所在的知识点排在第一位：热力图/复习队列按第一个知识点归格。
    const fallbackPoints = [stuckAt && item.weakPointClaims?.[0]?.knowledgePoint, ...(item.weakPoints || [])];
    const knowledgePoints = [...new Set([...(correctedPoints === null ? fallbackPoints : correctedPoints)]
      .map(point => text(point, 120)).filter(Boolean))].slice(0, 12);
    const causes = correctedCause ? [correctedCause] : item.errorCause ? [item.errorCause] : [];
    /* 学生自己写了一遍思路（AI 读不清手写时）：
       它就成了这道题的「做题记录」，也是薄弱点唯一可靠的证据来源。
       学生什么都没写就只当题目入库，不做任何猜测。 */
    const typedProcess = text(correction.studentProcess, 4000);
    const ownSteps = typedProcess
      ? typedProcess.split(/\r?\n|[；;]/).map(part => part.trim()).filter(Boolean).slice(0, 20)
        .map((part, index) => ({index: index + 1, label: '', detail: part.slice(0, 400), formula: '', verdict: ''}))
      : [];
    const processSource = ownSteps.length ? 'student_typed' : processSteps.length ? 'ai_recognized' : 'none';
    const needsStudentProcess = isProcessQuestion(item.type) && processSource === 'none';
    const analysis = ownSteps.length
      ? `学生自己补写的做题记录：${typedProcess.slice(0, 600)}`
      : item.explanation || '试卷识别结果已由学生核对；具体错因仍待陪练确认。';
    const questionImage=correction.questionImage && typeof correction.questionImage==='object'
      && /^[a-f0-9]{64}$/.test(String(correction.questionImage.hash||''))
      ? {hash:String(correction.questionImage.hash),mimeType:/^image\/(?:jpeg|png|webp)$/.test(String(correction.questionImage.mimeType||''))
          ? String(correction.questionImage.mimeType) : 'image/jpeg',
        fileName:text(correction.questionImage.fileName||'本题题图',180)} : null;
    return {id:randomUUID(),user_id:owner,studentId:owner,subject,unit:knowledgePoints[0] || subject,
      question,studentAnswer,correctAnswer,answerSource,analysis,
      ...(questionImage ? {sourceImage:questionImage} : {}),
      ...(answerConfidence ? {answerConfidence} : {}),
      ...(correctAnswerSteps.length ? {correctAnswerSteps} : {}),
      ...(marginNotes.length ? {marginNotes} : {}),
      knowledgePoints,errorCauses:causes,aiSuggestedWeakPoints:item.weakPoints,
      ...(correctedPoints === null && !correctedCause && subject === draft.subject ? {} : {
        studentCorrections:{values:{subject,knowledgePoints:correctedPoints === null ? knowledgePoints : correctedPoints,errorCause:correctedCause}}}),
      studentProcessSource:processSource,needsStudentProcess,studentProcess:typedProcess.slice(0, 4000),
      processSteps:ownSteps.length ? ownSteps : processSteps,stuckAt,errorCauseEvidence:causes.length ? text(item.errorCauseEvidence,360) : '',
      source:'paper_batch',origin:'student_confirmed_paper',verificationStatus:'student_confirmed',
      paperSource:{draftId:draft.id,itemId:id,number:item.number,type:item.type,score:item.score,maxScore:item.maxScore,
        markEvidence:item.markEvidence,status:item.status,paperPage:item.paperPage,answerPage:item.answerPage,
        paperImages:draft.paperImages,answerImages:draft.answerImages},
      createdAt:new Date().toISOString(),confirmedAt:new Date().toISOString()};
  });
}

/** 每一步过程记录都要有原文；没有引用的步骤不进薄弱点证据，避免「AI 替我编过程」。 */
function stepEvidence(caseRecord) {
  const stuck = caseRecord.stuckAt;
  if (stuck && stuck.evidence) return text(stuck.evidence, 360);
  const step = (Array.isArray(caseRecord.processSteps) ? caseRecord.processSteps : [])
    .find(candidate => candidate && (candidate.detail || candidate.label));
  return step ? text(step.detail || step.label, 360) : '';
}

/**
 * 把「做题记录里暴露的卡点/出错点」写成薄弱点记录。
 * 存在的意义：薄弱点以前只有 AI 陪练一个来源；现在拍照录入的解题过程也能进同一套薄弱点体系
 * （/v1/weak-points、热力图、复习队列）。学生一确认入库就写入，不需要额外点一次分析。
 * 每条都带学生手写原文引用（evidenceQuote），没有证据的题不产出记录。
 */
export function paperWeakPointsFromCases(cases = []) {
  const records = [];
  for (const record of cases) {
    if (!record || !record.id) continue;
    const owner = record.user_id || record.studentId || 'local-student';
    const stuck = record.stuckAt;
    const hasSteps = Array.isArray(record.processSteps) && record.processSteps.length > 0;
    const typed = text(record.studentProcess, 1000);
    if (!stuck && !hasSteps && !typed) continue;
    const evidenceQuote = typed || stepEvidence(record);
    if (!evidenceQuote) continue;
    const wrong = record.paperSource?.status === 'wrong';
    const knowledgePoint = text((record.knowledgePoints || [])[0], 120);
    // 学生自己写的思路：证据是学生原话，来源标成自述，和 AI 抄下来的手写区分开。
    const selfReported = record.studentProcessSource === 'student_typed';
    records.push({id:randomUUID(),studentId:owner,user_id:owner,caseId:record.id,sessionId:null,turnId:null,
      subject:text(record.subject,20) || '未分类',
      knowledgePoint,microSkill:text(stuck && stuck.label,120),
      signal: selfReported ? '学生自述卡点' : stuck ? (stuck.status === 'wrong' ? '步骤出错' : '过程卡点') : wrong ? '答案错误' : '过程不完整',
      evidenceType:'process_review',
      evidenceQuote,
      evidenceSource: selfReported ? 'student_self_report' : 'handwriting_ocr',
      stepIndex: stuck && Number.isInteger(stuck.stepIndex) ? stuck.stepIndex : null,
      stepCount: hasSteps ? record.processSteps.length : 0,
      errorCause:(record.errorCauses || [])[0] || '',
      feedback:text(record.analysis,540),
      questionNumber:text(record.paperSource?.number,40),
      createdAt:new Date().toISOString()});
  }
  return records;
}

/** 同一道题、同一个知识点只留一条，避免反复确认把薄弱点刷爆。 */
export function dedupeWeakPoints(existing = [], incoming = []) {
  const keys = new Set(existing.map(item => `${item.user_id || item.studentId}::${item.caseId}::${item.knowledgePoint || item.microSkill}`));
  return incoming.filter(item => {
    const key = `${item.user_id || item.studentId}::${item.caseId}::${item.knowledgePoint || item.microSkill}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}
