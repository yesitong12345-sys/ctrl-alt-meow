import test from 'node:test';
import assert from 'node:assert/strict';
import {assessChemistryInput} from '../workflows/chemistry-input.mjs';

test('已注册反应方程匹配真实互动课程', () => {
  const result = assessChemistryInput('CH4 + O2 → CO2 + H2O');
  assert.equal(result.status, 'supported_reaction');
  assert.equal(result.courseKey, 'combustion_ch4');
});

test('水的电解必须匹配专属断键成键课程', () => {
  const result = assessChemistryInput('2H2O → 2H2 + O2（通电）');
  assert.equal(result.status, 'supported_reaction');
  assert.equal(result.courseKey, 'electrolysis_water');
});

test('单个化学式不能被伪装成化学反应动画', () => {
  const result = assessChemistryInput('H2O');
  assert.equal(result.status, 'formula_only');
  assert.equal(result.formula, 'H2O');
  assert.match(result.message, /只有物质组成/);
  assert.equal(result.courseKey, null);
});

test('库外反应必须说明缺少物种或原子映射，不能回退到甲烷燃烧', () => {
  const result = assessChemistryInput('2SO2 + O2 → 2SO3');
  assert.equal(result.status, 'unsupported_reaction');
  assert.equal(result.courseKey, null);
  assert.ok(result.unsupportedSpecies.includes('SO2'));
  assert.ok(result.unsupportedSpecies.includes('SO3'));
});
