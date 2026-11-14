function chooseVisualization(ir, studentNeed = '') {
  const target = `${ir.knowledgePoint || ''} ${(ir.targets || []).join(' ')} ${studentNeed}`;
  if (/配平|守恒|系数|原子数/.test(target)) {
    return {mode: 'conservation-table', renderer: 'html-grid', use3d: false, rationale: '学生当前卡在配平或原子守恒，逐元素计数比完整 3D 动画更直接。'};
  }
  if (/氧化还原|电子|化合价/.test(target)) {
    return {mode: 'electron-transfer-map', renderer: 'svg', use3d: false, rationale: '当前重点是电子得失与化合价变化，电子转移图比空间旋转更有效。'};
  }
  if (/能量|活化能|放热|吸热|反应速率/.test(target)) {
    return {mode: 'reaction-coordinate', renderer: 'svg-chart', use3d: false, rationale: '当前问题关注能量或速率，应优先展示反应进程曲线和条件变化。'};
  }
  if (/机理|断键|成键|质子转移|原子.*去|空间|构型/.test(target) || ir.reactionClass === 'organic-mechanism') {
    return {mode: 'molecular-mechanism-3d', renderer: 'three', use3d: true, engine: 'mechanism', rationale: '学生需要追踪断键、成键或原子去向，分步 3D 机理能直接呈现微观过程。'};
  }
  if (/微观|粒子|碰撞|晶格/.test(target)) {
    return {mode: 'molecular-morph-3d', renderer: 'three', use3d: true, engine: 'morph', rationale: '空间微观过程对当前概念理解有直接帮助。'};
  }
  return {mode: 'equation-and-particle-cards', renderer: 'html-svg', use3d: false, rationale: '当前任务可由方程、物质角色和局部粒子示意讲清，无需完整 3D 动画。'};
}

function extractElements(equationText = '') {
  return [...new Set(String(equationText).match(/[A-Z][a-z]?/g) || [])];
}

export function planChemReactionLesson(ir, context = {}) {
  const studentNeed = context.studentNeed || '需要明确反应条件、物质角色与守恒依据';
  const visualization = chooseVisualization(ir, studentNeed);
  return {
    skill: 'edu-chem-reaction',
    knowledgePoint: ir.knowledgePoint || '化学反应原理',
    studentNeed,
    strategy: '先确认学生卡点对应宏观现象、符号表达还是微观过程，再选择最小但足够的可视化。',
    teachingPath: [
      {phase: 'observation', title: '观察', prompt: '先指出反应物、产物、条件和题目真正要求解释的变化。'},
      {phase: 'hint', title: '提示', prompt: '聚焦一个守恒量或一个发生变化的粒子关系。'},
      {phase: 'operation', title: '操作', prompt: `使用“${visualization.mode}”逐步操作或播放，记录每一步实际变化。`},
      {phase: 'reasoning', title: '推理', prompt: '把可视化中的变化整理成化学方程式、电子守恒或断键成键语言。'},
      {phase: 'verification', title: '验证', prompt: '检查元素、电荷、电子或原子映射在反应前后是否一致。'},
      {phase: 'summary', title: '总结', prompt: '用“条件—微观变化—宏观结果”三句话总结。'}
    ],
    scoringRubric: [
      {id: 'identify-roles', title: '识别反应物、产物和条件', weight: 20},
      {id: 'explain-change', title: '说清当前题目要求的微观或守恒变化', weight: 35},
      {id: 'symbolic-expression', title: '用规范化学语言表达', weight: 25},
      {id: 'verify-conservation', title: '完成守恒与条件验证', weight: 20}
    ],
    visualization: {
      ...visualization,
      schema: 'edulab-chem-reaction/v1',
      sourceOfTruth: 'problem-ir',
      teachingOverlays: ['current-change', 'why-this-step', 'atom-conservation', 'pause-and-predict'],
      kernel: 'edu-chem-reaction/lib/reaction_kernel.py',
      teachingData: {
        elements: extractElements(ir.givens?.equationText),
        equationText: ir.givens?.equationText || '',
        sceneSpec: ir.reactionScene || ir.givens?.reactionScene || null,
        source: ir.reactionScene || ir.givens?.reactionScene ? 'problem-ir' : 'teaching-preview'
      }
    },
    verification: {
      exactKernel: 'edu-chem-reaction/lib/reaction_kernel.py',
      checks: ['balanced-coefficients', 'element-conservation', 'charge-conservation-when-applicable', 'atom-map-bijection-when-animated']
    }
  };
}
