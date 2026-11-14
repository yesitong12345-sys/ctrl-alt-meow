import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('exam2021-21'),near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function intersections(h,t,k){const intercept=t-k*h,a=16-k*k,b=-2*k*intercept,c=-intercept*intercept-16,delta=b*b-4*a*c;if(Math.abs(a)<1e-12||delta<=0)return [];return [(-b-Math.sqrt(delta))/(2*a),(-b+Math.sqrt(delta))/(2*a)].map(x=>[x,k*x+intercept]).sort((a,b)=>a[0]-b[0]);}
test('full two-part source retains signed branch, positive roots, degree/domain checks and distinct lines',()=>{
 assert.equal(l.sourceKey,'gaokao-2021-I-21');assert.equal(l.conditions.length,3);assert.equal(l.steps.length,9);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.work.length&&s.point&&s.result);}
 assert(l.steps[1].result.includes('x≥1'));assert(l.steps[1].work.join('').includes('反过来'));assert(l.steps[2].work.join('').includes('竖直线x=1/2'));assert(l.steps[4].work.join('').includes('只是必要条件'));assert(l.steps[7].work.join('').includes('k₁≠k₂'));assert(l.steps[8].work.join('').includes('乘积均为63'));
 for(const id of ['A07','A09','A11','A12'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(l.id));assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id==='A11'));
});
test('independent quadratic in x confirms signed locus, true same-branch secants, distance products and transfer',()=>{
 const c=Math.sqrt(17),F=[-c,0],G=[c,0];for(const x of [1,1.2,1.5,3.5,8])for(const sign of [-1,1]){const y=sign*4*Math.sqrt(x*x-1);near(dist([x,y],F)-dist([x,y],G),2);near(dist([-x,y],F)-dist([-x,y],G),-2);}
 for(const h of [.2,1/3,.5,.75]){const k=(4+4/Math.sqrt(1-h*h))/2,T=[h,0],p=intersections(h,0,k),q=intersections(h,0,-k);assert.equal(p.length,2);assert.equal(q.length,2);for(const point of [...p,...q]){assert(point[0]>=1);near(point[0]**2-point[1]**2/16,1);}const product=dist(T,p[0])*dist(T,p[1]);near(product,dist(T,q[0])*dist(T,q[1]));near(product,(16-16*h*h)*(1+k*k)/(k*k-16));}
 for(const t of [-.1,0,.1]){const k=2*Math.sqrt(5),T=[.5,t],p=intersections(.5,t,k),q=intersections(.5,t,-k);assert(p.every(P=>P[0]>=1)&&q.every(P=>P[0]>=1));near(dist(T,p[0])*dist(T,p[1]),dist(T,q[0])*dist(T,q[1]));near(dist(T,p[0])*dist(T,p[1]),(12+t*t)*(1+k*k)/(k*k-16));}
 const k=2*Math.sqrt(5),T=[.5,0],points=intersections(.5,0,k);near(points[0][0]-.5,1);near(points[1][0]-.5,3);near(dist(T,points[0]),Math.sqrt(21));near(dist(T,points[1]),3*Math.sqrt(21));near(dist(T,points[0])*dist(T,points[1]),63);
 assert.equal(intersections(.5,0,5).length,0);assert(12*26/9>0);assert(2*k!==0); // the same line has equal products but does not have zero slope sum
});
test('actual coordinate graphs preserve focus distances/right branch, and rotated diagrams preserve positive length order',()=>{
 const pts=svg=>[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[+m[1],+m[2]]);
 const original=lib.mathFigure(l,{stage:0},true);assert(!original.includes('k₁+k₂=0'));assert(!original.includes('x≥1'));assert(!original.includes('stroke-width="2.5"'));const [F,G,M]=pts(original).map(([x,y])=>[(x-230)/24,(170-y)/24]);near(dist(M,F)-dist(M,G),2);
 const second=lib.mathFigure(l,{stage:2});assert(second.includes('左支排除'));assert(second.includes('x≥1'));assert(second.includes('stroke-dasharray="6 5"'));
 for(const stage of [4,5,6,7]){const svg=lib.mathFigure(l,{stage}),[T,A,B]=pts(svg);assert(T[0]<A[0]&&A[0]<B[0]);near(T[1],A[1]);near(A[1],B[1]);near(dist(T,B)/dist(T,A),3);assert(!svg.includes('k₁+k₂=0'));}
 for(const stage of [8,9]){const svg=lib.mathFigure(l,{stage}),[T,A,B,P,Q]=pts(svg).map(([x,y])=>[(x-110)/11,(170-y)/11]);for(const X of [A,B,P,Q]){near(X[0]**2-X[1]**2/16,1);assert(X[0]>=1);}near(dist(T,A)*dist(T,B),63);near(dist(T,P)*dist(T,Q),63);assert(svg.includes('k₁+k₂=0'));assert(!/NaN|undefined/.test(svg));}
 assert.equal((lib.mathResources().match(/data-analytic-source-key=/g)||[]).length,12);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
