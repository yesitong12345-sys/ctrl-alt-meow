import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const ids=['exam2021-20','fold-hinge','pyramid-dynamic','prism-orthogonal-axes'];
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]),len=a=>Math.sqrt(dot(a,a));
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('four new full paths preserve exact condition evidence, complete explanations and central sources',()=>{
 assert.equal(ids.reduce((s,id)=>s+lib.getMathLesson(id).steps.length,0),20);
 for(const id of ids){const l=lib.getMathLesson(id);assert(l.intro&&l.transfer.answer&&l.counter.answer&&l.related.length);for(const s of l.steps){assert(l.conditions.join('；').includes(s.evidence),id+': '+s.evidence);assert(s.work.length&&s.why&&s.point&&s.result);}
 const html=lib.mathDetail('math-'+id);assert(!/undefined|NaN|Infinity/.test(html));assert.equal((html.match(/class="tb-circle-beat"/g)||[]).length,l.steps.length);assert(!html.includes('href="http'));}
 assert(lib.mathResources().includes('第3页第20题'));assert.equal(lib.getMathLesson('exam2021-20').sourceKey,'gaokao-2021-I-20');
});
test('2021 Q20: divide AD in correct direction, perpendicular section, height and volume',()=>{
 const r=Math.sqrt(3),h=1,B=[-1,0,0],C=[.5,r/2,0],D=[1,0,0],A=[0,0,h],E=A.map((v,i)=>v+(D[i]-v)/3),F=[1/3,0,0],H=[0,r/3,0];
 close(len(sub(D,E))/len(sub(E,A)),2);close(E[2],2/3);
 const BC=sub(C,B);close(dot(sub(H,F),BC),0);close(dot(sub(E,H),BC),0);close(len(sub(H,F)),2/3);
 for(let i=0;i<3;i++)close(H[i],B[i]+2*(C[i]-B[i])/3);
 close(dot(sub(E,F),sub(H,F)),0);close(E[2]/len(sub(H,F)),1);close((2*r/2/2)*h/3,r/6);
 close((r/2)*Math.tan(Math.PI/3)/3,.5);
 const volume=t=>(r/2)*((1+t)/(2*(1-t)))/3;assert(volume(.25)!==volume(.5));
});
test('folding keeps face lengths, changes cross-face length, and distinguishes 60 from 120',()=>{
 const p=lib.getMathLesson('fold-hinge').mesh.points;
 close(len(sub(p.P,p.B)),2);close(len(sub(p.A,p.B)),2);close(dot(sub(p.P,p.M),sub(p.D,p.M)),0);
 close(len(sub(p.P,p.D)),Math.sqrt(6));close(len(sub(p.A,p.D)),2*Math.sqrt(3));
 close(Math.sqrt(3)*Math.sqrt(3)/3,1);close(Math.sqrt(6-6*Math.cos(Math.PI/3)),Math.sqrt(3));
 close(Math.sqrt(3)*(Math.sqrt(3)*Math.sin(Math.PI/3))/3,Math.sqrt(3)/2);
 assert(Math.abs(Math.sqrt(6-6*Math.cos(2*Math.PI/3))-Math.sqrt(3))>1);
});
test('dynamic-point solution is unique on closed segment; replacement condition only works on extension',()=>{
 const t=16/20,E=[4*t,2*t,3-3*t],BE=sub(E,[4,0,0]);assert(t>=0&&t<=1);close(dot(BE,[4,2,0]),0);close(t/(1-t),4);
 close(dot([4*t-4,2*t,5-5*t],[4,2,0]),0);
 const u=16/12;assert(u>1);close(dot([4*u-4,2*u,3-3*u],[-4,2,0]),0);
});
test('triangular-prism axes are orthogonal but adjacent base edges are not',()=>{
 const p=lib.getMathLesson('prism-orthogonal-axes').mesh.points;
 close(dot(sub(p.C,p.M),sub(p.A,p.M)),0);close(dot(sub(p.C,p.M),sub(p['A₁'],p.A)),0);
 close(dot(sub(p.B,p.A),sub(p.C,p.A)),2);close(len(sub(p['A₁'],p.C)),Math.sqrt(13));close(3/Math.sqrt(13),3*Math.sqrt(13)/13);close(4/Math.sqrt(20),2*Math.sqrt(5)/5);
});
test('new diagrams keep labels in bounds, hide future points and use staged folding figures',()=>{
 for(const id of ids){const l=lib.getMathLesson(id);for(const s of l.steps){if(!s.visual)continue;const svg=lib.mathFigure(l,s.visual),shown=new Set([...l.mesh.given,...s.visual.show||[]]);for(const k of s.visual.hide||[])shown.delete(k);assert(!/undefined|NaN|Infinity/.test(svg));
 for(const [k,p] of Object.entries(l.mesh.points)){if(!shown.has(k)){assert(!svg.includes('>'+k+'</text>'));continue;}const pr=l.mesh.projection,v=pr.origin.map((x,i)=>x+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]);assert(v[0]>=20&&v[0]<=420&&v[1]>=28&&v[1]<=304,id+' '+k+' '+v);}}
 }
 const l=lib.getMathLesson('exam2021-20');assert(!lib.mathFigure(l,l.steps[0].visual).includes('>H</text>'));assert(lib.mathFigure(l,l.steps[4].visual).includes('>H</text>'));
 const f=lib.getMathLesson('fold-hinge');assert(!lib.mathFigure(f,f.steps[0].visual).includes('>P</text>'));assert(!lib.mathFigure(f,f.steps[1].visual).includes('>A</text>'));
});
test('five-paper index is question-deduplicated and distinguishes verified stems from complete solutions',()=>{
 const html=lib.mathResources(),keys=[...html.matchAll(/data-exam-source-key="([^"]+)"/g)].map(m=>m[1]);
 const expected={2021:[3,12,20],2022:[8,9,19],2023:[12,14,18],2024:[5,17],2025:[9,17]};
 assert.equal(keys.length,13);assert.equal(new Set(keys).size,13);
 for(const [year,numbers] of Object.entries(expected))for(const n of numbers)assert(keys.includes(`gaokao-${year}-I-${n}`));
 assert(html.includes('104道编号题'));assert(html.includes('13/13道已录入完整解答'));assert(html.includes('出现于5/5套'));assert(html.includes('跨域应用另列'));
 for(const id of ['exam17','exam2021-20'])assert(keys.includes(lib.getMathLesson(id).sourceKey));
 assert(html.includes('解析几何仍待完成逐题映射'));assert(!keys.includes('gaokao-2022-I-4'));assert(!keys.includes('gaokao-2021-I-16'));
});
