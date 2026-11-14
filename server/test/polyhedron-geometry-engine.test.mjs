import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compilePolyhedronGeometryIR,
  createCubeSpec,
  createPrismSpec,
  createPyramidSpec,
  intersectPolyhedronWithPlane,
  linePlaneAngle,
  dihedralAngle,
  pointPlaneDistance,
  skewLineDistance
} from '../workflows/polyhedron-geometry-engine.mjs';
import {polyhedronRegressionCatalog, runPolyhedronRegression} from '../workflows/polyhedron-regression-library.mjs';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('通用正方体工厂生成八点六面十二棱且保持真实棱长', () => {
  const solid = createCubeSpec({edge: 2});
  assert.equal(Object.keys(solid.coordinates).length, 8);
  assert.equal(solid.faces.length, 6);
  assert.equal(solid.edges.length, 12);
  close(Math.hypot(...solid.coordinates.B.map((value, index) => value - solid.coordinates.A[index])), 2);
});

test('任意底面与平移向量可生成通用三棱柱，不依赖题型文案', () => {
  const solid = createPrismSpec({
    base: {A: [0, 0, 0], B: [4, 0, 0], C: [1, 3, 0]},
    translation: [1, 2, 5],
    topNames: ['A1', 'B1', 'C1']
  });
  assert.equal(solid.faces.length, 5);
  assert.equal(solid.edges.length, 9);
  assert.deepEqual(solid.coordinates.C1, [2, 5, 5]);
});

test('任意多边形底面与面外顶点可生成通用棱锥', () => {
  const solid = createPyramidSpec({
    base: {A: [0, 0, 0], B: [5, 0, 0], C: [4, 3, 0], D: [0, 2, 0]},
    apex: {P: [1, 1, 6]}
  });
  assert.equal(solid.faces.length, 5);
  assert.equal(solid.edges.length, 8);
  assert.deepEqual(solid.faces[0], ['A', 'B', 'C', 'D']);
});

test('输入坐标轴和底面不满足硬约束时明确拒绝，不偷偷校正后作图', () => {
  assert.throws(() => createCubeSpec({edge: 2, axes: [[1, 0, 0], [1, 1, 0], [0, 0, 1]]}), /CUBOID_AXES_NOT_ORTHOGONAL/);
  assert.throws(() => createPrismSpec({
    base: {A: [0, 0, 0], B: [2, 0, 0], C: [2, 2, 0], D: [0, 2, 1]},
    translation: [0, 0, 3]
  }), /PRISM_BASE_NOT_COPLANAR/);
  assert.throws(() => createPyramidSpec({
    base: {A: [0, 0, 0], B: [2, 0, 0], C: [2, 2, 0], D: [0, 2, 1]},
    apex: {P: [1, 1, 3]}
  }), /PYRAMID_BASE_NOT_COPLANAR/);
});

test('空间角与距离使用同一坐标内核计算', () => {
  const cube = createCubeSpec({edge: 2});
  close(linePlaneAngle([cube.coordinates.A, cube.coordinates.C1], [cube.coordinates.A, cube.coordinates.B, cube.coordinates.D]), Math.asin(1 / Math.sqrt(3)));
  close(dihedralAngle([cube.coordinates.A, cube.coordinates.B, cube.coordinates.C], [cube.coordinates.A, cube.coordinates.B, cube.coordinates.A1]), Math.PI / 2);
  close(pointPlaneDistance(cube.coordinates.C1, [cube.coordinates.A, cube.coordinates.B, cube.coordinates.D]), 2);
  close(skewLineDistance([cube.coordinates.A, cube.coordinates.B], [cube.coordinates.D, cube.coordinates.D1]), 2);
});

test('空间向量关系查询返回点积、叉积、平行与垂直判定', () => {
  const compiled = compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1', solid:{kind:'cube', edge:2}, queries:[
    {id:'vectors', kind:'vector_relation', first:['A','B'], second:['A','D']}
  ]});
  assert.equal(compiled.status, 'verified_unique');
  assert.equal(compiled.queryResults.vectors.perpendicular, true);
  assert.equal(compiled.queryResults.vectors.parallel, false);
});

test('凸多面体截面由截平面与棱求交，正方体水平截面保持真实尺寸', () => {
  const cube = createCubeSpec({edge: 2});
  const section = intersectPolyhedronWithPlane(cube, {normal: [0, 0, 1], offset: 1});
  assert.equal(section.status, 'verified');
  assert.equal(section.points.length, 4);
  close(section.area, 4);
  assert.ok(section.points.every(point => Math.abs(point[2] - 1) < 1e-9));
});

test('正方体一般截平面可得到六边形而不是套固定矩形模板', () => {
  const cube = createCubeSpec({edge: 2});
  const section = intersectPolyhedronWithPlane(cube, {normal: [1, 1, 1], offset: 3});
  assert.equal(section.status, 'verified');
  assert.equal(section.points.length, 6);
  assert.ok(section.points.every(point => Math.abs(point[0] + point[1] + point[2] - 3) < 1e-9));
});

test('统一 IR 编译后同时给出验证报告、空间查询与可渲染多边形截面', () => {
  const compiled = compilePolyhedronGeometryIR({
    schemaVersion: 'geometry-ir/polyhedron-v1',
    solid: {kind: 'cube', edge: 2},
    queries: [
      {id: 'q-angle', kind: 'line_plane_angle', line: ['A', 'C1'], plane: ['A', 'B', 'D']},
      {id: 'q-distance', kind: 'point_plane_distance', point: 'C1', plane: ['A', 'B', 'D']},
      {id: 'q-section', kind: 'polyhedron_section', plane: {normal: [1, 1, 1], offset: 3}}
    ]
  });
  assert.equal(compiled.status, 'verified_unique');
  assert.equal(compiled.validation.pass, true);
  assert.equal(compiled.queryResults['q-section'].vertexCount, 6);
  assert.ok(compiled.result.scene.elements.some(element => element.type === 'section-polygon'));
  assert.equal(compiled.result.scene.frameEdges.length, 12);
});

test('参数动点与投影垂足由查询生成独立辅助构造，不修改基础多面体', () => {
  const compiled=compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cube',edge:4},queries:[
    {id:'moving',kind:'point_on_segment',pointId:'M',segment:['A1','C1'],parameter:.25},
    {id:'projection',kind:'projection_to_plane',point:'C1',plane:['A','B','D'],footId:'H'}
  ]});
  assert.equal(compiled.status,'verified_unique');
  assert.deepEqual(compiled.queryResults.moving.coordinates,[1,1,4]);
  assert.deepEqual(compiled.queryResults.projection.coordinates,[4,4,0]);
  assert.ok(compiled.result.scene.elements.some(element=>element.id==='construction-C1-H'));
  assert.equal(Object.keys(compiled.solid.coordinates).includes('M'),false);
});

test('正方体外接球与内切球使用真实中心和半径并通过顶点/面的确定性校验',()=>{
  const compiled=compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cube',edge:2},queries:[
    {id:'outer',kind:'circumsphere',centerId:'O',surfacePoints:['A','B','C','D','A1','B1','C1','D1']},
    {id:'inner',kind:'insphere',centerId:'I'}
  ]});
  assert.equal(compiled.status,'verified_unique');
  assert.deepEqual(compiled.queryResults.outer.center,[1,1,1]);
  close(compiled.queryResults.outer.radius,Math.sqrt(3));
  assert.deepEqual(compiled.queryResults.inner.center,[1,1,1]);
  close(compiled.queryResults.inner.radius,1);
  assert.equal(compiled.result.scene.elements.filter(element=>element.type==='sphere').length,2);
});

test('缺面或非闭合拓扑不能伪装成 verified 多面体',()=>{
  const compiled=compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'polyhedron',coordinates:{A:[0,0,0],B:[1,0,0],C:[0,1,0],P:[0,0,1]},faces:[['A','B','C'],['P','A','B'],['P','B','C']]},queries:[]});
  assert.equal(compiled.status,'validation_failed');
  assert.ok(compiled.validation.checks.some(check=>check.id==='topology:closed-two-manifold'&&!check.pass));
});

test('批量回归 120 个不同尺寸与姿态的凸棱柱、棱锥和截面，全部保持约束成立',()=>{
  let verified=0;
  for(let index=1;index<=40;index++){
    const cube=compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cuboid',length:index/3+1,width:index/5+1,height:index/7+1},queries:[{id:'section',kind:'polyhedron_section',plane:{normal:[0,0,1],offset:(index/7+1)/2}}]});
    assert.equal(cube.status,'verified_unique');verified++;
    const prism=compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'prism',base:{A:[0,0,0],B:[index/4+2,0,0],C:[.4,index/6+1,0]},translation:[index%3*.2,index%5*.1,index/8+2],topNames:['A1','B1','C1']},queries:[{id:'distance',kind:'point_plane_distance',point:'A1',plane:['A','B','C']}]});
    assert.equal(prism.status,'verified_unique');verified++;
    const height=index/9+2,pyramid=compilePolyhedronGeometryIR({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'pyramid',base:{A:[-2,-2,0],B:[2,-2,0],C:[2,2,0],D:[-2,2,0]},apex:{P:[index%4*.1,index%3*.1,height]}},queries:[{id:'section',kind:'polyhedron_section',plane:{normal:[0,0,1],offset:height/2}}]});
    assert.equal(pyramid.status,'verified_unique');verified++;
  }
  assert.equal(verified,120);
});

test('高二回归库提供 200 道以上本地金标题并输出六项统计，不调用模型', () => {
  const catalog = polyhedronRegressionCatalog();
  assert.ok(catalog.length >= 200);
  const metrics = runPolyhedronRegression();
  assert.equal(metrics.total, catalog.length);
  assert.equal(metrics.failures.length, 0);
  assert.equal(metrics.rates.validatorPassed, 1);
});
