import {createHash, randomUUID} from 'node:crypto';

const evidence = content => { const text=String(content||'').trim();if(!text)throw new TypeError('confirmed source evidence requires content');return {id:'ev-source',kind:'text',content:text,status:'confirmed'}; };
const asserted = (value, evidenceRefs = ['ev-source']) => ({...value, factKind: 'assertedFact', status: 'confirmed', confidence: 1, evidenceRefs, normalizationRule: 'verified-legacy-adapter'});
const validExact = value => {
  if(!value||typeof value!=='object')return false;
  if(value.op==='integer')return Number.isSafeInteger(value.value);
  if(value.op==='rational')return Number.isSafeInteger(value.p)&&Number.isSafeInteger(value.q)&&value.q>0;
  if(['sqrt','neg'].includes(value.op))return validExact(value.arg);
  if(['add','mul'].includes(value.op))return Array.isArray(value.args)&&value.args.length>0&&value.args.every(validExact);
  return false;
};

const common = source => ({
  schemaVersion: 'geometry-ir/v3.0',
  stage: 'normalized',
  problemId: source.problemId || source.caseId || randomUUID(),
  coordinateSystem: {dimension: 3, handedness: 'right', lengthUnit: 'unit'},
  sourceEvidence: [evidence(source.problem?.questionText || source.draft?.question)],
  entities: [],
  constraints: [],
  queries: [],
  solutionSet: null,
  derivations: [],
  verification: {status: 'pending'},
  adapter: {from: source.schemaVersion, version: 1}
});

function fromCircular(source) {
  const ir = common(source);
  const bodyId = 'solid-1';
  ir.entities.push(asserted({id: bodyId, type: source.body?.type, role: 'solid', axis: source.body?.axis || 'z'}));
  for (const [name, exact] of Object.entries(source.parameters || {})) {
    ir.constraints.push(asserted({id: `parameter-${name}`, type: 'quantity', subjects: [bodyId], name, value: exact, dimension: 'length'}));
  }
  ir.queries.push({id: 'query-1', type: source.query?.type, subjects: [bodyId]});
  return ir;
}

function fromPyramid(source) {
  const ir = common(source);
  const bodyId = 'solid-1';
  ir.entities.push(asserted({id: bodyId, type: 'regular_quad_pyramid', role: 'solid', apex: 'P', baseVertices: ['A', 'B', 'C', 'D']}),...['P','A','B','C','D','E'].map(id=>asserted({id,type:'point'})),asserted({id:'BE',type:'segment',points:['B','E']}),asserted({id:'PAC',type:'plane',points:['P','A','C']}));
  for (const name of ['baseEdge', 'height']) {
    if (source.parameters?.[name]) ir.constraints.push(asserted({id: `parameter-${name}`, type: 'quantity', subjects: [bodyId], name, value: source.parameters[name], dimension: 'length'}));
  }
  ir.constraints.push(asserted({id:'relation-midpoint-E-PC',type:'midpoint',point:'E',endpoints:['P','C'],subjects:['E','P','C']}));
  ir.queries.push({id: 'query-1', type: 'line_plane_angle_sine', subjects: ['BE','PAC'], line: 'BE', plane: 'PAC'});
  return ir;
}

export function adaptGeometryIRV3(source) {
  if (!source || typeof source !== 'object') throw new TypeError('geometry source is required');
  if (source.schemaVersion === 'geometry-ir/v3.0') return structuredClone(source);
  if (source.schemaVersion === 'geometry-ir/v2') return fromCircular(source);
  if (source.schemaVersion === 'geometry-ir/v1') return fromPyramid(source);
  throw new RangeError(`unsupported geometry IR: ${source.schemaVersion || 'missing'}`);
}

export function validateGeometryIRV3(ir) {
  const errors = [];
  if (ir?.schemaVersion !== 'geometry-ir/v3.0') errors.push({path: 'schemaVersion', code: 'INVALID_SCHEMA_VERSION'});
  if (!['extracted', 'normalized', 'solved', 'verified'].includes(ir?.stage)) errors.push({path: 'stage', code: 'INVALID_STAGE'});
  if(ir?.coordinateSystem?.dimension!==3||ir?.coordinateSystem?.handedness!=='right'||!String(ir?.coordinateSystem?.lengthUnit||'').trim())errors.push({path:'coordinateSystem',code:'INVALID_COORDINATE_SYSTEM'});
  const facts = [...(ir?.entities || []), ...(ir?.constraints || [])];
  const allIds=facts.map(item=>item?.id).filter(Boolean),ids=new Set(allIds),evidenceIds=new Set((ir?.sourceEvidence||[]).map(item=>item?.id));
  if(ids.size!==allIds.length)errors.push({path:'facts',code:'DUPLICATE_ID'});
  for (const fact of facts) {
    if (ir?.stage!=='extracted'&&fact?.status !== 'confirmed') errors.push({path: fact?.id || 'fact', code: 'UNCONFIRMED_FACT'});
    if (fact?.factKind !== 'assertedFact' || !Array.isArray(fact.evidenceRefs) || !fact.normalizationRule) errors.push({path: fact?.id || 'fact', code: 'INVALID_ASSERTED_FACT'});
    for(const ref of fact?.evidenceRefs||[])if(!evidenceIds.has(ref))errors.push({path:fact?.id||'fact',code:'DANGLING_EVIDENCE_REFERENCE',ref});
    if(fact?.type==='quantity'&&!validExact(fact.value))errors.push({path:fact.id,code:'INVALID_EXACT_EXPRESSION'});
    if(fact?.type==='midpoint'&&(!fact.point||!Array.isArray(fact.endpoints)||fact.endpoints.length!==2||fact.subjects?.[0]!==fact.point||!fact.endpoints.every((item,index)=>fact.subjects?.[index+1]===item)))errors.push({path:fact.id,code:'INVALID_MIDPOINT_ROLES'});
  }
  for(const entity of ir?.entities||[])for(const ref of [...(entity.points||[]),...(entity.baseVertices||[]),...(entity.apex?[entity.apex]:[])])if(!ids.has(ref))errors.push({path:entity.id,code:'DANGLING_REFERENCE',ref});
  for (const item of [...(ir?.constraints || []), ...(ir?.queries || [])]) {
    for (const ref of item?.subjects || []) if (!ids.has(ref)) errors.push({path: item.id, code: 'DANGLING_REFERENCE', ref});
  }
  if (ir?.stage === 'normalized' && ir?.verification?.status !== 'pending') errors.push({path: 'verification.status', code: 'INVALID_STAGE_PAYLOAD'});
  if(ir?.stage==='verified'&&(!ir?.solutionSet||ir?.verification?.status!=='verified'||!ir?.scene))errors.push({path:'stage',code:'INVALID_VERIFIED_PAYLOAD'});
  return {valid: errors.length === 0, errors};
}

export function geometryIRHash(ir) {
  const canonical=value=>Array.isArray(value)?(value.every(item=>item&&typeof item==='object'&&typeof item.id==='string')?[...value].sort((a,b)=>a.id.localeCompare(b.id)):value).map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return createHash('sha256').update(JSON.stringify(canonical(ir))).digest('hex');
}
