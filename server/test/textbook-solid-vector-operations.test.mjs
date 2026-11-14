import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('vector-add-subtract-scale'),p=q.operationPoints;
const sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(k,a)=>a.map(v=>k*v||0),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a),close=(a,b)=>assert(Math.abs(a-b)<1e-9);
const u=sub(p.B,p.A),v=sub(p.C,p.A),project=a=>[210+38*a[0]-22*a[1],250+8*a[0]-16*a[1]-48*a[2]];
test('five complete segments define operands before sum, difference and signed scaling',()=>{
 assert.equal(q.steps.length,5);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.work.length>=3&&s.why&&s.hint&&s.point&&s.result);}
 assert(q.steps[2].title.includes('从v的终点指向u的终点'));assert(q.steps[3].work.join('').includes('k=0或u=0'));assert(q.counter.answer.includes('不满足首尾相接'));
 assert(q.prerequisites.some(s=>s.includes('数量积与夹角')));
});
test('parallelogram and endpoint differences independently verify all requested vector identities',()=>{
 assert.deepEqual(sub(p.D,p.B),v);assert.deepEqual(sub(p.D,p.C),u);assert.deepEqual(add(sub(p.B,p.A),sub(p.D,p.B)),sub(p.D,p.A));assert.deepEqual(sub(p.D,p.A),[1,2,2]);
 assert.deepEqual(sub(u,v),sub(p.B,p.C));assert.deepEqual(sub(p.B,p.C),[3,-2,0]);assert.deepEqual(sub(p.E,p.A),mul(-2,u));close(norm(sub(p.E,p.A)),2*Math.sqrt(5));close(dot(u,sub(p.E,p.A)),-10);
 // Translate every point and rotate axes orthogonally: geometric identities must be unchanged.
 const transform=a=>[-a[1]+7,a[2]-4,a[0]+9],a=transform(p.A),b=transform(p.B),c=transform(p.C),d=transform(p.D),e=transform(p.E);
 assert.deepEqual(sub(d,a),add(sub(b,a),sub(c,a)));assert.deepEqual(sub(e,a),mul(-2,sub(b,a)));close(norm(sub(e,a)),2*norm(sub(b,a)));
});
test('positive-sign transfer, zero coefficients and reversed connector counterexample preserve direction',()=>{
 const ep=add(p.A,mul(2,u));assert.deepEqual(ep,[5,1,3]);close(dot(sub(ep,p.A),u),2*norm(u)**2);assert(q.transfer.answer.includes('D仍为(2,3,3)'));
 assert.deepEqual(add(u,sub(p.B,p.C)),[5,-2,1]);assert.notDeepEqual(add(u,sub(p.B,p.C)),v);
 for(const k of [-3,-2,-.5,0,.5,2,4]){const w=mul(k,u);close(norm(w),Math.abs(k)*norm(u));close(dot(w,u),k*norm(u)**2);}assert.equal(norm(mul(0,u)),0);
});
test('subtraction arrow really points C to B and negative scalar arrow has visible opposite double length',()=>{
 const diff=lib.mathFigure(q,q.steps[2].visual),C=project(p.C),B=project(p.B),A=project(p.A);assert(diff.includes('d="M'+C.join(' ')+'L'+B.join(' ')+'" stroke="#075D49"'));
 const svg=lib.mathFigure(q,q.steps[3].visual),heads=[...svg.matchAll(/<polygon points="([^"]+)" fill="#075D49"/g)].map(m=>m[1].split(' ').map(v=>v.split(',').map(Number)));assert.equal(heads.length,2);assert.deepEqual(heads[0][0],B);assert.deepEqual(heads[1][0],project(p.E));
 const a=sub(heads[0][0],A),b=sub(heads[1][0],A);close(norm(b)/norm(a),2);close(dot(a,b)/(norm(a)*norm(b)),-1);for(const head of heads){const [tip,x,y]=head,base=mul(.5,add(x,y));assert(dot(sub(tip,base),sub(tip,A))>0);}
});
test('D and E appear only after definition and diagram labels remain in the SVG bounds',()=>{
 for(const [stage,visual] of [[0,{stage:0}],...q.steps.map(s=>[s.visual.stage,s.visual])]){const svg=lib.mathFigure(q,visual,stage===0);assert(!/NaN|Infinity|undefined/.test(svg));assert.equal(svg.includes('>D</text>'),stage===2||stage===5);assert.equal(svg.includes('>E</text>'),stage>=4);if(stage===0)assert(!svg.includes('fill="#075D49"'));for(const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"/g)){assert(+m[1]>0&&+m[1]<460);assert(+m[2]>0&&+m[2]<340);}}
 assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('route and two-way prerequisite links preserve source scope and all existing subjects',()=>{
 for(const id of ['S09','S10'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(q.id));assert(lib.getMathLesson('vector-coordinates-basic').related.some(r=>r.id===q.id));for(const r of q.related)assert(lib.getMathLesson(r.id));
 const html=lib.mathDirectory(),route=html.match(/data-math-learning-route="vector-preparation"[\s\S]*?<\/section>/)[0];assert(route.indexOf('math-vector-coordinates-basic')<route.indexOf('math-'+q.id));assert(route.indexOf('math-'+q.id)<route.indexOf('math-prism-orthogonal-axes'));assert.equal((route.match(/data-open-method=/g)||[]).length,12);assert.equal((html.match(/data-open-method="review-/g)||[]).length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
