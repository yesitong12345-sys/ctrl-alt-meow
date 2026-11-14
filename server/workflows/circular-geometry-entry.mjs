const normalize = value => String(value || '')
  .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0))
  // Math-mode delimiters are presentation syntax, not part of a quantity.
  // Removing only the delimiters keeps the exact integer/root/fraction text intact.
  .replace(/\$|\\\(|\\\)|\\\[|\\\]/g, '')
  .replace(/π/g, 'π')
  .replace(/\s+/g, '')
  .trim();

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

const integer = value => ({op: 'integer', value: Number(value)});

// 把“6”“3.5”这类字面量转成精确节点：整数用 integer，有限小数用 rational。
const numberNode = value => {
  const n = Number(value);
  if (Number.isSafeInteger(n)) return {op: 'integer', value: n};
  if (Number.isFinite(n)) {
    const decimal = String(value);
    const dot = decimal.indexOf('.');
    if (dot > 0) {
      const q = 10 ** (decimal.length - dot - 1);
      const p = Math.round(n * q);
      const g = gcd(p, q);
      return {op: 'rational', p: p / g, q: q / g};
    }
  }
  return {op: 'integer', value: n};
};

const halfNode = node => {
  if (node.op === 'integer') return node.value % 2 === 0 ? {op: 'integer', value: node.value / 2} : {op: 'rational', p: node.value, q: 2};
  if (node.op === 'rational') return {op: 'rational', p: node.p, q: node.q * 2};
  return node;
};

// 母线 l 与半径 r 已知时，高 h = √(l² − r²)
const coneHeightFromSlantAndRadius = (slant, radius) => ({
  op: 'sqrt',
  arg: {op: 'add', args: [{op: 'mul', args: [slant, slant]}, {op: 'neg', arg: {op: 'mul', args: [radius, radius]}}]}
});

const sphereRadiusFromSection = (sectionRadius, planeDistance) => {
  if (sectionRadius?.op === 'integer' && planeDistance?.op === 'integer') {
    const square = sectionRadius.value ** 2 + planeDistance.value ** 2;
    const root = Math.sqrt(square);
    if (Number.isSafeInteger(root)) return integer(root);
  }
  return {
    op: 'sqrt',
    arg: {op: 'add', args: [
      {op: 'mul', args: [sectionRadius, sectionRadius]},
      {op: 'mul', args: [planeDistance, planeDistance]}
    ]}
  };
};

function namedLength(text, names) {
  for (const name of names) {
    const match = text.match(new RegExp(`${name}(?:为|是|=)?(\\d+(?:\\.\\d+)?)(?![\\d./√])`, 'i'));
    if (match) return numberNode(match[1]);
  }
  return null;
}

function candidateLength(candidate, names) {
  const quantities = candidate && typeof candidate === 'object' ? candidate.quantities : null;
  if (!quantities || typeof quantities !== 'object') return null;
  for (const name of names) {
    const item = quantities[name];
    const raw = item && typeof item === 'object' ? item.value : item;
    const confidence = item && typeof item === 'object' ? Number(item.confidence) : 1;
    // 候选数值必须带有足够置信度；几何求解器仍会独立验证其相互关系。
    if (Number.isFinite(Number(raw)) && Number(raw) > 0 && confidence >= 0.7) return numberNode(raw);
  }
  return null;
}

const candidateBodyType = candidate => String(candidate?.bodyType || candidate?.body?.type || '').trim();

export function parseCircularGeometryText(questionText, studentAnswer = '', candidate = null) {
  const text = normalize(questionText);
  const bodyHint = candidateBodyType(candidate);
  if (!text && !bodyHint) return null;
  const sectionDiameterMatch = text.match(/(?:截|截得|得到)[^，。；]{0,24}直径(?:为|是|=)?(\d+(?:\.\d+)?)/i);
  const sectionRadiusMatch = text.match(/(?:截面圆|圆面)(?:的)?半径(?:为|是|=)?(\d+(?:\.\d+)?)/i);
  const sectionRadius = candidateLength(candidate, ['sectionRadius'])
    || (sectionRadiusMatch ? numberNode(sectionRadiusMatch[1]) : null)
    || (sectionDiameterMatch ? halfNode(numberNode(sectionDiameterMatch[1])) : null);
  let radius = candidateLength(candidate, ['radius', 'baseRadius', 'sphereRadius']) || namedLength(text, ['底面半径', '球半径']);
  if (!radius && (/圆柱|圆锥/.test(text) || bodyHint === 'right_cylinder' || bodyHint === 'right_cone')) radius = namedLength(text, ['半径', 'r']);
  if (!radius && (/球/.test(text) || bodyHint === 'sphere') && !sectionRadiusMatch && !sectionDiameterMatch) radius = namedLength(text, ['半径', 'r']);
  if (!radius) {
    // 直径也是半径信息：半径 = 直径 ÷ 2
    // 但“平面截球得到直径为 6 的圆”中的直径属于截面圆，不能误作球直径。
    const diameter = candidateLength(candidate, ['diameter', 'baseDiameter', 'sphereDiameter'])
      || namedLength(text, ['底面直径', '球直径'])
      || (!sectionDiameterMatch ? namedLength(text, ['直径']) : null);
    if (diameter) radius = halfNode(diameter);
  }
  const height = candidateLength(candidate, ['height', 'axisHeight']) || namedLength(text, ['圆柱高', '圆锥高', '高', 'h']);
  const slant = candidateLength(candidate, ['slant', 'slantHeight']) || namedLength(text, ['母线', 'l']);
  const planeDistance = candidateLength(candidate, ['planeDistance', 'centerToPlaneDistance', 'centerToSectionPlaneDistance']) || namedLength(text, [
    '球心到截平面的距离', '球心到截面所在平面的距离', '球心到截面平面的距离',
    '截平面到球心的距离', '截面所在平面到球心的距离', '球心到截面距离',
    '球心到这个平面的距离', '球心到该平面的距离', '球心到平面的距离', '截面距离', 'OH', 'd'
  ]);
  const common = {
    schemaVersion: 'geometry-ir/v2',
    problem: {language: 'zh-CN', questionText: String(questionText || '').trim()},
    studentAnswer: String(studentAnswer || '').trim() || '待补充学生作答过程',
    // AI 可以提出辅助构造；它们在求解器通过后才会作为教学步骤展示。
    constructionCandidates: Array.isArray(candidate?.constructions) ? candidate.constructions.slice(0, 12) : []
  };
  if (/圆柱/.test(text) || bodyHint === 'right_cylinder') {
    if (!radius || !height) return {status: 'needs_more_context', bodyType: 'right_cylinder', missing: [!radius && '圆柱半径', !height && '圆柱高'].filter(Boolean)};
    if (/圆柱被分成两部分|较大部分.*体积|较小部分.*体积|弦(?:[A-Z]{2})?.*圆心角|圆心角.*弦(?:[A-Z]{2})?/.test(text)) {
      return {status: 'unsupported', bodyType: 'right_cylinder', message: '已识别“圆柱被过底面弦的竖直平面截分，求两部分体积”题型。它不能按整个圆柱体积计算；当前正在补充圆弓形面积 × 高的精确求解与截面场景，暂不生成错误答案。'};
    }
    const query = /轴截面|过轴截面/.test(text) ? {type: 'axis_section'}
      : /平行(?:于)?底面[^。；]*截面|截面[^。；]*平行(?:于)?底面/.test(text) ? {type: 'parallel_base_section'}
        : /体积|表面积/.test(text) ? {type: 'volume_and_surface_area'} : null;
    if (!query) return {status: 'unsupported', bodyType: 'right_cylinder', message: '已识别圆柱，但当前只支持体积/表面积、轴截面或平行底面的圆截面；不会把其他截法误算成公式题。'};
    return {...common, body: {type: 'right_cylinder', axis: 'z'}, parameters: {radius, height}, query};
  }
  if (/圆锥/.test(text) || bodyHint === 'right_cone') {
    // 高可由母线长与半径导出（l² = r² + h²），此时不算缺失建模条件。
    const heightOrDerived = height || (radius && slant ? coneHeightFromSlantAndRadius(slant, radius) : null);
    if (!radius || !heightOrDerived) return {status: 'needs_more_context', bodyType: 'right_cone', missing: [!radius && '圆锥底面半径', !heightOrDerived && '圆锥高'].filter(Boolean)};
    const query = /轴截面|过轴截面/.test(text) ? {type: 'axis_section'} : /体积|表面积|母线/.test(text) ? {type: 'volume_and_surface_area'} : null;
    if (!query) return {status: 'unsupported', bodyType: 'right_cone', message: '已识别圆锥，但当前只支持体积/表面积/母线或轴截面；不会把其他截法误算成公式题。'};
    return {...common, body: {type: 'right_cone', axis: 'z'}, parameters: {radius, height: heightOrDerived}, query};
  }
  if (/球/.test(text) || bodyHint === 'sphere') {
    if (!radius && sectionRadius && planeDistance) radius = sphereRadiusFromSection(sectionRadius, planeDistance);
    if (!radius) return {status: 'needs_more_context', bodyType: 'sphere', missing: ['球半径']};
    if (/截面|截得|平面/.test(text) || candidate?.query === 'section_circle' || candidate?.section?.kind === 'plane_section') {
      const sectionDistance = /过球心|大圆/.test(text) || candidate?.section?.throughCenter === true ? integer(0) : planeDistance;
      if (!sectionDistance) return {status: 'needs_more_context', bodyType: 'sphere', missing: ['球心到截平面的距离（若截面过球心，请明确写“过球心”）']};
      return {...common, body: {type: 'sphere', axis: 'z'}, parameters: {radius, planeDistance: sectionDistance}, query: {type: 'section_circle'}};
    }
    if (!/体积|表面积/.test(text)) return {status: 'unsupported', bodyType: 'sphere', message: '已识别球，但当前只支持体积/表面积和由球心到截平面距离确定的圆截面。'};
    return {...common, body: {type: 'sphere', axis: 'z'}, parameters: {radius}, query: {type: 'volume_and_surface_area'}};
  }
  return null;
}
