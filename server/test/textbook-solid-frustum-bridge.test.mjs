import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('frustum-height-bridge');
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),distance=(a,b)=>Math.hypot(...sub(a,b)),close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('frustum bridge has full question and five consecutive segments, with real quoted evidence',()=>{
 assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);assert.equal(q.steps.length,5);
 for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.work.length>=3);assert(s.why&&s.hint&&s.result&&s.point);}
 assert(q.intro.includes('第一步从上底顶点A₁'));assert(q.steps[0].work.join('').includes('垂足记为H'));
 assert(q.steps[4].work[0].includes('E为AB中点'));assert(q.steps[4].work[1].includes('垂足为K'));
});
test('independent spatial coordinates verify side edge, projection, height and trapezoid altitude',()=>{
 const p=q.mesh.points;
 close(distance(p.A,p.B),6);close(distance(p['A₁'],p['B₁']),2);close(distance(p.A,p['A₁']),Math.sqrt(17));
 close(distance(p.A,p.H),2*Math.SQRT2);close(distance(p['A₁'],p.H),3);close(dot(sub(p.A,p.H),sub(p['A₁'],p.H)),0);
 close(distance(p.E,p.F),Math.sqrt(13));close(distance(p.F,p.K),3);close(distance(p.E,p.K),2);
 close(dot(sub(p.F,p.E),sub(p.B,p.A)),0);close(dot(sub(p.F,p.K),sub(p.E,p.K)),0);
 for(let i=0;i<3;i++){close(p.E[i],(p.A[i]+p.B[i])/2);close(p.F[i],(p['A₁'][i]+p['B₁'][i])/2);}
});
test('cross-section integration independently verifies volume and single-condition transfer',()=>{
 // Square cross-sections vary linearly in side length; Simpson integrates area exactly.
 const integrate=(bottom,top,h)=>h*(bottom**2+4*((bottom+top)/2)**2+top**2)/6;
 close(integrate(6,2,3),52);const transferHeight=Math.sqrt(24-(6-2)**2/2);close(transferHeight,4);close(integrate(6,2,transferHeight),208/3);close(Math.hypot(transferHeight,(6-2)/2),2*Math.sqrt(5));
 assert(q.transfer.answer.includes('208/3'));assert(q.transfer.answer.includes('2√5'));
 // Degenerate side-edge boundary and the impossible shorter edge.
 close((2*Math.SQRT2)**2-(6-2)**2/2,0);assert(2**2-(6-2)**2/2<0);assert(q.counter.answer.includes('不是'));
});
test('diagrams reveal auxiliary objects only after definition and labels stay in bounds',()=>{
 const initial=lib.mathFigure(q,{stage:0},true);for(const name of ['O','O₁','H','E','F','K'])assert(!initial.includes('>'+name+'</text>'));
 for(let i=0;i<q.steps.length;i++){const svg=lib.mathFigure(q,q.steps[i].visual);assert(!/NaN|Infinity|undefined/.test(svg));if(i<4)for(const name of ['E','F','K'])assert(!svg.includes('>'+name+'</text>'));}
 const pr=q.mesh.projection;for(const [name,p] of Object.entries(q.mesh.points)){const o=q.mesh.labels[name]||[8,-9],v=pr.origin.map((x,i)=>x+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]+o[i]);assert(v[0]>20&&v[0]<430,name);assert(v[1]>20&&v[1]<315,name);}
 assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('bridge and original exam link both ways without changing source frequency or chemistry',()=>{
 assert(lib.mathNodes.find(n=>n.id==='S01').lessons.includes(q.id));assert(q.related.some(r=>r.id==='exam2023-14'));assert(lib.getMathLesson('exam2023-14').related.some(r=>r.id===q.id));
 const html=lib.mathResources();assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert(html.includes('44道原创课内题'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
