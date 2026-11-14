import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('tetra-coplanarity');
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],along=(a,b,t)=>a.map((v,i)=>v+t*(b[i]-v)),close=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('new S02 proof defines its assumed plane, uses distinct points and has four complete segments',()=>{
 assert.equal(q.steps.length,4);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);assert(q.conditions[0].includes('非退化'));for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.why&&s.result&&s.point&&s.work.length);}assert(q.steps[0].work.join('').includes('假设存在平面π'));assert(q.steps[1].work.join('').includes('A、M不同'));assert(q.steps[2].work.join('').includes('C、N不同'));assert(!/undefined|NaN|Infinity/.test(lib.mathDetail('math-tetra-coplanarity')));
});
test('mixed product independently proves skew for all tested nondegenerate tetrahedra and interior ratios',()=>{
 for(const D of [[0,0,4],[1,-2,3],[10,8,-2]])for(const t of [.1,.5,.9])for(const u of [.2,.5,.8]){const A=[0,0,0],B=[4,0,0],C=[0,4,0],M=along(A,B,t),N=along(C,D,u),det=dot(sub(C,A),cross(sub(N,A),sub(M,C)));assert(Math.abs(det)>1e-9);const whole=dot(sub(B,A),cross(sub(C,A),sub(D,A)));close(Math.abs(det),t*u*Math.abs(whole));}
});
test('endpoint counterexample intersects at A and therefore cannot use the distinct-point argument',()=>{
 const A=[0,0,0],C=[0,4,0],D=[0,0,4],M=A,N=along(C,D,.5);assert.deepEqual(M,A);assert.deepEqual(along(A,N,0),A);assert.deepEqual(along(C,M,1),A);assert(q.counter.answer.includes('两个不同点'));
});
test('projection crossing has no invented intersection point and all labels stay in the figure',()=>{
 const labels=new Set(['A','B','C','D','M','N']);assert.deepEqual(new Set(Object.keys(q.mesh.points)),labels);for(const s of q.steps){const svg=lib.mathFigure(q,s.visual);assert(!/undefined|NaN|Infinity/.test(svg));assert(!svg.includes('>X</text>'));for(const [name,p] of Object.entries(q.mesh.points)){const pr=q.mesh.projection,xy=pr.origin.map((v,i)=>v+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]),offset=q.mesh.labels[name]||[8,-9];assert(xy[0]+offset[0]>0&&xy[0]+offset[0]<440);assert(xy[1]+offset[1]>0&&xy[1]+offset[1]<320);}}
});
test('section A/L labels have sufficient separation after visual QA, and source counts remain unchanged',()=>{
 const section=lib.getMathLesson('tetra-parallel-section'),m=section.mesh,pr=m.projection,position=name=>{const p=m.points[name],o=m.labels[name];return pr.origin.map((v,i)=>v+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]+o[i]);},A=position('A'),L=position('L');assert(Math.hypot(A[0]-L[0],A[1]-L[1])>=35);for(const id of ['cube-skew','cube-angle-translate'])assert(lib.getMathLesson(id).related.some(r=>r.id===q.id));assert(lib.mathNodes.find(n=>n.id==='S02').lessons.includes(q.id));
 const html=lib.mathResources();assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
