import {adaptGeometryIRV3} from './geometry-ir-v3.mjs';
import {solveGeometryIRV3} from './geometry-v3-solver.mjs';

const integer = value => ({op: 'integer', value});
export const isCleanExactGeometryAnswer = value => {
  if(Array.isArray(value))return value.length>0&&value.every(isCleanExactGeometryAnswer);
  if(!value||typeof value!=='object')return false;
  if(value.op==='integer')return Number.isSafeInteger(value.value);
  if(value.op==='rational')return Number.isSafeInteger(value.p)&&Number.isSafeInteger(value.q)&&value.q>0;
  if(['sqrt','neg'].includes(value.op))return isCleanExactGeometryAnswer(value.arg);
  if(['add','mul'].includes(value.op))return Array.isArray(value.args)&&value.args.length>0&&value.args.every(isCleanExactGeometryAnswer);
  return false;
};

function pyramid(seed) {
  const a = [2, 4, 6, 8][seed % 4];
  const h = [1, 2, 3][seed % 3];
  const question = `正四棱锥 P-ABCD 的底面边长为 ${a}，高为 ${h}，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。`;
  return {modelKind: 'pyramid', question, source: {
    schemaVersion: 'geometry-ir/v1', caseId: `random-pyramid-${seed}`, revision: 1,
    lockedTemplate: {templateId: 'regular-quad-pyramid-be-pac', version: 1}, problem: {language: 'zh-CN', questionText: question},
    parameters: {baseEdge: integer(a), height: integer(h)},
    entities: [{id: 'body1', type: 'body', bodyType: 'regular_quad_pyramid', apex: 'P', baseVertices: ['A', 'B', 'C', 'D'], lockedByTemplate: true}, ...['P','A','B','C','D','E'].map(id => ({id, type:'point'})), {id:'BE',type:'segment',points:['B','E'],lockedByTemplate:true},{id:'PAC',type:'plane',points:['P','A','C'],lockedByTemplate:true}],
    relations: [{id:'r-base',type:'base_edge',args:{body:'body1',value:integer(a)},confirmationStatus:'confirmed',valueOrigin:'random_registry',evidenceRegion:null},{id:'r-height',type:'height',args:{body:'body1',value:integer(h)},confirmationStatus:'confirmed',valueOrigin:'random_registry',evidenceRegion:null},{id:'r-mid',type:'midpoint',args:{point:'E',endpoints:['P','C'],resultRole:'midpointPC'},confirmationStatus:'confirmed',valueOrigin:'fixture',lockedByTemplate:true,evidenceRegion:null}],
    query:{type:'line_plane_angle_sin',line:'BE',plane:'PAC',lockedByTemplate:true}
  }};
}

function circular(modelKind, variant=0) {
  const cylinderPairs=[[3,5],[2,4],[4,3]],conePairs=[[3,4],[5,12],[6,8]],spherePairs=[[5,3],[10,6],[13,5]];
  const [r,h]=modelKind==='cylinder'?cylinderPairs[variant%cylinderPairs.length]:modelKind==='cone'?conePairs[variant%conePairs.length]:spherePairs[variant%spherePairs.length];
  const specs = {
    cylinder: {body:'right_cylinder', parameters:{radius:integer(r),height:integer(h)}, query:'volume_and_surface_area', question:`圆柱的底面半径为 ${r}，高为 ${h}，求体积和表面积。`},
    cone: {body:'right_cone', parameters:{radius:integer(r),height:integer(h)}, query:'volume_and_surface_area', question:`圆锥的底面半径为 ${r}，高为 ${h}，求母线、体积和表面积。`},
    sphere: {body:'sphere', parameters:{radius:integer(r),planeDistance:integer(h)}, query:'section_circle', question:`半径为 ${r} 的球，球心到截平面的距离为 ${h}，求截面圆半径和面积。`}
  };
  const spec = specs[modelKind];
  return {modelKind, question:spec.question, source:{schemaVersion:'geometry-ir/v2',problem:{language:'zh-CN',questionText:spec.question},body:{type:spec.body,axis:'z'},parameters:spec.parameters,query:{type:spec.query}}};
}

export async function generateVerifiedRandomGeometry(seed, options = {}) {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('INVALID_RANDOM_SEED');
  const kind = ['pyramid','cylinder','cone','sphere'][seed % 4];
  const acceptAnswer=typeof options.acceptAnswer==='function'?options.acceptAnswer:isCleanExactGeometryAnswer;
  const solverOptions={...options};delete solverOptions.acceptAnswer;
  let last=null;
  for(let attempt=0;attempt<30;attempt+=1){
    const candidate=kind==='pyramid'?pyramid((seed+attempt)>>>0):circular(kind,seed+attempt);
    const solved=await solveGeometryIRV3(adaptGeometryIRV3(candidate.source),solverOptions);last=solved;
    const exactFacts=solved.status==='verified'?(solved.result.answer.exact||solved.problemIR.constraints.filter(item=>item.type==='quantity').map(item=>item.value)):null;
    const clean=solved.status==='verified'&&acceptAnswer(exactFacts,{attempt,candidate,solved})&&solved.result.scene?.elements?.length>0;
    if(clean)return {status:'verified',modelKind:kind,question:candidate.question,problemIR:solved.problemIR,result:solved.result,randomization:{seed,attempts:attempt+1,rejectedCount:attempt,clean:true}};
  }
  return {status:last?.status||'solver_failed',modelKind:kind,result:last?.result,randomization:{seed,attempts:30,rejectedCount:30,clean:false}};
}
