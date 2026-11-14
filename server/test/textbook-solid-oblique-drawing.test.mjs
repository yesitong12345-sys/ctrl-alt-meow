import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('oblique-box-drawing'),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('oblique drawing keeps the full problem and separates paper quantities from spatial quantities',()=>{
 assert(l);assert.equal(l.steps.length,7);assert(!l.sourceKey);assert(l.kind.includes('典型方法'));assert(!l.prerequisites.join('').includes('空间向量'));
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.point&&s.work.length&&s.result);}
 assert(l.steps[4].result.includes('6√2'));assert(l.steps[5].result.includes('72'));assert(l.transfer.answer.includes('240'));assert(l.counter.answer.includes('40+12√2'));
 const detail=lib.mathDetail('math-'+l.id);assert(!detail.includes('data-diagram-unavailable'));assert(!detail.includes('standard-2020-oblique'));assert(lib.mathResources().includes('2025修订版对应条目'));
});
test('independent affine projection verifies area ratio, transfer, and the diagonal counterexample',()=>{
 const project=([x,y,z])=>[x+y/(2*Math.sqrt(2)),z+y/(2*Math.sqrt(2))];
 const area=pts=>Math.abs(pts.reduce((n,p,i)=>{const q=pts[(i+1)%pts.length];return n+p[0]*q[1]-p[1]*q[0]},0))/2;
 for(const [x,y,h] of [[6,4,3],[8,6,5]]){
  const points=[[0,0,0],[x,0,0],[x,y,0],[0,y,0]].map(project);
  near(area(points)/(x*y),Math.sqrt(2)/4);near(Math.hypot(...project([0,y,0])),y/2);near(Math.hypot(...project([0,0,h])),h);
 }
 near(area([[0,0,0],[6,0,0],[6,4,0],[0,4,0]].map(project)),6*Math.sqrt(2));
 near(area([[0,0,0],[8,0,0],[8,6,0],[0,6,0]].map(project)),12*Math.sqrt(2));
 const diagonal=project([6,4,0]);near(diagonal[0]**2+diagonal[1]**2,40+12*Math.sqrt(2));assert(Math.abs(Math.hypot(...diagonal)-Math.sqrt(52)/2)>1);
 near(6*4*3,72);near(8*6*5,240);
});
test('actual SVG uses one paper scale, reveals construction in order, and hides exactly the three back edges',()=>{
 const original=lib.mathFigure(l,{stage:0},true),axes=lib.mathFigure(l,{stage:2}),base=lib.mathFigure(l,{stage:3}),box=lib.mathFigure(l,{stage:4});
 assert(original.includes('原底面实形'));assert(!original.includes('A₁′'));assert(!axes.includes('C′</text>'));assert(!base.includes('A₁′'));
 const points=[...base.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[+m[1],+m[2]]),[A,B,C,D]=points;
 near(Math.hypot(B[0]-A[0],B[1]-A[1])/Math.hypot(D[0]-A[0],D[1]-A[1]),3);
 near((D[0]-A[0])/(A[1]-D[1]),1);near(C[0]-B[0],D[0]-A[0]);near(C[1]-B[1],D[1]-A[1]);
 assert.equal((box.match(/stroke-dasharray/g)||[]).length,3);assert(box.includes('A₁′'));const paperArea=lib.mathFigure(l,{stage:5});assert(paperArea.includes('√2'));assert(!paperArea.includes('A₁′'));
 for(const s of l.steps)assert(!/NaN|undefined/.test(lib.mathFigure(l,s.visual)));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
