import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('cube-line-plane-angle');
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),norm=a=>Math.hypot(...a),close=(a,b)=>assert(Math.abs(a-b)<1e-10);
test('existing original keeps its question and adds all three explicit boundary questions',()=>{
 assert(l.conditions[0].includes('棱长为2'));assert(l.conditions[1].includes('直线A′B′、AB、AA′'));assert.equal(l.steps.filter(s=>!s.optional).length,7);assert.equal(l.steps.filter(s=>s.optional).length,1);assert(!l.sourceKey);
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.work.length&&s.why&&s.result&&s.point);}
 assert(!l.prerequisites.join('').includes('向量'));assert(l.optionalPrerequisites.join('').includes('法向量'));
});
test('independent projection dimensions distinguish oblique, parallel, contained and perpendicular lines',()=>{
 for(const a of [2,5]){const p={A:[0,0,0],B:[a,0,0],'A′':[0,0,a],'B′':[a,0,a],'C′':[a,a,a]},n=[0,0,1];
  for(const [from,to,sine,dimension] of [['A','C′',1/Math.sqrt(3),1],['A′','B′',0,1],['A','B',0,1],['A','A′',1,0]]){const u=sub(p[to],p[from]),projected=u.map((x,i)=>x-dot(u,n)*n[i]);close(Math.abs(dot(u,n))/norm(u),sine);assert.equal(norm(projected)>1e-10?1:0,dimension);}
  assert(p['A′'][2]>0&&p['B′'][2]>0);assert.equal(p.A[2],0);assert.equal(p.B[2],0);
 }
});
test('main geometry proves the relation before applying endpoint conventions',()=>{
 const horizontal=l.steps[4].work.join(''),contained=l.steps[5].work.join(''),vertical=l.steps[6].work.join('');assert(horizontal.indexOf('A′不在')<horizontal.indexOf('0°'));assert(contained.includes('包含于'));assert(contained.includes('位置关系不同'));
 assert(vertical.indexOf('AA′⊥平面')<vertical.indexOf('90°'));assert(vertical.includes('仅为点A'));assert(vertical.includes('不能把点A当作一条射影直线'));assert(l.counter.answer.includes('都不对'));assert(l.transfer.answer.includes('正弦1'));
});
test('boundary drawings highlight only the right lines and a point rather than a fabricated projection angle',()=>{
 const parallel=l.steps[4].visual,contained=l.steps[5].visual,vertical=l.steps[6].visual;assert.deepEqual(parallel.active,[['A′','B′'],['A','B'],['A','A′'],['B','B′']]);assert.deepEqual(contained.active,[['A','B']]);assert.deepEqual(vertical.active,[['A','A′']]);assert.equal(vertical.projectionPoint,'A');assert(!vertical.angle);
 const p=l.mesh.points,A=p.A;assert.deepEqual(A,[0,0,0]);const svg=lib.mathFigure(l,vertical);assert(svg.includes('cx="205" cy="260" r="9"'));assert(svg.includes('stroke="#075D49"'));assert(!/NaN|undefined/.test(svg));assert(!lib.mathFigure(l,l.steps[0].visual).includes('r="9"'));
});
test('vector comparison stays collapsed after the complete main solution and preserves counts and sources',()=>{
 const html=lib.mathDetail('math-'+l.id),mark=html.indexOf('data-math-optional');assert(mark>html.indexOf('id="tb-math-step-7"'));assert(mark<html.indexOf('id="tb-math-step-8"'));assert(!/<details[^>]*data-math-optional[^>]*\bopen\b/.test(html));assert(html.slice(0,mark).includes('<b>本题结论</b>'));
 const resources=lib.mathResources();assert(resources.includes('351段'));assert.equal((resources.match(/data-exam-source-key=/g)||[]).length,13);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
 const found=lib.findCards('全部主题','射影 退化','数学');assert(found.some(c=>c.id==='math-'+l.id));assert(found.find(c=>c.id==='math-'+l.id).keywords.includes(l.steps[6].result));
});
