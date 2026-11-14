import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('vector-plane-triangle-region'),p=q.regionPoints;
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),close=(a,b)=>assert(Math.abs(a-b)<1e-9),u=sub(p.B,p.A),v=sub(p.C,p.A),n=cross(u,v),at=(s,t)=>p.A.map((a,i)=>a+s*u[i]+t*v[i]),area=(a,b,c)=>norm(cross(sub(b,a),sub(c,a)))/2;
test('seven full segments prove both directions and retain origin, edge and vertex cases',()=>{
 assert.equal(q.steps.length,7);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.work.length>=3&&s.why&&s.hint&&s.point&&s.result);}
 assert(q.steps[2].work.join('').includes('若r=0'));assert(q.steps[3].work.join('').includes('若P=A'));assert(q.steps[3].work.join('').includes('既充分又必要'));assert(q.steps[3].work.join('').includes('在顶点可同时成立'));
});
test('independent signed edge tests agree with the parameter inequalities across plane samples',()=>{
 assert(norm(n)>0);for(const s of [-.5,0,.25,.5,1,1.5])for(const t of [-.5,0,.25,.5,1,1.5]){const x=at(s,t);close(dot(n,sub(x,p.A)),0);const signed=[[p.A,p.B],[p.B,p.C],[p.C,p.A]].map(([a,b])=>dot(cross(sub(b,a),sub(x,a)),n));assert.equal(signed.every(z=>z>=-1e-9),s>=0&&t>=0&&s+t<=1);}
 for(const [s,t,point] of [[0,0,p.A],[1,0,p.B],[0,1,p.C]])assert.deepEqual(at(s,t),point);
});
test('subtriangle areas independently distinguish the inside point, exterior coplanar point and off-plane point',()=>{
 const total=area(p.A,p.B,p.C),weights=x=>[area(x,p.B,p.C),area(p.A,x,p.C),area(p.A,p.B,x)].map(a=>a/total);close(total,6*Math.sqrt(2));
 close(dot(n,sub(p.M,p.A)),0);const m=weights(p.M);for(let i=0;i<3;i++)close(m[i],[5/12,1/4,1/3][i]);close(m.reduce((a,b)=>a+b,0),1);
 close(dot(n,sub(p.Q,p.A)),0);close(weights(p.Q).reduce((a,b)=>a+b,0),2.5);assert.notEqual(dot(n,sub(p.R,p.A)),0);
});
test('boundary transfer and dependent-direction counterexample preserve the missing assumptions',()=>{
 const mid=p.B.map((x,i)=>(x+p.C[i])/2);assert.deepEqual(mid,[3,2.5,2.5]);assert.deepEqual(at(.5,.5),mid);assert(q.transfer.answer.includes('不是内点'));
 const dependent=[0,1,2].map(i=>2*u[i]);close(norm(cross(u,dependent)),0);const combine=(s,t)=>u.map((x,i)=>s*x+t*dependent[i]);assert.deepEqual(combine(1,0),combine(-1,1));assert(norm(cross(sub(p.M,p.A),u))>0);assert(q.counter.answer.includes('参数不唯一'));
});
test('diagrams explicitly separate parameter and spatial views and never assign R a valid parameter',()=>{
 for(const stage of [0,1,2,3,4,5,6,7]){const svg=lib.mathFigure(q,{stage},stage===0);assert(!/undefined|NaN|Infinity/.test(svg));if([0,1,7].includes(stage)){assert(svg.includes('空间投影'));assert(!svg.includes('>s</text>'));}else{assert(svg.includes('不是空间直角坐标图'));assert(svg.includes('>s</text>'));assert(!svg.includes('>R</text>'));}assert.equal(svg.includes('>L</text>'),stage===2);assert.equal(svg.includes('>K</text>'),stage===3||stage===4);for(const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"/g)){assert(+m[1]>0&&+m[1]<460);assert(+m[2]>0&&+m[2]<340);}}
 assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('nodes, prior cards and ten-entry route reach the new method without inflating exam frequency',()=>{
 for(const id of ['S09','S10','S12'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(q.id));for(const id of ['vector-line-parameter','plane-normal-distance'])assert(lib.getMathLesson(id).related.some(r=>r.id===q.id));for(const r of q.related)assert(lib.getMathLesson(r.id));
 const html=lib.mathDirectory(),route=html.match(/data-math-learning-route="vector-preparation"[\s\S]*?<\/section>/)[0];assert.equal((route.match(/data-open-method=/g)||[]).length,12);assert(route.indexOf('math-vector-noncoplanar-basis')<route.indexOf('math-'+q.id));assert(route.indexOf('math-'+q.id)<route.indexOf('math-prism-orthogonal-axes'));assert.equal((html.match(/data-open-method="review-/g)||[]).length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
