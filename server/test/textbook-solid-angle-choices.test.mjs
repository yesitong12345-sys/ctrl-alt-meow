import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),ids=['exam2023-18','exam2025-9'];
const sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b)=>a.map((x,i)=>x+b[i]),scale=(a,k)=>a.map(x=>x*k),dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),norm=a=>Math.sqrt(dot(a,a));
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('two complete paths keep original questions, all choices and exact evidence in 14 segments',()=>{
 assert.equal(ids.reduce((n,id)=>n+lib.getMathLesson(id).steps.length,0),14);
 for(const id of ids){const l=lib.getMathLesson(id),html=lib.mathDetail('math-'+id);assert(l.sourceKey&&l.source&&l.routeSummary&&l.transfer.answer&&l.counter.answer);assert.equal((html.match(/class="tb-circle-beat"/g)||[]).length,l.steps.length);assert(!/undefined|NaN|Infinity/.test(html));assert(!html.includes('href="http'));
 for(const s of l.steps){assert(l.conditions.join('；').includes(s.evidence),id+' '+s.evidence);assert(s.work.length&&s.why&&s.point&&s.result);}}
 const q=lib.getMathLesson('exam2025-9');for(const option of ['A. AD⊥A₁C','B. BC⊥平面AA₁D','C. CC₁∥平面AA₁D','D. AD∥A₁B₁'])assert(q.conditions.includes(option));
});
test('2023 Q18 first question uses equal nonzero directions, not plane parallelism',()=>{
 const p=lib.getMathLesson('exam2023-18').mesh.points,u=sub(p['C₂'],p['B₂']),v=sub(p['D₂'],p['A₂']);assert.deepEqual(u,[0,2,1]);assert.deepEqual(u,v);assert(norm(u)>0);
 assert.equal(p['A₂'][2],1);assert.equal(p['B₂'][2],2);assert.equal(p['C₂'][2],3);assert.equal(p['D₂'][2],2);
});
test('2023 Q18: orthogonal projection is independently reconstructed over the full segment range',()=>{
 const p=lib.getMathLesson('exam2023-18').mesh.points,A=p['A₂'],u=sub(p['C₂'],A),M=scale(add(A,p['C₂']),.5),v=sub(p['D₂'],M);close(dot(v,u),0);
 for(const t of [0,.25,1,2,3,3.75,4]){const P=[2,0,t],lambda=dot(sub(P,A),u)/dot(u,u),H=add(A,scale(u,lambda)),w=sub(P,H),R=add(M,w);
 assert(lambda>=0&&lambda<=1);close(H[0],(t+1)/3);close(H[1],(t+1)/3);close(H[2],(t+4)/3);close(dot(w,u),0);assert(norm(w)>0);close(dot(sub(R,M),v),-2);
 close(dot(w,w),(2/3)*((t-2)**2+3));close(dot(w,v)/(norm(w)*norm(v)),-Math.sqrt(3)/Math.sqrt((t-2)**2+3));}
});
test('2023 Q18: both roots produce the specified 150 degrees and same unsigned distance',()=>{
 const p=lib.getMathLesson('exam2023-18').mesh.points,A=p['A₂'],u=sub(p['C₂'],A),M=scale(add(A,p['C₂']),.5),v=sub(p['D₂'],M);
 for(const t of [1,3]){assert(t>=0&&t<=4);const P=[2,0,t],H=add(A,scale(u,dot(sub(P,A),u)/dot(u,u))),w=sub(P,H);close(Math.acos(dot(w,v)/(norm(w)*norm(v))),5*Math.PI/6);close(norm(sub(P,p['B₂'])),1);}
 const R=add(M,sub(p.P,p.H));for(let i=0;i<3;i++)close(R[i],p.R[i]);assert.notDeepEqual([2,0,1],[2,0,3]);
});
test('2023 Q18 transfer rejects line-extension roots and counterexample rejects acute supplement',()=>{
 const roots=[2-3,2+3];for(const t of roots){assert(t<0||t>4);close(-Math.sqrt(3)/Math.sqrt((t-2)**2+3),Math.cos(2*Math.PI/3));}
 for(const t of [1,3]){const c=-Math.sqrt(3)/Math.sqrt((t-2)**2+3);close(c*c,Math.cos(Math.PI/6)**2);assert(c<0&&Math.cos(Math.PI/6)>0);}
 close(-Math.sqrt(3)/Math.sqrt(3),-1); // t=2 is the degenerate 180-degree half-plane arrangement.
});
test('2025 Q9 four truth values hold for arbitrary independent positive side and height',()=>{
 for(const b of [.3,1,2.5])for(const h of [.2,2,7]){const A=[0,Math.sqrt(3)*b,0],D=[0,0,0],B=[-b,0,0],C=[b,0,0],A1=add(A,[0,0,h]),B1=add(B,[0,0,h]),C1=add(C,[0,0,h]);
 const AD=sub(D,A),AC1=sub(C,A1),BC=sub(C,B),DA=sub(A,D),AA1=sub(A1,A);close(dot(AD,AC1),3*b*b);assert(dot(AD,AC1)>0);
 close(dot(BC,DA),0);close(dot(BC,AA1),0);assert(norm(DA)>0&&norm(AA1)>0);assert(C[0]!==0&&C1[0]!==0);assert.deepEqual(sub(C1,C),AA1);
 const upper=sub(B1,A1);assert(AD[0]===0&&AD[1]!==0&&upper[0]!==0);}
});
test('new mesh stages define auxiliary points before showing them and keep projections in bounds',()=>{
 for(const id of ids){const l=lib.getMathLesson(id);for(const s of l.steps)if(s.visual){const svg=lib.mathFigure(l,s.visual),shown=new Set([...l.mesh.given,...s.visual.show||[]]);for(const k of s.visual.hide||[])shown.delete(k);assert(!/undefined|NaN|Infinity/.test(svg));for(const [k,p] of Object.entries(l.mesh.points)){if(!shown.has(k)){assert(!svg.includes('>'+k+'</text>'));continue;}const pr=l.mesh.projection,v=pr.origin.map((n,i)=>n+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]);assert(v[0]>=20&&v[0]<=420&&v[1]>=28&&v[1]<=304,id+' '+k);}}}
 const l=lib.getMathLesson('exam2023-18');assert(!lib.mathFigure(l,l.steps[2].visual).includes('>H</text>'));assert(!lib.mathFigure(l,l.steps[3].visual).includes('>R</text>'));assert(lib.mathFigure(l,l.steps[4].visual).includes('>R</text>'));
});
test('central index gains exactly two full links without duplicating source questions',()=>{
 const html=lib.mathResources(),keys=[...html.matchAll(/data-exam-source-key="([^"]+)"/g)].map(m=>m[1]);assert.equal(keys.length,13);assert.equal(new Set(keys).size,13);assert(html.includes('13/13道已录入完整解答'));for(const id of ids)assert(html.includes('data-math-next="math-'+id+'"'));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert(html.includes('351段'));
});
