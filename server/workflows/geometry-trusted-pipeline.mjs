import {createHash} from 'node:crypto';
import {buildPedagogicalVisualization} from './pedagogical-visualization.mjs';
import {normalizeGeometryLanguage} from './geometry-language-normalizer.mjs';
import {
  createCubeSpec,
  createCuboidSpec,
  createPrismSpec,
  createPyramidSpec,
  createPolyhedronSpec,
  dihedralAngle,
  intersectPolyhedronWithPlane,
  linePlaneAngle,
  pointLineDistance,
  pointPlaneDistance,
  skewLineDistance,
  validatePolyhedronSpec
} from './polyhedron-geometry-engine.mjs';

export const TRUSTED_GEOMETRY_VERSION_KEY = 'geometry-ir-v4:normalizer-v7:capabilities-v2:validator-v12:prompt-v4:review-v2:scene-v3:reference-v3:deepseek-direct-v2:polyhedron-chain-v2:plane-set-v2:dihedral-selection-v2';
export const GEOMETRY_FINAL_STATUS = Object.freeze({
  VERIFIED_UNIQUE:'verified_unique',
  VERIFIED_REPRESENTATIVE:'verified_representative',
  AI_REFERENCE:'ai_reference',
  INPUT_AMBIGUOUS:'input_ambiguous',
  IR_INVALID:'ir_invalid',
  EVIDENCE_FAILED:'evidence_failed',
  CONTRADICTORY:'contradictory',
  UNSUPPORTED_CONSTRAINT_SET:'unsupported_constraint_set',
  UNDERDETERMINED_FOR_QUERY:'underdetermined_for_query',
  PROVIDER_UNAVAILABLE:'provider_unavailable',
  PROVIDER_AUTH_FAILED:'provider_auth_failed',
  PROVIDER_BILLING_REQUIRED:'provider_billing_required',
  PROVIDER_RATE_LIMITED:'provider_rate_limited',
  VALIDATION_FAILED:'validation_failed',
  SOLVER_FAILED:'solver_failed'
});
export const GEOMETRY_STAGE_EVENT = Object.freeze({
  MODEL_REQUEST_STARTED:'model_request_started',
  MODEL_REQUEST_FAILED:'model_request_failed',
  MODEL_RESPONSE_RECEIVED:'model_response_received',
  REVIEW_STARTED:'review_started',
  REVIEW_FAILED:'review_failed',
  FALLBACK_STARTED:'fallback_started',
  FALLBACK_FAILED:'fallback_failed'
});
const independentlyReviewedCandidates=new WeakSet();
const INTERNAL_PIPELINE_RUN=Symbol('internalPipelineRun');
const IR_TOP_LEVEL_FIELDS=new Set(['schemaVersion','entities','explicitFacts','derivedFacts','constraints','queries','evidence']);
const VALIDATOR_CONSTRAINT_KINDS=new Set(['distance','length','ratio','midpoint','projection','perpendicular','parallel','point_on_line','point_on_plane','point_line_distance','point_plane_distance','skew_line_distance','line_plane_angle','dihedral_angle','coplanar','equal_length','angle','polyhedron','polyhedron_section','circle','right_cylinder','cylinder','right_cone','cone','sphere','section_circle','tangent','positive','intersection','quadrilateral_type']);
export function validateSemanticReviewReport(report) {
  const issues=[];
  if(!report||typeof report!=='object'||Array.isArray(report))issues.push({code:'SEMANTIC_REVIEW_REPORT_MISSING'});
  else{
    if(!['approved','corrected','rejected'].includes(report.status))issues.push({code:'SEMANTIC_REVIEW_STATUS_INVALID'});
    for(const field of ['reviewedIssueCodes','reviewedRiskCodes','retainedFactIds','correctedFields'])if(!Array.isArray(report[field]))issues.push({code:'SEMANTIC_REVIEW_FIELD_INVALID',field});
    if(!String(report.evidenceDecision||'').trim())issues.push({code:'SEMANTIC_REVIEW_EVIDENCE_DECISION_MISSING'});
  }
  return {pass:issues.length===0,issues};
}

function independentlyReviewed(candidate){
  const checked=validateSemanticReviewReport(candidate?.semanticReviewReport);
  return independentlyReviewedCandidates.has(candidate)&&checked.pass&&['approved','corrected'].includes(candidate.semanticReviewReport.status);
}

function extractOptionQueries(text) {
  const options = [];
  const pattern = /(?:^|\n)\s*([A-D])\s*[.、:：]\s*([^\n]+)/g;
  for (const match of text.matchAll(pattern)) {
    options.push({id: `query-option-${match[1]}`, optionId: match[1], type: 'boolean_option', statement: match[2].trim()});
  }
  return options;
}

export function normalizeGeometryInput(input = {}) {
  const originalInput = String(input.questionText || input.text || '');
  const normalized = normalizeGeometryLanguage(originalInput);
  const optionQueries = extractOptionQueries(normalized.text);
  const explicitMultiple = /多选|多个正确|所有正确/.test(normalized.text);
  const explicitSingle = /单选|只有一个正确|唯一正确/.test(normalized.text);
  const questionType = optionQueries.length
    ? explicitMultiple ? 'multiple_choice' : explicitSingle ? 'single_choice' : 'choice_unknown'
    : 'constructed_response';
  return {
    schemaVersion: 'geometry-input/v1',
    originalInput,
    imageHash:input.imageData?createHash('sha256').update(String(input.imageData)).digest('hex'):null,
    normalizedInput: normalized.text,
    positionMap: normalized.map,
    semanticClauses: normalized.clauses,
    relationMentions: normalized.relationMentions,
    quantityMentions: normalized.quantityMentions,
    midpointMentions: normalized.midpointMentions,
    parameterMentions: normalized.parameterMentions,
    ratioMentions: normalized.ratioMentions,
    structuralMentions: normalized.structuralMentions,
    queryMentions: normalized.queryMentions,
    conditionAtoms: normalized.conditionAtoms,
    optionQueries,
    questionType,
    inputHash: createHash('sha256').update(normalized.text).update('\u0000').update(String(input.imageData || '')).digest('hex')
  };
}

const capability = (acceptedParameterSets, degreesOfFreedom, degeneracyRules, extra = {}) => Object.freeze({
  acceptedParameterSets, degreesOfFreedom, degeneracyRules,
  derivationRules: extra.derivationRules || [],
  validatorRules: extra.validatorRules || [],
  fallbackSolverStrategies: extra.fallbackSolverStrategies || [],
  sceneAdapter: extra.sceneAdapter || null
});

export const SHAPE_CAPABILITY_REGISTRY = Object.freeze({
  line: capability([['pointA', 'pointB'], ['point', 'direction']], 4, ['distinct_points', 'nonzero_direction'], {validatorRules:['point_on_line','parallel','perpendicular'],fallbackSolverStrategies:['analytic'],sceneAdapter:'segment'}),
  plane: capability([['pointA', 'pointB', 'pointC'], ['point', 'normal'], ['equation']], 3, ['noncollinear_points', 'nonzero_normal'], {validatorRules:['point_on_plane','coplanar','point_plane_distance'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'plane'}),
  circle: capability([['center', 'plane', 'radius'], ['pointA', 'pointB', 'pointC']], 6, ['positive_radius', 'noncollinear_points'], {validatorRules:['circle','tangent'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'section-circle'}),
  cuboid: capability([['origin', 'axes', 'length', 'width', 'height'], ['baseRectangle', 'height']], 9, ['positive_dimensions', 'independent_axes'], {validatorRules:['distance','perpendicular','parallel'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'polyhedron'}),
  cube: capability([['origin', 'axes', 'edge'], ['vertices']], 7, ['positive_edge', 'independent_axes'], {validatorRules:['equal_length','perpendicular','parallel'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'polyhedron'}),
  prism: capability([['basePolygon', 'translation'], ['basePolygon', 'topPolygon']], 'base+3', ['nondegenerate_base', 'nonzero_translation'], {validatorRules:['coplanar','parallel','equal_length'],fallbackSolverStrategies:['analytic','sympy','scipy'],sceneAdapter:'polyhedron'}),
  pyramid: capability([['basePolygon', 'apex'], ['basePolygon', 'apexProjection', 'height']], 'base+3', ['nondegenerate_base', 'apex_outside_base_plane'], {validatorRules:['coplanar','point_plane_distance'],fallbackSolverStrategies:['analytic','sympy','scipy'],sceneAdapter:'polyhedron'}),
  tetrahedron: capability([['vertices'], ['sixEdges'], ['baseTriangle', 'apexConstraints']], 6, ['positive_cayley_menger'], {validatorRules:['distance','coplanar'],fallbackSolverStrategies:['sympy','scipy'],sceneAdapter:'polyhedron'}),
  right_cylinder: capability([['baseCenter', 'topCenter', 'radius'], ['axis', 'radius', 'height']], 7, ['positive_radius', 'positive_height'], {validatorRules:['right_cylinder'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'cylinder'}),
  cylinder: capability([['baseCenter', 'topCenter', 'radius'], ['axis', 'radius', 'height']], 7, ['positive_radius', 'positive_height'], {validatorRules:['right_cylinder','cylinder'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'cylinder'}),
  right_cone: capability([['baseCenter', 'axis', 'radius', 'height'], ['baseCenter', 'axis', 'radius', 'slant']], 7, ['positive_radius', 'positive_height', 'slant_not_shorter_than_radius'], {derivationRules:['slant^2=radius^2+height^2'],validatorRules:['right_cone'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'cone'}),
  cone: capability([['baseCenter', 'axis', 'radius', 'height'], ['baseCenter', 'axis', 'radius', 'slant']], 7, ['positive_radius', 'positive_height', 'slant_not_shorter_than_radius'], {derivationRules:['slant^2=radius^2+height^2'],validatorRules:['right_cone','cone'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'cone'}),
  sphere: capability([['center', 'radius'], ['diameter'], ['sectionRadius', 'planeDistance'], ['fourSurfacePoints']], 4, ['positive_radius', 'noncoplanar_surface_points'], {derivationRules:['radius^2=sectionRadius^2+planeDistance^2'],validatorRules:['sphere','section_circle','tangent'],fallbackSolverStrategies:['analytic','sympy'],sceneAdapter:'sphere'}),
  section: capability([['solid', 'plane']], 0, ['defined_plane', 'nonempty_intersection'], {validatorRules:['section_circle','polyhedron_section','coplanar'],fallbackSolverStrategies:['analytic','sympy','scipy'],sceneAdapter:'section'}),
  section_polygon: capability([['solid', 'plane', 'points']], 0, ['defined_plane', 'at_least_three_points'], {validatorRules:['polyhedron_section','coplanar'],fallbackSolverStrategies:['analytic','sympy','scipy'],sceneAdapter:'section-polygon'})
});

const finiteVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const add = (a, b) => a.map((value, index) => value + b[index]);
const scale = (a, factor) => a.map(value => value * factor);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = value => Math.sqrt(dot(value, value));
const distance = (a, b) => norm(subtract(a, b));
const normalizedResidual = (actual, expected) => Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
const exactNumber = value => {
  if (!Number.isFinite(value)) throw new Error('SCENE_NON_FINITE_NUMBER');
  return Number.isInteger(value) ? {op: 'integer', value} : (() => {
  const text = String(value);
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  if (decimals > 0 && decimals <= 8) {
    const q = 10 ** decimals;
    const p = Math.round(value * q);
    const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
    const divisor = gcd(p, q);
    return {op: 'rational', p: p / divisor, q: q / divisor};
  }
  return {op: 'rational', p: Math.round(value * 1e8), q: 1e8};
  })();
};

function pointIds(ir) {
  return new Set((ir?.entities || []).filter(item => item?.kind === 'point' || item?.type === 'point').map(item => item.id));
}

function evaluateMathExpression(expression, variables) {
  const tokens = String(expression || '').match(/sqrt|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/^]/g) || [];
  let index = 0;
  const peek = () => tokens[index];
  const consume = token => {
    if (token && peek() !== token) throw new Error('DERIVED_EXPRESSION_SYNTAX');
    return tokens[index++];
  };
  const primary = () => {
    const token = peek();
    if (token === '(') {
      consume('(');
      const value = expressionRule();
      consume(')');
      return value;
    }
    if (token === 'sqrt') {
      consume('sqrt'); consume('(');
      const value = expressionRule();
      consume(')');
      if (value < 0) throw new Error('DERIVED_EXPRESSION_DOMAIN');
      return Math.sqrt(value);
    }
    if (/^\d/.test(token || '')) return Number(consume());
    if (/^[A-Za-z_]/.test(token || '')) {
      const name = consume();
      if (!Number.isFinite(Number(variables[name]))) throw new Error(`DERIVED_VARIABLE_MISSING:${name}`);
      return Number(variables[name]);
    }
    throw new Error('DERIVED_EXPRESSION_SYNTAX');
  };
  const unary = () => peek() === '-' ? (consume('-'), -unary()) : peek() === '+' ? (consume('+'), unary()) : primary();
  const power = () => {
    let value = unary();
    if (peek() === '^') { consume('^'); value **= power(); }
    return value;
  };
  const term = () => {
    let value = power();
    while (peek() === '*' || peek() === '/') {
      const op = consume(), next = power();
      value = op === '*' ? value * next : value / next;
    }
    return value;
  };
  const expressionRule = () => {
    let value = term();
    while (peek() === '+' || peek() === '-') {
      const op = consume(), next = term();
      value = op === '+' ? value + next : value - next;
    }
    return value;
  };
  const value = expressionRule();
  if (index !== tokens.length || !Number.isFinite(value)) throw new Error('DERIVED_EXPRESSION_INVALID');
  return value;
}

function evaluateExactValue(value,variables={}){
  if(Number.isFinite(Number(value)))return Number(value);
  if(typeof value==='string')return evaluateMathExpression(value,variables);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('EXACT_VALUE_INVALID');
  const op=value.op||value.type;
  if(op==='integer')return Number(value.value);
  if(op==='rational'){
    const numerator=Number(value.p??value.numerator),denominator=Number(value.q??value.denominator);
    if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||denominator===0)throw new Error('EXACT_RATIONAL_INVALID');
    return numerator/denominator;
  }
  if(op==='sqrt'){
    const radicand=evaluateExactValue(value.value??value.radicand,variables);
    if(radicand<0)throw new Error('EXACT_SQRT_DOMAIN');
    return Math.sqrt(radicand);
  }
  if(op==='neg')return-evaluateExactValue(value.value,variables);
  if(op==='add')return(value.values||value.terms||[]).reduce((sum,item)=>sum+evaluateExactValue(item,variables),0);
  if(op==='mul'||op==='multiply')return(value.values||value.factors||[]).reduce((product,item)=>product*evaluateExactValue(item,variables),1);
  if(op==='symbol'){
    const resolved=variables[value.name];
    if(!Number.isFinite(Number(resolved)))throw new Error(`EXACT_SYMBOL_MISSING:${value.name}`);
    return Number(resolved);
  }
  throw new Error('EXACT_VALUE_UNSUPPORTED');
}

export function runGeometryEvidenceGate(normalized, candidate) {
  const issues = [];
  const risks = [];
  const ir = candidate?.geometryIR;
  for(const field of Object.keys(ir||{}))if(!IR_TOP_LEVEL_FIELDS.has(field))issues.push({code:'IR_UNKNOWN_TOP_LEVEL_FIELD',path:`geometryIR.${field}`});
  if (ir?.schemaVersion !== 'geometry-ir/v4') issues.push({code: 'INVALID_SCHEMA_VERSION', path: 'geometryIR.schemaVersion'});
  for (const name of ['entities', 'explicitFacts', 'derivedFacts', 'constraints', 'queries', 'evidence']) {
    if (!Array.isArray(ir?.[name])) issues.push({code: 'MISSING_ARRAY', path: `geometryIR.${name}`});
  }
  const allItems = [...(ir?.entities || []), ...(ir?.explicitFacts || []), ...(ir?.derivedFacts || []), ...(ir?.constraints || []), ...(ir?.queries || []), ...(ir?.evidence || [])];
  const ids = new Set();
  for (const item of allItems) {
    if (!item?.id) issues.push({code: 'MISSING_ID', path: item?.kind || 'item'});
    else if(!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(item.id))issues.push({code:'NON_CANONICAL_ID',path:item.id});
    else if (ids.has(item.id)) issues.push({code: 'DUPLICATE_ID', path: item.id});
    else ids.add(item.id);
  }
  const evidenceById = new Map((ir?.evidence || []).map(item => [item.id, item]));
  const queryEvidencePattern=/^(?:\s*)(?:求证|证明|证(?=\s*[A-Z])|求|计算|判断|是否)/;
  const queryFactIds=new Set((ir?.explicitFacts||[]).filter(fact=>(fact.evidenceRefs||[]).some(ref=>queryEvidencePattern.test(String(evidenceById.get(ref)?.quote||'')))).map(fact=>fact.id));
  const querySupportIds=new Set((ir?.queries||[]).flatMap(query=>[...(query.factRefs||[]),...(query.facts||[])]));
  if(candidate?.provider==='deepseek'){
    const coverageTypes={explicit_fact:new Set((ir?.explicitFacts||[]).filter(item=>!queryFactIds.has(item.id)).map(item=>item.id)),derived_fact:new Set((ir?.derivedFacts||[]).map(item=>item.id)),query:new Set([...(ir?.queries||[]).map(item=>item.id),...queryFactIds,...querySupportIds])};
    const coverage=new Map((candidate.sourceCoverage||[]).map(item=>[item?.clauseId,item]));
    for(const clause of normalized.semanticClauses||[]){
      const item=coverage.get(clause.id);
      if(!item){issues.push({code:'SOURCE_CLAUSE_UNCOVERED',path:clause.id});continue;}
      if(!['explicit_fact','derived_fact','query','context','unresolved'].includes(item.status))issues.push({code:'SOURCE_COVERAGE_STATUS_INVALID',path:clause.id});
      const [clauseStart,clauseEnd]=clause.normalizedRange||[0,0];
      const semanticAtoms=[...(normalized.conditionAtoms||[]),...(normalized.queryMentions||[])].filter(atom=>{
        const start=atom.normalizedRange?.[0];return Number.isFinite(start)&&start>=clauseStart&&start<clauseEnd;
      });
      if(item.status==='context'&&semanticAtoms.length)issues.push({code:'SOURCE_SEMANTIC_CLAUSE_DOWNGRADED',path:clause.id,atomIds:semanticAtoms.map(atom=>atom.id)});
      if(item.status==='unresolved')risks.push({code:'SOURCE_CLAUSE_UNRESOLVED',path:clause.id});
      if(!Array.isArray(item.refs))issues.push({code:'SOURCE_COVERAGE_REFS_INVALID',path:clause.id});
      else if(!['context','unresolved'].includes(item.status)&&!item.refs.length)issues.push({code:'SOURCE_COVERAGE_REFS_EMPTY',path:clause.id});
      else for(const ref of item.refs){
        if(!ids.has(ref))issues.push({code:'SOURCE_COVERAGE_DANGLING_REF',path:clause.id,ref});
        else if(coverageTypes[item.status]&&!coverageTypes[item.status].has(ref))issues.push({code:'SOURCE_COVERAGE_REF_TYPE_MISMATCH',path:clause.id,ref,expected:item.status});
      }
    }
  }
  const coreSemanticEntityKinds=new Set(['point','segment','angle','vector','ray','arc']);
  for (const entity of ir?.entities || []) {
    const kind = entity.kind || entity.type;
    if (!coreSemanticEntityKinds.has(kind) && !SHAPE_CAPABILITY_REGISTRY[kind]) issues.push({code: 'CAPABILITY_NOT_REGISTERED', path: entity.id, kind});
  }
  const declaredPoints=pointIds(ir),entityById=new Map((ir?.entities||[]).map(item=>[item.id,item]));
  const checkPointRef=(ref,path)=>{if(typeof ref==='string'&&!declaredPoints.has(ref))issues.push({code:'DANGLING_GEOMETRY_REFERENCE',path,ref});};
  const checkGeometryRef=(ref,path)=>{if(typeof ref==='string'&&!declaredPoints.has(ref)&&!entityById.has(ref))issues.push({code:'DANGLING_GEOMETRY_REFERENCE',path,ref});};
  const visitPointRefs=(value,path)=>{
    if(typeof value==='string')return checkPointRef(value,path);
    if(!Array.isArray(value))return;
    if(value.every(item=>typeof item==='number'))return;
    value.forEach((item,index)=>visitPointRefs(item,`${path}.${index}`));
  };
  for(const entity of ir?.entities||[]){
    for(const field of ['points','baseVertices','topVertices'])if(entity[field])visitPointRefs(entity[field],`geometryIR.entities.${entity.id}.${field}`);
    if(Array.isArray(entity.faces))visitPointRefs(entity.faces,`geometryIR.entities.${entity.id}.faces`);
    for(const field of ['center','baseCenter','topCenter','apex','apexProjection'])if(entity[field])checkPointRef(entity[field],`geometryIR.entities.${entity.id}.${field}`);
  }
  for(const constraint of ir?.constraints||[]){
    if(constraint.hard!==false&&!VALIDATOR_CONSTRAINT_KINDS.has(constraint.kind))issues.push({code:'VALIDATOR_RULE_NOT_REGISTERED',path:constraint.id,kind:constraint.kind});
    for(const field of ['points','subjects','vectors','lines','endpoints','linePoints','planePoints','firstLine','secondLine','line','plane','firstPlane','secondPlane','surfacePoints'])if(constraint[field]){
      const value=constraint[field],path=`geometryIR.constraints.${constraint.id}.${field}`;
      if(typeof value==='string')checkGeometryRef(value,path);else visitPointRefs(value,path);
    }
    if(['parallel','perpendicular'].includes(constraint.kind)&&constraint.target)checkGeometryRef(constraint.target,`geometryIR.constraints.${constraint.id}.target`);
    for(const field of ['point','center','baseCenter','topCenter','radiusPoint','rimPoint','apex','touchPoint','sphereCenter'])if(constraint[field])checkPointRef(constraint[field],`geometryIR.constraints.${constraint.id}.${field}`);
    for(const field of ['entity','solid','sphere'])if(constraint[field]&&!ids.has(constraint[field])){
      if(!(field==='entity'&&constraint.kind==='angle'&&Array.isArray(constraint.points)&&constraint.points.length===3))issues.push({code:'DANGLING_ENTITY_REFERENCE',path:`geometryIR.constraints.${constraint.id}.${field}`,ref:constraint[field]});
    }
  }
  for(const construction of candidate?.suggestedConstructions||[]){
    if(construction.points)visitPointRefs(construction.points,`suggestedConstructions.${construction.id}.points`);
    for(const ref of construction.dependsOn||construction.constraintRefs||[])if(!ids.has(ref))issues.push({code:'DANGLING_CONSTRUCTION_DEPENDENCY',path:construction.id,ref});
  }
  const validRegion=box=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[0]>=0&&box[1]>=0&&box[2]>0&&box[3]>0&&box[0]+box[2]<=1&&box[1]+box[3]<=1;
  const overlapRatio=(outer,inner)=>{
    if(!validRegion(outer)||!validRegion(inner))return 0;
    const left=Math.max(outer[0],inner[0]),top=Math.max(outer[1],inner[1]);
    const right=Math.min(outer[0]+outer[2],inner[0]+inner[2]),bottom=Math.min(outer[1]+outer[3],inner[1]+inner[3]);
    return Math.max(0,right-left)*Math.max(0,bottom-top)/(inner[2]*inner[3]);
  };
  if(normalized.imageHash){
    const audit=candidate?.imageAudit;
    if(!audit||typeof audit!=='object')issues.push({code:'IMAGE_AUDIT_MISSING',path:'imageAudit'});
    else{
      if(audit.imageHash!==normalized.imageHash)issues.push({code:'IMAGE_AUDIT_SOURCE_MISMATCH',path:'imageAudit.imageHash'});
      if(!['complete','cropped','uncertain'].includes(audit.pageCompleteness))issues.push({code:'IMAGE_PAGE_COMPLETENESS_INVALID',path:'imageAudit.pageCompleteness'});
      else if(audit.pageCompleteness!=='complete')risks.push({code:'IMAGE_PAGE_NOT_CONFIRMED_COMPLETE',status:audit.pageCompleteness});
      if(!Array.isArray(audit.coverageRegions)||!audit.coverageRegions.length)issues.push({code:'IMAGE_COVERAGE_REGIONS_MISSING',path:'imageAudit.coverageRegions'});
      if(!Array.isArray(audit.unreadableRegions))issues.push({code:'IMAGE_UNREADABLE_REGIONS_MISSING',path:'imageAudit.unreadableRegions'});
      if(!Array.isArray(audit.diagramMarks))issues.push({code:'IMAGE_DIAGRAM_MARKS_MISSING',path:'imageAudit.diagramMarks'});
      const auditedRefs=new Set();
      for(const region of audit.coverageRegions||[]){
        if(!region?.id||!validRegion(region.region)||!['text','diagram','label','answer','option'].includes(region.kind))issues.push({code:'IMAGE_COVERAGE_REGION_INVALID',path:region?.id||'coverageRegion'});
        if(!Array.isArray(region?.evidenceRefs))issues.push({code:'IMAGE_COVERAGE_EVIDENCE_REFS_INVALID',path:region?.id||'coverageRegion'});
        for(const ref of region?.evidenceRefs||[]){
          auditedRefs.add(ref);
          const evidence=evidenceById.get(ref);
          if(!evidence)issues.push({code:'IMAGE_COVERAGE_DANGLING_EVIDENCE',path:region?.id||'coverageRegion',ref});
          else if(evidence.kind!=='image'||overlapRatio(region.region,evidence.region)<.9)issues.push({code:'IMAGE_EVIDENCE_REGION_NOT_COVERED',path:region?.id||'coverageRegion',ref});
        }
      }
      for(const evidence of ir?.evidence||[])if(evidence.kind==='image'&&!auditedRefs.has(evidence.id))issues.push({code:'IMAGE_EVIDENCE_NOT_AUDITED',ref:evidence.id});
      const factsByEvidence=new Map();
      for(const fact of ir?.explicitFacts||[])for(const ref of fact.evidenceRefs||[]){const list=factsByEvidence.get(ref)||[];list.push(fact.id);factsByEvidence.set(ref,list);}
      for(const mark of audit.diagramMarks||[]){
        if(!mark?.id||!String(mark.kind||'').trim()||!Array.isArray(mark.evidenceRefs)||!mark.evidenceRefs.length)issues.push({code:'IMAGE_DIAGRAM_MARK_INVALID',path:mark?.id||'diagramMark'});
        else for(const ref of mark.evidenceRefs){
          if(!evidenceById.has(ref))issues.push({code:'IMAGE_DIAGRAM_MARK_DANGLING_EVIDENCE',path:mark.id,ref});
          else{
            const factIds=new Set(factsByEvidence.get(ref)||[]);
            const compatible=(ir?.constraints||[]).some(constraint=>constraint.kind===mark.kind&&(constraint.factRefs||constraint.sourceFactRefs||[]).some(id=>factIds.has(id)));
            if(!compatible)issues.push({code:'IMAGE_DIAGRAM_MARK_NOT_MODELED',path:mark.id,ref,expectedKind:mark.kind});
          }
        }
      }
      if(!(audit.coverageRegions||[]).some(region=>region.kind==='diagram'))risks.push({code:'IMAGE_DIAGRAM_REGION_NOT_AUDITED'});
      else if(!(audit.diagramMarks||[]).length&&!(audit.marksPresence==='none_confirmed'&&independentlyReviewed(candidate)))risks.push({code:'IMAGE_DIAGRAM_MARKS_EMPTY'});
      if(!(audit.coverageRegions||[]).some(region=>['text','label'].includes(region.kind)))risks.push({code:'IMAGE_TEXT_REGION_NOT_AUDITED'});
      if(normalized.optionQueries?.length&&!(audit.coverageRegions||[]).some(region=>region.kind==='option'))risks.push({code:'IMAGE_OPTIONS_REGION_NOT_AUDITED'});
      if((audit.unreadableRegions||[]).length)risks.push({code:'IMAGE_HAS_UNREADABLE_REGIONS',count:audit.unreadableRegions.length});
    }
  }
  for(const mention of normalized.midpointMentions||[]){
    if(mention.role!=='given')continue;
    const matched=(ir?.constraints||[]).some(item=>{
      if(item.kind!=='midpoint'||item.hard===false||(item.point||item.points?.[0])!==mention.point)return false;
      const segment=typeof item.segment==='string'?entityById.get(item.segment)?.points:null;
      return JSON.stringify([...(item.endpoints||segment||item.points?.slice(1,3)||[])].sort())===JSON.stringify([...mention.endpoints].sort());
    });
    if(!matched)issues.push({code:'SOURCE_MIDPOINT_MISSING',point:mention.point,endpoints:mention.endpoints,sourceRange:mention.normalizedRange});
  }
  const canonicalQuantity=label=>{
    const names=String(label||'').toUpperCase().match(/[A-Z]\d*/g)||[];
    return names.length===2?names.sort().join(''):names.length===3?[names.join(''),[...names].reverse().join('')].sort()[0]:names.join('');
  };
  const canonicalUnit=value=>({厘米:'cm',毫米:'mm',米:'m','°':'deg',度:'deg'}[String(value||'').trim()]||String(value||'').trim().toLowerCase());
  for(const mention of normalized.quantityMentions||[]){
    if(mention.role!=='given')continue;
    let expected;
    try{expected=evaluateMathExpression(mention.expression.replace(/√\s*(\d+(?:\.\d+)?)/g,'sqrt($1)'),{});}catch{issues.push({code:'SOURCE_QUANTITY_UNSUPPORTED',subject:mention.subject});continue;}
    const matching=(ir?.constraints||[]).filter(item=>{
      if(item.hard===false)return false;
      if(mention.kind==='length'&&['length','distance'].includes(item.kind)){
        const pointRefs=item.points||entityById.get(item.entity)?.points||[];
        return canonicalQuantity(pointRefs.join(''))===canonicalQuantity(mention.subject);
      }
      if(mention.kind==='angle'&&item.kind==='angle'){
        const rays=item.rays||item.vectors;
        if(Array.isArray(rays)&&rays.length===2)return canonicalQuantity(`${rays[0][1]}${rays[0][0]}${rays[1][1]}`)===canonicalQuantity(mention.subject);
        return Array.isArray(item.points)&&item.points.length===3&&canonicalQuantity(item.points.join(''))===canonicalQuantity(mention.subject);
      }
      return false;
    });
    if(!matching.length){issues.push({code:'SOURCE_QUANTITY_MISSING',subject:mention.subject,sourceRange:mention.normalizedRange});continue;}
    if(!matching.every(item=>{try{return normalizedResidual(evaluateMathExpression(String(item.degrees??item.value),{}),expected)<=1e-6;}catch{return false;}}))issues.push({code:'SOURCE_QUANTITY_MISMATCH',subject:mention.subject,expected});
    if(mention.unit){
      const expectedUnit=canonicalUnit(mention.unit);
      for(const item of matching){
        const linkedFacts=(ir?.explicitFacts||[]).filter(fact=>(item.factRefs||item.sourceFactRefs||[]).includes(fact.id));
        const actualUnits=[item.unit,mention.kind==='angle'&&item.degrees!==undefined?'deg':null,...linkedFacts.map(fact=>fact.unit)].filter(Boolean).map(canonicalUnit);
        if(!actualUnits.length||actualUnits.some(unit=>unit!==expectedUnit))issues.push({code:'SOURCE_UNIT_MISMATCH',subject:mention.subject,expectedUnit,actualUnits});
      }
    }
  }
  for(const mention of normalized.parameterMentions||[]){
    if(mention.role!=='given')continue;
    let expected;
    try{expected=evaluateMathExpression(mention.expression.replace(/√\s*(\d+(?:\.\d+)?)/g,'sqrt($1)'),{});}catch{issues.push({code:'SOURCE_PARAMETER_UNSUPPORTED',name:mention.name});continue;}
    const fact=(ir?.explicitFacts||[]).find(item=>{
      if(!Number.isFinite(Number(item.value))||normalizedResidual(Number(item.value),expected)>1e-6)return false;
      if(item.name===mention.name)return true;
      return(ir?.constraints||[]).some(constraint=>constraint.hard!==false&&(constraint.factRefs||constraint.sourceFactRefs||[]).includes(item.id)&&Number.isFinite(Number(constraint[mention.name]))&&normalizedResidual(Number(constraint[mention.name]),expected)<=1e-6);
    });
    const constrained=fact&&(ir?.constraints||[]).some(item=>item.hard!==false&&(item.factRefs||item.sourceFactRefs||[]).includes(fact.id));
    const parameterValue=candidate?.modelingParameters?.[mention.name];
    const parameterMatches=parameterValue===undefined||Number.isFinite(Number(parameterValue))&&normalizedResidual(Number(parameterValue),expected)<=1e-6;
    if(!fact||!constrained)issues.push({code:'SOURCE_PARAMETER_MISSING',name:mention.name,sourceRange:mention.normalizedRange});
    else if(!parameterMatches)issues.push({code:'SOURCE_PARAMETER_MISMATCH',name:mention.name,expected});
    else if(mention.unit){
      const actualUnits=[fact.unit,...(ir?.constraints||[]).filter(item=>(item.factRefs||item.sourceFactRefs||[]).includes(fact.id)).map(item=>item.unit)].filter(Boolean).map(canonicalUnit);
      if(!actualUnits.length||actualUnits.some(unit=>unit!==canonicalUnit(mention.unit)))issues.push({code:'SOURCE_UNIT_MISMATCH',name:mention.name,expectedUnit:canonicalUnit(mention.unit),actualUnits});
    }
  }
  const canonicalSegment=value=>(String(value||'').toUpperCase().match(/[A-Z]\d*/g)||[]).slice(0,2).sort().join('');
  for(const mention of normalized.ratioMentions||[]){
    if(mention.role!=='given')continue;
    const expected=mention.firstValue/mention.secondValue;
    const matched=(ir?.constraints||[]).some(item=>{
      if(item.hard===false||item.kind!=='ratio')return false;
      const first=canonicalSegment(item.first||item.firstSegment||item.segments?.[0]),second=canonicalSegment(item.second||item.secondSegment||item.segments?.[1]);
      const actual=Number(item.value??(Number(item.firstValue)/Number(item.secondValue)));
      return first===canonicalSegment(mention.first)&&second===canonicalSegment(mention.second)&&Number.isFinite(actual)&&normalizedResidual(actual,expected)<=1e-6;
    });
    if(!matched)issues.push({code:'SOURCE_RATIO_MISSING',first:mention.first,second:mention.second,expected,sourceRange:mention.normalizedRange});
  }
  const samePointSet=(first,second)=>Array.isArray(first)&&Array.isArray(second)&&JSON.stringify([...first].sort())===JSON.stringify([...second].sort());
  for(const mention of normalized.structuralMentions||[]){
    if(mention.role!=='given')continue;
    const matched=(ir?.constraints||[]).some(item=>{
      if(item.hard===false||item.kind!==mention.kind)return false;
      if(mention.kind==='point_on_line')return(item.point||item.points?.[0])===mention.point&&samePointSet(item.linePoints||item.line||item.points?.slice(1,3),mention.line);
      if(mention.kind==='point_on_plane')return(item.point||item.points?.[0])===mention.point&&samePointSet(item.planePoints||item.plane||item.points?.slice(1),mention.plane);
      if(mention.kind==='projection')return item.point===mention.point&&(item.foot||item.footPoint)===mention.foot&&samePointSet(item.planePoints||item.plane,mention.plane);
      if(mention.kind==='coplanar')return samePointSet(item.points,mention.points);
      if(mention.kind==='equal_length'){
        const groups=item.segments||item.lines||item.segmentPairs;
        const resolved=Array.isArray(groups)?groups.map(group=>typeof group==='string'?entityById.get(group)?.points:group):[];
        return mention.segments.every(segment=>resolved.some(group=>samePointSet(group,segment)));
      }
      if(mention.kind==='tangent')return samePointSet(item.linePoints||item.tangentLinePoints,mention.line)&&item.center===mention.center&&(!mention.touchPoint||item.touchPoint===mention.touchPoint);
      if(mention.kind==='intersection')return item.point===mention.point&&samePointSet(item.first||item.firstLine,mention.first)&&samePointSet(item.second||item.secondLine,mention.second);
      if(mention.kind==='quadrilateral_type')return item.shape===mention.shape&&samePointSet(item.points,mention.points);
      return false;
    });
    if(!matched)issues.push({code:'SOURCE_STRUCTURAL_RELATION_MISSING',kind:mention.kind,sourceRange:mention.normalizedRange});
  }
  for (const fact of ir?.explicitFacts || []) {
    if (!Array.isArray(fact.evidenceRefs) || !fact.evidenceRefs.length) issues.push({code: 'EXPLICIT_FACT_WITHOUT_EVIDENCE', path: fact.id});
    for (const ref of fact.evidenceRefs || []) {
      const evidence = evidenceById.get(ref);
      if (!evidence) issues.push({code: 'DANGLING_EVIDENCE', path: fact.id, ref});
      else if (evidence.kind === 'text' && (!evidence.quote || (!normalized.originalInput.includes(evidence.quote) && !normalized.normalizedInput.includes(evidence.quote)))) issues.push({code: 'TEXT_EVIDENCE_NOT_FOUND', path: ref});
      else if(evidence.kind==='image'){
        if(!normalized.imageHash)issues.push({code:'IMAGE_SOURCE_MISSING',path:ref});
        else if(evidence.imageHash!==normalized.imageHash)issues.push({code:'IMAGE_SOURCE_MISMATCH',path:ref});
        const box=evidence.region;
        if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<0||box[1]<0||box[2]<=0||box[3]<=0||box[0]+box[2]>1||box[1]+box[3]>1)issues.push({code:'INVALID_IMAGE_REGION',path:ref});
        if(!String(evidence.quote||'').trim())issues.push({code:'IMAGE_EVIDENCE_DESCRIPTION_MISSING',path:ref});
        if(typeof evidence.confidence!=='number'||evidence.confidence<0||evidence.confidence>1)issues.push({code:'INVALID_IMAGE_CONFIDENCE',path:ref});
        else if(evidence.confidence<.7)risks.push({code:'LOW_IMAGE_EVIDENCE_CONFIDENCE',path:ref});
      }else if(evidence.kind!=='text')issues.push({code:'UNKNOWN_EVIDENCE_KIND',path:ref});
    }
  }
  const factIds = new Set([...(ir?.explicitFacts || []), ...(ir?.derivedFacts || [])].map(item => item.id));
  const validatedFactIds = new Set();
  for (const constraint of ir?.constraints || []) {
    const refs = constraint.factRefs || constraint.sourceFactRefs || [];
    if (!Array.isArray(refs)) {
      issues.push({code: 'INVALID_CONSTRAINT_FACT_REFS', path: constraint.id});
      continue;
    }
    for (const ref of refs) {
      if (!factIds.has(ref)) issues.push({code: 'DANGLING_CONSTRAINT_FACT_REF', path: constraint.id, ref});
      else if(constraint.hard!==false)validatedFactIds.add(ref);
    }
  }
  for (const fact of ir?.explicitFacts || []) {
    // Every fact copied from the source must affect at least one hard check.
    if (!queryFactIds.has(fact.id)&&!validatedFactIds.has(fact.id)) issues.push({code: 'HARD_FACT_NOT_VALIDATED', path: fact.id});
  }
  for(const fact of ir?.derivedFacts||[]){
    // Explanatory intermediate steps may remain in solutionOutline/derivedFacts.
    // Only derived facts promoted to modeling truth must be independently checked.
    if((fact.hard===true||fact.modelingRelevant===true)&&!validatedFactIds.has(fact.id))issues.push({code:'HARD_FACT_NOT_VALIDATED',path:fact.id});
  }
  const dependencyGraph = new Map();
  for (const fact of ir?.derivedFacts || []) {
    if (!Array.isArray(fact.dependencies) || !fact.dependencies.length || !String(fact.expression || '').trim()) issues.push({code: 'INVALID_DERIVED_FACT', path: fact.id});
    for (const dependency of fact.dependencies || []) if (!factIds.has(dependency)) issues.push({code: 'DANGLING_DERIVATION_DEPENDENCY', path: fact.id, ref: dependency});
    dependencyGraph.set(fact.id, (fact.dependencies || []).filter(id => (ir?.derivedFacts || []).some(item => item.id === id)));
  }
  const visiting = new Set(), visited = new Set();
  const hasCycle = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencyGraph.get(id) || []) if (hasCycle(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of dependencyGraph.keys()) if (hasCycle(id)) { issues.push({code: 'DERIVATION_CYCLE', path: id}); break; }
  const factsById=new Map([...(ir?.explicitFacts||[]),...(ir?.derivedFacts||[])].map(fact=>[fact.id,fact]));
  const derivedResults=new Map();
  const evaluating=new Set();
  const evaluateDerived=fact=>{
    if(derivedResults.has(fact.id))return derivedResults.get(fact.id);
    if(evaluating.has(fact.id))return null;
    evaluating.add(fact.id);
    const variables={};
    for(const dependencyId of fact.dependencies||[]){
      const dependency=factsById.get(dependencyId);
      if(!dependency)continue;
      if((ir?.derivedFacts||[]).includes(dependency))evaluateDerived(dependency);
      let value=derivedResults.get(dependencyId);
      if(!Number.isFinite(value))try{value=evaluateExactValue(dependency.value,variables);}catch{}
      if(Number.isFinite(value)){
        if(dependency.name)variables[dependency.name]=value;
        if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(dependency.id))variables[dependency.id]=value;
        variables[dependency.id.replace(/[^A-Za-z0-9_]/g,'_')]=value;
      }
    }
    let computed=null;
    try{computed=evaluateMathExpression(String(fact.expression||''),variables);}catch{}
    evaluating.delete(fact.id);
    if(Number.isFinite(computed))derivedResults.set(fact.id,computed);
    return Number.isFinite(computed)?computed:null;
  };
  for(const fact of ir?.derivedFacts||[]){
    if(!validatedFactIds.has(fact.id))continue;
    if(fact.kind!=='quantity'&&fact.value===undefined)continue;
    const computed=evaluateDerived(fact);
    // A geometry-derived value may be expressed in readable mathematical prose.
    // Its linked hard constraint is checked numerically by Validator below, so a
    // prose expression is not itself grounds for rejecting an otherwise
    // verifiable model.
    if(!Number.isFinite(computed))continue;
    else{
      let declared;
      try{declared=evaluateExactValue(fact.value,{});}catch{}
      if(!Number.isFinite(declared))issues.push({code:'DERIVED_FACT_VALUE_MISSING',path:fact.id,computed});
      else if(normalizedResidual(computed,declared)>1e-6)issues.push({code:'DERIVED_FACT_VALUE_MISMATCH',path:fact.id,computed,declared});
    }
  }
  const explicitByName = new Map();
  for (const fact of ir?.explicitFacts || []) {
    if (!fact.name || fact.value === undefined) continue;
    const encoded = JSON.stringify(fact.value);
    if (explicitByName.has(fact.name) && explicitByName.get(fact.name) !== encoded) risks.push({code: 'CONFLICTING_EXPLICIT_FACTS', name: fact.name});
    explicitByName.set(fact.name, encoded);
  }
  const points = pointIds(ir);
  for (const [id, coordinates] of Object.entries(candidate?.candidateCoordinates || {})) {
    if (!points.has(id)) issues.push({code: 'COORDINATE_WITHOUT_POINT_ENTITY', path: `candidateCoordinates.${id}`});
    if (!finiteVector(coordinates)) issues.push({code: 'INVALID_COORDINATE', path: `candidateCoordinates.${id}`});
  }
  if (!Object.keys(candidate?.candidateCoordinates || {}).length) risks.push({code: 'CANDIDATE_COORDINATES_MISSING'});
  if (Number(candidate?.confidence?.ocr ?? 1) < 0.7) risks.push({code: 'LOW_OCR_CONFIDENCE'});
  if (Number(candidate?.confidence?.overall ?? 1) < 0.7) risks.push({code: 'LOW_MODEL_CONFIDENCE'});
  if (Array.isArray(candidate?.unresolvedItems) && candidate.unresolvedItems.length) risks.push({code: 'UNRESOLVED_MODELING_ITEMS', count: candidate.unresolvedItems.length});
  if (normalized.optionQueries.length) {
    const queryOptions = new Set((ir?.queries || []).map(item => item.optionId).filter(Boolean));
    for (const option of normalized.optionQueries) if (!queryOptions.has(option.optionId)) issues.push({code: 'OPTION_QUERY_MISSING', path: option.optionId});
  }
  const queryAliases={
    volume:['volume','volume_and_surface_area'],surface_area:['surface_area','volume_and_surface_area'],distance:['distance','point_line_distance','point_plane_distance','skew_line_distance'],
    angle:['angle','line_plane_angle','line_plane_angle_sin','line_plane_angle_cos','dihedral_angle','vector_angle','vector_angle_cos','tangent_value'],
    proof:['proof','prove','verification'],radius:['radius'],diameter:['diameter'],area:['area','section_area','circle_area'],boolean:['boolean','boolean_option','judge'],
    coordinate:['coordinate','point_coordinate'],equation:['equation','plane_equation','line_equation','locus_equation'],locus:['locus','trajectory','locus_equation'],extremum:['extremum','maximum','minimum']
  };
  const queryMatches=(expected,item)=>{
      const kind=item.kind||item.type,target=String(item.target||item.quantity||'').toLowerCase();
      if((queryAliases[expected]||[expected]).includes(kind))return true;
      return kind==='compute'&&(
        expected==='volume'&&target.includes('volume')||
        expected==='surface_area'&&/surface.*area|area.*surface/.test(target)||
        expected==='distance'&&target.includes('distance')||
        expected==='angle'&&/angle|cos|sin|tan/.test(target)||
        expected==='proof'&&/proof|prove|verify/.test(target)||
        expected==='radius'&&/radius/.test(target)||
        expected==='diameter'&&/diameter/.test(target)||
        expected==='area'&&/area/.test(target)||
        expected==='boolean'&&/boolean|judge|whether|verify/.test(target)||
        expected==='coordinate'&&/coordinate/.test(target)||
        expected==='equation'&&/equation/.test(target)||
        expected==='locus'&&/locus|trajectory/.test(target)||
        expected==='extremum'&&/extremum|maximum|minimum|max|min/.test(target)
      );
  };
  const canonicalQueryTarget=value=>String(value||'').toUpperCase().replace(/[－—]/g,'-').replace(/\s+/g,'').replace(/[^A-Z0-9-]/g,'');
  const queryEntityById=new Map((ir?.entities||[]).map(item=>[item.id,item]));
  const canonicalEntityKind=value=>({right_cylinder:'cylinder',right_cone:'cone',regular_pyramid:'pyramid'}[value]||value||null);
  const queryTargets=item=>{
    const raw=[item.target,item.entity,item.solid,item.object,item.subject,item.targetEntityId].filter(Boolean);
    const expanded=[];
    for(const value of raw){
      const entity=typeof value==='string'?queryEntityById.get(value):null;
      if(entity){
        for(const alias of [entity.id,entity.name,entity.label,...(entity.aliases||[])].filter(Boolean))expanded.push({key:canonicalQueryTarget(alias),kind:canonicalEntityKind(entity.kind)});
      }else expanded.push({key:canonicalQueryTarget(value),kind:canonicalEntityKind(item.targetEntityKind||item.entityKind)});
    }
    return expanded.filter(entry=>entry.key);
  };
  for(const mention of normalized.queryMentions||[]){
    if(!(ir?.queries||[]).some(item=>queryMatches(mention.kind,item)))issues.push({code:'SOURCE_QUERY_MISMATCH',expected:mention.kind,sourceRange:mention.normalizedRange});
    else if(mention.target){
      const expectedTarget=canonicalQueryTarget(mention.target);
      const expectedKind=canonicalEntityKind(mention.targetEntityKind);
      const matches=(ir?.queries||[]).filter(item=>queryMatches(mention.kind,item));
      if(!matches.some(item=>queryTargets(item).some(target=>target.key===expectedTarget&&(!expectedKind||target.kind===expectedKind))))issues.push({code:'SOURCE_QUERY_TARGET_MISMATCH',expected:mention.kind,expectedTarget:mention.target,expectedEntityKind:expectedKind,sourceRange:mention.normalizedRange});
    }
  }
  const queryCounts=new Map();
  for(const mention of normalized.queryMentions||[])queryCounts.set(mention.kind,(queryCounts.get(mention.kind)||0)+1);
  for(const[expected,count]of queryCounts){
    const actual=(ir?.queries||[]).filter(item=>queryMatches(expected,item)).length;
    if(actual<count)issues.push({code:'SOURCE_QUERY_COUNT_MISMATCH',expected,expectedCount:count,actualCount:actual});
  }
  const canonicalLine=value=>{
    if(typeof value==='string'){
      const entity=queryEntityById.get(value);
      if(entity){
        if((entity.kind==='segment'||entity.kind==='line')&&Array.isArray(entity.points))return canonicalLine(entity.points);
        if(entity.kind==='plane'&&Array.isArray(entity.points)){
          const ids=entity.points.map(point=>String(point).toUpperCase()).filter(Boolean);
          return `plane:${ids.sort().join('')}`;
        }
      }
    }
    if(typeof value==='string'&&/^(?:segment|line|plane):/.test(value)){
      const[type,raw]=value.split(':',2);
      const ids=raw.toUpperCase().match(/[A-Z](?:\d+)?/g)||[];
      return type==='segment'&&ids.length===2?`segment:${[...ids].sort().join('')}`:`${type}:${ids.length?ids.sort().join(''):raw.toLowerCase()}`;
    }
    const ids=Array.isArray(value)?value:String(value||'').toUpperCase().match(/[A-Z](?:\d+)?/g)||[];
    return ids.length===2?`segment:${[...ids].sort().join('')}`:ids.length>=3?`plane:${[...ids].sort().join('')}`:ids.join('');
  };
  const canonicalRelation=(kind,first,second)=>[kind,canonicalLine(first),canonicalLine(second)].map((value,index)=>index?[value]:value).flat().slice(1).sort().reduce((parts,value)=>`${kind}:${parts?parts+'|':''}${value}`,'');
  const relationKeys=item=>{
    const relation=item.relation||item.goal||item;
    const nestedTarget=relation.target&&typeof relation.target==='object'?relation.target:null;
    const targetText=[typeof relation.target==='string'?relation.target:'',relation.statement,relation.conclusion].filter(Boolean).join(' ');
    const perpendicular=relation.kind==='perpendicular'||nestedTarget?.kind==='perpendicular'||nestedTarget?.relation==='perpendicular'||relation.kind==='vector_relation'&&relation.expectation?.perpendicular||/[⊥⟂]|垂直/.test(targetText);
    const parallel=relation.kind==='parallel'||nestedTarget?.kind==='parallel'||nestedTarget?.relation==='parallel'||relation.kind==='vector_relation'&&relation.expectation?.parallel||/∥|平行/.test(targetText);
    const pair=relation.operands||nestedTarget?.operands||relation.vectors||relation.lines||(relation.line||relation.linePoints||relation.entity||relation.plane||relation.planePoints||typeof relation.target==='string'?[relation.line||relation.linePoints||relation.entity,relation.plane||relation.planePoints||relation.target]:[relation.first,relation.second]);
    const keys=[];
    if(Array.isArray(pair)&&pair.length>=2){
      for(const kind of [perpendicular?'perpendicular':null,parallel?'parallel':null].filter(Boolean)){
        keys.push(canonicalRelation(kind,pair[0],pair[1]));
      }
    }
    return keys;
  };
  const representedRelations=new Set(),hardRelations=new Set(),queryRelations=new Set(),explicitFactIds=new Set((ir?.explicitFacts||[]).filter(item=>!queryFactIds.has(item.id)).map(item=>item.id)),relationsAssertedFromSource=new Set();
  for(const item of ir?.constraints||[]){
    for(const key of relationKeys(item)){
      representedRelations.add(key);
      if(item.hard!==false)hardRelations.add(key);
      if((item.factRefs||item.sourceFactRefs||[]).some(id=>explicitFactIds.has(id)))relationsAssertedFromSource.add(key);
    }
  }
  for(const item of ir?.queries||[])for(const key of relationKeys(item)){representedRelations.add(key);queryRelations.add(key);}
  for(const mention of normalized.relationMentions||[]){
    const key=canonicalRelation(mention.kind,mention.operands[0],mention.operands[1]);
    if(!representedRelations.has(key))issues.push({code:'SOURCE_RELATION_MISSING',relation:mention.kind,operands:mention.operands,sourceRange:mention.normalizedRange});
    else if(mention.role==='given'&&!hardRelations.has(key))issues.push({code:'SOURCE_GIVEN_RELATION_NOT_CONSTRAINED',relation:mention.kind,operands:mention.operands});
    else if(mention.role==='query'&&!queryRelations.has(key))issues.push({code:'SOURCE_QUERY_RELATION_MISSING',relation:mention.kind,operands:mention.operands});
    if(mention.role==='query'&&relationsAssertedFromSource.has(key))issues.push({code:'QUERY_RELATION_ASSERTED_AS_GIVEN',relation:mention.kind,operands:mention.operands});
  }
  return {pass: issues.length === 0, issues, risks, reviewRequired: issues.length > 0 || risks.length > 0};
}

function polyhedronForEntity(entity, coordinates) {
  if (!entity) throw new Error('POLYHEDRON_ENTITY_MISSING');
  let faces = entity.faces;
  if (!Array.isArray(faces) && Array.isArray(entity.baseVertices) && Array.isArray(entity.topVertices) && entity.baseVertices.length === entity.topVertices.length) {
    const bottom = entity.baseVertices, top = entity.topVertices;
    faces = [bottom, [...top].reverse(), ...bottom.map((id, index) => [id, top[index], top[(index + 1) % top.length], bottom[(index + 1) % bottom.length]])];
  }
  if (!Array.isArray(faces) && Array.isArray(entity.baseVertices) && entity.apex) {
    const bottom = entity.baseVertices;
    faces = [bottom, ...bottom.map((id, index) => [entity.apex, id, bottom[(index + 1) % bottom.length]])];
  }
  if (!Array.isArray(faces)) throw new Error('POLYHEDRON_FACES_MISSING');
  const vertexIds = [...new Set(faces.flat())];
  const selected = Object.fromEntries(vertexIds.map(id => [id, coordinates[id]]));
  return createPolyhedronSpec({kind: entity.kind, coordinates: selected, faces, entityId: entity.id});
}

function planeFromIds(coordinates, ids) {
  if (!Array.isArray(ids) || ids.length < 3 || !ids.every(id => finiteVector(coordinates[id]))) throw new Error('INVALID_PLANE_REFERENCES');
  return ids.map(id => coordinates[id]);
}

function constraintCheck(constraint, coordinates, parameters, tolerance, ir) {
  const fail = (code, actual = null, expected = null, residual = Infinity) => ({constraintId: constraint.id, kind: constraint.kind, code, actual, expected, residual, tolerance, pass: false});
  const pass = (actual = null, expected = null, residual = 0) => ({constraintId: constraint.id, kind: constraint.kind, actual, expected, residual, tolerance, pass: residual <= tolerance});
  const points = constraint.points || constraint.subjects || [];
  const entities=new Map((ir?.entities||[]).map(item=>[item.id,item]));
  const resolvePointIds=spec=>{
    if(Array.isArray(spec))return spec;
    if(typeof spec!=='string')return [];
    const entity=entities.get(spec);
    if(Array.isArray(entity?.points))return entity.points;
    if(Array.isArray(entity?.planePoints))return entity.planePoints;
    if(Array.isArray(entity?.faces)&&entity.faces.length)return entity.faces[0];
    return [];
  };
  const resolveLineIds=spec=>resolvePointIds(spec).slice(0,2);
  const resolvePlaneIds=spec=>resolvePointIds(spec).slice(0,3);
  if (constraint.kind === 'distance' || constraint.kind === 'length') {
    const distanceIds=points.length?points:resolveLineIds(constraint.entity||constraint.segment||constraint.line);
    const [a, b] = distanceIds.map(id => coordinates[id]);
    if (!finiteVector(a) || !finiteVector(b) || !Number.isFinite(Number(constraint.value))) return fail('INVALID_DISTANCE_INPUT');
    const actual = distance(a, b), expected = Number(constraint.value);
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'midpoint') {
    const endpoints=constraint.endpoints||resolveLineIds(constraint.segment)||points.slice(1,3);
    const point = coordinates[constraint.point || constraint.entity || points[0]], a = coordinates[endpoints[0]], b = coordinates[endpoints[1]];
    if (![point, a, b].every(finiteVector)) return fail('INVALID_MIDPOINT_INPUT');
    const residual = distance(point, scale(add(a, b), 0.5)) / Math.max(1, distance(a, b));
    return pass(residual, 0, residual);
  }
  if (constraint.kind === 'perpendicular' || constraint.kind === 'parallel') {
    const vectors = Array.isArray(constraint.vectors) ? constraint.vectors : [];
    const resolve = spec => Array.isArray(spec) && spec.length === 2 && coordinates[spec[0]] && coordinates[spec[1]] ? subtract(coordinates[spec[1]], coordinates[spec[0]]) : spec;
    const operandEntities=(constraint.operands||[]).map(id=>entities.get(id)).filter(Boolean);
    const operandLine=operandEntities.find(entity=>entity.kind==='segment'||entity.kind==='line');
    const operandPlane=operandEntities.find(entity=>entity.kind==='plane');
    const lineIds=resolveLineIds(constraint.line||operandLine?.id||constraint.entity),planeIds=resolvePlaneIds(constraint.plane||operandPlane?.id||constraint.target);
    if(lineIds.length===2&&planeIds.length===3){
      const lineVector=subtract(coordinates[lineIds[1]],coordinates[lineIds[0]]),plane=planeIds.map(id=>coordinates[id]);
      if(!finiteVector(lineVector)||!plane.every(finiteVector)||norm(lineVector)===0)return fail('INVALID_LINE_PLANE_RELATION');
      const normal=cross(subtract(plane[1],plane[0]),subtract(plane[2],plane[0]));
      if(norm(normal)===0)return fail('DEGENERATE_PLANE');
      const residual=constraint.kind==='perpendicular'
        ?norm(cross(lineVector,normal))/(norm(lineVector)*norm(normal))
        :Math.abs(dot(lineVector,normal))/(norm(lineVector)*norm(normal));
      return pass(residual,0,residual);
    }
    const relationSpecs=vectors.length?vectors:(constraint.lines||constraint.operands||[]);
    const a = resolve(relationSpecs[0]), b = resolve(relationSpecs[1]);
    if (!finiteVector(a) || !finiteVector(b) || norm(a) === 0 || norm(b) === 0) return fail('INVALID_VECTOR_RELATION');
    const cosine = dot(a, b) / (norm(a) * norm(b));
    const residual = constraint.kind === 'perpendicular' ? Math.abs(cosine) : norm(cross(a, b)) / (norm(a) * norm(b));
    return pass(residual, 0, residual);
  }
  if (constraint.kind === 'point_on_plane' || constraint.kind === 'coplanar') {
    const point = coordinates[constraint.point || points[0]], planePoints = constraint.planePoints || points.slice(1, 4);
    const [a, b, c] = planePoints.map(id => coordinates[id]);
    if (![point, a, b, c].every(finiteVector)) return fail('INVALID_PLANE_INPUT');
    const normal = cross(subtract(b, a), subtract(c, a));
    if (norm(normal) === 0) return fail('DEGENERATE_PLANE');
    const residual = Math.abs(dot(subtract(point, a), normal)) / Math.max(1, norm(normal));
    return pass(residual, 0, residual);
  }
  if (constraint.kind === 'point_plane_distance') {
    const point = coordinates[constraint.point || points[0]], planePoints = constraint.planePoints || points.slice(1, 4);
    const [a, b, c] = planePoints.map(id => coordinates[id]);
    const expected = Number(constraint.value ?? constraint.distance);
    if (![point, a, b, c].every(finiteVector) || !Number.isFinite(expected)) return fail('INVALID_POINT_PLANE_DISTANCE_INPUT');
    const normal = cross(subtract(b, a), subtract(c, a));
    if (norm(normal) === 0) return fail('DEGENERATE_PLANE');
    const actual = Math.abs(dot(subtract(point, a), normal)) / norm(normal);
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'point_line_distance') {
    const point = coordinates[constraint.point || points[0]], lineIds = constraint.linePoints || points.slice(1, 3);
    const expected = Number(constraint.value ?? constraint.distance);
    if (!finiteVector(point) || !lineIds.every(id => finiteVector(coordinates[id])) || !Number.isFinite(expected)) return fail('INVALID_POINT_LINE_DISTANCE_INPUT');
    const actual = pointLineDistance(point, lineIds.map(id => coordinates[id]));
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'skew_line_distance') {
    const firstIds = constraint.firstLine, secondIds = constraint.secondLine, expected = Number(constraint.value ?? constraint.distance);
    if (![firstIds, secondIds].every(ids => Array.isArray(ids) && ids.length === 2 && ids.every(id => finiteVector(coordinates[id]))) || !Number.isFinite(expected)) return fail('INVALID_SKEW_DISTANCE_INPUT');
    const actual = skewLineDistance(firstIds.map(id => coordinates[id]), secondIds.map(id => coordinates[id]));
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'line_plane_angle') {
    const lineIds = constraint.linePoints || resolveLineIds(constraint.line), planeIds = constraint.planePoints || resolvePlaneIds(constraint.plane);
    if (!Array.isArray(lineIds) || lineIds.length !== 2 || !lineIds.every(id => finiteVector(coordinates[id]))) return fail('INVALID_LINE_PLANE_ANGLE_INPUT');
    let radians;
    try { radians = linePlaneAngle(lineIds.map(id => coordinates[id]), planeFromIds(coordinates, planeIds)); } catch { return fail('INVALID_LINE_PLANE_ANGLE_INPUT'); }
    const actual = constraint.measure === 'sine' ? Math.sin(radians) : radians * 180 / Math.PI;
    const expected = Number(constraint.value ?? constraint.degrees);
    if (!Number.isFinite(expected)) return fail('INVALID_LINE_PLANE_ANGLE_VALUE');
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'dihedral_angle') {
    let radians;
    try { radians = dihedralAngle(planeFromIds(coordinates, resolvePointIds(constraint.firstPlane)), planeFromIds(coordinates, resolvePointIds(constraint.secondPlane)), {
      angleType:constraint.angleType,edge:constraint.edge?.map(id=>coordinates[id]),
      firstSide:constraint.firstSide===undefined?undefined:coordinates[constraint.firstSide],secondSide:constraint.secondSide===undefined?undefined:coordinates[constraint.secondSide]
    }); } catch (error) { return fail(String(error.message||'INVALID_DIHEDRAL_ANGLE_INPUT')); }
    const actual = constraint.measure === 'cosine' ? Math.cos(radians) : radians * 180 / Math.PI;
    const expected = Number(constraint.value ?? constraint.degrees);
    if (!Number.isFinite(expected)) return fail('INVALID_DIHEDRAL_ANGLE_VALUE');
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'polyhedron') {
    const entity = (ir?.entities || []).find(item => item.id === constraint.entity);
    try {
      const solid=polyhedronForEntity(entity,coordinates),report = validatePolyhedronSpec(solid, tolerance);
      if(!report.pass)return fail('INVALID_POLYHEDRON_TOPOLOGY',report.checks,'all checks pass',Infinity);
      if(entity?.kind==='cube'){
        if(solid.edges.length!==12||Object.keys(solid.coordinates).length!==8)return fail('INVALID_CUBE_TOPOLOGY');
        const lengths=solid.edges.map(([a,b])=>distance(coordinates[a],coordinates[b])),edge=lengths[0];
        let metricResidual=Math.max(...lengths.map(value=>normalizedResidual(value,edge)));
        for(const vertex of Object.keys(solid.coordinates)){
          const vectors=solid.edges.filter(edgeIds=>edgeIds.includes(vertex)).map(edgeIds=>subtract(coordinates[edgeIds.find(id=>id!==vertex)],coordinates[vertex]));
          if(vectors.length!==3)return fail('INVALID_CUBE_VERTEX_DEGREE');
          for(let i=0;i<vectors.length;i+=1)for(let j=i+1;j<vectors.length;j+=1)metricResidual=Math.max(metricResidual,Math.abs(dot(vectors[i],vectors[j]))/Math.max(1,norm(vectors[i])*norm(vectors[j])));
        }
        if(metricResidual>tolerance)return fail('INVALID_CUBE_METRIC',metricResidual,0,metricResidual);
      }
      return pass(report.checks.length,report.checks.length,0);
    } catch (error) { return fail(String(error.message || error)); }
  }
  if (constraint.kind === 'polyhedron_section') {
    const entity = (ir?.entities || []).find(item => item.id === constraint.solid);
    let section;
    try { section = intersectPolyhedronWithPlane(polyhedronForEntity(entity, coordinates), {normal: constraint.normal, offset: constraint.offset}, tolerance); } catch (error) { return fail(String(error.message || error)); }
    if (section.status !== 'verified') return fail('SECTION_NOT_VERIFIED', section.status, 'verified');
    let residual = 0;
    const expectedCount = Number(constraint.vertexCount ?? constraint.points?.length);
    if (Number.isFinite(expectedCount) && expectedCount !== section.points.length) residual = Infinity;
    for (const pointId of constraint.points || []) {
      const point = coordinates[pointId];
      if (!finiteVector(point)) return fail('INVALID_SECTION_POINT');
      residual = Math.max(residual, Math.min(...section.points.map(candidatePoint => distance(point, candidatePoint))) / Math.max(1, ...section.points.map(norm)));
    }
    return pass(section.points.length, Number.isFinite(expectedCount) ? expectedCount : section.points.length, residual);
  }
  if (constraint.kind === 'point_on_line') {
    const point = coordinates[constraint.point || points[0]], [a, b] = (constraint.linePoints || points.slice(1, 3)).map(id => coordinates[id]);
    if (![point, a, b].every(finiteVector) || distance(a, b) === 0) return fail('INVALID_LINE_INPUT');
    const residual = norm(cross(subtract(point, a), subtract(b, a))) / Math.max(1, distance(a, b));
    return pass(residual, 0, residual);
  }
  if (constraint.kind === 'equal_length') {
    const segments = (constraint.segments || []).map(segment=>typeof segment==='string'?resolveLineIds(segment):segment);
    if (segments.length !== 2 || segments.some(segment => !Array.isArray(segment) || segment.length !== 2 || !segment.every(id => finiteVector(coordinates[id])))) return fail('INVALID_EQUAL_LENGTH_INPUT');
    const actual = distance(coordinates[segments[0][0]], coordinates[segments[0][1]]);
    const expected = distance(coordinates[segments[1][0]], coordinates[segments[1][1]]);
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'angle') {
    const vectors = constraint.vectors || (Array.isArray(constraint.points)&&constraint.points.length===3?[[constraint.points[1],constraint.points[0]],[constraint.points[1],constraint.points[2]]]:[]);
    const resolve = spec => Array.isArray(spec) && spec.length === 2 && coordinates[spec[0]] && coordinates[spec[1]] ? subtract(coordinates[spec[1]], coordinates[spec[0]]) : spec;
    const a = resolve(vectors[0]), b = resolve(vectors[1]);
    if (!finiteVector(a) || !finiteVector(b) || norm(a) === 0 || norm(b) === 0) return fail('INVALID_ANGLE_INPUT');
    const actual = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * 180 / Math.PI;
    const expected = Number(constraint.degrees ?? constraint.value);
    if (!Number.isFinite(expected)) return fail('INVALID_ANGLE_VALUE');
    return pass(actual, expected, normalizedResidual(actual, expected));
  }
  if (constraint.kind === 'circle') {
    const center = coordinates[constraint.center], radius = Number(constraint.radius ?? parameters.radius);
    if (!finiteVector(center) || !(radius > 0)) return fail('INVALID_CIRCLE_PARAMETERS');
    let residual = 0;
    for (const pointId of constraint.surfacePoints || []) {
      if (!finiteVector(coordinates[pointId])) return fail('INVALID_CIRCLE_POINT');
      residual = Math.max(residual, normalizedResidual(distance(center, coordinates[pointId]), radius));
    }
    return pass(radius, radius, residual);
  }
  if (constraint.kind === 'right_cylinder' || constraint.kind === 'cylinder') {
    const base = coordinates[constraint.baseCenter], top = coordinates[constraint.topCenter];
    const radius = Number(constraint.radius ?? parameters.radius), height = Number(constraint.height ?? parameters.height);
    if (!finiteVector(base) || !finiteVector(top) || !(radius > 0) || !(height > 0)) return fail('INVALID_CYLINDER_PARAMETERS');
    let residual = normalizedResidual(distance(base, top), height);
    if (constraint.radiusPoint) {
      const radialPoint = coordinates[constraint.radiusPoint];
      if (!finiteVector(radialPoint)) return fail('INVALID_CYLINDER_RADIUS_POINT');
      const radial = subtract(radialPoint, base), axis = subtract(top, base);
      residual = Math.max(residual, normalizedResidual(norm(radial), radius), Math.abs(dot(radial, axis)) / Math.max(1, norm(radial) * norm(axis)));
    }
    return pass(residual, 0, residual);
  }
  if (constraint.kind === 'right_cone' || constraint.kind === 'cone') {
    const base = coordinates[constraint.baseCenter], apex = coordinates[constraint.apex];
    const radius = Number(constraint.radius ?? parameters.radius), height = Number(constraint.height ?? parameters.height);
    if (!finiteVector(base) || !finiteVector(apex) || !(radius > 0) || !(height > 0)) return fail('INVALID_CONE_PARAMETERS');
    let residual = normalizedResidual(distance(base, apex), height);
    if (constraint.rimPoint) {
      const rim = coordinates[constraint.rimPoint];
      if (!finiteVector(rim)) return fail('INVALID_CONE_RIM_POINT');
      const radial = subtract(rim, base), axis = subtract(apex, base);
      residual = Math.max(residual, normalizedResidual(norm(radial), radius), Math.abs(dot(radial, axis)) / Math.max(1, norm(radial) * norm(axis)));
      if (Number.isFinite(Number(constraint.slant ?? parameters.slant))) residual = Math.max(residual, normalizedResidual(distance(rim, apex), Number(constraint.slant ?? parameters.slant)));
    }
    return pass(residual, 0, residual);
  }
  if (constraint.kind === 'sphere') {
    const center = coordinates[constraint.center], radius = Number(constraint.radius ?? parameters.radius);
    if (!finiteVector(center) || !(radius > 0)) return fail('INVALID_SPHERE_PARAMETERS');
    let residual = 0;
    for (const pointId of constraint.surfacePoints || []) {
      if (!finiteVector(coordinates[pointId])) return fail('INVALID_SPHERE_SURFACE_POINT');
      residual = Math.max(residual, normalizedResidual(distance(center, coordinates[pointId]), radius));
    }
    return pass(radius, radius, residual);
  }
  if (constraint.kind === 'section_circle') {
    const radius = Number(constraint.radius ?? parameters.sectionRadius), centerDistance = Number(constraint.centerDistance ?? parameters.planeDistance), sphereRadius = Number(constraint.sphereRadius ?? parameters.radius);
    const sphereEntity = constraint.sphere;
    if (!(radius >= 0) || !(centerDistance >= 0) || !(sphereRadius > 0)) return fail('INVALID_SECTION_PARAMETERS');
    const analyticResidual = normalizedResidual(radius ** 2 + centerDistance ** 2, sphereRadius ** 2);
    let coordinateResidual = 0;
    const sphereCenterId = constraint.sphereCenter || 'O';
    if (finiteVector(coordinates[sphereCenterId]) && finiteVector(coordinates[constraint.center])) coordinateResidual = normalizedResidual(distance(coordinates[sphereCenterId], coordinates[constraint.center]), centerDistance);
    return pass(Math.max(analyticResidual, coordinateResidual), 0, Math.max(analyticResidual, coordinateResidual));
  }
  if (constraint.kind === 'tangent') {
    const center = coordinates[constraint.center], touch = coordinates[constraint.touchPoint];
    const tangentPoints = constraint.linePoints || constraint.tangentLinePoints || [];
    const [a, b] = tangentPoints.map(id => coordinates[id]);
    const radius = Number(constraint.radius ?? parameters.radius);
    if (![center, touch, a, b].every(finiteVector) || !(radius > 0) || distance(a, b) === 0) return fail('INVALID_TANGENT_INPUT');
    const radial = subtract(touch, center), tangent = subtract(b, a);
    const pointLineResidual = norm(cross(subtract(touch, a), tangent)) / Math.max(1, norm(tangent));
    const perpendicularResidual = Math.abs(dot(radial, tangent)) / Math.max(1, norm(radial) * norm(tangent));
    const radiusResidual = normalizedResidual(norm(radial), radius);
    const residual = Math.max(pointLineResidual, perpendicularResidual, radiusResidual);
    return pass(residual, 0, residual);
  }
  if(constraint.kind==='ratio'){
    const firstIds=constraint.first||constraint.firstSegment||constraint.segments?.[0],secondIds=constraint.second||constraint.secondSegment||constraint.segments?.[1];
    if(!Array.isArray(firstIds)||firstIds.length!==2||!Array.isArray(secondIds)||secondIds.length!==2)return fail('INVALID_RATIO_REFERENCES');
    const firstPoints=firstIds.map(id=>coordinates[id]),secondPoints=secondIds.map(id=>coordinates[id]);
    const expected=Number(constraint.value??(Number(constraint.firstValue)/Number(constraint.secondValue)));
    if(!firstPoints.every(finiteVector)||!secondPoints.every(finiteVector)||!Number.isFinite(expected)||distance(...secondPoints)<=1e-12)return fail('INVALID_RATIO_INPUT');
    const actual=distance(...firstPoints)/distance(...secondPoints);
    return pass(actual,expected,normalizedResidual(actual,expected));
  }
  if(constraint.kind==='projection'){
    const source=coordinates[constraint.point],foot=coordinates[constraint.foot||constraint.footPoint],planeIds=constraint.planePoints||constraint.plane;
    if(!finiteVector(source)||!finiteVector(foot)||!Array.isArray(planeIds)||planeIds.length<3||!planeIds.slice(0,3).every(id=>finiteVector(coordinates[id])))return fail('INVALID_PROJECTION_INPUT');
    const[a,b,c]=planeIds.slice(0,3).map(id=>coordinates[id]),normal=cross(subtract(b,a),subtract(c,a));
    if(norm(normal)<=1e-12)return fail('DEGENERATE_PLANE');
    const onPlane=Math.abs(dot(subtract(foot,a),normal))/Math.max(1,norm(normal)),direction=subtract(source,foot);
    const perpendicular=norm(direction)<=1e-12?0:norm(cross(direction,normal))/(norm(direction)*norm(normal));
    return pass(Math.max(onPlane,perpendicular),0,Math.max(onPlane,perpendicular));
  }
  if(constraint.kind==='intersection'){
    const point=coordinates[constraint.point],firstIds=constraint.first||constraint.firstLine,secondIds=constraint.second||constraint.secondLine;
    if(!finiteVector(point)||![firstIds,secondIds].every(ids=>Array.isArray(ids)&&ids.length===2&&ids.every(id=>finiteVector(coordinates[id]))))return fail('INVALID_INTERSECTION_INPUT');
    const lineResidual=ids=>{
      const a=coordinates[ids[0]],b=coordinates[ids[1]],direction=subtract(b,a);
      if(norm(direction)<=1e-12)return Infinity;
      return norm(cross(subtract(point,a),direction))/Math.max(1,norm(direction));
    };
    const firstDirection=subtract(coordinates[firstIds[1]],coordinates[firstIds[0]]),secondDirection=subtract(coordinates[secondIds[1]],coordinates[secondIds[0]]);
    if(norm(firstDirection)<=1e-12||norm(secondDirection)<=1e-12||norm(cross(firstDirection,secondDirection))/(norm(firstDirection)*norm(secondDirection))<=tolerance)return fail('INTERSECTION_NOT_UNIQUE');
    const residual=Math.max(lineResidual(firstIds),lineResidual(secondIds));
    return pass(residual,0,residual);
  }
  if(constraint.kind==='quadrilateral_type'){
    const ids=constraint.points||[],vertices=ids.map(id=>coordinates[id]);
    if(ids.length!==4||!vertices.every(finiteVector))return fail('INVALID_QUADRILATERAL_INPUT');
    const[a,b,c,d]=vertices,normal=cross(subtract(b,a),subtract(c,a));
    if(norm(normal)<=1e-12)return fail('DEGENERATE_QUADRILATERAL');
    const coplanar=Math.abs(dot(subtract(d,a),normal))/Math.max(1,norm(normal));
    const edges=[[a,b],[b,c],[c,d],[d,a]],lengths=edges.map(([u,v])=>distance(u,v));
    if(lengths.some(value=>value<=1e-12))return fail('DEGENERATE_QUADRILATERAL');
    const parallelResidual=(first,second)=>norm(cross(subtract(first[1],first[0]),subtract(second[1],second[0])))/(norm(subtract(first[1],first[0]))*norm(subtract(second[1],second[0])));
    const perpendicularResidual=(first,second)=>Math.abs(dot(subtract(first[1],first[0]),subtract(second[1],second[0])))/(norm(subtract(first[1],first[0]))*norm(subtract(second[1],second[0])));
    const equalResidual=(x,y)=>normalizedResidual(x,y);
    let residual=coplanar;
    if(['parallelogram','rectangle','rhombus','square'].includes(constraint.shape))residual=Math.max(residual,parallelResidual(edges[0],edges[2]),parallelResidual(edges[1],edges[3]));
    if(['rhombus','square'].includes(constraint.shape))residual=Math.max(residual,...lengths.slice(1).map(value=>equalResidual(value,lengths[0])));
    if(['rectangle','square'].includes(constraint.shape))residual=Math.max(residual,...edges.slice(0,3).map((edge,index)=>perpendicularResidual(edge,edges[index+1])));
    if(constraint.shape==='trapezoid'){
      const firstPair=parallelResidual(edges[0],edges[2]),secondPair=parallelResidual(edges[1],edges[3]);
      if((firstPair<=tolerance)===(secondPair<=tolerance))return fail('TRAPEZOID_REQUIRES_EXACTLY_ONE_PARALLEL_PAIR');
      residual=Math.max(residual,Math.min(firstPair,secondPair));
    }
    if(!['parallelogram','rectangle','rhombus','square','trapezoid'].includes(constraint.shape))return fail('UNSUPPORTED_QUADRILATERAL_TYPE');
    return pass(residual,0,residual);
  }
  if (constraint.kind === 'positive') {
    const value = Number(constraint.value ?? parameters[constraint.name]);
    return value > 0 ? pass(value, '>0', 0) : fail('NON_POSITIVE_VALUE', value, '>0');
  }
  if (constraint.hard !== false) return fail('VALIDATOR_RULE_NOT_REGISTERED');
  return pass(null, null, 0);
}

export function validateGeometryCandidate(candidate, options = {}) {
  const tolerance = Number(options.tolerance || 1e-6);
  const ir = candidate?.geometryIR || {};
  const coordinates = candidate?.candidateCoordinates || {};
  const parameters = candidate?.modelingParameters || {};
  const checks = (ir.constraints || []).map(constraint => constraintCheck(constraint, coordinates, parameters, tolerance, ir));
  const factById = new Map([...(ir.explicitFacts || []), ...(ir.derivedFacts || [])].map(fact => [fact.id, fact]));
  for (const fact of ir.derivedFacts || []) {
    if (fact.kind !== 'quantity') continue;
    const variables = {};
    for (const dependency of fact.dependencies || []) {
      const source = factById.get(dependency);
      let value;
      try{value=evaluateExactValue(source?.value,variables);}catch{}
      if(Number.isFinite(value)){
        if(source?.name)variables[source.name]=value;
        if(/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(source?.id||'')))variables[source.id]=value;
        if(source?.id)variables[source.id.replace(/[^A-Za-z0-9_]/g,'_')]=value;
      }
    }
    try {
      const expected=evaluateExactValue(fact.value,variables);
      const computed = evaluateMathExpression(fact.expression, variables);
      const residual = normalizedResidual(computed, expected);
      checks.push({constraintId: fact.id, kind: 'derived_fact_expression', actual: computed, expected, residual, tolerance, pass: residual <= tolerance});
    } catch (error) {
      checks.push({constraintId: fact.id, kind: 'derived_fact_expression', code: String(error.message || error), actual: null, expected: fact.value, residual: Infinity, tolerance, pass: false});
    }
    const matching = Object.entries(parameters).find(([name]) => name === fact.name);
    if (matching) {
      let actual,expected;
      try{actual=evaluateExactValue(matching[1],variables);expected=evaluateExactValue(fact.value,variables);}catch{}
      const residual=Number.isFinite(actual)&&Number.isFinite(expected)?normalizedResidual(actual,expected):Infinity;
      checks.push({constraintId: `${fact.id}:parameter`, kind: 'derived_fact_parameter', actual, expected, residual, tolerance, pass: residual <= tolerance});
    }
  }
  return {pass: checks.length > 0 && checks.every(item => item.pass), tolerance, checks, failedConstraints: checks.filter(item => !item.pass).map(item => item.constraintId)};
}

export function canonicalizeGeometryCandidate(candidate) {
  const copy = structuredClone(candidate);
  const coordinates = copy.candidateCoordinates || {};
  const ids = Object.keys(coordinates);
  if (!ids.length || copy.coordinateSystem?.canonical === true) return {...copy, canonicalization: {strategy: 'already_canonical', transforms: []}};
  const preferred = ['O', 'A', 'P'].find(id => finiteVector(coordinates[id])) || ids[0];
  const origin = coordinates[preferred];
  for (const id of ids) coordinates[id] = subtract(coordinates[id], origin);
  copy.coordinateSystem = {...copy.coordinateSystem, canonical: true, origin: preferred};
  copy.canonicalization = {strategy: 'rigid_translation', transforms: [{type: 'translation', vector: scale(origin, -1)}]};
  return copy;
}

function representativeEmbeddingIsProven(candidate,validation){
  const points=[...(pointIds(candidate?.geometryIR))];
  if(points.length<=1)return true;
  if(points.length===2){
    const pair=[...points].sort().join('|');
    return(candidate.geometryIR?.constraints||[]).some(constraint=>['distance','length'].includes(constraint.kind)&&constraint.hard!==false&&[...(constraint.points||[])].sort().join('|')===pair&&validation.checks.some(check=>check.constraintId===constraint.id&&check.pass));
  }
  const ir=candidate?.geometryIR||{},passed=new Set((validation?.checks||[]).filter(check=>check.pass).map(check=>check.constraintId));
  for(const entity of ir.entities||[]){
    if(!['cube','cuboid','prism','pyramid','tetrahedron','sphere','right_cylinder','cylinder','right_cone','cone'].includes(entity.kind))continue;
    if(['sphere','right_cylinder','cylinder','right_cone','cone'].includes(entity.kind)){
      const acceptedKinds=entity.kind==='sphere'?['sphere']:entity.kind.includes('cylinder')||entity.kind==='cylinder'?['right_cylinder','cylinder']:['right_cone','cone'];
      if((ir.constraints||[]).some(constraint=>acceptedKinds.includes(constraint.kind)&&(!constraint.entity||constraint.entity===entity.id)&&passed.has(constraint.id)))return true;
      continue;
    }
    const topology=(ir.constraints||[]).find(constraint=>constraint.kind==='polyhedron'&&constraint.entity===entity.id&&passed.has(constraint.id));
    const scaleConstraint=(ir.constraints||[]).find(constraint=>['distance','length'].includes(constraint.kind)&&constraint.hard!==false&&passed.has(constraint.id));
    const scaleFreeQueryKinds=new Set(['construct','prove','parallel','perpendicular','vector_relation','line_plane_angle','dihedral_angle']);
    const queriesSafe=(ir.queries||[]).every(query=>query.target===entity.id||query.kind==='polyhedron_section'&&(ir.constraints||[]).some(constraint=>constraint.kind==='polyhedron_section'&&passed.has(constraint.id))||scaleConstraint&&['point_plane_distance','point_line_distance','skew_line_distance'].includes(query.kind)||scaleFreeQueryKinds.has(query.kind));
    if(topology&&queriesSafe&&(scaleConstraint||(ir.queries||[]).every(query=>scaleFreeQueryKinds.has(query.kind)||query.target===entity.id)))return true;
  }
  return false;
}

function gridSize(coordinates) {
  const maximum = Math.max(1, ...Object.values(coordinates).flat().map(value => Math.abs(Number(value) || 0)));
  return Math.max(8, Math.min(48, Math.ceil(maximum * 2 + 4)));
}

function constraintFor(candidate, kinds, entityId) {
  return (candidate.geometryIR?.constraints || []).find(item => kinds.includes(item.kind) && (!entityId || !item.entity || item.entity === entityId));
}

function firstFinite(...values) {
  for (const value of values) if (Number.isFinite(Number(value))) return Number(value);
  return NaN;
}

function makeSceneElements(candidate, validation, {allowUnverifiedConstructions = false} = {}) {
  const elements = [];
  const ir = candidate.geometryIR;
  const parameters = candidate.modelingParameters || {};
  const emittedSegments = new Set();
  const addSegment = (id, points, extra = {}, force = false) => {
    if (!Array.isArray(points) || points.length !== 2 || !points.every(point => candidate.candidateCoordinates[point])) return;
    const key = [...points].sort().join('\u0000');
    if (emittedSegments.has(key) && !force) return;
    emittedSegments.add(key);
    elements.push({id, type: 'segment', points: [...points], ...extra});
  };
  for (const entity of ir.entities || []) {
    if (entity.kind === 'point' && candidate.candidateCoordinates[entity.id]) elements.push({id: `point-${entity.id}`, type: 'point', point: entity.id});
    if (entity.kind === 'sphere') {
      const rule = constraintFor(candidate, ['sphere'], entity.id);
      elements.push({id: entity.id, type: 'sphere', center: entity.center || rule?.center, radius: exactNumber(firstFinite(parameters.radius, entity.radius, rule?.radius)), opacity: 0.42});
    }
    if (entity.kind === 'circle') {
      const rule = constraintFor(candidate, ['section_circle', 'circle'], entity.id);
      elements.push({id: entity.id, type: 'section-circle', center: entity.center || rule?.center, radius: exactNumber(firstFinite(parameters.sectionRadius, entity.radius, rule?.radius)), normal: entity.normal || rule?.normal || parameters.sectionNormal || [0, 0, 1], opacity: 0.72});
    }
    if (entity.kind === 'plane' && Array.isArray(entity.points) && entity.points.length >= 3 && entity.points.every(point => candidate.candidateCoordinates[point])) {
      elements.push({id: entity.id, type: 'plane', points: [...entity.points], opacity: 0.16, role: 'candidate-plane'});
    }
    if (entity.kind === 'right_cylinder' || entity.kind === 'cylinder') {
      const rule = constraintFor(candidate, ['right_cylinder', 'cylinder'], entity.id);
      elements.push({id: entity.id, type: 'cylinder', baseCenter: entity.baseCenter || rule?.baseCenter, topCenter: entity.topCenter || rule?.topCenter, radius: exactNumber(firstFinite(parameters.radius, entity.radius, rule?.radius)), opacity: 0.42});
    }
    if (entity.kind === 'right_cone' || entity.kind === 'cone') {
      const rule = constraintFor(candidate, ['right_cone', 'cone'], entity.id);
      elements.push({id: entity.id, type: 'cone', baseCenter: entity.baseCenter || rule?.baseCenter, apex: entity.apex || rule?.apex, radius: exactNumber(firstFinite(parameters.radius, entity.radius, rule?.radius)), opacity: 0.42});
    }
    if ((entity.kind === 'segment' || entity.kind === 'line') && Array.isArray(entity.points)) addSegment(entity.id, entity.points);
    if (['cube', 'cuboid', 'prism', 'pyramid', 'tetrahedron'].includes(entity.kind)) {
      try {
        const solid = polyhedronForEntity(entity, candidate.candidateCoordinates);
        solid.faces.forEach((points, index) => elements.push({id: `${entity.id}-face-${index + 1}`, type: 'polyhedron-face', points: [...points], solid: entity.id, opacity: 0.12}));
        solid.edges.forEach((points, index) => addSegment(`${entity.id}-edge-${index + 1}`, points, {style: 'frame', solid: entity.id}));
      } catch { /* Validator reports malformed topology; SceneSpec is never built for failed candidates. */ }
    }
    if ((entity.kind === 'section_polygon' || entity.kind === 'section') && Array.isArray(entity.points) && entity.points.length >= 3 && entity.points.every(point => candidate.candidateCoordinates[point])) {
      elements.push({id: entity.id, type: 'section-polygon', points: [...entity.points], normal: entity.normal, opacity: 0.4});
    }
  }
  const passedConstraintIds = new Set((validation?.checks || []).filter(item => item.pass).map(item => item.constraintId));
  for (const construction of candidate.suggestedConstructions || []) {
    const dependencies = construction.dependsOn || construction.constraintRefs || [];
    const verified = dependencies.length > 0 && dependencies.every(id => passedConstraintIds.has(id));
    if (construction.kind === 'segment' && Array.isArray(construction.points) && (verified || allowUnverifiedConstructions)) {
      addSegment(construction.id, construction.points, {
        style: verified ? 'emphasis' : 'construction',
        role: verified ? 'verified-construction' : 'ai-construction',
        unverified: !verified
      }, true);
    }
  }
  elements.push({id: 'axes', type: 'axes', size: 3});
  return elements;
}

export function buildVerifiedSceneSpec(candidate, validation) {
  if (!validation?.pass) throw new Error('SCENE_REQUIRES_VERIFIED_GEOMETRY');
  const coordinates = candidate.candidateCoordinates;
  const elements = makeSceneElements(candidate, validation);
  const dimensions = [];
  const addDimension = (id, label, points, value, source) => {
    if (points.every(point => coordinates[point]) && Number.isFinite(Number(value))) dimensions.push({id, label, points, value: exactNumber(Number(value)), valueSource: source});
  };
  addDimension('radius', `R = ${candidate.modelingParameters?.radius}`, ['O', 'R'], candidate.modelingParameters?.radius, 'modelingParameters.radius');
  addDimension('section-radius', `r = ${candidate.modelingParameters?.sectionRadius}`, ['H', 'A'], candidate.modelingParameters?.sectionRadius, 'modelingParameters.sectionRadius');
  addDimension('plane-distance', `d = ${candidate.modelingParameters?.planeDistance}`, ['O', 'H'], candidate.modelingParameters?.planeDistance, 'modelingParameters.planeDistance');
  const frameEdges = [];
  for (const element of elements) if (element.type === 'segment' && Array.isArray(element.points) && element.points.every(point => coordinates[point])) frameEdges.push(element.points);
  if (!frameEdges.length) {
    const ids = Object.keys(coordinates);
    if (ids.length >= 2) frameEdges.push(ids.slice(0, 2));
  }
  const representative=candidate?.modelingParameters?.identifiability==='representative';
  const verifiedLengthConstraint=(candidate.geometryIR?.constraints||[]).some(constraint=>['distance','length'].includes(constraint.kind)&&constraint.hard!==false&&validation.checks.some(check=>check.constraintId===constraint.id&&check.pass));
  if (!dimensions.length && frameEdges.length && (!representative||verifiedLengthConstraint)) {
    const [start, end] = frameEdges[0];
    const value = distance(coordinates[start], coordinates[end]);
    dimensions.push({id: 'reference-length', label: `${start}${end} = ${Number(value.toFixed(6))}`, points: [start, end], value: exactNumber(value), valueSource: 'validatedCoordinates'});
  }
  const size = gridSize(coordinates);
  const scene = {
    schemaVersion: 'geometry-scene/v3',
    coordinateConvention: 'math_xyz_z_up',
    threeTransform: '[x,z,y]',
    grid: {unit: 1, size, divisions: size, plane: 'z=0', valueSource: 'canonicalCoordinates'},
    camera: {position: [size * 0.72, size * 0.56, size * 0.72], target: [0, 0, 0]},
    frameEdges,
    dimensions,
    elements,
    validationId: createHash('sha256').update(JSON.stringify(validation.checks)).digest('hex')
  };
  scene.representation=representative
    ? {kind:'representative',unique:false,notice:'题目未唯一确定整体姿态；仅显示满足全部已验证条件的代表模型。未由硬约束支持的尺寸与关系不会展示。'}
    : {kind:'unique',unique:true};
  scene.pedagogy = buildPedagogicalVisualization({
    scene,
    coordinates,
    query: candidate.geometryIR?.queries?.[0],
    queries: candidate.geometryIR?.queries,
    verification: validation,
    displayPlan: {
      visualFocus: candidate.visualFocus,
      highlightEntities: candidate.highlightEntities,
      annotations: candidate.annotations,
      constructionDisplayPlan: candidate.constructionDisplayPlan,
      subproblemVisualization: candidate.subproblemVisualization,
      visibilitySequence: candidate.visibilitySequence
    }
  });
  return scene;
}

/*
 * A model is a teaching aid before it is a numerical authority.  Keep the
 * candidate scene when DeepSeek understood enough of the spatial structure to
 * draw it, even if the evidence gate or a hard constraint still needs repair.
 * This must never be presented as verified geometry: labels/dimensions are
 * deliberately limited and the caller receives solverStatus: "reference".
 */
export function buildReferenceSceneSpec(candidate, validation = {checks: []}) {
  const coordinates = candidate?.candidateCoordinates || {};
  const ir = candidate?.geometryIR || {entities: [], constraints: [], queries: []};
  const entityIds = new Set((ir.entities || []).map(item => item.id));
  const collectEntityRefs = value => {
    const refs = [];
    const visit = item => {
      if (typeof item === 'string') {
        if (entityIds.has(item)) refs.push(item);
        return;
      }
      if (Array.isArray(item)) return item.forEach(visit);
      if (item && typeof item === 'object') Object.values(item).forEach(visit);
    };
    visit(value);
    return [...new Set(refs)];
  };
  const generatedSubproblemViews = (ir.queries || []).map((query, index) => ({
    id: `query-view-${query.id || index + 1}`,
    queryId: query.id || `query-${index + 1}`,
    label: String(query.label || query.quote || `第 ${index + 1} 小问`),
    highlightEntities: collectEntityRefs(query.target || query),
    annotationIds: []
  })).filter(item => item.highlightEntities.length);
  const safeCandidate = {
    ...candidate,
    geometryIR: ir,
    candidateCoordinates: coordinates,
    modelingParameters: candidate?.modelingParameters || {},
    subproblemVisualization: Array.isArray(candidate?.subproblemVisualization) && candidate.subproblemVisualization.length
      ? candidate.subproblemVisualization
      : generatedSubproblemViews,
    suggestedConstructions: (candidate?.suggestedConstructions || []).filter(item =>
      Array.isArray(item?.points) && item.points.every(point => coordinates[point])
    )
  };
  let elements = [{id: 'axes', type: 'axes', size: 3}];
  try { elements = makeSceneElements(safeCandidate, {checks: []}, {allowUnverifiedConstructions: true}); } catch { /* retain XYZ axes */ }
  const frameEdges = elements
    .filter(item => item.type === 'segment' && Array.isArray(item.points) && item.points.every(point => coordinates[point]))
    .map(item => item.points);
  const size = gridSize(coordinates);
  const scene = {
    schemaVersion: 'geometry-scene/v3',
    coordinateConvention: 'math_xyz_z_up',
    threeTransform: '[x,z,y]',
    grid: {unit: 1, size, divisions: size, plane: 'z=0', valueSource: 'candidateCoordinates'},
    camera: {position: [size * 0.72, size * 0.56, size * 0.72], target: [0, 0, 0]},
    frameEdges,
    dimensions: [],
    elements,
    representation: {
      kind: 'ai_reference',
      unique: false,
      notice: '这是 AI 根据题意生成的可交互参考模型；空间关系正在继续校验，不能把未验证标注当作最终答案依据。'
    },
    referenceStatus: 'pending_validation'
  };
  scene.pedagogy = buildPedagogicalVisualization({
    scene,
    coordinates,
    query: safeCandidate.geometryIR?.queries?.[0],
    queries: safeCandidate.geometryIR?.queries,
    verification: {
      ...validation,
      displayOnlyConstraintRefs: (safeCandidate.geometryIR?.constraints || []).map(item => item.id)
    },
    displayPlan: {
      visualFocus: safeCandidate.visualFocus,
      highlightEntities: safeCandidate.highlightEntities,
      annotations: safeCandidate.annotations,
      constructionDisplayPlan: safeCandidate.constructionDisplayPlan,
      subproblemVisualization: safeCandidate.subproblemVisualization,
      visibilitySequence: safeCandidate.visibilitySequence
    }
  });
  return scene;
}

function canRenderReferenceCandidate(candidate) {
  return Boolean(candidate && candidate.geometryIR && candidate.candidateCoordinates
    && Object.values(candidate.candidateCoordinates).some(finiteVector));
}

/* 模型给出的坐标是否真的能画出来。空对象/全 null/非数值都算没有坐标。 */
export function hasRenderableCoordinates(candidate) {
  return canRenderReferenceCandidate(candidate);
}

/* ------------------------------------------------------------------
   纯数学验算：只看 Geometry IR 的硬约束与坐标，不做语义/证据/题型判断。
   与旧 Evidence Gate 的区别：
     - Evidence Gate 检查"这句话有没有被原文支持"（语义层）
     - 这里只检查"这些坐标满不满足这些硬约束"（数学层）
   验算结果只用于两件事：告诉用户哪条不成立、驱动局部修复；永不阻断渲染。
   ------------------------------------------------------------------ */
export function safeValidateCandidateMath(candidate) {
  const empty = {pass: false, checks: [], failedConstraints: [], residual: null, skipped: true};
  try {
    if (!candidate || !candidate.geometryIR || !candidate.candidateCoordinates) return empty;
    const hardConstraints = (candidate.geometryIR.constraints || []).filter(item => item && item.hard !== false);
    if (!hardConstraints.length) return {pass: true, checks: [], failedConstraints: [], residual: null, note: 'no_hard_constraints'};
    const report = validateGeometryCandidate(candidate);
    let worstResidual = null;
    for (const check of report.checks || []) {
      if (check.pass) continue;
      const candidateResidual = Number.isFinite(Number(check.residual)) ? Math.abs(Number(check.residual)) : null;
      if (candidateResidual !== null && (worstResidual === null || candidateResidual > worstResidual)) worstResidual = candidateResidual;
    }
    return {
      pass: Boolean(report.pass),
      checks: (report.checks || []).map(check => ({constraintId: check.constraintId, kind: check.kind, pass: check.pass})),
      failedConstraints: report.failedConstraints || [],
      residual: worstResidual
    };
  } catch (error) {
    return {...empty, error: String(error?.message || error).slice(0, 160)};
  }
}

/* 局部修复指令：只列出没通过的约束和涉及的点，
   明确要求"只改这些点的坐标"，避免模型借机把整题重做一遍。 */
export function buildConstraintRepairPrompt(mathReport, candidate) {
  const failed = mathReport?.failedConstraints || [];
  const involved = new Set();
  for (const constraint of (candidate?.geometryIR?.constraints || [])) {
    if (!failed.includes(constraint?.id)) continue;
    for (const key of ['points', 'point', 'line', 'plane', 'segment', 'segments', 'entity', 'solid']) {
      const value = constraint?.[key];
      if (typeof value === 'string') involved.add(value);
      else if (Array.isArray(value)) value.forEach(item => typeof item === 'string' && involved.add(item));
    }
  }
  const coordinates = candidate?.candidateCoordinates || {};
  const involvedCoordinates = {};
  for (const name of involved) if (coordinates[name]) involvedCoordinates[name] = coordinates[name];
  return [
    '你上一次给出的坐标没有满足下面这些硬约束。请只做局部修复，不要重新生成整道题。',
    `未通过的约束（constraintId → kind）：${JSON.stringify(failed.map(id => {
      const found = (candidate?.geometryIR?.constraints || []).find(item => item?.id === id);
      return {constraintId: id, kind: found?.kind || 'unknown', detail: found ? JSON.stringify(found).slice(0, 160) : null};
    }), null, 1)}`,
    `涉及的点及其当前坐标：${JSON.stringify(involvedCoordinates)}`,
    `当前全部坐标（仅作参考，未涉及的点请保持原值）：${JSON.stringify(coordinates)}`,
    '请输出同样的 geometry-compile-response/v1 JSON，其中 candidateCoordinates 只修改上面涉及的点，'
      + '其余点原样保留，geometryIR 保持不变。只允许移动点来满足约束，禁止改动题目条件。'
  ].join('\n\n');
}

/* 是否值得为"坐标缺失"再补问一次。
   只在模型"该建却没建"时补问：题目是立体几何、模型也建了实体，却没有给出任何坐标。
   如果模型在 unresolvedItems 里明确说明了为什么不能给坐标，说明它是有意省略，
   再问一次只会得到同样的回答，还会白白多花一次调用和时间 —— 这种情况不补问。
   完全空的候选（没有实体也没有高亮）同样不补问。 */
export function shouldRepairMissingCoordinates(candidate) {
  if (!candidate || hasRenderableCoordinates(candidate)) return false;
  const ir = candidate.geometryIR || {};
  const entities = Array.isArray(ir.entities) ? ir.entities : [];
  const queries = Array.isArray(ir.queries) ? ir.queries : [];
  const hasGeometryToPlace = entities.some(entity => entity && (entity.kind === 'point' || entity.kind === 'segment'));
  if (!hasGeometryToPlace || !queries.length) return false;
  const explained = Array.isArray(candidate.unresolvedItems)
    && candidate.unresolvedItems.some(item => typeof item === 'string' && item.trim().length > 0);
  return !explained;
}

/* 模型常把内部 ID 塞进 query.target：derived-cd-perp-ab、c_parallel_DE_plane_BCC1B1、
   q1、fact-3 这类都不是学生能读的文字。真正可读的题目文字在 query.quote 里。
   这里统一判断"这看起来是不是内部标识符"。 */
export function looksLikeInternalId(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  // 纯下标/编号
  if (/^[a-z]{0,3}\d+$/i.test(value)) return true;
  // 带内部前缀
  if (/^(derived|fact|query|constraint|relation|ev|entity)[-_]/i.test(value)) return true;
  // 约束 ID 常见形式：c_xxx、c-xxx
  if (/^c[-_]/i.test(value)) return true;
  // 整体是蛇形命名且不含中文、空格和常见数学符号，基本不是题干文字
  const hasChinese = /[\u4e00-\u9fff]/.test(value);
  const hasMath = /[=+\-×÷⊥∥∠△√π°′″]/u.test(value);
  if (!hasChinese && !hasMath && /^[A-Za-z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)+$/.test(value)) return true;
  return false;
}

function describeQueryTarget(query) {
  const target = String(query?.target || '').trim();
  const quote = String(query?.quote || '').trim();
  return looksLikeInternalId(target) ? quote : target;
}

function describeQueryValue(query) {
  const exact = String(query?.exactValue || query?.exact || '').trim();
  if (exact) return exact;
  // value 有两种形态：普通数字，或精确表达式节点 {op:'rational',p,q} / {op:'sqrt',value}
  const raw = query?.value;
  if (raw && typeof raw === 'object') {
    try {
      const numericFromNode = Number(evaluateExactValue(raw, {}));
      return Number.isFinite(numericFromNode) ? String(Number(numericFromNode.toFixed(6))) : '';
    } catch { return ''; }
  }
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? String(Number(numeric.toFixed(6))) : '';
}

/* 参考模型（未被严格校验）也常常已经算出了每一问的结果，
   但旧代码一律把答案写成"请结合 AI 陪练完成本题"，学生永远看不到。
   这里把每个小问已经算出的精确值/数值取出来展示，并明确标注它来自参考模型。 */
function referenceAnswersFromQueries(queries) {
  const items = [];
  for (const [index, query] of (queries || []).entries()) {
    const label = describeQueryTarget(query);
    const value = describeQueryValue(query);
    const isProof = String(query?.kind || '') === 'proof';
    // 证明题的"答案"就是要证的结论本身，不是数值。
    const answer = isProof
      ? (label ? `证明 ${label}` : (value ? `证得结果 ${value}` : ''))
      : (label && value ? `${label} = ${value}` : (value ? `所求量 = ${value}` : label));
    // 只有内部 ID、既没有可读文字也没有数值时，宁可不展示，也不要给学生看内部标识符。
    if (!answer || looksLikeInternalId(answer)) continue;
    items.push({
      index: index + 1,
      kind: isProof ? 'proof' : String(query?.kind || 'value'),
      label,
      value: value || null,
      answer,
      text: `第（${index + 1}）问：${answer}`
    });
  }
  return items;
}

function formatReferenceAnswer(queries) {
  const items = referenceAnswersFromQueries(queries);
  if (!items.length) return null;
  const displayPlain = items.length === 1
    ? items[0].answer
    : items.map(item => `（${item.index}）${item.answer}`).join('；');
  return {
    displayPlain,
    latex: '',
    // 明确告知这些值是参考模型的推算结果，不冒充已验证的标准答案。
    referenceOnly: true,
    referenceNotice: '以下结果由 AI 参考模型给出，坐标与推导通过了格式检查但尚未经过严格数学校验，请结合陪练自行核对。'
  };
}

function referenceResultFromCandidate(candidate, normalized, gate, validation, executionPath, status) {
  const sceneSpec = buildReferenceSceneSpec(candidate, validation);
  const referenceAnswer = formatReferenceAnswer(candidate.geometryIR?.queries);
  const placeholderAnswer = {displayPlain: '请结合 AI 陪练完成本题。', latex: ''};
  return {
    status: GEOMETRY_FINAL_STATUS.AI_REFERENCE,
    geometryStatus: 'reference',
    referenceReason: status,
    sourceSemanticsStatus: gate?.pass ? 'mechanically_grounded_pending_validation' : 'candidate_pending_evidence_repair',
    compilerModel: candidate.model || null,
    executionPath,
    normalizedInput: normalized,
    geometryIR: candidate.geometryIR,
    imageAudit: candidate.imageAudit || null,
    derivedFacts: candidate.geometryIR?.derivedFacts || [],
    solutionOutline: candidate.solutionOutline || [],
    finalAnswer: referenceAnswer || candidate.finalAnswer || null,
    candidateCoordinates: candidate.candidateCoordinates,
    finalCoordinates: candidate.candidateCoordinates,
    validation,
    gate,
    sceneSpec,
    result: {
      solverStatus: 'reference',
      adapterVersion: 'deepseek-first-geometry/v1',
      answer: referenceAnswer ? {displayPlain: referenceAnswer.displayPlain, latex: referenceAnswer.latex} : placeholderAnswer,
      answerNotice: referenceAnswer ? referenceAnswer.referenceNotice : null,
      queryAnswers: referenceAnswersFromQueries(candidate.geometryIR?.queries),
      canonicalCoordinates: candidate.candidateCoordinates,
      verification: {checks: validation?.checks || [], sourceGrounding: 'pending_repair', mathVerification: 'not_verified'},
      scene: sceneSpec,
      modelNotice: sceneSpec.representation.notice
    }
  };
}

function directAIResultFromCandidate(candidate, normalized) {
  const gate = {pass: false, reviewRequired: false, issues: [], risks: [{code: 'POST_MODEL_REVIEW_DISABLED'}]};
  const validation = {pass: false, checks: [], failedConstraints: [], skipped: true, reason: 'post_model_review_disabled'};
  const result = referenceResultFromCandidate(candidate, normalized, gate, validation, 'deepseek_direct_unreviewed', 'post_model_review_disabled');
  return {
    ...result,
    reviewMode: 'disabled_by_product_decision',
    retryable: false,
    attempts: [],
    stageEvents: [{event: GEOMETRY_STAGE_EVENT.MODEL_RESPONSE_RECEIVED, stage: 'model'}]
  };
}

function resultFromCandidate(candidate, normalized, validation, executionPath) {
  const identifiability = candidate?.modelingParameters?.identifiability === 'representative' ? 'verified_representative' : 'verified_unique';
  const sceneSpec = buildVerifiedSceneSpec(candidate, validation);
  return {
    status: identifiability,
    geometryStatus:'verified',
    sourceSemanticsStatus:independentlyReviewed(candidate)?'risk_reviewed':'mechanically_grounded',
    compilerModel:candidate.model||null,
    executionPath,
    normalizedInput: normalized,
    geometryIR: candidate.geometryIR,
    imageAudit: candidate.imageAudit || null,
    derivedFacts: candidate.geometryIR.derivedFacts,
    solutionOutline: candidate.solutionOutline || [],
    finalAnswer: candidate.finalAnswer || null,
    candidateCoordinates: candidate.candidateCoordinates,
    finalCoordinates: candidate.candidateCoordinates,
    canonicalization: candidate.canonicalization,
    validation,
    sceneSpec,
    result: {
      solverStatus: 'verified',
      adapterVersion: 'deepseek-first-geometry/v1',
      answer: {
        displayPlain: String(candidate.finalAnswer?.displayPlain || candidate.finalAnswer?.plain || '请结合 AI 陪练完成本题。'),
        latex: String(candidate.finalAnswer?.latex || '')
      },
      canonicalCoordinates: Object.fromEntries(Object.entries(candidate.candidateCoordinates).map(([id, value]) => [id, value.map(exactNumber)])),
      verification: {checks: validation.checks, sourceGrounding: 'schema-evidence-gate', mathVerification: 'deterministic-validator'},
      scene: sceneSpec
    }
  };
}

export function createAnalyticGeometryFallback() {
  return async ({candidate}) => {
    const repaired = structuredClone(candidate || {});
    const ir = repaired.geometryIR || {};
    const parameters = repaired.modelingParameters || {};
    const coordinates = {...(repaired.candidateCoordinates || {})};
    let changed = false;
    const set = (id, value) => { if (id) { coordinates[id] = value; changed = true; } };
    for (const entity of ir.entities || []) {
      if (entity.kind === 'cube') {
        const edge = firstFinite(parameters.edge, entity.edge);
        if (edge > 0) for (const [id, point] of Object.entries(createCubeSpec({edge, origin:finiteVector(parameters.origin)?parameters.origin:[0,0,0], axes:parameters.axes}).coordinates)) set(id,point);
      } else if (entity.kind === 'cuboid') {
        const length=firstFinite(parameters.length,entity.length),width=firstFinite(parameters.width,entity.width),height=firstFinite(parameters.height,entity.height);
        if (length>0&&width>0&&height>0) for(const [id,point] of Object.entries(createCuboidSpec({length,width,height,origin:finiteVector(parameters.origin)?parameters.origin:[0,0,0],axes:parameters.axes}).coordinates)) set(id,point);
      } else if (entity.kind === 'prism' && Array.isArray(entity.baseVertices)) {
        const translation=finiteVector(parameters.translation)?parameters.translation:entity.translation;
        const base=Object.fromEntries(entity.baseVertices.filter(id=>finiteVector(coordinates[id])).map(id=>[id,coordinates[id]]));
        if(Object.keys(base).length===entity.baseVertices.length&&finiteVector(translation)){
          const solid=createPrismSpec({base,translation,topNames:entity.topVertices});
          for(const [id,point] of Object.entries(solid.coordinates))set(id,point);
        }
      } else if (entity.kind === 'pyramid' && Array.isArray(entity.baseVertices) && entity.apex) {
        const basePoints=entity.baseVertices.map(id=>coordinates[id]),projection=coordinates[entity.apexProjection],height=firstFinite(parameters.height,entity.height);
        if(basePoints.length>=3&&basePoints.every(finiteVector)&&finiteVector(projection)&&height>0){
          const normal=cross(subtract(basePoints[1],basePoints[0]),subtract(basePoints[2],basePoints[0])),length=norm(normal);
          if(length>0)set(entity.apex,add(projection,scale(normal,(parameters.apexSide===-1?-1:1)*height/length)));
          createPyramidSpec({base:Object.fromEntries(entity.baseVertices.map((id,index)=>[id,basePoints[index]])),apex:{[entity.apex]:coordinates[entity.apex]}});
        }
      } else if (entity.kind === 'right_cylinder') {
        const rule = constraintFor(repaired, ['right_cylinder', 'cylinder'], entity.id);
        const radius = firstFinite(parameters.radius, entity.radius, rule?.radius), height = firstFinite(parameters.height, entity.height, rule?.height);
        if (radius > 0 && height > 0) {
          set(entity.baseCenter || rule?.baseCenter, [0, 0, 0]);
          set(entity.topCenter || rule?.topCenter, [0, 0, height]);
          set(rule?.radiusPoint, [radius, 0, 0]);
        }
      } else if (entity.kind === 'right_cone') {
        const rule = constraintFor(repaired, ['right_cone', 'cone'], entity.id);
        const radius = firstFinite(parameters.radius, entity.radius, rule?.radius), height = firstFinite(parameters.height, entity.height, rule?.height);
        if (radius > 0 && height > 0) {
          set(entity.baseCenter || rule?.baseCenter, [0, 0, 0]);
          set(entity.apex || rule?.apex, [0, 0, height]);
          set(rule?.rimPoint, [radius, 0, 0]);
        }
      } else if (entity.kind === 'sphere') {
        const rule = constraintFor(repaired, ['sphere'], entity.id);
        const radius = firstFinite(parameters.radius, entity.radius, rule?.radius);
        const centerId = entity.center || rule?.center;
        if (radius > 0 && centerId) {
          set(centerId, [0, 0, 0]);
          for (const pointId of rule?.surfacePoints || []) set(pointId, [radius, 0, 0]);
        }
      }
    }
    for (const constraint of ir.constraints || []) {
      if (constraint.kind === 'section_circle') {
        const centerDistance = firstFinite(constraint.centerDistance, parameters.planeDistance);
        if (centerDistance >= 0) set(constraint.center, [0, 0, centerDistance]);
      } else if ((constraint.kind === 'distance' || constraint.kind === 'length') && Array.isArray(constraint.points) && constraint.points.length === 2) {
        const value = Number(constraint.value);
        if (value > 0 && Object.keys(coordinates).length <= 2) {
          set(constraint.points[0], [0, 0, 0]);
          set(constraint.points[1], [value, 0, 0]);
        }
      }
    }
    if (!changed) return null;
    repaired.candidateCoordinates = coordinates;
    const validDependencies=new Set((ir.constraints||[]).map(item=>item.id));
    repaired.suggestedConstructions=(repaired.suggestedConstructions||[]).filter(construction=>{
      const dependencies=construction.dependsOn||construction.constraintRefs||[];
      return dependencies.every(ref=>validDependencies.has(ref))&&(construction.points||[]).every(point=>finiteVector(coordinates[point]));
    });
    repaired.coordinateSystem = {dimension: 3, handedness: 'right', zUp: true, canonical: true, source: 'analytic_fallback'};
    return repaired;
  };
}

export function createTrustedGeometryPipeline(options = {}) {
  if (typeof options.modelAdapter !== 'function') throw new TypeError('modelAdapter is required');
  const cache = options.cache || new Map();
  const inFlight=new Map();
  const versionKey = options.versionKey || TRUSTED_GEOMETRY_VERSION_KEY;
  const compileGeometryProblem=async(input = {})=>{
      // A complete geometry response can contain a solution, IR, coordinates,
      // evidence and per-subproblem views.  Keep a real end-to-end budget for
      // that payload instead of treating it like a short chat completion.
      const pipelineDeadline=Date.now()+Math.max(3000,Number(options.totalTimeoutMs||420000));
      const normalized = normalizeGeometryInput(input);
      const tenantScope=`${String(input.schoolId||'local')}:${String(input.studentId||'anonymous')}`;
      const cacheKey = `${tenantScope}:${String(options.modelVersion||'adapter-default')}:${normalized.inputHash}:${versionKey}`;
      if (cache.has(cacheKey)) return {...structuredClone(cache.get(cacheKey)), cacheHit: true};
      if(!input[INTERNAL_PIPELINE_RUN]){
        if(inFlight.has(cacheKey))return structuredClone(await inFlight.get(cacheKey));
        const execution=compileGeometryProblem({...input,[INTERNAL_PIPELINE_RUN]:true});
        inFlight.set(cacheKey,execution);
        try{return await execution;}finally{inFlight.delete(cacheKey);}
      }
      const attempts=[],stageEvents=[];
       const invoke=async(stage,adapter,context)=>{
         const remainingMs=pipelineDeadline-Date.now(),stageLimit=stage==='model'?180000:stage==='semantic_review'?150000:stage==='coordinate_review'?90000:30000;
        if(remainingMs<3000){
          attempts.push({stage,category:'PIPELINE_BUDGET_EXHAUSTED',httpStatus:null});
           stageEvents.push({event:stage==='model'?GEOMETRY_STAGE_EVENT.MODEL_REQUEST_FAILED:stage==='fallback'?GEOMETRY_STAGE_EVENT.FALLBACK_FAILED:GEOMETRY_STAGE_EVENT.REVIEW_FAILED,stage,category:'PIPELINE_BUDGET_EXHAUSTED'});
          return null;
        }
         const startedEvent=stage==='model'?GEOMETRY_STAGE_EVENT.MODEL_REQUEST_STARTED:stage==='fallback'?GEOMETRY_STAGE_EVENT.FALLBACK_STARTED:GEOMETRY_STAGE_EVENT.REVIEW_STARTED;
        stageEvents.push({event:startedEvent,stage});
        try{
          const value=await adapter({...context,stageBudgetMs:Math.min(stageLimit,remainingMs),pipelineDeadline});
          if(stage==='model')stageEvents.push({event:GEOMETRY_STAGE_EVENT.MODEL_RESPONSE_RECEIVED,stage});
          return value;
        }catch(error){
          const allowed=['PROVIDER_TIMEOUT','PROVIDER_NETWORK_ERROR','PROVIDER_HTTP_ERROR','PROVIDER_RESPONSE_ERROR'];
           attempts.push({stage,category:allowed.includes(error?.code)?error.code:'STAGE_EXECUTION_FAILED',httpStatus:Number.isInteger(error?.httpStatus)?error.httpStatus:null,retryable:error?.retryable!==false});
           stageEvents.push({event:stage==='model'?GEOMETRY_STAGE_EVENT.MODEL_REQUEST_FAILED:stage==='fallback'?GEOMETRY_STAGE_EVENT.FALLBACK_FAILED:GEOMETRY_STAGE_EVENT.REVIEW_FAILED,stage,category:allowed.includes(error?.code)?error.code:'STAGE_EXECUTION_FAILED'});
          return null;
        }
      };
      const inspect=value=>{
        try{
          const gate=runGeometryEvidenceGate(normalized,value);
          return {gate,validation:gate.pass?validateGeometryCandidate(value):{pass:false,checks:[],failedConstraints:gate.issues.map(item=>item.code)}};
        }catch{
          return {gate:{pass:false,reviewRequired:true,issues:[{code:'INVALID_CANDIDATE_STRUCTURE'}],risks:[]},validation:{pass:false,checks:[],failedConstraints:['INVALID_CANDIDATE_STRUCTURE']}};
        }
      };
      const adoptReviewedCandidate=(base,reviewed,stage)=>{
        if(!reviewed)return null;
        try{
          return reviewed.schemaVersion==='geometry-repair-response/v1'
            ?applyGeometryRepairPatch(base,reviewed)
            :reviewed;
        }catch(error){
          attempts.push({stage,category:'PROVIDER_RESPONSE_ERROR',httpStatus:null});
          stageEvents.push({event:GEOMETRY_STAGE_EVENT.REVIEW_FAILED,stage,category:'PROVIDER_RESPONSE_ERROR',message:String(error?.message||error)});
          return null;
        }
      };
       let candidate = await invoke('model',options.modelAdapter,{...input, normalized});
       if (options.directModelOutput === true) {
         if (canRenderReferenceCandidate(candidate)) {
           /* ------------------------------------------------------------------
              数学验算 + 失败局部修复。
              验算只用 Geometry IR 的硬约束与坐标，不碰语义/证据/题型判断。
              关键设计：验算失败**不阻断渲染** ——
                1) 把没通过的约束与残差记进结果，前端能看到"哪条关系不成立"；
                2) 时间还够时只让模型修相关坐标（局部 patch），不重生整题；
                3) 无论修复是否成功都仍然给出可旋转模型，
                   学生不该因为一条约束对不上就什么都看不到。
              ------------------------------------------------------------------ */
           let workingCandidate = candidate;
           let mathReport = safeValidateCandidateMath(workingCandidate);
           let repairedLocally = false;
           if (!mathReport.pass && mathReport.failedConstraints.length && Date.now() < pipelineDeadline - 20000) {
             try {
               const patchPrompt = buildConstraintRepairPrompt(mathReport, workingCandidate);
               // 直接调 modelAdapter（compileGeometryProblem 就把它当第一个参数），
               // 把局部修复指令经 repairPrompt 传进去，由适配器换成该 prompt 再请求。
               const patched = await invoke('coordinate_repair', options.modelAdapter, {
                 ...input, normalized, repairPrompt: patchPrompt, candidate: workingCandidate
               });
               if (patched) {
                 const after = safeValidateCandidateMath(patched);
                 repairedLocally = after.pass;
                 mathReport = repairedLocally ? after : {...after, repairAttempted: true, beforeRepair: mathReport.failedConstraints};
                 workingCandidate = patched;
               }
             } catch (error) {
               mathReport = {...mathReport, repairAttempted: true, repairError: String(error?.message || error).slice(0, 160)};
             }
           }
           const directResult = directAIResultFromCandidate(workingCandidate, normalized);
           directResult.attempts = attempts;
           directResult.stageEvents = stageEvents;
           directResult.mathValidation = mathReport;
           directResult.coordinatesRepairedLocally = repairedLocally;
           cache.set(cacheKey, structuredClone(directResult));
           return directResult;
         }
         if (!candidate && attempts.length) {
           const modelFailure=attempts.find(item=>item.stage==='model')||{};
           return {
             status: GEOMETRY_FINAL_STATUS.PROVIDER_UNAVAILABLE,
             failureCategory: modelFailure.category || 'STAGE_EXECUTION_FAILED',
             httpStatus: modelFailure.httpStatus || null,
             attempts,
             stageEvents,
             executionPath: 'deepseek_direct_unreviewed',
             normalizedInput: normalized,
             retryable: modelFailure.retryable !== false
           };
         }
         return {
           status: GEOMETRY_FINAL_STATUS.IR_INVALID,
           failureCategory: 'MODEL_DID_NOT_RETURN_RENDERABLE_COORDINATES',
           attempts,
           stageEvents,
           executionPath: 'deepseek_direct_unreviewed',
           normalizedInput: normalized,
           retryable: true
         };
       }
       let {gate,validation}=inspect(candidate);
       let executionPath = 'deepseek_direct';
       const semanticAdapter=typeof options.semanticReviewAdapter==='function'?options.semanticReviewAdapter:null;
       if ((gate.reviewRequired || !gate.pass) && typeof semanticAdapter === 'function') {
         const reviewTrigger={issues:[...(gate.issues||[])],risks:[...(gate.risks||[])]};
         const reviewed = await invoke('semantic_review',semanticAdapter,{input, normalized, candidate, gate, validation});
         const reviewedCandidate=adoptReviewedCandidate(candidate,reviewed,'semantic_review');
         if (reviewedCandidate) {
           candidate = reviewedCandidate;
           executionPath = reviewed?.schemaVersion==='geometry-repair-response/v1'?'deepseek_repaired':'deepseek_recompiled';
         }
        ({gate,validation}=inspect(candidate));
        if(reviewedCandidate&&(reviewTrigger.issues.length||reviewTrigger.risks.length)){
          const reportValidation=validateSemanticReviewReport(reviewedCandidate.semanticReviewReport),report=reviewedCandidate.semanticReviewReport||{};
          const reviewedIssues=new Set(report.reviewedIssueCodes||[]),reviewedRisks=new Set(report.reviewedRiskCodes||[]);
          const missingIssueCodes=reviewTrigger.issues.map(item=>item.code).filter(code=>!reviewedIssues.has(code));
          const missingRiskCodes=reviewTrigger.risks.map(item=>item.code).filter(code=>!reviewedRisks.has(code));
          const contractIssues=[...reportValidation.issues];
          if(report.status==='rejected')contractIssues.push({code:'SEMANTIC_REVIEW_REJECTED'});
          if(missingIssueCodes.length||missingRiskCodes.length)contractIssues.push({code:'SEMANTIC_REVIEW_INCOMPLETE',missingIssueCodes,missingRiskCodes});
          if(contractIssues.length){
            gate={...gate,pass:false,reviewRequired:true,issues:[...(gate.issues||[]),...contractIssues]};
            validation={pass:false,checks:validation.checks||[],failedConstraints:[...(validation.failedConstraints||[]),...contractIssues.map(item=>item.code)]};
          }else{
            independentlyReviewedCandidates.add(reviewedCandidate);
            ({gate,validation}=inspect(candidate));
           }
         }
       }
       if(gate.pass&&!gate.reviewRequired&&!validation.pass&&typeof options.reviewAdapter==='function'){
         const reviewed=await invoke('coordinate_review',options.reviewAdapter,{input,normalized,candidate,gate,validation});
         const reviewedCandidate=adoptReviewedCandidate(candidate,reviewed,'coordinate_review');
         if(reviewedCandidate){
           candidate=reviewedCandidate;
           executionPath=executionPath==='deepseek_recompiled'?'deepseek_recompiled_repaired':'deepseek_repaired';
           const reportValidation=validateSemanticReviewReport(candidate?.semanticReviewReport);
           if(reportValidation.pass)independentlyReviewedCandidates.add(candidate);
           ({gate,validation}=inspect(candidate));
         }
       }
      const fallbackEligible=()=>{
        if(!candidate)return false;
        const repairableIssues=(gate.issues||[]).every(issue=>issue.code==='DANGLING_CONSTRUCTION_DEPENDENCY'||issue.code==='DANGLING_GEOMETRY_REFERENCE'&&String(issue.path||'').startsWith('suggestedConstructions.'));
        const repairableRisks=(gate.risks||[]).every(risk=>risk.code==='CANDIDATE_COORDINATES_MISSING');
        return repairableIssues&&repairableRisks;
      };
      if ((!gate.pass || gate.reviewRequired || !validation.pass) && fallbackEligible() && typeof options.fallbackSolver === 'function') {
        const solved = await invoke('fallback',options.fallbackSolver,{input, normalized, candidate, gate, validation});
        if (solved) candidate = solved;
        ({gate,validation}=inspect(candidate));
        executionPath = 'fallback_solver';
      }
      if (!gate.pass || gate.reviewRequired) {
        if(!candidate&&attempts.length){
          const modelFailure=attempts.find(item=>item.stage==='model')||{},failureCategory=modelFailure.category||'STAGE_EXECUTION_FAILED',httpStatus=modelFailure.httpStatus||null;
          const status=failureCategory==='PROVIDER_RESPONSE_ERROR'?GEOMETRY_FINAL_STATUS.IR_INVALID
            :httpStatus===402?GEOMETRY_FINAL_STATUS.PROVIDER_BILLING_REQUIRED
            :[401,403].includes(httpStatus)?GEOMETRY_FINAL_STATUS.PROVIDER_AUTH_FAILED
            :httpStatus===429?GEOMETRY_FINAL_STATUS.PROVIDER_RATE_LIMITED
            :httpStatus>=400&&httpStatus<500?GEOMETRY_FINAL_STATUS.IR_INVALID
            :GEOMETRY_FINAL_STATUS.PROVIDER_UNAVAILABLE;
          const retryable=modelFailure.retryable!==false&&(!httpStatus||[408,409,425,429].includes(httpStatus)||httpStatus>=500);
          return {status,failureCategory,httpStatus,attempts,stageEvents,executionPath,normalizedInput:normalized,gate,validation,retryable};
        }
        const issueCodes=new Set((gate.issues||[]).map(item=>item.code));
        const status = issueCodes.has('CAPABILITY_NOT_REGISTERED') ? GEOMETRY_FINAL_STATUS.UNSUPPORTED_CONSTRAINT_SET
          : [...issueCodes].some(code=>/EVIDENCE|SOURCE_(?:CLAUSE|QUANTITY|PARAMETER|RATIO|STRUCTURAL|RELATION|QUERY|MIDPOINT|UNIT)/.test(code)) ? GEOMETRY_FINAL_STATUS.EVIDENCE_FAILED
          : gate.risks?.some(item=>item.code==='CONFLICTING_EXPLICIT_FACTS') ? GEOMETRY_FINAL_STATUS.CONTRADICTORY
          : gate.risks?.some(item => item.code === 'UNRESOLVED_MODELING_ITEMS') ? GEOMETRY_FINAL_STATUS.UNDERDETERMINED_FOR_QUERY
          : GEOMETRY_FINAL_STATUS.IR_INVALID;
        const unsafeReferenceIssue=(gate.issues||[]).some(issue=>/DERIVED_FACT|FACT_VALUE|CONTRADICT|CYCLE|MATH/.test(String(issue.code||'')));
        if(status===GEOMETRY_FINAL_STATUS.UNDERDETERMINED_FOR_QUERY&&!unsafeReferenceIssue&&canRenderReferenceCandidate(candidate)){
          const reference=referenceResultFromCandidate(candidate,normalized,gate,validation,executionPath,status);
          return {...reference,attempts,stageEvents,retryable:true,sourceFailureStatus:status};
        }
        return {status, attempts, stageEvents, executionPath, normalizedInput: normalized, gate, validation,retainedCandidate:candidate?{geometryIR:candidate.geometryIR,sourceCoverage:candidate.sourceCoverage||[],solutionOutline:candidate.solutionOutline||[],finalAnswer:candidate.finalAnswer||null,candidateCoordinates:candidate.candidateCoordinates,sceneSpec:canRenderReferenceCandidate(candidate)?buildReferenceSceneSpec(candidate,validation):null}:null,retryable: true};
      }
      if (!validation.pass) {
        const status = executionPath === 'fallback_solver' ? 'solver_failed' : 'validation_failed';
        if (canRenderReferenceCandidate(candidate)) {
          const reference = referenceResultFromCandidate(candidate, normalized, gate, validation, executionPath, status);
          return {...reference, attempts, stageEvents, retryable: true};
        }
        return {status, attempts, stageEvents, executionPath, normalizedInput: normalized, gate, validation, retryable: true};
      }
      if(candidate?.modelingParameters?.identifiability==='representative'&&!representativeEmbeddingIsProven(candidate,validation))return {status:GEOMETRY_FINAL_STATUS.UNDERDETERMINED_FOR_QUERY,geometryStatus:'failed',sourceSemanticsStatus:independentlyReviewed(candidate)?'risk_reviewed':'mechanically_grounded',attempts,stageEvents,executionPath,normalizedInput:normalized,gate,validation,retryable:false};
      candidate = canonicalizeGeometryCandidate(candidate);
      const canonicalValidation = validateGeometryCandidate(candidate);
      if (!canonicalValidation.pass) return {status: 'validation_failed', attempts, stageEvents, executionPath, normalizedInput: normalized, gate, validation: canonicalValidation, retryable: false};
      const result = resultFromCandidate(candidate, normalized, canonicalValidation, executionPath);
      result.attempts=attempts;
      result.stageEvents=stageEvents;
      cache.set(cacheKey, structuredClone(result));
      return result;
  };
  return {compileGeometryProblem,run:compileGeometryProblem};
}

function parseModelJson(content) {
  if (typeof content !== 'string') return content;
  return JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
}

const COMPILE_RESPONSE_FIELDS=new Set(['schemaVersion','geometryIR','sourceCoverage','candidateCoordinates','unresolvedItems','imageAudit','solutionOutline','finalAnswer','modelingParameters','coordinateSystem','suggestedConstructions','confidence','visualFocus','highlightEntities','annotations','constructionDisplayPlan','subproblemVisualization','visibilitySequence','semanticReviewReport']);
export function validateGeometryCompileResponse(value,{imageRequired=false,reviewRequired=false}={}){
  const issues=[];
  if(!value||typeof value!=='object'||Array.isArray(value))return{pass:false,issues:[{code:'COMPILE_RESPONSE_NOT_OBJECT'}]};
  if(value.schemaVersion!=='geometry-compile-response/v1')issues.push({code:'COMPILE_RESPONSE_VERSION_INVALID'});
  for(const field of ['geometryIR','sourceCoverage','candidateCoordinates','unresolvedItems'])if(!(field in value))issues.push({code:'COMPILE_RESPONSE_FIELD_MISSING',field});
  for(const field of Object.keys(value))if(!COMPILE_RESPONSE_FIELDS.has(field))issues.push({code:'COMPILE_RESPONSE_UNKNOWN_FIELD',field});
  if(value.geometryIR?.schemaVersion!=='geometry-ir/v4')issues.push({code:'COMPILE_RESPONSE_IR_VERSION_INVALID'});
  for(const field of ['entities','explicitFacts','derivedFacts','constraints','queries','evidence'])if(!Array.isArray(value.geometryIR?.[field]))issues.push({code:'COMPILE_RESPONSE_IR_ARRAY_INVALID',field});
  if(!Array.isArray(value.sourceCoverage))issues.push({code:'COMPILE_RESPONSE_SOURCE_COVERAGE_INVALID'});
  if(!Array.isArray(value.unresolvedItems))issues.push({code:'COMPILE_RESPONSE_UNRESOLVED_INVALID'});
  if(value.candidateCoordinates!==null&&(typeof value.candidateCoordinates!=='object'||Array.isArray(value.candidateCoordinates)))issues.push({code:'COMPILE_RESPONSE_COORDINATES_INVALID'});
  const hasCoordinates=value.candidateCoordinates&&typeof value.candidateCoordinates==='object'&&Object.keys(value.candidateCoordinates).length>0;
  const queries=Array.isArray(value.geometryIR?.queries)?value.geometryIR.queries:[];
  if(queries.length&&(!Array.isArray(value.solutionOutline)||value.solutionOutline.length===0))issues.push({code:'COMPILE_RESPONSE_SOLUTION_OUTLINE_MISSING'});
  if(queries.length&&(!value.finalAnswer||typeof value.finalAnswer!=='object'||Array.isArray(value.finalAnswer)))issues.push({code:'COMPILE_RESPONSE_FINAL_ANSWER_MISSING'});
  if(hasCoordinates&&queries.length){
    if(!Array.isArray(value.subproblemVisualization))issues.push({code:'COMPILE_RESPONSE_SUBPROBLEM_VIEWS_MISSING'});
    else{
      const queryIds=new Set(value.subproblemVisualization.map(item=>String(item?.queryId||'')).filter(Boolean));
      for(const query of queries)if(query?.id&&!queryIds.has(String(query.id)))issues.push({code:'COMPILE_RESPONSE_SUBPROBLEM_VIEW_MISSING',queryId:String(query.id)});
    }
  }
  if(imageRequired&&!('imageAudit'in value))issues.push({code:'COMPILE_RESPONSE_IMAGE_AUDIT_MISSING'});
  if(reviewRequired&&!validateSemanticReviewReport(value.semanticReviewReport).pass)issues.push({code:'COMPILE_RESPONSE_REVIEW_INVALID'});
  return{pass:issues.length===0,issues};
}

const REPAIR_RESPONSE_FIELDS=new Set(['schemaVersion','semanticReviewReport','patch']);
const REPAIRABLE_ROOTS=new Set(['candidateCoordinates','modelingParameters','coordinateSystem','suggestedConstructions','unresolvedItems','imageAudit','solutionOutline','finalAnswer','visualFocus','highlightEntities','annotations','constructionDisplayPlan','subproblemVisualization','visibilitySequence','confidence']);
const FORBIDDEN_POINTER_PARTS=new Set(['__proto__','prototype','constructor']);

export function validateGeometryRepairResponse(value){
  const issues=[];
  if(!value||typeof value!=='object'||Array.isArray(value))return{pass:false,issues:[{code:'REPAIR_RESPONSE_NOT_OBJECT'}]};
  if(value.schemaVersion!=='geometry-repair-response/v1')issues.push({code:'REPAIR_RESPONSE_VERSION_INVALID'});
  for(const field of Object.keys(value))if(!REPAIR_RESPONSE_FIELDS.has(field))issues.push({code:'REPAIR_RESPONSE_UNKNOWN_FIELD',field});
  const report=validateSemanticReviewReport(value.semanticReviewReport);
  if(!report.pass)issues.push(...report.issues.map(issue=>({...issue,scope:'semanticReviewReport'})));
  if(!Array.isArray(value.patch))issues.push({code:'REPAIR_PATCH_INVALID'});
  else for(const [index,item] of value.patch.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item)){issues.push({code:'REPAIR_OPERATION_INVALID',index});continue}
    if(!['add','replace','remove'].includes(item.op))issues.push({code:'REPAIR_OPERATION_UNSUPPORTED',index});
    if(typeof item.path!=='string'||!item.path.startsWith('/'))issues.push({code:'REPAIR_PATH_INVALID',index});
    const parts=typeof item.path==='string'?item.path.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~')):[];
    if(!REPAIRABLE_ROOTS.has(parts[0])||parts.some(part=>FORBIDDEN_POINTER_PARTS.has(part)))issues.push({code:'REPAIR_PATH_NOT_ALLOWED',index,path:item.path});
    if(item.op!=='remove'&&!Object.prototype.hasOwnProperty.call(item,'value'))issues.push({code:'REPAIR_VALUE_MISSING',index});
    for(const field of Object.keys(item))if(!['op','path','value'].includes(field))issues.push({code:'REPAIR_OPERATION_UNKNOWN_FIELD',index,field});
  }
  return{pass:issues.length===0,issues};
}

export function applyGeometryRepairPatch(candidate,repair){
  const contract=validateGeometryRepairResponse(repair);
  if(!contract.pass){const error=new Error('GEOMETRY_REPAIR_RESPONSE_INVALID');Object.assign(error,{code:'PROVIDER_RESPONSE_ERROR',issues:contract.issues});throw error}
  const next=structuredClone(candidate);
  for(const operation of repair.patch){
    const parts=operation.path.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));
    let parent=next;
    for(let index=0;index<parts.length-1;index+=1){
      const key=parts[index];
      if(parent[key]===undefined){if(operation.op==='add')parent[key]={};else throw Object.assign(new Error('GEOMETRY_REPAIR_PATH_MISSING'),{code:'PROVIDER_RESPONSE_ERROR',path:operation.path})}
      if(!parent[key]||typeof parent[key]!=='object')throw Object.assign(new Error('GEOMETRY_REPAIR_PATH_INVALID'),{code:'PROVIDER_RESPONSE_ERROR',path:operation.path});
      parent=parent[key];
    }
    const key=parts.at(-1);
    if(operation.op==='remove'){
      if(Array.isArray(parent)){const position=Number(key);if(!Number.isInteger(position)||position<0||position>=parent.length)throw Object.assign(new Error('GEOMETRY_REPAIR_PATH_MISSING'),{code:'PROVIDER_RESPONSE_ERROR',path:operation.path});parent.splice(position,1)}
      else delete parent[key];
    }else if(Array.isArray(parent)){
      if(key==='-'&&operation.op==='add')parent.push(structuredClone(operation.value));
      else{const position=Number(key);if(!Number.isInteger(position)||position<0||position>(operation.op==='add'?parent.length:parent.length-1))throw Object.assign(new Error('GEOMETRY_REPAIR_PATH_INVALID'),{code:'PROVIDER_RESPONSE_ERROR',path:operation.path});if(operation.op==='add')parent.splice(position,0,structuredClone(operation.value));else parent[position]=structuredClone(operation.value)}
    }else parent[key]=structuredClone(operation.value);
  }
  next.semanticReviewReport=structuredClone(repair.semanticReviewReport);
  return next;
}

const geometryCompilerPrompt = normalized => `你是高中静态立体几何编译器。请完整阅读整道题并完整解题，只输出严格 JSON，不要 Markdown，也不要输出隐藏思维链。不得只提取第一个条件；全部已知条件、全部小问、全部证明/计算目标和全部几何关系都必须保留。
目标：直接提出一个教材友好、满足题目全部条件的三维候选模型。把自己当作“题意 → 可交互 XYZ 空间场景”的编译器：只要题目描述了可空间化的点、线、面、实体或两个平面关系，就必须先尝试给出可旋转参考坐标、边/面/辅助构造和 XYZ 坐标轴，而不是因为当前规则库未覆盖该题型就放弃建模。你可以推导题目隐含参数，但不得凭空增加条件。若某个量不唯一，保留已知比例与关系，使用 representative 姿态，并把真正影响数值答案的未定项写入 unresolvedItems；不要把“不是固定模板”当作无法建模的理由。
原始题目：${normalized.originalInput}
规范化题目：${normalized.normalizedInput}
题型：${normalized.questionType}
选择题查询：${JSON.stringify(normalized.optionQueries)}
全文语义分句（每项都必须在 sourceCoverage 中归类）：${JSON.stringify(normalized.semanticClauses)}
服务端从原文识别的数量条件（given 必须逐条进入硬约束，query 不能当已知）：${JSON.stringify(normalized.quantityMentions)}
服务端识别的实体参数条件（半径、高、母线、棱长、中心距等必须逐项进入硬约束）：${JSON.stringify(normalized.parameterMentions)}
服务端识别的比例条件（不得改写或遗漏）：${JSON.stringify(normalized.ratioMentions)}
服务端识别的点线面、投影、共面、等长与相切条件（逐项进入同名硬约束）：${JSON.stringify(normalized.structuralMentions)}
全部条件原子（每个 given 原子都必须有 explicitFact + hard constraint）：${JSON.stringify(normalized.conditionAtoms)}
题目所求目标（必须逐项生成语义一致的 query）：${JSON.stringify(normalized.queryMentions)}
服务端识别的中点条件（分别关系必须按顺序对应并逐条输出 midpoint 硬约束）：${JSON.stringify(normalized.midpointMentions)}
规则层识别到的关系清单（逐项保留，不得遗漏）：${JSON.stringify(normalized.relationMentions)}

 首次编译必须返回 schemaVersion="geometry-compile-response/v1"。其余必需顶层字段只有：geometryIR、sourceCoverage、candidateCoordinates、unresolvedItems。无法给坐标时 candidateCoordinates 必须为 null，并在 unresolvedItems 写明原因。有图片时还必须提供 imageAudit，包含 imageHash、pageCompleteness、coverageRegions、unreadableRegions、diagramMarks、marksPresence。marksPresence 只能是 detected、none_confirmed 或 uncertain；逐区覆盖题干、图形、选项和学生书写区域，不能用一个框代表整图。禁止输出合同未声明的顶层字段。
 modelingParameters、coordinateSystem、suggestedConstructions、confidence 可按需提供。只要存在 query，solutionOutline 必须包含非空的完整解题步骤，finalAnswer 必须是 {displayPlain,latex}；visualFocus、highlightEntities、annotations、constructionDisplayPlan、visibilitySequence 可按需提供，不能因为教学展示字段暂时为空而省略数学 IR 或候选坐标。一旦输出非空 candidateCoordinates，必须为 geometryIR.queries 中每个小问输出一项 subproblemVisualization，并用 queryId 精确关联该小问。
sourceCoverage 必须逐项覆盖上面的全文语义分句，格式为 {clauseId,status,refs}。status 只能是 explicit_fact、derived_fact、query、context、unresolved；前三类 refs 必须指向 geometryIR 内真实存在的 ID。无法判断的内容标记 unresolved，禁止静默遗漏或猜测。
finalAnswer 使用 {displayPlain,latex}，只放最终可展示结论；solutionOutline 只写可展示的简要推导步骤。
geometryIR.schemaVersion 必须是 geometry-ir/v4；包含 entities、explicitFacts、derivedFacts、constraints、queries、evidence 六个数组。
explicitFacts 每项必须有 evidenceRefs；文字证据使用 {id,kind:"text",quote:"题目中连续出现的原文"}。仅当本次提供图片时，图片独有证据可用 {id,kind:"image",imageHash,region:[x,y,width,height],quote:"区域内实际文字或关系标记的描述",confidence:0到1}。region 使用相对整张图片的0到1归一化坐标，区域不可超出图片。本次 imageHash=${JSON.stringify(normalized.imageHash)}。不可用图形看起来等长、平行或垂直代替题目的明确标记。
derivedFacts 每项必须包含 dependencies 和可复核 expression。
每个 constraint 必须用 factRefs 指向它实际验证的 explicitFacts/derivedFacts；每条建模相关硬事实都必须至少被一个 factRefs 覆盖，不能用无关约束代替。
candidateCoordinates 是点名到 [x,y,z] 数值数组的映射。关键点优先放原点，底面优先 z=0，高或主轴优先 z 轴；不得改变真实比例。没有唯一姿态时 modelingParameters.identifiability="representative"。
constraints 使用 entity+constraint，不按题型名称匹配。硬约束 hard=true。可用 kind 包括 distance、length、ratio、midpoint、projection、perpendicular、parallel、point_on_line、point_on_plane、point_line_distance、point_plane_distance、skew_line_distance、line_plane_angle、dihedral_angle、coplanar、equal_length、angle、polyhedron、polyhedron_section、circle、right_cylinder、cylinder、right_cone、cone、sphere、section_circle、tangent、positive、intersection、quadrilateral_type。向量平行/垂直必须使用 parallel/perpendicular，不得把 query 类型 vector_relation 当作 constraint。
每个坐标点必须在 entities 中声明为 {id,kind:"point"}；线段声明为 {id,kind:"segment",points:[...]}；球/圆柱/圆锥/截面圆也声明为实体。
棱柱、棱锥、正方体、长方体必须声明完整拓扑：{id,kind:"prism|pyramid|cube|cuboid",faces:[[...],...]}；也可对棱柱提供 baseVertices+topVertices，对棱锥提供 baseVertices+apex。必须添加 {kind:"polyhedron",entity:"实体ID",hard:true} 约束，让 Validator 验证全部面共面、全部棱非退化和引用完整。
多面体截面不得按题型画固定矩形。请先根据截平面与全部棱求出真实交点，在 entities 中声明 {id,kind:"section_polygon",points:[...],normal:[...]}, 并添加 {kind:"polyhedron_section",solid:"实体ID",normal:[nx,ny,nz],offset:d,points:[...],vertexCount:n,hard:true}。截平面采用 normal·point=offset；每个截面点必须有 candidateCoordinates，Validator 会独立重新求交并逐点对比。
空间角和距离必须引用真实点：line_plane_angle 使用 line+plane，dihedral_angle 使用 firstPlane+secondPlane，point_plane_distance 使用 point+planePoints，skew_line_distance 使用 firstLine+secondLine。角度可用 degrees，线面角也可用 measure:"sine"+value，二面角可用 measure:"cosine"+value。
dihedral_angle 必须区分语义：题目明确求两平面的较小夹角时写 angleType:"plane_angle"；指定二面角时写 angleType:"dihedral"、edge:[棱上两点ID]、firstSide:第一平面内棱外点ID、secondSide:第二平面内棱外点ID。不得按顶点列举顺序猜半平面，不得把钝角改成锐角；缺少选点证据时声明信息不足，不编造。此要求同样适用于queries和constraints。
visualFocus、highlightEntities、annotations、constructionDisplayPlan、subproblemVisualization、visibilitySequence 只负责“当前小问该展示什么”，绝不能给坐标或新增数学条件。annotations 允许 kind：length、angle、rightAngle、radius、diameter、height、distance、parallel、perpendicular、equalLength、midpoint、projection、center、tangentPoint、planeLabel、sectionLabel、arc、coordinate、unitScale；每项必须提供 entityRefs，若声明 constraintRefs，它们必须是 geometryIR 中的已验证约束 ID。没有已验证的投影、垂直、等长或切点时不要生成对应标记。多小问可用 subproblemVisualization，分别给出 highlightEntities 和 annotationIds。
球截面必须验证 R^2=r^2+d^2；圆锥可由 l^2=r^2+h^2 推导；所有推导值同时写入 derivedFacts 与 modelingParameters。
无法可靠确定时写入 unresolvedItems，不要猜测。`;

async function callDeepSeekGeometry(config, input, prompt, callOptions = {}) {
  if (!config.endpoint || !config.apiKey) throw new Error('DEEPSEEK_GEOMETRY_NOT_CONFIGURED');
  const fetchImpl = config.fetchImpl || fetch;
  const maxAttempts=Math.max(1,Math.min(5,Number(config.maxAttempts??3)||3));
  /* 立体几何编译是一份很长的 JSON（含 IR、证据、坐标、解题步骤、小问视图），
     实测单次完整生成要 90~150 秒。旧的 120 秒硬上限 + 75% 切分只剩 90 秒，
     会把"慢但成功"的请求一次次掐断。这里把上限提到 300 秒。
     注意：仍然会被 stageBudgetMs（阶段预算）收紧，不会超过流水线总预算。 */
  const timeoutMs=Math.max(1000,Math.min(300000,Number(config.timeoutMs??30000)||30000));
  const retryDelayMs=Math.max(0,Number(config.retryDelayMs??250)||0);
  const model=input.imageData?(config.visionModel||config.model||'deepseek-flash'):(config.model||'deepseek-v4-flash');
  const log=(event,details={})=>{if(typeof config.logger==='function')config.logger({event,provider:'deepseek',...details})};
  const deadline=Date.now()+timeoutMs;
  let lastError;
  // 共享的"一次明确的 JSON 请求"：主请求和坐标补问都走它。
  const requestDeepSeekJson = async (promptText, validateContract = true, attemptBudgetMs = null) => {
    const controller=new AbortController();
    // 单次请求的窗口：默认用掉剩余预算的 3/4，最后一次尝试用满剩余预算。
    const remaining=Math.max(500,deadline-Date.now());
    const windowMs=Math.max(500,Math.min(Number.isFinite(attemptBudgetMs)?attemptBudgetMs:remaining,remaining));
    /* abort(reason) 时 fetch 拒绝的 reason 就是这里传入的对象。
       旧代码传的是普通 Error，于是 cause.name === 'Error'，
       超时被误判成 PROVIDER_NETWORK_ERROR —— 日志里就会出现
       "网络错误"而实际是超时，还会走无限重试。
       这里打上可识别的标记，让超时被正确归类。 */
    const abortReason=new Error('DEEPSEEK_GEOMETRY_TIMEOUT');
    abortReason.name='AbortError';
    abortReason.__dshTimeout=true;
    const timer=setTimeout(()=>controller.abort(abortReason),windowMs);
    try{
      /* 关键：fetch 本身必须也被这个 catch 覆盖。
         旧结构把 try 放在 fetch 之后，只包住 response.json()，
         于是 abort（我们自己的超时窗口）会直接跳到外层 catch，
         被误判成 PROVIDER_NETWORK_ERROR，超时再也不被识别。 */
      let response;
      try{
        response=await fetchImpl(config.endpoint,{
          method:'POST',signal:controller.signal,
          headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},
          body:JSON.stringify({model,messages:[{role:'user',content:[{type:'text',text:promptText},...(input.imageData?[{type:'image_url',image_url:{url:input.imageData,detail:'original'}}]:[])]}],temperature:0.1,response_format:{type:'json_object'}})
        });
        if(!response.ok){
          const retryable=[408,409,425,429].includes(response.status)||response.status>=500;
          const error=new Error(`DEEPSEEK_GEOMETRY_REQUEST_FAILED:${response.status}`);
          Object.assign(error,{code:'PROVIDER_HTTP_ERROR',provider:'deepseek',httpStatus:response.status,requestId:response.headers?.get?.('x-request-id')||null,retryable});
          throw error;
        }
      }catch(cause){
        /* 统一判断"是不是我们自己掐断的超时"，并转成带 code 的错误抛出去：
           外层 catch 拿不到这里的 controller，只能靠 code 前缀正确归类。 */
        const timedOut=cause?.__dshTimeout===true||cause?.name==='AbortError'||cause?.cause?.code==='ABORT_ERR'||controller.signal.aborted===true;
        if(timedOut){
          const error=new Error('DEEPSEEK_GEOMETRY_TIMEOUT');
          Object.assign(error,{code:'PROVIDER_TIMEOUT',provider:'deepseek',retryable:true});
          throw error;
        }
        if(cause?.code&&String(cause.code).startsWith('PROVIDER_'))throw cause;
        const error=new Error(`DEEPSEEK_GEOMETRY_NETWORK_ERROR:${cause?.cause?.code||cause?.code||cause?.name||'UNKNOWN'}`);
        Object.assign(error,{code:'PROVIDER_NETWORK_ERROR',provider:'deepseek',causeCode:cause?.cause?.code||cause?.code||null,retryable:true});
        throw error;
      }
      let result;
      try{
        const payload=await response.json();
        result=parseModelJson(payload.choices?.[0]?.message?.content||'{}');
        if(validateContract){
          const contract=callOptions.responseKind==='repair'?validateGeometryRepairResponse(result):validateGeometryCompileResponse(result,{imageRequired:Boolean(input.imageData),reviewRequired:Boolean(callOptions.requireSemanticReview)});
          if(!contract.pass)throw new Error(`invalid geometry compiler contract:${contract.issues.map(issue=>issue.code).join(',')}`);
        }
        if(callOptions.responseKind!=='repair')result={
          solutionOutline:[],finalAnswer:null,modelingParameters:{},coordinateSystem:{dimension:3,handedness:'right'},
          suggestedConstructions:[],visualFocus:[],highlightEntities:[],annotations:[],constructionDisplayPlan:[],subproblemVisualization:[],visibilitySequence:[],confidence:{},
          ...result
        };
      }catch(cause){
        if(cause?.name==='AbortError'||cause?.cause?.code==='ABORT_ERR'||cause?.cause?.code||cause?.code==='ECONNRESET')throw cause;
        const error=new Error('DEEPSEEK_GEOMETRY_RESPONSE_INVALID');
        Object.assign(error,{code:'PROVIDER_RESPONSE_ERROR',provider:'deepseek',httpStatus:response.status,requestId:response.headers?.get?.('x-request-id')||null,retryable:true});
        throw error;
      }
      return result;
    }finally{clearTimeout(timer)}
  };
  for(let attempt=1;attempt<=maxAttempts;attempt+=1){
    const remainingMs=deadline-Date.now();
    if(remainingMs<=0){
      const error=new Error('DEEPSEEK_GEOMETRY_TIMEOUT');
      Object.assign(error,{code:'PROVIDER_TIMEOUT',provider:'deepseek',retryable:true});
      throw error;
    }
    let result;
    try{
      /* 首次完整生成需要大部分窗口；老版本把预算平均切分，
         会把 30 秒阶段切成必然超时的 10 秒窗口。
         这里给单次尝试保留 3/4 预算，最后一次尝试用满剩余预算。 */
      const attemptsRemaining=maxAttempts-attempt+1;
      const attemptBudgetMs=attemptsRemaining===1
        ? Math.max(500,deadline-Date.now())
        : Math.max(500,Math.floor(Math.max(0,deadline-Date.now())*0.75));
      result=await requestDeepSeekJson(prompt,true,attemptBudgetMs);
    }catch(cause){
      if(cause?.code&&String(cause.code).startsWith('PROVIDER_'))lastError=cause;
      else{
        const error=new Error(`DEEPSEEK_GEOMETRY_NETWORK_ERROR:${cause?.code||cause?.name||'UNKNOWN'}`);
        Object.assign(error,{code:'PROVIDER_NETWORK_ERROR',provider:'deepseek',causeCode:cause?.cause?.code||cause?.code||null,retryable:true});
        lastError=error;
      }
      log('geometry_model_attempt_failed',{attempt,maxAttempts,category:lastError.code,httpStatus:lastError.httpStatus||null,requestId:lastError.requestId||null,retryable:lastError.retryable!==false});
      if(attempt>=maxAttempts||lastError.retryable===false||Date.now()>=deadline)throw lastError;
      if(retryDelayMs>0){
        const delay=Math.min(retryDelayMs*attempt,Math.max(0,deadline-Date.now()));
        if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
      }
      continue;
    }
    log('geometry_model_succeeded',{attempt,model,requestId:null});
      if(callOptions.responseKind==='repair')return result;
      /* 一键生成 3D 的关键补问：模型有时把题目判成"条件不全"，
         返回 candidateCoordinates=null 和空 queries，于是整题直接判死。
         这里用一次明确的追加请求把它逼回具体数值；仍然不行才降级。 */
      if(shouldRepairMissingCoordinates(result)&&Date.now()<deadline){
        log('geometry_coordinates_empty_repairing',{attempt});
        const repairPrompt=`${prompt}

【补问：坐标缺失，必须给出具体数值】
你上一次的输出把 candidateCoordinates 置为 null，queries 为空，因此这道题无法生成 3D 模型。这不是可接受的最终结果。
请重新完整读题，严格按同一份 geometry-compile-response/v1 契约再输出一次，并且必须满足：
1. candidateCoordinates 必须是"点名 → [x,y,z] 三个实数"的非空映射；禁止 null、禁止空对象、禁止字符串或公式。
2. 若题目没有给出真实尺度，仍要按题目给出的所有已知关系给出一个满足这些关系的具体坐标（例如底面放 z=0、关键点放原点、高沿 z 轴），并设置 modelingParameters.identifiability="representative"，不要因为"缺少尺度"而放弃坐标。
3. geometryIR.queries 至少要包含题干真正要求的那个量。
4. 只要输出了 candidateCoordinates，就必须同时给出非空 solutionOutline 和 finalAnswer{displayPlain,latex}。
5. 仍无法确定的量写进 unresolvedItems，但不能用它替代坐标。`;
        try{
          const retry=await requestDeepSeekJson(repairPrompt, true, Math.max(500, deadline - Date.now()));
          if(hasRenderableCoordinates(retry)){
            log('geometry_coordinates_repaired',{attempt});
            return {...retry,provider:'deepseek',model,providerAttempts:attempt,coordinatesRepaired:true};
          }
          log('geometry_coordinates_repair_failed',{attempt});
        }catch(repairError){
          log('geometry_coordinates_repair_failed',{attempt,category:repairError?.code||'REPAIR_REQUEST_FAILED'});
        }
      }
      return {...result,provider:'deepseek',model,providerAttempts:attempt};
  }
  throw lastError;
}

export function createDeepSeekGeometryCompilerAdapter(config = {}) {
  return async context => callDeepSeekGeometry(
    {...config, timeoutMs:Math.min(Number(config.timeoutMs||30000),Number(context.stageBudgetMs||30000))},
    context,
    // 局部修复请求走同一个适配器，但换成"只改相关点"的指令
    context.repairPrompt || geometryCompilerPrompt(context.normalized)
  );
}

export function createDeepSeekGeometrySemanticReviewAdapter(config = {}) {
  return async context => {
    const prompt = `${geometryCompilerPrompt(context.normalized)}

这是风险触发的完整语义重编译。第一次候选可能漏掉题目条件、证据、小问、实体或关系；本轮允许修正 geometryIR 与 sourceCoverage，但所有新增或更改内容必须能回指原题文字或本次图片区域，禁止补造条件。
第一次候选：${JSON.stringify(context.candidate)}
证据门问题：${JSON.stringify(context.gate.issues)}
风险：${JSON.stringify(context.gate.risks)}
当前验证失败：${JSON.stringify(context.validation.failedConstraints)}
请重新输出完整 geometry-compile-response/v1，并额外包含 semanticReviewReport:{status,reviewedIssueCodes,reviewedRiskCodes,retainedFactIds,correctedFields,evidenceDecision}。status 只能是 approved、corrected、rejected；逐项说明保留了哪些原题事实、修正了哪些字段，以及为何没有增加题目不存在的条件。`;
    return callDeepSeekGeometry({...config,timeoutMs:Math.min(Number(config.timeoutMs||30000),Number(context.stageBudgetMs||30000))},context.input,prompt,{requireSemanticReview:true});
  };
}

export function createDeepSeekGeometryReviewAdapter(config = {}) {
  return async context => {
    const prompt = `${geometryCompilerPrompt(context.normalized)}

这是风险触发复核，不是重新随意解题。保留第一次输出中已有证据支持且通过验证的内容，只返回受限 JSON Patch，禁止返回完整候选。
第一次候选：${JSON.stringify(context.candidate)}
证据门问题：${JSON.stringify(context.gate.issues)}
风险：${JSON.stringify(context.gate.risks)}
失败约束：${JSON.stringify(context.validation.failedConstraints)}
逐项残差：${JSON.stringify(context.validation.checks)}
禁止删除题目中真实存在的额外条件，也禁止修改 geometryIR、sourceCoverage 或题目证据。输出严格为：{schemaVersion:"geometry-repair-response/v1",semanticReviewReport:{status,reviewedIssueCodes,reviewedRiskCodes,retainedFactIds,correctedFields,evidenceDecision},patch:[{op,path,value}]}。patch 只允许修改 candidateCoordinates、modelingParameters、coordinateSystem、suggestedConstructions、unresolvedItems、imageAudit 或教学显示字段。status 只能是 approved、corrected、rejected；逐项记录本次实际审查的问题、风险、保留事实和修正字段。`;
    return callDeepSeekGeometry({...config,timeoutMs:Math.min(Number(config.timeoutMs||25000),Number(context.stageBudgetMs||25000))}, context.input, prompt,{responseKind:'repair'});
  };
}
