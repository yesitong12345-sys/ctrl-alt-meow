import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('exam2021-11'),near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`),sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a[0]*b[0]+a[1]*b[1],dist=(a,b)=>Math.hypot(...sub(a,b));
const S=[5,5],B=[0,2],A=[4,0],distance=([x,y])=>Math.abs(x+2*y-4)/Math.sqrt(5),angle=P=>Math.acos(Math.max(-1,Math.min(1,dot(sub(P,B),sub(A,B))/(dist(P,B)*dist(A,B)))));
function tangents(r){const w=sub(S,B),D2=dot(w,w),length=Math.sqrt(D2-r*r),alpha=(D2-r*r)/D2,beta=r*length/D2;return [-1,1].map(sign=>[B[0]+alpha*w[0]-sign*beta*w[1],B[1]+alpha*w[1]+sign*beta*w[0]]).sort((p,q)=>angle(p)-angle(q));}
test('full multiselect retains all original options and distinguishes distance from both view-angle endpoints',()=>{
 assert.equal(l.sourceKey,'gaokao-2021-I-11');assert.equal(l.conditions.length,5);assert.equal(l.steps.length,7);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.work.length&&s.point&&s.result);}
 assert(l.steps[0].work.join('').includes('定义圆心S'));assert(l.steps[1].work.join('').includes('定义H'));assert(l.steps[4].work.join('').includes('始终在0与180°之间'));assert(l.steps[5].work.join('').includes('D也正确'));assert(l.steps[6].result.includes('A、C、D'));
 for(const id of ['A02','A04','A12'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(l.id));for(const id of ['C-LINE','C-TANGENT','C-RANGE'])assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id===id));
});
test('independent tangent construction and circular sweep verify full distance and angle bounds, attainability and transfer',()=>{
 const H=[14/5,3/5],u=[1/Math.sqrt(5),2/Math.sqrt(5)],U=S.map((x,i)=>x-4*u[i]),V=S.map((x,i)=>x+4*u[i]),[T1,T2]=tangents(4),low=angle(T1),high=angle(T2);
 near(H[0]+2*H[1]-4,0);near(dot(sub(S,H),sub(A,B)),0);near(distance(U),11/Math.sqrt(5)-4);near(distance(V),11/Math.sqrt(5)+4);assert(distance(V)<10);assert(distance([5,1])<2);near(dist([5,1],S),4);
 for(const T of [T1,T2]){near(dist(T,S),4);near(dot(sub(T,B),sub(T,S)),0);near(dist(T,B),3*Math.sqrt(2));}assert(low>0&&high<Math.PI&&low<high);
 for(let i=0;i<1440;i++){const t=i*Math.PI/720,P=[5+4*Math.cos(t),5+4*Math.sin(t)];assert(distance(P)>=distance(U)-1e-9&&distance(P)<=distance(V)+1e-9);assert(angle(P)>=low-1e-9&&angle(P)<=high+1e-9);assert(P[0]+2*P[1]-4>0);}
 assert(11/Math.sqrt(5)-1>2);assert(11/Math.sqrt(5)+1<10);for(const T of tangents(1))near(dist(T,B),Math.sqrt(33));assert.notEqual(Math.sqrt(33),3*Math.sqrt(2));near(dist(S,B),Math.sqrt(34));
});
test('actual drawing uses equal scale, true feet/extrema/tangencies and staged objects without early answers',()=>{
 const pts=svg=>[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[(+m[1]-70)/32,(310-+m[2])/32]);
 for(let stage=0;stage<=7;stage++){
  const svg=lib.mathFigure(l,{stage},stage===0),ps=pts(svg);assert(svg.includes('cx="230" cy="150" r="128"'));assert(!/NaN|undefined/.test(svg));if(stage===0){assert.equal(ps.length,3);assert(!svg.includes('>S</text>'));assert(!svg.includes('T₁'));assert(!svg.includes('>U</text>'));}
  if(stage===2){const H=ps[4];near(H[0]+2*H[1]-4,0);near(dot(sub(S,H),sub(A,B)),0);}
  if(stage===3){const [U,V]=ps.slice(-2);near(dist(U,S),4);near(dist(V,S),4);near(distance(U),11/Math.sqrt(5)-4);near(distance(V),11/Math.sqrt(5)+4);}
  if(stage===4)near(dist(ps.at(-1),S),4);
  if(stage>=5){const [T1,T2]=ps.slice(-2);near(dist(T1,S),4);near(dist(T2,S),4);near(dot(sub(T1,B),sub(T1,S)),0);near(dot(sub(T2,B),sub(T2,S)),0);assert(angle(T1)<angle(T2));assert(svg.includes('T₁：最小角'));assert(!svg.includes('>U</text>'));}
 }
 assert.equal((lib.mathResources().match(/data-analytic-source-key=/g)||[]).length,12);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert(lib.getCircleLesson('G22'));assert(!lib.getCircleLesson('G21'));
});
