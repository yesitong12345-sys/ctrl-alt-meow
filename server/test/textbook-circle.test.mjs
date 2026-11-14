import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
test('circle v3 appends 12 maths cards and keeps the 10 chemistry and legacy chord cards',()=>{
 assert.equal(lib.circleVersion,'3.0.0');assert.equal(lib.findCards('全部主题','','数学').filter(c=>!c.expansionLesson).length,13);assert.equal(lib.findCards('全部主题','','化学').length,10);assert(lib.findCards('直线与圆','','数学').some(c=>c.id==='common-chord'));
 for(let n=1;n<=12;n++)assert(lib.getCircleCard('C'+String(n).padStart(2,'0')));
});
test('all 83 segments retain complete calculations, writing points and correct condition citations',()=>{
 const lessons=Array.from({length:12},(_,i)=>lib.getCircleCard('C'+String(i+1).padStart(2,'0')).lesson).concat(['G22','G23','G25','B24'].map(id=>lib.getCircleLesson(id)));
 assert.equal(lessons.reduce((n,l)=>n+l.steps.length,0),83);
 for(const l of lessons){assert(l.intro);assert(l.steps.length>=4);for(const s of l.steps){assert(s.title&&s.why&&s.point&&s.result);assert(s.work.length);assert(l.conditions.join('；').includes(s.evidence));}}
});
test('imported G23 includes named P, C, triangles, supplementary angles and final answer',()=>{
 const html=lib.circleDetail('circle-C06','G23');
 for(const text of ['为P','C(2,0)','PC=2√2','CT₁⊥PT₁','互补','记这个角为β','√15/4','选择B'])assert(html.includes(text),text);
 assert.equal((html.match(/class="tb-circle-beat"/g)||[]).length,7);assert(!html.includes('NaN'));assert(!html.includes('href="http'));assert(!html.includes('18836'));
});
test('all 12 cards render; resources central; no private records or standalone runtime dependency',()=>{
 for(let n=1;n<=12;n++){const html=lib.circleDetail('circle-C'+String(n).padStart(2,'0'));assert(html.includes('完整题目'));assert(html.includes('作答要点'));assert(!html.includes('NaN'));}
 const resources=lib.circleResources();assert(resources.includes('资料汇总'));assert(resources.includes('104'));assert(resources.includes('2025'));
 const js=fs.readFileSync(new URL('../../implementation/textbook-library.js',import.meta.url),'utf8');assert(!/\bfetch\s*\(|localStorage\s*\./.test(js));assert(!js.includes('127.0.0.1:18836'));
});
