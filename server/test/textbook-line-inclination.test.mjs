import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('line-slope-inclination'),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('line lesson retains all cases and defines objects before angle or intercept use',()=>{
 assert.equal(l.steps.length,7);assert(!l.sourceKey);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.work.length&&s.why&&s.point&&s.result);}
 assert(l.steps[0].work.join('').includes('(t,3)'));assert(l.steps[1].work.join('').includes('任取点M(x,y)'));assert(l.steps[1].work.join('').includes('反过来'));assert(l.steps[3].work.join('').includes('记倾斜角为θ'));assert(l.steps[5].work.join('').includes('定义交点D'));
 assert(lib.mathNodes.find(n=>n.id==='A01').lessons.includes(l.id));assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id==='A01'));assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('independent collinearity, inclination and intercept checks include the vertical line and coincident transfer',()=>{
 for(const t of [-5,-Math.sqrt(3),0,Math.sqrt(3),2]){
  const equation=([x,y])=>3*x-t*(y+2);near(equation([0,-2]),0);near(equation([t,1]),0);near(equation([2*t/3,0]),0);
  for(const k of [-2,0,.5,3])near(equation([k*t,-2+3*k]),0);
  const angle=Math.atan2(3,t)*180/Math.PI;assert(angle>0&&angle<180);if(t!==0)near(Math.tan(angle*Math.PI/180),3/t);else near(angle,90);
 }
 near(Math.atan2(3,Math.sqrt(3))*180/Math.PI,60);near(Math.atan2(3,-Math.sqrt(3))*180/Math.PI,120);
 for(const t of [-2,0,4]){const originalDirection=[t,3],transferDirection=[t,0];assert(Math.hypot(...originalDirection)>0);assert.equal(Math.hypot(...transferDirection)>0,t!==0);if(t!==0)near(transferDirection[1]/transferDirection[0],0);}
});
test('actual equal-scale drawings show distinct vertical points, proper inclination arcs and delayed intercept',()=>{
 const circles=svg=>[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[+m[1],+m[2]]);
 for(const [stage,t]of [[0,2],[1,2],[2,2],[3,0],[4,Math.sqrt(3)],[5,-Math.sqrt(3)],[6,2]]){
  const svg=lib.mathFigure(l,{stage},stage===0),[O,P,Q,D]=circles(svg);near(P[0],O[0]);near((O[1]-P[1])/35,-2);near((Q[0]-O[0])/35,t);near((O[1]-Q[1])/35,1);assert(!/NaN|undefined/.test(svg));
  assert.equal(svg.includes('A40 40'),stage===4||stage===5);assert.equal(!!D,stage===6);if(D){near((D[0]-O[0])/35,2*t/3);near(D[1],O[1]);}
  if(stage===3){near(P[0],Q[0]);assert(P[1]!==Q[1]);assert(svg.includes('x=0'));assert(!svg.includes('90°'));}
 }
 const original=lib.mathFigure(l,{stage:0},true);assert(!original.includes('60°'));assert(!original.includes('120°'));assert(!original.includes('D(2t/3,0)'));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
