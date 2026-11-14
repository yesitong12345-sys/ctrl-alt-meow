const normalized = value => String(value || '')
  .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0))
  .replace(/\s+/g, ' ')
  .trim();

const has = (text, expression) => expression.test(text);

// A dimension captured as its literal expression: 6, 2√3, 3/2, 6.5 …
const DIM = '([0-9A-Za-z√\\/().+\\-]+)';

function firstExpression(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

function firstDimensionExpression(text, patterns) {
  const expression=firstExpression(text,patterns);
  // AC=BC is an equal-length relation, not a numeric/model scale.  Keep
  // lowercase symbolic dimensions such as a or 2a, but reject point/segment
  // names accidentally captured as the right-hand side.
  return expression&&/^[A-Z][A-Z0-9_₀-₉]*$/.test(expression)?null:expression;
}

function integerValue(expression) {
  if (expression && /^\d+$/.test(expression)) return Number(expression);
  return null;
}

function errorEvidence(studentAnswer) {
  const answer = normalized(studentAnswer);
  if (!answer || /待补充|未作答/.test(answer)) return {
    status: 'insufficient_evidence',
    evidence: null,
    likelyStuckPoint: '尚未提供作答过程，暂不推断具体错因。'
  };
  if (/法向量|不会.*(?:构造|求).*法向量/.test(answer)) return {
    status: 'evidence_based', evidence: answer,
    likelyStuckPoint: '平面法向量的构造，以及它和线面角之间的转换关系不稳定。'
  };
  if (/sin|正弦|余角|cos|余弦/.test(answer)) return {
    status: 'evidence_based', evidence: answer,
    likelyStuckPoint: '已进入线面角的三角函数转换，但余角关系与 sin/cos 的选择还需要核对。'
  };
  if (/坐标|建系|建立/.test(answer)) return {
    status: 'evidence_based', evidence: answer,
    likelyStuckPoint: '把空间关系转成坐标与向量表达的起步方法还不稳定。'
  };
  return {status: 'evidence_based', evidence: answer, likelyStuckPoint: '已记录这段作答；它还不足以可靠定位到更细的错因。'};
}

/**
 * A deterministic completeness audit for the exact model currently exposed by
 * the product. It deliberately separates facts seen in the question from
 * values the solver needs, so the UI never asks a student for facts that are
 * already present or merely guessed by a prompt.
 *
 * Per-body modeling conditions (what the model truly needs):
 *   regular_quad_pyramid (template)  -> baseEdge + height
 *   cube / regular_tetrahedron       -> edge（纯角度问题与尺度无关，可省略）
 *   cuboid                           -> length + width + height
 *   quadrangular/triangular pyramid  -> base dimension + height
 *   prism                            -> base dimension + height
 *   right cylinder / right cone      -> radius + height（圆锥可由母线+半径导出高）
 *   sphere                           -> radius（截面问题还需球心到截平面的距离）
 */
export function auditSolidGeometryModelInput({questionText, studentAnswer = '', source = 'text'} = {}) {
  const text = normalized(questionText);
  const exactBody = has(text, /正四棱锥\s*P\s*[-—–]?\s*ABCD/i);
  const bodyType = [
    ['cube', /正方体/i], ['cuboid', /长方体/i], ['regular_tetrahedron', /正四面体/i],
    ['triangular_pyramid', /三棱锥|四面体/i], ['quadrangular_pyramid', /四棱锥/i],
    ['prism', /(?:直)?(?:三|四|五|六)?棱柱/i], ['cylinder', /圆柱/i],
    ['cone', /圆锥/i], ['sphere', /球(?:体|面)?/i]
  ].find(([, pattern]) => pattern.test(text))?.[0] || null;
  const body = Boolean(exactBody || bodyType);
  const circular = ['cylinder', 'cone', 'sphere'].includes(bodyType);
  // 圆体没有顶点概念：写出几何体名称即满足拓扑要求，不需要顶点对应关系。
  const indexedVertexRun='[A-Z][A-Z0-9_₀-₉]*';
  const namedPolyhedron=new RegExp(`(?:直)?(?:三|四|五|六)?(?:棱柱|棱锥)\\s*${indexedVertexRun}(?:${indexedVertexRun})*\\s*[-—–]\\s*${indexedVertexRun}(?:${indexedVertexRun})*`,'i');
  const topologyComplete = exactBody || (circular
    ? body
    : has(text, /(?:正方体|长方体)\s*[A-Z]{4}\s*(?:[-—–]\s*)?[A-Z0-9₀-₉_]{4,}|(?:正四面体|四面体|三棱锥)\s*[A-Z]{4}/i) || namedPolyhedron.test(text));
  const midpoint = has(text, /E\s*(?:为|是)\s*PC\s*(?:的)?中点/i);
  const line = has(text, /BE/i);
  const plane = has(text, /平面\s*PAC/i);
  const sine = has(text, /(?:线面角|所成角|夹角).*?(?:正弦|sin)|(?:正弦|sin).*?(?:线面角|所成角|夹角)/i);
  const exactTargetRecognized = line && plane && sine;
  const targetRecognized = exactTargetRecognized
    || has(text, /(?:求|计算|确定)\s*(?:线段|直线)?\s*[A-Z0-9]{1,2}与\s*[A-Z0-9]{1,2}\s*所成角(?:的)?(?:正弦|余弦|正切)?/i)
    || has(text, /(?:求|计算|确定)[^。；]{0,120}(?:直线\s*[A-Z0-9]+[^。；]{0,40}平面\s*[A-Z0-9]+|点\s*[A-Z0-9]+[^。；]{0,40}平面\s*[A-Z0-9]+|二面角|异面直线[^。；]{0,30}(?:角|夹角)|截面|外接球|内切球|轨迹|存在性|最值|体积|表面积)|证明[^。；]{0,100}(?:平行|垂直)|建立空间直角坐标系/i);
  const templateRecognized = exactBody && midpoint && exactTargetRecognized;
  // 纯角度类问题与整体尺度无关：正方体/正四面体的角度不随棱长变化。
  const angleQueryOnly = has(text, /线面角|二面角|异面直线|所成角|夹角/i) && !has(text, /体积|表面积|截面圆|外接球|内切球|轨迹|最值|周长|长度/i);

  // ---- 尺寸抽取（表达式级，如 6 / 2√3 / 3/2 / 6.5；兼容 AB=4、PO=3 线段式） ----
  const basePatterns = [
    new RegExp(`(?:底面(?:正方形)?(?:的)?(?:边长|棱长)|底面边长|底边|底面\\s*(?:为|是)?\\s*正方形)\\s*(?:为|是|=)?\\s*${DIM}`, 'i'),
    new RegExp(`(?<![A-Z0-9₀-₉_∠])[A-D][A-D0-9₀-₉_]?\\s*=\\s*${DIM}`, 'i') // AB=4，但不从 ∠ACB=90° 中截取 CB=90
  ];
  const heightPatterns = [
    new RegExp(`(?:棱锥|棱柱)?(?:的)?高\\s*(?:为|是|=)?\\s*${DIM}`, 'i'),
    new RegExp(`P[OHFG]\\s*=\\s*${DIM}`, 'i') // PO=3、PH=3
  ];
  const baseExpression = firstDimensionExpression(text, basePatterns);
  const heightExpression = firstExpression(text, heightPatterns);
  const baseEdge = integerValue(baseExpression);
  const height = integerValue(heightExpression);

  const edgeExpression = (bodyType === 'cube' || bodyType === 'regular_tetrahedron')
    ? firstDimensionExpression(text, [
        new RegExp(`(?:棱长|边长)\\s*(?:为|是|=)?\\s*${DIM}`, 'i'),
        new RegExp(`(?<![A-Z0-9₀-₉_∠])[A-Z][A-Z0-9₀-₉_]?\\s*=\\s*${DIM}`, 'i') // AB=2
      ])
    : null;

  let cuboidExpressions = null;
  if (bodyType === 'cuboid') {
    const trio = text.match(/(?:长|宽|高)[、，和及]{0,3}(?:宽|高)[、，和及]{0,3}高?\s*(?:分别)?(?:为|是|=)\s*(\d+(?:\.\d+)?)[、，]\s*(\d+(?:\.\d+)?)[、，]\s*(\d+(?:\.\d+)?)/i);
    if (trio) {
      cuboidExpressions = [trio[1], trio[2], trio[3]];
    } else {
      cuboidExpressions = [
        firstExpression(text, [new RegExp(`长\\s*(?:为|是|=)?\\s*${DIM}`, 'i')]),
        firstExpression(text, [new RegExp(`宽\\s*(?:为|是|=)?\\s*${DIM}`, 'i')]),
        firstExpression(text, [new RegExp(`高\\s*(?:为|是|=)?\\s*${DIM}`, 'i')])
      ];
    }
  }

  const radiusExpression = circular ? firstExpression(text, [
    new RegExp(`(?:底面|球)?半径\\s*(?:为|是|=)?\\s*${DIM}`, 'i'),
    new RegExp(`(?:底面|球)?直径\\s*(?:为|是|=)?\\s*${DIM}`, 'i'), // 直径即半径信息
    new RegExp(`[rR]\\s*=\\s*${DIM}`, 'i')
  ]) : null;
  const heightExpressionCircular = circular ? firstExpression(text, [
    new RegExp(`(?:圆柱|圆锥)?高\\s*(?:为|是|=)?\\s*${DIM}`, 'i'),
    new RegExp(`[hH]\\s*=\\s*${DIM}`, 'i')
  ]) : null;
  const slantHeightExpression = bodyType === 'cone' ? firstExpression(text, [new RegExp(`母线\\s*(?:为|是|=)?\\s*${DIM}`, 'i')]) : null;
  const planeDistanceExpression = bodyType === 'sphere' ? firstExpression(text, [new RegExp(`球心到(?:截平面|截面(?:所在)?平面|这个平面|该平面|平面)的?距离\\s*(?:为|是|=)?\\s*${DIM}`, 'i')]) : null;
  const sectionDiameterExpression = bodyType === 'sphere' ? firstExpression(text, [new RegExp(`(?:截|截得|得到)[^，。；]{0,24}直径\\s*(?:为|是|=)?\\s*${DIM}`, 'i')]) : null;
  const sectionRadiusExpression = bodyType === 'sphere' ? firstExpression(text, [new RegExp(`(?:截面圆|圆面)(?:的)?半径\\s*(?:为|是|=)?\\s*${DIM}`, 'i')]) : null;
  const sphereRadiusDerivable = Boolean(planeDistanceExpression && (sectionRadiusExpression || sectionDiameterExpression));

  const missingItems = [];

  if (!text && source === 'image') {
    missingItems.push({id: 'readable-question', label: '题干或图形中的可读信息', whyNeeded: '当前图片尚未被可靠读取，系统不能把图片猜成空间模型。', prompt: '请补充题干文字，或写出几何体名称、顶点标注、已知尺寸与所求。'});
  } else if (!body || !topologyComplete) {
    missingItems.push({id: 'solid-topology', label: '几何体名称与顶点对应关系', whyNeeded: '需要确定哪个点是顶点、哪几个点构成底面，才能建立坐标与连线。', prompt: '请补充类似“正四棱锥 P-ABCD（P 为顶点，ABCD 为底面）”的信息。'});
  }
  if (exactBody && !midpoint) {
    missingItems.push({id: 'special-point-relation', label: '特殊点 E 与 PC 的关系', whyNeeded: '当前题型中的 BE 取决于 E 在 PC 上的具体位置。', prompt: '请补充 E 是否为 PC 的中点；若不是，请写明分点比或位置关系。'});
  }
  if (text && !targetRecognized) {
    missingItems.push({id: 'target-relation', label: '所求的线、平面与量', whyNeeded: '模型必须知道要计算哪条线与哪个平面的什么关系。', prompt: '请补充所求，例如“求 BE 与平面 PAC 所成角的正弦值”。'});
  }

  // ---- 按几何体补齐真正缺失的建模条件 ----
  if (templateRecognized) {
    if (!baseExpression) missingItems.push({id: 'base-edge', label: '底面边长的数值', whyNeeded: '精确坐标模型需要底面正方形的实际尺度，不能从图形比例猜测。', prompt: '请补充底面边长（或底面正方形的边长，例如 AB=4）。'});
    if (!heightExpression) missingItems.push({id: 'pyramid-height', label: '棱锥的垂直高', whyNeeded: '顶点到基准底面的垂直距离决定空间比例，不能由示意图推断。', prompt: '请补充正四棱锥的高是多少（顶点到底面所在平面的垂直距离，例如 PO=3）。'});
  } else if (bodyType === 'cube' || bodyType === 'regular_tetrahedron') {
    if (!edgeExpression && !angleQueryOnly) missingItems.push({id: 'edge-length', label: bodyType === 'cube' ? '正方体的棱长' : '正四面体的棱长', whyNeeded: '建系需要真实尺度；纯角度问题与大小无关，但体积、表面积或长度问题必须有棱长。', prompt: '请补充棱长（或任意一条边的边长，例如 AB=2）。'});
  } else if (bodyType === 'cuboid') {
    if (!cuboidExpressions.every(Boolean)) missingItems.push({id: 'cuboid-dimensions', label: '长方体的长、宽、高', whyNeeded: '长方体三个方向的尺寸决定空间比例与坐标。', prompt: '请补充长方体的长、宽、高（例如：长为 4，宽为 3，高为 2）。'});
  } else if (bodyType === 'cylinder') {
    if (!radiusExpression) missingItems.push({id: 'cylinder-radius', label: '圆柱的底面半径', whyNeeded: '底面半径决定柱体尺度与截面关系。', prompt: '请补充底面半径（或底面直径）。'});
    if (!heightExpressionCircular) missingItems.push({id: 'cylinder-height', label: '圆柱的高', whyNeeded: '两底面间的垂直距离决定柱体高度。', prompt: '请补充圆柱的高是多少。'});
  } else if (bodyType === 'cone') {
    const heightDerivable = Boolean(heightExpressionCircular) || (Boolean(radiusExpression) && Boolean(slantHeightExpression));
    if (!radiusExpression) missingItems.push({id: 'cone-radius', label: '圆锥的底面半径', whyNeeded: '底面半径决定锥体尺度与截面关系。', prompt: '请补充底面半径（或底面直径）。'});
    if (!heightDerivable) missingItems.push({id: 'cone-height', label: '圆锥的高', whyNeeded: '顶点到底面的垂直距离决定锥体比例；已知母线长与半径时高可由 l²=r²+h² 导出。', prompt: '请补充圆锥的高，或补充母线长（已知半径时）。'});
  } else if (bodyType === 'sphere') {
    if (!radiusExpression && !sphereRadiusDerivable) missingItems.push({id: 'sphere-radius', label: '球的半径', whyNeeded: '球模型需要真实半径尺度；若已知截面圆尺寸和球心到截平面的距离，系统可以自动反推。', prompt: '请补充球的半径（或直径），或者同时给出截面圆尺寸和球心到截平面的距离。'});
    const sectionQuery = has(text, /截面|截得/);
    if (sectionQuery && !has(text, /过球心|大圆/) && !planeDistanceExpression) missingItems.push({id: 'sphere-section-distance', label: '球心到截平面的距离', whyNeeded: '截面圆半径由球半径与球心到截平面的距离共同确定。', prompt: '请补充球心到截平面的距离；若截面过球心，请明确写“过球心”。'});
  }
  // 一般棱锥/棱柱/四面体（非模板）只以拓扑与所求判定完整性：
  // 这类结构内核尚未覆盖，信息完整时如实返回“引擎未覆盖”，不再追加尺寸要求。

  const likelyAssessment = exactTargetRecognized
    ? '线面角的正弦值：用直线方向向量与平面法向量建立夹角关系，再判断余角与 sin/cos。'
    : circular
      ? '圆柱、圆锥或球的体积、表面积与截面问题：由半径、高（或球心到截面的距离）建立精确模型。'
      : body ? '空间几何中把几何关系坐标化，并确定所求对象。' : '需先识别几何体与所求关系，才能判断具体考点。';
  const ready = templateRecognized && baseEdge && height && missingItems.length === 0;
  const informationComplete = topologyComplete && targetRecognized && missingItems.length === 0;
  const status = ready ? 'ready' : informationComplete ? 'unsupported' : 'needs_more_context';
  return {
    status,
    informationComplete,
    auditVersion: 'solid-geometry-constraint-audit/v2',
    facts: {
      body, bodyType: exactBody ? 'regular_quad_pyramid' : bodyType, topologyComplete,
      midpointPC: midpoint, lineBE: line, planePAC: plane, linePlaneAngleSine: sine,
      baseEdge, height, baseExpression: baseExpression || null, heightExpression: heightExpression || null,
      edgeExpression: edgeExpression || null, cuboidExpressions, radiusExpression: radiusExpression || null,
      heightExpressionCircular: heightExpressionCircular || null, slantHeightExpression: slantHeightExpression || null,
      planeDistanceExpression: planeDistanceExpression || null,
      sectionDiameterExpression: sectionDiameterExpression || null,
      sectionRadiusExpression: sectionRadiusExpression || null,
      sphereRadiusDerivable,
      angleQueryOnly
    },
    modelCapability: {
      templateId: 'regular-quad-pyramid-be-pac',
      recognized: templateRecognized,
      ready,
      supportedBodiesInKernel: ['regular_quad_pyramid', 'right_cylinder', 'right_cone', 'sphere'],
      perBodyModelingConditions: {
        regular_quad_pyramid: ['baseEdge', 'height'],
        right_cylinder: ['radius', 'height'],
        right_cone: ['radius', 'height(母线+半径可导出)'],
        sphere: ['radius', 'planeDistance(截面问题)'],
        cube: ['edge(纯角度问题可省略)'],
        regular_tetrahedron: ['edge(纯角度问题可省略)'],
        cuboid: ['length', 'width', 'height']
      }
    },
    learningDiagnosis: {
      likelyAssessment,
      likelyKnowledgePoints: exactTargetRecognized ? ['空间向量', '平面法向量', '线面角与余角关系', '三角函数关系'] : body ? ['空间几何关系识别', '空间向量或几何证明'] : ['空间几何关系识别'],
      errorInference: errorEvidence(studentAnswer)
    },
    missingItems,
    nextAction: ready ? '约束完整：可进入精确求解与三维模型生成。' : informationComplete ? '题目信息已经足够；失败原因是当前模型生成器尚未覆盖该结构，不是学生漏拍。' : '只需补充面板中列出的信息；原题会被保留并重新审查。'
  };
}
