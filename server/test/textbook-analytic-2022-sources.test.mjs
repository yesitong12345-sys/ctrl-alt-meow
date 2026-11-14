import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import fs from 'node:fs';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),near=(a,b)=>assert(Math.abs(a-b)<1e-10);
test('three-paper partial ledger keeps unique source identities and does not turn unreviewed years into zero frequency',()=>{
 const html=lib.mathResources(),keys=[...html.matchAll(/data-analytic-source-key="([^"]+)"/g)].map(m=>m[1]);assert.equal(keys.length,12);assert.equal(new Set(keys).size,12);assert.deepEqual(keys.filter(k=>k.startsWith('gaokao-2022')),['gaokao-2022-I-11','gaokao-2022-I-14','gaokao-2022-I-16','gaokao-2022-I-21']);
 assert(html.includes('已归类3/5份公开副本'));assert(html.includes('待核年份：2024、2025'));assert(html.includes('待核不等于零次'));assert(html.includes('bb49d76e2b3bb1720e881f93350b468242cefcf61e7b9a493cfaed9678d53570'));assert(html.includes('扫描件无可用文字层'));assert.equal((html.match(/data-exam-source-key=/g)||[]).length,13);
});
test('existing G22 is routed through its original circle lesson with no duplicate math card or overwritten original',()=>{
 const o=lib.getCircleLesson('G22'),html=lib.mathResources(),detail=lib.circleDetail('circle-C06','G22');assert.equal(o.steps.length,5);assert(o.cards.includes('C06'));
 assert.equal(createHash('sha256').update(JSON.stringify(o.conditions)).digest('hex'),'ba33ed94453156e9fd1c3246af7c9be126712782a1624a0a9c6ddce3b88ad9f1');
 assert(html.includes('data-math-next="circle-C06" data-circle-original-target="G22"'));assert(detail.includes('data-circle-lesson="G22" aria-pressed="true"'));assert(detail.includes('怎样找出一条同时与两圆相切的直线'));assert(!lib.getMathLesson('exam2022-14'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
 const script=fs.readFileSync(new URL('../../implementation/textbook-library.js',import.meta.url),'utf8');assert(script.includes("ui.mathLesson=button.dataset.circleOriginalTarget||''"));
});
test('independent point-line distances verify the reused vertical answer, another valid answer and a one-circle-only trap',()=>{
 const centres=[[0,0],[3,4]],radii=[1,4],distance=([a,b,c],[x,y])=>Math.abs(a*x+b*y+c)/Math.hypot(a,b);
 for(const line of [[1,0,1],[3,4,-5]])centres.forEach((C,i)=>near(distance(line,C),radii[i]));near(Math.hypot(3,4),radii[0]+radii[1]);
 near(distance([0,1,1],centres[0]),1);assert.notEqual(distance([0,1,1],centres[1]),4);
 for(const [T,C,r]of [[[-1,0],centres[0],1],[[-1,4],centres[1],4]]){near(Math.hypot(T[0]-C[0],T[1]-C[1]),r);near(T[0],-1);near(T[1]-C[1],0);}
});
