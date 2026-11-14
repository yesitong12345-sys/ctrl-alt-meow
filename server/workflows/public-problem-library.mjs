const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]/gu, '');

const tokenize = value => {
  const text = normalize(value);
  const tokens = new Set();
  for (let index = 0; index < text.length; index += 1) {
    tokens.add(text.slice(index, index + 1));
    if (index + 1 < text.length) tokens.add(text.slice(index, index + 2));
  }
  return [...tokens].filter(Boolean);
};

const overlap = (left, right) => {
  const a = new Set(tokenize(left)), b = new Set(tokenize(right));
  if (!a.size || !b.size) return 0;
  let common = 0;
  a.forEach(token => { if (b.has(token)) common += 1; });
  return common / Math.max(a.size, b.size);
};

// These records deliberately contain only verified, impersonal teaching assets.
// A student's source image, answer, chat turns and progress never enter this list.
export const PUBLIC_PROBLEM_TEMPLATES = Object.freeze([
  {
    id: 'solid-square-pyramid-line-plane-angle-v1', version: 1, subject: '数学', unit: '空间几何',
    title: '正四棱锥的线面角', geometryKinds: ['pyramid'],
    knowledgePoints: ['正四棱锥', '线面角', '法向量'],
    keywords: ['正四棱锥', '线面角', '底面正方形', '法向量', '二面角'],
    preview: {kind: 'three', label: '已验证的正四棱锥空间模型'},
    sharedConditions: ['底面为正方形', '顶点在底面中心的铅垂线上', '所求对象为线面角或相关正弦值'],
    reusableConstructs: ['建立以底面中心为原点的空间直角坐标系', '构造平面法向量', '判断方向向量与法向量夹角和线面角的余角关系'],
    method: '先固定坐标系，再由两条平面内向量叉乘得到法向量；最后用角的互余关系选择正弦或余弦。',
    verified: true
  },
  {
    id: 'solid-right-cylinder-axis-section-v1', version: 1, subject: '数学', unit: '空间几何',
    title: '圆柱的轴截面与体积', geometryKinds: ['cylinder'],
    knowledgePoints: ['圆柱', '轴截面', '体积与表面积'],
    keywords: ['圆柱', '轴截面', '半径', '高', '体积', '表面积'],
    preview: {kind: 'three', label: '已验证的圆柱、轴截面与尺寸标注'},
    sharedConditions: ['直圆柱', '给出半径与高或能由题设推出', '截面经过圆柱轴或平行于底面'],
    reusableConstructs: ['作经过圆柱轴的截面', '把轴截面转化为长为高、宽为直径的矩形'],
    method: '先确认截面位置，再把空间长度落实到轴截面中的矩形或底面圆。',
    verified: true
  },
  {
    id: 'solid-right-cone-axis-section-v1', version: 1, subject: '数学', unit: '空间几何',
    title: '圆锥的轴截面与母线关系', geometryKinds: ['cone'],
    knowledgePoints: ['圆锥', '轴截面', '母线'],
    keywords: ['圆锥', '轴截面', '母线', '半径', '高', '体积'],
    preview: {kind: 'three', label: '已验证的圆锥、轴截面与母线'},
    sharedConditions: ['直圆锥', '给出半径、高或母线中的足够两项', '截面经过圆锥轴或平行底面'],
    reusableConstructs: ['作经过顶点与底面圆心的轴截面', '在等腰三角形的一半中使用母线、半径、高的直角关系'],
    method: '先把圆锥还原成轴截面等腰三角形，再处理母线、半径和高。',
    verified: true
  },
  {
    id: 'solid-sphere-plane-section-v1', version: 1, subject: '数学', unit: '空间几何',
    title: '球的平面截面圆', geometryKinds: ['sphere'],
    knowledgePoints: ['球', '截面圆', '球心到平面的距离'],
    keywords: ['球', '截面', '球心', '平面', '半径', '圆'],
    preview: {kind: 'three', label: '已验证的球与平面截面圆'},
    sharedConditions: ['给出球半径', '给出截平面到球心距离或明确截平面过球心'],
    reusableConstructs: ['连接球心与截面圆心', '在截面圆半径、球半径和球心到平面距离之间构造直角三角形'],
    method: '利用 r² = R² - d² 计算截面圆半径，并先判断是否为大圆。',
    verified: true
  }
]);

export const publicTemplates = () => PUBLIC_PROBLEM_TEMPLATES.map(template => structuredClone(template));

const caseText = item => [item.question, item.unit, ...(item.knowledgePoints || []), ...(item.microSkills || []), item.questionType].filter(Boolean).join(' ');
const geometryKind = item => {
  const raw = item?.geometryResult?.modelKind || item?.geometryResult?.scene?.modelKind || item?.problemSpec?.body?.type || '';
  const aliases = {right_cylinder: 'cylinder', right_cone: 'cone'};
  if (aliases[raw]) return aliases[raw];
  if (raw) return raw;
  const types = item?.geometryResult?.scene?.elements?.map(element => element.type) || [];
  return ['pyramid', 'cylinder', 'cone', 'sphere'].find(type => types.includes(type)) || '';
};

export function findPublicProblemMatches(problem = {}) {
  const text = caseText(problem);
  const kind = geometryKind(problem);
  return PUBLIC_PROBLEM_TEMPLATES.map(template => {
    const keywordHits = template.keywords.filter(keyword => normalize(text).includes(normalize(keyword)));
    const knowledgeHits = template.knowledgePoints.filter(point => (problem.knowledgePoints || []).some(value => normalize(value).includes(normalize(point)) || normalize(point).includes(normalize(value))));
    const geometryMatch = template.geometryKinds.includes(kind);
    const score = Math.min(1, keywordHits.length * 0.16 + knowledgeHits.length * 0.2 + (geometryMatch ? 0.42 : 0) + overlap(text, template.title) * 0.35);
    if (score < 0.43) return null;
    const reasons = [
      ...(geometryMatch ? [`已验证模型类型同为${template.title.replace(/^.*的/, '')}`] : []),
      ...(knowledgeHits.length ? [`共同知识点：${knowledgeHits.join('、')}`] : []),
      ...(keywordHits.slice(0, 2).length ? [`题干共同条件：${keywordHits.slice(0, 2).join('、')}`] : [])
    ];
    return {template: structuredClone(template), score: Number(score.toFixed(2)), reasons, sharedConditions: template.sharedConditions, status: geometryMatch ? 'ready_for_revalidation' : 'reference_only'};
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

export function validatePublicTemplateUse(templateId, mistakeCase) {
  const template = PUBLIC_PROBLEM_TEMPLATES.find(item => item.id === templateId);
  if (!template) return {ok: false, code: 'PUBLIC_TEMPLATE_NOT_FOUND', message: '公共题型资源不存在或已下线。'};
  if (!template.verified) return {ok: false, code: 'PUBLIC_TEMPLATE_UNVERIFIED', message: '该公共资源尚未完成验证，不能用于模型辅助。'};
  const result = mistakeCase?.geometryResult;
  const kind = geometryKind(mistakeCase);
  if (!result || result.solverStatus !== 'verified') {
    return {ok: false, code: 'PERSONAL_MODEL_UNVERIFIED', message: '这道题尚未生成已验证的个人模型；可先参考方法，但不能直接套用公共模型。'};
  }
  if (!template.geometryKinds.includes(kind)) {
    return {ok: false, code: 'MODEL_KIND_MISMATCH', message: '公共模型与本题的已验证几何体类型不一致，不能复用。'};
  }
  return {ok: true, template: structuredClone(template), message: '已用本题自己的几何数据重新校验，可作为模型辅助理解。'};
}
