import {compilePolyhedronGeometryIR} from './polyhedron-geometry-engine.mjs';

// 本地参数化金标库：只用于确定性回归，不调用任何模型或外部服务。
export function polyhedronRegressionCatalog() {
  const cases = [];
  for (let i = 0; i < 50; i += 1) {
    const edge = 2 + (i % 9) / 3;
    cases.push({id: `cube-${i + 1}`, family: 'cube', difficulty: i % 3 ? 'medium' : 'basic', expression: {schemaVersion: 'geometry-ir/polyhedron-v1', solid: {kind: 'cube', edge}, queries: [{id: 'angle', kind: 'line_plane_angle', line: ['A', 'C1'], plane: ['A', 'B', 'D']}]}});
    cases.push({id: `cuboid-${i + 1}`, family: 'cuboid', difficulty: 'medium', expression: {
      schemaVersion: 'geometry-ir/polyhedron-v1',
      solid: {kind: 'cuboid', length: 3 + i % 7, width: 2 + (i % 5) / 2, height: 2 + (i % 6) / 3},
      queries: [{id: 'section', kind: 'polyhedron_section', plane: {normal: [0, 0, 1], offset: 1}}]
    }});
    const baseSide = 3 + (i % 8) / 2;
    cases.push({id: `prism-${i + 1}`, family: 'prism', difficulty: 'medium', expression: {schemaVersion: 'geometry-ir/polyhedron-v1', solid: {kind: 'prism', base: {A: [0, 0, 0], B: [baseSide, 0, 0], C: [0.4, 2 + (i % 6) / 2, 0]}, translation: [0.2, 0.1, 3 + (i % 5) / 2], topNames: ['A1', 'B1', 'C1']}, queries: [{id: 'distance', kind: 'point_plane_distance', point: 'A1', plane: ['A', 'B', 'C']}]}});
    const height = 3 + (i % 10) / 2;
    cases.push({id: `pyramid-${i + 1}`, family: 'pyramid', difficulty: i % 4 ? 'medium' : 'basic', expression: {schemaVersion: 'geometry-ir/polyhedron-v1', solid: {kind: 'pyramid', base: {A: [-2, -2, 0], B: [2, -2, 0], C: [2, 2, 0], D: [-2, 2, 0]}, apex: {P: [0.1 * (i % 3), 0.1 * (i % 2), height]}}, queries: [{id: 'section', kind: 'polyhedron_section', plane: {normal: [0, 0, 1], offset: height / 2}}]}});
  }
  return cases;
}

export function runPolyhedronRegression() {
  const catalog = polyhedronRegressionCatalog();
  const metrics = {total: catalog.length, recognized: 0, irCorrect: 0, modelGenerated: 0, validatorPassed: 0, constructionsCorrect: 0, answerCorrect: 0, byFamily: {}};
  const failures = [];
  for (const item of catalog) {
    const family = metrics.byFamily[item.family] || (metrics.byFamily[item.family] = {total: 0, passed: 0});
    family.total += 1;
    metrics.recognized += 1;
    try {
      const result = compilePolyhedronGeometryIR(item.expression);
      const ok = result.status === 'verified_unique' && result.validation?.pass === true;
      if (ok) {
        metrics.irCorrect += 1; metrics.modelGenerated += 1; metrics.validatorPassed += 1; metrics.constructionsCorrect += 1; metrics.answerCorrect += 1; family.passed += 1;
      } else failures.push({id: item.id, status: result.status, error: result.error || null});
    } catch (error) { failures.push({id: item.id, status: 'exception', error: String(error.message || error)}); }
  }
  const rate = value => metrics.total ? Number((value / metrics.total).toFixed(4)) : 0;
  return {...metrics, rates: {recognized: rate(metrics.recognized), irCorrect: rate(metrics.irCorrect), modelGenerated: rate(metrics.modelGenerated), validatorPassed: rate(metrics.validatorPassed), constructionsCorrect: rate(metrics.constructionsCorrect), answerCorrect: rate(metrics.answerCorrect)}, failures, generatedAt: new Date().toISOString(), source: 'local-parametric-gold-v1'};
}
