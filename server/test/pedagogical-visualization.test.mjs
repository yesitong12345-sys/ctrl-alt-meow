import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPedagogicalVisualization} from '../workflows/pedagogical-visualization.mjs';

test('球截面教学层只引用已验证模型对象，并生成中心、半径、距离与截面标注', () => {
  const scene = {
    queryLine: ['O', 'H'],
    dimensions: [
      {id: 'section-radius', label: 'r = 3', points: ['H', 'A'], valueSource: 'verified'},
      {id: 'plane-distance', label: 'd = 4', points: ['O', 'H'], valueSource: 'verified'}
    ],
    elements: [
      {id: 'sphere1', type: 'sphere', center: 'O'},
      {id: 'section1', type: 'section-circle', center: 'H'},
      {id: 'aux-oh', type: 'segment', points: ['O', 'H'], role: 'verified-construction'}
    ]
  };
  const pedagogy = buildPedagogicalVisualization({
    scene,
    coordinates: {O: [0, 0, 0], H: [0, 0, 4], A: [3, 0, 4]},
    query: {kind: 'compute', target: 'sectionArea'},
    verification: {checks: [{constraintId: 'c-section', pass: true}]}
  });

  assert.equal(pedagogy.schemaVersion, 'pedagogical-visualization/v3');

  assert.equal(pedagogy.emphasis.faces.some(item => item.semanticRole === 'sphereBody' && item.entityRefs.includes('sphere1')), true);
  assert.equal(pedagogy.emphasis.sections.some(item => item.semanticRole === 'sectionDisk' && item.entityRefs.includes('section1')), true);
  assert.equal(pedagogy.emphasis.faces.some(item => item.semanticRole === 'sectionPlane' && item.layer === 'section-plane' && item.visible === false), true);
  assert.equal(pedagogy.emphasis.boundaries.some(item => item.semanticRole === 'sectionBoundary' && item.entityRefs.includes('section1')), true);
  assert.equal(pedagogy.emphasis.points.some(item => item.semanticRole === 'sphereCenter' && item.entityRefs.includes('O')), true);
  assert.equal(pedagogy.emphasis.points.some(item => item.semanticRole === 'sectionCenter' && item.entityRefs.includes('H')), true);
  assert.equal(pedagogy.emphasis.lines.some(item => item.semanticRole === 'centerToSectionDistance' && item.entityRefs.includes('aux-oh')), true);
  assert.equal(pedagogy.emphasis.distanceMarkers.some(item => item.points.join('-') === 'O-H'), true);
  assert.equal(pedagogy.visibilityRules.defaultVisibleLayers.includes('section-plane'), false);
  assert.deepEqual(pedagogy.annotations.filter(item => item.kind === 'center').map(item => item.entityRefs[0]).sort(), ['H', 'O']);
  assert.equal(pedagogy.annotations.some(item => item.kind === 'radius' && item.points.join('-') === 'H-A'), true);
  assert.equal(pedagogy.annotations.some(item => item.kind === 'distance' && item.points.join('-') === 'O-H'), true);
  assert.equal(pedagogy.constructionLayers[0].elementIds.includes('aux-oh'), true);
  assert.equal(pedagogy.constructionLayers[0].semanticRole, 'auxiliaryConstructions');
  assert.ok(pedagogy.annotations.every(item => item.entityRefs.every(id => ['O', 'H', 'A', 'sphere1', 'section1', 'aux-oh'].includes(id))));
});

test('线面角只在平面点和目标线均已验证时生成教学平面与焦点，不虚构投影或直角', () => {
  const pedagogy = buildPedagogicalVisualization({
    scene: {
      queryLine: ['B', 'E'], queryPlane: ['P', 'A', 'C'], dimensions: [],
      elements: [{id: 'edge-BE', type: 'segment', points: ['B', 'E']}]
    },
    coordinates: {A: [-1, -1, 0], B: [1, -1, 0], C: [1, 1, 0], E: [.5, .5, .5], P: [0, 0, 1]},
    query: {kind: 'line_plane_angle_sin', target: 'sin'},
    verification: {checks: [{constraintId: 'plane-PAC', pass: true}]}
  });

  assert.equal(pedagogy.emphasis.lines.some(item => item.kind === 'line' && item.entityRefs.join('-') === 'B-E'), true);
  assert.equal(pedagogy.emphasis.faces.some(item => item.kind === 'plane' && item.entityRefs.join('-') === 'P-A-C'), true);
  assert.equal(pedagogy.annotations.some(item => item.kind === 'planeLabel'), true);
  assert.equal(pedagogy.annotations.some(item => item.kind === 'rightAngle'), false);
  assert.equal(pedagogy.annotations.some(item => item.kind === 'projection'), false);
});

test('模型建议的教学标记必须引用已验证实体和约束，未知直角标记会被丢弃', () => {
  const pedagogy = buildPedagogicalVisualization({
    scene: {dimensions: [], elements: [{id: 'AB', type: 'segment', points: ['A', 'B']}]},
    coordinates: {A: [0, 0, 0], B: [3, 0, 0]},
    verification: {checks: [{constraintId: 'c-ab', pass: true}]},
    displayPlan: {annotations: [
      {id: 'good-length', kind: 'length', entityRefs: ['A', 'B'], points: ['A', 'B'], constraintRefs: ['c-ab'], label: 'AB = 3'},
      {id: 'invented-right-angle', kind: 'rightAngle', entityRefs: ['A', 'B'], points: ['A', 'B'], constraintRefs: ['c-perp'], label: '90°'},
      {id: 'unknown-point', kind: 'center', entityRefs: ['X'], points: ['X'], label: 'X'}
    ]}
  });
  assert.equal(pedagogy.annotations.some(item => item.id === 'ai-good-length'), true);
  assert.equal(pedagogy.annotations.some(item => item.id === 'ai-invented-right-angle'), false);
  assert.equal(pedagogy.annotations.some(item => item.id === 'ai-unknown-point'), false);
});

test('已验证角标记只保留坐标可追溯的两条射线', () => {
  const pedagogy = buildPedagogicalVisualization({
    coordinates: {O: [0, 0, 0], A: [1, 0, 0], B: [0, 1, 0]},
    verification: {checks: [{constraintId: 'perpendicular-OA-OB', pass: true}]},
    displayPlan: {annotations: [{
      id: 'right-at-o', kind: 'rightAngle', entityRefs: ['O', 'A', 'B'], points: ['O', 'A', 'B'],
      rays: [['O', 'A'], ['O', 'B']], constraintRefs: ['perpendicular-OA-OB'], label: '90°'
    }]}
  });
  assert.deepEqual(pedagogy.annotations[0].rays, [['O', 'A'], ['O', 'B']]);
});

test('多面体截面以对象级圆盘与边界高亮，不创建覆盖场景的默认无限平面',()=>{
  const pedagogy=buildPedagogicalVisualization({scene:{dimensions:[],elements:[{id:'hex-section',type:'section-polygon',points:['S1','S2','S3','S4','S5','S6']}]},coordinates:{S1:[2,1,0],S2:[1,2,0],S3:[0,2,1],S4:[0,1,2],S5:[1,0,2],S6:[2,0,1]},query:{kind:'polyhedron_section'},verification:{checks:[{constraintId:'query:section',pass:true}]}});
  assert.ok(pedagogy.emphasis.sections.some(item=>item.semanticRole==='sectionPolygon'&&item.entityRefs.includes('hex-section')));
  assert.ok(pedagogy.emphasis.boundaries.some(item=>item.semanticRole==='sectionBoundary'&&item.entityRefs.includes('hex-section')));
  assert.ok(pedagogy.emphasis.faces.some(item=>item.semanticRole==='sectionPlane'&&item.visible===false));
  assert.equal(pedagogy.visibilityRules.defaultVisibleLayers.includes('section-plane'),false);
});
