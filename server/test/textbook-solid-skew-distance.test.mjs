import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('cube-skew-distance');
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((x,v,i)=>x+v*b[i],0),norm=a=>Math.hypot(...a),close=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('full question and five stages separate candidate, perpendicularity, lower bound and attainment',()=>{
 assert.equal(q.steps.length,5);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);
 for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.work.length>=3&&s.why&&s.point&&s.hint);}
 assert(q.steps[2].work.join('').includes('s、t均为任意实数'));assert(q.steps[3].work.join('').includes('当且仅当'));assert(q.steps[4].work.join('').includes('两端垂足'));
});
test('independent line-to-plane projection proves every connector has fixed transverse component',()=>{
 const p=q.mesh.points,u=sub(p.B,p.A),v=sub(p['C′'],p.C),bc=sub(p.C,p.B);close(dot(u,bc),0);close(dot(v,bc),0);close(norm(bc),2);
 // Plane BCC′B′ is x=2. AB meets it at B; projection of every P on AB is B.
 // The y component of every Q-P is 2. Cauchy gives |Q-P| >= 2, attained only by BC.
 const n=[0,1,0];for(const s of [-10,0,.7,2,9])for(const t of [-7,0,1.3,2,20]){const pq=sub([2,2,t],[s,0,0]);close(dot(pq,n),2);assert(norm(pq)>=2);if(norm(pq)===2)assert(s===2&&t===0);}
 close(norm(sub(p.C,p.B)),2);
});
test('single-change cuboid transfer and one-perpendicular counterexample are independently valid',()=>{
 // Orthogonal decomposition: along AB, AD, AA′, the fixed component becomes AD=4.
 for(const s of [-11,0,3,14])for(const t of [-5,0,5,12]){const d=norm([3-s,4,t]);assert(d>=4);if(d===4)assert(s===3&&t===0);}
 assert(q.transfer.answer.includes('距离4'));const bcPrime=sub(q.mesh.points['C′'],q.mesh.points.B);close(norm(bcPrime),2*Math.sqrt(2));close(dot(bcPrime,[1,0,0]),0);assert.notEqual(dot(bcPrime,[0,0,1]),0);assert(q.counter.answer.includes('45°'));
});
test('P and Q appear only after definition and all SVG labels remain finite and in view',()=>{
 const before=[lib.mathFigure(q,{stage:0},true),...q.steps.slice(0,2).map(s=>lib.mathFigure(q,s.visual))];for(const svg of before)assert(!/>[PQ]<\/text>/.test(svg));
 for(let i=0;i<q.steps.length;i++){const svg=lib.mathFigure(q,q.steps[i].visual);assert(!/NaN|undefined|Infinity/.test(svg));assert.equal(svg.includes('>P</text>'),i===2||i===3);for(const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"/g)){assert(+m[1]>0&&+m[1]<440);assert(+m[2]>0&&+m[2]<335);}}
 assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('hidden edges match the actual upper, negative-x, negative-y viewing direction',()=>{
 const r=[62,-43,0],u=[-13,-24,-75],camera=[r[1]*u[2]-r[2]*u[1],r[2]*u[0]-r[0]*u[2],r[0]*u[1]-r[1]*u[0]].map(v=>-v);
 assert(camera[0]<0&&camera[1]<0&&camera[2]>0);assert.deepEqual(new Set(q.mesh.hidden),new Set(['B-C','C-D','C-C′']));
 const svg=lib.mathFigure(q,q.steps[1].visual);for(const ends of ['M329 234L243 186','M243 186L243 36'])assert(svg.includes('d="'+ends+'" stroke="#075D49" stroke-width="3.5" fill="none" stroke-dasharray="6 5"'));
});
test('S11 and both prerequisite cards link to the new distance lesson without changing exam frequency',()=>{
 assert(lib.mathNodes.find(n=>n.id==='S11').lessons.includes(q.id));for(const id of ['cube-skew','cube-perp'])assert(lib.getMathLesson(id).related.some(r=>r.id===q.id));for(const r of q.related)assert(lib.getMathLesson(r.id));
 const html=lib.mathResources();assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert(html.includes('44道原创课内题'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
