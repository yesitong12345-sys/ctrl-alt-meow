import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {buildSummary} from '../workflows/learning-summary.mjs';

const cases = [
  {id:'math-case',subject:'数学',question:'解方程',knowledgePoints:['方程'],errorCauses:['计算失误'],createdAt:'2026-10-01T00:00:00.000Z'},
  {id:'physics-case',subject:'物理',question:'求场强',knowledgePoints:['电场'],errorCauses:['概念混淆'],createdAt:'2026-10-01T00:00:00.000Z'}
];

test('summary includes per-subject error cause distributions from the same cases', () => {
  const summary = buildSummary({cases,now:new Date('2026-10-05T00:00:00.000Z')});
  assert.deepEqual(summary.errorCauses.items.map(item=>item.cause).sort(), ['概念混淆','计算失误']);
  assert.deepEqual(summary.errorCausesBySubject['数学'].items.map(item=>item.cause), ['计算失误']);
  assert.deepEqual(summary.errorCausesBySubject['物理'].items.map(item=>item.cause), ['概念混淆']);
  const withLegacySubject = buildSummary({cases:[{...cases[0],subject:'数学·几何'}],now:new Date('2026-10-05T00:00:00.000Z')});
  assert.deepEqual(withLegacySubject.errorCausesBySubject['数学'].items.map(item=>item.cause), ['计算失误']);
});

test('switching subject changes the rendered error-cause pie and legend', async () => {
  const summary = buildSummary({cases,now:new Date('2026-10-05T00:00:00.000Z')});
  const source = await readFile(path.resolve(import.meta.dirname,'../../implementation/study-insights.js'),'utf8');
  let feature;
  const document={head:{appendChild(){}},createElement(){return {style:{}};},addEventListener(){},querySelector(){return null;}};
  const window={localStorage:{getItem(){return null;},setItem(){}},__registerStudyInsights(value){feature=value;}};
  vm.runInNewContext(source,{document,window,setInterval,clearInterval,setTimeout,clearTimeout});
  const buttons=new Map();
  const root={innerHTML:'',querySelectorAll(selector){
    if(selector!=='[data-st-subject]')return [];
    return [...this.innerHTML.matchAll(/data-st-subject="([^"]+)"/g)].map(([,subject])=>{
      if(!buttons.has(subject))buttons.set(subject,{dataset:{stSubject:subject}});
      return buttons.get(subject);
    });
  },querySelector(){return null;}};
  const app={state:{tab:'clusters',mistakes:cases},esc(value){return String(value);},request(url){
    if(url==='/v1/study/summary')return Promise.resolve(summary);
    if(url.startsWith('/v1/study/review-queue'))return Promise.resolve({items:[],stats:{due:0,pinned:0},subjects:['数学','物理']});
    if(url==='/v1/study/knowledge-graph')return Promise.resolve({nodes:[],edges:[],coOccurrences:[]});
    if(url==='/v1/knowledge-cards')return Promise.resolve([]);
    return Promise.resolve({});
  },render(){feature.renderStudy(root);}};
  feature.activate(app);
  await new Promise(resolve=>setTimeout(resolve,30));
  const pie=()=>root.innerHTML.split('<h3 style="margin:18px 0 8px">错因分布</h3>')[1].split('</details>')[0];
  assert.match(pie(),/计算失误/);
  assert.match(pie(),/概念混淆/);
  root.querySelectorAll('[data-st-subject]').find(button=>button.dataset.stSubject==='数学').onclick();
  assert.match(pie(),/计算失误/);
  assert.doesNotMatch(pie(),/概念混淆/);
  root.querySelectorAll('[data-st-subject]').find(button=>button.dataset.stSubject==='物理').onclick();
  assert.match(pie(),/概念混淆/);
  assert.doesNotMatch(pie(),/计算失误/);
});
