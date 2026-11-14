import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('exam2022-8');
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),V=h=>2*h*h*(6-h)/3;
test('2022 Q8 is the square pyramid and circumsphere problem, with complete choices and six segments',()=>{
 assert.equal(q.steps.length,6);assert(q.conditions[0].includes('正四棱锥'));assert(q.conditions[0].includes('36π'));assert(q.conditions[1].includes('C. [27/4，64/3]'));
 for(const s of q.steps){assert(q.conditions.join('；').includes(s.evidence));assert(s.why&&s.result&&s.point&&s.work.length);}
 const html=lib.mathDetail('math-exam2022-8');assert(!/undefined|NaN|Infinity/.test(html));assert(!html.includes('href="http'));assert.equal((html.match(/class="tb-circle-beat"/g)||[]).length,6);
});
test('sphere radius, axial equation, side edges and square-base volume agree for all allowed heights',()=>{
 close(4*Math.PI*3**3/3,36*Math.PI);
 for(const h of [1.5,2,3,4,4.5]){const rho2=h*(6-h),rho=Math.sqrt(rho2),l=Math.sqrt(h*h+rho2);assert(rho2>0);close(rho2+(h-3)**2,9);close(l*l,6*h);assert(l>=3-1e-9&&l<=3*Math.sqrt(3)+1e-9);close((2*rho)**2/2,2*rho2);close(2*rho2*h/3,V(h));}
});
test('nonnegative polynomial identities establish global min/max and both are geometrically attainable',()=>{
 for(let i=0;i<=300;i++){const h=1.5+i/100;close(V(h)-27/4,(2/3)*(h-1.5)*(h*(4.5-h)+27/4));close(64/3-V(h),(2/3)*(h-4)**2*(h+2));assert(V(h)>=27/4-1e-9&&V(h)<=64/3+1e-9);}
 close(V(1.5),27/4);close(V(4),64/3);const lMaxV=Math.sqrt(24);assert(lMaxV>=3&&lMaxV<=3*Math.sqrt(3));close(V(4.5),81/4);assert(V(4)>V(4.5));
});
test('transfer handles a base through the sphere center and section figures are valid and scoped',()=>{
 const l=3*Math.sqrt(2),h=l*l/6;close(h,3);close(V(h),18);close(h*(6-h),9);
 for(const s of q.steps)if(s.visual){const svg=lib.mathFigure(q,s.visual);assert(svg.startsWith('<svg'));assert(!/undefined|NaN|Infinity/.test(svg));assert(svg.includes('辅助截面'));assert(svg.includes('不是完整棱锥图'));}
 assert(!lib.mathFigure(q,{stage:1}).includes('h=4'));assert(lib.mathFigure(q,{stage:3,height:4}).includes('h=4'));
 for(const height of [2,4]){const svg=lib.mathFigure(q,{stage:height===4?3:2,height}),rho=svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>ρ<\/text>/),radius=svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>3<\/text>/);assert(rho&&radius);assert(Math.abs(Number(rho[2])-Number(radius[2]))>=20,'rho and sphere-radius label must not overlap');}
});
test('index correction is explicit without adding or duplicating a source question',()=>{
 const html=lib.mathResources(),keys=[...html.matchAll(/data-exam-source-key="([^"]+)"/g)].map(m=>m[1]);assert.equal(keys.length,13);assert.equal(keys.filter(k=>k==='gaokao-2022-I-8').length,1);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('正四棱锥各顶点共球'));assert(!html.includes('正四棱台的体积取值范围'));assert(html.includes('data-math-next="math-exam2022-8"'));
});
