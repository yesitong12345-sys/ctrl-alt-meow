import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('vector-coordinates-basic'),p=q.vectorPoints;
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),norm=a=>Math.hypot(...a),close=(a,b)=>assert(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('beginner card defines vectors before use and covers the whole requested calculation',()=>{
 assert.equal(q.steps.length,5);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);
 for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.why&&s.hint&&s.result&&s.point&&s.work.length>=3);}
 assert(q.steps[0].work[0].includes('设u=向量AB'));assert(q.steps[1].work[0].includes('设v=向量AC'));assert(q.steps[3].work.join('').includes('均非零'));assert(q.steps[4].work.join('').includes('不能改成1/√30'));
});
test('lengths and cosine agree with an independent triangle law-of-cosines calculation',()=>{
 const u=sub(p.B,p.A),v=sub(p.C,p.A),w=sub(p.C,p.B);assert.deepEqual(u,[2,0,1]);assert.deepEqual(v,[-1,2,1]);close(dot(u,v),-1);close(norm(u),Math.sqrt(5));close(norm(v),Math.sqrt(6));
 const cosineBySides=(norm(u)**2+norm(v)**2-norm(w)**2)/(2*norm(u)*norm(v));close(cosineBySides,-1/Math.sqrt(30));assert(cosineBySides<0);assert.notEqual(dot(p.B,p.C),dot(u,v));
 for(const shift of [[10,-8,4],[-1,-3,5]]){const moved=Object.fromEntries(Object.entries(p).map(([k,a])=>[k,a.map((x,i)=>x+shift[i])]));assert.deepEqual(sub(moved.B,moved.A),u);assert.deepEqual(sub(moved.C,moved.A),v);}
 // Orthogonal signed coordinate permutations preserve the scalar product and norms.
 const rotate=a=>[-a[2],a[0],-a[1]];close(dot(rotate(u),rotate(v)),-1);close(norm(rotate(u)),norm(u));
});
test('single-point transfer and zero-direction counterexample preserve the stated boundaries',()=>{
 const C=[2,3,3],u=sub(p.B,p.A),v=sub(C,p.A);assert.deepEqual(v,[1,2,2]);close(dot(u,v),4);close(norm(v),3);close(dot(u,v)/(norm(u)*norm(v)),4/(3*Math.sqrt(5)));assert(q.transfer.answer.includes('4/(3√5)'));
 const zero=sub(p.A,p.A);close(norm(zero),0);close(dot(zero,sub(p.C,p.A)),0);assert(!Number.isFinite(dot(zero,sub(p.C,p.A))/(norm(zero)*norm(sub(p.C,p.A)))));assert(q.counter.answer.includes('没有确定方向'));assert(q.counter.answer.includes('分母为0'));
});
test('directed diagram has no early green vector and arrowheads point toward B and C',()=>{
 const project=([x,y,z])=>[170+48*x-30*y,280-12*x-16*y-44*z],A=project(p.A);
 for(const svg of [lib.mathFigure(q),lib.mathFigure(q,{stage:0},true)]){assert(!svg.includes('fill="#075D49"'));assert(!svg.includes('√30'));assert(!svg.includes('u = B'));}
 for(let i=0;i<q.steps.length;i++){
  const svg=lib.mathFigure(q,q.steps[i].visual),heads=[...svg.matchAll(/<polygon points="([^"]+)" fill="#075D49"/g)].map(m=>m[1].split(' ').map(pair=>pair.split(',').map(Number)));
  assert.equal(heads.length,i===0?1:2);assert(!/undefined|NaN|Infinity/.test(svg));
  for(let j=0;j<heads.length;j++){const end=project(j===0?p.B:p.C),[tip,b,c]=heads[j],mid=b.map((v,k)=>(v+c[k])/2);close(Math.hypot(...sub(tip,end)),4);assert(dot(sub(tip,mid),sub(end,A))>0);}
  if(i<2)assert(!svg.includes('u·v ='));if(i<4)assert(!svg.includes('√30'));
 }
 assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('learning route starts with basic operations and application cards point back to them',()=>{
 for(const id of ['S09','S10'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(q.id));
 for(const id of ['prism-orthogonal-axes','cube-angle','plane-normal-distance'])assert(lib.getMathLesson(id).related.some(r=>r.id===q.id));
 for(const r of q.related)assert(lib.getMathLesson(r.id));const route=lib.mathDirectory().match(/data-math-learning-route="vector-preparation"[\s\S]*?<\/section>/)[0];assert(route.indexOf('math-'+q.id)<route.indexOf('math-prism-orthogonal-axes'));assert(route.includes('尚未覆盖向量运算的完整练习与所有性质'));
});
test('source scope and preserved subjects remain unchanged by an original bridge',()=>{
 const html=lib.mathResources();assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert(html.includes('44道原创课内题'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
