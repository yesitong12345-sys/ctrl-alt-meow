import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),ids=['cube-angle-translate','tetra-parallel-section'];
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),norm=v=>Math.sqrt(dot(v,v)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],scale=(p,t)=>p.map(v=>v*t),along=(P,Q,t)=>P.map((v,i)=>v+t*(Q[i]-v)),vol=(P,A,B,C)=>Math.abs(dot(sub(A,P),cross(sub(B,P),sub(C,P))))/6;
test('two new original paths provide ten justified segments, transfers and counterexamples',()=>{
 assert.equal(ids.reduce((n,id)=>n+lib.getMathLesson(id).steps.length,0),10);for(const id of ids){const q=lib.getMathLesson(id);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.result&&s.point&&s.work.length);}const html=lib.mathDetail('math-'+id);assert(!/undefined|NaN|Infinity/.test(html));assert(!html.includes('href="http'));for(const r of q.related)assert(lib.getMathLesson(r.id));}
});
test('translation angle and geometric triangle lengths agree with independent vector calculations',()=>{
 for(const [a,b,h,expected] of [[2,2,2,.5],[2,4,2,1/Math.sqrt(10)]]){const A=[0,0,0],B=[a,0,0],C=[a,b,0],Ap=[0,0,h],Cp=[a,b,h],u=sub(C,A),v=sub(B,Ap);close(norm(cross(u,sub(Cp,Ap))),0);const lengths=[norm(v),norm(sub(Cp,Ap)),norm(sub(Cp,B))],cosine=(lengths[0]**2+lengths[1]**2-lengths[2]**2)/(2*lengths[0]*lengths[1]);close(cosine,expected);close(Math.abs(dot(u,v))/(norm(u)*norm(v)),expected);if(a===b)for(const length of lengths)close(length,2*Math.sqrt(2));}
});
test('section is exactly the closed triangle for variable apex positions and both ratios',()=>{
 const A=[0,0,0],B=[6,0,0],C=[0,8,0];for(const P of [[1,1,9],[0,0,9],[10,-4,5]])for(const t of [.5,1/3]){const M=along(P,A,t),N=along(P,B,t),K=along(P,C,t),n=cross(sub(N,M),sub(K,M));assert(norm(n)>0);close(norm(cross(n,[0,0,1])),0);close(norm(cross(sub(N,K),sub(B,C))),0);close(norm(cross(sub(M,N),sub(A,B))),0);close(norm(cross(sub(M,K),sub(A,C))),0);const area=norm(cross(sub(N,M),sub(K,M)))/2;close(area,24*t*t);close(M[2],P[2]*(1-t));assert(M[2]>0&&M[2]<P[2]);close((P[2]-M[2])/P[2],t);close(vol(P,M,N,K)/vol(P,A,B,C),t**3);}
 close(24*.25,6);close(24/9,8/3);
});
test('removing plane-parallel condition really allows a different third-edge intersection',()=>{
 const P=[1,1,9],A=[0,0,0],B=[6,0,0],C=[0,8,0],M=along(P,A,.5),N=along(P,B,.5),K=along(P,C,.75);assert(norm(cross(sub(N,K),sub(B,C)))>0);close(vol(P,M,N,K)/vol(P,A,B,C),3/16);assert.notEqual(3/16,1/8);
});
test('section vertices and feet are revealed only at the defining step, diagrams remain finite and bounded',()=>{
 for(const id of ids){const q=lib.getMathLesson(id);for(const s of q.steps)if(s.visual){assert(!/undefined|NaN|Infinity/.test(lib.mathFigure(q,s.visual)));for(const p of Object.values(q.mesh.points)){const pr=q.mesh.projection,a=pr.origin.map((v,i)=>v+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]);assert(a[0]>=20&&a[0]<=420&&a[1]>=28&&a[1]<=304);}}}
 const q=lib.getMathLesson(ids[1]);assert(!lib.mathFigure(q,{stage:0}).includes('>K</text>'));assert(!lib.mathFigure(q,q.steps[0].visual).includes('>K</text>'));assert(lib.mathFigure(q,q.steps[1].visual).includes('>K</text>'));assert(!lib.mathFigure(q,q.steps[3].visual).includes('>H</text>'));assert(lib.mathFigure(q,q.steps[4].visual).includes('>H</text>'));
});
test('method contrasts preserve prior cards and do not inflate the 13-question source ledger',()=>{
 assert(lib.getMathLesson('cube-angle').related.some(r=>r.id===ids[0]));assert(lib.getMathLesson('tetra-parallel').related.some(r=>r.id===ids[1]));assert(lib.getMathLesson('tetra-parallel').related.some(r=>r.id==='cube-parallel-planes'));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);const html=lib.mathResources();assert(html.includes('351段'));assert(html.includes('44道原创课内题'));assert(html.includes('13/13道已录入完整解答'));assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);
});
