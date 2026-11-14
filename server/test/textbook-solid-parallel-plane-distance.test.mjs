import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('parallel-plane-distance'),d=l.planeDistance;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b,k=1)=>a.map((x,i)=>x+k*b[i]),sq=a=>dot(a,a),close=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('complete coordinate extension defines six stages with prerequisites and source boundaries',()=>{
 assert.equal(l.steps.length,6);assert(!l.sourceKey);assert(l.kind.includes('坐标拓展'));assert(l.prerequisites.some(x=>x.includes('拓展衔接')));assert(l.intro.includes('不表示学校已教'));
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.work.length&&s.why&&s.result&&s.point&&s.hint);}
 assert(l.steps[1].work[0].includes('选A='));assert(l.steps[1].work[1].includes('定义H'));assert(l.steps[3].work[0].includes('任取X'));
});
test('normalization preserves whole equations and changes the naive raw-constant answer',()=>{
 const raw=[-2,-4,-4,24],normalized=raw.map(x=>x/-2);assert.deepEqual(normalized,[1,2,2,-12]);close(sq(d.normal),9);close(Math.abs(d.c2-d.c1)/Math.sqrt(sq(d.normal)),2);
 close(Math.abs(24-(-6))/3,10);assert(l.trap.includes('错误的10'));
 for(const k of [-7,-.5,.25,3])close(Math.abs(k*(d.c2-d.c1))/Math.sqrt(sq(d.normal.map(x=>k*x))),2);
});
test('both selected and arbitrary-point feet satisfy target plane and the same normal displacement',()=>{
 for(const [p,h] of [[d.A,d.H],[d.X,d.K]]){close(dot(d.normal,p),6);close(dot(d.normal,h),12);const displacement=sub(h,p);for(let i=0;i<3;i++)close(displacement[i],(2/3)*d.normal[i]);close(sq(displacement),4);}
 assert.deepEqual(d.A,[6,0,0]);close(d.H[0],20/3);close(d.H[1],4/3);close(d.H[2],4/3);
});
test('independent plane-tangent sampling proves every cross-plane connector has the fixed lower bound',()=>{
 const u=[2,-1,0],v=[2,0,-1],n=d.normal;close(dot(n,u),0);close(dot(n,v),0);let strict=0;
 for(const a of [-1,0,1])for(const b of [-1,0,1])for(const c of [-1,0,1])for(const e of [-1,0,1]){
  const x=add(add(d.A,u,a),v,b),y=add(add(d.H,u,c),v,e),xy=sub(y,x),w=add(xy,n,-2/3);close(dot(n,x),6);close(dot(n,y),12);close(dot(n,w),0);close(sq(xy),4+sq(w));assert(sq(xy)>=4-1e-9);if(sq(w)>1e-9)strict++;else close(sq(xy),4);
 }
 assert(strict>0);assert(l.steps[4].work.join('').includes('等号当且仅当w=0'));
});
test('coincident transfer and tilted-plane counterexample cannot inherit a positive plane distance',()=>{
 const transfer=[-3,-6,-6,18].map(x=>x/-3);assert.deepEqual(transfer,[1,2,2,-6]);assert(l.transfer.answer.includes('最短距离为0'));
 const gamma=[1,2,-2],S=[9,0,-1.5];close(dot(d.normal,S),6);close(dot(gamma,S),12);close(Math.abs(dot(gamma,d.A)-12)/Math.sqrt(sq(gamma)),2);assert(l.counter.answer.includes('集合间最短距离为0'));assert(l.steps[5].work[0].includes('n≠0'));
});
test('diagrams reveal auxiliary points only at their stages and all old subjects and sources survive',()=>{
 const original=lib.mathFigure(l,{stage:0},true);for(const name of ['A','H','X','K','Y'])assert(!original.includes('>'+name+'</text>'));
 for(const s of l.steps.filter(s=>s.visual)){const svg=lib.mathFigure(l,s.visual),stage=s.visual.stage;assert(!/NaN|Infinity|undefined/.test(svg));assert.equal(svg.includes('>A</text>'),stage>=2);assert.equal(svg.includes('>H</text>'),stage>=3);assert.equal(svg.includes('>K</text>'),stage===4);assert.equal(svg.includes('>Y</text>'),stage===5);assert(svg.includes('viewBox="0 0 460 340"'));}
 for(const node of ['S03','S10','S11'])assert(lib.mathNodes.find(n=>n.id===node).lessons.includes(l.id));for(const id of ['plane-normal-distance','normal-scale-distance','space-point-line-distance'])assert(lib.getMathLesson(id).related.some(r=>r.id===l.id));
 assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));assert(lib.findCards('全部主题','平行平面 垂距','数学').some(c=>c.id==='math-'+l.id));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);
});
