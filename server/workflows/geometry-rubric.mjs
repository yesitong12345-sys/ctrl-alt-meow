/* 本题得分点的真实推导。
 *
 * 这里的得分点全部来自这道题自己的几何编译结果，不靠题型名匹配模板：
 *   1. solutionOutline              真实解题步骤（每步自带真实数值，如 r=√16=4）
 *   2. geometryIR.queries           题目实际所问的量（quote/statement 作描述，answer 作判定依据）
 *   3. geometryResult.derivation    结构化事实骨架（stepId + factCodes）
 *   4. knowledgePoints + correctAnswer + question   最小可用兜底
 *
 * 导出：
 *   buildGeometryRubric(caseData) -> {parts, steps, source}
 *   tutorGeometryContext(caseData) -> 供 tutor-session 上下文使用的精简几何编译数据
 *
 * steps 的每一项都满足 tutor-session 的既有契约：
 *   {id, goal, knownResult, understanding, explanation, detect(text), nextQuestion, followUpQuestion}
 * parts 的每一项是 {id, label, hint, steps: [stepId...]}。
 *
 * 命名与取值规则（避免“求1”“法向量当成正弦值”这类张冠李戴）：
 *   - 先判步骤类型：几何关系结论 → 证明类（不生成数值型结论）；
 *     坐标系/原点 → 建立；法向量/方向向量 → 构造/写出；距离/角度/参数 → 求。
 *   - 一步里有多个候选量时，先把每个“有名有值”的候选抽出来，
 *     再按量名术语（正弦/面积/距离…）、符号与向量/标量类型挑出与 object 匹配的那个。
 *   - 关键量提取失败时不再退化成数字标签：至少用结论关系或量名术语命名。
 */

const OUTLINE_LIMIT = 14;
const QUERY_LIMIT = 10;
const DERIVATION_LIMIT = 16;
const HINT_LIMIT = 96;

/* 中文几何词表：只用于识别“这一步在算什么”，不是题型模板。 */
const TERM_LIBRARY = [
  '体积公式', '表面积公式', '勾股定理', '余弦定理', '正弦定理', '判定定理', '性质定理',
  '外接球', '内切球', '正三角形', '正六边形', '正四面体', '正四棱锥', '正三棱柱', '正六棱柱',
  '体对角线', '截面圆', '球半径', '球心', '侧面积', '表面积', '底面积', '法向量', '方向向量',
  '线面角', '二面角', '坐标系', '对角线', '斜高', '中点', '原点', '坐标', '向量', '内积',
  '数量积', '点积', '叉积', '模长', '夹角', '正弦', '余弦', '正切', '投影', '射影', '半径',
  '方向', '法向',
  '直径', '周长', '距离', '长度', '面积', '体积', '侧棱', '棱长', '边长', '高', '底面',
  '截面', '三角形', '垂直', '平行', '证明', '相似', '全等', '圆心', '中心',
  '平面', '直线', '棱柱', '棱锥', '圆锥', '圆柱', '球体',
].sort((left, right) => right.length - left.length);

/* 英文事实码 → 中文术语，用于 derivation 兜底时理解 factCodes。 */
const ENGLISH_TERMS = {
  sphere: '球', center: '球心', circle: '圆', radius: '半径', plane: '平面', section: '截面',
  pythagoras: '勾股定理', cylinder: '圆柱', cone: '圆锥', axis: '轴', frame: '坐标系',
  volume: '体积', surface: '表面积', area: '面积', perpendicular: '垂直', base: '底面',
  dihedral: '二面角', line: '直线', direction: '方向向量', normal: '法向量', midpoint: '中点',
  coordinates: '坐标', coordinate: '坐标', segment: '线段', angle: '角', sine: '正弦',
  cosine: '余弦', height: '高', slant: '斜高', tetrahedron: '三棱锥', canonical: '标准',
  built: '建立', build: '建立', equal: '相等', edges: '棱', edge: '棱', root: '根号',
  intersection: '相交', distance: '距离', length: '长度', prism: '棱柱', pyramid: '棱锥',
};

/* 几何事实码 → 这一步真实在做的事。 */
const FACT_CODE_TEXT = {
  SPHERE_CENTER_RADIUS: '确定球心、球半径与球心到截面的距离',
  PLANE_SPHERE_INTERSECTION_CIRCLE: '把截平面与球的交线写成圆',
  SECTION_RADIUS_PYTHAGORAS: '用勾股定理求截面圆半径',
  CYLINDER_AXIS_FRAME: '确定圆柱轴线与底面半径',
  CYLINDER_VOLUME: '由底面积与高求圆柱体积',
  CYLINDER_SURFACE_AREA: '求圆柱的侧面积与表面积',
  CONE_AXIS_FRAME: '确定圆锥轴线、底面半径与高',
  SLANT_HEIGHT_PYTHAGORAS: '用勾股定理求圆锥母线长',
  CONE_VOLUME: '由底面积与高求圆锥体积',
  CONE_SURFACE_AREA: '求圆锥的侧面积与表面积',
  AO_PERP_BASE: '由射影关系得到 AO⊥底面',
  BO_PERP_CD: '得到 BO⊥CD',
  AB_PERP_CD: '证明 AB⊥CD',
  DIHEDRAL_BC_60: '把二面角 A-BC-D=60° 转成平面角',
  DIHEDRAL_CD_45: '把二面角 A-CD-B=45° 转成平面角',
  LINE_PLANE_SINE: '用方向向量与法向量求线面角的正弦',
  TETRAHEDRON_VOLUME: '由底面积与高求三棱锥体积',
  CANONICAL_FRAME_BUILT: '建立可计算的空间直角坐标系',
  ALL_EDGES_EQUAL_HEIGHT_A_OVER_ROOT2: '由各棱相等求棱锥的高',
  MIDPOINT_COORDINATES: '由端点坐标求中点坐标',
  SEGMENT_ANGLE_COSINE: '用向量内积求线段夹角的余弦值',
  LINE_DIRECTION_BE: '写出直线 BE 的方向向量',
  PLANE_NORMAL_PAC: '构造平面 PAC 的法向量',
};

/* 题目所问量 kind → 中文描述，仅用于 queries 没有原文描述时兜底。 */
const QUERY_KIND_LABELS = {
  volume: '体积', solid_volume: '体积', volume_and_surface_area: '体积与表面积',
  surface_area: '表面积', area: '面积', radius: '半径', length: '长度',
  segment_length: '线段长度', distance: '距离', angle: '角的大小',
  line_plane_angle: '线面角的正弦值', segment_angle_cosine: '夹角的余弦值',
  proof: '证明结论', prove_perpendicular: '垂直关系', vector_relation: '向量关系',
  section_circle: '截面圆的半径与面积', affine_point: '点的位置', point_on_segment: '线段上的点',
};

/* 常见小数与最简分数互认，避免学生写 0.5 而答案存的是 1/2。 */
const COMMON_FRACTIONS = {
  '0.5': '1/2', '0.25': '1/4', '0.75': '3/4', '0.2': '1/5', '0.4': '2/5',
  '0.6': '3/5', '0.8': '4/5', '0.125': '1/8', '0.375': '3/8', '0.625': '5/8',
  '0.875': '7/8', '0.1': '1/10', '0.3': '3/10', '0.7': '7/10', '0.9': '9/10',
};

const IDENTIFIER_STOPWORDS = new Set([
  'sin', 'cos', 'tan', 'cot', 'log', 'sqrt', 'frac', 'cdot', 'times', 'left', 'right',
  'quad', 'theta', 'pi', 'and', 'the', 'for', 'with', 'over', 'derived', 'fact', 'plane', 'line',
]);

const asArray = value => (Array.isArray(value) ? value : []);

/* ---------- 文本归一化 ---------- */

const rawText = value => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (value && typeof value === 'object') {
    for (const key of ['text', 'statement', 'content', 'outline', 'summary', 'title', 'displayPlain', 'quote', 'label']) {
      if (typeof value[key] === 'string' && value[key].trim()) return value[key];
    }
  }
  return '';
};

const cleanLine = value => rawText(value)
  .replace(/\s+/g, ' ')
  .replace(/^[\s（(【\[]*[0-9]{1,2}\s*[）)】\].、:：]\s*/, '')
  .trim();

const stripTail = value => String(value || '').replace(/[。；;，,、\s]+$/, '').trim();

/* 上下标统一成 ASCII：BCC₁B₁ → bcc1b1，a² → a^2，便于与学生输入互相比较。 */
const SUPERSCRIPT_DIGITS = {'⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9'};
const SUBSCRIPT_DIGITS = {'₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9'};
const normalizeScripts = value => String(value || '')
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, char => `^${SUPERSCRIPT_DIGITS[char]}`)
  .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, char => SUBSCRIPT_DIGITS[char]);

/* 数学表达归一：让 sqrt/√、\frac{a}{b}=a/b、pi/π、度/° 等写法可以互相比较。 */
const canonMath = value => normalizeScripts(value)
  .toLowerCase()
  .replace(/\\left|\\right|\\!|\\,|\\;|\\quad|\\displaystyle/g, '')
  .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
  .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
  .replace(/\\pi/g, 'π')
  .replace(/\\(?:cdot|times|div)/g, '*')
  .replace(/根号/g, '√')
  .replace(/sqrt/g, '√')
  .replace(/\bpi\b/g, 'π')
  .replace(/[×⋅·]/g, '*')
  .replace(/÷/g, '/')
  .replace(/度/g, '°')
  .replace(/[{}［］\[\]]/g, '')
  .replace(/["'“”‘’]/g, '')
  .replace(/[\s\u3000]/g, '')
  .replace(/[。；;，,]+$/, '')
  // 只去掉“单个原子”外面的括号，保留 (3+3-4) 这类真实分组。
  .replace(/\(([0-9a-zπ√°^.]*)\)/g, '$1');

/* 保留中文的紧凑文本：用于关键词、符号与数字判定。 */
const looseText = value => normalizeScripts(value).toLowerCase().replace(/[\s\u3000]/g, '');

const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasNumberToken = (text, number) => new RegExp(`(^|[^0-9.])${escapeRegExp(number)}(?![0-9])`).test(text);

/* ---------- 关键量与关键对象提取 ---------- */

const isPlainNumber = value => /^-?\d+(?:\.\d+)?$/.test(value);

/* 展示用的数值清洗：去掉中文尾注、空格和尾标点，保留原始大小写与符号。 */
const cleanValue = value => String(value || '')
  .replace(/[\u4e00-\u9fa5].*$/, '')
  .replace(/\s+/g, '')
  .replace(/[。；;，,、]+$/, '');

/* 能当成“这一步的最终结果”展示的值：数值、根式、π 表达式或坐标。 */
const isAnswerLike = value => /^[-+]?(?:\d|√|π|[（(]|\\?sqrt|根号)/i.test(String(value || ''));

const valueForms = value => {
  const base = stripTail(canonMath(value));
  if (!base || !/\d/.test(base)) return [];
  const forms = new Set([base]);
  if (base.includes('°')) {
    forms.add(base.replace(/°/g, '度'));
    forms.add(base.replace(/°/g, ''));
  }
  if (base.includes('π')) forms.add(base.replace(/π/g, 'pi'));
  if (COMMON_FRACTIONS[base]) forms.add(COMMON_FRACTIONS[base]);
  const fraction = base.match(/^(-?\d+)\/(\d+)$/);
  if (fraction) {
    const quotient = Number(fraction[1]) / Number(fraction[2]);
    if (Number.isFinite(quotient)) {
      forms.add(String(quotient));
      if (!Number.isInteger(quotient)) {
        forms.add(quotient.toFixed(2));
        forms.add(quotient.toFixed(3));
      }
    }
  }
  return [...forms].filter(Boolean);
};

const matchesValue = (canon, value) => valueForms(value).some(form => (
  isPlainNumber(form) ? hasNumberToken(canon, form) : canon.includes(form)
));

/* 一行里的等式结果：既包括中间式，也包括最后化简值。 */
const assignmentValues = line => {
  const segments = String(line).split(/[=＝]/);
  const values = [];
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index].split(/[，,；;。、]/)[0];
    const value = cleanValue(segment);
    if (value && /\d/.test(value)) values.push(value);
  }
  return values;
};

/* 没有等号但真实写出的结果，例如“二面角 A-PC-B 的大小为 60°”。 */
const statedValues = line => [...String(line).matchAll(/[为是等于]\s*([-+]?\d+(?:\.\d+)?\s*°?)/g)]
  .map(match => cleanValue(match[1]))
  .filter(value => /\d/.test(value));

const coordinateTuples = line => (String(line).match(/\([^()]*,[^()]*,[^()]*\)/g) || [])
  .map(cleanValue)
  .filter(Boolean);

const numbersIn = line => [...new Set((String(line).match(/\d+(?:\.\d+)?/g) || []))];

const termsIn = line => {
  const source = looseText(line);
  const terms = TERM_LIBRARY.filter(term => source.includes(term));
  const identifiers = (String(line).toLowerCase().match(/[a-z][a-z0-9]{1,3}/g) || [])
    .filter(item => !IDENTIFIER_STOPWORDS.has(item));
  return [...new Set([...terms, ...identifiers])];
};

const cjkRuns = line => (String(line).match(/[\u4e00-\u9fa5]{3,}/g) || []);

/* 步骤真实关键量：坐标三元组优先，否则取等式结果与“为/是”写出的结果。 */
const keyValuesOf = line => {
  const tuples = coordinateTuples(line);
  if (tuples.length) return tuples;
  const values = [...assignmentValues(line)];
  for (const value of statedValues(line)) if (!values.includes(value)) values.push(value);
  const meaningful = values.filter(value => !/^(?:-?0|-?1)$/.test(value));
  return meaningful.length ? meaningful : values;
};

const referencedValuesOf = line => numbersIn(line);

/* ---------- 量名识别：让 label/hint 说清“这一步在算哪个量” ---------- */

const CLEAN_SYMBOL = /^[A-Za-z\u0370-\u03ff][A-Za-z_0-9\u0370-\u03ff]{0,9}$/;

const tailOf = value => String(value || '').split(/[，,；;。、（(]/).pop().trim();

const symbolAtEnd = value => {
  const text = String(value || '').replace(/[\s（(]+$/, '');
  const trig = text.match(/(?:sin|cos|tan)\s*[∠]?\s*[A-Za-z0-9\u0370-\u03ff][A-Za-z_0-9\u0370-\u03ff]{0,10}\s*°?\s*$/);
  if (trig) return trig[0].replace(/\s+/g, '');
  // 必须真的位于末尾：否则“所以 DE 方向向量”会被误当成符号 DE。
  const match = text.match(/([A-Za-z\u0370-\u03ff][A-Za-z_0-9\u0370-\u03ff]*)(?:\^?\d+)?$/);
  return match && CLEAN_SYMBOL.test(match[1]) ? match[1] : '';
};

/* 等式左侧真实被求解的量：在“最后一段化简式的左侧”和“第一个等式的左侧”里选量名最清楚的那个。 */
const symbolCandidates = line => {
  const segments = String(line).split(/[=＝]/);
  if (segments.length < 2) return [];
  const candidates = [];
  const last = symbolAtEnd(tailOf(segments[segments.length - 2]));
  if (last) candidates.push(last);
  const first = symbolAtEnd(tailOf(segments[0]));
  if (first && !candidates.includes(first)) candidates.push(first);
  return candidates;
};

const termBefore = (text, symbol) => {
  const source = String(text || '');
  if (!symbol) return '';
  // 从最后一次出现往前找：符号可能同时出现在“量名”和后续表达式里。
  let index = source.lastIndexOf(symbol);
  while (index >= 0) {
    const head = source.slice(Math.max(0, index - 10), index).replace(/[\s为是等的于取作设得故则有写出可即应能以及]+$/, '');
    const term = TERM_LIBRARY.find(item => head.endsWith(item));
    if (term) return term;
    if (index === 0) break;
    index = source.lastIndexOf(symbol, index - 1);
  }
  return '';
};

const mainSymbol = line => {
  let best = '';
  let bestScore = -1;
  for (const symbol of symbolCandidates(line)) {
    const score = (termBefore(line, symbol) ? 100 : 0) + symbol.length;
    if (score > bestScore) {
      bestScore = score;
      best = symbol;
    }
  }
  return best;
};

/* 每一步涉及的量名：优先“量名 + 符号”，其次“量名 + 数值”。 */
const quantityName = (line, context, symbol) => {
  if (!symbol) return '';
  const term = termBefore(line, symbol) || termBefore(context, symbol);
  return term && !term.includes(symbol) ? `${term} ${symbol}` : symbol;
};

const assignmentNames = (line, context) => {
  const segments = String(line).split(/[=＝]/);
  const names = [];
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const symbol = symbolAtEnd(tailOf(segments[index]));
    if (!symbol) continue;
    const name = quantityName(line, context, symbol);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
};

const numberNames = line => numbersIn(line).map(number => {
  const source = String(line);
  const index = source.indexOf(number);
  const head = source.slice(Math.max(0, index - 6), index).replace(/[为是等的等于]+$/, '');
  const term = TERM_LIBRARY.find(item => head.endsWith(item));
  return term ? `${term} ${number}` : number;
});

/* 只由给定字面量组成的等式才算是“抄写已知条件”，例如 R=5、d=3。 */
const isLiteralValue = value => (
  /^[-+]?\d+(?:\.\d+)?$/.test(value)
  || /^[A-Za-z\u0370-\u03ff][A-Za-z_0-9\u0370-\u03ff]*$/.test(value)
  || /^\([^()]*,[^()]*,[^()]*\)$/.test(value)
);

const dihedralPhrase = text => {
  const match = String(text).match(/二面角\s*([A-Za-z0-9]+(?:[-—–][A-Za-z0-9]+)*)/);
  return match ? `二面角 ${match[1]}` : '二面角';
};

/* 由“满足 / 构成”这类句子建立的关系式，例如 R^2=r^2+d^2。 */
const relationFormula = text => {
  const segments = String(text).split(/[=＝]/);
  for (let index = segments.length - 1; index >= 1; index -= 1) {
    const left = tailOf(segments[index - 1]).replace(/^[\s满足构成由得故则因为所以]+/, '');
    const right = cleanValue(segments[index].split(/[，,；;。、]/)[0]);
    const formula = `${left}=${right}`;
    if (left && left.length <= 8 && right && formula.length <= 18) return formula;
  }
  return '';
};

/* ---------- 一步里的“有名有值”候选与结论关系 ---------- */

const VECTOR_WORD = /法向量|方向向量|方向|法向|叉积|外积/;
const POINT_TUPLE = /^[(（][^()（）]*,[^()（）]*,[^()（）]*[)）]$/;
const RELATION_MARK = /[⊥∥⊂⊃∈∉∩∪≌≅]|垂直|平行|共面|中位线|重合/;
const TRIG_EXPRESSION = /(?:sin|cos|tan)\s*[∠]?\s*\(?\s*[A-Za-z0-9\u0370-\u03ff][A-Za-z0-9\u0370-\u03ff\-–—]{0,10}\s*\)?\s*°?/i;

/* 括号内的逗号不是分句点，否则坐标 (1,1,0) 会被切开；⇒/→ 是推理换步。 */
const splitClauses = text => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of String(text || '')) {
    if (char === '(' || char === '（') depth += 1;
    else if (char === ')' || char === '）') depth = Math.max(0, depth - 1);
    if (depth <= 0 && /[，,；;。⇒]/.test(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
};

/* 等式左侧的量名：优先三角函数表达式，其次符号，再次量名术语，最后取算式本身。 */
const nameOf = left => {
  const text = String(left || '').trim().replace(/^[\s即于是故则得共又且]+/, '');
  if (!text) return '';
  const trig = text.match(new RegExp(`${TRIG_EXPRESSION.source}\\s*$`, 'i'));
  if (trig) return trig[0].replace(/\s+/g, '');
  const symbol = symbolAtEnd(text);
  if (symbol) return symbol;
  const term = TERM_LIBRARY.find(item => text.endsWith(item));
  if (term) {
    const head = text.slice(0, -term.length);
    const identifiers = head.match(/[A-Za-z][A-Za-z_0-9]*/g) || [];
    const prefix = identifiers.length ? `${identifiers[identifiers.length - 1]} ` : '';
    return `${prefix}${term}`;
  }
  const mathish = text.match(/\|?[-+√π\d\s/^.()|·*a-zA-Z_\\]+\|?$/);
  if (mathish && mathish[0].trim().length <= 12) return mathish[0].trim();
  const cjk = text.match(/[\u4e00-\u9fa5]{1,6}$/);
  return cjk ? cjk[0] : '';
};

const kindOf = (name, values, line) => {
  if (VECTOR_WORD.test(String(name))) return 'vector';
  if (values.some(value => POINT_TUPLE.test(value))) return VECTOR_WORD.test(String(line)) ? 'vector' : 'point';
  return 'scalar';
};

/* 一行里所有“有名有值”的候选：{name, values, kind}，例如 a=2、D=(1,1,0)、法向量为 (0,1,0)。 */
const namedGroups = line => {
  const text = String(line || '');
  const groups = [];
  const push = group => {
    if (!group.name || !group.values.length) return;
    if (groups.some(item => item.name === group.name && item.values.join() === group.values.join())) return;
    groups.push(group);
  };
  for (const clause of splitClauses(text)) {
    const segments = clause.split(/[=＝]/);
    if (segments.length > 1) {
      // 等式链的量名可能不在最左侧（例如 (a/2)/sqrt(1+a^2/4)=sin45°=√2/2），
      // 依次尝试：最左侧量名 → 该句里的三角函数表达式 → 第二个等式段。
      const name = nameOf(segments[0])
        || (clause.match(TRIG_EXPRESSION)?.[0] || '').replace(/\s+/g, '')
        || nameOf(segments[1] || '');
      const values = segments.slice(1).map(cleanValue).filter(value => value && /\d/.test(value) && value !== name);
      if (name) push({name, values, kind: kindOf(name, values, text)});
    }
    for (const match of clause.matchAll(/([^，,；;。为是等于取作得]{1,16}?)(?:为|是|等于)\s*([-+]?\d+(?:\.\d+)?\s*°?|[(（][^()（）]{0,24}[)）])/g)) {
      const name = nameOf(match[1]);
      const value = cleanValue(match[2]);
      if (!name || !/\d/.test(value)) continue;
      push({name, values: [value], kind: kindOf(`${name}`, [value], text)});
    }
  }
  return groups;
};

/* 证明类结论：取最后一个含几何关系的关系句，允许出现 BC1、BCC1B1 这类带数字的点名。 */
const proofRelation = text => {
  const markers = /所以|因此|故|即|于是|从而|得/;
  const tail = stripTail(String(text).split(markers).pop() || '');
  const item = tail.replace(/^[，,。；;：:\s]+/, '').replace(/^(?:证明|求证|证得|证)\s*/, '').trim();
  if (!item || item.length > 22) return '';
  const head = item.split(/[=＝⇒]/)[0].trim();
  if (!head || !RELATION_MARK.test(head)) return '';
  if (/^[-+√π\d\s/^.()·*_]+$/.test(head)) return '';
  return head;
};

/* ---------- 取值与量名对齐 ---------- */

const TERM_ALIASES = {正弦: 'sin', 余弦: 'cos', 正切: 'tan', 面积: 's', 体积: 'v'};

const objectTermsOf = object => {
  const terms = TERM_LIBRARY.filter(term => object.includes(term));
  for (const [name, alias] of Object.entries(TERM_ALIASES)) if (object.includes(name)) terms.push(alias);
  return [...new Set(terms)];
};

/* 一步里有多个数值/向量时，取与 object 名字语义匹配的那个候选。 */
const pickNamedGroup = (groups, object, symbol) => {
  if (!groups.length) return null;
  const terms = objectTermsOf(object);
  const objectSymbols = [symbolAtEnd(object), symbol && object.includes(symbol) ? symbol : ''].filter(Boolean);
  const wantVector = /向量|坐标|方向|法向/.test(object);
  const wantScalar = !wantVector && /正弦|余弦|正切|面积|体积|距离|长度|角度|半径|高|大小|值$/.test(object);
  let best = null;
  let bestScore = 0;
  groups.forEach((group, index) => {
    const nameText = `${group.name} ${group.values.join(' ')}`;
    let score = 0;
    if (objectSymbols.some(item => group.name === item || symbolAtEnd(group.name) === item)) score += 4;
    for (const term of terms) if (nameText.includes(term)) score += 2;
    if (wantVector && group.kind === 'vector') score += 2;
    if (wantScalar && group.kind === 'scalar') score += 1;
    if (wantScalar && group.kind === 'vector') score -= 4;
    if (wantVector && group.kind === 'scalar') score -= 4;
    if (index === groups.length - 1) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = group;
    }
  });
  return bestScore > 0 ? best : null;
};

const describeLine = (line, context = '') => {
  const text = String(line || '');
  const tuples = coordinateTuples(text);
  const groups = namedGroups(text);
  const symbol = mainSymbol(text);
  const name = symbol ? quantityName(text, context, symbol) : '';
  const values = assignmentValues(text);
  const names = assignmentNames(text, context);
  const relation = proofRelation(text);
  const isSetup = /(^|[，,。；;])\s*(设|令|已知|给出|由题)/.test(text)
    && !/求|所以|因此|得到|得出|计算|证明/.test(text)
    && values.length > 0 && values.every(isLiteralValue);
  const longestTerm = () => TERM_LIBRARY.find(term => text.includes(term)) || '';
  const withGroup = (verb, object) => ({verb, object, group: pickNamedGroup(groups, object, symbol)});

  // 证明类：这一步的“结论”是几何关系本身，不是一个数值。
  if (relation) return {verb: '证明', object: relation, mode: 'relation', group: null};
  // 只有真的能取出关系结论时才判为证明类，避免“…验证得…”被误当成证明步骤。
  if (/证明|求证|证得|证毕|(?:^|[，,。；;：:])\s*证/.test(text)) {
    const tail = proofRelation(text);
    if (tail) return {verb: '证明', object: tail, mode: 'relation', group: null};
  }
  if (/二面角/.test(text)) {
    const phrase = dihedralPhrase(text);
    const cosine = /余弦|cos/.test(text);
    const verb = /⊥/.test(text) && /平面角|构造|取|作/.test(text) ? '构造' : '求';
    return {...withGroup(verb, phrase === '二面角' && cosine ? '二面角的余弦值' : phrase), mode: 'value'};
  }
  if (/(?:sin|cos|tan)\s*\d*\s*°?|正弦|余弦|正切/.test(text)) {
    const trig = /(?:sin|正弦)/.test(text) ? '正弦' : /(?:cos|余弦)/.test(text) ? '余弦' : '正切';
    const scope = /线面角/.test(text) ? '线面角'
      : /夹角/.test(text) ? '夹角'
        : (/平面/.test(text) && /角|°/.test(text) ? '线面角' : '');
    const expression = text.match(TRIG_EXPRESSION)?.[0];
    const object = scope ? `${scope}的${trig}值` : (expression ? expression.replace(/\s+/g, '') : `${trig}值`);
    return {...withGroup('求', object), mode: 'value'};
  }
  if (VECTOR_WORD.test(text)) {
    const vectorGroup = [...groups].reverse().find(group => group.kind === 'vector') || null;
    const vectorName = vectorGroup
      ? (VECTOR_WORD.test(vectorGroup.name) ? vectorGroup.name : `法向量 ${vectorGroup.name}`)
      : '';
    if (vectorName) {
      const verb = /求|计算|得到|得出/.test(text) ? '求' : /为|是/.test(text) ? '写出' : '构造';
      return {verb, object: vectorName, mode: 'value', group: vectorGroup};
    }
  }
  if (/满足|构成|关系/.test(text)) {
    const formula = relationFormula(text);
    if (formula) return {verb: '写出', object: `关系式 ${formula}`, mode: 'formula', group: null};
  }
  // 只有真的在“求距离”时才按距离命名；已知条件里的“到截面的距离 d=3”不在此列。
  const asksDistance = /(?:求|计算)[^，,。；;]{0,16}距离|距离\s*(?:等于|为|是|即)|距离\s*[=|＝]/.test(text);
  if (asksDistance) {
    const phrase = text.match(/([A-Za-z0-9]{1,6}\s*到\s*(?:平面|直线|线段)\s*[A-Za-z0-9]{1,10}\s*的距离)/);
    const object = phrase ? phrase[1].replace(/\s+/g, ' ').trim() : '距离';
    return {...withGroup('求', object), mode: 'value'};
  }
  const solved = text.match(/(?:解得|求得|解出|求出)\s*([A-Za-z][A-Za-z_0-9]{0,8})\s*[=＝]/);
  if (solved) return {...withGroup('求', solved[1]), mode: 'value'};
  if (/坐标系|建系|原点/.test(text)) {
    return {verb: '建立', object: tuples.length ? '坐标系并写出关键点坐标' : '坐标系', mode: 'plain', group: null};
  }
  if (tuples.length && symbol) {
    const pointGroups = groups.filter(group => group.kind === 'point');
    const object = /中点/.test(text) ? '中点坐标'
      : pointGroups.length > 1 ? '关键点坐标'
        : (TERM_LIBRARY.some(term => name.includes(term)) ? name : `${symbol} 坐标`);
    return {...withGroup(/中点/.test(text) ? '求' : '写出', object), mode: 'value'};
  }
  if (tuples.length) return {verb: '写出', object: '关键点坐标', mode: 'plain', group: null};
  if (isSetup) return {verb: '明确', object: names.length ? `已知条件（${names.slice(0, 3).join('、')}）` : '已知条件', mode: 'plain', group: null};
  if (symbol && values.length) return {...withGroup('求', name || symbol), mode: 'value'};
  const labels = numberNames(text);
  if (/求|计算|得到|得出|所以|因此/.test(text)) {
    return {verb: '求', object: labels.length ? labels.slice(0, 2).join('、') : (longestTerm() || '关键结果'), mode: 'plain', group: null};
  }
  return {verb: '明确', object: labels.length ? labels.slice(0, 2).join('、') : (longestTerm() || '已知条件'), mode: 'plain', group: null};
};

/* 提示语去掉最后一段等式结果，避免把答案直接写在还没完成的得分点上；
   证明类再额外去掉最后那句结论，只留推理过程。 */
const hintOf = (line, relation = '') => {
  const text = String(line);
  const segments = text.split(/[=＝]/);
  const head = segments.length > 1 ? segments.slice(0, -1).join('=') : text;
  let hint = stripTail(head) || stripTail(text);
  if (relation) {
    const markers = [...text.matchAll(/所以|因此|故|即|于是|从而/g)];
    const last = markers[markers.length - 1];
    const cut = last && last.index > 0 ? stripTail(text.slice(0, last.index)) : '';
    if (cut) hint = cut;
  }
  return hint.slice(0, HINT_LIMIT);
};

/* 得分点标题：中文量名直接相连，数学对象之间留一个空格，便于阅读。 */
const labelFor = (description, index) => {
  const object = String(description.object || '').trim();
  const separator = /^[\u4e00-\u9fa5]/.test(object) ? '' : ' ';
  return `第${index + 1}步 ${description.verb}${separator}${object}`.slice(0, 26);
};

/* ---------- 步骤/得分点构造 ---------- */

const detectByDescription = ({canon, loose}, {terms, numbers, requireNumber, phrases}) => {
  if (!loose) return false;
  const hits = terms.filter(term => loose.includes(term)).length;
  const needed = Math.min(2, terms.length);
  if (terms.length && hits < needed) return false;
  if (requireNumber && numbers.length) {
    if (!numbers.some(number => hasNumberToken(loose, number))) return false;
  }
  if (!terms.length) {
    return phrases.some(phrase => loose.includes(phrase) || canon.includes(canonMath(phrase)));
  }
  return true;
};

/* 证明类得分点：按结论里的点线面名与关系词判定，而不是靠一个数值。 */
const relationDetect = (relation, loose) => {
  const key = looseText(relation).replace(/[，,。；;、\s]/g, '');
  if (key && loose.includes(key)) return true;
  const identifiers = [...new Set((relation.match(/[A-Za-z][A-Za-z_0-9]*/g) || []).map(item => item.toLowerCase()))];
  const mark = /[⊥∥]|垂直|平行|⊂|⊃|包含|共面|在平面/.test(loose);
  if (!mark) return false;
  if (!identifiers.length) return true;
  const hits = identifiers.filter(identifier => loose.includes(identifier)).length;
  return hits >= Math.min(2, identifiers.length);
};

/* 量名里是否已经写了这个数值（例如“边长 2”），避免重复写“= 2”。 */
const objectMentionsValue = (object, value) => {
  const target = String(value || '');
  if (!target) return false;
  if (isPlainNumber(canonMath(target))) {
    return new RegExp(`(^|[\\s=＝（(])${escapeRegExp(canonMath(target))}(?![0-9])`).test(String(object || ''));
  }
  return String(object || '').includes(target);
};

/* 单个数字（0、1、4…）区分度太低：只按数值判定会把法向量 (0,1,0) 也算成距离 1。 */
const WEAK_VALUE = /^[-+]?\d(?:\.\d+)?$/;

const makeStep = ({id, goal, label, line, context, nextLabel, values, matchValues, relation = '', group = null, terms, numbers, phrases, strict, requireNumber}) => {
  const {verb, object} = describeLine(line, context);
  const answer = group ? group.values[group.values.length - 1] || '' : '';
  // 只展示和量名对得上、且确实像结果的数值；关系式、已知条件、整体坐标不硬塞数值。
  const displayValue = answer && isAnswerLike(answer) && !objectMentionsValue(object, answer) && !/关系式|已知条件（|关键点坐标/.test(object)
    ? answer
    : '';
  const resultPrefix = {求: '已求出', 明确: '已明确', 建立: '已建立', 写出: '已写出', 证明: '已证明', 构造: '已构造'}[verb] || '已完成';
  const knownResult = verb === '证明'
    ? `已完成本步证明：${object}`
    : displayValue ? `${resultPrefix}：${object} = ${displayValue}` : `${resultPrefix}：${object}`;
  const understanding = verb === '证明'
    ? `这一步做对了：你已经完成「${object}」的证明。`
    : displayValue ? `这一步做对了：你已经${verb}${object}，得到 ${displayValue}。` : `这一步做对了：你已经${verb}${object}。`;
  const explanation = `这一步的依据来自题目本身：${stripTail(line)}。`;
  const detectValues = matchValues && matchValues.length ? matchValues : values;
  const objectTerms = objectTermsOf(object);
  const objectSymbol = (symbolAtEnd(object) || '').toLowerCase();
  // 结果只是一个数字时，还要求学生写出这一步的对象或量名（而不是拿别的数字顶上）。
  const weakTokens = [...new Set([...objectTerms, ...terms, ...termsIn(object)])];
  const detect = text => {
    const loose = looseText(text);
    const canon = canonMath(text);
    if (loose.length < 2) return false;
    if (relation) return relationDetect(relation, loose);
    if (detectValues.length && detectValues.some(value => matchesValue(canon, value))) {
      const weak = detectValues.every(value => WEAK_VALUE.test(canonMath(value)));
      if (!weak) return true;
      return weakTokens.some(token => loose.includes(token.toLowerCase())) || Boolean(objectSymbol && loose.includes(objectSymbol));
    }
    if (strict || (group && group.values.some(isAnswerLike))) return false;
    return detectByDescription({canon, loose}, {terms, numbers, requireNumber, phrases});
  };
  const nextQuestion = nextLabel
    ? `下一步：${nextLabel}。先写出这一步用到的关系、公式或结论。`
    : '本题已完成：请检查每一步的关键结果是否都与题目所问一致。';
  const followUpQuestion = verb === '证明'
    ? '只补这一步要证明的关系和关键依据（用到哪两条直线或哪个平面），不用重写前面的推导。'
    : verb === '求' && object
      ? `只写这一步最关键的量：${object} 等于多少？不用重写前面的推导。`
      : object
        ? `只补这一步：${object}。不用重写前面的推导。`
        : '只补这一步的结论即可，不用重写前面的推导。';
  return {
    id,
    goal,
    knownResult,
    understanding,
    explanation,
    detect,
    nextQuestion,
    followUpQuestion,
    // 下面三个字段只服务于本模块内部的提示语组装，不参与 tutor 契约。
    label,
    hint: hintOf(line, relation),
    relation,
    values,
  };
};

/* ---------- 数据来源解析 ---------- */

const resolveSources = caseData => {
  const root = caseData && typeof caseData === 'object' ? caseData : {};
  const candidates = [root, root.context, root.draft, root.mistakeCase, root.case, root.geometryCompilation, root.geometryResult]
    .filter(item => item && typeof item === 'object');
  const pick = selector => {
    for (const item of candidates) {
      const value = selector(item);
      if (Array.isArray(value) && value.length) return value;
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  };
  const outline = (pick(item => asArray(item.solutionOutline).map(cleanLine).filter(Boolean))
    || asArray(root.geometryCompilation && root.geometryCompilation.solution && root.geometryCompilation.solution.outline)
      .map(cleanLine).filter(Boolean)
    || []).slice(0, OUTLINE_LIMIT);
  const queries = (pick(item => asArray(item.geometryIR && item.geometryIR.queries))
    || asArray(root.problemSpec && root.problemSpec.queries)
    || asArray(root.queries)
    || []).slice(0, QUERY_LIMIT);
  const derivation = (pick(item => asArray(item.geometryResult && item.geometryResult.derivation))
    || asArray(root.derivation)
    || []).slice(0, DERIVATION_LIMIT);
  const knowledgePoints = (pick(item => asArray(item.knowledgePoints))
    || asArray(root.knowledge && root.knowledge.points)
    || []).slice(0, 6).map(cleanLine).filter(Boolean);
  const correctAnswer = stripTail(cleanLine(pick(item => item.correctAnswer) || root.correctAnswer || ''));
  const question = cleanLine(root.question || root.parentQuestion || '');
  const questionTargets = [...question.matchAll(/(?:求|证明|证)\s*[^，,。；;？?]{1,24}/g)].map(match => match[0]);
  return {outline, queries, derivation, knowledgePoints, correctAnswer, question, questionTargets};
};

/* ---------- queries 描述 ---------- */

const queryText = query => cleanLine(
  query && (query.quote || query.prompt || query.sourceText || query.statement || query.label || query.title
    || (typeof query.target === 'string' ? query.target : ''))
);

const queryAnswerTokens = query => {
  if (!query || typeof query !== 'object') return [];
  const tokens = [];
  const push = value => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'object') {
      for (const key of ['exact', 'display', 'latex', 'text', 'value', 'numeric', 'degrees', 'cosine', 'sine', 'radians', 'area', 'volume', 'length']) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== '') push(value[key]);
      }
      return;
    }
    tokens.push(String(value));
  };
  push(query.answer);
  push(query.expected);
  push(query.result);
  return tokens.map(cleanValue).filter(token => /\d/.test(token));
};

/* 题目所问量的描述：优先“求/证明 …”的核心短语，其次量词种类。 */
const isProofQuery = query => /证明|证|∥|⊥/.test(queryText(query) || '')
  || ['proof', 'prove_perpendicular'].includes(String(query && query.kind || ''));

const queryCoreFrom = text => {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  // 长句里常把条件写在前面（“P 在 BB1上、二面角…时求 B2P”），只保留最后那个“求/证”。
  const cut = source.match(/(求|证明|证)\s*([^，,。；;？?]{1,24})$/);
  if (cut) {
    const prefix = cut[1] === '求' ? '求' : '证明';
    const body = cut[2].trim();
    return `${prefix}${/^[\u4e00-\u9fa5]/.test(body) ? '' : ' '}${body}`;
  }
  return '';
};

const queryLabel = (query, fallbackText = '') => {
  const text = queryText(query);
  const proof = isProofQuery(query) || /^(?:证明|证)/.test(text);
  const core = queryCoreFrom(text) || (text ? `${proof ? '证明' : '求'}${/^[\u4e00-\u9fa5]/.test(text) ? '' : ' '}${text}` : '')
    || queryCoreFrom(fallbackText);
  if (core) return core.length > 24 ? `${core.slice(0, 24)}…` : core;
  const kindLabel = QUERY_KIND_LABELS[String(query && query.kind || '')];
  if (kindLabel) return `${proof ? '证明' : '求'}${kindLabel}`;
  return '求出题目所问的量';
};

/* ---------- 主入口 ---------- */

export function buildGeometryRubric(caseData) {
  const sources = resolveSources(caseData);
  // 量名识别允许跨行、跨题目原文取词，例如“体对角线 AF1”里的“体对角线”。
  const context = [sources.question, ...sources.outline, sources.correctAnswer].filter(Boolean).join('；');
  const descriptors = [];

  sources.outline.forEach((line, index) => {
    // 一步里常有多个候选量（法向量、坐标、被解出的参数…），
    // 这里一次性定下 verb/object，并挑出与量名语义一致的取值。
    const description = describeLine(line, context);
    const targets = description.group ? description.group.values : [];
    const descriptor = {
      kind: 'outline',
      index,
      line,
      id: `outline_${index + 1}`,
      values: keyValuesOf(line),
      matchValues: targets.length ? targets : keyValuesOf(line),
      relation: description.mode === 'relation' ? description.object : '',
      group: description.group || null,
      terms: termsIn(line),
      numbers: referencedValuesOf(line),
      phrases: cjkRuns(line),
      looseNumber: coordinateTuples(line).length > 0,
      label: labelFor(description, index),
    };
    descriptors.push(descriptor);
  });

  sources.queries.forEach((query, index) => {
    const tokens = queryAnswerTokens(query);
    // 没有原文描述时，用题目里第 index 个“求/证”短语做标签，避免只写“求线段上的点”。
    const label = queryLabel(query, sources.questionTargets[index] || '');
    const values = tokens.length ? tokens : [];
    const text = queryText(query) || label;
    const terms = termsIn(text).length ? termsIn(text) : termsIn(label);
    const matched = values.length
      ? descriptors.find(item => item.kind === 'outline' && item.values.some(value => values.some(other => canonMath(other) === canonMath(value))))
      : null;
    const descriptor = {
      kind: 'query',
      index,
      query,
      id: `query_${index + 1}`,
      line: text,
      values,
      terms,
      numbers: numbersIn(text),
      phrases: cjkRuns(text),
      looseNumber: values.length === 0,
      label,
    };
    if (matched) {
      // 该量已经由某一步真实算出，合并成同一个得分点，避免重复计分。
      matched.queryDescriptors = [...(matched.queryDescriptors || []), descriptor];
    } else {
      descriptors.push(descriptor);
    }
  });

  // derivation 只在没有任何“步骤/所问量”时作为结构骨架使用。
  if (!descriptors.length && sources.derivation.length) {
    sources.derivation.forEach((item, index) => {
      const stepId = cleanLine(item && item.stepId) || `step_${index + 1}`;
      const codes = asArray(item && item.factCodes).map(code => String(code));
      const described = codes.map(code => FACT_CODE_TEXT[code]).filter(Boolean);
      const englishTerms = [...new Set(codes.flatMap(code => String(code).toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(word => ENGLISH_TERMS[word])
        .filter(Boolean)))];
      const text = described.join('；') || `${stepId} 对应的几何事实`;
      descriptors.push({
        kind: 'derivation',
        index,
        stepId,
        id: `derivation_${index + 1}`,
        line: text,
        values: [],
        terms: [...new Set([...englishTerms, ...termsIn(text)])],
        numbers: [],
        phrases: cjkRuns(text),
        looseNumber: true,
        label: `第${index + 1}步 ${described[0] || englishTerms.join('') || stepId}`.slice(0, 26),
      });
    });
  }

  // 仍然没有任何结构时，退回知识点 + 标准答案 + 题目本身，生成最小可用得分点。
  if (!descriptors.length && (sources.knowledgePoints.length || sources.correctAnswer || sources.question)) {
    const points = sources.knowledgePoints.length ? sources.knowledgePoints : [''];
    points.slice(0, 4).forEach((point, index) => {
      const answerValues = [...new Set(keyValuesOf(sources.correctAnswer).concat(assignmentValues(sources.correctAnswer)))];
      const text = [point, sources.correctAnswer, sources.question].filter(Boolean).join(' ');
      descriptors.push({
        kind: 'knowledge',
        index,
        point,
        id: `knowledge_${index + 1}`,
        line: text,
        values: index === 0 ? answerValues : [],
        terms: [...new Set([...termsIn(point || sources.question), ...termsIn(sources.correctAnswer)])],
        numbers: numbersIn(point || sources.question),
        phrases: cjkRuns(point || sources.question),
        looseNumber: !answerValues.length,
        label: point ? `落实知识点：${point}`.slice(0, 26) : '得出本题最终结论',
      });
    });
  }

  if (!descriptors.length) return {parts: [], steps: [], source: 'none'};

  const ordered = descriptors;
  const steps = [];
  const parts = [];
  const goalFor = descriptor => (
    descriptor.kind === 'outline' ? `complete_outline_step_${descriptor.index + 1}`
      : descriptor.kind === 'query' ? `answer_query_${descriptor.index + 1}`
        : descriptor.kind === 'derivation' ? `establish_${String(descriptor.stepId || descriptor.index + 1).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
          : `apply_knowledge_${descriptor.index + 1}`
  );
  const strictFor = descriptor => {
    const targets = descriptor.matchValues && descriptor.matchValues.length ? descriptor.matchValues : descriptor.values;
    return targets.length > 0 && (descriptor.kind === 'query' || descriptor.kind === 'outline') && !descriptor.looseNumber;
  };

  const stepOptionsFor = (descriptor, nextLabel) => ({
    id: descriptor.id,
    goal: goalFor(descriptor),
    label: descriptor.label,
    line: descriptor.line,
    context,
    nextLabel,
    values: descriptor.values,
    matchValues: descriptor.matchValues,
    relation: descriptor.relation || '',
    group: descriptor.group || null,
    strict: strictFor(descriptor),
    requireNumber: !descriptor.looseNumber,
    terms: descriptor.terms,
    numbers: descriptor.numbers,
    phrases: descriptor.phrases,
  });

  // 求解题的最后得分点：直接用题目实际所问的量作为判定依据。
  const applyQueryWording = (step, descriptor) => {
    const text = queryText(descriptor.query) || descriptor.label;
    // queries 的 answer 可能是 {exact, numeric} 或 {degrees, cosine}，第一个才是题目要的结果。
    const answer = descriptor.values[0];
    const proof = isProofQuery(descriptor.query) || /^证明/.test(descriptor.label);
    step.knownResult = answer
      ? `已求出题目所问的「${descriptor.label}」：${answer}`
      : proof
        ? `已写出题目所问「${descriptor.label}」的证明过程与结论。`
        : `已写出题目所问「${descriptor.label}」的求解过程与结果。`;
    step.understanding = answer
      ? `这一步做对了：题目问的「${descriptor.label}」已经算出结果。`
      : proof
        ? `这一步做对了：你已经按题目要求完成「${descriptor.label}」的证明。`
        : `这一步做对了：你已经按题目要求写出「${descriptor.label}」的求解过程。`;
    step.explanation = `题目原文要求：${text}；这一步用题目实际所问的量作为判定依据。`;
    step.followUpQuestion = proof
      ? `只写「${descriptor.label}」的结论与关键依据，不用重写全部过程。`
      : `只写「${descriptor.label}」的最终结果即可，不用重写过程。`;
    return step;
  };

  const buildStep = (descriptor, nextLabel) => {
    const step = makeStep(stepOptionsFor(descriptor, nextLabel));
    if (descriptor.kind === 'query') return applyQueryWording(step, descriptor);
    if (descriptor.kind === 'derivation') {
      step.knownResult = `已完成这一步的几何事实：${stripTail(descriptor.line)}`;
      step.understanding = `这一步做对了：你已经落实「${stripTail(descriptor.line)}」。`;
      step.explanation = `这一步对应题目几何结构里真实存在的环节：${stripTail(descriptor.line)}。`;
      return step;
    }
    if (descriptor.kind === 'knowledge') {
      step.knownResult = descriptor.point ? `已落实知识点：${descriptor.point}` : '已得出本题最终结论。';
      step.understanding = descriptor.point
        ? `这一步做对了：你已经把「${descriptor.point}」用到本题的具体条件上。`
        : '这一步做对了：你已经写出本题的最终结论。';
      step.explanation = sources.correctAnswer
        ? `本题判定依据来自题目自身的结论：${sources.correctAnswer}。`
        : `这一步的依据来自题目本身：${stripTail(descriptor.line)}。`;
      step.followUpQuestion = descriptor.point
        ? `只写「${descriptor.point}」在本题中用到的定义、公式或判定。`
        : '只写本题的最终结论即可。';
    }
    return step;
  };

  ordered.forEach((descriptor, position) => {
    const nextLabel = ordered[position + 1] ? ordered[position + 1].label : '';
    const stepIds = [descriptor.id];
    steps.push(buildStep(descriptor, nextLabel));
    // 题目所问的量如果正好是某一步算出的结果，合并进同一个得分点，不重复计分。
    for (const merged of descriptor.queryDescriptors || []) {
      steps.push(applyQueryWording(makeStep(stepOptionsFor(merged, nextLabel)), merged));
      stepIds.push(merged.id);
    }
    parts.push({
      id: descriptor.id,
      label: descriptor.label,
      hint: descriptor.kind === 'outline'
        ? `第${descriptor.index + 1}步：${hintOf(descriptor.line, descriptor.relation || '')}`
        : descriptor.kind === 'query'
          ? (queryText(descriptor.query)
            ? `题目原文「${queryText(descriptor.query)}」，写出求解这一步的完整过程与结果。`
            : `题目要求求出${descriptor.label.replace(/^求/, '')}，写出求解过程与结果。`)
          : descriptor.kind === 'derivation'
            ? `这一步对应题目给出的几何事实：${stripTail(descriptor.line)}`
            : descriptor.point
              ? `${sources.question ? `题目「${sources.question.slice(0, 28)}」中，` : ''}把「${descriptor.point}」落实到本题的具体式子或结论上。`
              : '写出本题最终的式子或结论。',
      steps: stepIds,
    });
  });

  const source = sources.outline.length && sources.queries.length ? 'solutionOutline+queries'
    : sources.outline.length ? 'solutionOutline'
      : sources.queries.length ? 'queries'
        : sources.derivation.length ? 'derivation' : 'knowledgePoints';

  return {parts, steps: steps.map(step => ({
    id: step.id,
    goal: step.goal,
    knownResult: step.knownResult,
    understanding: step.understanding,
    explanation: step.explanation,
    detect: step.detect,
    nextQuestion: step.nextQuestion,
    followUpQuestion: step.followUpQuestion,
  })), source};
}

/* tutor 会话上下文里携带的精简几何编译数据：只放得分点真正需要的字段。 */
export function tutorGeometryContext(caseData) {
  const sources = resolveSources(caseData);
  const payload = {};
  if (sources.outline.length) payload.solutionOutline = sources.outline.slice(0, OUTLINE_LIMIT).map(line => line.slice(0, 240));
  if (sources.queries.length) {
    payload.geometryIR = {queries: sources.queries.slice(0, QUERY_LIMIT).map(query => {
      const item = {id: query && query.id, kind: query && query.kind};
      const text = queryText(query);
      if (text) item.quote = text.slice(0, 160);
      if (query && query.answer !== undefined) item.answer = query.answer;
      if (query && query.expected !== undefined) item.expected = query.expected;
      return item;
    })};
  }
  if (sources.derivation.length) {
    payload.geometryResult = {derivation: sources.derivation.slice(0, DERIVATION_LIMIT).map(item => ({
      stepId: cleanLine(item && item.stepId),
      factCodes: asArray(item && item.factCodes).map(code => String(code)),
    }))};
  }
  if (sources.correctAnswer) payload.correctAnswer = sources.correctAnswer.slice(0, 240);
  return Object.keys(payload).length ? payload : null;
}

export default buildGeometryRubric;
