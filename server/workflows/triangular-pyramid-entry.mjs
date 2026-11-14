import {randomUUID} from 'node:crypto';

const asserted = value => ({...value, factKind:'assertedFact', status:'confirmed', confidence:1, evidenceRefs:['ev-source'], normalizationRule:'triangular-pyramid-projection-dihedral-v1'});
const integer = value => ({op:'integer', value});
const sqrt = value => ({op:'sqrt', arg:integer(value)});
const add = (...args) => ({op:'add', args});

function normalize(value) {
  return String(value || '')
    .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0))
    .replace(/\\\(|\\\)|\$|\s+/g, '')
    .replace(/\\sqrt\{(\d+)\}/g, '√$1')
    .replace(/[—–]/g, '-');
}

function parsePositiveExact(expression) {
  const text = normalize(expression);
  if (/^\d+$/.test(text)) return integer(Number(text));
  const sum = text.match(/^(\d+)\+√(\d+)$/);
  if (sum) return add(integer(Number(sum[1])), sqrt(Number(sum[2])));
  const radical = text.match(/^√(\d+)$/);
  return radical ? sqrt(Number(radical[1])) : null;
}

/**
 * Registered, verified family—not an LLM guess. It accepts the textbook
 * projection/dihedral tetrahedron family whose coordinate embedding is unique
 * up to rigid motion and reflection.
 */
export function parseProjectionDihedralTriangularPyramid(questionText) {
  const original = String(questionText || '').trim();
  const text = normalize(original).toUpperCase();
  if (!/三棱锥A-BCD/.test(text)) return null;
  const required = [
    /A.{0,10}平面BCD.{0,8}(射影|投影).{0,3}O/,
    /BO⊥CD|BO垂直(?:于)?CD/,
    /AD⊥BC|AD垂直(?:于)?BC/,
    /∠?BCD=60°/,
    /二面角A-BC-D[、,，]A-CD-B.{0,18}60°[、,，]45°?/
  ];
  if (required.some(pattern => !pattern.test(text))) return null;
  const lengthMatch = original.match(/BC\s*=\s*((?:\d+\s*\+\s*)?(?:\$?\\sqrt\{\d+\}\$?|√\d+)|\d+)/i);
  const bc = parsePositiveExact(lengthMatch?.[1]);
  if (!bc) return null;

  const pointIds = ['A','B','C','D','O'];
  return {
    schemaVersion:'geometry-ir/v3.0', stage:'normalized', problemId:randomUUID(),
    coordinateSystem:{dimension:3, handedness:'right', lengthUnit:'unit'},
    sourceEvidence:[{id:'ev-source', kind:'text', content:original, status:'confirmed'}],
    entities:[
      asserted({id:'solid-1', type:'triangular_pyramid', role:'solid', apex:'A', baseVertices:['B','C','D']}),
      ...pointIds.map(id => asserted({id, type:'point'})),
      asserted({id:'base-BCD', type:'plane', points:['B','C','D']}),
      asserted({id:'line-AD', type:'segment', points:['A','D']})
    ],
    constraints:[
      asserted({id:'projection-A-O-BCD', type:'orthogonal_projection', point:'A', projection:'O', plane:'base-BCD', subjects:['A','O','base-BCD']}),
      asserted({id:'perpendicular-BO-CD', type:'perpendicular', lines:[['B','O'],['C','D']], subjects:['B','O','C','D']}),
      asserted({id:'perpendicular-AD-BC', type:'perpendicular', lines:[['A','D'],['B','C']], subjects:['A','D','B','C']}),
      asserted({id:'angle-BCD', type:'angle_degrees', points:['B','C','D'], value:integer(60), subjects:['B','C','D']}),
      asserted({id:'dihedral-A-BC-D', type:'dihedral_degrees', edge:['B','C'], sidePoints:['A','D'], value:integer(60), subjects:['A','B','C','D']}),
      asserted({id:'dihedral-A-CD-B', type:'dihedral_degrees', edge:['C','D'], sidePoints:['A','B'], value:integer(45), subjects:['A','B','C','D']}),
      asserted({id:'length-BC', type:'quantity', subjects:['B','C'], name:'BC', value:bc, dimension:'length'})
    ],
    queries:[
      {id:'query-proof', type:'prove_perpendicular', subjects:['A','B','C','D'], lines:[['A','B'],['C','D']]},
      {id:'query-sine', type:'line_plane_angle_sine', subjects:['line-AD','base-BCD'], line:'line-AD', plane:'base-BCD'},
      {id:'query-volume', type:'solid_volume', subjects:['solid-1']}
    ],
    subproblems:[
      {id:'q1', index:1, title:'证明 AB⊥CD', prompt:'证明 AB⊥CD。', queryId:'query-proof', rubricId:'triangular_projection_q1', sceneViewId:'q1'},
      {id:'q2', index:2, title:'求 AD 与平面 BCD 所成角的正弦值', prompt:'求 AD 与平面 BCD 所成角的正弦值。', queryId:'query-sine', rubricId:'triangular_projection_q2', sceneViewId:'q2'},
      {id:'q3', index:3, title:'求三棱锥 A-BCD 的体积', prompt:'求三棱锥 A-BCD 的体积。', queryId:'query-volume', rubricId:'triangular_projection_q3', sceneViewId:'q3'}
    ],
    solutionSet:null, derivations:[], verification:{status:'pending'},
    adapter:{from:'textbook-projection-dihedral-family', version:1},
    tutorRubricId:'triangular_pyramid_projection_dihedral'
  };
}
