import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('normal-scale-distance'),p=q.normalPoints;
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),norm=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('parameter bridge gives full question, legal parameter, absolute values and foot construction',()=>{
 assert.equal(q.steps.length,5);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);
 for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.why&&s.hint&&s.result&&s.point&&s.work.length>=3);}
 assert(q.steps[1].work.join('').includes('等价于t≠0'));assert(q.steps[2].work.join('').includes('3|t|'));assert(q.steps[3].work.join('').includes('例子只是直观复核'));assert(q.steps[4].work.join('').includes('H=(λ,2λ,2λ)'));
});
test('positive and negative nonzero scales preserve normality and unsigned distance',()=>{
 const a=sub(p.B,p.A),b=sub(p.C,p.A);assert(norm(cross(a,b))>0);
 for(const t of [-1e6,-3,-2,-.01,1e-6,.3,1,7,1e6]){const n=[t,2*t,2*t];close(dot(n,a),0);close(dot(n,b),0);close(norm(n)/(3*Math.abs(t)),1);close(Math.abs(dot(p.A,n))/norm(n),2);}
 const z=[0,0,0];close(dot(z,a),0);close(dot(z,b),0);close(norm(z),0);assert(!Number.isFinite(Math.abs(dot(p.A,z))/norm(z)));assert(q.counter.answer.includes('0/0'));
});
test('independent equal-volume distance agrees with the foot and single-point transfer',()=>{
 const a=sub(p.B,p.A),b=sub(p.C,p.A),baseArea=norm(cross(a,b))/2,volume=p.A[0]*p.B[1]*p.C[2]/6;close(3*volume/baseArea,2);
 close(p.H[0]+2*p.H[1]+2*p.H[2],6);close(norm(p.H),2);for(let i=0;i<3;i++)close(p.H[i]/[1,2,2][i],2/3);
 const A=[9,0,0],u=sub(p.B,A),v=sub(p.C,A),n=[1,3,3];close(dot(n,u),0);close(dot(n,v),0);assert.notEqual(dot([1,2,2],u),0);
 close(3*(9*3*3/6)/(norm(cross(u,v))/2),9/Math.sqrt(19));assert(q.transfer.answer.includes('9/√19'));
});
test('opposite normal arrows have one origin and the stated 1-to-2 projected length ratio',()=>{
 const svg=lib.mathFigure(q,q.steps[3].visual),A=[366,230],heads=[...svg.matchAll(/<polygon points="([^"]+)" fill="#075D49"/g)].map(m=>m[1].split(' ').map(s=>s.split(',').map(Number)));
 assert.equal(heads.length,2);const directions=heads.map(([tip])=>sub(tip,A)),lengths=directions.map(v=>norm(v));close(lengths[1]/lengths[0],2);close(dot(directions[0],directions[1])/(norm(directions[0])*norm(directions[1])),-1);
 for(let i=0;i<2;i++){const [tip,b,c]=heads[i],base=b.map((v,k)=>(v+c[k])/2);assert(dot(sub(tip,base),directions[i])>0);}
});
test('diagrams keep H and parameter conclusions out of the initial and earlier stages',()=>{
 const original=lib.mathFigure(q,{stage:0},true);assert(!original.includes('>H</text>'));assert(!original.includes('t ≠ 0'));assert(!original.includes('fill="#075D49"'));
 for(let i=0;i<q.steps.length;i++){const svg=lib.mathFigure(q,q.steps[i].visual);assert(!/undefined|NaN|Infinity/.test(svg));if(i<4)assert(!svg.includes('>H</text>'));if(i<2)assert(!svg.includes('d = 6|t|'));for(const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"/g)){assert(+m[1]>0&&+m[1]<440);assert(+m[2]>0&&+m[2]<335);}}
 assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('normal-distance cards link both ways and original content does not inflate exam frequency',()=>{
 for(const id of ['S10','S11'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(q.id));assert(lib.getMathLesson('plane-normal-distance').related.some(r=>r.id===q.id));for(const r of q.related)assert(lib.getMathLesson(r.id));
 const html=lib.mathResources();assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert(html.includes('44道原创课内题'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
