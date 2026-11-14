import {solveConfirmedGeometry} from './deterministic-geometry-solver.mjs';
import {geometryIRHash, validateGeometryIRV3} from './geometry-ir-v3.mjs';

const byName = (ir, name) => ir.constraints.find(item => item.type === 'quantity' && item.name === name)?.value;
const sameMembers = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && expected.every(item => actual.includes(item));

function pyramidCapability(ir) {
  const body = ir.entities.find(item => item.role === 'solid');
  const query=ir.queries[0];
  if(query?.type!=='line_plane_angle_sine')return {status:'unsupported',failureCode:'V3_QUERY_NOT_SUPPORTED',retryable:false};
  const line=ir.entities.find(item=>item.id===query.line&&item.type==='segment');
  const plane=ir.entities.find(item=>item.id===query.plane&&item.type==='plane');
  const midpoint=ir.constraints.find(item=>item.type==='midpoint'&&item.point==='E'&&sameMembers(item.endpoints,['P','C']));
  const missing=[];
  if(!body||body.type!=='regular_quad_pyramid')missing.push('solid:regular_quad_pyramid');
  if(!line||!sameMembers(line.points,['B','E']))missing.push('segment:BE(B,E)');
  if(!plane||!sameMembers(plane.points,['P','A','C']))missing.push('plane:PAC(P,A,C)');
  if(!midpoint)missing.push('midpoint:E-P-C');
  if(!byName(ir,'baseEdge'))missing.push('quantity:baseEdge');
  if(!byName(ir,'height'))missing.push('quantity:height');
  if(missing.length)return {status:'needs_more_context',missingFacts:missing,retryable:false};
  const consumed=new Set(['parameter-baseEdge','parameter-height',midpoint.id]);
  if(ir.constraints.some(item=>!consumed.has(item.id)))return {status:'unsupported',failureCode:'V3_CONSTRAINT_NOT_SUPPORTED',retryable:false};
  return {status:'supported',request:{
    schemaVersion:'geometry-ir/v1',caseId:ir.problemId,revision:1,lockedTemplate:{templateId:'regular-quad-pyramid-be-pac',version:1},
    problem:{language:'zh-CN',questionText:ir.sourceEvidence[0].content},
    entities:[{id:'body1',type:'body',bodyType:body.type,apex:body.apex,baseVertices:body.baseVertices,lockedByTemplate:true},...['P','A','B','C','D','E'].map(id=>({id,type:'point'})),{id:line.id,type:'segment',points:line.points,lockedByTemplate:true},{id:plane.id,type:'plane',points:plane.points,lockedByTemplate:true}],
    relations:[{id:'r-base',type:'base_edge',args:{body:'body1',value:byName(ir,'baseEdge')},confirmationStatus:'confirmed',valueOrigin:'geometry-ir/v3',evidenceRegion:null},{id:'r-height',type:'height',args:{body:'body1',value:byName(ir,'height')},confirmationStatus:'confirmed',valueOrigin:'geometry-ir/v3',evidenceRegion:null},{id:'r-mid',type:'midpoint',args:{point:'E',endpoints:['P','C'],resultRole:'midpointPC'},confirmationStatus:'confirmed',valueOrigin:'geometry-ir/v3',lockedByTemplate:true,evidenceRegion:null}],
    query:{type:'line_plane_angle_sin',line:line.id,plane:plane.id,lockedByTemplate:true},
    adapterSource:{schemaVersion:ir.schemaVersion,solidId:body.id}
  }};
}

function circularCapability(ir) {
  const body=ir.entities.find(item=>item.role==='solid');
  if(!body)return {status:'needs_more_context',missingFacts:['solid:circular-body'],retryable:false};
  const query=ir.queries[0],allowed={right_cylinder:['volume_and_surface_area','axis_section','parallel_base_section'],right_cone:['volume_and_surface_area','axis_section'],sphere:['volume_and_surface_area','section_circle']};
  if(!allowed[body.type]?.includes(query?.type))return {status:'unsupported',failureCode:'V3_QUERY_NOT_SUPPORTED',retryable:false};
  const required=['radius',...(['right_cylinder','right_cone'].includes(body.type)?['height']:[]),...(body.type==='sphere'&&query.type==='section_circle'?['planeDistance']:[])];
  const missing=required.filter(name=>!byName(ir,name)).map(name=>`quantity:${name}`);
  if(missing.length)return {status:'needs_more_context',missingFacts:missing,retryable:false};
  const allowedQuantities=new Set(required);
  // 图像理解会带回截面、垂线、相切等上下文。它们能用于讲解和辅助线，
  // 但不应因为暂未参与当前公式而拒绝一个已经可唯一验证的圆体模型。
  const contextualFacts=new Set(['perpendicular','parallel','coplanar','point_on_plane','tangent','construction','section_plane']);
  const unsupported=ir.constraints.filter(item=>item.type==='quantity'?!allowedQuantities.has(item.name):!contextualFacts.has(item.type));
  if(unsupported.length)return {status:'unsupported',failureCode:'V3_CONSTRAINT_NOT_SUPPORTED',unsupportedFacts:unsupported.map(item=>item.id),retryable:false};
  const context=ir.constraints.filter(item=>item.type!=='quantity').map(item=>({id:item.id,type:item.type,subjects:item.subjects||[]}));
  return {status:'supported',request:{schemaVersion:'geometry-ir/v2',problem:{language:'zh-CN',questionText:ir.sourceEvidence[0].content},body:{type:body.type,axis:body.axis||'z'},parameters:Object.fromEntries(ir.constraints.filter(item=>item.type==='quantity'&&allowedQuantities.has(item.name)).map(item=>[item.name,item.value])),query:{type:query.type},adapterSource:{schemaVersion:ir.schemaVersion,solidId:body.id,context}}};
}

function projectionDihedralTetrahedronCapability(ir) {
  const body=ir.entities.find(item=>item.role==='solid');
  if(body?.type!=='triangular_pyramid'||body.apex!=='A'||!sameMembers(body.baseVertices,['B','C','D']))return {status:'unsupported',failureCode:'V3_TETRAHEDRON_TOPOLOGY_NOT_SUPPORTED',retryable:false};
  const required=['projection-A-O-BCD','perpendicular-BO-CD','perpendicular-AD-BC','angle-BCD','dihedral-A-BC-D','dihedral-A-CD-B','length-BC'];
  const missing=required.filter(id=>!ir.constraints.some(item=>item.id===id));
  if(missing.length)return {status:'needs_more_context',missingFacts:missing,retryable:false};
  if(ir.constraints.length!==required.length)return {status:'unsupported',failureCode:'V3_TETRAHEDRON_EXTRA_CONSTRAINT_NOT_SUPPORTED',retryable:false};
  return {status:'supported',request:{
    schemaVersion:'geometry-ir/v1', caseId:ir.problemId, revision:1,
    lockedTemplate:{templateId:'triangular-pyramid-projection-dihedral',version:1},
    problem:{language:'zh-CN',questionText:ir.sourceEvidence[0].content},
    parameters:{BC:byName(ir,'BC')}
  }};
}

export async function solveGeometryIRV3(ir, options={}) {
  const validation=validateGeometryIRV3(ir);
  if(!validation.valid)return {status:'schema_invalid',errors:validation.errors,retryable:false};
  if(ir.stage!=='normalized')return {status:'schema_invalid',errors:[{path:'stage',code:'SOLVER_REQUIRES_NORMALIZED'}],retryable:false};
  const body=ir.entities.find(item=>item.role==='solid');
  const capability=body?.type==='regular_quad_pyramid'?pyramidCapability(ir):body?.type==='triangular_pyramid'?projectionDihedralTetrahedronCapability(ir):['right_cylinder','right_cone','sphere'].includes(body?.type)?circularCapability(ir):null;
  if(!capability)return {status:'unsupported',failureCode:'V3_CAPABILITY_NOT_REGISTERED',retryable:false};
  if(capability.status!=='supported')return capability;
  const result=await solveConfirmedGeometry(capability.request,options);
  if(result.solverStatus!=='verified')return {status:result.solverStatus,result,retryable:Boolean(result.retryable)};
  const verified={...structuredClone(ir),stage:'verified',solutionSet:{kind:'finite',queryIdentifiability:'unique',sceneIdentifiability:'unique',selectedEmbedding:result.canonicalCoordinates},derivations:[{id:'derivation-1',factKind:'derivedFact',queryRef:ir.queries[0].id,solverAdapter:result.adapterVersion,certificate:{answer:result.answer,verification:result.verification}}],verification:{status:'verified',sourceGrounding:'confirmed-input-facts',mathVerification:'independent-kernel',solverAdapter:result.adapterVersion},scene:result.scene};
  verified.sceneHash=geometryIRHash({problemIR:verified,scene:result.scene,solverAdapter:result.adapterVersion});
  return {status:'verified',problemIR:verified,result};
}
