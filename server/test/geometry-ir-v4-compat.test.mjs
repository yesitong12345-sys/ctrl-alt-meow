import test from 'node:test';
import assert from 'node:assert/strict';
import {attachCanonicalGeometryIR,canonicalizeGeometryIR} from '../workflows/geometry-ir-v4-compat.mjs';

const integer=value=>({op:'integer',value});

test('v1、v2、v3 与 polyhedron-v1 都统一为不丢查询和硬条件的 geometry-ir/v4',()=>{
  const fixtures=[
    {
      schemaVersion:'geometry-ir/v1',problem:{questionText:'正四棱锥 P-ABCD，底边2，高1，E为PC中点，求BE与平面PAC所成角。'},
      entities:[{id:'body1',type:'body',bodyType:'regular_quad_pyramid',apex:'P',baseVertices:['A','B','C','D']},...['P','A','B','C','D','E'].map(id=>({id,type:'point'})),{id:'BE',type:'segment',points:['B','E']},{id:'PAC',type:'plane',points:['P','A','C']}],
      relations:[{id:'r-base',type:'base_edge',args:{body:'body1',value:integer(2)},confirmationStatus:'confirmed'},{id:'r-height',type:'height',args:{body:'body1',value:integer(1)},confirmationStatus:'confirmed'},{id:'r-mid',type:'midpoint',args:{point:'E',endpoints:['P','C']},confirmationStatus:'confirmed'}],
      query:{type:'line_plane_angle_sin',line:'BE',plane:'PAC'}
    },
    {schemaVersion:'geometry-ir/v2',problem:{questionText:'圆柱半径3，高5，求体积。'},body:{type:'right_cylinder',axis:'z'},parameters:{radius:integer(3),height:integer(5)},query:{type:'volume_and_surface_area'}},
    {schemaVersion:'geometry-ir/v3.0',problemId:'p3',stage:'normalized',coordinateSystem:{dimension:3,handedness:'right',lengthUnit:'unit'},sourceEvidence:[{id:'ev',kind:'text',content:'AB=4'}],entities:[{id:'A',type:'point',factKind:'assertedFact',status:'confirmed',evidenceRefs:['ev'],normalizationRule:'fixture'},{id:'B',type:'point',factKind:'assertedFact',status:'confirmed',evidenceRefs:['ev'],normalizationRule:'fixture'}],constraints:[{id:'ab',type:'quantity',subjects:['A','B'],name:'AB',value:integer(4),dimension:'length',factKind:'assertedFact',status:'confirmed',evidenceRefs:['ev'],normalizationRule:'fixture'}],queries:[{id:'q',type:'length',subjects:['A','B']}],derivations:[],verification:{status:'pending'}},
    {schemaVersion:'geometry-ir/polyhedron-v1',questionText:'正方体棱长2，求截面。',solid:{kind:'cube',edge:2},constraints:[{id:'edge',kind:'length',points:['A','B'],value:2,hard:true}],queries:[{id:'section',kind:'polyhedron_section',plane:{normal:[0,0,1],offset:1}}]},
    {schemaVersion:'geometry-problem/v1',templateId:'regular-quad-pyramid-be-pac',parameters:{baseEdge:integer(2),height:integer(1)},topology:{body:'P-ABCD',midpoint:{point:'E',segment:'PC'}},query:{type:'line_plane_angle_sin',line:'BE',plane:'PAC'}}
  ];
  for(const source of fixtures){
    const ir=canonicalizeGeometryIR(source);
    assert.equal(ir.schemaVersion,'geometry-ir/v4');
    assert.equal(ir.compatibility.sourceSchemaVersion,source.schemaVersion);
    assert.ok(ir.queries.length>=1,source.schemaVersion);
    assert.ok(ir.constraints.length>=1,source.schemaVersion);
    assert.ok(ir.constraints.filter(item=>item.hard!==false).every(item=>Array.isArray(item.factRefs)&&item.factRefs.length),source.schemaVersion);
    const ids=new Set([...ir.entities,...ir.explicitFacts,...ir.derivedFacts,...ir.constraints,...ir.queries,...ir.evidence].map(item=>item.id));
    assert.ok(ir.constraints.flatMap(item=>item.factRefs||[]).every(id=>ids.has(id)),source.schemaVersion);
  }
});

test('旧记录读取后统一暴露 v4，同时保留旧求解器所需 problemSpec',()=>{
  const problemSpec={schemaVersion:'geometry-ir/v2',problem:{questionText:'圆柱半径3，高5，求体积。'},body:{type:'right_cylinder',axis:'z'},parameters:{radius:integer(3),height:integer(5)},query:{type:'volume_and_surface_area'}};
  const record=attachCanonicalGeometryIR({id:'case-1',question:'圆柱半径3，高5，求体积。',problemSpec});
  assert.equal(record.geometryIR.schemaVersion,'geometry-ir/v4');
  assert.equal(record.geometrySchemaVersion,'geometry-ir/v4');
  assert.deepEqual(record.problemSpec,problemSpec);
  assert.notEqual(record.geometryIR,record.problemSpec);
});

test('旧版转换不得谎报无损，并完整保留原始载荷供审计',()=>{
  const source={schemaVersion:'geometry-problem/v1',templateId:'legacy-extra',parameters:{edge:{op:'sqrt',arg:{op:'integer',value:2}}},topology:{body:'P-ABCD',customRelation:{kind:'legacy-only'}},query:{type:'volume',solid:'P-ABCD'}};
  const ir=canonicalizeGeometryIR(source,{questionText:'求棱锥体积'});
  assert.equal(ir.compatibility.lossless,false);
  assert.deepEqual(ir.compatibility.legacyPayload,source);
  assert.equal(ir.queries[0].kind,'volume');
  assert.equal(ir.queries[0].solid,'P-ABCD');
});

test('损坏旧 IR 迁移必须显式标记失败，不能静默伪装成功',()=>{
  const record=attachCanonicalGeometryIR({id:'broken',problemSpec:{schemaVersion:'geometry-ir/unknown'}});
  assert.equal(record.geometryMigration.status,'failed');
  assert.equal(record.geometryIR,undefined);
});
