import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('space-point-line-distance');
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sq=a=>dot(a,a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],close=(a,b)=>assert(Math.abs(a-b)<1e-10);
const {A,B,P,H}=l.distancePoints,u=sub(B,A),v=sub(P,A);
test('complete original defines objects before coordinates and has six natural segments',()=>{
 assert.equal(l.kind,'原创课内题');assert(!l.sourceKey);assert.equal(l.steps.length,6);assert(l.originalFigure);assert(l.conditions[2].includes('线段AB'));
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.work.length&&s.result&&s.point&&s.hint);}
 assert(l.steps[0].work.join('').includes('设H为'));assert(l.steps[1].work[0].includes('t∈R'));assert(l.steps[4].work[0].includes('0≤s≤1'));
});
test('independent cross-product area confirms point-line distance and exact foot',()=>{
 close(sq(cross(v,u))/sq(u),17);assert.deepEqual(H,A.map((x,i)=>x+1.5*u[i]));close(dot(sub(H,P),u),0);close(sq(sub(H,P)),17);close(sq(sub(B,P)),19);close(sq(v),35);
 // The closest point to the containing plane z=1 is not the closest point on AB.
 const planeFoot=[P[0],P[1],1];close(sq(sub(planeFoot,P)),9);assert(sq(cross(sub(planeFoot,A),u))>0);
});
test('all real line parameters have exact lower bound but the segment excludes its equality point',()=>{
 for(let j=-40;j<=60;j++){const t=j/10,q=A.map((x,i)=>x+t*u[i]),distance2=sq(sub(q,P));close(distance2,8*(t-1.5)**2+17);assert(distance2>=17-1e-10);if(t>=0&&t<=1)assert(distance2>=19-1e-10);}
 assert(l.steps[3].work.join('').includes('当且仅当s=3/2'));assert(l.steps[4].work.join('').includes('当且仅当s=1'));
});
test('interior transfer, reversed endpoints and degenerate line boundary are correct',()=>{
 const p1=[1,2,3],v1=sub(p1,A),t=dot(v1,u)/sq(u),h1=A.map((x,i)=>x+t*u[i]);close(t,.5);assert.deepEqual(h1,[2,1,1]);close(sq(sub(h1,p1)),6);close(dot(sub(h1,p1),u),0);
 const rev=sub(A,B),tr=dot(sub(P,B),rev)/sq(rev);close(tr,-.5);assert.deepEqual(B.map((x,i)=>x+tr*rev[i]),H);
 assert(l.counter.answer.includes('分母为0'));assert(l.counter.answer.includes('√35'));assert(l.steps[5].work.join('').includes('H=P、距离0'));assert(l.transfer.answer.includes('8(s−1/2)²+6'));
});
test('projected diagrams reveal H and sample Q only after definition with exact coordinates',()=>{
 const original=lib.mathFigure(l,{stage:0},true),first=lib.mathFigure(l,l.steps[0].visual);assert(!original.includes('>H</text>'));assert(!first.includes('>H</text>'));assert(!original.includes('>Q</text>'));
 for(const step of l.steps.filter(s=>s.visual)){const svg=lib.mathFigure(l,step.visual);assert(!/NaN|Infinity|undefined/.test(svg));if(step.visual.stage>=2)assert(svg.includes('>H</text>'));assert.equal(svg.includes('>Q</text>'),step.visual.stage===4);}
 const segment=lib.mathFigure(l,l.steps[4].visual);assert(segment.includes('M200 236L235 222'));assert(segment.includes('stroke="#7A4510"'));assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('new route is linked from existing distance and parameter cards while all old subjects remain',()=>{
 for(const node of ['S10','S11'])assert(lib.mathNodes.find(n=>n.id===node).lessons.includes(l.id));
 for(const id of ['vector-line-parameter','plane-normal-distance','cube-skew-distance'])assert(lib.getMathLesson(id).related.some(r=>r.id===l.id));for(const r of l.related)assert(lib.getMathLesson(r.id));
 assert(lib.findCards('全部主题','垂足 线段','数学').some(c=>c.id==='math-'+l.id));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);
});
