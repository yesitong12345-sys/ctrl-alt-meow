import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const library=require('../../implementation/textbook-library.js');
test('chemistry import is v2.2 and subject filters do not replace the existing maths card',()=>{
 assert.equal(library.chemistryVersion,'2.2');
 assert.equal(library.findCards('全部主题','','化学').length,10);
 assert(library.findCards('全部主题','','数学').some(c=>c.id==='common-chord'));
 assert.equal(library.findCards('全部主题','公共弦','数学')[0].id,'common-chord');
 assert.equal(library.findCards('全部主题','公共弦','化学').length,0);
 assert.equal(library.findCards('基础衔接','','化学').length,3);
 assert.equal(library.findCards('电离与酸碱对应','','化学').length,4);
 assert.equal(library.findCards('水解与反应迁移','','化学').length,3);
 assert.equal(library.findCards('全部主题','先化合','化学')[0].id,'chem-c1');
});
test('all original questions, exact condition associations, worked answers and quizzes survive import',()=>{
 let links=0;
 for(let i=1;i<=10;i++){
  const c=library.getChemistryCard('c'+i),l=c.lessons[0];
  assert.equal(l.fullStatement,l.conditions.map(x=>x.exactText).join('\n'));
  assert(c.teaching.mnemonic&&c.teaching.unpack.length>=3&&c.counterexample.answer);
  for(const t of c.teaching.triggers){const condition=l.conditions.find(q=>q.id===t.conditionId);assert(condition.exactText.includes(t.quote));assert(l.steps[t.step-1].uses.includes(t.conditionId));links++;}
  for(const s of l.steps)assert(s.title&&s.action&&s.why&&s.produces.text&&s.warning);
  const q=l.checks[0];assert(q.correct>=0&&q.correct<q.choices.length&&q.answer&&q.explanation);
 }
 assert.equal(links,31);
 const first=library.getChemistryCard('c1');assert(first.lessons[0].fullStatement.includes('甲'));assert(first.lessons[0].steps[2].produces.text.includes('②④'));
});
test('the imported library remains read-only and does not depend on the private standalone site',()=>{
 const js=readFileSync(new URL('../../implementation/textbook-library.js',import.meta.url),'utf8');
 assert(!/\bfetch\s*\(|\bXMLHttpRequest\b|localStorage\s*\./.test(js));
 assert(!js.includes('ion-reaction-methods.bubblyoak16.chatgpt.site'));
 assert(!js.includes('为什么想到这里'));
 assert(js.includes('data-chem-quiz')&&js.includes('data-book-subject'));
});
