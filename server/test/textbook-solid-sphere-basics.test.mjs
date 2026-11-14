import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('sphere-basics-scale');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} differs from ${b}`);
test('five complete stages distinguish diameter, surface, interior and great-circle area',()=>{
 assert.equal(l.steps.length,5);assert.equal(l.kind,'原创课内题');assert(!l.sourceKey);
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.work.length&&s.why&&s.hint&&s.point&&s.result);}
 assert(l.steps[0].work.join('').includes('O是AB中点'));assert(l.steps[1].result.includes('9π'));assert(l.steps[2].work.join('').includes('不能写成S₁=V₁'));
});
test('independent disk slices and surface-of-revolution bands verify area and volume',()=>{
 for(const R of [3,6,9]){let v=0,area=0;const n=40000,dz=2*R/n;
  for(let i=0;i<n;i++){const z0=-R+i*dz,z1=z0+dz,mid=(z0+z1)/2,r0=Math.sqrt(Math.max(0,R*R-z0*z0)),r1=Math.sqrt(Math.max(0,R*R-z1*z1));v+=Math.PI*(R*R-mid*mid)*dz;area+=Math.PI*(r0+r1)*Math.hypot(dz,r1-r0);}
  near(v/(Math.PI*R**3),4/3);near(area/(Math.PI*R**2),4,1e-6);
 }
});
test('positive cube-root conversion precedes squared area ratio in main and transfer examples',()=>{
 for(const [ratio,radius,area,volume] of [[8,6,144,288],[27,9,324,972]]){const k=Math.cbrt(ratio),r=3*k;near(r,radius);near(4*r*r,area);near(4*r**3/3,volume);near((r/3)**2,k*k);}
 assert(l.steps[3].work.join('').includes('r/R=2'));assert(l.transfer.answer.includes('324π'));assert(l.transfer.answer.includes('972π'));
});
test('same volume does not determine surface area for unrelated shapes and zero radius is excluded',()=>{
 near(2*1*.5,1);near(2*(2*1+2*.5+1*.5),7);assert.notEqual(7,6);
 assert(l.counter.answer.includes('封闭表面积却分别为6和7'));assert(l.steps[4].work.join('').includes('半径0'));assert(l.steps[4].work.join('').includes('k>0'));
});
test('figures reveal radius after definition and keep proportional comparison at one length scale',()=>{
 const initial=lib.mathFigure(l,{stage:0},true),first=lib.mathFigure(l,l.steps[0].visual);assert(!initial.includes('R=3'));assert(!initial.includes('>O</text>'));assert(first.includes('R=3'));
 const compare=lib.mathFigure(l,l.steps[3].visual);assert(compare.includes('cx="110" cy="175" r="45"'));assert(compare.includes('cx="310" cy="175" r="90"'));assert(compare.includes('题给体积比8'));assert(compare.includes('面积比4'));
 const surfaces=lib.mathFigure(l,l.steps[1].visual);assert(surfaces.includes('S₀=9π'));assert(surfaces.includes('不是球面的平面展开'));for(const s of l.steps.filter(s=>s.visual))assert(!/NaN|undefined|Infinity/.test(lib.mathFigure(l,s.visual)));
 assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('S01 prerequisite route and reciprocal exam links retain subjects and frequency records',()=>{
 assert(lib.mathNodes.find(n=>n.id==='S01').lessons.includes(l.id));for(const r of l.related)assert(lib.getMathLesson(r.id));for(const id of ['sphere-section','exam2022-8','exam2023-12'])assert(lib.getMathLesson(id).related.some(r=>r.id===l.id));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);
});
