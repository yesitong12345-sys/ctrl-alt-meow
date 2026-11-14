import {test} from 'node:test';
import assert from 'node:assert/strict';
import contract from '../../implementation/step-visual-contract.js';

test('历史标签锁定时只保留实体名，不能误删 A1 或泄漏推导值',()=>{
  const item={points:['A1','B₁'],label:'A1B₁ = √5',value:Math.sqrt(5)};
  const before=JSON.stringify(item);
  assert.equal(contract.modelLabel(item,false),'A1–B₁');
  assert.equal(contract.modelLabel(item),'A1–B₁');
  assert.equal(contract.modelLabel(item,true),'A1B₁ = √5');
  assert.equal(JSON.stringify(item),before);
});
test('没有实体的旧注释降级，不从未知文字推断已知条件',()=>{
  assert.equal(contract.modelLabel({label:'sin θ = 2/3'},false),'');
  assert.equal(contract.modelLabel({point:'O1',label:'O1(1,2,3)'},false),'O1');
  assert.equal(contract.modelLabel({label:'sin θ = 2/3'},true),'sin θ = 2/3');
  assert.equal(contract.modelLabel({label:'答案'},'true'),'');
});
