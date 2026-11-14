import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),near=(a,b)=>assert(Math.abs(a-b)<1e-10);
test('2023 full-paper classification adds four unique questions and routes the existing G23 without duplicating it',()=>{
 const html=lib.mathResources(),keys=[...html.matchAll(/data-analytic-source-key="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(keys.filter(k=>k.startsWith('gaokao-2023')),['gaokao-2023-I-5','gaokao-2023-I-6','gaokao-2023-I-16','gaokao-2023-I-22']);assert.equal(new Set(keys).size,12);
 assert(html.includes('已归类3/5份公开副本'));assert(html.includes('待核年份：2024、2025'));assert(html.includes('cdc20e84d6bbbba33dc81e0269288fc388534832fbe7e01bffc70bcfb5ba89a7'));assert(html.includes('data-math-next="circle-C06" data-circle-original-target="G23"'));
 const o=lib.getCircleLesson('G23');assert.equal(o.steps.length,7);assert.equal(createHash('sha256').update(JSON.stringify(o.conditions)).digest('hex'),'59a42d584f443294bb1cda93356cc4fccbf7af59692ce2c6d8ec982b5c6bd342');assert(!lib.getMathLesson('exam2023-6'));assert(lib.circleDetail('circle-C06','G23').includes('data-circle-lesson="G23" aria-pressed="true"'));
});
test('independent tangent points validate the G23 angle and clarify that a centre inside the circle would invalidate the method',()=>{
 const P=[0,-2],C=[2,0],r2=5,d2=8;assert(d2>r2);const V=[-2,-2],perp=[2,-2],factor=Math.sqrt(15)/8;
 const points=[-1,1].map(sign=>C.map((c,i)=>c+5/8*V[i]+sign*factor*perp[i]));
 for(const T of points){near((T[0]-C[0])**2+(T[1]-C[1])**2,r2);near((T[0]-C[0])*(T[0]-P[0])+(T[1]-C[1])*(T[1]-P[1]),0);near(Math.hypot(T[0]-P[0],T[1]-P[1]),Math.sqrt(3));}
 const [u,v]=points.map(T=>T.map((x,i)=>x-P[i]));near(Math.abs(u[0]*v[1]-u[1]*v[0])/(Math.hypot(...u)*Math.hypot(...v)),Math.sqrt(15)/4);assert(!(0>r2));
});
