import {createHash} from 'node:crypto';

const round=value=>Number((Number.isFinite(value)?value:0).toFixed(4));
const rate=(numerator,denominator)=>round(denominator?numerator/denominator:1);

function semanticKey(value){
  if(typeof value==='string')return value.normalize('NFKC').toUpperCase().replace(/[－—]/g,'-').replace(/\s+/g,'').replace(/[，,；;。()\[\]{}]/g,'');
  if(!value||typeof value!=='object')return String(value||'');
  const entries=Object.entries(value).filter(([key])=>!['id','evidenceRefs','sourceRange','confidence'].includes(key)).sort(([a],[b])=>a.localeCompare(b));
  return entries.map(([key,item])=>`${key}:${Array.isArray(item)?item.map(semanticKey).sort().join(','):semanticKey(item)}`).join('|');
}

export const examDatasetDigest=papers=>createHash('sha256').update(JSON.stringify(Array.isArray(papers)?papers:[])).digest('hex');

function recall(gold=[],observed=[]){
  const expected=[...new Set(gold.map(semanticKey).filter(Boolean))],actual=new Set(observed.map(semanticKey).filter(Boolean));
  const matched=expected.filter(item=>actual.has(item)).length;
  return{matched,total:expected.length,value:rate(matched,expected.length),missing:expected.filter(item=>!actual.has(item))};
}

function precision(gold=[],observed=[]){
  const expected=new Set(gold.map(semanticKey).filter(Boolean)),actual=[...new Set(observed.map(semanticKey).filter(Boolean))];
  const matched=actual.filter(item=>expected.has(item)).length;
  return{matched,total:actual.length,value:rate(matched,actual.length),unexpected:actual.filter(item=>!expected.has(item))};
}

export function auditExamCoverage(dataset={},options={}){
  const papers=Array.isArray(dataset.papers)?dataset.papers:[],questions=papers.flatMap(paper=>(paper.questions||[]).map(question=>({paper,question})));
  const eligibilityReasons=[];
  const trustedDatasetHashes=options.trustedDatasetHashes||{};
  const suppliedDigest=examDatasetDigest(papers),trustedDigest=dataset.datasetId?trustedDatasetHashes[dataset.datasetId]:null;
  if(!trustedDigest||trustedDigest!==suppliedDigest)eligibilityReasons.push('SERVER_TRUSTED_DATASET_REQUIRED');
  if(!papers.length||papers.some(item=>item.sourceKind!=='real_anonymized_exam'))eligibilityReasons.push('REAL_ANONYMIZED_EXAMS_REQUIRED');
  if(!papers.length||papers.some(item=>item.humanGold!==true))eligibilityReasons.push('HUMAN_GOLD_REQUIRED');
  if(papers.length<10)eligibilityReasons.push('MINIMUM_10_EXAMS_REQUIRED');
  if(questions.length<100)eligibilityReasons.push('MINIMUM_100_QUESTIONS_REQUIRED');

  let conditionMatched=0,conditionTotal=0,conditionObservedMatched=0,conditionObservedTotal=0;
  let queryMatched=0,queryTotal=0,queryObservedMatched=0,queryObservedTotal=0;
  let canonical=0,usable=0,learningLoop=0,visualExpected=0,verified3D=0,safeDegradation=0;
  const failures=[];
  for(const {paper,question} of questions){
    const gold=question.gold||{},observed=question.observed||{};
    const conditionResult=recall(gold.conditionAtoms,observed.conditionAtoms),conditionPrecision=precision(gold.conditionAtoms,observed.conditionAtoms);
    const queryResult=recall(gold.queries,observed.queries),queryPrecision=precision(gold.queries,observed.queries);
    conditionMatched+=conditionResult.matched;conditionTotal+=conditionResult.total;conditionObservedMatched+=conditionPrecision.matched;conditionObservedTotal+=conditionPrecision.total;
    queryMatched+=queryResult.matched;queryTotal+=queryResult.total;queryObservedMatched+=queryPrecision.matched;queryObservedTotal+=queryPrecision.total;
    if(conditionResult.missing.length)failures.push({paperId:paper.id,questionId:question.id,code:'CONDITION_INCOMPLETE',missing:conditionResult.missing});
    if(conditionPrecision.unexpected.length)failures.push({paperId:paper.id,questionId:question.id,code:'CONDITION_UNEXPECTED',unexpected:conditionPrecision.unexpected});
    if(queryResult.missing.length)failures.push({paperId:paper.id,questionId:question.id,code:'QUERY_INCOMPLETE',missing:queryResult.missing});
    if(queryPrecision.unexpected.length)failures.push({paperId:paper.id,questionId:question.id,code:'QUERY_UNEXPECTED',unexpected:queryPrecision.unexpected});
    const semanticGoldReady=conditionResult.total>0&&queryResult.total>0;
    if(!semanticGoldReady)failures.push({paperId:paper.id,questionId:question.id,code:'GOLD_SEMANTICS_MISSING'});
    const semanticComplete=semanticGoldReady&&conditionResult.value===1&&conditionPrecision.value===1&&queryResult.value===1&&queryPrecision.value===1;
    const canonicalReady=observed.canonicalSchemaVersion==='geometry-ir/v4';
    if(canonicalReady)canonical+=1;else failures.push({paperId:paper.id,questionId:question.id,code:'CANONICAL_IR_MISSING'});
    const loopReady=observed.recordCreated===true&&observed.learningLoopAvailable===true;
    if(loopReady)learningLoop+=1;
    const needsVisual=gold.visualizationExpected===true;
    if(needsVisual){
      visualExpected+=1;
      if(observed.verifiedScene===true)verified3D+=1;
      else if(observed.safeDegradation===true)safeDegradation+=1;
    }
    if(semanticComplete&&canonicalReady&&loopReady&&(!needsVisual||observed.verifiedScene===true||observed.safeDegradation===true))usable+=1;
  }
  const metrics={
    paperCount:papers.length,questionCount:questions.length,
    conditionRecall:rate(conditionMatched,conditionTotal),conditionPrecision:rate(conditionObservedMatched,conditionObservedTotal),
    queryRecall:rate(queryMatched,queryTotal),queryPrecision:rate(queryObservedMatched,queryObservedTotal),
    canonicalIRRate:rate(canonical,questions.length),learningLoopRate:rate(learningLoop,questions.length),usableRate:rate(usable,questions.length),
    trusted3DRate:rate(verified3D,visualExpected),safeDegradationRate:rate(safeDegradation,visualExpected),visualizationExpectedCount:visualExpected
  };
  const certifiable=eligibilityReasons.length===0;
  const target70Met=certifiable&&metrics.usableRate>=.7&&metrics.conditionRecall>=.95&&metrics.conditionPrecision>=.95&&metrics.queryRecall>=.95&&metrics.queryPrecision>=.95&&metrics.canonicalIRRate>=.95;
  return{
    schemaVersion:'exam-coverage-audit/v1',
    datasetDigest:suppliedDigest,
    status:target70Met?'target_met':certifiable?'target_not_met':'provisional',
    target70Met,
    eligibility:{certifiable,reasons:eligibilityReasons},
    thresholds:{usableRate:.7,conditionRecall:.95,conditionPrecision:.95,queryRecall:.95,queryPrecision:.95,canonicalIRRate:.95,minPapers:10,minQuestions:100},
    metrics,
    failures
  };
}
