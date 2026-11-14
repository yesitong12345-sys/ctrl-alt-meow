import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('tetra-dihedral');
const close=(a,b)=>assert(Math.abs(a-b)<1e-10);
test('same complete question now has a geometry main solution and separately identified vector comparison',()=>{
 assert.equal(l.steps.filter(s=>!s.optional).length,5);assert.equal(l.steps.filter(s=>s.optional).length,2);
 assert(!l.prerequisites.join('').includes('向量'));assert(l.optionalPrerequisites.join('').includes('数量积'));
 assert(l.conditions[0].includes('OA=OB=OC=2'));assert(l.steps[1].work.join('').includes('取BC中点M'));
});
test('independent lengths and cosine law agree at both original and transfer scales',()=>{
 for(const a of [2,3]){const bc=Math.hypot(a,a),bm=bc/2,om=Math.sqrt(a*a-bm*bm),ab=Math.hypot(a,a),am=Math.sqrt(ab*ab-bm*bm);close((am*am+om*om-a*a)/(2*am*om),1/Math.sqrt(3));close(om,a/Math.sqrt(2));close(am,a*Math.sqrt(1.5));}
 assert(l.transfer.answer.includes('27/2+9/2−9'));assert(l.steps[3].work.join('').includes('AO²=AM²+OM²−2AM·OM'));
});
test('the named halfplanes matter and intersecting face lines do not suffice',()=>{
 const a=[2,-1,-1],o=[0,-1,-1],bc=[0,-2,2],dot=(x,y)=>x.reduce((s,v,i)=>s+v*y[i],0);assert.equal(dot(a,bc),0);assert.equal(dot(o,bc),0);assert(dot(a,o)>0);assert(dot(a.map(x=>-x),o)<0);
 assert.notEqual(dot([-2,2,0],bc),0);assert.notEqual(dot([0,2,0],bc),0);assert(l.steps[4].work.join('').includes('−√3/3'));assert(l.counter.answer.includes('并未同时垂直'));
});
test('main conclusion precedes a collapsed optional comparison without altering other cards',()=>{
 const html=lib.mathDetail('math-tetra-dihedral'),mark=html.indexOf('data-math-optional');assert(mark>0);
 assert(!/<details[^>]*data-math-optional[^>]*\bopen\b/.test(html));assert(html.indexOf('id="tb-math-step-5"')<mark);assert(html.indexOf('id="tb-math-step-6"')>mark);
 assert(html.slice(0,mark).includes('<b>本题结论</b>'));assert(html.slice(mark).includes('此对照先备'));assert(html.includes('对照2.'));assert(!lib.mathDetail('math-sphere-section').includes('data-math-optional'));
 const resources=lib.mathResources(),video=resources.slice(resources.indexOf('图文转视频的制作提示词'));assert(!video.includes('沿三条正交棱建系，把M坐标补全'));
});
test('geometric route exposes the same card and original diagram does not leak midpoint M',()=>{
 const html=lib.mathDirectory(),route=html.split('data-math-learning-route="geometry-measures"')[1].split('</section>')[0];assert.equal((route.match(/data-open-method=/g)||[]).length,5);assert(route.includes('math-tetra-dihedral'));
 assert(!lib.mathFigure(l,{stage:0},true).includes('>M</text>'));assert(!lib.mathFigure(l,l.steps[0].visual).includes('>M</text>'));for(const s of l.steps.filter(s=>s.visual).slice(1)){const svg=lib.mathFigure(l,s.visual);assert(svg.includes('>M</text>'));assert(!/NaN|undefined/.test(svg));}
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);assert(lib.mathResources().includes('351段'));
});
