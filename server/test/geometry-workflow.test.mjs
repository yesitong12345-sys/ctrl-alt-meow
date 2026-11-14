import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeometryWorkflow} from '../workflows/geometry-workflow.mjs';

test('平面向量生成二维坐标场景和引导问题', async () => {
  const workflow = createGeometryWorkflow();
  const result = await workflow.run({
    fileName: '平面向量三角形.png',
    questionText: '在三角形ABC中，用向量证明AB垂直AC。',
    studentAnswer: '不知道怎么建系'
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.scene.dimension, 2);
  assert.ok(Object.keys(result.scene.points).length >= 3);
  assert.equal(result.visualization.renderer, 'svg');
  assert.match(result.tutoring.nextQuestion, /原点|坐标|向量|条件/);
});

test('立体几何生成三维坐标系并通过结构校验', async () => {
  const workflow = createGeometryWorkflow();
  const result = await workflow.run({
    fileName: '立体几何线面垂直.jpg',
    questionText: '在四面体ABCD中，AD垂直平面ABC，建立空间直角坐标系。'
  });
  assert.equal(result.scene.dimension, 3);
  assert.ok(Object.values(result.scene.points).every(point => point.length === 3));
  assert.equal(result.validation.valid, true);
  assert.equal(result.visualization.renderer, 'three');
});

test('图像信息不足时不会伪造确定结论', async () => {
  const workflow = createGeometryWorkflow({
    visionAdapter: async () => ({
      problemType: 'solid_geometry',
      questionText: '',
      points: {},
      edges: [],
      relations: [],
      confidence: {question: 0.2, diagram: 0.2}
    })
  });
  const result = await workflow.run({fileName: '模糊图片.jpg'});
  assert.equal(result.status, 'needs_review');
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.issues.length > 0);
  assert.match(result.tutoring.nextQuestion, /补拍|确认|看清/);
});
