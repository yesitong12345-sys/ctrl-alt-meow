const unique = values => [...new Set(values.filter(Boolean))];

function construction(type, data, reason, revealAt) {
  return {
    id: data.id || `${type}-${revealAt}`,
    type,
    ...data,
    reason,
    revealAt,
    source: 'derived-by-teaching-coach'
  };
}

function hasRelation(ir, type) {
  return (ir.relations || []).some(item => item.type === type);
}

function tangentRelation(ir) {
  return (ir.relations || []).find(item => item.type === 'tangent_at');
}

function scoringRubric(ir) {
  const items = [];
  if (ir.givens?.circleEquation || ir.entities?.some(item => item.type === 'circle')) {
    items.push({id: 'circle-properties', title: '确定圆心、半径与已知点的位置关系', weight: 25});
  }
  if (hasRelation(ir, 'tangent_at') || ir.targets?.includes('tangent_slope')) {
    items.push({id: 'tangent-breakthrough', title: '发现切点半径垂直切线这一突破口', weight: 30});
    items.push({id: 'translate-condition', title: '把垂直关系转成斜率、距离或向量条件', weight: 25});
  }
  if ((ir.relations || []).some(item => item.type === 'line_conic_intersection')) {
    items.push({id: 'intersection-system', title: '联立直线与曲线并判断交点条件', weight: 30});
  }
  if (ir.targets?.some(item => /range|extremum|locus/.test(item))) {
    items.push({id: 'target-transform', title: '把目标量化成单参数表达式并确定约束', weight: 30});
  }
  items.push({id: 'exact-solve', title: '精确计算并写出所求结论', weight: 15});
  items.push({id: 'verify', title: '把结果代回几何关系进行验证', weight: 10});
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  const normalized = items.map(item => ({...item, weight: Math.round(item.weight / total * 100)}));
  const overflow = normalized.reduce((sum, item) => sum + item.weight, 0) - 100;
  normalized[normalized.length - 1].weight -= overflow;
  return normalized;
}

function buildConstructions(ir) {
  const items = [];
  const tangent = tangentRelation(ir);
  if (tangent) {
    const center = tangent.circle || 'O';
    const point = tangent.point || 'T';
    items.push(construction('segment', {id: `radius-${center}-${point}`, a: center, b: point, role: 'auxiliary-radius'}, '切点处的半径垂直切线，这条半径把“切线”转成可计算的直角关系。', 2));
    items.push(construction('perpendicular_marker', {id: `right-angle-${point}`, vertex: point, lines: [`${center}${point}`, tangent.line]}, '把半径与切线垂直的关键关系显式标出，后续可选择勾股、相似、斜率或点线距离。', 3));
  }
  if (ir.targets?.includes('tangent_slope') || hasRelation(ir, 'unknown_tangent')) {
    items.push(construction('line_through_slope', {id: 'candidate-tangent', name: 'candidate-tangent', point: ir.givens?.externalPoint || 'P', slope: '@param', dynamic: true}, '让候选直线绕已知点转动；当圆心到直线的距离等于半径时，它才是切线。', 3));
    items.push(construction('foot_perp', {id: 'center-to-line-foot', point: ir.givens?.circleCenterName || 'C', line: 'candidate-tangent', outputPoint: 'T', dynamic: true}, '垂足就是候选切点，用距离等于半径验证切线条件。', 4));
  }
  for (const relation of ir.relations || []) {
    if (relation.type === 'line_conic_intersection') {
      items.push(construction('intersect_line_conic', {id: `intersection-${relation.line || 'l'}`, line: relation.line || 'l', conic: relation.conic || 'C', outputPoints: relation.points || ['A', 'B'], dynamic: true}, '交点随直线参数变化，画板同步显示判别式、弦长或韦达量的变化。', 3));
    }
    if (relation.type === 'equal_distance_locus') {
      items.push(construction('auxiliary_circle', {id: 'equal-distance-circle', center: relation.center, through: relation.through, dashed: true}, '把等距条件转成圆或垂直平分线，帮助识别轨迹。', 3));
    }
  }
  return items;
}

export function planAnalyticGeometryLesson(ir, context = {}) {
  const constructions = buildConstructions(ir);
  const hasTangent = constructions.some(item => item.role === 'auxiliary-radius' || item.id === 'candidate-tangent');
  const executableTypes = new Set(['segment', 'foot_perp', 'line_through_slope', 'intersect_line_conic']);
  const boardPatch = {
    derived: constructions.filter(item => executableTypes.has(item.type)).map(item => {
      const {reason, revealAt, source, role, dynamic, id, ...operation} = item;
      if (item.type === 'intersect_line_conic') {
        return {...operation, type: item.type, name: operation.outputPoints || ['A', 'B']};
      }
      delete operation.outputPoints;
      return {...operation, type: item.type, name: operation.name || id};
    }),
    conics: constructions.filter(item => item.type === 'auxiliary_circle').map(item => ({
      name: item.id,
      kind: 'circle',
      center: item.center,
      through: item.through,
      dashed: true,
      role: 'auxiliary'
    })),
    overlays: constructions.filter(item => !executableTypes.has(item.type) && item.type !== 'auxiliary_circle'),
    timeline: constructions.map(item => ({revealAt: item.revealAt, constructionId: item.id, reason: item.reason}))
  };
  const bottleneck = context.studentNeed || (hasTangent ? '尚未把切线条件转成可计算的垂直关系' : '尚未把几何关系转成代数约束');
  return {
    skill: 'edu-analytic-geometry',
    knowledgePoint: ir.knowledgePoint || (hasTangent ? '圆与切线' : '平面解析几何'),
    studentNeed: bottleneck,
    strategy: hasTangent
      ? '先显示切点与圆心的关系，让学生发现直角结构，再选择距离、斜率或向量工具。'
      : '先建立对象关系图，再将目标量转成一个受约束的参数表达式。',
    teachingPath: [
      {phase: 'observation', title: '观察', prompt: hasTangent ? '先找出切点、圆心和切线分别在哪里。' : '先区分已知对象、变化对象和所求关系。'},
      {phase: 'hint', title: '提示', prompt: hasTangent ? '想一想圆心与切点之间还能补出哪条天然存在的线。' : '哪一个条件最适合先翻译成方程或向量关系？'},
      {phase: 'operation', title: '操作', prompt: constructions.length ? '在画板上逐步显示辅助构造，并让学生拖动或选择关键对象。' : '在画板上选择关键点、线与曲线，观察目标量变化。'},
      {phase: 'reasoning', title: '推理', prompt: '把刚观察到的几何关系写成一个可验证的数学条件。'},
      {phase: 'verification', title: '验证', prompt: '用第二种表示或代回原图验证结果是否同时满足全部条件。'},
      {phase: 'summary', title: '总结', prompt: '总结这次辅助构造解决了哪个信息缺口，以及何时可以复用。'}
    ],
    scoringRubric: scoringRubric(ir),
    visualization: {
      mode: 'interactive-analytic-board',
      renderer: 'canvas-2d',
      schema: 'edulab-analytic-board/v1',
      use3d: false,
      dynamic: true,
      sourceOfTruth: 'problem-ir',
      constructions,
      boardPatch,
      capabilities: unique(['drag-point', 'step-reveal', 'relation-highlight', 'answer-verification', constructions.some(item => item.dynamic) && 'parameter-slider'])
    },
    verification: {
      exactKernel: 'edu-analytic-geometry/lib/analytic_kernel.py',
      checks: unique(['all-givens-satisfied', hasTangent && 'center-line-distance-equals-radius', 'result-substitutes-back'])
    }
  };
}
