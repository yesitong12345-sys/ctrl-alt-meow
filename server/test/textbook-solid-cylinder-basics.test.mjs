import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('cylinder-basics'),close=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('full original separates axial-section dimensions, surfaces, lid condition and volume',()=>{
 assert.equal(l.kind,'原创课内题');assert(!l.sourceKey);assert.equal(l.steps.length,6);assert(l.conditions[0].includes('经过轴'));assert(l.conditions[2].includes('忽略材料厚度'));
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.work.length&&s.why&&s.result&&s.point&&s.hint);}
 assert(l.steps[0].work.join('').includes('命名为长方形ABB′A′'));assert(l.steps[1].work.join('').includes('r=6/2=3'));assert(l.steps[3].work.join('').includes('不把材料内外两面再重复计算'));
});
test('independent diameter and area calculations verify all five requested quantities',()=>{
 const h=8,d=10,diameter=Math.sqrt(d*d-h*h),r=diameter/2,base=Math.PI*r*r,side=2*Math.PI*r*h;close(r,3);close(side/Math.PI,48);close((side+2*base)/Math.PI,66);close((side+base)/Math.PI,57);close((Math.PI*diameter**2*h/4)/Math.PI,72);
 let circumference=0;for(let i=0;i<2000;i++){const a=i*2*Math.PI/2000,b=(i+1)*2*Math.PI/2000;circumference+=Math.hypot(r*Math.cos(b)-r*Math.cos(a),r*Math.sin(b)-r*Math.sin(a));}assert(Math.abs(circumference*h-side)<.0001);
});
test('height-only transfer can keep side area while changing radius, bottoms and volume',()=>{
 const r=Math.sqrt(100-36)/2,h=6;close(r,4);close(2*r*h,48);close(2*r*h+2*r*r,80);close(2*r*h+r*r,64);close(r*r*h,96);assert(l.transfer.answer.includes('96π cm³'));assert(l.transfer.answer.includes('不意味着半径'));
});
test('a non-axial vertical section determines a chord rather than a unique radius',()=>{
 for(const r of [3,4,5,6]){const offset=Math.sqrt(r*r-9),chord=2*Math.sqrt(r*r-offset*offset);close(chord,6);close(Math.hypot(chord,8),10);}
 assert(l.counter.answer.includes('半径可以是5'));assert(l.steps[5].work.join('').includes('d=h'));assert(l.steps[5].work.join('').includes('d<h'));
});
test('drawings reveal radius after derivation and use true common scale for flat surface pieces',()=>{
 const original=lib.mathFigure(l,{stage:0},true),first=lib.mathFigure(l,l.steps[0].visual);assert(!original.includes('r=3'));assert(!original.includes('>O</text>'));assert(first.includes('AB=2r'));assert(!first.includes('r=3'));assert(lib.mathFigure(l,l.steps[1].visual).includes('r=3 cm'));
 const net=lib.mathFigure(l,l.steps[2].visual),rect=net.match(/<rect x="110" y="110" width="([^"]+)" height="([^"]+)"/);assert(rect);close(Number(rect[1])/Number(rect[2]),6*Math.PI/8);
 const pieces=lib.mathFigure(l,l.steps[3].visual);assert.equal((pieces.match(/r="36"/g)||[]).length,2);assert(pieces.includes('无盖不计圈出的顶面'));assert(pieces.includes('#7A4510'));assert(pieces.includes('48π+9π=57π'));
 assert(original.includes('M84 276A66 20 0 0 1 216 276'));assert(original.includes('stroke-dasharray="6 5"'));const volume=lib.mathFigure(l,l.steps[4].visual);assert(volume.includes('fill-opacity=".6" stroke="none"'));assert(volume.indexOf('fill-opacity=".6" stroke="none"')<volume.indexOf('M84 276A66 20 0 0 1 216 276'));assert(!volume.includes('fill-opacity=".6" stroke="#075D49"'));for(const s of l.steps.filter(s=>s.visual))assert(!/NaN|undefined/.test(lib.mathFigure(l,s.visual)));assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('geometry-only entry links to the real exam without adding frequency or changing old subjects',()=>{
 const route=lib.mathDirectory().match(/data-math-learning-route="geometry-solids"[\s\S]*?<\/section>/)[0];assert.equal((route.match(/data-open-method=/g)||[]).length,7);assert(route.includes('math-cylinder-basics'));assert(!l.prerequisites.join('').includes('向量'));
 assert(lib.mathNodes.find(n=>n.id==='S01').lessons.includes(l.id));for(const id of ['cone-height','exam2024-5'])assert(lib.getMathLesson(id).related.some(r=>r.id===l.id));for(const r of l.related)assert(lib.getMathLesson(r.id));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);const resources=lib.mathResources();assert(resources.includes('351段'));assert(resources.includes('44道原创课内题'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);
});
