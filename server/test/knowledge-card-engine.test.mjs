import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeCardEngine, createLocalEvidenceCardAdapter} from '../workflows/knowledge-card-engine.mjs';

const evidence=[{id:'turn-1',kind:'tutor_turn',quote:'我不知道这里为什么要用正弦而不是余弦，也不知道是否应该先画出两个角并标记余角',caseId:'case-1'}];
const baseCard={id:'card-base',studentId:'local-student',subject:'数学',knowledgePoint:'线面角',microSkill:'夹角关系转换',cardKind:'角度关系判断',title:'先判断夹角是否互余',challengePrompt:'线面角和向量法向量夹角有什么关系？',insight:'先判断两个角是否互余，再选择正弦或余弦。',nextTimeAction:'画出角度关系。',evidenceRefs:['old-turn'],sourceCaseIds:['old-case'],sourceQuotes:['我上次也分不清正弦余弦'],recurrenceCount:1,starredAsRecurring:false,favorite:false,masteryStatus:'learning',reviewSchedule:{dueAt:'2026-08-30T00:00:00.000Z',intervalDays:7,streak:2,lastResult:'correct'},createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z'};

test('只接纳能回指学生真实表达的自由知识卡片', async () => {
  const engine=createKnowledgeCardEngine({generateCandidates:async()=>[
    {cardKind:'角度关系判断',title:'先判断两个角的关系',challengePrompt:'线面角与方向向量、法向量夹角是什么关系？',insight:'先判断余角关系，再决定使用正弦还是余弦。',nextTimeAction:'先画出两个角并标记余角。',evidenceRefs:['turn-1'],sourceQuotes:[evidence[0].quote]},
    {cardKind:'泛泛总结',title:'认真审题',challengePrompt:'以后怎么办？',insight:'认真审题。',evidenceRefs:['missing'],sourceQuotes:['学生从未说过的话']},
    {cardKind:'无关推断',title:'背诵化学方程式',challengePrompt:'如何配平？',insight:'记住氧化还原反应的电子守恒。',evidenceRefs:['turn-1'],sourceQuotes:[evidence[0].quote]},
    {cardKind:'夹带推断',title:'正弦余弦提醒',challengePrompt:'正弦余弦应该怎样判断？',insight:'正弦余弦说明电子守恒和氧化还原都没有掌握。',evidenceRefs:['turn-1'],sourceQuotes:[evidence[0].quote]}
  ]});
  const result=await engine.generate({existingCards:[],source:{sourceType:'tutor',subject:'数学',knowledgePoint:'线面角',microSkill:'夹角关系转换',caseId:'case-1',evidence}});
  assert.equal(result.created.length,1);
  assert.equal(result.rejected.length,3);
  assert.ok(result.rejected.some(item=>item.reason==='EVIDENCE_SEMANTIC_MISMATCH'));
  assert.deepEqual(result.created[0].evidenceRefs,['turn-1']);
  assert.equal(result.created[0].cardKind,'角度关系判断');
});

test('没有值得记录的真实卡点时允许生成 0 张', async () => {
  const engine=createKnowledgeCardEngine({generateCandidates:async()=>[]});
  const result=await engine.generate({existingCards:[],source:{subject:'数学',caseId:'case-clear',evidence:[{id:'turn-clear',quote:'我独立完成了全部推导并检查无误。'}]}});
  assert.deepEqual(result.cards,[]);
  assert.deepEqual(result.created,[]);
});

test('本地证据提炼只把学生真实写出的线面角数据变成填空卡', async () => {
  const engine=createKnowledgeCardEngine({generateCandidates:createLocalEvidenceCardAdapter()});
  const result=await engine.generate({existingCards:[],source:{subject:'数学',knowledgePoint:'线面角',microSkill:'线面角正弦',caseId:'case-local',evidence:[
    {id:'turn-data',quote:'点积绝对值54，方向向量模长根号下99/2，法向量模长根号下162，然后没有化简sin值是根号下16038分之108'},
    {id:'turn-final',quote:'答案不就是 sinθ = 2/11 倍 √22 吗？'}
  ]}});
  assert.equal(result.created.length,2);
  assert.ok(result.created.every(card=>card.cardKind.includes('填空')));
  assert.ok(result.created.every(card=>card.sourceQuotes.length>0));
  assert.ok(result.created.some(card=>card.insight.includes('真实卡点')));
});

test('没有知识点标签时，文本高度相似的卡片仍合并而不是重复新增', async () => {
  const existing={...baseCard,studentId:'s1',user_id:'s1',knowledgePoint:'',microSkill:''};
  const engine=createKnowledgeCardEngine({generateCandidates:async()=>[{cardKind:'个人经验',title:existing.title,challengePrompt:existing.challengePrompt,insight:existing.insight,evidenceRefs:['turn-new'],sourceQuotes:['我还是会混淆线面角和向量法向量夹角的关系，不知道两个角是否互余，也分不清正弦余弦。']}]});
  const result=await engine.generate({existingCards:[existing],source:{studentId:'s1',subject:'数学',caseId:'case-new',evidence:[{id:'turn-new',quote:'我还是会混淆线面角和向量法向量夹角的关系，不知道两个角是否互余，也分不清正弦余弦。'}]}});
  assert.equal(result.cards.length,1);
  assert.equal(result.merged.length,1);
});

test('相似知识卡只在同一用户内合并，复习记录继承卡片用户', async () => {
  const quote='我不知道这里为什么要用正弦而不是余弦，也不知道是否应该先画出两个角并标记余角';
  const engine=createKnowledgeCardEngine({generateCandidates:async()=>[{
    cardKind:'角度关系判断',title:baseCard.title,challengePrompt:baseCard.challengePrompt,
    insight:baseCard.insight,nextTimeAction:baseCard.nextTimeAction,
    evidenceRefs:['turn-1'],sourceQuotes:[quote]
  }]});
  const result=await engine.generate({existingCards:[{...baseCard,user_id:'student-a',studentId:'student-a'}],
    source:{studentId:'student-b',user_id:'student-b',subject:'数学',knowledgePoint:'线面角',microSkill:'夹角关系转换',caseId:'case-b',evidence}});
  assert.equal(result.created.length,1);
  assert.equal(result.merged.length,0);
  assert.equal(result.created[0].user_id,'student-b');
  const reviewed=engine.review({card:result.created[0],correctness:'correct',studentAnswer:'先判断余角',feedback:'正确'});
  assert.equal(reviewed.review.user_id,'student-b');
  assert.equal(reviewed.review.cardId,result.created[0].id);
});

test('同一微技能的相似卡点只给原卡加星并追加证据', async () => {
  const existing={id:'card-1',studentId:'local-student',subject:'数学',knowledgePoint:'线面角',microSkill:'夹角关系转换',cardKind:'角度关系判断',title:'先判断夹角是否互余',challengePrompt:'线面角和向量法向量夹角有什么关系？',insight:'先判断两个角是否互余，再选择正弦或余弦。',nextTimeAction:'画出角度关系。',evidenceRefs:['old-turn'],sourceCaseIds:['old-case'],sourceQuotes:['我上次也分不清正弦余弦'],recurrenceCount:1,starredAsRecurring:false,favorite:true,masteryStatus:'learning',reviewSchedule:{dueAt:'2026-08-30T00:00:00.000Z',intervalDays:7,streak:2,lastResult:'correct'},createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z'};
  const engine=createKnowledgeCardEngine({clock:()=> '2026-08-21T00:00:00.000Z',generateCandidates:async()=>[
    {cardKind:'角度转换',title:'先判断两个夹角是不是余角',challengePrompt:'线面角和方向向量、法向量夹角是什么关系？',insight:'判断余角关系后再确定用正弦还是余弦。',nextTimeAction:'先画角度关系。',evidenceRefs:['turn-1'],sourceQuotes:[evidence[0].quote]}
  ]});
  const result=await engine.generate({existingCards:[existing],source:{sourceType:'tutor',subject:'数学',knowledgePoint:'线面角',microSkill:'夹角关系转换',caseId:'case-1',evidence}});
  assert.equal(result.created.length,0);
  assert.equal(result.merged.length,1);
  assert.equal(result.cards[0].recurrenceCount,2);
  assert.equal(result.cards[0].starredAsRecurring,true);
  assert.equal(result.cards[0].favorite,true);
  assert.ok(result.cards[0].evidenceRefs.includes('turn-1'));
  assert.ok(result.cards[0].sourceCaseIds.includes('case-1'));
  assert.equal(result.cards[0].reviewSchedule.dueAt,'2026-08-21T00:00:00.000Z');
});

test('闯关正误会明确更新掌握证据和下一次复习时间', () => {
  const engine=createKnowledgeCardEngine({clock:()=> '2026-08-21T00:00:00.000Z',generateCandidates:async()=>[]});
  const base={id:'card-1',masteryStatus:'learning',reviewSchedule:{dueAt:'2026-08-21T00:00:00.000Z',intervalDays:0,streak:0,lastResult:null}};
  const wrong=engine.review({card:base,correctness:'incorrect',studentAnswer:'用余弦',feedback:'这里应先判断余角关系'});
  assert.equal(wrong.card.reviewSchedule.intervalDays,1);
  assert.equal(wrong.card.reviewSchedule.dueAt,'2026-08-22T00:00:00.000Z');
  assert.equal(wrong.card.masteryStatus,'learning');
  const partial=engine.review({card:wrong.card,correctness:'partial',studentAnswer:'两个角互余',feedback:'还要说明正弦余弦如何转换'});
  assert.equal(partial.card.reviewSchedule.intervalDays,3);
  let current=partial.card;
  for(let index=0;index<3;index+=1)current=engine.review({card:current,correctness:'correct',studentAnswer:'先判断余角再选函数',feedback:'正确'}).card;
  assert.equal(current.reviewSchedule.intervalDays,14);
  assert.equal(current.masteryStatus,'mastered');
});
