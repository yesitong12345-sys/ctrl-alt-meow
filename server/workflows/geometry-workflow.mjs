import {randomUUID} from 'node:crypto';

const now = () => new Date().toISOString();
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

function parseJson(text) {
  if (typeof text !== 'string') return text;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

function detectProblemType(input) {
  const text = `${input.fileName || ''} ${input.questionText || ''}`;
  if (/立体|空间|四面体|棱柱|棱锥|线面|面面|solid|3d/i.test(text)) return 'solid_geometry';
  if (/向量|vector/i.test(text)) return 'plane_vector';
  if (/圆|切线|circle|tangent/i.test(text)) return 'circle';
  return 'plane_geometry';
}

async function localVisionAdapter(input) {
  const problemType = detectProblemType(input);
  const is3d = problemType === 'solid_geometry';
  return {
    provider: 'local-demo',
    model: 'geometry-vision-fallback',
    problemType,
    questionText: input.questionText || `请核对「${input.fileName || '几何错题'}」中的题干与图形条件。`,
    studentAnswer: input.studentAnswer || '待补充学生作答过程',
    points: is3d
      ? {A: [0, 0, 0], B: [4, 0, 0], C: [0, 3, 0], D: [0, 0, 5]}
      : {A: [0, 0], B: [4, 0], C: [1, 3]},
    edges: is3d
      ? [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C'], ['B', 'D'], ['C', 'D']]
      : [['A', 'B'], ['A', 'C'], ['B', 'C']],
    relations: is3d ? ['AD⊥平面ABC'] : ['AB⊥AC'],
    labels: [],
    evidenceRegions: [],
    confidence: {
      question: input.questionText ? 0.9 : 0.62,
      diagram: input.imageData ? 0.72 : 0.58,
      relations: input.questionText ? 0.82 : 0.55
    }
  };
}

function normalizeScene(extraction) {
  const dimension = extraction.problemType === 'solid_geometry' ? 3 : 2;
  const points = {};
  for (const [name, raw] of Object.entries(extraction.points || {})) {
    if (!Array.isArray(raw)) continue;
    const coords = raw.slice(0, dimension).map(Number);
    while (coords.length < dimension) coords.push(0);
    if (coords.every(Number.isFinite)) points[name] = coords;
  }
  const edges = (extraction.edges || []).filter(edge => Array.isArray(edge) && edge.length === 2);
  return {
    schemaVersion: 'geometry-scene/v1',
    dimension,
    coordinateSystem: dimension === 3 ? 'cartesian-3d' : 'cartesian-2d',
    points,
    edges,
    relations: Array.isArray(extraction.relations) ? extraction.relations : [],
    labels: Array.isArray(extraction.labels) ? extraction.labels : [],
    provenance: {
      provider: extraction.provider || 'unknown',
      model: extraction.model || 'unknown',
      evidenceRegions: extraction.evidenceRegions || []
    }
  };
}

function validateScene(scene, extraction) {
  const issues = [];
  const warnings = [];
  const confidences = extraction.confidence || {};
  if (!extraction.questionText || clamp(confidences.question) < 0.45) issues.push('题干无法可靠识别');
  if (Object.keys(scene.points).length < 2) issues.push('图形点位不足，无法建立坐标系');
  for (const [name, point] of Object.entries(scene.points)) {
    if (point.length !== scene.dimension) issues.push(`点 ${name} 的坐标维度不一致`);
  }
  for (const edge of scene.edges) {
    if (!scene.points[edge[0]] || !scene.points[edge[1]]) issues.push(`边 ${edge.join('-')} 引用了不存在的点`);
  }
  if (!scene.relations.length) warnings.push('尚未识别平行、垂直或共面关系');
  if (clamp(confidences.diagram) < 0.6) warnings.push('图形识别置信度较低，需要学生核对');
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    confidence: Math.round(((clamp(confidences.question) + clamp(confidences.diagram) + clamp(confidences.relations)) / 3) * 100) / 100
  };
}

async function localReasoningAdapter({input, scene, validation}) {
  if (!validation.valid) {
    return {
      provider: 'local-demo',
      model: 'geometry-reasoning-fallback',
      bottleneck: '图形信息不足',
      diagnosis: '当前证据不足，不能可靠建立坐标系。',
      coordinateStrategy: '等待学生确认题干和关键点线关系。',
      derivationSteps: [],
      nextQuestion: '请补拍清晰图形，或确认你能看清哪些点、线和垂直关系？',
      confidence: 0.3
    };
  }
  const is3d = scene.dimension === 3;
  const stuck = /不知道|不会|没思路/.test(input.studentAnswer || '');
  return {
    provider: 'local-demo',
    model: 'geometry-reasoning-fallback',
    bottleneck: stuck ? '不会选择坐标原点和坐标轴' : is3d ? '空间关系坐标化' : '向量关系坐标化',
    diagnosis: is3d ? '需要把线面垂直关系转换成三个互相垂直的坐标方向。' : '需要把几何关系转换成向量坐标和数量积。',
    coordinateStrategy: is3d ? '以垂足A为原点，将AB、AC、AD分别作为坐标轴方向。' : '以A为原点，将一条已知边放在x轴上，再写出其余点坐标。',
    derivationSteps: is3d
      ? ['确认原点与三条轴的方向', '写出各点三维坐标', '用方向向量或法向量验证结论']
      : ['选择原点与x轴', '写出关键向量坐标', '用数量积或共线条件验证'],
    nextQuestion: is3d ? '如果把A设为原点，哪三条互相垂直的方向适合作为坐标轴？' : '你愿意把哪个点设为原点？这样关键向量的坐标会最简单？',
    confidence: 0.78
  };
}

function buildVisualization(scene, validation) {
  return {
    renderer: scene.dimension === 3 ? 'three' : 'svg',
    interactive: validation.valid,
    controls: scene.dimension === 3 ? ['rotate', 'zoom', 'reset', 'highlight-relation'] : ['drag-point', 'show-vector', 'show-projection'],
    scene
  };
}

async function runStage(stages, name, task) {
  const stage = {name, status: 'running', startedAt: now()};
  stages.push(stage);
  try {
    const output = await task();
    stage.status = 'completed';
    stage.completedAt = now();
    return output;
  } catch (error) {
    stage.status = 'failed';
    stage.completedAt = now();
    stage.error = error.message;
    throw error;
  }
}

export function createGeometryWorkflow(options = {}) {
  const visionAdapter = options.visionAdapter || localVisionAdapter;
  const reasoningAdapter = options.reasoningAdapter || localReasoningAdapter;
  return {
    async run(input = {}) {
      const id = input.workflowId || randomUUID();
      const stages = [];
      const extraction = await runStage(stages, 'vision_extract', () => visionAdapter(input));
      const scene = await runStage(stages, 'geometry_normalize', () => normalizeScene(extraction));
      const validation = await runStage(stages, 'geometry_validate', () => validateScene(scene, extraction));
      const tutoring = await runStage(stages, 'tutor_decide', () => reasoningAdapter({input, extraction, scene, validation}));
      const visualization = await runStage(stages, 'visualize_scene', () => buildVisualization(scene, validation));
      return {
        id,
        type: 'geometry_learning_workflow',
        status: validation.valid ? 'completed' : 'needs_review',
        createdAt: now(),
        stages,
        extraction,
        scene,
        validation,
        tutoring,
        visualization
      };
    }
  };
}

export function createQwenVisionAdapter(config = {}) {
  return async input => {
    if (!config.endpoint || !config.apiKey) return localVisionAdapter(input);
    const prompt = '识别高中几何题，输出严格JSON：problemType、questionText、studentAnswer、points、edges、relations、labels、evidenceRegions、confidence。不得猜测看不清的内容。';
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${config.apiKey}`},
      body: JSON.stringify({
        model: config.model || 'qwen2.5-vl-72b-instruct',
        messages: [{role: 'user', content: [{type: 'text', text: prompt}, ...(input.imageData ? [{type: 'image_url', image_url: {url: input.imageData}}] : [])]}],
        temperature: 0.1,
        response_format: {type: 'json_object'}
      })
    });
    if (!response.ok) throw new Error(`Qwen vision request failed: ${response.status}`);
    const payload = await response.json();
    const result = parseJson(payload.choices?.[0]?.message?.content || '{}');
    return {...result, provider: 'qwen', model: config.model || 'qwen2.5-vl-72b-instruct'};
  };
}

// DeepSeek's vision-exp endpoint accepts the same OpenAI-compatible content
// blocks, including a local image as a data URL.  Keep visual extraction
// separate from the reasoning adapter: extracted relations still go through
// schema and geometry validation before a scene is made.
export function createDeepSeekVisionAdapter(config = {}) {
  return async input => {
    if (!config.endpoint || !config.apiKey) return localVisionAdapter(input);
    if (!input.imageData) throw new Error('DEEPSEEK_VISION_IMAGE_REQUIRED');
    const prompt = `识别这张高中数学几何题图片。只输出严格 JSON，不要 Markdown。
必填字段：problemType、questionText、studentAnswer、points、edges、relations、labels、evidenceRegions、confidence、uncertainty。
若题目是圆柱、圆锥或球，额外输出 circularGeometry：
{bodyType:"right_cylinder"|"right_cone"|"sphere", quantities:{radius:{value:number,confidence:number,evidence:string},height:{value:number,confidence:number,evidence:string},slant:{value:number,confidence:number,evidence:string},planeDistance:{value:number,confidence:number,evidence:string}}, query:"volume_and_surface_area"|"axis_section"|"section_circle", section:{kind:"plane_section",throughCenter:boolean}, constructions:[{kind:string,reason:string,dependsOn:string[]}] }。
只有图片或题干中可读到的量才能进入 quantities；看不清就放 uncertainty。constructions 只列你认为解题需要补画的辅助线或截面，例如“连接球心与截面圆心”。不要根据示意图比例猜坐标、尺寸或结论。`;
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${config.apiKey}`},
      body: JSON.stringify({
        model: config.model || 'deepseek-flash',
        messages: [{role: 'user', content: [
          {type: 'text', text: prompt},
          {type: 'image_url', image_url: {url: input.imageData, detail: 'original'}}
        ]}],
        temperature: 0.1,
        response_format: {type: 'json_object'}
      })
    });
    if (!response.ok) throw new Error(`DeepSeek vision request failed: ${response.status}`);
    const payload = await response.json();
    const result = parseJson(payload.choices?.[0]?.message?.content || '{}');
    return {...result, provider: 'deepseek-vision', model: config.model || 'deepseek-flash'};
  };
}

export function createDeepSeekReasoningAdapter(config = {}) {
  return async context => {
    if (!config.endpoint || !config.apiKey || !config.model) return localReasoningAdapter(context);
    const prompt = `你是高中几何教学决策器。基于已校验的场景JSON，输出严格JSON：bottleneck、diagnosis、coordinateStrategy、derivationSteps、nextQuestion、confidence。只给可展示步骤，不输出隐藏思维链。\n${JSON.stringify({input: context.input, scene: context.scene, validation: context.validation})}`;
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${config.apiKey}`},
      body: JSON.stringify({model: config.model, messages: [{role: 'user', content: prompt}], temperature: 0.2, response_format: {type: 'json_object'}})
    });
    if (!response.ok) throw new Error(`DeepSeek reasoning request failed: ${response.status}`);
    const payload = await response.json();
    const result = parseJson(payload.choices?.[0]?.message?.content || '{}');
    return {...result, provider: 'deepseek', model: config.model};
  };
}
