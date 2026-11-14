import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStandardPolyhedronText} from '../workflows/polyhedron-geometry-entry.mjs';
import {compilePolyhedronGeometryIR} from '../workflows/polyhedron-geometry-engine.mjs';

test('直三棱柱文字条件进入通用棱柱 IR 并计算线面角',()=>{
  const parsed=parseStandardPolyhedronText('在直三棱柱 ABC-A1B1C1 中，底面 ABC 是以 A 为直角的三角形，AB=3，AC=4，侧棱 AA1=5，求直线 BC1 与平面 ABC 所成角。');
  assert.equal(parsed.problemIR.solid.kind,'prism');
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.equal(compiled.queryResults['line-plane-angle'].kind,'line_plane_angle');
  assert.equal(compiled.result.scene.frameEdges.length,9);
});

test('根式等式链与中点向量夹角生成可验证直三棱柱模型',()=>{
  const parsed=parseStandardPolyhedronText('在直三棱柱ABC-A1B1C1中，AC=AB=AA1=√2，BC=2AE=2，E为BC的中点，求向量AE与A1C夹角的余弦值。');
  assert.equal(parsed.problemIR.solid.kind,'prism');
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='E'));
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='vector_relation'));
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.deepEqual(compiled.queryResults['midpoint-E'].coordinates,[Math.SQRT2/2,Math.SQRT2/2,0]);
  assert.ok(Math.abs(compiled.queryResults['vector-angle'].cosine-0.5)<1e-9);
  assert.ok(compiled.result.scene.elements.some(element=>element.id==='vector-focus-A-E'));
  assert.ok(compiled.result.scene.elements.some(element=>element.id==='vector-focus-A1-C'));
  assert.equal(compiled.result.scene.elements.find(element=>element.id==='vector-focus-A-E').role,'query-focus');
  assert.equal(compiled.result.scene.elements.find(element=>element.id==='vector-focus-A1-C').role,'query-focus');
  assert.ok(compiled.result.scene.dimensions.some(item=>item.points.join('')==='AB'&&item.label==='AB = √2'));
  assert.ok(compiled.result.scene.dimensions.some(item=>item.points.join('')==='AC'&&item.label==='AC = √2'));
  assert.ok(compiled.result.scene.dimensions.some(item=>item.points.join('')==='AA1'&&item.label==='AA₁ = √2'));
  assert.ok(compiled.result.scene.dimensions.some(item=>item.points.join('')==='BC'&&item.label==='BC = 2'));
  assert.ok(compiled.result.scene.dimensions.some(item=>item.points.join('')==='AE'&&item.label==='AE = 1'));
});

test('顶点下标的常见输入形式统一识别且两条目标向量默认可见',()=>{
  for(const topVertex of ['A1','A_1','A_{1}','A₁','A 1','A下标1','A小标1']){
    const parsed=parseStandardPolyhedronText(`在直三棱柱 ABC-${topVertex}B1C1 中，AC=AB=AA₁=√2，BC=2，E为BC中点，求向量AE与${topVertex}C夹角的余弦值。`);
    assert.ok(parsed,`应识别点名形式 ${topVertex}`);
    const vectorQuery=parsed.problemIR.queries.find(query=>query.kind==='vector_relation');
    assert.deepEqual(vectorQuery.second,['A1','C']);
    const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
    assert.equal(compiled.status,'verified_unique');
    assert.deepEqual(compiled.result.scene.queryLines,[['A','E'],['A1','C']]);
  }
});

test('补充信息中的 LaTeX 点名不会阻断同一棱柱模型',()=>{
  const parsed=parseStandardPolyhedronText('在直三棱柱ABC-a1B1 C1中，AC=AB=AA1等于√2，BC=2ae=2，则向量ae与A1C的夹角的余弦值是什么，\\(E\\) 为 \\(BC\\) 的中点');
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.ok(Math.abs(compiled.queryResults['vector-angle'].cosine-0.5)<1e-9);
});

test('两块共棱且平面垂直的正方形可构造成开放曲面模型并求派生点距离',()=>{
  for(const wording of [
    '已知正方形ABCD和正方形ADEF的边长均为6，且它们所在的平面互相垂直，O是BE的中点，向量FM=1/2向量MA，则线段OM的长为多少',
    '已知正方形 ABCD 和正方形 a def 的边长均为 6，且它们所在的平面互相垂直，O 是 BE 的中点，向量 FM = 1/2 向量 MA，则线段 OM 的长为多少'
  ]){
    const parsed=parseStandardPolyhedronText(wording);
    assert.ok(parsed&&!parsed.status,'完整条件不应被误报缺失');
    assert.equal(parsed.problemIR.solid.kind,'surface_complex');
    const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
    assert.equal(compiled.status,'verified_unique');
    assert.ok(Math.abs(compiled.queryResults['segment-length-OM'].value-Math.sqrt(19))<1e-9);
    assert.deepEqual(compiled.queryResults['affine-point-M'].coordinates,[0,0,4]);
    assert.ok(compiled.result.scene.elements.some(element=>element.id==='construction-F-M'));
    assert.ok(compiled.result.scene.dimensions.some(item=>item.points.join('')==='OM'));
  }
});

test('正四棱锥文字条件进入通用棱锥 IR，平行底面截面由求交引擎生成',()=>{
  const parsed=parseStandardPolyhedronText('正四棱锥 P-ABCD 的底面边长为 6，高为 4。在距底面 2 的位置作平行于底面的截面，求截面面积。');
  assert.equal(parsed.problemIR.solid.kind,'pyramid');
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.equal(compiled.queryResults.section.vertexCount,4);
  assert.equal(compiled.queryResults.section.area,9);
});

test('长方体文字条件可生成统一模型并计算点面距离',()=>{
  const parsed=parseStandardPolyhedronText('长方体 ABCD-A1B1C1D1 的长、宽、高分别为 6、4、3，求点 C1 到平面 ABCD 的距离。');
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.equal(compiled.queryResults['point-plane-distance'].value,3);
});

test('题目没有提出具体构造时不凭空增加中点或辅助线',()=>{
  const parsed=parseStandardPolyhedronText('长方体 ABCD-A1B1C1D1 的长、宽、高分别为 6、4、3。');
  assert.deepEqual(parsed.problemIR.queries,[]);
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.equal(compiled.result.scene.elements.some(element=>String(element.id).startsWith('construction-')),false);
});

test('语音逗号与连续边名不应阻断正四面体中点向量建模',()=>{
  const parsed=parseStandardPolyhedronText('正四面体ABCD中，M，N分别是ABCD的中点，直线B，N与D，M夹角的余弦值为多少');
  assert.ok(parsed,'完整的正四面体纯角度题必须进入本地确定性建模');
  assert.equal(parsed.problemIR.solid.kind,'pyramid');
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='M'&&query.segment.join('')==='AB'));
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='N'&&query.segment.join('')==='CD'));
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='vector_relation'&&query.first.join('')==='BN'&&query.second.join('')==='DM'));
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.ok(Number.isFinite(compiled.queryResults['vector-angle'].cosine));
  assert.deepEqual(compiled.result.scene.queryLines,[['B','N'],['D','M']]);
});

test('共享规范化后的 LaTeX 根式仍能进入直三棱柱本地构造器',()=>{
  const parsed=parseStandardPolyhedronText('直三棱柱ABC-A1B1C1中，AB=AC=AA1=\\sqrt{2}，BC=2，E为BC的中点，求向量AE与A1C夹角的余弦值。');
  assert.ok(parsed?.problemIR,'规范化 sqrt(2) 不能被本地数值解析遗漏');
  assert.equal(compilePolyhedronGeometryIR(parsed.problemIR).status,'verified_unique');
});

test('任意四个顶点名的正四面体应解析全部中点与多个垂直证明目标',()=>{
  const parsed=parseStandardPolyhedronText('已知，棱长为1的正四面体OABC.E，F分别是AB，OC的中点，求证，E, F垂直于AB和EF垂直于OC');
  assert.ok(parsed,'OABC 只是顶点换名，不应被固定 ABCD 语法挡在几何内核外');
  assert.deepEqual(Object.keys(parsed.problemIR.solid.base),['O','A','B']);
  assert.deepEqual(Object.keys(parsed.problemIR.solid.apex),['C']);
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='E'&&query.segment.join('')==='AB'));
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='F'&&query.segment.join('')==='OC'));
  const goals=parsed.problemIR.queries.filter(query=>query.kind==='vector_relation'&&query.expectation?.perpendicular);
  assert.deepEqual(goals.map(query=>[query.first.join(''),query.second.join('')]),[['EF','AB'],['EF','OC']]);
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.equal(compiled.goalResult.status,'proved');
  assert.deepEqual(compiled.result.scene.queryLines,[['E','F'],['A','B'],['O','C']]);
});

test('正四面体常见语音标点与空格变体不能阻断确定性建模',()=>{
  const variants=[
    '正四面体 O A B C 中，棱长等于1。E、F分别为AB、OC的中点，证明EF⊥AB，且EF⊥OC。',
    '正四面体OABC中，棱长为1，E F分别是AB和OC的中点，求证E F垂直AB，E F垂直OC',
    '已知正四面体OABC的棱长是1，E,F分别是AB,OC中点，EF垂直于AB且EF垂直于OC'
  ];
  for(const question of variants){
    const parsed=parseStandardPolyhedronText(question);
    assert.ok(parsed,`语音/标点变体不应阻断：${question}`);
    const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
    assert.equal(compiled.status,'verified_unique');
    assert.equal(compiled.goalResult.status,'proved');
    assert.deepEqual(compiled.result.scene.queryLines,[['E','F'],['A','B'],['O','C']]);
  }
});

test('同一道题任意数量的垂直与平行关系都由统一关系表完整进入 IR',()=>{
  const parsed=parseStandardPolyhedronText('正四面体OABC中，棱长为1，E、F分别为AB、OC中点，已知EF垂直AB，OA平行于BC，并求证EF⊥OC。');
  assert.ok(parsed);
  const relations=parsed.problemIR.queries.filter(item=>item.kind==='vector_relation');
  assert.deepEqual(relations.map(item=>item.expectation),[{perpendicular:true},{parallel:true},{perpendicular:true}]);
  assert.deepEqual(relations.map(item=>[item.first.join(''),item.second.join('')]),[['EF','AB'],['OA','BC'],['EF','OC']]);
});

test('平行六面体由三棱长与三夹角构造，并验证中点连线垂直体对角线',()=>{
  const parsed=parseStandardPolyhedronText('在平行六面体ABCD-A1B1C1D1中，AB=4，AD=4，AA1=5，∠DAB=60°，∠BAA1=60°，∠DAA1=60°，M、N分别为D1C1、C1B1的中点，求证MN⊥AC1。');
  assert.ok(parsed,'充分条件不应因 DeepSeek 不可用而停止建模');
  assert.equal(parsed.problemIR.solid.kind,'parallelepiped');
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='M'&&query.segment.join('')==='D1C1'));
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='N'&&query.segment.join('')==='C1B1'));
  assert.ok(parsed.problemIR.queries.some(query=>query.kind==='vector_relation'&&query.first.join('')==='MN'&&query.second.join('')==='AC1'));
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.equal(compiled.queryResults['vector-relation'].perpendicular,true);
  assert.equal(compiled.goalResult.status,'proved');
  assert.equal(compiled.validation.checks.filter(check=>check.id.startsWith('constraint:given-')).length,6);
  assert.ok(compiled.validation.checks.filter(check=>check.id.startsWith('constraint:given-')).every(check=>check.pass&&check.residual<=check.tolerance));
  assert.deepEqual(compiled.result.scene.queryLines,[['M','N'],['A','C1']]);
});

test('真实语音转写的二层顶点、中文角度与断裂 AA2 仍进入同一平行六面体 IR',()=>{
  const parsed=parseStandardPolyhedronText('平行六面体ABCD-a 2 B 2 C 2 D2中，AB=4，ad=4a，a2=5，角DAB等于六十度，角BAA2=60°，角DAA2=60°，M到N分别为D2C2，C2B2的中点，求证，M, N垂直于AC2');
  assert.ok(parsed,'真实提交不应在进入 Geometry IR 前被字符串格式挡住');
  assert.equal(parsed.problemIR.solid.kind,'parallelepiped');
  assert.deepEqual(parsed.problemIR.solid.topNames,['A2','B2','C2','D2']);
  const compiled=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(compiled.status,'verified_unique');
  assert.equal(compiled.goalResult.status,'proved');
  assert.deepEqual(compiled.result.scene.queryLines,[['M','N'],['A','C2']]);
});
