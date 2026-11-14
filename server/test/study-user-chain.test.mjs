import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {toKnowledgeCard} from '../workflows/my-understanding.mjs';

const reservePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const assigned=server.address().port;server.close(()=>resolve(assigned))})});
const post=(base,route,body)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('知识卡创建保留学生选择的正面提示与 AI 陪练背面',()=>{
  const card=toKnowledgeCard({
    text:'AI 陪练：先判断目标角与法向量夹角的关系，再选择正弦或余弦。',
    frontContent:'题目：求线面角。\n知识点：线面角与法向量夹角互余。',
    backContent:'AI 陪练：先判断目标角与法向量夹角的关系，再选择正弦或余弦。',
    knowledgePoint:'线面角'
  });
  assert.equal(card.frontContent,'题目：求线面角。\n知识点：线面角与法向量夹角互余。');
  assert.equal(card.backContent,'AI 陪练：先判断目标角与法向量夹角的关系，再选择正弦或余弦。');
  assert.equal(card.content,card.backContent);
  assert.equal(card.insight,card.backContent);
});

test('归纳复习接口复用已解析请求，并为卡片与复习记录写入同一 user_id',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'edu-study-owner-'));
  const port=await reservePort();
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,PORT:String(port),DATA_FILE:path.join(temp,'data.json'),AUTH_REQUIRED:'0'},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{child.kill();await rm(temp,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${port}`;
  for(let n=0;n<100;n++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,50))}
  const saved=await post(base,'/v1/study/understanding',{text:'我现在知道线面角要先找投影，再判断直线与投影的夹角。',
    subject:'数学',knowledgePoint:'线面角',studentId:'forged-student',
    frontContent:'原题：求线面角。\n知识点：线面角与法向量夹角互余。\n引导：先找斜线在平面内的射影。',
    backContent:'AI 陪练：先判断目标角与法向量夹角的关系，再决定使用正弦还是余弦。'});
  assert.equal(saved.status,201);
  const card=(await saved.json()).card;
  assert.equal(card.user_id,'local-student');
  assert.equal(card.studentId,'local-student');
  assert.equal(card.frontContent,'原题：求线面角。\n知识点：线面角与法向量夹角互余。\n引导：先找斜线在平面内的射影。');
  assert.equal(card.backContent,'AI 陪练：先判断目标角与法向量夹角的关系，再决定使用正弦还是余弦。');
  assert.equal(card.insight,card.backContent);
  const listed=await (await fetch(base+'/v1/knowledge-cards')).json();
  assert.ok(listed.some(item=>item.id===card.id),'刚保存的知识卡应立刻出现在个人知识卡库');
  const quiz=await (await fetch(base+'/v1/study/rolling-quiz?subject=数学')).json();
  const quizCard=quiz.items.find(item=>item.ref_id===card.id);
  assert.ok(quizCard,'刚保存的卡应立即进入卡片闯关队列');
  assert.equal(quizCard.front.cue,card.frontContent,'闯关正面必须原样显示用户勾选并保存的原题和知识点');
  const rated=await post(base,'/v1/study/review',{cardId:card.id,rating:3});
  assert.equal(rated.status,201,await rated.text());
  const persisted=JSON.parse(await readFile(path.join(temp,'data.json'),'utf8'));
  const review=persisted.knowledgeCardReviews.find(item=>item.cardId===card.id);
  assert.equal(review.user_id,'local-student');
  assert.equal(review.studentId,'local-student');
});
