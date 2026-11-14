import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const ids=['exam2024-17','exam2022-9'],close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.sqrt(dot(a,a));
test('complete statements, all four choices and fifteen justified segments are available without per-card sources',()=>{
 assert.equal(ids.reduce((n,id)=>n+lib.getMathLesson(id).steps.length,0),15);
 for(const id of ids){const l=lib.getMathLesson(id),html=lib.mathDetail('math-'+id);for(const s of l.steps){assert(l.conditions.join('；').includes(s.evidence),s.evidence);assert(s.why&&s.point&&s.result&&s.work.length);}
 assert(!/undefined|NaN|Infinity/.test(html));assert(!html.includes('href="http'));assert(html.includes('迁移题解析'));assert(html.includes('不能套用的原因'));for(const r of l.related)assert(lib.getMathLesson(r.id),r.id);}
 const q=lib.getMathLesson(ids[0]);assert(q.conditions[2].includes('二面角A—CP—D'));assert(q.conditions[2].includes('√42/7'));assert(q.steps[3].work.join('').includes('不沿用第（1）问'));
 assert.equal(lib.getMathLesson(ids[1]).conditions.length,5);assert(lib.getMathLesson(ids[1]).conditions[3].includes('BB₁D₁D'));assert(lib.mathDetail('math-'+ids[1]).includes('原题未附图'));
});
test('2024 first part follows coplanar perpendiculars, while the second part does not inherit them',()=>{
 const A=[0,0,0],B=[1.5,Math.sqrt(3)/2,0],C=[2,0,0],P=[0,0,2],D1=[.5,-Math.sqrt(3)/2,0],D2=[1.5,-Math.sqrt(3)/2,0];
 close(norm(sub(B,A)),Math.sqrt(3));close(norm(sub(C,B)),1);close(dot(sub(A,B),sub(C,B)),0);
 close(dot(sub(D1,A),sub(P,B)),0);close(dot(sub(D1,A),sub(P,A)),0);close(norm(cross(sub(D1,A),sub(C,B))),0);
 close(dot(sub(D2,A),sub(C,D2)),0);assert(Math.abs(dot(sub(D2,A),sub(P,B)))>1,'second-part solution must not accidentally satisfy first-part extra condition');
 const n=cross(sub(B,P),sub(C,P));assert(Math.abs(dot(n,sub(A,P)))>1e-9,'A is outside PBC');
});
test('2024 angle independently recalculated from cross products yields the valid length and rejects degeneration',()=>{
 const C=[2,0,0],P=[0,0,2];
 for(const [x,y] of [[1.5,Math.sqrt(3)/2],[1.5,-Math.sqrt(3)/2]]){const D=[x,y,0],n=cross(sub(P,C),sub(D,C)),n0=[0,1,0];close(dot(D,sub(C,D)),0);const sine2=1-dot(n,n0)**2/dot(n,n);close(sine2,42/49);close(norm(D),Math.sqrt(3));assert(x>0&&x<2);}
 // A direct sample sweep of all Thales-circle positions independently checks the algebraic reduction.
 for(let i=1;i<200;i++){const x=i/100,y=Math.sqrt(x*(2-x)),n=cross(sub(P,C),[x-2,y,0]),sine2=1-n[1]**2/dot(n,n);close(sine2,2*x/(x+2));}
 close(norm(cross(sub(P,C),[0,0,0])),0);assert(lib.getMathLesson(ids[0]).trap.includes('D=C'));
 // Transfer value sqrt(2/3) is attainable at D=(1,-1,0).
 const D=[1,-1,0],n=cross(sub(P,C),sub(D,C));close(1-n[1]**2/dot(n,n),2/3);close(norm(D),Math.sqrt(2));
});
test('2022 cube choices retain ABD for every scale and distinguish diagonal plane from base',()=>{
 for(const a of [.1,1,2,7]){const u=[0,a,a],v=[0,-a,a],w=[-a,-a,a],n=[1,1,0];close(dot(u,v),0);close(dot(u,w),0);close(Math.abs(dot(u,n))/(norm(u)*norm(n)),.5);close(Math.asin(.5)*180/Math.PI,30);close(Math.atan(a/a)*180/Math.PI,45);const t=[a,a,a];close(Math.abs(dot(t,n))/(norm(t)*norm(n)),Math.sqrt(2/3));}
 assert(lib.getMathLesson(ids[1]).steps[5].result.includes('A、B、D'));assert(lib.getMathLesson(ids[1]).counter.answer.includes('互余'));
});
test('pyramid step-specific diagrams switch D only when the subquestion changes, with no future objects',()=>{
 for(const id of ids){const l=lib.getMathLesson(id);for(const s of l.steps)if(s.visual){const svg=lib.mathFigure(l,s.visual);assert(svg.startsWith('<svg'));assert(!/undefined|NaN|Infinity/.test(svg));const points={...l.mesh.points,...s.visual.points},pr=l.mesh.projection;for(const p of Object.values(points)){const q=pr.origin.map((v,i)=>v+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]);assert(q[0]>=20&&q[0]<=420&&q[1]>=28&&q[1]<=304);}}}
 const l=lib.getMathLesson(ids[0]);assert(l.mesh.edges.some(([a,b])=>a==='P'&&b==='C'));assert(l.mesh.edges.some(([a,b])=>a==='A'&&b==='C'));
 assert.notEqual(lib.mathFigure(l,l.steps[0].visual),lib.mathFigure(l,l.steps[3].visual));assert.notEqual(lib.mathFigure(l,l.steps[3].visual),lib.mathFigure(l,l.steps[8].visual));assert(!lib.mathFigure(l,l.steps[3].visual).includes('AD=√3'));
});
test('central index has eleven complete solid questions but still thirteen unique source entries',()=>{
 const html=lib.mathResources(),keys=[...html.matchAll(/data-exam-source-key="([^"]+)"/g)].map(m=>m[1]);assert.equal(keys.length,13);assert.equal(new Set(keys).size,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
 for(const id of ids)assert(html.includes('data-math-next="math-'+id+'"'));assert(html.includes('2026-10-22'));
});
