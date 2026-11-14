import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),ids=['planes-perp-criterion','planes-perp-property'];
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=v=>Math.sqrt(dot(v,v));
test('S05 has two distinct non-vector original paths with complete conditions and ten segments',()=>{
 assert.equal(ids.reduce((n,id)=>n+lib.getMathLesson(id).steps.length,0),10);
 for(const id of ids){const l=lib.getMathLesson(id);assert.equal(l.kind,'原创课内题');assert(!l.sourceKey);assert(!l.prerequisites.includes('空间向量'));for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.why&&s.work.length&&s.result&&s.point);}const html=lib.mathDetail('math-'+id);assert(!/undefined|NaN|Infinity/.test(html));assert(!html.includes('href="http'));assert(html.includes('原创课内题'));assert(html.includes('迁移题解析'));for(const related of l.related)assert(lib.getMathLesson(related.id));}
});
test('criterion proof and distance hold independently of apex height and CM length',()=>{
 for(const a of [3,5])for(const y of [.2,1,2])for(const pY of [-1,0,1])for(const h of [.5,2,4]){const A=[-a,0,0],B=[a,0,0],C=[0,y,0],P=[0,pY,h],M=[0,0,0];close(norm(sub(P,A)),norm(sub(P,B)));close(norm(sub(C,A)),norm(sub(C,B)));close(dot(sub(B,A),sub(P,M)),0);close(dot(sub(B,A),sub(C,M)),0);const nPCM=cross(P,C),nPAB=cross(sub(A,P),sub(B,P));assert(norm(nPCM)>0);close(dot(nPCM,nPAB),0);close(Math.abs(dot(A,nPCM))/norm(nPCM),a);}
});
test('deleted equal-side condition produces valid nonperpendicular 45-degree counterexample',()=>{
 const A=[-3,0,0],B=[3,0,0],M=[0,0,0],P=[0,0,2],C=[1,1,0],n1=cross(sub(A,P),sub(B,P)),n2=cross(sub(P,M),sub(C,M));close(norm(sub(P,A)),norm(sub(P,B)));assert(norm(sub(C,A))!==norm(sub(C,B)));close(Math.abs(dot(n1,n2))/(norm(n1)*norm(n2)),Math.SQRT1_2);assert(Math.abs(dot(sub(B,A),C))>0);
});
test('property identifies the correct foot and reproduces original and transfer distances',()=>{
 for(const h of [4,5]){const A=[-3,0,0],C=[3,0,0],B=[0,4,0],H=[0,0,0],P=[0,0,h],nBase=cross(sub(B,A),sub(C,A)),nSide=cross(sub(P,A),sub(C,A));close(dot(nBase,nSide),0);close(dot(sub(P,H),sub(C,A)),0);close(dot(sub(P,H),sub(B,H)),0);close(norm(sub(P,A)),Math.sqrt(9+h*h));close(Math.abs(dot(sub(P,A),nBase))/norm(nBase),h);close(norm(sub(P,B)),Math.sqrt(h*h+16));assert(dot(sub(P,A),sub(C,A))!==0,'PA is not a base normal');}
 close(Math.sqrt(25-9),4);close(Math.sqrt(34-9),5);close(Math.sqrt(32),4*Math.sqrt(2));
});
test('figures retain valid projection bounds and only connect auxiliary lines at their defined step',()=>{
 for(const id of ids){const l=lib.getMathLesson(id);for(const s of l.steps){const svg=lib.mathFigure(l,s.visual);assert(!/undefined|NaN|Infinity/.test(svg));const pr=l.mesh.projection;for(const p of Object.values(l.mesh.points)){const q=pr.origin.map((v,i)=>v+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]);assert(q[0]>=20&&q[0]<=420&&q[1]>=28&&q[1]<=304);}}}
 const q=lib.getMathLesson('planes-perp-property');assert(!q.mesh.edges.some(([a,b])=>[a,b].includes('H')));assert(!q.steps.slice(0,3).some(s=>s.visual.active.some(([a,b])=>[a,b].includes('B')&&[a,b].includes('H'))));assert(q.steps[3].visual.active.some(([a,b])=>a==='B'&&b==='H'));
});
test('new foundations are linked from existing exams but do not add source-frequency entries',()=>{
 for(const id of ids)for(const node of ['S04','S05','S11'])assert(lib.mathNodes.find(n=>n.id===node).lessons.includes(id));assert(lib.getMathLesson('exam17').related.some(r=>r.id===ids[0]));assert(lib.getMathLesson('exam2021-20').related.some(r=>r.id===ids[1]));assert(lib.getMathLesson('fold-hinge').related.some(r=>r.id===ids[1]));assert(lib.getMathLesson('exam17').related.some(r=>r.id==='cube-angle'),'original default related links preserved');
 const html=lib.mathResources();assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert(html.includes('44道原创课内题'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
