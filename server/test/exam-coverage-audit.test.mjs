import test from 'node:test';
import assert from 'node:assert/strict';
import {auditExamCoverage,examDatasetDigest} from '../workflows/exam-coverage-audit.mjs';

const question=(id,overrides={})=>({
  id,
  gold:{conditionAtoms:['distance:AB=4'],queries:['volume:PABC'],visualizationExpected:true},
  observed:{conditionAtoms:['distance:AB=4'],queries:['volume:PABC'],canonicalSchemaVersion:'geometry-ir/v4',recordCreated:true,learningLoopAvailable:true,verifiedScene:true,safeDegradation:false},
  ...overrides
});

test('合成题或样本不足只能给 provisional 指标，不能宣称达到真实试卷 70%',()=>{
  const report=auditExamCoverage({papers:[{id:'paper-1',sourceKind:'synthetic',humanGold:true,questions:[question('q1')]}]});
  assert.equal(report.eligibility.certifiable,false);
  assert.equal(report.target70Met,false);
  assert.equal(report.status,'provisional');
  assert.ok(report.eligibility.reasons.includes('REAL_ANONYMIZED_EXAMS_REQUIRED'));
  assert.equal(report.metrics.usableRate,1);
});

test('服务端登记的真实人工金标整卷分别统计完整性、学习可用率和可信 3D，不把安全降级伪装成 3D 成功',()=>{
  const papers=Array.from({length:10},(_,paperIndex)=>({
    id:`paper-${paperIndex+1}`,sourceKind:'real_anonymized_exam',humanGold:true,
    questions:Array.from({length:10},(_,questionIndex)=>{
      const index=paperIndex*10+questionIndex;
      if(index<70)return question(`q-${index}`);
      return question(`q-${index}`,{observed:{conditionAtoms:['distance:AB=4'],queries:['volume:PABC'],canonicalSchemaVersion:'geometry-ir/v4',recordCreated:true,learningLoopAvailable:true,verifiedScene:false,safeDegradation:true}});
    })
  }));
  const report=auditExamCoverage({datasetId:'sz-gold-v1',papers},{trustedDatasetHashes:{'sz-gold-v1':examDatasetDigest(papers)}});
  assert.equal(report.eligibility.certifiable,true);
  assert.equal(report.metrics.usableRate,1);
  assert.equal(report.metrics.trusted3DRate,.7);
  assert.equal(report.metrics.safeDegradationRate,.3);
  assert.equal(report.target70Met,true);
  assert.equal(report.status,'target_met');
});

test('漏掉第二个条件或问法对象错误会降低语义召回率并阻止达标',()=>{
  const papers=Array.from({length:10},(_,paperIndex)=>({id:`paper-${paperIndex}`,sourceKind:'real_anonymized_exam',humanGold:true,questions:Array.from({length:10},(_,questionIndex)=>question(`${paperIndex}-${questionIndex}`,{
    gold:{conditionAtoms:['distance:AB=4','perpendicular:PA|plane:ABC'],queries:['volume:PABC','distance:P|plane:ABC'],visualizationExpected:true},
    observed:{conditionAtoms:['distance:AB=4'],queries:['volume:PABC','distance:Q|plane:ABC'],canonicalSchemaVersion:'geometry-ir/v4',recordCreated:true,learningLoopAvailable:true,verifiedScene:true,safeDegradation:false}
  }))}));
  const report=auditExamCoverage({datasetId:'sz-gold-v1',papers},{trustedDatasetHashes:{'sz-gold-v1':examDatasetDigest(papers)}});
  assert.equal(report.metrics.conditionRecall,.5);
  assert.equal(report.metrics.queryRecall,.5);
  assert.equal(report.target70Met,false);
  assert.ok(report.failures.some(item=>item.code==='CONDITION_INCOMPLETE'));
  assert.ok(report.failures.some(item=>item.code==='QUERY_INCOMPLETE'));
});

test('自报真实来源、空金标或额外幻觉条件都不能获得覆盖率认证',()=>{
  const empty=Array.from({length:10},(_,paperIndex)=>({id:`paper-${paperIndex}`,sourceKind:'real_anonymized_exam',humanGold:true,questions:Array.from({length:10},(_,questionIndex)=>({id:`${paperIndex}-${questionIndex}`,gold:{conditionAtoms:[],queries:[],visualizationExpected:false},observed:{conditionAtoms:[],queries:[],canonicalSchemaVersion:'geometry-ir/v4',recordCreated:true,learningLoopAvailable:true}}))}));
  const trustedHash=examDatasetDigest(empty);
  const untrusted=auditExamCoverage({datasetId:'made-up',papers:empty},{trustedDatasetHashes:{'sz-gold-v1':trustedHash}});
  assert.equal(untrusted.target70Met,false);
  assert.ok(untrusted.eligibility.reasons.includes('SERVER_TRUSTED_DATASET_REQUIRED'));
  const hallucinated=empty.map(paper=>({...paper,questions:paper.questions.map(item=>({...item,gold:{conditionAtoms:['distance:AB=4'],queries:['volume:PABC'],visualizationExpected:false},observed:{...item.observed,conditionAtoms:['distance:AB=4','perpendicular:PA|plane:ABC'],queries:['volume:PABC']}}))}));
  const report=auditExamCoverage({datasetId:'sz-gold-v1',papers:hallucinated},{trustedDatasetHashes:{'sz-gold-v1':examDatasetDigest(hallucinated)}});
  assert.equal(report.metrics.usableRate,0);
  assert.equal(report.target70Met,false);
  assert.ok(report.failures.some(item=>item.code==='CONDITION_UNEXPECTED'));
});

test('语义比较保留负号与除号，不把不同数学条件撞成同一条',()=>{
  const papers=Array.from({length:10},(_,paperIndex)=>({id:`paper-${paperIndex}`,sourceKind:'real_anonymized_exam',humanGold:true,questions:Array.from({length:10},(_,questionIndex)=>question(`${paperIndex}-${questionIndex}`,{
    gold:{conditionAtoms:['coordinate:X=-1','ratio:AB/BC=1/2'],queries:['coordinate:P'],visualizationExpected:false},
    observed:{conditionAtoms:['coordinate:X=1','ratio:AB/BC=12'],queries:['coordinate:P'],canonicalSchemaVersion:'geometry-ir/v4',recordCreated:true,learningLoopAvailable:true}
  }))}));
  const report=auditExamCoverage({datasetId:'signed',papers},{trustedDatasetHashes:{signed:examDatasetDigest(papers)}});
  assert.equal(report.metrics.conditionRecall,0);
  assert.equal(report.target70Met,false);
});
