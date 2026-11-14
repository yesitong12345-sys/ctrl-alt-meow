import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('circular-frustum-basics');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t);
test('full frustum statement supports six complete derivations and defines each construction',()=>{
 assert.equal(l.kind,'原创课内题');assert(!l.sourceKey);assert.equal(l.steps.length,6);
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.work.length&&s.why&&s.point&&s.result&&s.hint);}
 assert(l.steps[0].work.join('').includes('垂足为H'));assert(l.steps[2].work[0].includes('顶点S'));assert(l.steps[4].work.join('').includes('500π−32π'));assert(l.steps[5].work.join('').includes('R=r'));
});
test('independent numerical slicing verifies volume and lateral area of main and transfer solids',()=>{
 for(const [h,v,a] of [[4,52,35],[8,104,7*Math.sqrt(73)]]){
  let volume=0,side=0;const n=20000,dz=h/n;
  for(let i=0;i<n;i++){const r0=5-3*i/n,r1=5-3*(i+1)/n;volume+=Math.PI*((r0+r1)/2)**2*dz;side+=Math.PI*(r0+r1)*Math.hypot(dz,r1-r0);}
  near(volume/Math.PI,v);near(side/Math.PI,a);
 }
 assert(l.transfer.answer.includes('104π'));assert(l.steps[3].result.includes('64π'));
});
test('unfolded annular sector preserves both circumferences, slant length and area',()=>{
 const outer=25/3,inner=10/3,angle=6*Math.PI/5;
 near(outer-inner,5);near(angle*outer,10*Math.PI);near(angle*inner,4*Math.PI);near(angle*(outer*outer-inner*inner)/2,35*Math.PI);
 const svg=lib.mathFigure(l,l.steps[3].visual);assert(svg.includes('A108 108 0 1 1'));assert(svg.includes('A43.2 43.2 0 1 0'));assert(svg.includes('不是完整圆环'));assert(svg.includes('两个底面另计'));
});
test('axial section has true 3:4:5 geometry and never reveals constructions before definition',()=>{
 const original=lib.mathFigure(l,{stage:0},true),first=lib.mathFigure(l,l.steps[0].visual),second=lib.mathFigure(l,l.steps[1].visual),apex=lib.mathFigure(l,l.steps[2].visual);
 assert(!original.includes('h=4'));assert(!original.includes('>S</text>'));assert(!first.includes('h=4'));assert(first.includes('BH=h'));assert(second.includes('h=4'));assert(!second.includes('>S</text>'));assert(apex.includes('>S</text>'));
 near(Math.hypot(360-270,270-150)/30,5);near((360-270)/30,3);near((270-150)/30,4);near((270-70)/30,20/3);near((150-70)/30,8/3);
 for(const s of l.steps.filter(s=>s.visual))assert(!/NaN|undefined|Infinity/.test(lib.mathFigure(l,s.visual)));
 assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('limits distinguish impossible, zero-height, cone and equal-radius cylinder cases',()=>{
 const end=l.steps[5].work.join('');for(const condition of ['l=R−r','l<R−r','r=0','R=r'])assert(end.includes(condition));
 assert(l.counter.answer.includes('R−r=0不能作分母'));assert(l.counter.answer.includes('20π cm³'));assert(l.counter.answer.includes('28π cm²'));
});
test('S01 and geometric route preserve old lessons and real exam-frequency counts',()=>{
 assert(lib.mathNodes.find(n=>n.id==='S01').lessons.includes(l.id));for(const r of l.related)assert(lib.getMathLesson(r.id));
 assert(l.related.find(r=>r.id==='exam2021-3').label.includes('圆锥'));for(const id of ['cone-height','cylinder-basics'])assert(lib.getMathLesson(id).related.some(r=>r.id===l.id));
 const route=lib.mathDirectory().match(/data-math-learning-route="geometry-solids"[\s\S]*?<\/section>/)[0];assert.equal((route.match(/data-open-method=/g)||[]).length,7);
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
 const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);
});
