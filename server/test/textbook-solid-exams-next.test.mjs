import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const ids=['exam2021-3','exam2022-19','exam2023-14','exam2024-5'];
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]),len=a=>Math.sqrt(dot(a,a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('four exam statements keep exact givens, choices and no source footers; all 22 new segments render',()=>{
 assert.equal(ids.reduce((n,id)=>n+lib.getMathLesson(id).steps.length,0),22);
 for(const id of ids){const l=lib.getMathLesson(id),html=lib.mathDetail('math-'+id);assert(l.source&&l.sourceKey&&l.routeSummary);assert(l.transfer.answer&&l.counter.answer&&l.related.length);
  assert.equal((html.match(/class="tb-circle-beat"/g)||[]).length,l.steps.length);assert(!/undefined|NaN|Infinity/.test(html));assert(!html.includes('href="http'));
  for(const s of l.steps){assert(l.conditions.join('；').includes(s.evidence),id+': '+s.evidence);assert(s.work.length&&s.result&&s.point&&s.why);}
 }
 for(const id of ['exam2021-3','exam2024-5'])assert(/A\..+B\..+C\..+D\./.test(lib.getMathLesson(id).conditions[1]));
 const q=lib.getMathLesson('exam2022-19');assert(q.conditions[1].includes('距离'));assert(!q.steps.slice(0,2).flatMap(s=>s.work).join('').includes('AA₁=AB'));
});
test('cone net matches lateral arc, not perimeter; transfer and false-perimeter value are distinguished',()=>{
 const r=Math.sqrt(2),l=2*r;close(Math.PI*l,2*Math.PI*r);assert(l>r);close((2*Math.PI/3)*(3*r),2*Math.PI*r);
 const wrong=2*Math.PI*r/(Math.PI+2);assert(Math.abs(wrong-l)>1);assert(wrong>r&&wrong<l,'even a geometrically possible positive value can come from the wrong arc model');
});
test('2022 Q19 point-plane distance from determinant is sqrt2 before part-two assumptions',()=>{
 // A prism with arbitrary non-right base satisfies V=4 and the given sloping section area.
 // The determinant-volume formula gives the same d without using AA1=AB.
 const A=[0,0,0],B=[4,0,0],C=[4-Math.sqrt(3),1,0],A1=[0,0,2],n=cross(sub(B,A1),sub(C,A1));
 // This non-right base meets both part-one givens but not AA1=AB or the perpendicular-plane condition.
 const S=len(n)/2,V=len(cross(B,C))*A1[2]/2,d=Math.abs(dot(sub(A,A1),n))/len(n);close(V,4);close(S,2*Math.SQRT2);close(d,V/S);assert(len(B)!==len(A1));assert(dot(n,[0,1,0])!==0);
 close(4/(2*Math.sqrt(2)),Math.sqrt(2));close(8/(2*Math.sqrt(2)),2*Math.sqrt(2));
 const p=lib.getMathLesson('exam2022-19').mesh.points,n2=cross(sub(p.B,p['A₁']),sub(p.C,p['A₁']));
 close(len(n2)/2,2*Math.sqrt(2));close(Math.abs(dot(sub(p.A,p['A₁']),n2))/len(n2),Math.sqrt(2));
});
test('2022 Q19 normal constraints force C.x=a, then area and volume force a=y=2',()=>{
 for(const [a,x,y] of [[2,1,3],[3,4,2],[2,2,2]]){const n=[y,a-x,y],BA1=[-a,0,a],BC=[x-a,y,0];close(dot(n,BA1),0);close(dot(n,BC),0);assert(len(n)>0);close(dot(n,[0,1,0]),a-x);}
 const a=8/4,y=4/a;close(a,2);close(y,2);close(a*a*y/2,4);close(a*Math.SQRT2*y/2,2*Math.SQRT2);
 const p=lib.getMathLesson('exam2022-19').mesh.points;
 close(len(sub(p['A₁'],p.A)),len(sub(p.B,p.A)));close(dot(sub(p.C,p.B),sub(p.A,p.B)),0);
});
test('2022 Q19 normals give sine sqrt3/2 and the designated half-plane angle is 120, not 60',()=>{
 const p=lib.getMathLesson('exam2022-19').mesh.points,u=[0,1,-1],v=[1,0,1],BD=sub(p.D,p.B);
 close(dot(u,BD),0);close(dot(u,sub(p.A,p.B)),0);close(dot(v,BD),0);close(dot(v,sub(p.C,p.B)),0);
 close(dot(u,v)/(len(u)*len(v)),-.5);close(Math.sqrt(1-.25),Math.sqrt(3)/2);
 const H=p.B.map((x,i)=>x+2*BD[i]/3);for(let i=0;i<3;i++)close(H[i],p.H[i]);
 const HA=sub(p.A,H),HC=sub(p.C,H);close(dot(HA,BD),0);close(dot(HC,BD),0);close(dot(HA,HC)/(len(HA)*len(HC)),-.5);
 close(Math.acos(dot(HA,HC)/(len(HA)*len(HC))),2*Math.PI/3);
 assert(dot(sub(p['A₁'],p.A),sub(p.B,p['A₁']))!==0,'lateral edge is not target-plane normal');
});
test('2023 Q14 height uses a vertex projection; frustum formula matches integrated cross sections',()=>{
 const p=lib.getMathLesson('exam2023-14').mesh.points,h=p['A₁'][2];close(len(sub(p['A₁'],p.A)),Math.sqrt(2));close(len(sub(p.H,p.A)),Math.SQRT1_2);close(h,Math.sqrt(6)/2);
 const V=h*(4+1+2)/3;close(V,7*Math.sqrt(6)/6);
 // Side length decreases linearly 2 -> 1. Integral of (2-z/h)^2 is 7h/3.
 close(4*h-2*h+h/3,V);close(8*h/3-h/3,V);close(Math.sqrt(3-.5)*7/3,7*Math.sqrt(10)/6);
 assert(Math.abs(Math.sqrt(2-.25)-h)>.05);
});
test('2024 Q5 side-area identity and Pythagoras reproduce B; changing height scales volume cubically',()=>{
 const h=Math.sqrt(3),r=3,l=2*h;close(2*Math.PI*r*h,Math.PI*r*l);close(l*l,r*r+h*h);close(Math.PI*r*r*h/3,3*Math.sqrt(3)*Math.PI);
 const H=2,L=2*H,R2=L*L-H*H;close(Math.PI*R2*H/3,8*Math.PI);assert(Math.sqrt(2)!==2);
});
test('new diagrams gate auxiliary objects, keep projected labels inside, and never reveal future numbers',()=>{
 for(const id of ids){const l=lib.getMathLesson(id);for(const s of l.steps)if(s.visual){const svg=lib.mathFigure(l,s.visual);assert(svg.startsWith('<svg'));assert(!/undefined|NaN|Infinity/.test(svg));if(l.mesh){const shown=new Set([...l.mesh.given,...s.visual.show||[]]);for(const k of s.visual.hide||[])shown.delete(k);for(const [k,p] of Object.entries(l.mesh.points)){if(!shown.has(k)){assert(!svg.includes('>'+k+'</text>'));continue;}const pr=l.mesh.projection,v=pr.origin.map((n,i)=>n+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]);assert(v[0]>=20&&v[0]<=420&&v[1]>=28&&v[1]<=304,id+' '+k);}}}}
 const q=lib.getMathLesson('exam2022-19');assert(q.mesh.edges.some(([a,b])=>a==='B'&&b==='D'),'original diagram retains dihedral edge BD');assert(!lib.mathFigure(q,q.steps[0].visual).includes('>D</text>'));assert(!lib.mathFigure(q,q.steps[7].visual).includes('>H</text>'));assert(lib.mathFigure(q,q.steps[8].visual).includes('>H</text>'));
 const c=lib.getMathLesson('exam2024-5');assert(!lib.mathFigure(c,{stage:0}).includes('r=3'));assert(!lib.mathFigure(c,{stage:1}).includes('r=3'));assert(lib.mathFigure(c,{stage:2}).includes('r=3'));
 const net=lib.getMathLesson('exam2021-3');assert(!lib.mathFigure(net,{stage:1}).includes('l=2√2'));assert(lib.mathFigure(net,{stage:3}).includes('l=2√2'));
});
test('central sources link completed solid exams without changing the 13-question sample',()=>{
 const html=lib.mathResources(),keys=[...html.matchAll(/data-exam-source-key="([^"]+)"/g)].map(m=>m[1]);assert.equal(keys.length,13);assert.equal(new Set(keys).size,13);assert(html.includes('13/13道已录入完整解答'));
 for(const id of ids){const l=lib.getMathLesson(id);assert(keys.includes(l.sourceKey));assert(html.includes('data-math-next="math-'+id+'"'));}
 assert(html.includes('2026-10-22'));assert(!html.includes('三棱柱中证明线面平行'));assert(!html.includes('正四棱柱截面证明面面平行'));
 assert(!lib.mathDirectory().includes('高考综合题'));assert(lib.mathDetail('math-exam2022-19').includes('投影视角与公开题图不同'));
});
