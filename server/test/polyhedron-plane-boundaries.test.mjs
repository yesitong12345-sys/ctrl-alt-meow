import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePolyhedronGeometryIR} from '../workflows/polyhedron-geometry-engine.mjs';

const cubeWith=query=>({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cube',edge:2},queries:[query]});

test('前三点共线但第四点可确定平面时，按完整点集计算且与排列无关',()=>{
  for(const plane of [['A','M','B','D'],['D','B','M','A'],['M','D','A','B']]){
    const ir=cubeWith({id:'distance',kind:'point_plane_distance',point:'A1',plane});
    ir.queries.unshift({id:'mid',kind:'point_on_segment',segment:['A','B'],parameter:.5,pointId:'M'});
    const result=compilePolyhedronGeometryIR(ir);
    assert.equal(result.status,'verified_unique',result.error);
    assert.equal(result.queryResults.distance.value,2);
  }
});

test('四点不共面时拒绝距离查询，不忽略第四个点返回已验证结果',()=>{
  const result=compilePolyhedronGeometryIR(cubeWith({id:'distance',kind:'point_plane_distance',point:'D1',plane:['A','B','C','A1']}));
  assert.equal(result.status,'validation_failed');
  assert.match(result.error,/PLANE_POINTS_NOT_COPLANAR/);
  assert.equal(result.result,undefined);
});

test('求角、二面角、垂足和硬约束均拒绝非共面四点，失败返回结构化状态',()=>{
  const plane=['A','B','C','A1'];
  for(const query of [
    {id:'angle',kind:'line_plane_angle',line:['A','A1'],plane},
    {id:'dihedral',kind:'dihedral_angle',firstPlane:plane,secondPlane:['A','B','D']},
    {id:'foot',kind:'projection_to_plane',point:'D1',plane,footId:'H'}
  ]){
    const result=compilePolyhedronGeometryIR(cubeWith(query));
    assert.equal(result.status,'validation_failed');assert.equal(result.result,undefined);
    assert.match(result.error,/PLANE_POINTS_NOT_COPLANAR/);
    assert.equal(result.validation.pass,false);
  }
  const ir=cubeWith({id:'distance',kind:'point_plane_distance',point:'A1',plane:['A','B','D']});
  ir.constraints=[{id:'bad-plane',kind:'plane_perpendicular',firstPlane:plane,secondPlane:['A','B','D']}];
  let result;assert.doesNotThrow(()=>result=compilePolyhedronGeometryIR(ir));
  assert.equal(result.status,'validation_failed');assert.match(result.error,/PLANE_POINTS_NOT_COPLANAR/);
  assert.equal(result.validation.pass,false);assert.equal(result.result,undefined);
});

test('重复点、重合坐标及全共线定义不能作为有效平面',()=>{
  for(const plane of [['A','B','D','A'],['A','M','B'],['A','Alias','B','D']]){
    const ir=cubeWith({id:'distance',kind:'point_plane_distance',point:'A1',plane});
    ir.queries.unshift({id:'mid',kind:'point_on_segment',segment:['A','B'],parameter:.5,pointId:'M'},
      {id:'alias',kind:'point_on_segment',segment:['A','B'],parameter:0,pointId:'Alias'});
    const result=compilePolyhedronGeometryIR(ir);
    assert.equal(result.status,'validation_failed',plane.join(','));
    assert.match(result.error,/DUPLICATE_PLANE_POINT|DEGENERATE_PLANE/);
    assert.equal(result.result,undefined);
  }
});

test('合法四点底面贯通求角、距离和垂足，结果与立方体几何一致',()=>{
  const ir=cubeWith({id:'angle',kind:'line_plane_angle',line:['A','A1'],plane:['A','B','C','D']});
  ir.queries.push(
    {id:'dihedral',kind:'dihedral_angle',angleType:'plane_angle',firstPlane:['A','B','C','D'],secondPlane:['A','B','B1','A1']},
    {id:'distance',kind:'point_plane_distance',point:'A1',plane:['A','B','C','D']},
    {id:'foot',kind:'projection_to_plane',point:'C1',plane:['A','B','C','D'],footId:'H'});
  const result=compilePolyhedronGeometryIR(ir);
  assert.equal(result.status,'verified_unique',result.error);
  assert.equal(result.queryResults.angle.degrees,90);
  assert.equal(result.queryResults.dihedral.degrees,90);
  assert.equal(result.queryResults.distance.value,2);
  assert.deepEqual(result.queryResults.foot.coordinates,[2,2,0]);
  assert.equal(result.validation.pass,true);
});
