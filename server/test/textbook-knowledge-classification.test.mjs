import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const library=require('../../implementation/textbook-library.js');

test('every readable method and recent review has a named knowledge group and color',()=>{
  const cards=library.findCards('全部主题','','');
  for(const card of [...cards,...library.findRecentReviews('全部主题','').map(c=>({...c,id:'review-'+c.id}))]){
    const groups=library.knowledgeFor(card);
    assert.ok(groups.length,card.id);
    assert.ok(groups.every(group=>group.title&&['blue','teal','violet','amber','rose','slate'].includes(group.tone)),card.id);
  }
});

test('knowledge filtering intersects subject, chapter and text search',()=>{
  const distance=library.findCards('立体几何','','数学','S11');
  assert.ok(distance.some(c=>c.id==='math-space-point-line-distance'));
  assert.ok(distance.some(c=>c.id==='math-parallel-plane-distance'));
  assert.ok(distance.every(c=>c.topic==='立体几何'));
  assert.equal(library.findCards('直线与圆','','数学','S11').length,0);
  assert.deepEqual(library.findCards('全部主题','电荷','化学','H-PAIR').map(c=>c.id),['chem-c6']);
  assert.equal(library.findCards('全部主题','no-such-method','数学','S11').length,0);
  assert.equal(library.findCards('全部主题','','化学','S11').length,0);
});

test('knowledge counts are computed from unique cards within the selected chapter',()=>{
  for(const subject of ['数学','化学'])for(const group of library.knowledgeGroups(subject)){
    const matches=library.findCards('全部主题','',subject,group.id);
    assert.equal(group.count,matches.length,group.id);
    assert.equal(new Set(matches.map(card=>card.id)).size,matches.length,group.id);
  }
  const groups=library.knowledgeGroups('化学','水解与反应迁移');
  assert.ok(groups.some(g=>g.id==='H-HYDRO'&&g.count===1));
  assert.ok(!groups.some(g=>g.id==='H-DEF'));
});

test('primary color follows the central method while preserving cross-topic labels',()=>{
  assert.equal(library.knowledgeFor('math-cube-perp')[0].id,'S04');
  assert.equal(library.knowledgeFor('math-space-point-line-distance')[0].id,'S11');
  assert.equal(library.knowledgeFor('chem-c3')[0].id,'H-EQUATION');
  assert.ok(library.knowledgeFor('chem-c3').some(group=>group.id==='H-BALANCE'));
  assert.equal(library.knowledgeFor('not-a-card').length,0);
});
