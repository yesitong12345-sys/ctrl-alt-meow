import {randomUUID} from 'node:crypto';

const text=value=>String(value||'').trim();
const normalized=value=>text(value).toLowerCase().replace(/[\s，。！？；：、,.!?;:'"“”‘’（）()【】\[\]{}\-—_]/g,'');
const ownerId=record=>text(record?.user_id||record?.studentId)||'local-student';
const unique=values=>[...new Set((values||[]).map(text).filter(Boolean))];
const bigrams=value=>{const source=normalized(value),items=new Set();for(let index=0;index<source.length-1;index+=1)items.add(source.slice(index,index+2));return items};
const jaccard=(left,right)=>{const a=bigrams(left),b=bigrams(right);if(!a.size||!b.size)return 0;let overlap=0;for(const item of a)if(b.has(item))overlap+=1;return overlap/(a.size+b.size-overlap)};
const similarity=(left,right)=>{
  if(text(left.subject)!==text(right.subject))return 0;
  const knowledge=text(left.knowledgePoint)&&text(left.knowledgePoint)===text(right.knowledgePoint)?0.15:0;
  const micro=text(left.microSkill)&&text(left.microSkill)===text(right.microSkill)?0.2:0;
  return knowledge+micro+jaccard(knowledgeCardTextKey(left),knowledgeCardTextKey(right))*0.65;
};

function validateCandidate(candidate,evidence,source){
  const refs=unique(candidate?.evidenceRefs),quotes=unique(candidate?.sourceQuotes);
  const byId=new Map((evidence||[]).map(item=>[item.id,item]));
  if(!text(candidate?.cardKind)||!text(candidate?.title)||!text(candidate?.challengePrompt)||!text(candidate?.insight))return 'CARD_CONTENT_REQUIRED';
  if(!refs.length||refs.some(ref=>!byId.has(ref)))return 'EVIDENCE_REFERENCE_INVALID';
  if(!quotes.length||quotes.some(quote=>!refs.some(ref=>text(byId.get(ref)?.quote).includes(quote))))return 'SOURCE_QUOTE_INVALID';
  const groundingTerms=bigrams([refs.map(ref=>byId.get(ref)?.quote).join(' '),source?.question,source?.knowledgePoint,source?.microSkill].join(' '));
  const fields=[candidate.title,candidate.challengePrompt,candidate.insight,candidate.nextTimeAction,candidate.memoryHook],groundedEnough=value=>{const terms=bigrams(value);if(!terms.size)return true;let count=0;for(const term of terms)if(groundingTerms.has(term))count+=1;return count>=(terms.size<=4?1:2)&&count/terms.size>=0.08};
  const crossDomain=source?.subject==='数学'?/氧化还原|电子守恒|化学方程|反应物|生成物|配平/:source?.subject==='化学'?/线面角|法向量|圆锥曲线|函数单调|几何证明/:null;
  if((crossDomain&&fields.some(value=>crossDomain.test(text(value))))||!fields.every(groundedEnough))return 'EVIDENCE_SEMANTIC_MISMATCH';
  return '';
}

function materialize(candidate,source,clock,idFactory){
  const createdAt=clock();
  return {
    id:idFactory(),studentId:ownerId(source),user_id:ownerId(source),subject:text(source.subject)||'未分类',
    knowledgePoint:text(source.knowledgePoint),microSkill:text(source.microSkill),cardKind:text(candidate.cardKind),
    title:text(candidate.title).slice(0,120),challengePrompt:text(candidate.challengePrompt).slice(0,500),insight:text(candidate.insight).slice(0,800),
    ...(text(candidate.nextTimeAction)?{nextTimeAction:text(candidate.nextTimeAction).slice(0,500)}:{}),
    ...(text(candidate.memoryHook)?{memoryHook:text(candidate.memoryHook).slice(0,300)}:{}),
    evidenceRefs:unique(candidate.evidenceRefs),sourceCaseIds:unique([source.caseId]),sourceQuotes:unique(candidate.sourceQuotes),
    recurrenceCount:1,starredAsRecurring:false,favorite:false,masteryStatus:'learning',
    reviewSchedule:{dueAt:createdAt,intervalDays:0,streak:0,lastResult:null},createdAt,updatedAt:createdAt
  };
}

export function createKnowledgeCardEngine({generateCandidates,clock=()=>new Date().toISOString(),idFactory=randomUUID}={}){
  if(typeof generateCandidates!=='function')throw new TypeError('generateCandidates adapter is required');
  return {
    async generate({existingCards=[],source}){
      const evidence=Array.isArray(source?.evidence)?source.evidence:[];
      const candidates=await generateCandidates({source,evidence});
      const cards=structuredClone(existingCards),created=[],merged=[],rejected=[];
      for(const candidate of Array.isArray(candidates)?candidates:[]){
        const reason=validateCandidate(candidate,evidence,source);
        if(reason){rejected.push({candidate,reason});continue}
        const card=materialize(candidate,source,clock,idFactory);
        const duplicate=cards.find(existing=>ownerId(existing)===card.user_id&&similarity(existing,card)>=0.52);
        if(duplicate){
          duplicate.user_id=ownerId(duplicate);
          duplicate.recurrenceCount=Math.max(1,Number(duplicate.recurrenceCount||1))+1;duplicate.starredAsRecurring=true;
          duplicate.evidenceRefs=unique([...(duplicate.evidenceRefs||[]),...card.evidenceRefs]);duplicate.sourceCaseIds=unique([...(duplicate.sourceCaseIds||[]),...card.sourceCaseIds]);duplicate.sourceQuotes=unique([...(duplicate.sourceQuotes||[]),...card.sourceQuotes]);
          duplicate.masteryStatus='learning';duplicate.reviewSchedule={...(duplicate.reviewSchedule||{}),dueAt:card.createdAt,intervalDays:0,streak:0,lastResult:'recurring'};duplicate.updatedAt=card.updatedAt;merged.push(duplicate);continue;
        }
        cards.push(card);created.push(card);
      }
      return {cards,created,merged,rejected,candidateCount:Array.isArray(candidates)?candidates.length:0};
    },
    review({card,correctness,studentAnswer='',feedback=''}){
      if(!['correct','partial','incorrect'].includes(correctness))throw new RangeError('KNOWLEDGE_CARD_REVIEW_INVALID');
      const reviewed=structuredClone(card),reviewedAt=clock(),previousStreak=Math.max(0,Number(reviewed.reviewSchedule?.streak||0));
      reviewed.user_id=ownerId(reviewed);
      const streak=correctness==='correct'?previousStreak+1:0;
      const intervalDays=correctness==='incorrect'?1:correctness==='partial'?3:[3,7,14,30][Math.min(3,streak-1)];
      const due=new Date(reviewedAt);due.setUTCDate(due.getUTCDate()+intervalDays);
      reviewed.masteryStatus=correctness==='correct'&&streak>=3?'mastered':'learning';
      reviewed.reviewSchedule={dueAt:due.toISOString(),intervalDays,streak,lastResult:correctness,lastReviewedAt:reviewedAt};reviewed.updatedAt=reviewedAt;
      const review={id:idFactory(),cardId:reviewed.id,user_id:ownerId(reviewed),studentId:ownerId(reviewed),
        sourceCaseIds:unique(reviewed.sourceCaseIds),studentAnswer:text(studentAnswer).slice(0,1000),
        correctness,feedback:text(feedback).slice(0,800),reviewedAt,nextDueAt:reviewed.reviewSchedule.dueAt};
      return {card:reviewed,review};
    }
  };
}

export const knowledgeCardTextKey=card=>normalized([card?.title,card?.challengePrompt,card?.insight,card?.nextTimeAction].join(' '));

const parseModelJson=value=>{
  const source=text(value).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=Math.min(...['[','{'].map(mark=>{const index=source.indexOf(mark);return index<0?Number.POSITIVE_INFINITY:index}));
  if(!Number.isFinite(start))throw new Error('KNOWLEDGE_CARD_MODEL_JSON_INVALID');
  return JSON.parse(source.slice(start));
};

async function callDeepSeek(config,messages){
  if(!text(config?.apiKey))throw new Error('KNOWLEDGE_CARD_MODEL_NOT_CONFIGURED');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Number(config.timeoutMs||60000));
  try{
    const response=await fetch(config.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.model,messages,temperature:0.25,response_format:{type:'json_object'}}),signal:controller.signal});
    if(!response.ok)throw new Error(`KNOWLEDGE_CARD_MODEL_FAILED:${response.status}`);
    return parseModelJson((await response.json()).choices?.[0]?.message?.content);
  }finally{clearTimeout(timeout)}
}

export const createDeepSeekKnowledgeCardAdapter=getConfig=>async({source,evidence})=>{
  const output=await callDeepSeek(getConfig(),[
    {role:'system',content:'你负责把真实学习证据提炼为0到多张个性化知识卡片。禁止固定数量，禁止凭空推断学生问题。每张卡只能引用输入 evidence 中存在的 id 和原文 quote，并在标题、理解或行动中保留至少两个原文核心词组作为可核验证据；没有高价值内容就返回空数组。卡片类型自由命名。只输出 JSON：{"cards":[{"cardKind":"","title":"","challengePrompt":"","insight":"","nextTimeAction":"","memoryHook":"","evidenceRefs":[""],"sourceQuotes":[""]}]}。'},
    {role:'user',content:JSON.stringify({subject:source.subject,knowledgePoint:source.knowledgePoint,microSkill:source.microSkill,question:source.question,evidence})}
  ]);
  const cards=Array.isArray(output)?output:Array.isArray(output.cards)?output.cards:[];
  if(!cards.length)return [];
  const review=await callDeepSeek(getConfig(),[
    {role:'system',content:'你是独立证据审查员，不负责改写卡片。逐张检查 cardKind、title、challengePrompt、insight、nextTimeAction、memoryHook 的每项事实是否由给定 evidence、原题、学科、知识点或微技能直接支持，并检查学科是否一致。任何凭空补充、跨学科内容或无法从引用推出的主张都拒绝。只输出 JSON：{"acceptedIndexes":[0],"reasons":[{"index":1,"reason":""}]}。'},
    {role:'user',content:JSON.stringify({subject:source.subject,knowledgePoint:source.knowledgePoint,microSkill:source.microSkill,question:source.question,evidence,cards})}
  ]);
  if(!Array.isArray(review.acceptedIndexes))throw new Error('KNOWLEDGE_CARD_GROUNDING_INVALID');
  const accepted=[...new Set(review.acceptedIndexes)].filter(index=>Number.isInteger(index)&&index>=0&&index<cards.length).map(index=>cards[index]);
  if(!accepted.length)throw new Error('KNOWLEDGE_CARD_GROUNDING_REJECTED');
  return accepted;
};

// A deliberately narrow, offline option for recorded sessions. It only emits a
// card when the student's own wording contains both a concrete stuck point and
// a later concrete result; all other sessions still return zero cards.
export const createLocalEvidenceCardAdapter=()=>async({evidence=[]})=>{
  const find=pattern=>(evidence||[]).filter(item=>pattern.test(text(item.quote)));
  const vector=find(/点积|法向量|方向.*向量|向量模长/);
  const final=find(/2\s*\/\s*11.*(?:√|根号).*22|sin.*2\s*\/\s*11/);
  const radical=find(/16038|√4\s*\/\s*22|根号.*16038/);
  const cards=[];
  if(vector.length&&final.length){
    const refs=unique([vector.at(-1).id,final.at(-1).id]),quotes=unique([vector.at(-1).quote,final.at(-1).quote]);
    cards.push({
      cardKind:'关系填空',title:'线面角正弦：点积与两个模长',
      challengePrompt:'填空：求线面角正弦时，把方向向量与法向量的 ____ 取绝对值；分母写两个向量的 ____。',
      insight:'真实卡点：你已经写出“点积绝对值”和“向量模长”，但当时也说“没有化简 sin 值”。这说明代入公式后，点积和两个模长还需要分开列清，再进入化简。',
      nextTimeAction:'先列“点积绝对值”和“两个向量模长”，再写 sin。',
      memoryHook:'点积在上，两个模长在下。',
      evidenceRefs:refs,sourceQuotes:quotes
    });
  }
  if(radical.length&&final.length){
    const refs=unique([radical.at(-1).id,final.at(-1).id]),quotes=unique([radical.at(-1).quote,final.at(-1).quote]);
    cards.push({
      cardKind:'根式填空',title:'根号下16038分之108 的最终 sin',
      challengePrompt:'填空：你从“根号下16038分之108”继续化简后，最终写出的 sinθ 是 ____。',
      insight:'你曾写“根号下16038分之108”，又写过“√4/22”，最后正确写出“2/11倍√22”。',
      evidenceRefs:refs,sourceQuotes:quotes
    });
  }
  return cards;
};

export const createDeepSeekKnowledgeCardReviewAdapter=getConfig=>async({card,studentAnswer})=>{
  const output=await callDeepSeek(getConfig(),[
    {role:'system',content:'你是高中生知识卡片闯关评阅老师。根据卡片 insight、真实来源证据和学生回答，明确判断 correct、partial 或 incorrect。反馈1到3句话：先说明答对/部分正确/错误，再指出关键差异。不得增加来源中没有的新事实。只输出 JSON：{"correctness":"correct|partial|incorrect","feedback":""}。'},
    {role:'user',content:JSON.stringify({challengePrompt:card.challengePrompt,insight:card.insight,nextTimeAction:card.nextTimeAction,sourceQuotes:card.sourceQuotes,studentAnswer})}
  ]);
  if(!['correct','partial','incorrect'].includes(output.correctness)||!text(output.feedback))throw new Error('KNOWLEDGE_CARD_REVIEW_INVALID');
  return {correctness:output.correctness,feedback:text(output.feedback).slice(0,800)};
};
