import {randomUUID} from 'node:crypto';
import {planAnalyticGeometryLesson} from './analytic-geometry-skill.mjs';
import {planChemReactionLesson} from './chem-reaction-skill.mjs';

function parseJson(text) {
  if (typeof text !== 'string') return text;
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
}

function normalizeProblemIR(ir, provenance) {
  const source = ir && typeof ir === 'object' ? structuredClone(ir) : {};
  return {
    schemaVersion: 'education-problem-ir/v1',
    ...source,
    subject: ['math', 'chemistry'].includes(source.subject) ? source.subject : 'unknown',
    domain: String(source.domain || (source.subject === 'chemistry' ? 'chemical-reaction' : 'analytic-geometry')),
    knowledgePoint: String(source.knowledgePoint || ''),
    entities: Array.isArray(source.entities) ? source.entities : [],
    relations: Array.isArray(source.relations) ? source.relations : [],
    targets: Array.isArray(source.targets) ? source.targets : [],
    givens: source.givens && typeof source.givens === 'object' ? source.givens : {},
    provenance
  };
}

function inferMathIR(text) {
  const isCircle = /圆|切线|半径|圆心|x\s*\^?2\s*\+\s*y\s*\^?2/i.test(text);
  const tangentMatch = text.match(/切线\s*([A-Z]{1,3})|([A-Z]{1,3}).{0,4}为切线/i);
  const tangentLine = tangentMatch?.[1] || tangentMatch?.[2] || (/直线\s*l.{0,8}相切/.test(text) ? 'l' : null);
  const tangentPoint = text.match(/([A-Z])\s*为切点/)?.[1] || (tangentLine && tangentLine.length > 1 ? tangentLine.slice(-1) : null);
  const circleName = text.match(/圆\s*([A-Z])/i)?.[1] || (isCircle ? 'C' : null);
  const hasCoordinates = /\([^)]*[-+]?\d+(?:\.\d+)?\s*,\s*[-+]?\d+/.test(text) || /x\s*\^?2|y\s*\^?2/i.test(text);
  const relations = [];
  if (tangentLine && tangentPoint) relations.push({type: 'tangent_at', line: tangentLine, circle: circleName === 'C' && /圆\s*O/.test(text) ? 'O' : (circleName || 'O'), point: tangentPoint});
  else if (/相切|切线/.test(text)) relations.push({type: 'unknown_tangent', line: tangentLine || 'l', conic: circleName || 'C'});
  if (/交于|交点|弦/.test(text)) relations.push({type: 'line_conic_intersection', line: tangentLine || 'l', conic: circleName || 'C'});
  const slopeTarget = /斜率/.test(text) && /切|相切/.test(text);
  return {
    schemaVersion: 'education-problem-ir/v1',
    subject: 'math',
    domain: isCircle ? 'circle' : 'analytic-geometry',
    knowledgePoint: isCircle && /切|相切/.test(text) ? '圆与切线' : isCircle ? '圆的解析几何' : '平面解析几何',
    entities: [
      ...(circleName ? [{id: circleName, type: 'circle'}] : []),
      ...(tangentPoint ? [{id: tangentPoint, type: 'tangent_point'}] : [])
    ],
    relations,
    targets: slopeTarget ? ['tangent_slope'] : [/轨迹/.test(text) ? 'locus' : /最值|范围/.test(text) ? 'range' : 'solve_relation'],
    givens: {
      hasCoordinates,
      circleEquation: /x\s*\^?2|y\s*\^?2/i.test(text) ? text : null,
      circleName: circleName || 'C',
      circleCenterName: /圆\s*O/.test(text) ? 'O' : circleName || 'C',
      externalPoint: text.match(/点\s*([A-Z])\s*\(/)?.[1] || 'P'
    },
    provenance: 'local-structured-understanding'
  };
}

function inferChemistryIR(text) {
  let knowledgePoint = '化学反应原理';
  let reactionClass = 'general';
  if (/配平|系数|守恒/.test(text)) knowledgePoint = '化学方程式配平与守恒';
  else if (/氧化还原|电子|化合价/.test(text)) knowledgePoint = '氧化还原与电子转移';
  else if (/酯化|机理|断键|成键|质子/.test(text)) { knowledgePoint = '有机反应机理'; reactionClass = 'organic-mechanism'; }
  else if (/能量|活化能|放热|吸热|速率/.test(text)) knowledgePoint = '化学反应能量与速率';
  return {
    schemaVersion: 'education-problem-ir/v1',
    subject: 'chemistry',
    domain: 'chemical-reaction',
    knowledgePoint,
    reactionClass,
    entities: [],
    relations: [],
    targets: [knowledgePoint],
    givens: {equationText: text.includes('→') || text.includes('=') ? text : null},
    provenance: 'local-structured-understanding'
  };
}

export function createLocalProblemUnderstandingAdapter() {
  return async input => {
    if (input.problemIR) return normalizeProblemIR(input.problemIR, 'provided-ir');
    const text = `${input.questionText || ''} ${input.studentMessage || ''}`;
    const chemistry = /化学|反应|配平|氧化还原|电子转移|酯化|断键|成键|→|Fe\s*\+\s*O2/i.test(text);
    if (chemistry) return inferChemistryIR(text);
    if (/立体|空间|四面体|棱柱|棱锥|线面角|二面角|异面直线/i.test(text)) {
      return normalizeProblemIR({subject: 'math', domain: 'solid-geometry', knowledgePoint: '立体几何'}, 'local-structured-understanding');
    }
    if (/圆|切线|半径|圆心|椭圆|双曲线|抛物线|圆锥曲线|直线.*曲线|x\s*\^?2|y\s*\^?2|坐标|斜率/i.test(text)) return inferMathIR(text);
    return normalizeProblemIR({subject: 'unknown', domain: 'unsupported', knowledgePoint: ''}, 'local-structured-understanding');
  };
}

export function createDeepSeekProblemUnderstandingAdapter(config = {}, fallback = createLocalProblemUnderstandingAdapter()) {
  return async input => {
    if (input.problemIR) return normalizeProblemIR(input.problemIR, 'provided-ir');
    const hasImage = /^data:image\//.test(String(input.imageDataUrl || ''));
    const endpoint = hasImage ? config.visionEndpoint : config.endpoint;
    const apiKey = hasImage ? config.visionApiKey : config.apiKey;
    const model = hasImage ? config.visionModel : config.model;
    const visualFallback = async status => {
      const local = await fallback(input);
      return normalizeProblemIR({...local, visualInputStatus: status}, 'local-visual-fallback');
    };
    if (!endpoint || !apiKey || !model) return hasImage ? visualFallback('vision-model-not-configured') : fallback(input);
    const evidence = input.interactionEvidence ? `\n学生刚才的互动操作证据：${JSON.stringify(input.interactionEvidence)}` : '';
    const prompt = `你是高中教学题目理解器。只输出结构化事实，不输出答案和隐藏思维链。\n输出严格 JSON：schemaVersion, subject(math|chemistry), domain, knowledgePoint, entities, relations, targets, givens, studentIntent, studentProgress, unresolvedNeed。\n关系必须来自题面或可靠数学/化学定义；辅助构造不要当成题目已知条件。\n题目：${input.questionText || ''}\n学生当前表达：${input.studentMessage || ''}${evidence}`;
    try {
      const content = hasImage
        ? [{type: 'text', text: prompt}, {type: 'image_url', image_url: {url: input.imageDataUrl}}]
        : prompt;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
        body: JSON.stringify({model, messages: [{role: 'user', content}], temperature: 0.1, response_format: {type: 'json_object'}})
      });
      if (!response.ok) return hasImage ? visualFallback('vision-request-failed') : fallback(input);
      const payload = await response.json();
      const result = parseJson(payload.choices?.[0]?.message?.content || '{}');
      if (!['math', 'chemistry'].includes(result.subject)) return hasImage ? visualFallback('vision-response-invalid') : fallback(input);
      return normalizeProblemIR(result, hasImage ? 'qwen-vision-structured-understanding' : 'deepseek-structured-understanding');
    } catch {
      return hasImage ? visualFallback('vision-request-failed') : fallback(input);
    }
  };
}

function inferStudentNeed(ir, input) {
  if (ir.unresolvedNeed) return ir.unresolvedNeed;
  const message = input.studentMessage || '';
  if (message) return message;
  return ir.subject === 'chemistry' ? '需要确定应观察哪一类反应变化' : '需要找到连接已知条件与目标关系的突破口';
}

function diagnoseStudentExpression(input = {}, ir = {}) {
  const text = String(input.studentMessage || '').trim();
  if (!text) return {kind: 'unknown', completedClaim: false, hintDepth: 'light', evidence: ''};
  const kind = /我想|准备|打算|可以先|我觉得/.test(text)
    ? 'intent'
    : /为什么|怎么|不会|不懂|没思路|？|\?/.test(text)
      ? 'question'
      : /所以|因此|答案|得到|等于|=/.test(text)
        ? 'conclusion'
        : 'attempt';
  const completedClaim = /已经|得到|算出|证明了|答案/.test(text) && kind !== 'intent';
  const hintDepth = ir.studentProgress?.correct === true ? 'next-step' : /不会|不懂|没思路/.test(text) ? 'guided' : 'light';
  return {kind, completedClaim, hintDepth, evidence: text};
}

function existingSolidGeometryPlan(problemIR, studentNeed) {
  return {
    skill: 'edu-solid-geometry',
    knowledgePoint: problemIR.knowledgePoint || '立体几何',
    studentNeed,
    strategy: '委托现有立体几何工作流继续处理，本层不改变其 kernel、坐标、比例、相机或 Three.js 模型。',
    teachingPath: [],
    scoringRubric: [],
    visualization: {mode: 'existing-solid-geometry', renderer: 'three', use3d: true, delegatedEndpoint: '/v1/workflows/geometry'},
    verification: {delegatedEndpoint: '/v1/workflows/geometry'}
  };
}

export function createTeachingCoach(options = {}) {
  const understand = options.understandingAdapter || createLocalProblemUnderstandingAdapter();
  return {
    async plan(input = {}) {
      const problemIR = await understand(input);
      const studentNeed = inferStudentNeed(problemIR, input);
      const studentDiagnosis = diagnoseStudentExpression(input, problemIR);
      let skillPlan;
      if (problemIR.subject === 'chemistry') skillPlan = planChemReactionLesson(problemIR, {studentNeed, studentDiagnosis});
      else if (problemIR.domain === 'solid-geometry') skillPlan = existingSolidGeometryPlan(problemIR, studentNeed);
      else if (problemIR.subject === 'math' && ['circle', 'analytic-geometry'].includes(problemIR.domain)) skillPlan = planAnalyticGeometryLesson(problemIR, {studentNeed, studentDiagnosis});
      else skillPlan = {
        skill: null,
        knowledgePoint: problemIR.knowledgePoint || '',
        studentNeed,
        strategy: '当前两个新增技能不应接管这类题目。',
        teachingPath: [],
        scoringRubric: [],
        visualization: {mode: 'none', use3d: false},
        verification: {status: 'unsupported'}
      };
      return {
        schemaVersion: 'teaching-coach-plan/v1',
        status: skillPlan.skill ? 'planned' : 'unsupported',
        subject: problemIR.subject,
        domain: problemIR.domain,
        problemIR,
        studentDiagnosis,
        decisionPolicy: 'observe-hint-operate-reason-verify-summarize',
        ...skillPlan
      };
    }
  };
}

export async function createTeachingCoachSession(input, coach = createTeachingCoach()) {
  const plan = await coach.plan(input);
  const createdAt = new Date().toISOString();
  return {
    id: randomUUID(),
    caseId: input.caseId || null,
    questionText: String(input.questionText || ''),
    problemIR: plan.problemIR,
    status: plan.status === 'unsupported' ? 'unsupported' : 'waiting_for_student',
    currentPhase: plan.teachingPath[0]?.phase || null,
    completedPhases: [],
    revealedConstructionIds: [],
    turns: [],
    latestPlan: plan,
    createdAt,
    updatedAt: createdAt
  };
}

export async function advanceTeachingCoachSession(session, input, coach = createTeachingCoach()) {
  const studentMessage = String(input.studentMessage || '').trim();
  if (!studentMessage) throw new Error('STUDENT_MESSAGE_REQUIRED');
  const plan = await coach.plan({
    questionText: session.questionText,
    problemIR: session.problemIR,
    studentMessage,
    interactionEvidence: input.interactionEvidence || null,
    learningState: {
      currentPhase: session.currentPhase,
      completedPhases: session.completedPhases,
      turns: session.turns.slice(-8)
    }
  });
  const phases = plan.teachingPath.map(item => item.phase);
  const currentIndex = Math.max(0, phases.indexOf(session.currentPhase));
  const advances = plan.studentDiagnosis.kind !== 'intent' && plan.studentDiagnosis.kind !== 'unknown';
  if (advances && phases[currentIndex]) session.completedPhases = [...new Set([...session.completedPhases, phases[currentIndex]])];
  const nextIndex = advances ? Math.min(currentIndex + 1, Math.max(0, phases.length - 1)) : currentIndex;
  session.currentPhase = phases[nextIndex] || session.currentPhase;
  const revealLimit = nextIndex + 1;
  const newlyVisible = (plan.visualization.constructions || []).filter(item => item.revealAt <= revealLimit).map(item => item.id);
  session.revealedConstructionIds = [...new Set([...session.revealedConstructionIds, ...newlyVisible])];
  const currentPrompt = plan.teachingPath[nextIndex]?.prompt || '继续说明你实际观察或完成的内容。';
  const diagnosis = plan.studentDiagnosis;
  const evidence = input.interactionEvidence;
  const evidenceLead = evidence?.kind === 'analytic' && Number.isFinite(Number(evidence.value))
    ? `我看到你把参数调到了 ${evidence.value}，并记录了画板实时读数。`
    : evidence?.kind === 'chemistry' && Number.isFinite(Number(evidence.progress))
      ? `我看到你把反应推进到 ${evidence.progress}%，当前处在第 ${evidence.step || 1} 阶段。`
      : '';
  const baseTeacherResponse = diagnosis.kind === 'intent'
    ? `这个方向值得尝试；我先按“计划”记录，不会替你当作已经完成。下一步请实际操作：${currentPrompt}`
    : plan.problemIR.studentProgress?.correct === false
      ? `这里有一个偏差，我只记录你真实做到的部分。先回到当前关系核对条件：${currentPrompt}`
      : plan.problemIR.studentProgress?.correct === true
        ? `这一步做对了，表达也已经形成有效证据。我们继续：${currentPrompt}`
        : diagnosis.kind === 'question'
          ? `你问到的是当前关键卡点。我先给一个小提示，不直接替你完成：${currentPrompt}`
          : `我已经记录你刚才实际完成的推理，不会把未说出的步骤自动补全。接下来：${currentPrompt}`;
  const teacherResponse = evidenceLead ? `${evidenceLead}${baseTeacherResponse}` : baseTeacherResponse;
  session.turns.push({studentMessage, teacherResponse, diagnosis, interactionEvidence: input.interactionEvidence || null, phaseBefore: phases[currentIndex] || null, phaseAfter: session.currentPhase, createdAt: new Date().toISOString()});
  session.latestPlan = plan;
  session.updatedAt = new Date().toISOString();
  if (session.completedPhases.includes('verification') && session.currentPhase === 'summary') session.status = 'ready_to_summarize';
  return session;
}
