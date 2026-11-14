import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const source=fs.readFileSync(new URL('../../implementation/textbook-library.js',import.meta.url),'utf8');
const native=createRequire(import.meta.url)('../../implementation/textbook-library.js');
// Inject only in this test's isolated VM; the shipped module has no fault switch.
function broken(action){
 const seam='function mathFigure(l,visual={stage:0},original=false){';
 assert.equal(source.split(seam).length,2);
 const box={module:{exports:{}}};
 vm.runInNewContext(source.replace(seam,seam+action),box);
 return box.module.exports;
}
const failedFigure=html=>html.match(/<figure[^>]*data-diagram-unavailable="true"[^>]*>[\s\S]*?<\/figure>/g)||[];
test('every expansion drawing offers a keyboard-operable text reading and remains healthy',()=>{
 for(const card of native.findCards('全部主题','','数学').filter(c=>c.expansionLesson)){
  const q=card.expansionLesson,html=native.mathDetail(card.id);
  assert.equal(failedFigure(html).length,0,q.id);
  assert.equal([...html.matchAll(/class="tb-math-figure-text"/g)].length,q.steps.filter(s=>s.visual).length+(q.originalFigure?1:0));
  assert(!/\b(?:NaN|Infinity|undefined)\b/.test(html),q.id);
 }
});
test('original drawing exception preserves question, every step and exercises without leaking details',()=>{
 const lib=broken('if(l.id==="tetra-parallel-section"&&original)throw new Error("private-test-stack");');
 const html=lib.mathDetail('math-tetra-parallel-section'),q=lib.getMathLesson('tetra-parallel-section');
 assert.equal(failedFigure(html).length,1);assert(!html.includes('private-test-stack'));
 assert(html.includes(q.transfer.question));assert(html.includes(q.counter.question));
 for(let i=1;i<=6;i++)assert(html.includes('id="tb-math-step-'+i+'"'));
 const fig=failedFigure(html)[0];assert(fig.includes('class="tb-math-figure-text" open'));
 for(const s of q.steps)assert(!fig.includes(s.result));
});
test('one middle-step failure stays local and its text stops at that segment',()=>{
 const lib=broken('if(l.id==="tetra-parallel-section"&&!original&&visual===l.steps[2].visual)throw new Error("test-only");');
 const q=lib.getMathLesson('tetra-parallel-section'),html=lib.mathDetail('math-tetra-parallel-section'),fig=failedFigure(html)[0];
 assert.equal(failedFigure(html).length,1);assert(fig.includes(q.steps[2].result));
 assert(!fig.includes(q.steps[5].result));assert(html.includes(q.steps[5].result));
 assert.equal([...html.matchAll(/<svg[\s>]/g)].length,6);
 assert(lib.mathDetail('math-tetra-parallel-section','writing').includes('tb-circle-writing'));
 assert.equal(failedFigure(lib.mathDetail('math-cube-angle-translate')).length,0);
});
test('empty and non-finite diagrams degrade safely and a normal re-open recovers',()=>{
 for(const value of ['""','"<svg>NaN</svg>"','"<svg><path d=\\"Infinity\\"/></svg>"','"<svg>undefined</svg>"']){
  const lib=broken('if(l.id==="tetra-parallel-section"&&original)return '+value+';');
  assert.equal(failedFigure(lib.mathDetail('math-tetra-parallel-section')).length,1);
 }
 assert.equal(failedFigure(native.mathDetail('math-tetra-parallel-section')).length,0);
});
test('text alternative escapes mathematical strings instead of creating HTML',()=>{
 const lib=broken('if(l.id==="tetra-parallel-section"&&original)throw new Error("test-only");');
 lib.getMathLesson('tetra-parallel-section').conditions.push('<img src=x onerror=alert(1)>');
 const fig=failedFigure(lib.mathDetail('math-tetra-parallel-section'))[0];
 assert(fig.includes('&lt;img'));assert(!fig.includes('<img'));
});
