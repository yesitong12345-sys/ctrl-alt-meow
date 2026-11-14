import test from 'node:test';
import assert from 'node:assert/strict';

import {auditSolidGeometryModelInput} from '../workflows/solid-geometry-audit.mjs';
import {normalizeGeometryLanguage} from '../workflows/geometry-language-normalizer.mjs';

test('直三棱柱下标顶点被视为完整拓扑，角度 90° 不得被误读为底边长',()=>{
  const audit=auditSolidGeometryModelInput({
    questionText:'直三棱柱 ABC-A₁B₁C₁，∠ACB=90°，AC=BC，D、E 为 AB、AC₁ 中点。证 DE∥平面 BCC₁B₁；CC₁=2、DE 与平面 ACC₁A₁ 成 45° 角，求 DE 到平面 BCC₁B₁ 的距离。'
  });

  assert.equal(audit.facts.bodyType,'prism');
  assert.equal(audit.facts.topologyComplete,true);
  assert.equal(audit.facts.baseExpression,null);
  assert.equal(audit.facts.baseEdge,null);
  assert.equal(audit.missingItems.some(item=>item.id==='solid-topology'),false);
});

test('简写“证 DE∥平面…”被识别为证明目标，不当成题目已知条件',()=>{
  const normalized=normalizeGeometryLanguage('直三棱柱 ABC-A₁B₁C₁。证 DE∥平面 BCC₁B₁。');

  assert.equal(normalized.relationMentions[0].role,'query');
  assert.ok(normalized.queryMentions.some(item=>item.kind==='proof'));
});
