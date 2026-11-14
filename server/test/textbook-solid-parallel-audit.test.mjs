import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],scale=(a,k)=>a.map(x=>x*k),mean=ps=>ps[0].map((_,i)=>ps.reduce((n,p)=>n+p[i],0)/ps.length),norm=a=>Math.hypot(...a),zero=x=>assert(Math.abs(x)<1e-9);
function independentlyHidden(mesh){
 const pr=mesh.projection||{x:[62,-13],y:[-43,-24],z:[0,-75]},rows=[0,1].map(i=>[pr.x[i],pr.y[i],pr.z[i]]);let view=cross(...rows);if(view[2]<0)view=scale(view,-1);
 const p=mesh.points,center=mean(['P','A','B','C'].map(k=>p[k])),faces=[['P','A','B'],['P','B','C'],['P','C','A'],['A','B','C']];
 const front=faces.map(f=>{const ps=f.map(k=>p[k]);let n=cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]));if(dot(n,sub(center,mean(ps)))>0)n=scale(n,-1);return dot(n,view)>0;});
 return mesh.edges.filter(([a,b])=>faces.every((f,i)=>!f.includes(a)||!f.includes(b)||!front[i])).map(e=>e.slice().sort().join('-')).sort();
}
test('two tetrahedral diagrams use outward faces to keep silhouette edges solid and rear BC dashed',()=>{
 for(const id of ['tetra-parallel','tetra-parallel-section']){const l=lib.getMathLesson(id),hidden=independentlyHidden(l.mesh);assert.deepEqual(hidden,['B-C']);const boundary=new Set(l.mesh.edges.map(e=>e.slice().sort().join('-')));assert.deepEqual(l.mesh.hidden.map(e=>e.split('-').sort().join('-')).filter(e=>boundary.has(e)).sort(),hidden);
  for(const visual of [{stage:0},...l.steps.filter(s=>s.visual).map(s=>s.visual)]){const svg=lib.mathFigure(l,visual);assert(!/NaN|undefined/.test(svg));}
 }
 const section=lib.getMathLesson('tetra-parallel-section');for(const edge of ['N-K','P-L','M-H','A-L'])assert(section.mesh.hidden.includes(edge));
});
test('midpoint line stays outside the base for oblique apex positions and equal internal ratios',()=>{
 const A=[0,0,0],B=[6,0,0],C=[0,8,0],base=cross(sub(B,A),sub(C,A));for(const P of [[1,1,9],[10,-4,5],[0,0,3]])for(const t of [.5,1/3]){const M=P.map((v,i)=>v+t*(A[i]-v)),N=P.map((v,i)=>v+t*(B[i]-v));zero(norm(cross(sub(N,M),sub(B,A))));zero(dot(base,sub(N,M)));assert(Math.abs(dot(base,sub(M,A)))>0);}
});
test('section proof states distinct planes and distinct public points before naming their intersection',()=>{
 const l=lib.getMathLesson('tetra-parallel-section'),a=l.steps[0].work.join(''),b=l.steps[1].work.join(''),c=l.steps[2].work.join('');assert(a.includes('B不在α内'));assert(a.indexOf('平面PAB不同')<a.indexOf('整条MN'));assert(b.includes('K≠N'));assert(b.indexOf('所以两面不同')<b.indexOf('交线为整条NK'));assert(c.includes('M不在底面'));assert(c.includes('相交于M'));assert(c.includes('相交于A'));
 assert(lib.getMathLesson('cube-parallel-planes').steps[2].work.join('').includes('故A′不在平面ABCD内'));
 const counter=lib.getMathLesson('cube-parallel-planes').counter;assert(counter.question.includes('平面ABB′A′'));assert(counter.answer.includes('实际相交于AB'));assert(!counter.question.includes('z=0'));
});
test('2024 first question is valid without borrowing the second question and its converse is invalid',()=>{
 const A=[0,0,0],B=[1.5,Math.sqrt(3)/2,0],C=[2,0,0],P=[0,0,2],ad=sub(C,B);zero(dot(sub(B,A),ad));zero(dot(ad,sub(P,A)));zero(dot(ad,sub(P,B)));const targetNormal=cross(sub(C,B),sub(P,B));zero(dot(targetNormal,ad));assert(Math.abs(dot(targetNormal,sub(A,B)))>1e-9);
 const D=[1,-1,0];zero(dot(sub(D,A),sub(C,D)));assert(Math.abs(dot(sub(D,A),sub(P,B)))>1e-9);
 const l=lib.getMathLesson('exam2024-17');assert(l.intro.includes('不能沿用第一问'));assert(l.conditions[1].includes('AD⊥PB'));assert(l.conditions[2].includes('AD⊥DC'));
});
test('audit repairs preserve lesson identities, full statements, subjects and verified frequency ledger',()=>{
 for(const id of ['tetra-parallel','cube-parallel-planes','tetra-parallel-section','exam2024-17']){const l=lib.getMathLesson(id);assert(l.conditions.length&&l.steps.length&&l.transfer&&l.counter);for(const s of l.steps)assert(l.conditions.join('').includes(s.evidence));}
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);assert(lib.mathResources().includes('351段'));
});
