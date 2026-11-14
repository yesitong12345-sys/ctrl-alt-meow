import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const reservePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const {port}=server.address();server.close(()=>resolve(port))})});
const waitFor=async(base)=>{for(let attempt=0;attempt<80;attempt+=1){try{if((await fetch(`${base}/health`)).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,50))}throw new Error('server did not start')};
const json=async(response)=>({status:response.status,body:await response.json()});

async function startFixture(t,{withModel=true}={}){
  const port=await reservePort(),modelPort=await reservePort(),tempDir=await mkdtemp(path.join(os.tmpdir(),'edu-cards-'));
  let modelServer;
  if(withModel){
    modelServer=http.createServer(async(req,res)=>{
      let raw='';for await(const chunk of req)raw+=chunk;
      const payload=JSON.parse(raw),system=String(payload.messages?.[0]?.content||''),user=JSON.parse(payload.messages?.at(-1)?.content||'{}');
      let result;
      if(system.includes('知识卡片闯关评阅'))result={correctness:'correct',feedback:'这一步做对了：你已经准确说出了关键转换关系。'};
      else if(system.includes('独立证据审查员'))result={acceptedIndexes:(user.cards||[]).map((_,index)=>index),reasons:[]};
      else if(system.includes('个性化知识卡片')){const evidence=user.evidence?.[0],chemistry=user.subject==='化学';result=user.question==='非法卡'?{cards:[{cardKind:'无效',title:'凭空生成',challengePrompt:'无关问题',insight:'无证据结论',evidenceRefs:['missing'],sourceQuotes:['不存在'] }]}:{cards:evidence?[chemistry?{cardKind:'守恒检查',title:'氧化还原先查电子守恒',challengePrompt:'氧化还原反应先检查什么？',insight:'氧化还原反应要检查电子守恒。',evidenceRefs:[evidence.id],sourceQuotes:[evidence.quote.slice(0,40)]}:{cardKind:'条件联想',title:'辨认正弦与余弦的转换',challengePrompt:'遇到线面角时，怎样判断使用正弦还是余弦？',insight:'先判断线与法向量夹角和线面角是否互余，再选择三角函数。',evidenceRefs:[evidence.id],sourceQuotes:[evidence.quote.slice(0,40)]}]:[]}}
      else result={understanding:'学生正在说明自己的思路。',intent:'attempt',completionLevel:'attempted',correctness:'partial',explanation:'方向有价值，但还需要写出角之间的关系。',nextQuestion:'这两个角是什么关系？',directAnswer:''};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
    });
    await new Promise(resolve=>modelServer.listen(modelPort,'127.0.0.1',resolve));
  }
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),DATA_FILE:path.join(tempDir,'data.json'),MODEL_CONFIG_FILE:path.join(tempDir,'model.json'),DEEPSEEK_ENDPOINT:`http://127.0.0.1:${modelPort}`,DEEPSEEK_API_KEY:withModel?'sk-test-card-service':'',DEEPSEEK_MODEL:'test'},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();if(modelServer)await new Promise(resolve=>modelServer.close(resolve));await rm(tempDir,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${port}`;await waitFor(base);return base;
}

test('完成陪练自动生成证据卡，重复完成保持幂等并支持闯关持久化',async t=>{
  const base=await startFixture(t);
  const created=await json(await fetch(`${base}/v1/tutor/sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({caseId:'case-card',context:{question:'求线面角的正弦值',knowledgePoints:['线面角'],microSkill:'夹角转换'},initialStudentMessage:'我不知道这里为什么要用正弦而不是余弦。'})}));
  assert.equal(created.status,201);
  const completed=await json(await fetch(`${base}/v1/tutor/sessions/${created.body.id}/events`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'complete'})}));
  assert.equal(completed.body.knowledgeCardGeneration.status,'completed',completed.body.knowledgeCardGeneration.error);
  const firstList=await (await fetch(`${base}/v1/knowledge-cards`)).json();
  assert.equal(firstList.length,1);assert.deepEqual(firstList[0].sourceQuotes,['我不知道这里为什么要用正弦而不是余弦。']);
  assert.equal(firstList[0].user_id,'local-student');
  await fetch(`${base}/v1/tutor/sessions/${created.body.id}/knowledge-cards`,{method:'POST'});
  const secondList=await (await fetch(`${base}/v1/knowledge-cards`)).json();assert.equal(secondList.length,1);
  const cardId=secondList[0].id;
  const reviewRequest=()=>fetch(`${base}/v1/knowledge-cards/${cardId}/reviews`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({studentAnswer:'先看两个角是否互余，再决定 sin 或 cos。',selfRating:'unsure',attemptId:'attempt-one'})}).then(json);
  const [reviewed,concurrentReplay]=await Promise.all([reviewRequest(),reviewRequest()]);
  assert.equal(reviewed.status,201);assert.equal(concurrentReplay.status,201);assert.equal(reviewed.body.review.correctness,'correct');assert.equal(reviewed.body.card.reviewSchedule.intervalDays,3);
  assert.equal(reviewed.body.review.user_id,'local-student');
  assert.equal(reviewed.body.review.selfRating,'unsure');
  assert.equal(reviewed.body.review.cardId,cardId);
  const replayed=await json(await fetch(`${base}/v1/knowledge-cards/${cardId}/reviews`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({studentAnswer:'先看两个角是否互余，再决定 sin 或 cos。',attemptId:'attempt-one'})}));
  assert.equal(replayed.status,200);assert.equal(replayed.body.replayed,true);assert.equal(replayed.body.card.reviewSchedule.intervalDays,3);assert.equal(replayed.body.card.reviewSchedule.streak,1);
  const edited=await json(await fetch(`${base}/v1/knowledge-cards/${cardId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({favorite:true,title:'我修改后的卡片标题',subject:'物理',knowledgePoint:'静电场',frontContent:'正面提示：先判断电场方向。',backContent:'背面答案：沿电场方向电势降低。'})}));
  assert.equal(edited.status,200);assert.equal(edited.body.title,'我修改后的卡片标题');assert.equal(edited.body.subject,'物理');assert.equal(edited.body.frontContent,'正面提示：先判断电场方向。');assert.equal(edited.body.backContent,'背面答案：沿电场方向电势降低。');assert.equal(edited.body.insight,'背面答案：沿电场方向电势降低。');
  const favorites=await (await fetch(`${base}/v1/knowledge-cards?favorite=true`)).json();assert.equal(favorites.length,1);
  const removed=await json(await fetch(`${base}/v1/knowledge-cards/${cardId}`,{method:'DELETE'}));
  assert.equal(removed.status,200);assert.equal((await (await fetch(`${base}/v1/knowledge-cards`)).json()).length,0);
});

test('文本笔记保留真实引文；模型不可用时只保留可重试任务',async t=>{
  const base=await startFixture(t);
  const source=await json(await fetch(`${base}/v1/note-sources`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceType:'md',title:'线面角笔记',subject:'数学',knowledgePoint:'线面角',content:'线面角与直线和法向量的夹角互余，选择三角函数前先判断角的关系，再决定使用正弦还是余弦。'})}));
  assert.equal(source.status,201);
  const [generated,concurrent]=await Promise.all([
    fetch(`${base}/v1/note-sources/${source.body.id}/knowledge-cards`,{method:'POST'}).then(json),
    fetch(`${base}/v1/note-sources/${source.body.id}/knowledge-cards`,{method:'POST'}).then(json)
  ]);
  assert.equal(generated.status,200,generated.body.job?.error);assert.equal(concurrent.status,200);assert.equal(generated.body.cards.length,1);assert.match(generated.body.cards[0].sourceQuotes[0],/线面角/);
  assert.equal(generated.body.cards[0].recurrenceCount,1,'并发请求必须复用同一生成任务，不能把自己误判为重复卡点');

  const mathSource=await (await fetch(`${base}/v1/note-sources`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceType:'paste',title:'第二份数学笔记',subject:'数学',knowledgePoint:'线面角',content:'线面角先判断正弦与余弦的关系。'})})).json();
  const chemSource=await (await fetch(`${base}/v1/note-sources`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceType:'paste',title:'化学笔记',subject:'化学',knowledgePoint:'氧化还原',content:'氧化还原反应先检查电子守恒。'})})).json();
  await Promise.all([
    fetch(`${base}/v1/note-sources/${mathSource.id}/knowledge-cards`,{method:'POST'}),
    fetch(`${base}/v1/note-sources/${chemSource.id}/knowledge-cards`,{method:'POST'})
  ]);
  const allCards=await (await fetch(`${base}/v1/knowledge-cards`)).json();
  assert.equal(allCards.length,2,'不同来源并发生成时不能后写覆盖先写卡片');

  const invalidSource=await (await fetch(`${base}/v1/note-sources`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceType:'paste',title:'非法卡',content:'一段真实内容。'})})).json();
  const invalid=await json(await fetch(`${base}/v1/note-sources/${invalidSource.id}/knowledge-cards`,{method:'POST'}));
  assert.equal(invalid.status,503);assert.equal(invalid.body.job.status,'failed');assert.equal(invalid.body.job.retryable,true);

  const offlineBase=await startFixture(t,{withModel:false});
  const offlineSource=await (await fetch(`${offlineBase}/v1/note-sources`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceType:'paste',title:'保留输入',content:'这段真实笔记在模型不可用时也不能丢失。'})})).json();
  const failed=await json(await fetch(`${offlineBase}/v1/note-sources/${offlineSource.id}/knowledge-cards`,{method:'POST'}));
  assert.equal(failed.status,503);assert.equal(failed.body.job.status,'failed');assert.equal(failed.body.job.retryable,true);assert.equal(failed.body.cards.length,0);
});
