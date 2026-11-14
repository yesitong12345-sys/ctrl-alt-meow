import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('exam2021-5'),near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
test('full source problem retains four options and proves upper bound and attainability separately',()=>{
 assert.equal(l.sourceKey,'gaokao-2021-I-5');assert.equal(l.conditions.length,5);assert.deepEqual(l.conditions.slice(1),['A. 13','B. 12','C. 9','D. 6']);assert.equal(l.steps.length,5);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence));assert(s.why&&s.work.length&&s.point&&s.result);}
 assert(l.steps[2].work.join('').includes('还须确认'));assert(l.steps[3].work.join('').includes('y²/4=1'));assert(l.steps[4].result.includes('答案C'));assert(lib.mathNodes.find(n=>n.id==='A06').lessons.includes(l.id));assert(lib.mathNodes.find(n=>n.id==='A12').lessons.includes(l.id));
});
test('independent parametrisation verifies focus products, both attaining points, transfer and nonconstant counterexample',()=>{
 for(const [a,b]of [[3,2],[4,2]]){const c=Math.sqrt(a*a-b*b),F=[-c,0],G=[c,0];for(let i=0;i<=120;i++){const t=i*Math.PI/60,M=[a*Math.cos(t),b*Math.sin(t)],u=d(M,F),v=d(M,G);near(u+v,2*a);assert(u*v<=a*a+1e-9);near(u*v,a*a-c*c*Math.cos(t)**2);}for(const sign of [-1,1])near(d([0,sign*b],F)*d([0,sign*b],G),a*a);near(d([a,0],F)*d([a,0],G),b*b);}
});
test('actual diagrams preserve ellipse/foci scale and delay equal-distance positions until verified',()=>{
 const pts=svg=>[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[(+m[1]-230)/44,(170-+m[2])/44]);
 for(let stage=0;stage<=5;stage++){const svg=lib.mathFigure(l,{stage},stage===0),[F,G,M,N]=pts(svg);assert(svg.includes('rx="132" ry="88"'));near(F[0],-Math.sqrt(5));near(G[0],Math.sqrt(5));near(M[0]**2/9+M[1]**2/4,1);assert.equal(!!N,stage>=4);if(stage<4){assert(!svg.includes('M(0,2)'));assert(!svg.includes('u=3'));assert(!svg.includes('另一等号位置'));}else{near(M[0],0);near(M[1],2);near(N[0],0);near(N[1],-2);near(d(M,F),3);near(d(M,G),3);}assert(!/NaN|undefined/.test(svg));}
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
test('partial analytic ledger remains central, traceable and separate from five-paper solid frequencies',()=>{
 const html=lib.mathResources();assert.equal((html.match(/data-analytic-source-key=/g)||[]).length,12);assert.equal((html.match(/data-exam-source-key=/g)||[]).length,13);assert(html.includes('已归类3/5份公开副本'));assert(html.includes('待核不等于零次'));assert(html.includes('78dd21b3f2d582bedcd999142e9a577e3aa61b44893b84d16f2f086390983a15'));assert(html.includes('gaokao-2021-I-21'));assert(html.includes('椭圆焦半径乘积最大值'));assert(!lib.mathDetail('math-exam2021-5').includes('data-analytic-source-key'));
});
