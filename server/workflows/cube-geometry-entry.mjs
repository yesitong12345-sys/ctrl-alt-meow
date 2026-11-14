import {compilePolyhedronGeometryIR} from './polyhedron-geometry-engine.mjs';

export function parseCubeGeometryText(questionText = '') {
  const text = String(questionText).replace(/[Ａ-Ｚａ-ｚ０-９]/g, value => String.fromCharCode(value.charCodeAt(0) - 0xfee0))
    .replace(/([A-D])(?:\s*[₁1]|_1)\b/gi, '$1' + '1').replace(/\s+/g, ' ').trim();
  const compactTopology = text.toUpperCase().replace(/\s+/g, '').replace(/_/g, '');
  if (!/正方体/i.test(text) || !/ABCD[-—–]A1B1C1D1/.test(compactTopology)) return null;
  const match = text.match(/棱长\s*(?:为|是|=)?\s*(\d+(?:\.\d+)?|一|二|三|四|五|六|七|八|九|十)/i);
  if (!match) return null;
  const chinese = {一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
  const edge = chinese[match[1]] || Number(match[1]);
  if (!(edge > 0)) return null;
  return {text, edge};
}

export function buildVerifiedCubeGeometry({edge}) {
  const compiled = compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cube',edge},queries:[]});
  if (compiled.status !== 'verified_unique') throw new Error('CUBE_EDGE_VALIDATION_FAILED');
  return {
    ...compiled.result,
    answer:{displayPlain:'请按各选项逐项验证。',latex:''},
    verification:{...compiled.result.verification,answerUnique:false,embeddingUnique:true,sourceGrounding:'deterministic-cube-parser'},
    modelNote:'基础正方体由统一多面体 IR、真实棱长和标准拓扑确定；动点和每个选项需要的辅助线会随当前小问单独显示。'
  };
}
