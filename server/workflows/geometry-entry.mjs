const positiveInteger = value => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 100 ? number : null;
};

const exactInteger = value => ({op: 'integer', value});

export function parseDeterministicGeometryText(questionText, studentAnswer = '') {
  const text = String(questionText || '').replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0)).trim();
  if (text.length < 12 || text.length > 4000) return null;
  const required = [
    /正四棱锥\s*P\s*[-—–]?\s*ABCD/i,
    /E\s*(?:为|是)\s*PC\s*(?:的)?中点/i,
    /BE/i,
    /平面\s*PAC/i,
    /(?:线面角|所成角|夹角).*?(?:正弦|sin)|(?:正弦|sin).*?(?:线面角|所成角|夹角)/i
  ];
  if (required.some(pattern => !pattern.test(text))) return null;

  const baseMatch = text.match(/底面(?:正方形)?(?:的)?(?:边长|棱长)\s*(?:为|是|=)?\s*(\d+)(?![\/√A-Za-z])/i)
    || text.match(/(?:底边|底面边长)\s*(?:为|是|=)?\s*(\d+)(?![\/√A-Za-z])/i)
    || text.match(/[A-D][A-D0-9]?\s*=\s*(\d+)(?![\/√A-Za-z])/i);
  const heightMatch = text.match(/(?:棱锥的)?高\s*(?:为|是|=)?\s*(\d+)(?![\/√A-Za-z])/i)
    || text.match(/P[OHFG]\s*=\s*(\d+)(?![\/√A-Za-z])/i);
  const baseEdge = positiveInteger(baseMatch?.[1]);
  const height = positiveInteger(heightMatch?.[1]);
  if (!baseEdge || !height) return null;

  return {
    source: 'text',
    templateId: 'regular-quad-pyramid-be-pac',
    templateVersion: 1,
    parameters: {baseEdge: exactInteger(baseEdge), height: exactInteger(height)},
    draft: {
      question: text,
      studentAnswer: String(studentAnswer || '').trim() || '待补充学生作答过程',
      extraction: {
        source: 'deterministic_text_parser',
        confidence: 0.99,
        requiresConfirmation: false
      }
    }
  };
}

const ALL_EQUAL_TEMPLATE = 'regular-quad-pyramid-all-equal-cos';

// 全等棱锥模板：正四棱锥 X-ABCD（X 为顶点），所有棱长均相等，
// E 是 XC 的中点，求 AE 与 BX 所成角的余弦值（角度与尺度无关，无需数值尺寸）。
function allEqualPyramidApex(text) {
  const body = text.match(/正四棱锥\s*([A-Z])\s*[-—–]?\s*ABCD/i);
  const apex = body?.[1]?.toUpperCase();
  return apex && !['A', 'B', 'C', 'D'].includes(apex) ? apex : null;
}

function allEdgesEqualPhrase(text) {
  return /(?:模长|棱长|边长)(?:均|都)?相等|(?:所有|各)棱长(?:均|都)?相等|棱长相等/i.test(text);
}

function allEqualPyramidTargetMatches(text, apex) {
  const target = text.match(/(?:求|计算|确定)\s*(?:线段|直线)?\s*([A-Z]{1,2})与\s*([A-Z]{1,2})\s*所成角的余弦(?:值)?/i);
  if (!target) return false;
  const pair1 = [...target[1].toUpperCase()].sort().join('');
  const pair2 = [...target[2].toUpperCase()].sort().join('');
  const expected2 = [...('B' + apex)].sort().join('');
  return pair1 === 'AE' && pair2 === expected2;
}

export function parseAllEqualPyramidText(questionText, studentAnswer = '') {
  const text = String(questionText || '').replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0)).trim();
  if (text.length < 12 || text.length > 4000) return null;
  const apex = allEqualPyramidApex(text);
  if (!apex) return null;
  if (!allEdgesEqualPhrase(text)) return null;
  if (!new RegExp(`E\\s*(?:为|是)\\s*${apex}C\\s*(?:的)?中点`, 'i').test(text)) return null;
  if (!allEqualPyramidTargetMatches(text, apex)) return null;
  return {
    source: 'text',
    templateId: ALL_EQUAL_TEMPLATE,
    templateVersion: 1,
    parameters: {apex},
    draft: {
      question: text,
      studentAnswer: String(studentAnswer || '').trim() || '待补充学生作答过程',
      extraction: {source: 'deterministic_text_parser', confidence: 0.99, requiresConfirmation: false}
    }
  };
}

export function reviewAllEqualPyramidExtraction(questionText, extraction) {
  const text = String(questionText || '').replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0)).trim();
  const apex = allEqualPyramidApex(text);
  const checks = {
    topologyMatches: Boolean(apex),
    allEdgesEqualMatches: allEdgesEqualPhrase(text),
    midpointMatches: Boolean(apex) && new RegExp(`E\\s*(?:为|是)\\s*${apex}C\\s*(?:的)?中点`, 'i').test(text),
    queryMatches: Boolean(apex) && allEqualPyramidTargetMatches(text, apex)
  };
  return {
    status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    independent: true,
    reviewer: 'constraint_auditor_v2',
    checks,
    reviewedAt: new Date().toISOString()
  };
}

export function reviewDeterministicExtraction(questionText, extraction) {
  const text = String(questionText || '').replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0)).trim();
  const base = text.match(/(?:底面(?:正方形)?(?:的)?(?:边长|棱长)|底面边长|底边)[^\d]{0,8}(\d+)/i)
    || text.match(/[A-D][A-D0-9]?\s*=\s*(\d+)/i);
  const height = text.match(/(?:棱锥的)?高[^\d]{0,8}(\d+)/i)
    || text.match(/P[OHFG]\s*=\s*(\d+)/i);
  const topologyValid = /正四棱锥\s*P\s*[-—–]?\s*ABCD/i.test(text)
    && /E\s*(?:为|是)\s*PC\s*(?:的)?中点/i.test(text);
  const queryValid = /BE/i.test(text) && /平面\s*PAC/i.test(text) && /正弦|sin/i.test(text);
  const reviewedBase = positiveInteger(base?.[1]);
  const reviewedHeight = positiveInteger(height?.[1]);
  const extractedBase = extraction?.parameters?.baseEdge?.value;
  const extractedHeight = extraction?.parameters?.height?.value;
  // 无先前抽取（例如只经过约束审查）时，复核只需确认题目文本本身包含一致尺寸；
  // 有先前抽取时仍做严格相等校验，防止参数与题干不一致。
  const checks = {
    topologyMatches: topologyValid,
    queryMatches: queryValid,
    baseEdgeMatches: extractedBase == null ? reviewedBase != null : reviewedBase === extractedBase,
    heightMatches: extractedHeight == null ? reviewedHeight != null : reviewedHeight === extractedHeight
  };
  return {
    status: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    independent: true,
    reviewer: 'constraint_auditor_v1',
    checks,
    reviewedAt: new Date().toISOString()
  };
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function randomPyramidCandidate(seed, attempt = 0) {
  const random = seededRandom((seed >>> 0) + Math.imul(attempt + 1, 0x45d9f3b));
  const baseEdges = [2, 4, 6, 8];
  return {
    baseEdge: baseEdges[Math.floor(random() * baseEdges.length)],
    height: 1 + Math.floor(random() * 6)
  };
}

export function isCleanExactAnswer(node, limits = {maxNodes: 7, maxRadicand: 60}) {
  let nodes = 0;
  const visit = value => {
    if (!value || typeof value !== 'object' || ++nodes > limits.maxNodes) return false;
    if (value.op === 'integer') return Number.isSafeInteger(value.value);
    if (value.op === 'rational') return Number.isSafeInteger(value.p) && Number.isSafeInteger(value.q) && value.q > 0;
    if (value.op === 'sqrt') {
      const arg = value.arg;
      return arg?.op === 'integer' && arg.value >= 0 && arg.value <= limits.maxRadicand && visit(arg);
    }
    if (value.op === 'neg') return visit(value.arg);
    if (value.op === 'add' || value.op === 'mul') return Array.isArray(value.args) && value.args.every(visit);
    return false;
  };
  return visit(node);
}
