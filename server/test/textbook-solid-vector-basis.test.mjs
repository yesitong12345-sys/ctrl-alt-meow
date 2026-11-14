import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('vector-noncoplanar-basis'),p=q.basisPoints;
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),close=(a,b)=>assert(Math.abs(a-b)<1e-9),a=sub(p.A,p.O),b=sub(p.B,p.O),c=sub(p.C,p.O),w=sub(p.T,p.O),combine=(k,base=[a,b,c])=>[0,1,2].map(i=>k.reduce((s,x,j)=>s+x*base[j][i],0));
test('five full stages cover noncoplanarity, existence, uniqueness, geometric addition and metric restrictions',()=>{
 assert.equal(q.steps.length,5);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence));assert(s.work.length>=3&&s.why&&s.hint&&s.point&&s.result);}
 assert(q.steps[2].work.join('').includes('任意空间向量'));assert(q.steps[2].work.join('').includes('两组系数完全相同'));assert(q.trap.includes('两两不平行'));assert(q.prerequisites.some(s=>s.includes('数量积')));
});
test('independent reciprocal-vector computation confirms nonzero volume and unique coefficients',()=>{
 const det=dot(a,cross(b,c));close(det,2);assert.deepEqual([dot(w,cross(b,c))/det,dot(w,cross(c,a))/det,dot(w,cross(a,b))/det],[1,2,3]);assert.deepEqual(combine([1,2,3]),w);
 for(const v of [[0,0,0],[3,2,6],[-7,4,-2],[.3,-.2,1.5],[2,0,0]]){const k=[dot(v,cross(b,c))/det,dot(v,cross(c,a))/det,dot(v,cross(a,b))/det];for(let i=0;i<3;i++)close(combine(k)[i],v[i]);close(k[0],v[0]-v[1]);close(k[1],v[1]);close(k[2],v[2]/2);}
});
test('metric expands in this nonorthonormal basis rather than using coefficient squares',()=>{
 close(dot(a,b),1);close(norm(a),1);close(norm(b),Math.sqrt(2));close(norm(c),2);close(norm(w),7);assert.notEqual(norm(w),Math.sqrt(14));
 for(const k of [[1,2,3],[0,0,0],[-2,3,1],[.5,-1,2]]){let squared=0;const base=[a,b,c];for(let i=0;i<3;i++)for(let j=0;j<3;j++)squared+=k[i]*k[j]*dot(base[i],base[j]);close(norm(combine(k))**2,squared);}
 assert.deepEqual(sub(p.H,p.A),[2,2,0]);assert.deepEqual(sub(p.T,p.H),[0,0,6]);assert(norm(a)+norm(sub(p.H,p.A))+norm(sub(p.T,p.H))>norm(w));
});
test('sign-changed third direction preserves the basis while pairwise nonparallel coplanar directions fail',()=>{
 const cp=[0,0,-2];close(dot(a,cross(b,cp)),-2);assert.deepEqual(combine([1,2,-3],[a,b,cp]),w);assert(q.transfer.answer.includes('模仍为7'));
 const d=combine([1,1,0]);for(const [u,v] of [[a,b],[a,d],[b,d]])assert(norm(cross(u,v))>0);close(dot(a,cross(b,d)),0);assert.deepEqual(combine([1,1,0],[a,b,d]),combine([0,0,1],[a,b,d]));assert.equal(d[2],0);assert.notEqual(w[2],0);assert(q.counter.answer.includes('无法表示w'));
});
test('H is revealed only after definition and the three geometric arrows meet at their true endpoints',()=>{
 for(const stage of [0,1,2,3,4,5]){const svg=lib.mathFigure(q,{stage},stage===0);assert.equal(svg.includes('>H</text>'),stage===4);assert(!/undefined|NaN|Infinity/.test(svg));if(stage===0)assert(!svg.includes('fill="#075D49"'));for(const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"/g)){assert(+m[1]>0&&+m[1]<460);assert(+m[2]>0&&+m[2]<340);}}
 const svg=lib.mathFigure(q,q.steps[3].visual);for(const d of ['M140 260L190 248','M190 248L234 188','M234 188L234 32'])assert(svg.includes('d="'+d+'" stroke="#075D49"'));const tips=[...svg.matchAll(/<polygon points="([^"]+)" fill="#075D49"/g)].map(m=>m[1].split(' ')[0]);assert.deepEqual(tips,['190,248','234,188','234,32']);assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('new basis bridge is reachable before orthogonal-axis application while old subjects and real frequencies remain',()=>{
 for(const id of ['S09','S10'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(q.id));for(const id of ['vector-coordinates-basic','prism-orthogonal-axes'])assert(lib.getMathLesson(id).related.some(r=>r.id===q.id));for(const r of q.related)assert(lib.getMathLesson(r.id));
 const html=lib.mathDirectory(),route=html.match(/data-math-learning-route="vector-preparation"[\s\S]*?<\/section>/)[0];assert.equal((route.match(/data-open-method=/g)||[]).length,12);assert(route.indexOf('math-vector-line-parameter')<route.indexOf('math-'+q.id));assert(route.indexOf('math-'+q.id)<route.indexOf('math-prism-orthogonal-axes'));assert.equal((html.match(/data-open-method="review-/g)||[]).length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
