import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('hyperbola-axes-basic'),near=(a,b)=>assert(Math.abs(a-b)<1e-8);
test('authored hyperbola bridge preserves full questions, exact givens, definitions and independent topic classification',()=>{
 assert(l.kind.includes('原创'));assert(!l.sourceKey);assert.equal(l.steps.length,8);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.work.length&&s.why&&s.point&&s.result);}
 assert(l.steps[0].work.join('').includes('A₁(0,a)'));assert(l.steps[3].work.join('').includes('c²=a²+b²'));assert(l.steps[5].work.join('').includes('(2y−x)(2y+x)=0'));assert(l.steps[6].work.join('').includes('18/[√(x²+36)+x]'));
 assert(lib.mathNodes.find(n=>n.id==='A07').lessons.includes(l.id));assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id==='A07'));assert.equal(lib.knowledgeGroups('数学','圆锥曲线').find(g=>g.id==='A07').count,2);
 assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));assert(lib.mathResources().includes('待原卷核验'));
});
test('independent axis and focal calculations, asymptote differences, rotation and mixed-half-axis counterexample',()=>{
 const fullReal=6,fullImag=2*fullReal,a=fullReal/2,b=fullImag/2,c=Math.hypot(a,b);near(a,3);near(b,6);near(c,3*Math.sqrt(5));near(c/a,Math.sqrt(5));assert(a<b&&c>a);
 for(const x of [0,1,3,10,100,100000]){const y=a*Math.sqrt(1+x*x/(b*b));near(y*y/(a*a)-x*x/(b*b),1);const gap=18/(Math.sqrt(x*x+36)+x);near(y-x/2,gap);assert(gap>0);}
 assert(18/(Math.sqrt(10000+36)+100)<18/(Math.sqrt(100+36)+10));
 near((2*a)/(2*b),.5);near(b/a,2);near(Math.hypot(3,12)/3,Math.sqrt(17));assert(Math.abs(Math.sqrt(17)-c/a)>1);
 for(const k of [.2,1,2,5]){const aa=3,bb=k*aa;near(Math.hypot(aa,bb)/aa,Math.sqrt(1+k*k));}
});
test('blue curve coordinates satisfy the equation with equal axes and disclose focal points/asymptotes only when used',()=>{
 const original=lib.mathFigure(l,{stage:0},true);assert(!original.includes('F₁'));assert(!original.includes('a=3'));assert(!original.includes('stroke-dasharray'));
 assert(!lib.mathFigure(l,{stage:1}).includes('y²/9'));
 const s2=lib.mathFigure(l,{stage:2}),s4=lib.mathFigure(l,{stage:4}),s6=lib.mathFigure(l,{stage:6});assert(!s2.includes('F₁'));assert(s4.includes('F₁'));assert.equal((s6.match(/stroke-dasharray/g)||[]).length,6);
 const curves=[...s6.matchAll(/<path d="([^"]+)" fill="none" stroke="#2358B8" stroke-width="2.5"/g)];assert.equal(curves.length,2);
 for(const curve of curves){const points=[...curve[1].matchAll(/[ML]([\d.]+) ([\d.]+)/g)];assert.equal(points.length,201);for(const [,xx,yy]of points){const x=(+xx-230)/18,y=(170-+yy)/18;near(y*y/9-x*x/36,1);}}
 for(const s of l.steps)assert(!/NaN|undefined/.test(lib.mathFigure(l,s.visual)));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
