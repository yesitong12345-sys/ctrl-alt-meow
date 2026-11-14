import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('ellipse-offset-vieta'),near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
test('complete offset-chord lesson puts existence before Vieta, defines endpoints/midpoint, and retains prerequisites',()=>{
 assert.equal(l.steps.length,7);assert(!l.sourceKey);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.work.length&&s.result&&s.point);}
 assert(l.steps[0].work.join('').includes('定义M为AB中点'));assert(l.steps[1].work.join('').includes('恒为5≠0'));assert(l.steps[2].work.join('').includes('Δ>0'));assert(l.steps[3].work.join('').includes('以下只在m²<5'));assert(l.steps[5].work.join('').includes('m²/5<1'));
 for(const id of ['A09','A10'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(l.id));assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id==='E-LINE'));assert(lib.getMathLesson('ellipse-chord'));assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('independent affine unit-circle construction checks parameter range, actual endpoints, chord and midpoint',()=>{
 // Scale x=2X,y=Y: the unit circle meets Y-2X=m; use its perpendicular foot and tangent direction.
 const curve=([x,y])=>x*x/4+y*y;
 for(const m of [-2,-1,0,.3,1,2]){
  const foot=[-2*m/5,m/5],h=Math.sqrt(1-m*m/5),u=[1/Math.sqrt(5),2/Math.sqrt(5)];
  const endpoints=[-1,1].map(sign=>[2*(foot[0]+sign*h*u[0]),foot[1]+sign*h*u[1]]),[A,B]=endpoints;
  for(const p of endpoints){near(curve(p),1);near(p[1],p[0]+m);}near(dist(A,B),4*Math.sqrt(10-2*m*m)/5);near((A[0]+B[0])/2,-4*m/5);near((A[1]+B[1])/2,m/5);near(curve([-4*m/5,m/5]),m*m/5);
 }
 const A=[0,1],B=[-8/5,-3/5];near(curve(A),1);near(curve(B),1);near(dist(A,B),8*Math.sqrt(2)/5);near((A[0]+B[0])/2,-4/5);near((A[1]+B[1])/2,1/5);
 for(const m of [-Math.sqrt(5),Math.sqrt(5)]){const tangent=[-4*m/5,m/5];near(curve(tangent),1);near(tangent[1]-tangent[0],m);near(Math.abs(m)/Math.sqrt(5),1);}assert(3/Math.sqrt(5)>1);
 for(const t of [-2,-1,0,1,2]){const y=Math.sqrt(1-t*t/4);near(curve([t,y]),1);near(curve([t,-y]),1);near(dist([t,y],[t,-y]),2*y);assert.equal(y>0,Math.abs(t)<2);}assert(1-3*3/4<0);
});
test('actual SVG preserves ellipse scale, collinearity, tangent incidence and staged objects',()=>{
 const circles=svg=>[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[+m[1],+m[2]]),coord=p=>[(p[0]-230)/60,(170-p[1])/60];
 const original=lib.mathFigure(l,{stage:0},true);assert.equal(circles(original).length,1);assert(!original.includes('A(0,1)'));assert(!original.includes('B(−8/5'));assert(!original.includes('M('));
 for(let stage=1;stage<=7;stage++){
  const svg=lib.mathFigure(l,{stage}),pts=circles(svg);assert(svg.includes('rx="120" ry="60"'));assert(!/NaN|undefined/.test(svg));assert.equal(pts.length,stage>=6?4:3);
  for(const p of pts.slice(1,3)){const [x,y]=coord(p);near(x*x/4+y*y,1);near(y,x+1);}assert.equal(svg.includes('M(−4/5,1/5)'),stage===7);
  if(stage>=6){const [x,y]=coord(pts[3]);near(x,-.8);near(y,.2);assert(x*x/4+y*y<1);}if(stage<7)assert(!svg.includes('B(−8/5'));
 }
 const third=lib.mathFigure(l,{stage:3}),t=third.match(/<circle cx="([^"]+)" cy="([^"]+)" r="4"/);assert(t);const [x,y]=coord([+t[1],+t[2]]);near(x*x/4+y*y,1);near(y-x,Math.sqrt(5));assert(third.includes('m=3：无交点'));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
});
