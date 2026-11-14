import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('plane-facts-intersection');
const sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b,k=1)=>a.map((x,i)=>x+k*b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),zero=x=>assert(Math.abs(x)<1e-9);
test('five full proof stages establish noncollinearity, different planes and the entire intersection line',()=>{
 assert.equal(l.steps.length,5);assert.equal(l.kind,'原创课内题');assert(!l.sourceKey);
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.work.length&&s.why&&s.hint&&s.point&&s.result);}
 assert(l.steps[0].work.join('').includes('尤其A≠B'));assert(l.steps[1].work.join('').includes('若D在AB上'));assert(l.steps[2].work.join('').includes('若α=β'));assert(l.steps[4].work.join('').includes('不共线三点A、B、C'));
});
test('independent normal cross products verify intersection direction for three nonorthogonal configurations',()=>{
 for(const [A,B,C,D] of [[[0,0,0],[4,0,0],[0,3,0],[0,0,3]],[[1,2,3],[3,3,4],[0,5,4],[2,1,6]],[[-2,1,4],[1,-1,5],[0,3,7],[2,2,-1]]]){
  const u=sub(B,A),v=sub(C,A),w=sub(D,A),na=cross(u,v),nb=cross(u,w);assert(Math.abs(dot(na,w))>1e-9);assert(norm(na)>0&&norm(nb)>0);zero(norm(cross(cross(na,nb),u)));assert(Math.abs(dot(nb,v))>1e-9);
  for(const t of [-3,-.4,0,.5,1,2]){const p=add(A,u,t);zero(dot(na,sub(p,A)));zero(dot(nb,sub(p,A)));}
 }
});
test('renaming by distinct points works on extensions and at an endpoint without segment restrictions',()=>{
 const A=[1,2,3],u=[2,-1,4];for(const [e,f] of [[-.4,.5],[2,0],[-3,2],[0,1]]){const E=add(A,u,e),F=add(A,u,f);assert(norm(sub(F,E))>0);zero(norm(cross(sub(F,E),u)));}
 assert(l.transfer.answer.includes('F=A'));assert(l.steps[3].work.join('').includes('不是说交集只有线段EF'));
});
test('each changed condition has its own failure: coincident points, coincident planes or collinear triple',()=>{
 const A=[0,0,0],B=[4,0,0],C=[0,3,0],E=[2,0,0];zero(norm(sub(E,E)));zero(norm(cross(sub(B,A),sub([2,0,0],A))));
 const D=[2,1,0],na=cross(sub(B,A),sub(C,A)),nb=cross(sub(B,A),sub(D,A));zero(norm(cross(na,nb)));assert(norm(nb)>0);
 for(const phrase of ['两个重合点不能确定直线','交集是整个平面','三个不同共线点'])assert((l.counter.question+l.counter.answer).includes(phrase));
});
test('diagrams introduce planes in proof order and distinguish transparent infinite planes from solid boards',()=>{
 const initial=lib.mathFigure(l,{stage:0},true),one=lib.mathFigure(l,l.steps[0].visual),two=lib.mathFigure(l,l.steps[1].visual),three=lib.mathFigure(l,l.steps[2].visual),four=lib.mathFigure(l,l.steps[3].visual);
 assert(!initial.includes('<polygon'));assert(one.includes('>α</text>'));assert(!one.includes('>β</text>'));assert(two.includes('>β</text>'));assert(three.includes('#7A4510'));assert(four.includes('交线为整条AB=EF'));assert(two.includes('不模拟实体板遮挡'));
 const labels=[...four.matchAll(/<text\b([^>]*)>([ABCD EFαβ])<\/text>/g)].map(([,attrs,name])=>({name,x:Number(attrs.match(/x="([^"]+)"/)[1]),y:Number(attrs.match(/y="([^"]+)"/)[1])}));for(const a of labels.filter(x=>/[αβ]/.test(x.name)))for(const b of labels.filter(x=>/[A-F]/.test(x.name)))assert(Math.abs(a.x-b.x)>19||Math.abs(a.y-b.y)>19,`${a.name} overlaps ${b.name}`);
 // E, A, F and B share the same exact projected line, with E outside segment AB.
 const A=[190,210],B=[310,230],E=[142,202],F=[250,220],d=sub([...B,0],[...A,0]);for(const P of [E,F])zero(norm(cross(sub([...P,0],[...A,0]),d)));assert(E[0]<A[0]);
 for(const s of l.steps.filter(s=>s.visual))assert(!/NaN|undefined|Infinity/.test(lib.mathFigure(l,s.visual)));assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('geometry-only route begins with basic facts while sources, chemistry and earlier cards remain',()=>{
 assert(lib.mathNodes.find(n=>n.id==='S02').lessons.includes(l.id));for(const r of l.related)assert(lib.getMathLesson(r.id));for(const id of ['cube-skew','tetra-coplanarity','tetra-parallel-section'])assert(lib.getMathLesson(id).related.some(r=>r.id===l.id));
 const route=lib.mathDirectory().match(/data-math-learning-route="geometry-relations"[\s\S]*?<\/section>/)[0];assert.equal((route.match(/data-open-method=/g)||[]).length,8);assert(route.indexOf('math-'+l.id)<route.indexOf('math-cube-skew'));assert(!l.prerequisites.join('').includes('向量'));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);
});
