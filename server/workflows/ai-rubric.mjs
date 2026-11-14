/*
 * 本题得分点的 AI 反推。
 *
 * 背景：tutor-session 的得分点优先来自几何编译（solutionOutline / queries / derivation），
 * 拿不到编译数据时回落到 RUBRIC_PROFILES.generic_math —— 那套「明确条件与目标 / 选择具体方法 /
 * 完成核心推导 / 写出并检验结果」跟具体题目无关，学生看到的就是固定 12345。
 *
 * 这里在错题确认入库后，按这道题自己反推 4~6 个得分点，写进 mistakeCase.aiRubric，
 * 陪练会话按 AI 优先（覆盖编译结果）、编译兜底、模板最后兜底的顺序取用。
 *
 * 产物形状与 tutor-session 的既有契约一致：
 *   {steps:[{id,label,hint,goal,knownResult,understanding,explanation,detect,nextQuestion,followUpQuestion}],
 *    parts:[{id,label,hint,steps:[stepId]}]}
 *   detect 必须是正则，tutor-session 用它从学生原话里判断这一步是否完成。
 */
const STEP_MIN = 3;
const STEP_MAX = 6;
const LABEL_LIMIT = 26;
const HINT_LIMIT = 120;
const TEXT_LIMIT = 4000;

const compact = (value, limit) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

/* 每一步的「可视化意图」：这一步该高亮哪些对象、该在旁边显示什么数值。
   关键点：AI 只需要把这一步涉及的实体名和数值说一遍（比如「半径 = 5」），
   前端拿到就在已经挂好的 3D 场景上本地高亮 + 标数字，
   不用让 AI 重新生成一遍模型去换一个高亮状态 —— 那才是浪费 token。 */
const VISUAL_ENTITY_LIMIT = 12;
const VISUAL_LABEL_LIMIT = 6;
function normalizeVisual(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const entities = [...new Set((Array.isArray(raw.entities) ? raw.entities : Array.isArray(raw.highlight) ? raw.highlight : [])
    .map(item => compact(item, 40)).filter(Boolean))].slice(0, VISUAL_ENTITY_LIMIT);
  const labels = (Array.isArray(raw.labels) ? raw.labels : []).map(item => {
    if (!item || typeof item !== 'object') return null;
    const text = compact(item.text ?? item.label, 40);
    const value = compact(item.value, 24);
    if (!text && !value) return null;
    return {
      text: text || value,
      value,
      unit: compact(item.unit, 8),
      // 指向哪个已有实体；没有就只显示一个数值气泡
      entity: compact(item.entity, 40) || '',
      // 已经算出来的数（AI 给的答案值）直接显示，不让前端猜
      fromAnswer: item.fromAnswer === true,
    };
  }).filter(Boolean).slice(0, VISUAL_LABEL_LIMIT);
  const focus = ['dihedral', 'section', 'radius', 'length', 'angle', 'point'].includes(String(raw.focus || ''))
    ? String(raw.focus) : '';
  const entityIds=(Array.isArray(raw.entityIds)?raw.entityIds:[]).map(x=>compact(x,80)).filter(Boolean).slice(0,12);
  const mode=['highlight','text_only'].includes(raw.mode)?raw.mode:undefined;
  if (!entities.length && !labels.length && !focus && !mode && !entityIds.length) return null;
  return {entities, labels, focus,...(mode?{mode}:{}),...(entityIds.length?{entityIds}:{}),hint:compact(raw.hint,120),reason:compact(raw.reason,160)};
}

/* 只做数学与物理两科（按用户决定的范围）。 */
export function supportsAiRubric(subject) {
  const text = String(subject || '').trim();
  if (!text) return false;
  return text.startsWith('数学') || text.startsWith('物理');
}

/* 关键词命中的字面量判定（不做正则，避免题干里的 ()/[] 之类炸掉模式）。 */
const countTerms = (text, terms) => terms.filter(term => text.includes(term)).length;

/* 由这一步的关键词构造完成判定：学生原话里命中的关键词数量达到阈值（最多 2 个）就算做到。
   没有关键词的步骤返回永不命中的判定 —— 不靠自动判定白送得分点。 */
export function buildDetectFor(keywords) {
  const terms = (Array.isArray(keywords) ? keywords : [])
    .map(item => compact(item, 24))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 8);
  const needed = Math.min(2, terms.length);
  return text => {
    if (!terms.length) return false;
    const raw = String(text || '');
    return countTerms(raw, terms) >= needed;
  };
}

/* 把模型返回的 JSON 规范成「纯数据」的 rubric。
   注意：这里刻意不放函数 —— 得分点要写进数据库、再随会话上下文取回，
   任何函数都活不过 JSON 往返。可调用的 detect 在读的时候由 aiRubricProfile 重建。 */
export function normalizeAiRubric(parsed, question = '') {
  const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const steps = [];
  for (const item of rawSteps) {
    if (!item || typeof item !== 'object') continue;
    const label = compact(item.label || item.title, LABEL_LIMIT);
    if (!label) continue;
    const id = `ai_${steps.length + 1}`;
    const keywords = (Array.isArray(item.keywords) ? item.keywords : [])
      .map(value => compact(value, 24)).filter(Boolean).slice(0, 8);
    const goal = compact(item.goal || item.detail, HINT_LIMIT);
    const why = compact(item.why || item.reason, HINT_LIMIT);
    steps.push({
      id,
      label,
      hint: compact(item.hint || (goal ? `完成：${goal}` : label), HINT_LIMIT),
      goal: goal || `完成「${label}」这一步`,
      knownResult: '',
      understanding: why,
      explanation: why || '这一步由题目自身条件推出。',
      keywords,
      nextQuestion: compact(item.nextQuestion || `说说你是怎么完成「${label}」的？`, HINT_LIMIT),
      followUpQuestion: compact(item.check || '', HINT_LIMIT),
      // 前端点这个得分点时，用它去 3D 场景上本地高亮并标注数值
      ...(normalizeVisual(item.visual) ? {visual: normalizeVisual(item.visual)} : {}),
    });
    if (steps.length >= STEP_MAX) break;
  }
  if (steps.length < STEP_MIN) return null;
  const byId = new Map(steps.map(step => [step.id, step]));
  const parts = steps.map(step => ({id: step.id, label: step.label, hint: step.hint, steps: [step.id],
    ...(byId.get(step.id)?.visual ? {visual: byId.get(step.id).visual} : {})}));
  return {steps, parts, source: 'ai_reverse', question: compact(question, 200)};
}

/* 朗读给模型的题面：题干 + 学生手写 + 知识点，够模型判断"这题要几步"。 */
const promptFor = ({question, subject, knowledgePoints, handwriting, answer, entityCatalog,modelDimension,modelParameters}) => {
  const lines = [
    `学科：${compact(subject, 20) || '未标注'}`,
    `题目：${compact(question, TEXT_LIMIT)}`,
  ];
  const points = (Array.isArray(knowledgePoints) ? knowledgePoints : []).map(item => compact(item, 24)).filter(Boolean).slice(0, 8);
  if (points.length) lines.push(`知识点：${points.join('、')}`);
  const notes = (Array.isArray(handwriting) ? handwriting : []).map(item => compact(item, 160)).filter(Boolean).slice(0, 8);
  if (notes.length) lines.push(`学生手写：${notes.join(' / ')}`);
  if (answer) lines.push(`参考答案：${compact(answer, 600)}`);
  if(modelDimension==='2d')lines.push('模型为已确认参数的二维直线与圆；不是三维模型。给定参数：'+JSON.stringify(modelParameters));
  lines.push('可用模型实体目录（为空时全部使用 text_only）：'+JSON.stringify(Array.isArray(entityCatalog)?entityCatalog:[]));
  return lines.join('\n');
};

const PROMPT = `你要把一道高中数学/物理题拆成学生可以逐步得分的解题步骤。

要求：
1. 只按这道题本身拆，不要套用通用模板（不要写「明确条件与目标」「选择具体方法」这种空话）。
2. 给 4 到 6 个步骤，按真实解题顺序排列；每一步都要是这道题里具体、可检查的动作或结论。
3. 每一步写清楚：这一步做什么、关键依据是什么、这一小步的关键词（学生原话里出现哪些词就说明做到了这一步）。
4. 关键词要写学生真会说的具体词（如「中点」「法向量」「内积」「电势」「库仑」），不要写「思路」「方法」这类泛词，每步 2~4 个。
5. 不要直接给出最终答案数值；把答案留给学生。
6. 每步必须给 visual：mode 只能 highlight 或 text_only。
   - highlight：entityIds 必须逐字引用目录中的 id，只支持目录已有的点、线、面；二维目录也支持已有圆。不能编造编号，不要引用仅在解题中需要新作的垂线、截面或法向量。
   - 无法对应唯一实体、没有模型、或这一步不需要图形时用 text_only，entityIds=[] 并填 reason，不要为填字段乱选对象。
   - hint 是一句不含答案的引导；不返回代码、颜色、透明度或执行命令。
   - labels 单独保存本步结果，未算出时为空；数值只有程序确认完成且答案解锁后才能展示，不写进 hint。

按 JSON 输出：
{"steps":[{"label":"不超过 14 字的步骤名","goal":"这一步要做什么","why":"关键依据或易错点","keywords":["关键词1","关键词2"],"nextQuestion":"问学生的一句话","check":"怎么核对这一步","visual":{"mode":"highlight","entityIds":["目录内的真实id"],"hint":"观察这条棱与底面的关系","reason":"","labels":[]}}]}`;

export function createDeepSeekAiRubricAdapter(config = {}) {
  if (!config.endpoint || !config.apiKey || !config.model) return null;
  return async payload => {
    const content = [
      {type: 'text', text: `${PROMPT}\n\n题目信息：\n${promptFor(payload || {})}`},
    ];
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs || 45000);
      try {
        const response = await (config.fetchImpl || fetch)(config.endpoint, {
          method: 'POST',
          headers: {'content-type': 'application/json', authorization: `Bearer ${config.apiKey}`},
          signal: controller.signal,
          body: JSON.stringify({model: config.model, messages: [{role: 'user', content}], temperature: 0.2, response_format: {type: 'json_object'}}),
        });
        if (!response.ok) {
          const error = Object.assign(new Error(`AI_RUBRIC_HTTP_${response.status}`), {code: `AI_RUBRIC_HTTP_${response.status}`});
          if (response.status < 500 && response.status !== 429) throw error;
          failure = error;
        } else {
          const body = await response.json();
          const raw = body?.choices?.[0]?.message?.content;
          const parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) : raw;
          const rubric = normalizeAiRubric(parsed, payload?.question);
          if (rubric) return rubric;
          failure = new Error('AI_RUBRIC_TOO_FEW_STEPS');
        }
      } catch (error) {
        failure = error?.name === 'AbortError' ? Object.assign(new Error('AI_RUBRIC_TIMEOUT'), {code: 'AI_RUBRIC_TIMEOUT'}) : error;
        if (/HTTP_(401|402|403)/.test(String(failure?.code || ''))) throw failure;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw failure || new Error('AI_RUBRIC_FAILED');
  };
}

/* 陪练取用：有 AI 反推就优先用它（用户已确认：AI 覆盖编译结果）。
   库里存的是纯数据，这里重建 tutor 需要的可调用 detect。 */
export function aiRubricProfile(caseData) {
  const rubric = caseData?.aiRubric;
  if (!rubric || !Array.isArray(rubric.steps) || !rubric.steps.length) return null;
  const steps = [];
  for (const step of rubric.steps) {
    if (!step || !step.id || !step.label) continue;
    const keywords = Array.isArray(step.keywords) && step.keywords.length ? step.keywords : [step.label];
    steps.push({...step, keywords, detect: buildDetectFor(keywords)});
  }
  if (!steps.length) return null;
  const byId = new Map(steps.map(step => [step.id, step]));
  const parts = (Array.isArray(rubric.parts) ? rubric.parts : [])
    .filter(part => part && part.id && part.steps?.some(id => byId.has(id)))
    .map(part => ({...part, steps: part.steps.filter(id => byId.has(id))}));
  const safeParts = parts.length ? parts : steps.map(step => ({id: step.id, label: step.label, hint: step.hint, steps: [step.id]}));
  return {steps, parts: safeParts, source: rubric.source || 'ai_reverse'};
}
