import {createHash,randomUUID} from 'node:crypto';
import {adaptGeometryIRV3} from './geometry-ir-v3.mjs';
import {compilePolyhedronGeometryIR} from './polyhedron-geometry-engine.mjs';

const clone=value=>structuredClone(value);
const slug=value=>String(value||'item').replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'item';

export function exactExpressionToNumber(value){
  if(Number.isFinite(value))return Number(value);
  if(!value||typeof value!=='object')return NaN;
  if(value.op==='integer')return Number(value.value);
  if(value.op==='rational')return Number(value.p)/Number(value.q);
  if(value.op==='sqrt')return Math.sqrt(exactExpressionToNumber(value.arg));
  if(value.op==='neg')return-exactExpressionToNumber(value.arg);
  if(value.op==='add')return(value.args||[]).reduce((sum,item)=>sum+exactExpressionToNumber(item),0);
  if(value.op==='mul')return(value.args||[]).reduce((product,item)=>product*exactExpressionToNumber(item),1);
  return NaN;
}

function sourceText(source,options){
  return String(options?.questionText||source?.problem?.questionText||source?.draft?.question||source?.questionText||'旧版几何题记录').trim();
}

function evidenceFromLegacy(source,options){
  const original=Array.isArray(source.sourceEvidence)?source.sourceEvidence:[];
  if(original.length)return original.map((item,index)=>({
    id:item.id||`legacy-evidence-${index+1}`,
    kind:item.kind==='image'?'image':'text',
    ...(item.kind==='image'?{imageHash:item.imageHash,region:item.region,confidence:item.confidence}:{quote:String(item.quote||item.content||sourceText(source,options))}),
    ...(item.kind==='image'&&item.quote?{quote:item.quote}:{})
  }));
  return[{id:'legacy-source',kind:'text',quote:sourceText(source,options)}];
}

const BODY_KIND={body:'pyramid',regular_quad_pyramid:'pyramid',parallelepiped:'prism',polyhedron:'prism'};
const QUERY_KIND={line_plane_angle_sin:'line_plane_angle',line_plane_angle_sine:'line_plane_angle'};
const kindOf=value=>BODY_KIND[value]||QUERY_KIND[value]||value;

function addMissingPointEntities(entities,refs){
  const ids=new Set(entities.map(item=>item.id));
  for(const id of refs.filter(item=>typeof item==='string'&&/^[A-Z][A-Z0-9_]*$/.test(item))){
    if(!ids.has(id)){entities.push({id,kind:'point'});ids.add(id);}
  }
}

function collectRefs(value,key=''){
  if(typeof value==='string')return /^(?:id|point|center|apex|foot|touch|sphereCenter)$/i.test(key)||/(?:points|vertices|endpoints|line|plane|rays|vectors|subjects)/i.test(key)?[value]:[];
  if(!value||typeof value!=='object')return[];
  if(Array.isArray(value))return value.flatMap(item=>collectRefs(item,key));
  return Object.entries(value).flatMap(([childKey,child])=>collectRefs(child,childKey));
}

function factAndConstraint(item,index,evidenceIds){
  const id=item.id||`legacy-constraint-${index+1}`;
  const exactValue=item.value;
  const numeric=exactExpressionToNumber(exactValue);
  let kind=kindOf(item.kind||item.type);
  const subjects=item.points||item.subjects||[];
  if(kind==='quantity')kind=item.dimension==='length'&&subjects.length===2?'distance':'positive';
  const factId=`fact-${slug(id)}`;
  const fact={id:factId,kind:'quantity',name:item.name||id,value:Number.isFinite(numeric)?numeric:item.value,evidenceRefs:(item.evidenceRefs||evidenceIds).filter(Boolean),legacyExactValue:exactValue&&typeof exactValue==='object'?clone(exactValue):undefined};
  const constraint={...clone(item),id,kind,hard:item.hard!==false,factRefs:[factId]};
  delete constraint.type;delete constraint.factKind;delete constraint.status;delete constraint.confidence;delete constraint.evidenceRefs;delete constraint.normalizationRule;
  if(Number.isFinite(numeric))constraint.value=numeric;
  return{fact,constraint};
}

function fromV3(source,options={}){
  const evidence=evidenceFromLegacy(source,options),evidenceIds=evidence.map(item=>item.id);
  const entities=(source.entities||[]).map(item=>{
    const entity={...clone(item),kind:kindOf(item.bodyType||item.kind||item.type)};
    delete entity.type;delete entity.bodyType;delete entity.factKind;delete entity.status;delete entity.confidence;delete entity.evidenceRefs;delete entity.normalizationRule;
    return entity;
  });
  const explicitFacts=[],constraints=[];
  (source.constraints||[]).forEach((item,index)=>{const converted=factAndConstraint(item,index,evidenceIds);explicitFacts.push(converted.fact);constraints.push(converted.constraint);});
  addMissingPointEntities(entities,collectRefs({entities,constraints,queries:source.queries}));
  const queries=(source.queries||[]).map((item,index)=>{const query={...clone(item),id:item.id||`query-${index+1}`,kind:kindOf(item.kind||item.type)};delete query.type;return query;});
  return{
    schemaVersion:'geometry-ir/v4',problemId:source.problemId||source.caseId||randomUUID(),
    entities,explicitFacts,derivedFacts:clone(source.derivations||[]),constraints,queries,evidence,
    coordinateSystem:{dimension:3,handedness:'right',zUp:true,...clone(source.coordinateSystem||{})},
    compatibility:{sourceSchemaVersion:source.schemaVersion,adapterVersion:2,lossless:false,legacyPayload:clone(source)}
  };
}

function v1ToV3(source){
  if(source.entities&&source.relations){
    const evidence=[{id:'legacy-source',kind:'text',content:sourceText(source)}];
    const entities=source.entities.map(item=>({
      ...clone(item),type:item.type==='body'?(item.bodyType||'pyramid'):item.type,
      factKind:'assertedFact',status:'confirmed',confidence:1,evidenceRefs:['legacy-source'],normalizationRule:'geometry-ir-v4-compat'
    }));
    const constraints=(source.relations||[]).map(item=>{
      const args=clone(item.args||{}),type=item.type==='base_edge'||item.type==='height'?'quantity':item.type;
      const subjects=item.type==='midpoint'?[args.point,...(args.endpoints||[])]:args.body?[args.body]:[];
      return{id:item.id,type,subjects,name:item.type==='base_edge'?'baseEdge':item.type,value:args.value,point:args.point,endpoints:args.endpoints,dimension:item.type==='base_edge'||item.type==='height'?'length':undefined,factKind:'assertedFact',status:'confirmed',confidence:1,evidenceRefs:['legacy-source'],normalizationRule:'geometry-ir-v4-compat'};
    });
    const query=source.query||{},queries=[{...clone(query),id:query.id||'query-1',type:query.type,line:query.line,plane:query.plane,subjects:[query.line,query.plane].filter(Boolean)}];
    return{schemaVersion:'geometry-ir/v3.0',problemId:source.caseId||randomUUID(),stage:'normalized',coordinateSystem:{dimension:3,handedness:'right',lengthUnit:'unit'},sourceEvidence:evidence,entities,constraints,queries,derivations:[],verification:{status:'pending'}};
  }
  return adaptGeometryIRV3(source);
}

function fromPolyhedron(source,options={}){
  const compiled=compilePolyhedronGeometryIR(source);
  const solid=compiled.solid;
  const evidence=evidenceFromLegacy(source,options),evidenceIds=evidence.map(item=>item.id);
  const coordinates=solid?.coordinates||options.coordinates||{};
  const faces=solid?.faces||source.solid?.faces||[];
  const entities=Object.keys(coordinates).map(id=>({id,kind:'point'}));
  const solidId='solid-1',solidKind=kindOf(source.solid?.kind||solid?.kind||'prism');
  entities.push({id:solidId,kind:solidKind,faces:clone(faces),legacySolidKind:source.solid?.kind});
  const explicitFacts=[],constraints=[];
  const sourceConstraints=[...(source.constraints||[]),{id:'solid-topology',kind:'polyhedron',entity:solidId,hard:true}];
  sourceConstraints.forEach((item,index)=>{const converted=factAndConstraint(item,index,evidenceIds);explicitFacts.push(converted.fact);constraints.push(converted.constraint);});
  const queries=(source.queries||[]).map((item,index)=>({id:item.id||`query-${index+1}`,...clone(item),kind:kindOf(item.kind||item.type)}));
  addMissingPointEntities(entities,collectRefs({constraints,queries}));
  return{
    schemaVersion:'geometry-ir/v4',problemId:source.problemId||randomUUID(),entities,explicitFacts,derivedFacts:[],constraints,queries,evidence,
    coordinateSystem:{dimension:3,handedness:'right',zUp:true,canonical:true},candidateCoordinates:clone(coordinates),
    compatibility:{sourceSchemaVersion:source.schemaVersion,adapterVersion:2,lossless:false,legacyPayload:clone(source),legacyCompileStatus:compiled.status}
  };
}

function fromGeometryProblem(source,options={}){
  const evidence=evidenceFromLegacy(source,options),evidenceIds=evidence.map(item=>item.id),entities=[],explicitFacts=[],constraints=[];
  const body=String(source.topology?.body||''),[apexPart,basePart]=body.split('-'),apex=(apexPart?.match(/[A-Z]\d*/i)||[])[0]?.toUpperCase(),baseVertices=(basePart?.match(/[A-Z]\d*/gi)||[]).map(item=>item.toUpperCase());
  const pointNames=new Set([apex,...baseVertices].filter(Boolean));
  const midpoint=source.topology?.midpoint;
  if(midpoint?.point)pointNames.add(String(midpoint.point).toUpperCase());
  const segmentPoints=value=>(String(value||'').toUpperCase().match(/[A-Z]\d*/g)||[]);
  for(const id of [...segmentPoints(source.query?.line),...segmentPoints(source.query?.line1),...segmentPoints(source.query?.line2),...segmentPoints(source.query?.plane)])pointNames.add(id);
  for(const id of pointNames)entities.push({id,kind:'point'});
  if(apex&&baseVertices.length>=3)entities.push({id:'solid-1',kind:'pyramid',baseVertices,apex});
  const append=item=>{const converted=factAndConstraint(item,constraints.length,evidenceIds);explicitFacts.push(converted.fact);constraints.push(converted.constraint);};
  for(const[name,value]of Object.entries(source.parameters||{}))append({id:`parameter-${name}`,kind:'positive',name,value,hard:true});
  if(apex&&baseVertices.length>=3)append({id:'solid-topology',kind:'polyhedron',entity:'solid-1',hard:true});
  if(midpoint?.point){const endpoints=segmentPoints(midpoint.segment);append({id:`midpoint-${midpoint.point}`,kind:'midpoint',point:String(midpoint.point).toUpperCase(),endpoints,points:[String(midpoint.point).toUpperCase(),...endpoints],hard:true});}
  const originalQuery=source.query||{},query={...clone(originalQuery),id:originalQuery.id||'query-1',kind:kindOf(originalQuery.type)};
  delete query.type;
  if(originalQuery.line)query.line=segmentPoints(originalQuery.line);
  if(originalQuery.plane)query.plane=segmentPoints(originalQuery.plane);
  if(originalQuery.line1)query.first=segmentPoints(originalQuery.line1);
  if(originalQuery.line2)query.second=segmentPoints(originalQuery.line2);
  return{schemaVersion:'geometry-ir/v4',problemId:source.problemId||randomUUID(),entities,explicitFacts,derivedFacts:[],constraints,queries:[query],evidence,coordinateSystem:{dimension:3,handedness:'right',zUp:true},compatibility:{sourceSchemaVersion:source.schemaVersion,adapterVersion:2,lossless:false,legacyPayload:clone(source)}};
}

export function canonicalizeGeometryIR(source,options={}){
  if(!source||typeof source!=='object')throw new TypeError('geometry IR source is required');
  if(source.schemaVersion==='geometry-ir/v4')return{...clone(source),compatibility:{sourceSchemaVersion:'geometry-ir/v4',adapterVersion:2,lossless:true,...clone(source.compatibility||{})}};
  if(source.schemaVersion==='geometry-ir/polyhedron-v1')return fromPolyhedron(source,options);
  if(source.schemaVersion==='geometry-problem/v1')return fromGeometryProblem(source,options);
  if(source.schemaVersion==='geometry-ir/v1'){
    const result=fromV3(v1ToV3(source),options);
    result.compatibility.sourceSchemaVersion='geometry-ir/v1';
    result.compatibility.legacyPayload=clone(source);
    return result;
  }
  if(source.schemaVersion==='geometry-ir/v2'){
    const result=fromV3(adaptGeometryIRV3(source),options);
    result.compatibility.sourceSchemaVersion='geometry-ir/v2';
    result.compatibility.legacyPayload=clone(source);
    return result;
  }
  if(source.schemaVersion==='geometry-ir/v3.0')return fromV3(source,options);
  throw new RangeError(`unsupported geometry IR: ${source.schemaVersion||'missing'}`);
}

export function attachCanonicalGeometryIR(record){
  if(!record||typeof record!=='object')return record;
  const source=record.geometryIR?.schemaVersion?record.geometryIR:record.problemSpec?.schemaVersion?record.problemSpec:record.problemIR?.schemaVersion?record.problemIR:null;
  if(!source)return record;
  try{
    return{...record,geometryIR:canonicalizeGeometryIR(source,{questionText:record.question||record.questionText||record.draft?.question}),geometrySchemaVersion:'geometry-ir/v4',geometryMigration:{status:'succeeded',sourceSchemaVersion:source.schemaVersion,targetSchemaVersion:'geometry-ir/v4'}};
  }catch(error){
    return{...record,geometryMigration:{status:'failed',sourceSchemaVersion:source.schemaVersion||'missing',targetSchemaVersion:'geometry-ir/v4',errorCode:error instanceof RangeError?'UNSUPPORTED_LEGACY_SCHEMA':'LEGACY_IR_INVALID'}};
  }
}

export function canonicalGeometryIRHash(ir){
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return createHash('sha256').update(JSON.stringify(canonical(ir))).digest('hex');
}
