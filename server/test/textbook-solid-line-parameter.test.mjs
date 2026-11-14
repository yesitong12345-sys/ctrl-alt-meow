import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('vector-line-parameter'),p=q.parameterPoints;
const sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b)=>a.map((x,i)=>x+b[i]),mul=(k,a)=>a.map(x=>k*x||0),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],close=(a,b)=>assert(Math.abs(a-b)<1e-9),u=sub(p.B,p.A),at=t=>add(p.A,mul(t,u));
test('full six-stage path proves parameter equivalence before restricting the segment',()=>{
 assert.equal(q.steps.length,6);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.work.length>=3&&s.why&&s.hint&&s.point&&s.result);}
 assert(q.steps[1].work.join('').includes('当且仅当'));assert(q.steps[1].work.join('').includes('(1−t)+t=1'));assert(q.steps[2].work.join('').includes('当且仅当0≤t≤1'));assert(q.trap.includes('A=B'));assert(q.counter.answer.includes('并非在所有特殊点位'));
});
test('independent cross products and distance additivity verify collinearity and the segment range',()=>{
 assert.deepEqual(u,[4,2,-2]);assert(norm(u)>0);for(const t of [-3,-.5,0,.25,.5,1,1.5,2,4]){const x=at(t);close(norm(cross(sub(x,p.A),u)),0);close(norm(sub(x,p.A)),Math.abs(t)*norm(u));close(norm(sub(x,p.B)),Math.abs(1-t)*norm(u));const excess=norm(sub(x,p.A))+norm(sub(x,p.B))-norm(u);if(t>=0&&t<=1)close(excess,0);else assert(excess>0);}
 assert.deepEqual(at(0),p.A);assert.deepEqual(at(1),p.B);close(norm(sub(p.A,p.A)),0);
});
test('midpoint, exterior collinear point and off-line point satisfy different independent geometric tests',()=>{
 assert.deepEqual(at(.5),p.M);assert.deepEqual(p.M,mul(.5,add(p.A,p.B)));assert.equal(p.M[2],0);close(norm(sub(p.M,p.A)),norm(sub(p.B,p.M)));
 assert.deepEqual(at(1.5),p.Q);close(norm(cross(sub(p.Q,p.A),u)),0);assert(norm(sub(p.Q,p.A))>norm(u));assert(norm(cross(sub(p.R,p.A),u))>0);assert.notDeepEqual(at(.5),p.R);
});
test('transfer and arbitrary position-vector sum cannot silently bypass the range or common scalar',()=>{
 const t=(-3-p.A[2])/u[2];assert.equal(t,2);assert.deepEqual(at(t),[9,5,-3]);assert(t>1);assert(q.transfer.answer.includes('线段上不存在'));
 const s=add(p.A,p.B);assert.deepEqual(s,[6,4,0]);assert(norm(cross(sub(s,p.A),u))>0);
 const shift=[7,-2,5],a=add(p.A,shift),b=add(p.B,shift);for(const t of [-1,0,.4,1,3])assert.deepEqual(add(mul(1-t,a),mul(t,b)).map(x=>Math.round(x*1e8)),add(at(t),shift).map(x=>Math.round(x*1e8)));
});
test('diagrams separate parameter axis from spatial projection and reveal new points only when defined',()=>{
 for(const stage of [0,1,2,3,4,5,6]){const svg=lib.mathFigure(q,{stage},stage===0);assert(!/undefined|NaN|Infinity/.test(svg));assert.equal(svg.includes('>M</text>'),stage===4);assert.equal(svg.includes('>P</text>'),stage===2);assert.equal(svg.includes('>t</text>'),stage>=2);if(stage>=2)assert(svg.includes('不是空间点坐标轴'));if(stage===0)assert(!svg.includes('fill="#075D49"'));for(const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"/g)){assert(+m[1]>0&&+m[1]<460);assert(+m[2]>0&&+m[2]<340);}}
 const showQ=lib.mathFigure(q,q.steps[4].visual);assert(showQ.includes('d="M240 170L310 160" stroke="#075D49"'));assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('directory nodes, bidirectional prerequisites and eight-card route preserve real source counts',()=>{
 for(const id of ['S09','S10','S12'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(q.id));for(const id of ['vector-add-subtract-scale','pyramid-dynamic'])assert(lib.getMathLesson(id).related.some(r=>r.id===q.id));for(const r of q.related)assert(lib.getMathLesson(r.id));
 const html=lib.mathDirectory(),route=html.match(/data-math-learning-route="vector-preparation"[\s\S]*?<\/section>/)[0];assert.equal((route.match(/data-open-method=/g)||[]).length,12);assert(route.indexOf('math-vector-add-subtract-scale')<route.indexOf('math-'+q.id));assert(route.indexOf('math-'+q.id)<route.indexOf('math-prism-orthogonal-axes'));assert.equal((html.match(/data-open-method="review-/g)||[]).length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
