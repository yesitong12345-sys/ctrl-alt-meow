import test from 'node:test';
import assert from 'node:assert/strict';
import {dihedralAngle,compilePolyhedronGeometryIR} from '../workflows/polyhedron-geometry-engine.mjs';
import {validateGeometryCandidate} from '../workflows/geometry-trusted-pipeline.mjs';
import {dihedralTetrahedronIR} from './fixtures/dihedral-tetrahedron.mjs';
import contract from '../../implementation/step-visual-contract.js';
const coordinates={O:[0,0,0],Z:[0,0,2],A:[1,0,0],B:[-.5,Math.sqrt(3)/2,0]};
const first=['O','Z','A'].map(id=>coordinates[id]),second=['O','Z','B'].map(id=>coordinates[id]);
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const cubeQuery=selection=>({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cube',edge:2},queries:[{
  id:'angle',kind:'dihedral_angle',firstPlane:['A','B','C'],secondPlane:['A','B','D1'],...selection
}]});

test('指定棱与半平面后保留120度钝角，不取法向量点积绝对值',()=>{
  close(dihedralAngle(first,second,{edge:[coordinates.O,coordinates.Z],firstSide:coordinates.A,secondSide:coordinates.B})*180/Math.PI,120);
});

test('棱和侧点须在对应平面内，退化棱或侧点在棱上均拒绝',()=>{
  const valid={edge:[coordinates.O,coordinates.Z],firstSide:coordinates.A,secondSide:coordinates.B};
  for(const invalid of [
    {...valid,edge:[[1,1,0],[1,1,2]]},
    {...valid,firstSide:[1,1,0]},
    {...valid,secondSide:[1,0,0]},
    {...valid,firstSide:coordinates.O},
    {...valid,edge:[coordinates.O,coordinates.O]},
    {...valid,angleType:'unknown'},
    {...valid,angleType:'plane_angle'}
  ])assert.throws(()=>dihedralAngle(first,second,invalid));
});

test('编译查询必须指定半平面或明确声明较小夹角，缺少信息不猜数值',()=>{
  const missing=compilePolyhedronGeometryIR(cubeQuery({}));
  assert.equal(missing.status,'validation_failed');assert.match(missing.error,/DIHEDRAL_HALF_PLANES_REQUIRED/);
  assert.equal(missing.result,undefined);
  assert.equal(contract.resolveVisual({mode:'highlight',entityIds:['face-1']},contract.catalogFor({geometryResult:missing.result})).mode,'text_only');
  const explicit=compilePolyhedronGeometryIR(cubeQuery({angleType:'plane_angle'}));
  assert.equal(explicit.status,'verified_unique',explicit.error);close(explicit.queryResults.angle.degrees,45);
});

test('AI候选硬约束验证120度，并拒绝把它写成60度或省略半平面',()=>{
  const candidate=selection=>({candidateCoordinates:coordinates,geometryIR:{schemaVersion:'geometry-ir/v4',
    entities:Object.keys(coordinates).map(id=>({id,kind:'point'})),constraints:[{id:'dihedral',kind:'dihedral_angle',
      firstPlane:['O','Z','A'],secondPlane:['O','Z','B'],hard:true,degrees:120,...selection}],queries:[]}});
  const selection={edge:['O','Z'],firstSide:'A',secondSide:'B'};
  const valid=validateGeometryCandidate(candidate(selection));
  assert.equal(valid.checks.find(c=>c.constraintId==='dihedral').pass,true);
  for(const fields of [{...selection,degrees:60},{}, {...selection,secondSide:'A'}]){
    const result=validateGeometryCandidate(candidate(fields));
    assert.equal(result.checks.find(c=>c.constraintId==='dihedral').pass,false);
  }
});

test('交换棱方向、平面点序与平移侧点不改变0到180度范围的指定二面角',()=>{
  for(const degrees of [0,30,60,90,120,150,180]){
    const rad=degrees*Math.PI/180,side=[Math.cos(rad),Math.sin(rad),0],other=[coordinates.O,coordinates.Z,side];
    for(const edge of [[coordinates.O,coordinates.Z],[coordinates.Z,coordinates.O]]){
      close(dihedralAngle([...first].reverse(),[...other].reverse(),{edge,firstSide:[3,0,7],secondSide:[2*side[0],2*side[1],-4]})*180/Math.PI,degrees);
    }
  }
});

test('完整四面体编译保留有符号余弦，模型实体和题目绑定可用于本地提示',()=>{
  const result=compilePolyhedronGeometryIR(dihedralTetrahedronIR());
  assert.equal(result.status,'verified_unique',result.error);
  close(result.queryResults.angle.degrees,120);close(result.queryResults.angle.cosine,-.5);
  assert.equal(result.queryResults.angle.angleType,'dihedral');
  assert.ok(result.result.scene.elements.some(e=>e.id==='face-1'));
  assert.ok(result.result.scene.elements.some(e=>e.id==='face-2'));
});

test('AI二面角平面引用包含第四点时不能截断验证',()=>{
  const candidate={candidateCoordinates:{...coordinates,X:[0,1,0]},geometryIR:{entities:[],constraints:[{
    id:'bad-fourth',kind:'dihedral_angle',firstPlane:['O','Z','A','X'],secondPlane:['O','Z','B'],
    edge:['O','Z'],firstSide:'A',secondSide:'B',degrees:120,hard:true
  }]}};
  const result=validateGeometryCandidate(candidate);
  assert.equal(result.pass,false);assert.equal(result.checks[0].code,'PLANE_POINTS_NOT_COPLANAR');
});
