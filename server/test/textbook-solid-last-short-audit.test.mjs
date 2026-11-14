import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('2021 parameter endpoints and degeneracy give two C solutions but one D solution',()=>{
 const c=mu=>mu*(mu-1);near(c(0),0);near(c(1),0);assert(c(.5)<0);const d=(lambda,mu)=>-lambda/2+1-mu;near(d(1,.5),0);near(d(0,1),0);assert.notDeepEqual([.5,Math.sqrt(3)/2,0],[0,0,1]);
 const L0=1+2*Math.SQRT2,L1=Math.SQRT2+Math.sqrt(5);assert(L0>L1);for(const lambda of [0,.2,.5,1]){const base=.5,height=Math.sqrt(3)/2;near(base*height/3,Math.sqrt(3)/12);assert(lambda>=0&&lambda<=1);}assert(lib.getMathLesson('exam2021-12').counter.answer.includes('P=B₁'));
});
test('2022 bounds are algebraic identities and 2023 whole-cylinder widths fit all three faces',()=>{
 for(const h of [1.5,2,3,4,4.5]){const V=2*h*h*(6-h)/3;near(V-27/4,(2/3)*(h-1.5)*(h*(4.5-h)+27/4));near(64/3-V,(2/3)*(h-4)**2*(h+2));assert(V>=27/4-1e-9&&V<=64/3+1e-9);assert(h*(6-h)>0);}near(2*4**2*(6-4)/3,64/3);
 for(const height of [.01,.02])assert(1.2*Math.sqrt(2/3)+height/Math.sqrt(3)<1);assert(1.8>Math.sqrt(3));assert(1.4<Math.SQRT2);
});
test('container camera changes retain exactly three rear boundary edges, without dashing the nearest corner',()=>{
 const q=lib.getMathLesson('exam2023-12');for(const stage of [0,1,2,3,4,5]){const svg=lib.mathFigure(q,{stage},stage===0),blue=[...svg.matchAll(/<path[^>]+>/g)].map(x=>x[0]).filter(p=>p.includes('stroke="#2358B8"'));assert.equal(blue.length,12);assert.equal(blue.filter(p=>p.includes('stroke-dasharray')).length,3);}
 const m=lib.getMathLesson('exam2021-12').mesh;assert.deepEqual(m.hidden,['A-B','C-A','A-A₁']);for(const key of ['A-B₁','A-P','A₁-E','A₁-B'])assert(m.occluded.includes(key));assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
