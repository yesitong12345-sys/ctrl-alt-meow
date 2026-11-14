import http from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
  createDeepSeekReasoningAdapter,
  createDeepSeekVisionAdapter,
  createGeometryWorkflow,
  createQwenVisionAdapter
} from './workflows/geometry-workflow.mjs';
import {solveConfirmedGeometry} from './workflows/deterministic-geometry-solver.mjs';
import {buildPedagogicalVisualization} from './workflows/pedagogical-visualization.mjs';
import {isCleanExactAnswer, parseAllEqualPyramidText, parseDeterministicGeometryText, randomPyramidCandidate, reviewAllEqualPyramidExtraction, reviewDeterministicExtraction} from './workflows/geometry-entry.mjs';
import {auditSolidGeometryModelInput} from './workflows/solid-geometry-audit.mjs';
import {parseCircularGeometryText} from './workflows/circular-geometry-entry.mjs';
import {generateVerifiedRandomGeometry} from './workflows/geometry-random-registry.mjs';
import {adaptGeometryIRV3} from './workflows/geometry-ir-v3.mjs';
import {attachCanonicalGeometryIR} from './workflows/geometry-ir-v4-compat.mjs';
import {solveGeometryIRV3} from './workflows/geometry-v3-solver.mjs';
import {parseProjectionDihedralTriangularPyramid} from './workflows/triangular-pyramid-entry.mjs';
import {buildVerifiedCubeGeometry, parseCubeGeometryText} from './workflows/cube-geometry-entry.mjs';
import {compilePolyhedronGeometryIR} from './workflows/polyhedron-geometry-engine.mjs';
import {parseStandardPolyhedronText} from './workflows/polyhedron-geometry-entry.mjs';
import {runPolyhedronRegression} from './workflows/polyhedron-regression-library.mjs';
import {auditExamCoverage} from './workflows/exam-coverage-audit.mjs';
import {assessChemistryInput} from './workflows/chemistry-input.mjs';
import {advanceTutorSession, createDeepSeekTutorAdapter, createTutorSession, reconcileTutorSession} from './workflows/tutor-session.mjs';
import {createStudyRouter} from './workflows/study-routes.mjs';
import {createSharedLibrary} from './workflows/shared-library.mjs';
import {createDeepSeekRelationTipAdapter} from './workflows/kg-relation-tip.mjs';
import {rebuildKnowledgeGraphs, graphForUser} from './workflows/knowledge-graph.mjs';
import {findModelCache, markModelReuse, rememberModel} from './workflows/model-cache.mjs';
import {createMistakeAdminRouter} from './workflows/mistake-admin-routes.mjs';
import {tutorGeometryContext} from './workflows/geometry-rubric.mjs';
import {aiRubricProfile,supportsAiRubric} from './workflows/ai-rubric.mjs';
import {createAiRubricBuilder} from './workflows/ai-rubric-build.mjs';
import {
  advanceTeachingCoachSession,
  createDeepSeekProblemUnderstandingAdapter,
  createTeachingCoach,
  createTeachingCoachSession
} from './workflows/teaching-coach.mjs';
import {generateSkillCourse, skillCatalog} from './workflows/edulab-course-runtime.mjs';
import {createDeepSeekKnowledgeCardAdapter, createDeepSeekKnowledgeCardReviewAdapter, createKnowledgeCardEngine, createLocalEvidenceCardAdapter} from './workflows/knowledge-card-engine.mjs';
import {findPublicProblemMatches, publicTemplates, validatePublicTemplateUse} from './workflows/public-problem-library.mjs';
import {createGrade10ExampleCase, grade10ExampleCatalog} from './workflows/grade10-example-problems.mjs';
import {
  TRUSTED_GEOMETRY_VERSION_KEY,
  createAnalyticGeometryFallback,
  createDeepSeekGeometryCompilerAdapter,
  createDeepSeekGeometrySemanticReviewAdapter,
  createDeepSeekGeometryReviewAdapter,
  createTrustedGeometryPipeline,
  normalizeGeometryInput
} from './workflows/geometry-trusted-pipeline.mjs';
import {createIdentityModule} from './workflows/identity.mjs';
import {createAccountRouter} from './workflows/account-routes.mjs';
import {createJsonPersistence} from './workflows/persistence.mjs';
import {createDemoAccessGate} from './workflows/demo-access-gate.mjs';
import {createDeepSeekIntakeAdapter, createDoubaoIntakeAdapter, createIntakeDraft, confirmWrongQuestion, parseImageData, weakPointFromTutorTurn, recordTutorSignals} from './workflows/wrong-question-intake.mjs';
import {createPaperAnalysisAdapter, confirmPaperItems, paperWeakPointsFromCases, dedupeWeakPoints, paperPreflight, paperAutoFill, PAPER_MAX_PAGES_PER_BATCH, PAPER_MAX_QUESTIONS} from './workflows/paper-intake.mjs';
import {buildElectricMotionPrinciple,compileElectricFieldProblem,createDeepSeekElectricFieldGraphAdapter,normalizeGuidanceSteps} from './workflows/electric-field-problem.mjs';

/* ------------------------------------------------------------------
   统一的失败分类
   ------------------------------------------------------------------
   旧实现把所有底层错误都塞进"网络错误"，导致真正的超时被误报成网络问题，
   用户和我都被提示带偏，反复重试却永远不成功。
   这里把四类失败显式分开，前端据此显示不同文案：
     schema     —— 模型返回的 JSON 不符合契约（缺字段/结构非法）
     provider   —— AI/API 侧问题（网络、鉴权、计费、限流、超时）
     validation —— 数学验算没通过（坐标不满足硬约束）
     render     —— 几何结果无法构成可渲染场景
   ------------------------------------------------------------------ */
const FAILURE_CLASS_RULES = [
  // 明确是超时的，必须排在网络错误前面判定：两者底层都是 fetch 失败
  {class:'provider', kind:'timeout', test:codes => codes.some(code => /TIMEOUT|BUDGET_EXHAUSTED/.test(code))},
  {class:'provider', kind:'auth', test:codes => codes.some(code => /AUTH_FAILED|^HTTP40[13]$/.test(code))},
  {class:'provider', kind:'billing', test:codes => codes.some(code => /BILLING_REQUIRED|^HTTP402$/.test(code))},
  {class:'provider', kind:'rate_limit', test:codes => codes.some(code => /RATE_LIMITED|^HTTP429$/.test(code))},
  {class:'provider', kind:'network', test:codes => codes.some(code => /NETWORK_ERROR|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|PROVIDER_UNAVAILABLE/.test(code))},
  {class:'provider', kind:'http', test:codes => codes.some(code => /HTTP_ERROR|^HTTP\d{3}$/.test(code))},
  // Schema：模型返回的 JSON 不符合契约，与网络无关
  {class:'schema', kind:'invalid_response', test:codes => codes.some(code => /RESPONSE_INVALID|CONTRACT|SCHEMA|COMPILE_RESPONSE|IR_INVALID|MODEL_PARSE_FAILED|MODEL_RESPONSE_INVALID/.test(code))},
  // 几何验证：数学没算过（放在 schema 之后，避免 VALIDATION_FAILED 被 IR_INVALID 抢走无关紧要）
  {class:'validation', kind:'constraint_failed', test:codes => codes.some(code => /VALIDATION_FAILED|SOLVER_FAILED|CONSTRAINT|EVIDENCE_FAILED|UNDERDETERMINED|CONTRADICTORY|UNSUPPORTED/.test(code))},
  {class:'render', kind:'no_scene', test:codes => codes.some(code => /MODEL_DID_NOT_RETURN_RENDERABLE_COORDINATES|SCENE_|RENDER/.test(code))}
];

const FAILURE_CLASS_TEXT = {
  'provider:timeout':      '这次是【超时】：模型在限定时间内没返回完整结果。题目已保存，可直接重试。',
  'provider:network':      '这次是【网络】：请求没有到达 AI 服务（连接被重置或 DNS/代理问题）。题目已保存，可直接重试。',
  'provider:auth':         '这次是【鉴权】：API Key 无效或没有该模型权限。请到「服务与模型配置」检查。',
  'provider:billing':      '这次是【计费】：AI 账户余额不足或被限制。',
  'provider:rate_limit':   '这次是【限流】：请求太频繁，稍等片刻再试。',
  'provider:http':         '这次是【服务端错误】：AI 服务返回了错误状态。',
  'schema:invalid_response':'这次是【Schema 错误】：AI 返回的 JSON 不符合约定结构，不是网络问题。',
  'validation:constraint_failed':'这次是【几何验证未通过】：坐标没有满足题目硬约束。',
  'render:no_scene':       '这次是【渲染数据不足】：模型算出了结果，但不足以构成可渲染场景。',
  default:                 '这次建模没有成功，题目与作答已保存，可直接重试。'
};

function classifyGeometryFailure({status, failureCategory, httpStatus, error} = {}) {
  /* 统一转成大写字符串再匹配：状态码可能来自不同层，大小写不统一
     （例如 model_parse_failed 与 MODEL_PARSE_FAILED），规则表按大写写。 */
  const codes = [status, failureCategory, error?.code, error?.causeCode, httpStatus ? `HTTP${httpStatus}` : '']
    .filter(value => value !== undefined && value !== null && value !== '')
    .map(value => String(value).toUpperCase());
  for (const rule of FAILURE_CLASS_RULES) {
    if (rule.test(codes)) {
      return {
        failureClass: rule.class,
        failureKind: rule.kind,
        message: FAILURE_CLASS_TEXT[`${rule.class}:${rule.kind}`] || FAILURE_CLASS_TEXT.default,
        codes
      };
    }
  }
  return {failureClass:'unknown', failureKind:'unclassified', message:FAILURE_CLASS_TEXT.default, codes};
}


const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4180);
const API_TOKEN = process.env.API_TOKEN || '';
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === '1';
if (process.env.DEMO_DEPLOYMENT === '1' && (!AUTH_REQUIRED || !process.env.DEMO_ACCESS_PASSWORD || process.env.DEMO_ACCESS_PASSWORD.includes('GENERATE_') || !process.env.DEMO_SESSION_SECRET || process.env.DEMO_SESSION_SECRET.includes('GENERATE_') || Number(process.env.PORT) !== 80 || process.env.PORT_PROBE_LIMIT !== '1')) {
  throw new Error('DEMO_DEPLOYMENT_SECURITY_CONFIGURATION_REQUIRED');
}
const demoAccessGate = process.env.DEMO_ACCESS_PASSWORD
  ? createDemoAccessGate({password:process.env.DEMO_ACCESS_PASSWORD, allowShortPin:process.env.DEMO_ALLOW_SHORT_PIN === '1', sessionSecret:process.env.DEMO_SESSION_SECRET}) : null;
// The Android shell uses https://appassets.local while the desktop file build
// has a null origin. Requests use bearer headers but no cookies, so a wildcard
// keeps both trusted local clients usable without weakening token checks.
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 12 * 1024 * 1024);
const GEOMETRY_RETRY_BASE_MS = Math.max(10, Number(process.env.GEOMETRY_RETRY_BASE_MS || 30_000));
const TRUSTED_EXAM_DATASET_HASHES = Object.fromEntries(String(process.env.TRUSTED_EXAM_DATASET_HASHES || '').split(',').map(item=>item.trim()).filter(Boolean).map(item=>{
  const separator=item.indexOf('=');return separator>0?[item.slice(0,separator),item.slice(separator+1)]:[item,''];
}));
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(SERVER_DIR, 'data.json');
const MODEL_CONFIG_FILE = process.env.MODEL_CONFIG_FILE ? path.resolve(process.env.MODEL_CONFIG_FILE) : path.join(SERVER_DIR, 'model-config.local.json');
const UI_ROOT = path.resolve(SERVER_DIR, '..', 'implementation');
const INTAKE_IMAGE_ROOT = path.resolve(process.env.INTAKE_IMAGE_ROOT || path.join(SERVER_DIR, 'uploads', 'wrong-questions'));
const now = () => new Date().toISOString();
const randomGeometryCase = (generated, preview = true, studentId = null) => {
  const labels = {pyramid:'正四棱锥',cylinder:'圆柱',cone:'圆锥',sphere:'球'};
  return {
    id:randomUUID(),...(studentId?{studentId}:{}),subject:'数学',unit:'空间几何',question:generated.question,
    studentAnswer:'随机练习：请先独立观察模型并写出关键关系。',
    correctAnswer:generated.result.answer.displayPlain,correctAnswerLatex:generated.result.answer.latex,
    analysis:`${labels[generated.modelKind]}随机题已通过统一 geometry-ir/v3、确定性求解与独立验证。`,
    knowledgePoints:[labels[generated.modelKind],generated.modelKind==='pyramid'?'线面角':'空间模型'],
    errorCauses:[],verificationStatus:preview?'practice_preview':'verified',problemSpec:generated.problemIR,
    geometryResult:generated.result,visualization:{renderer:'three',interactive:true,scene:generated.result.scene},
    origin:preview?'verified_random_preview':'verified_random_practice',excludeFromLearningAnalytics:preview,
    randomization:generated.randomization,createdAt:now(),confirmedAt:preview?null:now()
  };
};
const missingInformationGuidance = review => {
  if (review?.status === 'unsupported' && review?.informationComplete) {
    return '题目信息已经足够，这次不能生成不是漏拍或缺条件，而是当前三维生成器尚未覆盖这种几何结构。';
  }
  if (Array.isArray(review?.missingItems) && review.missingItems.length) {
    return `要形成可验证的空间模型，目前只缺：${review.missingItems.map(item => item.label).join('、')}。补充后会直接复用原题重新解析。`;
  }
  const checks = review?.checks || {};
  const missing = [];
  if (checks.topologyMatches === false) missing.push('图形的顶点、点线面关系或特殊位置');
  if (checks.baseEdgeMatches === false || checks.heightMatches === false) missing.push('已知尺寸及其对应的边或高');
  if (checks.queryMatches === false) missing.push('所求的对象与量（例如哪条线和哪个平面的夹角）');
  return `这道题暂时还不能形成可验证的空间模型。请想一想是否遗漏了${missing.length ? missing.join('、') : '关键条件、尺寸、图形关系或所求对象'}；补充后可以继续解析，不需要重新上传。`;
};
const defaultData = () => ({
  users: [], authSessions: [],
  ingestions: [], cases: [], deletedCaseIds: [], deletedCaseOwners: {}, events: [], reviews: [], workflows: [], tutorSessions: [], coachSessions: [],
  intakeDrafts: [], weakPoints: [], dailyStudyPlanPreferences: [],
  knowledgeCards: [], knowledgeCardReviews: [], noteSources: [], cardGenerationJobs: [], sharedKnowledge: [],
  profile: {conceptMastery: [], misconceptionPatterns: [], confidenceCalibration: 0, methodCards: [], goal: ''},
  plans: [], imaSync: [], idempotency: [], publicTemplateChoices: [], graph: {schemaVersion:1, provider:'json', users:{}}, modelCache: []
});

async function loadModelConfig() {
  const defaults = {
    endpoint: process.env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/chat/completions',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  };
  if (!existsSync(MODEL_CONFIG_FILE)) return defaults;
  try {
    const saved = JSON.parse(await readFile(MODEL_CONFIG_FILE, 'utf8'));
    return {
      endpoint: saved.endpoint || defaults.endpoint,
      apiKey: saved.apiKey || defaults.apiKey,
      model: saved.model || defaults.model
    };
  } catch (error) {
    throw new Error(`MODEL_CONFIG_CORRUPTED:${error.message}`);
  }
}

let modelConfig = await loadModelConfig();

async function recognizeWrongQuestion({source,imageData = '',questionText = ''}) {
  const doubaoAdapter = createDoubaoIntakeAdapter({
    apiKey:process.env.DOUBAO_API_KEY || '',
    visionModel:process.env.DOUBAO_VISION_MODEL || '',
    textModel:process.env.DOUBAO_INTAKE_MODEL || process.env.DOUBAO_TEXT_MODEL || process.env.DOUBAO_VISION_MODEL || '',
    endpoint:process.env.DOUBAO_ENDPOINT || undefined,
    pythonBin:process.env.DOUBAO_PYTHON_BIN || process.env.PYTHON_BIN || 'python'
  });
  const deepSeekAdapter = createDeepSeekIntakeAdapter({...modelConfig,
    visionModel:process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash'});
  const adapters = source === 'image'
    ? [{name:'deepseek-vision',run:deepSeekAdapter},{name:'doubao-vision',run:doubaoAdapter}]
    : [{name:'deepseek-text',run:deepSeekAdapter},{name:'doubao-text',run:doubaoAdapter}];
  const recognitionAttempts=[];
  for (const candidate of adapters) {
    try {
      const preview=await candidate.run({imageData,questionText});
      return {preview,recognitionStatus:'suggested',recognitionProvider:candidate.name,
        recognitionError:'',recognitionAttempts};
    } catch (error) {
      const code=String(error?.code || error?.cause?.code || error?.message || 'RECOGNITION_FAILED').slice(0,100);
      recognitionAttempts.push({provider:candidate.name,code});
      console.warn(`[wrong-question-intake] ${candidate.name} failed: ${code}`);
    }
  }
  return {preview:{question:questionText,handwriting:[],subject:'未分类',knowledgePoints:[],
      errorCause:'',errorCauseEvidence:'',answer:'',steps:[]},
    recognitionStatus:'needs_manual',recognitionProvider:'',
    recognitionError:recognitionAttempts.map(item=>`${item.provider}: ${item.code}`).join(' · ') || '视觉模型未配置',
    recognitionAttempts};
}

function describeRecognitionFailure({recognitionError='',recognitionAttempts=[]}={}) {
  const deepSeekAttempt=recognitionAttempts.find(item=>String(item.provider||'').startsWith('deepseek-'));
  const code=String(deepSeekAttempt?.code||recognitionError||'视觉模型暂未返回可用识别结果');
  if (/NOT_CONFIGURED|未配置|模型未配置/i.test(code))
    return '服务器没有加载 DeepSeek 视觉配置。请使用项目启动脚本重启学习服务后再试。';
  if (/EACCES|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(code))
    return 'Node 连接 DeepSeek 被网络或代理阻断（'+code+'）。请用项目启动脚本启动服务，确认系统 HTTPS 代理可用；这不是题目错误，也不代表账户余额不足。';
  if (/HTTP_401|HTTP_403|AUTHENTICATION_REQUIRED|invalid.*key/i.test(code))
    return 'DeepSeek 密钥无效或没有视觉模型权限，请管理员检查服务端配置。';
  if (/HTTP_402|INSUFFICIENT_BALANCE|余额/i.test(code))
    return 'DeepSeek 账户余额不足，暂时无法识别照片。题目图片已保留。';
  if (/HTTP_429|RATE_LIMIT/i.test(code))
    return 'DeepSeek 请求过于频繁，请稍后重试。题目图片已保留。';
  if (/HTTP_5\d\d|TIMEOUT|network/i.test(code))
    return 'DeepSeek 图片识别服务暂时不可用（'+code+'），题目图片已保留，请稍后重试。';
  return '照片自动识别未完成：'+code+'。题目图片已保留，可手动核对或稍后重试。';
}

function buildGeometryWorkflow() {
  return createGeometryWorkflow({
    visionAdapter: modelConfig.apiKey
      ? createDeepSeekVisionAdapter({...modelConfig, model: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash'})
      : createQwenVisionAdapter({
          endpoint: process.env.QWEN_VL_ENDPOINT,
          apiKey: process.env.QWEN_API_KEY,
          model: process.env.QWEN_VL_MODEL
        }),
    reasoningAdapter: createDeepSeekReasoningAdapter(modelConfig)
  });
}

function buildTrustedGeometryPipeline() {
  if (!(modelConfig.endpoint && modelConfig.apiKey)) return null;
  const config = {
    ...modelConfig,
    visionModel: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash',
    timeoutMs:Number(process.env.DEEPSEEK_GEOMETRY_TIMEOUT_MS||300000),
    maxAttempts:Number(process.env.DEEPSEEK_GEOMETRY_MAX_ATTEMPTS||2),
    retryDelayMs:Number(process.env.DEEPSEEK_GEOMETRY_RETRY_DELAY_MS||250),
    logger:event=>console.info('[geometry-model]',JSON.stringify(event))
  };
  return createTrustedGeometryPipeline({
    modelVersion: config.model || 'deepseek-v4-flash',
    modelAdapter: createDeepSeekGeometryCompilerAdapter(config),
    // Product decision: the model's declarative geometry is rendered directly.
    // It is deliberately persisted as ai_reference, never as verified geometry.
    directModelOutput: true
  });
}

let geometryWorkflow = buildGeometryWorkflow();
let trustedGeometryPipeline = buildTrustedGeometryPipeline();
function buildTutorAdapter() {
  const useDoubao = Boolean(process.env.DOUBAO_API_KEY && process.env.DOUBAO_TUTOR_MODEL);
  const adapter = useDoubao
    ? createDeepSeekTutorAdapter({endpoint:process.env.DOUBAO_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        apiKey:process.env.DOUBAO_API_KEY,model:process.env.DOUBAO_TUTOR_MODEL,providerName:'doubao_tutor'})
    : createDeepSeekTutorAdapter(modelConfig);
  if (adapter) adapter.providerName = useDoubao ? 'doubao_tutor' : 'deepseek_tutor';
  return adapter;
}
let tutorAdapter = buildTutorAdapter();
let teachingCoach = buildTeachingCoach();
const knowledgeCardEngine = createKnowledgeCardEngine({generateCandidates:createDeepSeekKnowledgeCardAdapter(()=>modelConfig)});
const localEvidenceCardEngine = createKnowledgeCardEngine({generateCandidates:createLocalEvidenceCardAdapter()});
const knowledgeCardReviewAdapter = createDeepSeekKnowledgeCardReviewAdapter(()=>modelConfig);

function buildTeachingCoach() {
  return createTeachingCoach({
    understandingAdapter: createDeepSeekProblemUnderstandingAdapter({
      ...modelConfig,
      visionEndpoint: process.env.QWEN_VL_ENDPOINT,
      visionApiKey: process.env.QWEN_API_KEY,
      visionModel: process.env.QWEN_VL_MODEL || 'qwen2.5-vl-72b-instruct'
    })
  });
}

async function saveModelConfig(nextConfig) {
  const temporary = `${MODEL_CONFIG_FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(nextConfig, null, 2), {encoding: 'utf8', mode: 0o600});
  await rename(temporary, MODEL_CONFIG_FILE);
  modelConfig = nextConfig;
  geometryWorkflow = buildGeometryWorkflow();
  trustedGeometryPipeline = buildTrustedGeometryPipeline();
  tutorAdapter = buildTutorAdapter();
  teachingCoach = buildTeachingCoach();
}

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

const bearerToken = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
const STUDENT_SESSION_COOKIE = 'edu_student_session';
const studentCookieToken = req => {
  const entry = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${STUDENT_SESSION_COOKIE}=`));
  return entry ? entry.slice(STUDENT_SESSION_COOKIE.length + 1) : '';
};
const studentSessionCookie = (req, token, expiresAt) => {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${STUDENT_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${req.socket.encrypted ? '; Secure' : ''}`;
};
const clearStudentSessionCookie = () => `${STUDENT_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
/* 未登录也能看的公开内容：注册/登录、教材例题库，以及**共享知识广场**——
   广场上的资料本来就是学生主动公开的，登录只用来限制「发布 / 下载 / 收藏」。 */
const publicSchoolPath = (method, pathname) => (
  (method === 'POST' && (pathname === '/v1/auth/register' || pathname === '/v1/auth/login'))
  || (method === 'GET' && pathname === '/v1/public-problem-templates')
  || (method === 'GET' && pathname === '/v1/shared-knowledge')
);

function normalizeData(loaded) {
    const merged = {...defaultData(), ...loaded};
    merged.workflows = Array.isArray(merged.workflows) ? merged.workflows : [];
    merged.idempotency = Array.isArray(merged.idempotency) ? merged.idempotency : [];
    merged.tutorSessions = Array.isArray(merged.tutorSessions) ? merged.tutorSessions : [];
    merged.intakeDrafts = Array.isArray(merged.intakeDrafts) ? merged.intakeDrafts : [];
    merged.weakPoints = Array.isArray(merged.weakPoints) ? merged.weakPoints : [];
    merged.dailyStudyPlanPreferences = Array.isArray(merged.dailyStudyPlanPreferences) ? merged.dailyStudyPlanPreferences : [];
    merged.coachSessions = Array.isArray(merged.coachSessions) ? merged.coachSessions : [];
    merged.knowledgeCards = Array.isArray(merged.knowledgeCards) ? merged.knowledgeCards : [];
    merged.knowledgeCardReviews = Array.isArray(merged.knowledgeCardReviews) ? merged.knowledgeCardReviews : [];
    merged.noteSources = Array.isArray(merged.noteSources) ? merged.noteSources : [];
    merged.sharedKnowledge = Array.isArray(merged.sharedKnowledge) ? merged.sharedKnowledge : [];
    merged.cardGenerationJobs = Array.isArray(merged.cardGenerationJobs) ? merged.cardGenerationJobs : [];
    merged.publicTemplateChoices = Array.isArray(merged.publicTemplateChoices) ? merged.publicTemplateChoices : [];
    merged.graph = merged.graph && typeof merged.graph === 'object' ? merged.graph : {schemaVersion:1, provider:'json', users:{}};
    merged.modelCache = Array.isArray(merged.modelCache) ? merged.modelCache : [];
    merged.users = Array.isArray(merged.users) ? merged.users : [];
    merged.authSessions = Array.isArray(merged.authSessions) ? merged.authSessions : [];
    merged.cases = Array.isArray(merged.cases) ? merged.cases.map(attachCanonicalGeometryIR) : [];
    merged.deletedCaseIds = Array.isArray(merged.deletedCaseIds) ? merged.deletedCaseIds : [];
    merged.deletedCaseOwners = merged.deletedCaseOwners && typeof merged.deletedCaseOwners === 'object' && !Array.isArray(merged.deletedCaseOwners)
      ? merged.deletedCaseOwners : {};
    merged.ingestions = Array.isArray(merged.ingestions) ? merged.ingestions.map(item=>({
      ...item,
      ...(item.mistakeCase?{mistakeCase:attachCanonicalGeometryIR(item.mistakeCase)}:{}),
      ...(item.draft?.problemSpec||item.draft?.geometryIR?{draft:attachCanonicalGeometryIR(item.draft)}:{})
    })) : [];
    return merged;
}

const persistence = createJsonPersistence({filePath:DATA_FILE, defaultValue:defaultData, normalize:normalizeData});
let db = await persistence.load();
/* 启动时不再立刻重建知识网络图：没人读它就算了，第一次真有人打开知识网络时再算。
   这样「开机 + 十几个人各传几张卡」这条路上，一次全量重算都不会发生。
   （脏标记本身在下面声明时就初始化为 true，这里不用再赋值。） */
Object.defineProperty(db, 'graphNow', {enumerable:false, configurable:true, writable:true, value:function(){
  if (knowledgeGraphDirty || !db.graph) { db.graph = rebuildKnowledgeGraphs(db, new Date()); knowledgeGraphDirty = false; }
  return db.graph;
}});
const identity = createIdentityModule({users: db.users, sessions: db.authSessions, now});
const sharedLibrary = createSharedLibrary({db, persist, now, modelVersion: TRUSTED_GEOMETRY_VERSION_KEY, onLearningChanged: () => touchKnowledgeGraph()});
for (const job of db.workflows.filter(item => item.status === 'queued' || item.status === 'running')) {
  job.status = 'failed';
  job.error = 'server_restarted_before_completion';
  job.retryable = true;
  job.completedAt = now();
}
let workflowQueue = Promise.resolve();
const pendingIdempotency = new Map();
const geometryRetryTimers = new Map();
const geometryRetryPayloads = new Map();
const confirmedGeometryBuilds = new Map();

/* 知识网络图只由「错题」和「知识卡」决定，跟共享广场无关。
   共享广场的内容变了（发一张卡、删一张卡、收藏一份）不该顺带把全部用户的错题重算一遍。
   所以这里记一笔"图脏了"，只有真的动了错题/知识卡才重建。
   方案 1：调用方显式标记，比对比前后数组长度更省、也不会被中间修改骗到。 */
let knowledgeGraphDirty = true;
function touchKnowledgeGraph() { knowledgeGraphDirty = true; }
function persist() {
  db.cases=db.cases.map(item=>{
    const canonical=attachCanonicalGeometryIR(item);
    if(canonical!==item)Object.assign(item,canonical);
    return item;
  });
  for(const ingestion of db.ingestions){
    if(ingestion.mistakeCase)Object.assign(ingestion.mistakeCase,attachCanonicalGeometryIR(ingestion.mistakeCase));
    if(ingestion.draft?.problemSpec||ingestion.draft?.geometryIR)Object.assign(ingestion.draft,attachCanonicalGeometryIR(ingestion.draft));
  }
  if (knowledgeGraphDirty) {
    db.graph = rebuildKnowledgeGraphs(db, new Date());
    knowledgeGraphDirty = false;
  }  db.modelCache = Array.isArray(db.modelCache) ? db.modelCache.slice(0, 10) : [];
  return persistence.save(db);
}

const tutorCardSource = session => {
  const mistakeCase=db.cases.find(item=>item.id===session.caseId),turns=Array.isArray(session.turns)?session.turns:[],learning=session.learningState||{};
  const meaningful=turns.filter(turn=>String(turn.studentMessage||'').trim());
  const recentDifficulty=meaningful.filter(turn=>turn.correctness!=='correct').slice(-12);
  const confirmedProgress=meaningful.filter(turn=>turn.correctness==='correct').slice(-4);
  const selectedTurns=[...recentDifficulty,...confirmedProgress].filter((turn,index,list)=>list.findIndex(item=>item.id===turn.id)===index);
  const evidence=selectedTurns.map(turn=>({id:turn.id,kind:'tutor_turn',quote:String(turn.studentMessage).trim(),caseId:session.caseId,correctness:turn.correctness,stepId:turn.learningState?.currentStep||null}));
  (learning.studentMisconceptions||[]).forEach((item,index)=>{const quote=String(item?.evidence||item?.studentQuote||item?.message||item||'').trim();if(quote)evidence.push({id:'misconception-'+session.id+'-'+index,kind:'misconception',quote,caseId:session.caseId})});
  Object.entries(learning.knownResults||{}).forEach(([name,value],index)=>{const quote=(name+'：'+String(value?.value||value||'')).trim();if(quote)evidence.push({id:'known-result-'+session.id+'-'+index,kind:'known_result',quote,caseId:session.caseId})});
  (learning.completedSteps||[]).forEach((step,index)=>{const quote=String(step?.title||step?.label||step?.id||step||'').trim();if(quote)evidence.push({id:'completed-step-'+session.id+'-'+index,kind:'completed_step',quote,caseId:session.caseId})});
  const review=session.completionReview||learning.completionReview;
  [review?.bottleneck,review?.why,review?.nextTimeAction,review?.effectiveMethod].filter(Boolean).forEach((quote,index)=>evidence.push({id:'completion-review-'+session.id+'-'+index,kind:'completion_review',quote:String(quote),caseId:session.caseId}));
  return {
    sourceType:'tutor',studentId:session.studentId||'local-student',user_id:session.user_id||session.studentId||'local-student',caseId:session.caseId,sessionId:session.id,
    subject:mistakeCase?.subject||session.context?.subject||'数学',question:mistakeCase?.question||session.context?.question||'',
    knowledgePoint:mistakeCase?.knowledgePoints?.[0]||session.context?.knowledgePoints?.[0]||'',
    microSkill:mistakeCase?.microSkills?.[0]||mistakeCase?.learningProfile?.bottleneck||session.context?.microSkill||session.learningState?.currentGoal||'',
    evidence
  };
};

const noteCardSource = note => {
  const content=String(note.content||''),chunks=[];
  for(let start=0;start<content.length&&chunks.length<80;){
    let end=Math.min(content.length,start+1200);
    if(end<content.length){const breakAt=content.lastIndexOf('\n',end);if(breakAt>start+400)end=breakAt}
    const quote=content.slice(start,end).trim();
    if(quote)chunks.push({quote,startOffset:start,endOffset:end});
    start=end;while(start<content.length&&/\s/.test(content[start]))start+=1;
  }
  return {sourceType:'note',studentId:note.studentId||'local-student',user_id:note.user_id||note.studentId||'local-student',caseId:'note:'+note.id,subject:note.subject||'未分类',question:note.title,knowledgePoint:note.knowledgePoint||'',microSkill:'',evidence:chunks.map((chunk,index)=>({id:'note-'+note.id+'-chunk-'+(index+1),kind:'note_chunk',quote:chunk.quote,startOffset:chunk.startOffset,endOffset:chunk.endOffset,contentHash:note.contentHash,caseId:'note:'+note.id}))};
};

const cardGenerationInFlight=new Map();
let cardGenerationQueue=Promise.resolve();
const cardReviewInFlight=new Map();
let cardReviewQueue=Promise.resolve();
async function generateKnowledgeCards(jobKey,source,{engine=knowledgeCardEngine}={}){
  let job=db.cardGenerationJobs.find(item=>item.jobKey===jobKey);
  if(job?.status==='completed')return job;
  if(cardGenerationInFlight.has(jobKey))return cardGenerationInFlight.get(jobKey);
  const run=async()=>{
    let activeJob=db.cardGenerationJobs.find(item=>item.jobKey===jobKey);
    if(!activeJob){activeJob={id:randomUUID(),jobKey,user_id:source.user_id||source.studentId||'local-student',status:'queued',sourceType:source.sourceType,sourceId:source.sessionId||source.caseId,createdAt:now()};db.cardGenerationJobs.unshift(activeJob)}
    activeJob.user_id ||= source.user_id||source.studentId||'local-student';
    activeJob.status='running';activeJob.error=null;activeJob.updatedAt=now();
    try{
      const result=await engine.generate({existingCards:db.knowledgeCards,source});
      if(result.candidateCount>0&&!result.created.length&&!result.merged.length)throw new Error('KNOWLEDGE_CARD_CANDIDATES_REJECTED');
      db.knowledgeCards=result.cards;Object.assign(activeJob,{status:'completed',createdCardIds:result.created.map(item=>item.id),mergedCardIds:result.merged.map(item=>item.id),rejectedCount:result.rejected.length,completedAt:now(),updatedAt:now()});
    }catch(error){Object.assign(activeJob,{status:'failed',error:String(error.message||error),retryable:true,updatedAt:now()})}
    await persist();return activeJob;
  };
  const execution=cardGenerationQueue.then(run,run);
  cardGenerationQueue=execution.then(()=>undefined,()=>undefined);
  cardGenerationInFlight.set(jobKey,execution);
  try{return await execution}finally{cardGenerationInFlight.delete(jobKey)}
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': CORS_ORIGIN,
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(body));
}

async function sendStatic(res, fileName, contentType) {
  try {
    const content = await readFile(path.join(UI_ROOT, fileName));
    res.writeHead(200, {'content-type': contentType, 'cache-control': 'no-cache'});
    res.end(content);
  } catch {
    send(res, 404, {error: 'ui_file_not_found', file: fileName});
  }
}

async function sendSkillStatic(res, relativePath) {
  const decoded = decodeURIComponent(relativePath || '').replace(/\\/g, '/');
  const resolved = path.resolve(UI_ROOT, 'skills', decoded);
  const skillsRoot = path.resolve(UI_ROOT, 'skills') + path.sep;
  if (!resolved.startsWith(skillsRoot) || !resolved.endsWith('.html')) {
    return send(res, 404, {error: 'skill_page_not_found'});
  }
  try {
    const content = await readFile(resolved);
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache'});
    res.end(content);
  } catch {
    send(res, 404, {error: 'skill_page_not_found'});
  }
}

async function sendVendorStatic(res, relativePath) {
  const allowed = {
    'katex/katex.min.js':'application/javascript; charset=utf-8',
    'katex/auto-render.min.js':'application/javascript; charset=utf-8',
    'katex/katex.min.css':'text/css; charset=utf-8'
  };
  const decoded=decodeURIComponent(relativePath||'').replace(/\\/g,'/');
  /* KaTeX 的字体：katex.min.css 会去取 fonts/KaTeX_*.woff2|woff|ttf，
     以前不在白名单里 → 全部 404 → 公式只能用系统字体糊着显示。
     这里放行 katex/fonts/ 下的字体与许可文件，其它 vendor 路径仍按白名单走。 */
  if(/^katex\/fonts\/[A-Za-z0-9._-]+\.(woff2|woff|ttf)$/.test(decoded)){
    const ext=decoded.slice(decoded.lastIndexOf('.')+1);
    const mime=ext==='woff2'?'font/woff2':ext==='woff'?'font/woff':'font/ttf';
    return sendStatic(res,`vendor/${decoded}`,mime);
  }
  if(!allowed[decoded])return send(res,404,{error:'vendor_file_not_found'});
  return sendStatic(res,`vendor/${decoded}`,allowed[decoded]);
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('payload_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('invalid_json_body'); }
}

function workflowToDraft(result, input = {}) {
  const confidence = result.extraction.confidence || {};
  const point = result.scene.dimension === 3
    ? '立体几何空间坐标系'
    : result.extraction.problemType === 'plane_vector' ? '平面向量' : '平面几何';
  return {
    id: randomUUID(),
    workflowId: result.id,
    subject: '数学',
    unit: result.scene.dimension === 3 ? '空间几何' : '平面几何与向量',
    question: result.extraction.questionText,
    studentAnswer: result.extraction.studentAnswer || input.studentAnswer || '待补充学生作答过程',
    correctAnswer: '待学生确认后生成可展示解答',
    analysis: result.tutoring.diagnosis,
    knowledgePoints: [point],
    errorCauses: [result.tutoring.bottleneck],
    bottleneck: result.tutoring.bottleneck,
    diagramDescription: `${result.scene.dimension}D 坐标场景：${Object.keys(result.scene.points).join('、') || '待确认点位'}`,
    confidence: {
      question: confidence.question || result.validation.confidence,
      diagram: confidence.diagram || result.validation.confidence,
      answer: result.tutoring.confidence || 0.5,
      knowledgePoint: confidence.relations || result.validation.confidence
    },
    sourceRegions: result.extraction.evidenceRegions || [],
    verificationStatus: result.status === 'completed' ? 'needs_review' : 'needs_review',
    modelVersion: `${result.extraction.model} → ${result.tutoring.model}`,
    sourceImage: input.fileName || '几何错题',
    geometryScene: result.scene,
    geometryValidation: result.validation,
    tutorDecision: result.tutoring,
    visualization: result.visualization,
    createdAt: now()
  };
}

function makeVerifiedCircularCase(parsed, result, {source = 'text', fileName = '', studentId = null} = {}) {
  const bodyType = parsed.body.type;
  const bodyLabel = {right_cylinder: '圆柱', right_cone: '圆锥', sphere: '球'}[bodyType] || '圆体';
  return {
    id: randomUUID(),
    ...(studentId ? {studentId} : {}),
    subject: '数学',
    unit: '空间几何',
    question: parsed.problem.questionText,
    studentAnswer: parsed.studentAnswer || '待补充学生作答过程',
    correctAnswer: result.answer.displayPlain,
    correctAnswerLatex: result.answer.latex,
    analysis: `${bodyLabel}模型、尺寸和${parsed.query.type === 'section_circle' ? '截面' : '计算'}均由统一几何约束通过独立验证。`,
    knowledgePoints: [bodyLabel, ...(['section_circle', 'axis_section', 'parallel_base_section'].includes(parsed.query.type) ? ['截面'] : ['体积与表面积'])],
    errorCauses: [],
    verificationStatus: 'verified',
    problemSpec: parsed,
    geometryResult: {...result, constructionPlan: parsed.constructionCandidates || []},
    visualization: {renderer: 'three', interactive: true, scene: result.scene},
    modelProvenance: {source, fileName, status: 'verified', constructionCandidates: parsed.constructionCandidates || []},
    origin: 'circular_geometry_deterministic',
    createdAt: now(),
    confirmedAt: now()
  };
}

async function repairLegacyGeometryCase(legacy) {
  if (!legacy || legacy.geometryResult?.solverStatus === 'verified' || !String(legacy.question || '').trim()) return null;
  const parsedCube = parseCubeGeometryText(legacy.question);
  if (parsedCube) {
    const result = buildVerifiedCubeGeometry(parsedCube);
    return {
      ...legacy,geometryResult:result,visualization:{renderer:'three',interactive:true,scene:result.scene},
      verificationStatus:'verified',modelStatus:'verified',modelMessage:'旧正方体记录已由标准拓扑与题目棱长重新构建，并通过十二条棱的确定性校验。',
      modelProvenance:{...legacy.modelProvenance,source:'legacy_deterministic_cube_repair',status:'verified'},updatedAt:now()
    };
  }
  const parsed = parseCircularGeometryText(legacy.question, legacy.studentAnswer);
  if (!parsed || parsed.status || !parsed.body || !parsed.problem?.questionText) return null;
  const result = await solveConfirmedGeometry(parsed);
  if (result.solverStatus !== 'verified') return null;
  return {
    ...legacy,
    problemSpec: parsed,
    geometryResult: {...result, constructionPlan: parsed.constructionCandidates || []},
    visualization: {renderer: 'three', interactive: true, scene: result.scene},
    verificationStatus: 'verified',
    modelStatus: 'verified',
    modelMessage: '旧记录已由当前圆体约束引擎重新解析并通过确定性验证。',
    modelProvenance: {...legacy.modelProvenance, source: 'legacy_deterministic_repair', status: 'verified'},
    updatedAt: now()
  };
}

async function refreshLegacyPyramidGridFrame(legacy) {
  const geometry = legacy?.geometryResult;
  if (geometry?.solverStatus !== 'verified' || geometry?.adapterVersion !== 'edulab_quad_pyramid_v1'
    || geometry?.scene?.grid?.alignment === 'base_edge_xy') return null;
  const parsed = parseDeterministicGeometryText(legacy.question, legacy.studentAnswer);
  if (!parsed) return null;
  const result = await solveConfirmedGeometry(makeDeterministicRequest({
    caseId: legacy.id,
    revision: Number(legacy.revision || 1),
    templateId: parsed.templateId,
    templateVersion: parsed.templateVersion,
    parameters: parsed.parameters,
    draft: parsed.draft,
    internalReview: legacy.internalReview
  }));
  if (result.solverStatus !== 'verified') return null;
  return {
    ...legacy,
    problemSpec: {...(legacy.problemSpec || {}), parameters: parsed.parameters},
    geometryResult: result,
    visualization: {renderer: 'three', interactive: true, scene: result.scene},
    modelMessage: '模型已升级为底边对齐单位网格的教材坐标系；所有长度和关系已重新验算。',
    updatedAt: now()
  };
}

function attachLegacyPedagogy(legacy) {
  const result = legacy?.geometryResult;
  if (result?.solverStatus !== 'verified' || result?.scene?.pedagogy?.schemaVersion === 'pedagogical-visualization/v3') return null;
  const coordinates = result.canonicalCoordinates || result.finalCoordinates || result.candidateCoordinates;
  if (!coordinates || !result.scene) return null;
  const query = result.geometryIR?.queries?.[0] || legacy.problemSpec?.queries?.[0] || {};
  const verification = result.validationReport || result.validation || {checks: result.validationChecks || []};
  const pedagogy = buildPedagogicalVisualization({scene: result.scene, coordinates, query, verification});
  const geometryResult = {...result, scene: {...result.scene, pedagogy}};
  return {...legacy, geometryResult, visualization: {...legacy.visualization, renderer: 'three', interactive: true, scene: geometryResult.scene}, updatedAt: now()};
}

function refreshPolyhedronDimensions(legacy) {
  if (legacy?.geometryResult?.solverStatus !== 'verified' || !String(legacy.question || '').trim()) return null;
  const parsed = parseStandardPolyhedronText(legacy.question);
  if (!parsed || parsed.status || !Array.isArray(parsed.problemIR?.dimensions) || !parsed.problemIR.dimensions.length) return null;
  const current = new Map((legacy.geometryResult.scene?.dimensions || []).map(item => [item.id, item.label]));
  if (parsed.problemIR.dimensions.every(item => current.get(item.id) === item.label)) return null;
  const compiled = compilePolyhedronGeometryIR(parsed.problemIR);
  if (compiled.status !== 'verified') return null;
  const priorPedagogy = legacy.geometryResult.scene?.pedagogy;
  const geometryResult = {...compiled.result, scene: {...compiled.result.scene, ...(priorPedagogy ? {pedagogy: priorPedagogy} : {})}};
  return {
    ...legacy,
    problemSpec: parsed.problemIR,
    geometryResult,
    visualization: {...legacy.visualization, renderer:'three', interactive:true, scene:geometryResult.scene},
    modelMessage:'已有空间模型的题目尺寸标注已按当前题目 IR 同步。',
    updatedAt:now()
  };
}

function makeTrustedGeometryCase(input, compiled, {cacheHit = false} = {}) {
  const entityKinds = [...new Set((compiled.geometryIR?.entities || []).map(item => item.kind).filter(Boolean))];
  const caseId = randomUUID();
  const createdAt = now();
  const mistakeCase = {
    id: caseId,
    ...(input.studentId ? {studentId: input.studentId} : {}),
    subject: '数学',
    unit: '空间几何',
    question: String(input.questionText || compiled.normalizedInput?.originalInput || '').trim(),
    studentAnswer: String(input.studentAnswer || '').trim() || '待补充学生作答过程',
    // 参考模型可能已经按题意算出每一问的结果。以前这里一律替换成"待验证"，
    // 学生永远看不到结果；现在把算出的值显示出来，同时用 answerNotice 明确标注来源。
    correctAnswer: compiled.result?.answer?.displayPlain || '请结合 AI 陪练完成本题。',
    correctAnswerLatex: compiled.result?.answer?.latex || '',
    ...(compiled.status === 'ai_reference' ? {answerNotice: compiled.result?.answerNotice || '以上结果由 AI 参考模型给出，尚未经过严格数学校验。', queryAnswers: compiled.result?.queryAnswers || []} : {}),
    analysis: compiled.status === 'ai_reference'
      ? '题目已由 DeepSeek 生成可交互的空间参考模型；当前模型仍在补齐证据或约束校验，AI 陪练不会把未验证坐标当作最终答案。'
      : (compiled.solutionOutline?.length
        ? compiled.solutionOutline.join('\n')
        : '题目已由 DeepSeek 编译为统一几何约束；正式三维坐标经过证据门、逐条件验证和等价姿态标准化。'),
    solutionOutline: compiled.solutionOutline || [],
    knowledgePoints: entityKinds.length ? entityKinds : ['空间几何'],
    errorCauses: [],
    verificationStatus: compiled.status,
    problemSpec: compiled.geometryIR,
    geometryResult: compiled.result,
    visualization: {renderer: 'three', interactive: true, scene: compiled.sceneSpec},
    geometryCompilation: {
      status: compiled.status,
      stage: 'completed',
      schemaVersion: 'geometry-ir/v4',
      versionKey: TRUSTED_GEOMETRY_VERSION_KEY,
      inputHash: compiled.normalizedInput.inputHash,
      normalizedInput: compiled.normalizedInput.normalizedInput,
      conditionAtoms: compiled.normalizedInput.conditionAtoms || [],
      imageAudit: compiled.imageAudit || null,
      solution: {
        outline: compiled.solutionOutline || [],
        finalAnswer: compiled.status === 'ai_reference' ? null : compiled.finalAnswer || compiled.result?.answer || null
      },
      geometryIR: compiled.geometryIR,
      derivedFacts: compiled.derivedFacts,
      candidateCoordinates: compiled.candidateCoordinates,
      finalCoordinates: compiled.finalCoordinates,
      validation: compiled.validation,
      validationReport: compiled.validation,
      canonicalization: compiled.canonicalization,
      sceneSpec: compiled.sceneSpec,
      missingItems: [],
      attemptTrace: compiled.stageEvents || [],
      cacheHit,
      executionPath: cacheHit ? 'persistent_cache' : compiled.executionPath,
      modelVersion: compiled.result?.adapterVersion,
      providerModel: compiled.compilerModel || modelConfig.model || 'deepseek-v4-flash',
      cachedAt: createdAt
    },
    modelProvenance: {source: input.source || 'text', fileName: input.fileName || '', status: compiled.status, cacheHit},
    origin: compiled.status === 'ai_reference' ? 'deepseek_reference_geometry' : 'deepseek_trusted_geometry',
    createdAt,
    confirmedAt: createdAt
  };
  return mistakeCase;
}

async function rebuildGeometryForCase(record) {
  if (!trustedGeometryPipeline) {
    record.geometryBuildStatus='failed';record.modelStatus='provider_unavailable';
    record.modelMessage='当前没有可用的 AI 建模通道；题目已保存，模型待重试。';record.updatedAt=now();
    return {ok:false,status:record.modelStatus,message:record.modelMessage};
  }
  const payload={source:'text',questionText:String(record.question||'').trim(),studentAnswer:String(record.studentAnswer||'')};
  const reusableModel = findModelCache(db.modelCache, payload.questionText, record.subject || '数学');
  const canReuseModel = reusableModel?.versionKey === TRUSTED_GEOMETRY_VERSION_KEY && reusableModel?.compiledSnapshot?.sceneSpec;
  if (canReuseModel) markModelReuse(reusableModel);
  let compiled;
  try { compiled=canReuseModel ? structuredClone(reusableModel.compiledSnapshot) : await trustedGeometryPipeline.compileGeometryProblem(payload); }
  catch(error) {
    record.geometryBuildStatus='failed';record.modelStatus=error.code||'model_request_failed';
    record.modelMessage=`建模请求失败：${String(error.message||error)}`;record.updatedAt=now();
    return {ok:false,status:record.modelStatus,message:record.modelMessage};
  }
  if (!['verified_unique','verified_representative','ai_reference'].includes(compiled.status)) {
    const parsed=parseStandardPolyhedronText(payload.questionText);
    if(parsed&&!parsed.status) {
      const fallback=compilePolyhedronGeometryIR(parsed.problemIR);
      if(fallback.status==='verified_unique'&&fallback.result?.scene) {
        compiled={...compiled,status:'verified_unique',result:fallback.result,geometryIR:parsed.problemIR,
          normalizedInput:compiled.normalizedInput||{originalInput:payload.questionText,inputHash:createHash('sha256').update(payload.questionText).digest('hex')},
          sceneSpec:fallback.result.scene,solutionOutline:[],finalAnswer:fallback.result.answer,
          derivedFacts:fallback.derivedFacts||[],validation:fallback.validation};
      }
    }
    if (!['verified_unique','verified_representative','ai_reference'].includes(compiled.status)) {
      const message=compiled.failureCategory==='PROVIDER_TIMEOUT'
        ? 'AI 建模请求超时；题目已保存，模型可以稍后继续重试。'
        : `AI 暂未返回可展示模型（${compiled.status}）；题目已保存，模型可以稍后继续重试。`;
      record.geometryBuildStatus='failed';record.modelStatus=compiled.status;record.modelMessage=message;record.updatedAt=now();
      return {ok:false,status:compiled.status,message};
    }
  }
  if(compiled.result&&!compiled.result.scene&&compiled.sceneSpec)
    compiled={...compiled,result:{...compiled.result,scene:compiled.sceneSpec}};
  if(!compiled.result?.scene&&!compiled.sceneSpec) {
    const message='AI 已返回结果，但没有可供前端渲染的 3D 场景；题目已保存，模型待重试。';
    record.geometryBuildStatus='failed';record.modelStatus='model_parse_failed';record.modelMessage=message;record.updatedAt=now();
    return {ok:false,status:record.modelStatus,message};
  }
  const cacheHit = Boolean(canReuseModel || compiled.cacheHit);
  const rebuilt=makeTrustedGeometryCase(payload,compiled,{cacheHit});
  const cacheEntry = canReuseModel ? reusableModel : rememberModel(db.modelCache, {
    question:payload.questionText, subject:record.subject || '数学', scene:compiled.sceneSpec || compiled.result?.scene,
    generatedBy:compiled.compilerModel || compiled.result?.adapterVersion || modelConfig.model || 'deterministic-geometry', generatedAt:now()
  });
  if (cacheEntry) {
    cacheEntry.versionKey = TRUSTED_GEOMETRY_VERSION_KEY;
    cacheEntry.compiledSnapshot = structuredClone(compiled);
    rebuilt.modelUrl = cacheEntry.model_url;
    rebuilt.geometryResult = {...(rebuilt.geometryResult || {}), modelUrl:cacheEntry.model_url};
    rebuilt.visualization = {...(rebuilt.visualization || {}), modelUrl:cacheEntry.model_url};
    rebuilt.geometryCompilation = {...(rebuilt.geometryCompilation || {}), cacheHit, modelUrl:cacheEntry.model_url};
  }
  // 保留原错题身份、学生确认内容和学习进度，只更新空间模型结果。
  for(const key of ['id','createdAt','learningProfile','editHistory','subject','unit','knowledgePoints','microSkills',
    'errorCauses','errorCauseEvidence','handwrittenNotes','processSteps','stuckAt','aiSuggestion','studentCorrections','source','sourceImage',
    'confirmedAt','studentId','user_id','relatedWeakPoints','trainingAttempts','trainingMetrics','parentCaseId','transferLevel']) {
    if(record[key]!==undefined)rebuilt[key]=record[key];
  }
  rebuilt.origin=record.origin||rebuilt.origin;
  rebuilt.geometryModelRequested=record.geometryModelRequested===true;
  rebuilt.geometryBuildStatus='ready';
  rebuilt.modelStatus=compiled.status;
  rebuilt.modelMessage='';
  rebuilt.updatedAt=now();
  const targetIndex=db.cases.findIndex(item=>item.id===record.id);
  if(targetIndex>=0)db.cases[targetIndex]=rebuilt;else db.cases.unshift(rebuilt);
  db.events.push({id:randomUUID(),type:'mistake_case_model_rebuilt',caseId:record.id,
    payload:{status:compiled.status,source:'confirmed_intake'},createdAt:now()});
  return {ok:true,case:rebuilt,status:compiled.status,message:'已生成可交互的 3D 模型。'};
}

/* 本题得分点的后台反推：实现放在 workflows/ai-rubric-build.mjs，
   错题确认入库与错题库里的「重新反推」共用同一条管线。 */
const aiRubricBuilder=createAiRubricBuilder({db, persist, modelConfig,
  clock:()=>new Date(now()),
  recordEvent:({type,caseId,payload})=>db.events.push({id:randomUUID(),type,caseId,payload,createdAt:now()})});
const runConfirmedAiRubricBuild=record=>aiRubricBuilder.build(record);

async function runConfirmedGeometryBuild(record) {  const active=confirmedGeometryBuilds.get(record.id);
  if(active)return active;
  const run=(async()=>{
    record.geometryModelRequested=true;
    record.geometryBuildStatus='building';
    record.modelMessage='题目已保存，正在生成 3D 模型…';
    record.updatedAt=now();
    await persist();
    let outcome;
    try { outcome=await rebuildGeometryForCase(record); }
    catch(error) { outcome={ok:false,status:'model_request_failed',message:`建模请求失败：${String(error.message||error)}`}; }
    if(!outcome?.ok) {
      const target=db.cases.find(item=>item.id===record.id)||record;
      target.geometryModelRequested=true;
      target.geometryBuildStatus='failed';
      target.modelStatus=outcome?.status||'model_request_failed';
      target.modelMessage=outcome?.message||'建模尚未完成；题目已保存，可稍后重试。';
      target.updatedAt=now();
      db.events.push({id:randomUUID(),type:'mistake_case_model_build_failed',caseId:record.id,
        payload:{status:target.modelStatus},createdAt:now()});
    }
    await persist();
    // 建模结束（成功或失败）后接着反推本题得分点，两条后台任务都写状态供前端轮询。
    void runConfirmedAiRubricBuild(record).catch(()=>{});
    return {ok:Boolean(outcome?.ok),case:db.cases.find(item=>item.id===record.id)||record,
      status:outcome?.status||'model_request_failed',message:outcome?.message||''};
  })();
  confirmedGeometryBuilds.set(record.id,run);
  try{return await run;}finally{confirmedGeometryBuilds.delete(record.id);}
}

async function persistTrustedGeometry(input, compiled, options = {}) {
  const mistakeCase = makeTrustedGeometryCase(input, compiled, options);
  const modelCacheEntry = findModelCache(db.modelCache, input.questionText, mistakeCase.subject || input.subject || '数学');
  if (modelCacheEntry) {
    mistakeCase.modelUrl = modelCacheEntry.model_url;
    mistakeCase.geometryResult = {...(mistakeCase.geometryResult || {}), modelUrl:modelCacheEntry.model_url};
    mistakeCase.visualization = {...(mistakeCase.visualization || {}), modelUrl:modelCacheEntry.model_url};
    mistakeCase.geometryCompilation = {...(mistakeCase.geometryCompilation || {}), cacheHit:Boolean(options.cacheHit || compiled.cacheHit), modelUrl:modelCacheEntry.model_url};
  }
  const ingestion = {
    id: randomUUID(),
    ...(input.studentId ? {studentId: input.studentId} : {}),
    caseId: mistakeCase.id,
    source: input.source || 'text',
    status: compiled.status,
    workflowStatus: 'completed',
    problemIR: compiled.geometryIR,
    result: compiled.result,
    geometryCompilation: mistakeCase.geometryCompilation,
    internalReview: {
      status: compiled.status === 'ai_reference' ? 'pending_repair' : 'passed',
      independent: true,
      reviewer: 'geometry_constraint_validator_v4',
      issues: [],
      checks: compiled.validation?.checks || [],
      reviewedAt: now()
    },
    draft: mistakeCase,
    mistakeCase,
    createdAt: now()
  };
  db.cases.unshift(mistakeCase);
  db.ingestions.unshift(ingestion);
  db.events.push({id: randomUUID(), type: compiled.status === 'ai_reference' ? 'geometry_reference_created' : 'trusted_geometry_verified', caseId: mistakeCase.id, payload: {status: compiled.status, executionPath: options.cacheHit ? 'persistent_cache' : compiled.executionPath}, createdAt: now()});
  await persist();
  return ingestion;
}

async function compileGeometryWithModelCache(input) {
  if (!trustedGeometryPipeline) throw Object.assign(new Error('GEOMETRY_PIPELINE_UNAVAILABLE'), {code:'GEOMETRY_PIPELINE_UNAVAILABLE'});
  const subject = input.subject || '数学';
  const cached = findModelCache(db.modelCache, input.questionText, subject);
  if (cached?.versionKey === TRUSTED_GEOMETRY_VERSION_KEY && cached?.compiledSnapshot?.sceneSpec) {
    markModelReuse(cached);
    return {...structuredClone(cached.compiledSnapshot), cacheHit:true, executionPath:'model_cache'};
  }
  const compiled = await trustedGeometryPipeline.compileGeometryProblem(input);
  if (['verified_unique','verified_representative','ai_reference'].includes(compiled.status) && (compiled.sceneSpec || compiled.result?.scene)) {
    const entry = rememberModel(db.modelCache, {question:input.questionText, subject, scene:compiled.sceneSpec || compiled.result?.scene,
      generatedBy:compiled.compilerModel || compiled.result?.adapterVersion || modelConfig.model || 'geometry-pipeline', generatedAt:now()});
    entry.versionKey = TRUSTED_GEOMETRY_VERSION_KEY;
    entry.compiledSnapshot = structuredClone(compiled);
  }
  return compiled;
}

async function runWorkflowJob(jobId, input) {
  const job = db.workflows.find(item => item.id === jobId);
  if (!job) return;
  job.status = 'running';
  job.startedAt = now();
  await persist();
  try {
    const result = await geometryWorkflow.run({...input, workflowId: jobId});
    Object.assign(job, {status: result.status, result, stages: result.stages, completedAt: now()});
  } catch (error) {
    Object.assign(job, {status: 'failed', error: error.message, completedAt: now()});
  }
  await persist();
}

async function enqueueWorkflow(input) {
  const job = {id: randomUUID(), ...(input.studentId ? {studentId: input.studentId} : {}), type: 'geometry_learning_workflow', status: 'queued', input: {fileName: input.fileName, questionText: input.questionText, studentAnswer: input.studentAnswer}, stages: [], createdAt: now()};
  db.workflows.unshift(job);
  await persist();
  const response = {...job};
  workflowQueue = workflowQueue.catch(() => {}).then(() => runWorkflowJob(job.id, input));
  return response;
}

const DETERMINISTIC_TEMPLATE = 'regular-quad-pyramid-be-pac';
const DETERMINISTIC_TEMPLATE_VERSION = 1;
const DETERMINISTIC_QUERY = {
  type: 'line_plane_angle_sin',
  lineEndpointRoles: ['baseVertex1', 'midpointPC'],
  planePointRoles: ['apex', 'baseVertex0', 'baseVertex2']
};
const ALL_EQUAL_TEMPLATE = 'regular-quad-pyramid-all-equal-cos';
const ALL_EQUAL_TEMPLATE_VERSION = 1;

function isDeterministicTemplate(input) {
  return input.templateId === DETERMINISTIC_TEMPLATE && input.templateVersion === DETERMINISTIC_TEMPLATE_VERSION;
}

function hasValidDeterministicParameters(input) {
  const integer = value => value && value.op === 'integer' && Number.isSafeInteger(value.value) && value.value > 0 && value.value <= 10 ** 9;
  return integer(input.parameters?.baseEdge) && integer(input.parameters?.height);
}

function makeDeterministicRequest(ingestion) {
  if (ingestion.templateId === ALL_EQUAL_TEMPLATE) {
    const apex = String(ingestion.parameters?.apex || 'S');
    return {
      schemaVersion: 'geometry-ir/v1',
      caseId: ingestion.caseId,
      revision: ingestion.revision,
      lockedTemplate: {templateId: ALL_EQUAL_TEMPLATE, version: ALL_EQUAL_TEMPLATE_VERSION},
      problem: {language: 'zh-CN', questionText: ingestion.draft?.question || '棱长均相等的正四棱锥 S-ABCD 中，E 是 SC 的中点，求 AE 与 BS 所成角的余弦值。'},
      entities: [
        {id: 'body1', type: 'body', bodyType: 'regular_quad_pyramid', apex, baseVertices: ['A', 'B', 'C', 'D'], lockedByTemplate: true},
        ...['A', 'B', 'C', 'D', 'E', apex].map(id => ({id, type: 'point'})),
        {id: 'AE', type: 'segment', points: ['A', 'E'], lockedByTemplate: true},
        {id: 'BX', type: 'segment', points: ['B', apex], lockedByTemplate: true}
      ],
      relations: [
        {id: 'r-mid', type: 'midpoint', args: {point: 'E', endpoints: [apex, 'C'], resultRole: 'midpointXC'}, confirmationStatus: 'confirmed', valueOrigin: 'fixture', lockedByTemplate: true, evidenceRegion: null},
        {id: 'r-eq', type: 'all_edges_equal', args: {body: 'body1'}, confirmationStatus: 'confirmed', valueOrigin: ingestion.internalReview ? 'internal_review' : 'manual_correction', evidenceRegion: null}
      ],
      query: {type: 'segment_angle_cosine', line1: 'AE', line2: 'BX', lockedByTemplate: true}
    };
  }
  return {
    schemaVersion: 'geometry-ir/v1',
    caseId: ingestion.caseId,
    revision: ingestion.revision,
    lockedTemplate: {templateId: ingestion.templateId, version: ingestion.templateVersion},
    problem: {
      language: 'zh-CN',
      questionText: ingestion.draft?.question || '正四棱锥 P-ABCD 中，底边长为 a，高为 h，E 为 PC 中点，求 BE 与平面 PAC 所成角的正弦值。'
    },
    entities: [
      {id: 'body1', type: 'body', bodyType: 'regular_quad_pyramid', apex: 'P', baseVertices: ['A', 'B', 'C', 'D'], lockedByTemplate: true},
      ...['P', 'A', 'B', 'C', 'D', 'E'].map(id => ({id, type: 'point'})),
      {id: 'BE', type: 'segment', points: ['B', 'E'], lockedByTemplate: true},
      {id: 'PAC', type: 'plane', points: ['P', 'A', 'C'], lockedByTemplate: true}
    ],
    relations: [
      {id: 'r-base', type: 'base_edge', args: {body: 'body1', value: ingestion.parameters.baseEdge}, confirmationStatus: 'confirmed', valueOrigin: ingestion.internalReview ? 'internal_review' : 'manual_correction', evidenceRegion: null},
      {id: 'r-height', type: 'height', args: {body: 'body1', value: ingestion.parameters.height}, confirmationStatus: 'confirmed', valueOrigin: ingestion.internalReview ? 'internal_review' : 'manual_correction', evidenceRegion: null},
      {id: 'r-mid', type: 'midpoint', args: {point: 'E', endpoints: ['P', 'C'], resultRole: 'midpointPC'}, confirmationStatus: 'confirmed', valueOrigin: 'fixture', lockedByTemplate: true, evidenceRegion: null}
    ],
    query: {type: DETERMINISTIC_QUERY.type, line: 'BE', plane: 'PAC', lockedByTemplate: true}
  };
}

function buildVectorTransferGeometry(questionText) {
  const question = String(questionText || '');
  const integer = value => ({op: 'integer', value});
  const point = (x, y, z) => [integer(x), integer(y), integer(z)];
  let coordinates;
  let displayPlain;
  let latex;
  if (/方向向量为\s*\(1,2,2\).*法向量为\s*\(0,1,0\)/.test(question)) {
    coordinates = {O: point(0, 0, 0), L: point(1, 2, 2), A: point(-2, 0, -2), B: point(2, 0, -2), C: point(0, 0, 2)};
    displayPlain = '2/3';
    latex = '\\frac{2}{3}';
  } else if (/A\(0,0,0\).*B\(1,0,0\).*C\(0,1,0\).*\(1,1,1\)/.test(question)) {
    coordinates = {O: point(0, 0, 0), L: point(1, 1, 1), A: point(0, 0, 0), B: point(1, 0, 0), C: point(0, 1, 0)};
    displayPlain = '√3/3';
    latex = '\\frac{\\sqrt{3}}{3}';
  } else return null;
  const frameEdges = [['A', 'B'], ['B', 'C'], ['C', 'A'], ['O', 'L']];
  return {
    solverStatus: 'verified',
    canonicalCoordinates: coordinates,
    answer: {displayPlain, latex},
    scene: {
      grid: {unit: 1, size: 8, divisions: 8, valueSource: 'canonicalCoordinates'},
      frameEdges,
      dimensions: [{id: 'direction-length', points: ['O', 'L'], label: '方向向量', valueSource: 'canonicalCoordinates'}],
      elements: [
        ...Object.keys(coordinates).map(name => ({id: `point-${name}`, type: 'point', point: name})),
        ...frameEdges.map((points, index) => ({id: `edge-${index}`, type: 'segment', points, style: index === frameEdges.length - 1 ? 'emphasis' : 'frame'})),
        {id: 'target-plane', type: 'plane', points: ['A', 'B', 'C'], opacity: 0.25},
        {id: 'coordinate-axes', type: 'axes', size: 3}
      ]
    }
  };
}

async function createDeterministicIngestion(input) {
  const caseId = randomUUID();
  const templateId = input.templateId || DETERMINISTIC_TEMPLATE;
  const templateVersion = input.templateVersion || DETERMINISTIC_TEMPLATE_VERSION;
  const item = {
    id: randomUUID(),
    ...(input.studentId ? {studentId: input.studentId} : {}),
    caseId,
    revision: 1,
    source: input.source || 'manual',
    templateId,
    templateVersion,
    parameters: input.parameters,
    confirmedRelationIds: [],
    workflowStatus: 'awaiting_confirmation',
    createdAt: now(),
    draft: {
      id: caseId,
      ...(input.studentId ? {studentId: input.studentId} : {}),
      subject: '数学',
      unit: '立体几何',
      question: input.draft?.question || (templateId === ALL_EQUAL_TEMPLATE
        ? '棱长均相等的正四棱锥 S-ABCD 中，E 是 SC 的中点，求 AE 与 BS 所成角的余弦值。'
        : '正四棱锥 P-ABCD 中，底边长为 a，高为 h，E 为 PC 中点，求 BE 与平面 PAC 所成角的正弦值。'),
      studentAnswer: input.draft?.studentAnswer || '待补充学生作答过程',
      knowledgePoints: templateId === ALL_EQUAL_TEMPLATE ? ['正四棱锥', '异面直线夹角', '空间向量'] : ['正四棱锥', '空间向量', '线面角'],
      errorCauses: ['空间关系坐标化'],
      lockedTemplate: true,
      verificationStatus: input.draft?.extraction?.requiresConfirmation === false ? 'internal_review_pending' : 'awaiting_confirmation',
      ...(input.draft?.extraction ? {extraction: input.draft.extraction} : {})
    },
    ...(input.randomization ? {randomization: input.randomization} : {})
  };
  db.ingestions.unshift(item);
  await persist();
  return item;
}

async function createIncompleteGeometryIngestion(input) {
  const caseId = randomUUID();
  const audit = auditSolidGeometryModelInput(input);
  const failure=input.trustedGeometryFailure||{},category=failure.failureCategory||'';
  const providerBillingRequired=failure.status==='provider_billing_required'||failure.httpStatus===402;
  const providerAuthFailed=failure.status==='provider_auth_failed'||[401,403].includes(failure.httpStatus);
  const providerRateLimited=failure.status==='provider_rate_limited'||failure.httpStatus===429;
  const providerUnavailable=(failure.retryable!==false)&&(failure.status==='provider_unavailable'||failure.status==='model_request_failed'&&['PROVIDER_NETWORK_ERROR','PROVIDER_TIMEOUT','PROVIDER_HTTP_ERROR'].includes(category));
  const providerResponseInvalid=failure.status==='ir_invalid'||failure.status==='model_request_failed'&&category==='PROVIDER_RESPONSE_ERROR';
  const evidenceFailed=failure.status==='evidence_failed';
  const unsupported=failure.status==='unsupported_constraint_set';
  const validationFailed=['validation_failed','solver_failed'].includes(failure.status);
  const status = providerBillingRequired?'provider_billing_required':providerAuthFailed?'provider_auth_failed':providerRateLimited?'provider_rate_limited':providerUnavailable?'provider_pending_retry':providerResponseInvalid?'model_parse_failed':evidenceFailed?'model_evidence_failed':validationFailed?'model_validation_failed':unsupported?'model_unsupported':(audit.status === 'unsupported' ? 'model_unsupported' : 'needs_more_context');
  const modelMessage=providerBillingRequired
    ? 'DeepSeek 返回 402：当前 API 账户无法产生计费调用，请检查余额或账户计费状态。题目已保存，并继续尝试本地确定性构造。'
    :providerAuthFailed
      ? 'DeepSeek 鉴权失败：请检查 API Key 是否有效或是否具有模型访问权限。密钥不会写入错题记录或日志。'
      :providerRateLimited
        ? 'DeepSeek 当前请求过多并返回 429；系统已保留题目，可稍后重试，并继续尝试本地确定性构造。'
        :providerUnavailable
    ? 'AI 建模请求在超时与自动重试后仍不可用；题目与重试任务均已保存。这是网络或服务状态，不代表题目缺少条件。'
    :providerResponseInvalid
      ? 'AI 已返回响应，但结构化 JSON 缺字段或格式无效；系统已自动重试并转入本地构造，不会把残缺结果交给 3D 渲染。'
      :evidenceFailed
        ? 'AI 返回的结构与原题证据不一致或遗漏条件；系统不会用坐标兜底掩盖语义错误，题目已保留并可继续 AI 陪练。'
      :validationFailed
        ? 'AI 已理解并返回候选结构，但证据或几何约束校验未通过；系统已转入本地构造，未生成可能误导的模型。'
        :missingInformationGuidance(audit);
  const learningCase = {
    id: caseId, subject: '数学', unit: '立体几何', question: String(input.questionText || '').trim(),
    ...(input.studentId ? {studentId: input.studentId} : {}),
    studentAnswer: String(input.studentAnswer || '').trim() || '待补充学生作答过程',
    knowledgePoints: audit.learningDiagnosis.likelyKnowledgePoints, errorCauses: [],
    verificationStatus: 'learning_without_3d', modelStatus: status, modelAudit: audit,
    modelMessage, visualization: {renderer: 'none', reason: status},
    ...(failure.retainedCandidate?{geometryCompilation:{status:failure.status||status,stage:'retained_after_review_failure',geometryIR:failure.retainedCandidate.geometryIR,sourceCoverage:failure.retainedCandidate.sourceCoverage||[],solutionOutline:failure.retainedCandidate.solutionOutline||[],finalAnswer:failure.retainedCandidate.finalAnswer||null,candidateCoordinates:failure.retainedCandidate.candidateCoordinates,sceneSpec:failure.retainedCandidate.sceneSpec||null,validationReport:failure.validation||null}}:{}),
    extraction: {source: input.source === 'image' ? 'image_pending_supplement' : 'constraint_audit', confidence: 0, requiresConfirmation: false},
    createdAt: now(), updatedAt: now()
  };
  const item = {
    id: randomUUID(), caseId, revision: 1, source: input.source || 'text',
    ...(input.studentId ? {studentId: input.studentId} : {}),
    templateId: DETERMINISTIC_TEMPLATE, templateVersion: DETERMINISTIC_TEMPLATE_VERSION,
    status, workflowStatus: status, modelingMode: input.modelingMode || 'model_first', modelAttemptTrace: Array.isArray(input.modelAttemptTrace) ? input.modelAttemptTrace : [], createdAt: now(),
    ...(learningCase.geometryCompilation?{geometryCompilation:learningCase.geometryCompilation}:{}),
    modelAudit: audit, guidance:modelMessage, supplementHistory: [], trustedGeometryFailure:input.trustedGeometryFailure||null,
    ...(status==='provider_pending_retry'?{geometryRetry:{status:'queued',attempts:0,maxAttempts:3,nextAttemptAt:new Date(Date.now()+GEOMETRY_RETRY_BASE_MS).toISOString(),input:{source:input.source||'text',questionText:String(input.questionText||''),studentAnswer:String(input.studentAnswer||''),fileName:String(input.fileName||''),mimeType:String(input.mimeType||''),imageHash:input.imageData?createHash('sha256').update(String(input.imageData)).digest('hex'):null,studentId:input.studentId||null,modelingMode:'model_first'}}}:{}),
    ...(input.fileName ? {fileName: input.fileName} : {}),
    draft: learningCase, mistakeCase: learningCase
  };
  db.cases = [learningCase, ...db.cases.filter(entry => entry.id !== caseId)];
  if(status==='provider_pending_retry')geometryRetryPayloads.set(item.id,{...item.geometryRetry.input,imageData:String(input.imageData||'')});
  db.ingestions.unshift(item); await persist();
  if(status==='provider_pending_retry')scheduleTrustedGeometryRetry(item.id);
  return item;
}

/* ------------------------------------------------------------------
   异步几何建模作业
   ------------------------------------------------------------------
   为什么要异步：一份完整的立体几何编译（IR + 证据 + 坐标 + 解题步骤 + 小问视图）
   实测要 80~150 秒。让一个 HTTP 请求挂那么久，浏览器、代理或网关随时可能断开，
   用户也看不到任何进展，只能干等。改成"立刻返回作业号 + 前端轮询"之后：
     - HTTP 请求 0.3 秒内返回，不再受长连接稳定性影响；
     - 前端能显示真实的阶段提示；
     - 服务端进程不会因为客户端断开而中断编译。
   作业状态只放内存：编译结果本身会持久化到 data.json 的 ingestion 记录里，
   重启后依然可以按 ingestion 恢复，不会丢题。
   ------------------------------------------------------------------ */
const geometryJobs = new Map();
const GEOMETRY_JOB_TTL_MS = 30 * 60 * 1000;

const GEOMETRY_JOB_STAGES = [
  {stage:'understanding', from:0, message:'正在理解题目…'},
  {stage:'relating', from:20, message:'正在构建空间关系…'},
  {stage:'validating', from:55, message:'正在验证几何约束…'},
  {stage:'building', from:80, message:'正在生成 3D 模型…'}
];

function findVerifiedGeometryCache(input, normalized) {
  return db.cases.find(item => (!AUTH_REQUIRED || item.studentId === input.studentId)
    && item.geometryCompilation?.inputHash === normalized.inputHash
    && item.geometryCompilation?.versionKey === TRUSTED_GEOMETRY_VERSION_KEY
    && item.geometryCompilation?.providerModel === (modelConfig.model || 'deepseek-v4-flash')
    && item.geometryResult?.solverStatus === 'verified');
}

function compiledFromCachedCase(cachedCase) {
  return {
    status: cachedCase.verificationStatus || 'verified_representative',
    executionPath: 'persistent_cache',
    normalizedInput: cachedCase.geometryCompilation?.normalizedInput,
    geometryIR: cachedCase.problemSpec,
    solutionOutline: cachedCase.geometryCompilation?.solution?.outline || cachedCase.solutionOutline || [],
    finalAnswer: cachedCase.geometryCompilation?.solution?.finalAnswer || cachedCase.geometryResult?.answer || null,
    derivedFacts: cachedCase.geometryCompilation?.derivedFacts || [],
    candidateCoordinates: cachedCase.geometryCompilation?.candidateCoordinates || cachedCase.geometryCompilation?.finalCoordinates,
    finalCoordinates: cachedCase.geometryCompilation?.finalCoordinates,
    canonicalization: cachedCase.geometryCompilation?.canonicalization,
    validation: cachedCase.geometryCompilation?.validation,
    sceneSpec: cachedCase.geometryResult?.scene,
    result: cachedCase.geometryResult
  };
}

function sweepGeometryJobs() {
  const nowMs = Date.now();
  for (const [id, job] of geometryJobs) {
    const finished = ['completed', 'failed'].includes(job.status);
    if (finished && nowMs - Date.parse(job.finishedAt || job.updatedAt) > GEOMETRY_JOB_TTL_MS) geometryJobs.delete(id);
  }
}

function createGeometryJob(input, normalized) {
  sweepGeometryJobs();
  const id = `geometry_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const job = {
    id,
    status: 'processing',
    stage: 'understanding',
    progress: 0,
    message: GEOMETRY_JOB_STAGES[0].message,
    createdAt: now(),
    updatedAt: now(),
    startedAtMs: Date.now(),
    ingestionId: null,
    caseId: null,
    result: null,
    // 只保留编译需要的字段，避免把整包请求长期驻留内存
    input: {
      questionText: input.questionText,
      studentAnswer: input.studentAnswer,
      studentId: input.studentId,
      schoolId: input.schoolId,
      source: input.source || 'text',
      fileName: input.fileName,
      mimeType: input.mimeType,
      imageData: input.imageData,
      modelingMode: input.modelingMode,
      modelAttemptTrace: []
    },
    normalized
  };
  geometryJobs.set(id, job);
  return job;
}

function updateGeometryJobProgress(job) {
  // 编译过程中没有细粒度回调，这里按经过时间给出诚实的阶段估计（不假装精确）。
  const elapsed = Date.now() - job.startedAtMs;
  let picked = GEOMETRY_JOB_STAGES[0];
  for (const entry of GEOMETRY_JOB_STAGES) {
    const budget = entry.from / 100;
    if (elapsed >= budget * 150000) picked = entry;
  }
  // 至少停在最后一个阶段，不要在等模型时反复跳回去
  if (GEOMETRY_JOB_STAGES.indexOf(picked) < GEOMETRY_JOB_STAGES.indexOf(job.stage)) return;
  if (picked.stage !== job.stage) {
    job.stage = picked.stage;
    job.message = picked.message;
  }
  job.progress = Math.min(95, Math.round((elapsed / 150000) * 100));
  job.updatedAt = now();
}

/* 本地确定性建模：正方体 → 标准多面体 IR。
   与「同步录入」路径（见后面 parseCubeGeometryText / parseStandardPolyhedronText 那两段）
   用的是同一套解析器与构造器，构造出的 mistakeCase 形状完全一致，
   避免同一个模型在两条路径下出现两种结构。命中返回可入库的对象，不命中返回 null。 */
function buildDeterministicGeometryCase(input) {
  const questionText = String((input && input.questionText) || '').trim();
  if (!questionText || input.templateId) return null;
  const studentIdPart = input.studentId ? {studentId: input.studentId} : {};
  const studentAnswer = String(input.studentAnswer || '').trim() || '待开始真实作答';

  const cubeIR = parseCubeGeometryText(questionText);
  if (cubeIR) {
    const result = buildVerifiedCubeGeometry(cubeIR);
    if (result && result.scene) {
      const caseId = randomUUID(), createdAt = now();
      return {
        traceStage: 'deterministic_cube', templateId: 'cube-standard-topology',
        result, problemIR: null, queryResults: null, goalResult: null, createdAt,
        mistakeCase: {
          id: caseId, ...studentIdPart, subject: '数学', unit: '空间几何', question: cubeIR.text,
          studentAnswer, correctAnswer: '请逐项验证后作答', correctAnswerLatex: '',
          analysis: '正方体基础模型由棱长和标准拓扑确定；各选项的辅助构造由当前小问独立驱动。',
          knowledgePoints: ['正方体', '空间关系'], microSkills: ['用坐标与空间关系逐项验证'], errorCauses: [],
          verificationStatus: 'verified', geometryResult: result,
          visualization: {renderer: 'three', interactive: true, scene: result.scene},
          origin: 'cube_geometry_deterministic', createdAt, confirmedAt: createdAt
        }
      };
    }
  }

  const polyhedronInput = parseStandardPolyhedronText(questionText);
  if (polyhedronInput && !polyhedronInput.status) {
    const compiled = compilePolyhedronGeometryIR(polyhedronInput.problemIR);
    if (compiled.status === 'verified_unique' && compiled.result && compiled.result.scene) {
      const result = compiled.result, caseId = randomUUID(), createdAt = now();
      return {
        traceStage: 'deterministic_polyhedron', templateId: 'polyhedron-ir-v1',
        result, problemIR: polyhedronInput.problemIR, queryResults: compiled.queryResults,
        goalResult: compiled.goalResult, createdAt,
        mistakeCase: {
          id: caseId, ...studentIdPart, subject: '数学', unit: '空间几何', question: polyhedronInput.questionText,
          studentAnswer, correctAnswer: result.answer.displayPlain, correctAnswerLatex: '',
          analysis: '本题已进入统一多面体 IR；拓扑、空间角/距离和截面均由确定性几何内核逐项验证。',
          knowledgePoints: polyhedronInput.labels,
          microSkills: ['从点线面约束建立模型', '用投影或法向量计算空间关系', '用截平面与棱求真实交点'],
          errorCauses: [], verificationStatus: 'verified', modelStatus: 'verified',
          goalResult: compiled.goalResult, problemSpec: polyhedronInput.problemIR,
          geometryResult: result, visualization: {renderer: 'three', interactive: true, scene: result.scene},
          origin: 'polyhedron_geometry_deterministic', createdAt, confirmedAt: createdAt
        }
      };
    }
  }

  // 旋转体（圆柱/圆锥/球）的本地兜底暂未接入，见 PARALLEL-TASKS.md 的待办
  return null;
}

async function startGeometryJob(job) {
  try {
    const compiled = await compileGeometryWithModelCache(job.input);
    updateGeometryJobProgress(job);
    if (!compiled) throw new Error('GEOMETRY_PIPELINE_UNAVAILABLE');
    if (['verified_unique', 'verified_representative', 'ai_reference'].includes(compiled.status)) {
      const ingestion = await persistTrustedGeometry(job.input, compiled, {cacheHit: Boolean(compiled.cacheHit)});
      job.ingestionId = ingestion?.id || null;
      job.caseId = ingestion?.caseId || null;
      job.status = 'completed';
      job.stage = 'ready';
      job.progress = 100;
      job.message = '模型已生成';
      job.result = {...ingestion, modelingMode:'model_first', modelAttemptTrace:job.input.modelAttemptTrace};
    } else {
      /* 学生在识别题目时就勾了「优先生成 3D 模型」。正方体 / 标准多面体这类题，
         本地几何内核本来就能建模 —— 同步录入路径就是先试它、再调 AI。
         异步作业路径以前漏了这一步：AI 当次没跑通就直接留成“建模未完成”，
         学生只好自己再点一次「重新生成」。这里把同一套本地建模补上。 */
      const deterministic = buildDeterministicGeometryCase(job.input);
      if (deterministic) {
        job.input.modelAttemptTrace.push({stage: deterministic.traceStage, status: 'verified'});
        const item = {
          id: randomUUID(), caseId: deterministic.mistakeCase.id, source: 'text',
          templateId: deterministic.templateId, status: 'verified', workflowStatus: 'completed',
          modelingMode: 'model_first', modelAttemptTrace: job.input.modelAttemptTrace,
          result: deterministic.result,
          ...(deterministic.problemIR ? {problemIR: deterministic.problemIR} : {}),
          ...(deterministic.queryResults ? {queryResults: deterministic.queryResults} : {}),
          ...(deterministic.goalResult ? {goalResult: deterministic.goalResult} : {}),
          draft: deterministic.mistakeCase, mistakeCase: deterministic.mistakeCase,
          ...(job.input.studentId ? {studentId: job.input.studentId} : {}),
          createdAt: deterministic.createdAt
        };
        db.cases.unshift(deterministic.mistakeCase);
        db.ingestions.unshift(item);
        await persist();
        job.ingestionId = item.id;
        job.caseId = deterministic.mistakeCase.id;
        job.status = 'completed';
        job.stage = 'ready';
        job.progress = 100;
        job.message = 'AI 未生成，已由本地几何内核直接建模';
        job.result = {...item};
      } else {
      // 降级：四类失败分开归类，前端据此显示"超时/网络/Schema/几何验证"而不是笼统的网络错误
      job.input.modelAttemptTrace.push({stage:'deepseek_validator',status:'failed',result:compiled.status});
      const classified = classifyGeometryFailure({
        status: compiled.status,
        failureCategory: compiled.failureCategory,
        httpStatus: compiled.httpStatus,
        error: {code: compiled.failureCategory}
      });
      const failure = {
        status: compiled.status,
        failureCategory: compiled.failureCategory || null,
        // 具体没通过的约束：让用户/前端能看到"哪一条几何关系不成立"
        failedConstraints: compiled.validation?.failedConstraints || [],
        residual: compiled.validation?.residual ?? null,
        retryable: compiled.retryable !== false,
        validation: compiled.validation || null,
        gateIssues: compiled.gate?.issues || [],
        ...classified
      };
      const ingestion = await createIncompleteGeometryIngestion({...job.input, trustedGeometryFailure: failure});
      job.ingestionId = ingestion?.id || null;
      job.caseId = ingestion?.caseId || null;
      job.status = 'failed';
      job.progress = 100;
      job.message = classified.message;
      job.failure = {code: compiled.status || compiled.failureCategory || 'GEOMETRY_NOT_VERIFIED', message: classified.message,
        failureClass: classified.failureClass, failureKind: classified.failureKind, codes: classified.codes,
        failedConstraints: failure.failedConstraints, residual: failure.residual};
      job.result = {...ingestion, failure};
      }
    }
  } catch (error) {
    job.status = 'failed';
    job.progress = 100;
    const classified = classifyGeometryFailure({error});
    job.message = classified.message;
    job.failure = {code: error?.code || 'GEOMETRY_JOB_FAILED', message: classified.message,
      failureClass: classified.failureClass, failureKind: classified.failureKind, codes: classified.codes,
      detail: String(error?.message || error).slice(0, 300)};
  } finally {
    job.finishedAt = now();
    job.updatedAt = now();
  }
}



function scheduleTrustedGeometryRetry(ingestionId){
  const ingestion=db.ingestions.find(entry=>entry.id===ingestionId),retry=ingestion?.geometryRetry;
  if(!retry||retry.status!=='queued'||geometryRetryTimers.has(ingestionId))return;
  const delay=Math.max(0,new Date(retry.nextAttemptAt||Date.now()).getTime()-Date.now());
  const timer=setTimeout(()=>{
    geometryRetryTimers.delete(ingestionId);
    void runTrustedGeometryRetry(ingestionId);
  },delay);
  timer.unref?.();
  geometryRetryTimers.set(ingestionId,timer);
}

async function runTrustedGeometryRetry(ingestionId){
  const ingestion=db.ingestions.find(entry=>entry.id===ingestionId),retry=ingestion?.geometryRetry;
  if(!ingestion||!retry||retry.status!=='queued')return;
  retry.attempts+=1;
  retry.status='running';
  retry.lastAttemptAt=now();
  await persist();
  try{
    if(!trustedGeometryPipeline)throw Object.assign(new Error('geometry provider is not configured'),{code:'PROVIDER_NOT_CONFIGURED'});
    const retryInput=geometryRetryPayloads.get(ingestionId)||retry.input;
    if(retryInput.source==='image'&&!retryInput.imageData)throw Object.assign(new Error('image retry requires the student to resubmit the original image after restart'),{code:'IMAGE_RETRY_PAYLOAD_UNAVAILABLE',retryable:false});
    const compiled=await compileGeometryWithModelCache(retryInput);
    if(!['verified_unique','verified_representative','ai_reference'].includes(compiled.status))throw Object.assign(new Error(`geometry retry ended as ${compiled.status}`),{code:compiled.failureCategory||compiled.status});
    const replacementCase=makeTrustedGeometryCase(retry.input,compiled,{cacheHit:Boolean(compiled.cacheHit)});
    replacementCase.id=ingestion.caseId;
    const existingCaseIndex=db.cases.findIndex(entry=>entry.id===ingestion.caseId);
    if(existingCaseIndex>=0)db.cases[existingCaseIndex]=replacementCase;else db.cases.unshift(replacementCase);
    Object.assign(ingestion,{status:compiled.status,workflowStatus:'completed',problemIR:compiled.geometryIR,result:compiled.result,geometryCompilation:replacementCase.geometryCompilation,draft:replacementCase,mistakeCase:replacementCase,internalReview:{status:compiled.status==='ai_reference'?'pending_repair':'passed',independent:true,reviewer:'geometry_constraint_validator_v4',issues:[],checks:compiled.validation?.checks||[],reviewedAt:now()}});
    Object.assign(retry,{status:'completed',completedAt:now(),input:undefined});
    geometryRetryPayloads.delete(ingestionId);
    db.events.push({id:randomUUID(),type:'trusted_geometry_retry_completed',caseId:ingestion.caseId,payload:{status:compiled.status,attempts:retry.attempts},createdAt:now()});
  }catch(error){
    retry.lastError={category:error?.code||'STAGE_EXECUTION_FAILED',message:String(error?.message||error)};
    if(error?.retryable===false||retry.attempts>=retry.maxAttempts){retry.status='failed';retry.completedAt=now();ingestion.status=ingestion.workflowStatus='provider_unavailable';geometryRetryPayloads.delete(ingestionId);}
    else{
      retry.status='queued';
      retry.nextAttemptAt=new Date(Date.now()+GEOMETRY_RETRY_BASE_MS*Math.pow(2,retry.attempts-1)).toISOString();
    }
  }
  await persist();
  if(retry.status==='queued')scheduleTrustedGeometryRetry(ingestionId);
}

function workflowStatusForSolver(solverStatus) {
  return solverStatus === 'solver_failed' ? 'failed' : 'completed';
}

async function runDeterministicJob(jobId, ingestionId) {
  const job = db.workflows.find(item => item.id === jobId);
  const ingestion = db.ingestions.find(item => item.id === ingestionId);
  if (!job || !ingestion) return;
  Object.assign(job, {status: 'running', workflowStatus: 'running', startedAt: now()});
  await persist();
  try {
    const result = await solveConfirmedGeometry(makeDeterministicRequest(ingestion));
    const workflowStatus = workflowStatusForSolver(result.solverStatus);
    Object.assign(job, {
      status: workflowStatus,
      workflowStatus,
      solverStatus: result.solverStatus,
      result,
      completedAt: now()
    });
    ingestion.workflowStatus = workflowStatus;
    ingestion.solverStatus = result.solverStatus;
    if (result.solverStatus === 'verified') {
    const allEqual = ingestion.templateId === ALL_EQUAL_TEMPLATE;
    const apex = String(ingestion.parameters?.apex || 'S');
    const mistakeCase = {
      ...ingestion.draft,
      id: ingestion.caseId,
      correctAnswer: result.answer.displayPlain,
      correctAnswerLatex: result.answer.latex,
      analysis: allEqual
        ? '以底面中心为原点建立坐标系，由“棱长均相等”导出高 h=a/√2，用向量内积求异面直线 AE 与 B' + apex + ' 所成角的余弦（与尺度无关）。'
        : '以底面中心为原点建立空间直角坐标系，用直线方向向量与平面法向量求线面角正弦。',
      verificationStatus: 'verified',
      internalReview: ingestion.internalReview,
      problemSpec: allEqual ? {
        schemaVersion: 'geometry-problem/v1',
        templateId: ingestion.templateId,
        templateVersion: ingestion.templateVersion,
        parameters: ingestion.parameters,
        topology: {body: apex + '-ABCD', allEdgesEqual: true, midpoint: {point: 'E', segment: apex + 'C'}},
        query: {type: 'segment_angle_cosine', line1: 'AE', line2: 'B' + apex}
      } : {
        schemaVersion: 'geometry-problem/v1',
        templateId: ingestion.templateId,
        templateVersion: ingestion.templateVersion,
        parameters: ingestion.parameters,
        topology: {body: 'P-ABCD', midpoint: {point: 'E', segment: 'PC'}},
        query: {type: 'line_plane_angle_sin', line: 'BE', plane: 'PAC'}
      },
      solverVersion: result.adapterVersion,
      geometryResult: result,
      visualization: {renderer: 'three', interactive: true, scene: result.scene},
      confirmedAt: now(),
      createdAt: ingestion.createdAt
    };
      db.cases = [mistakeCase, ...db.cases.filter(item => item.id !== mistakeCase.id)];
      job.mistakeCase = mistakeCase;
    }
  } catch (error) {
    Object.assign(job, {status: 'failed', workflowStatus: 'failed', solverStatus: 'solver_failed', error: error.message, completedAt: now()});
    ingestion.workflowStatus = 'failed';
    ingestion.solverStatus = 'solver_failed';
  }
  await persist();
}

async function enqueueDeterministicWorkflow(ingestion, jobId = randomUUID()) {
  const job = {
    id: jobId,
    ...(ingestion.studentId ? {studentId: ingestion.studentId} : {}),
    caseId: ingestion.caseId,
    revision: ingestion.revision,
    type: 'deterministic_geometry_workflow',
    status: 'queued',
    workflowStatus: 'queued',
    solverStatus: 'not_started',
    createdAt: now()
  };
  db.workflows.unshift(job);
  ingestion.workflowStatus = 'queued';
  await persist();
  workflowQueue = workflowQueue.catch(() => {}).then(() => runDeterministicJob(job.id, ingestion.id));
  return job;
}

async function enqueueInternallyReviewedIngestion(ingestion) {
  if (ingestion.templateId === ALL_EQUAL_TEMPLATE) {
    // 全等棱锥模板：题目自带“棱长均相等”，形状完全确定，角度与尺度无关，
    // 由独立的约束复核确认后直接进入确定性求解，不经过 P-顶点模板的审计门。
    const internalReview = reviewAllEqualPyramidExtraction(ingestion.draft.question, ingestion);
    ingestion.internalReview = internalReview;
    ingestion.draft.extraction = {...ingestion.draft.extraction, requiresConfirmation: false};
    if (internalReview.status !== 'passed') {
      ingestion.status = 'needs_more_context';
      ingestion.workflowStatus = 'needs_more_context';
      ingestion.guidance = missingInformationGuidance(internalReview);
      await persist();
      return null;
    }
    ingestion.confirmedRelationIds = ['r-mid', 'r-eq'];
    ingestion.internallyReviewedAt = now();
    const job = await enqueueDeterministicWorkflow(ingestion);
    ingestion.workflowId = job.id;
    await persist();
    return job;
  }
  const modelAudit = auditSolidGeometryModelInput({questionText: ingestion.draft.question, studentAnswer: ingestion.draft.studentAnswer, source: ingestion.source});
  ingestion.modelAudit = modelAudit;
  if (modelAudit.status !== 'ready') {
    ingestion.status = 'needs_more_context'; ingestion.workflowStatus = 'needs_more_context';
    ingestion.guidance = missingInformationGuidance(modelAudit); await persist(); return null;
  }
  const internalReview = reviewDeterministicExtraction(ingestion.draft.question, ingestion);
  ingestion.internalReview = internalReview;
  ingestion.draft.extraction = {...ingestion.draft.extraction, requiresConfirmation: false};
  if (internalReview.status !== 'passed') {
    ingestion.status = 'needs_more_context';
    ingestion.workflowStatus = 'needs_more_context';
    ingestion.guidance = missingInformationGuidance(internalReview);
    await persist();
    return null;
  }
  ingestion.confirmedRelationIds = ['r-base', 'r-height'];
  ingestion.internallyReviewedAt = now();
  const job = await enqueueDeterministicWorkflow(ingestion);
  ingestion.workflowId = job.id;
  await persist();
  return job;
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': CORS_ORIGIN,
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,idempotency-key,authorization,x-api-token',
      'access-control-allow-private-network': 'true'
    });
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (demoAccessGate) {
    const gateInput = req.method === 'POST' && url.pathname === '/demo-access' ? await readBody(req) : {};
    if (await demoAccessGate.handle(req, res, gateInput)) return;
  }
  const input = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
  const bearer = bearerToken(req);
  const sessionBearer = bearer || studentCookieToken(req);
  if (!bearer && studentCookieToken(req) && ['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    const origin = String(req.headers.origin || '');
    if (origin) {
      let sameOrigin = false;
      try { sameOrigin = Boolean(req.headers.host) && new URL(origin).host === req.headers.host; } catch {}
      if (!sameOrigin) return send(res, 403, {error:'INVALID_SESSION_ORIGIN'});
    }
  }
  let authResolution = null;

  if (url.pathname.startsWith('/v1/') && API_TOKEN && !AUTH_REQUIRED) {
    if (sessionBearer !== API_TOKEN && req.headers['x-api-token'] !== API_TOKEN) return send(res, 401, {error: 'UNAUTHORIZED'});
  }
  if (AUTH_REQUIRED && url.pathname.startsWith('/v1/') && !publicSchoolPath(req.method, url.pathname)) {
    authResolution = identity.resolve(sessionBearer);
    if (!authResolution) return send(res, 401, {error: 'AUTHENTICATION_REQUIRED'});
    input.studentId = authResolution.user.id;
    input.user_id = authResolution.user.id;
  }
  const canAccessPersonalRecord = record => !AUTH_REQUIRED || (record?.user_id || record?.studentId) === authResolution?.user.id;

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return sendStatic(res, 'index.html', 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/math-display.js') return sendStatic(res, 'math-display.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/gsap.min.js') return sendStatic(res, 'gsap.min.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/three.module.js') return sendStatic(res, 'three.module.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/knowledge-cards.js') return sendStatic(res, 'knowledge-cards.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/public-problem-templates.js') return sendStatic(res, 'public-problem-templates.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/model-key-settings.js') return sendStatic(res, 'model-key-settings.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/account-settings.js') return sendStatic(res, 'account-settings.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/shared-knowledge.js') return sendStatic(res, 'shared-knowledge.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/shared-library-ui.js') return sendStatic(res, 'shared-library-ui.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/grade10-example-library.js') return sendStatic(res, 'grade10-example-library.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/wrong-question-entry.js') return sendStatic(res, 'wrong-question-entry.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/paper-upload.js') return sendStatic(res, 'paper-upload.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/doodle-theme.css') return sendStatic(res, 'doodle-theme.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/yellow-cat.svg') return sendStatic(res, 'yellow-cat.svg', 'image/svg+xml');
  if (req.method === 'GET' && url.pathname === '/study-insights.js') return sendStatic(res, 'study-insights.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/mistake-editor.js') return sendStatic(res, 'mistake-editor.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/plane-geometry-core.js') return sendStatic(res, 'plane-geometry-core.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/plane-model-panel.js') return sendStatic(res, 'plane-model-panel.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/rolling-quiz.js') return sendStatic(res, 'rolling-quiz.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/plan-page.js') return sendStatic(res, 'plan-page.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/loop-wizard.js') return sendStatic(res, 'loop-wizard.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/electric-field-lab.js') return sendStatic(res, 'electric-field-lab.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/textbook-library.js') return sendStatic(res, 'textbook-library.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/toolbox.css') return sendStatic(res, 'toolbox.css', 'text/css; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/tutor-step-visual.js') return sendStatic(res, 'tutor-step-visual.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/step-visual-contract.js') return sendStatic(res, 'step-visual-contract.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/tablet-geometry-runtime.js') return sendStatic(res, 'tablet-geometry-runtime.js', 'application/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname.startsWith('/vendor/')) return sendVendorStatic(res, url.pathname.slice('/vendor/'.length));
  if (req.method === 'GET' && url.pathname.startsWith('/skills/')) return sendSkillStatic(res, url.pathname.slice('/skills/'.length));
  /* ------------------------------------------------------------------
     启动自检：演示前一眼看清"哪些能用、哪些不能用"
     台上最怕的是提交题目等了两分钟才发现 API 根本连不上。
     这里主动探测一次 AI 服务，返回可读的四项状态。
     ------------------------------------------------------------------ */
  if (req.method === 'GET' && url.pathname === '/v1/startup-check') {
    const checks = {localService:true, three:true, apiKey:Boolean(modelConfig.apiKey), aiReachable:false};
    let aiDetail = '未评估';
    if (!modelConfig.apiKey) {
      aiDetail = '没有配置 API Key，只能离线演示已有题目';
    } else if (!modelConfig.endpoint) {
      aiDetail = '没有配置 AI 服务地址';
    } else {
      const started = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('probe timeout')), 12000);
        let response;
        try {
          response = await fetch(modelConfig.endpoint, {
            method: 'POST', signal: controller.signal,
            headers: {'content-type': 'application/json', authorization: `Bearer ${modelConfig.apiKey}`},
            body: JSON.stringify({model: modelConfig.model, messages: [{role: 'user', content: 'reply with OK'}], max_tokens: 4})
          });
        } finally { clearTimeout(timer); }
        checks.aiReachable = response.ok;
        aiDetail = response.ok
          ? `AI 服务正常（${Date.now() - started}ms，模型 ${modelConfig.model}）`
          : `AI 服务返回 HTTP ${response.status}${response.status === 401 || response.status === 403 ? '：API Key 无效或权限不足' : response.status === 402 ? '：账户余额不足' : response.status === 429 ? '：请求过于频繁' : ''}`;
      } catch (error) {
        aiDetail = `连不上 AI 服务：${String(error?.cause?.code || error?.code || error?.message || error).slice(0, 80)}（可离线演示已有题目）`;
      }
    }
    checks.aiDetail = aiDetail;
    checks.offlineModeAvailable = true;
    checks.dataFile = DATA_FILE;
    // httpServer 在文件末尾创建，请求进来时一定已存在
    let actualPort = PORT;
    try { actualPort = httpServer.address()?.port || PORT; } catch (error) { /* 未监听时退回配置端口 */ }
    checks.port = actualPort;
    checks.canGenerateNewModels = checks.apiKey && checks.aiReachable;
    return send(res, 200, checks);
  }
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, {
    ok: true,
    service: 'educompanion-loop',
    workflow: 'geometry_learning_workflow',
    teachingCoach: 'teaching-coach-plan/v1',
    educationSkills: ['edu-solid-geometry', 'edu-analytic-geometry', 'edu-chem-reaction'],
    qwenConfigured: Boolean(process.env.QWEN_VL_ENDPOINT && process.env.QWEN_API_KEY),
    deepSeekVisionConfigured: Boolean(modelConfig.endpoint && modelConfig.apiKey),
    deepSeekConfigured: Boolean(modelConfig.endpoint && modelConfig.apiKey && modelConfig.model),
    deepSeekModel: modelConfig.apiKey ? modelConfig.model : null,
    authRequired: AUTH_REQUIRED,
    time: now()
  });

  // The electric bench receives a small declarative spec, never generated code.
  // This route is intentionally independent of the geometry compiler: a physics
  // problem can be useful even when no spatial-geometry model is requested.
  if (req.method === 'POST' && url.pathname === '/v1/electric-field/compile') {
    const question=String(input.question||input.questionText||'').trim();
    if (!question) return send(res,400,{error:'请先提供电场题干'});
    const result=compileElectricFieldProblem(question);
    result.motionPrinciple=buildElectricMotionPrinciple(question);
    if(input.imageData){
      if(!modelConfig.endpoint||!modelConfig.apiKey)return send(res,503,{error:'DEEPSEEK_ELECTRIC_VISION_NOT_CONFIGURED',message:'当前学习服务没有配置 DeepSeek 视觉模型密钥，因此无法分析电场图。请在服务器配置服务端密钥后重启服务；题干文字仍可用于载入基础实验台。'});
      let image;
      try{image=parseImageData(input.imageData)}catch(error){return send(res,error.statusCode||400,{error:error.message})}
      try{
        const graphAnalysis=await createDeepSeekElectricFieldGraphAdapter({...modelConfig,visionModel:process.env.DEEPSEEK_VISION_MODEL||'deepseek-flash'})(
          {question,imageData:`data:${image.mimeType};base64,${image.bytes.toString('base64')}`});
        result.graphAnalysis=graphAnalysis;
        result.guidanceSteps=normalizeGuidanceSteps(graphAnalysis.guidanceSteps,8,result.guidanceSteps);
        result.status=graphAnalysis.detected?'graph_candidate_requires_confirmation':'graph_not_detected';
        result.spec={...result.spec,graph:{kind:graphAnalysis.graphType,confidence:graphAnalysis.confidence,axisScaleConfirmed:graphAnalysis.horizontalAxis.scaleConfirmed&&graphAnalysis.verticalAxis.scaleConfirmed,
          horizontalAxis:graphAnalysis.horizontalAxis,verticalAxis:graphAnalysis.verticalAxis,segments:graphAnalysis.segments,keyPoints:graphAnalysis.keyPoints}};
        result.notice=graphAnalysis.detected?'AI 已初步识别坐标轴和走势，请核对横纵轴、单位、刻度及关键点后再应用曲线。':'图片中暂未可靠识别出电场图，请确认图片清晰并补充题干。';
      }catch(error){
        const code=String(error.code||error.message||'DEEPSEEK_ELECTRIC_VISION_FAILED');
        const status=/NOT_CONFIGURED/.test(code)?503:/HTTP_(401|403)/.test(code)?502:/HTTP_402/.test(code)?402:/HTTP_429/.test(code)?429:503;
        const message=status===402?'DeepSeek 账户余额不足，电场图没有完成 AI 识别。':status===429?'DeepSeek 请求过于频繁，请稍后重试。':status===502?'DeepSeek Key 无效或没有视觉模型权限。':'DeepSeek 电场图识别暂时不可用（'+code+'）；原图和题干仍可保留，稍后重试。';
        console.warn('[electric-field-vision] analysis failed:',code);
        return send(res,status,{error:code,message});
      }
    }
    return send(res,200,result);
  }

  if (req.method === 'POST' && url.pathname === '/v1/auth/register') {
    const result = await identity.register(input);
    await persist();
    return send(res, 201, result, AUTH_REQUIRED ? {'set-cookie':studentSessionCookie(req,result.sessionToken,result.expiresAt)} : {});
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/login') {
    const result = await identity.login(input);
    await persist();
    return send(res, 200, result, AUTH_REQUIRED ? {'set-cookie':studentSessionCookie(req,result.sessionToken,result.expiresAt)} : {});
  }
  if (req.method === 'GET' && url.pathname === '/v1/auth/me') {
    /* 本地模式下 authResolution 一直是 null（它只在 AUTH_REQUIRED 时才赋值），
       以前这里会直接 authResolution.user 抛 500。现在自己用 token 兜一次。 */
    const resolved = authResolution || (sessionBearer ? identity.resolve(sessionBearer) : null);
    if (!resolved) return send(res, 401, {error: 'AUTHENTICATION_REQUIRED', message: '请先登录。'});
    return send(res, 200, {user: resolved.user, expiresAt: resolved.session.expiresAt},
      AUTH_REQUIRED && bearer ? {'set-cookie':studentSessionCookie(req,bearer,resolved.session.expiresAt)} : {});
  }
  if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
    if (input.allDevices === true) {
      const resolved = identity.resolve(sessionBearer);
      if (!resolved) return send(res, 401, {error: 'AUTHENTICATION_REQUIRED'});
      // Never accept a target user id supplied by the client.
      identity.revokeAll(resolved.user.id);
    } else identity.revoke(sessionBearer);
    await persist();
    return send(res, 204, null, AUTH_REQUIRED ? {'set-cookie':clearStudentSessionCookie()} : {});
  }

  /* 个人资料（姓名/班级/年级/选科）与用户偏好（每日攻克数量、科目顺序）。
     注册登录本身还是上面的 /v1/auth/*，这里只补登录之后的部分。 */
  {
    const handleAccount = createAccountRouter({
      db, persist, identity,
      currentUser: () => authResolution,
      sessionToken: () => sessionBearer,
      requestBody: input
    });
    if (await handleAccount(req, res, url)) return;
  }

  if (url.pathname.startsWith('/v1/shared-knowledge')) {
    const user = (authResolution || (sessionBearer ? identity.resolve(sessionBearer) : null))?.user || null;
    const result = await sharedLibrary.handle({method:req.method, path:url.pathname + url.search, input, user});
    if (result) return send(res, result.status, result.body);
  }

  if (req.method === 'POST' && url.pathname === '/v1/admin/deepseek-config') {
    if (AUTH_REQUIRED) return send(res, 403, {error: 'SERVER_MODEL_CONFIGURATION_REQUIRED'});
    if (!isLoopbackRequest(req)) return send(res, 403, {error: 'LOCAL_CONFIGURATION_ONLY'});
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(apiKey)) return send(res, 422, {error: 'INVALID_DEEPSEEK_API_KEY'});
    const nextConfig = {
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey,
      model: 'deepseek-v4-flash'
    };
    await saveModelConfig(nextConfig);
    return send(res, 200, {configured: true, model: nextConfig.model, endpoint: nextConfig.endpoint});
  }

  if (req.method === 'POST' && url.pathname === '/v1/workflows/geometry') {
    const job = await enqueueWorkflow(input);
    return send(res, 202, job);
  }
  if (req.method === 'POST' && url.pathname === '/v1/teaching-coach/plan') {
    if (!String(input.questionText || '').trim() && !input.problemIR) {
      return send(res, 422, {error: 'QUESTION_OR_PROBLEM_IR_REQUIRED'});
    }
    const plan = await teachingCoach.plan(input);
    db.events.push({
      id: randomUUID(),
      type: 'teaching_coach_planned',
      payload: {subject: plan.subject, domain: plan.domain, skill: plan.skill, knowledgePoint: plan.knowledgePoint},
      createdAt: now()
    });
    await persist();
    return send(res, 200, plan);
  }
  if (req.method === 'GET' && url.pathname === '/v1/skill-courses') {
    return send(res, 200, {analytic: skillCatalog('analytic'), chemistry: skillCatalog('chemistry')});
  }
  if (req.method === 'POST' && url.pathname === '/v1/chemistry/assess') {
    return send(res, 200, assessChemistryInput(input.questionText));
  }
  if (req.method === 'POST' && url.pathname === '/v1/skill-courses/generate') {
    const result = await generateSkillCourse({kind: input.kind, key: input.key, seed: input.seed, serverDir: SERVER_DIR, uiRoot: UI_ROOT});
    return send(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/v1/teaching-coach/sessions') {
    if (!String(input.questionText || '').trim() && !input.problemIR) return send(res, 422, {error: 'QUESTION_OR_PROBLEM_IR_REQUIRED'});
    const session = await createTeachingCoachSession(input, teachingCoach);
    db.coachSessions.unshift(session);
    db.events.push({id: randomUUID(), type: 'teaching_coach_session_started', sessionId: session.id, createdAt: now()});
    await persist();
    return send(res, 201, session);
  }
  const coachSessionMatch = url.pathname.match(/^\/v1\/teaching-coach\/sessions\/([^/]+)\/events$/);
  if (req.method === 'POST' && coachSessionMatch) {
    const session = db.coachSessions.find(item => item.id === coachSessionMatch[1]);
    if (!session) return send(res, 404, {error: 'TEACHING_COACH_SESSION_NOT_FOUND'});
    await advanceTeachingCoachSession(session, input, teachingCoach);
    db.events.push({id: randomUUID(), type: 'teaching_coach_turn_planned', sessionId: session.id, payload: session.turns.at(-1), createdAt: now()});
    await persist();
    return send(res, 200, session);
  }
  if (req.method === 'POST' && url.pathname === '/v1/geometry/random-problems') {
    const seed = input.seed === undefined ? Date.now() >>> 0 : input.seed;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) return send(res, 422, {error: 'INVALID_RANDOM_SEED'});
    let selected = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = randomPyramidCandidate(seed, attempt);
      const parameters = {
        baseEdge: {op: 'integer', value: candidate.baseEdge},
        height: {op: 'integer', value: candidate.height}
      };
      const result = await solveConfirmedGeometry(makeDeterministicRequest({
        caseId: `random-preview-${seed}-${attempt}`,
        revision: 1,
        templateId: DETERMINISTIC_TEMPLATE,
        templateVersion: DETERMINISTIC_TEMPLATE_VERSION,
        parameters
      }));
      if (result.solverStatus === 'verified' && isCleanExactAnswer(result.answer.exact)) {
        selected = {candidate, parameters, attempts: attempt + 1};
        break;
      }
    }
    if (!selected) return send(res, 503, {error: 'CLEAN_RANDOM_PROBLEM_NOT_FOUND'});
    const {candidate, parameters, attempts} = selected;
    const item = await createDeterministicIngestion({
      source: 'random',
      studentId: input.studentId,
      templateId: DETERMINISTIC_TEMPLATE,
      templateVersion: DETERMINISTIC_TEMPLATE_VERSION,
      parameters,
      randomization: {seed, attempts, rejectedCount: attempts - 1, clean: true},
      draft: {
        question: `正四棱锥 P-ABCD 的底面边长为 ${candidate.baseEdge}，高为 ${candidate.height}，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。`,
        studentAnswer: '随机练习：请先独立建立坐标系并写出关键向量。',
        extraction: {source: 'deterministic_random_generator', confidence: 1, requiresConfirmation: false}
      }
    });
    const job = await enqueueInternallyReviewedIngestion(item);
    if (!job) return send(res, 202, {...item, status: 'needs_more_context', workflowStatus: 'needs_more_context', guidance: item.guidance || missingInformationGuidance(item.internalReview)});
    return send(res, 202, {...item, workflowId: job.id});
  }
  if (req.method === 'POST' && url.pathname === '/v1/geometry/random-v3') {
    const seed = input.seed === undefined ? Date.now() >>> 0 : input.seed;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) return send(res, 422, {error: 'INVALID_RANDOM_SEED'});
    const generated = await generateVerifiedRandomGeometry(seed);
    if (generated.status !== 'verified') return send(res, 503, {error: 'VERIFIED_RANDOM_GEOMETRY_NOT_FOUND', ...generated});
    const mistakeCase = randomGeometryCase(generated, true, input.studentId);
    return send(res, 200, {status:'verified',workflowStatus:'preview',mistakeCase,modelKind:generated.modelKind,problemIR:generated.problemIR,result:generated.result,randomization:generated.randomization});
  }
  if (req.method === 'POST' && url.pathname === '/v1/geometry/random-v3/start') {
    const seed = input.seed;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) return send(res, 422, {error:'INVALID_RANDOM_SEED'});
    const idempotencyKey=String(req.headers['idempotency-key']||'').trim();
    if(!idempotencyKey)return send(res,400,{error:'IDEMPOTENCY_KEY_REQUIRED'});
    const idempotencyScope=`random-v3-start:${input.studentId || 'local'}:${idempotencyKey}`;
    const payloadKey=JSON.stringify({seed});
    const previous=db.idempotency.find(entry=>entry.key===idempotencyScope);
    const pending=pendingIdempotency.get(idempotencyScope);
    if((previous||pending)&&(previous||pending).payloadKey!==payloadKey)return send(res,409,{error:'IDEMPOTENCY_KEY_REUSED'});
    if(previous)return send(res,200,previous.response);
    if(pending){const completed=await pending.completion;return completed?send(res,200,pending.response):send(res,503,{error:'RANDOM_START_PERSIST_FAILED'});}
    let completePending;const completion=new Promise(resolve=>{completePending=resolve});
    const pendingEntry={key:idempotencyScope,payloadKey,response:null,completion};pendingIdempotency.set(idempotencyScope,pendingEntry);
    try{
      const generated = await generateVerifiedRandomGeometry(seed);
      if (generated.status !== 'verified'){completePending(false);return send(res,503,{error:'VERIFIED_RANDOM_GEOMETRY_NOT_FOUND',...generated});}
      const mistakeCase=randomGeometryCase(generated,false,input.studentId);
      db.cases.unshift(mistakeCase);
      db.ingestions.unshift({id:randomUUID(),caseId:mistakeCase.id,...(input.studentId?{studentId:input.studentId}:{}),source:'verified_random_practice',status:'verified',workflowStatus:'completed',problemIR:generated.problemIR,result:generated.result,draft:mistakeCase,createdAt:now()});
      const response={status:'verified',workflowStatus:'completed',mistakeCase,modelKind:generated.modelKind,problemIR:generated.problemIR,result:generated.result,randomization:generated.randomization};pendingEntry.response=response;
      db.idempotency.push({key:idempotencyScope,externalKey:idempotencyKey,caseId:mistakeCase.id,payloadKey,response,createdAt:now()});
      await persist();completePending(true);return send(res,201,response);
    }catch(error){completePending(false);throw error}finally{pendingIdempotency.delete(idempotencyScope)}
  }
  /* 异步几何建模作业的进度查询：前端每隔几秒问一次，不再让长连接干等模型。 */
  const geometryJobMatch = url.pathname.match(/^\/v1\/geometry-jobs\/([^/]+)$/);
  if (req.method === 'GET' && geometryJobMatch) {
    const job = geometryJobs.get(geometryJobMatch[1]);
    if (!job) return send(res, 404, {error: 'GEOMETRY_JOB_NOT_FOUND'});
    if (job.status === 'processing') updateGeometryJobProgress(job);
    return send(res, 200, {
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      message: job.message,
      ingestionId: job.ingestionId,
      caseId: job.caseId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      // 只在终态把整包结果带回去，轮询期间保持轻量
      ...(job.status === 'completed' ? {ingestion: job.result} : {}),
      ...(job.status === 'failed' ? {
        failure: job.failure || null,
        failureClass: job.failure?.failureClass || 'unknown',
        failureKind: job.failure?.failureKind || 'unclassified',
        failureMessage: job.failure?.message || job.message,
        failedConstraints: job.failure?.failedConstraints || [],
        residual: job.failure?.residual ?? null,
        ingestion: job.result || null
      } : {})
    });
  }
  const workflowMatch = url.pathname.match(/^\/v1\/workflows\/geometry\/([^/]+)$/);
  if (req.method === 'GET' && workflowMatch) {
    const job = db.workflows.find(item => item.id === workflowMatch[1] && canAccessPersonalRecord(item));
    return job ? send(res, 200, job) : send(res, 404, {error: 'workflow_not_found'});
  }

  if (req.method === 'POST' && url.pathname === '/v1/ai/chat') {
    return send(res, 200, {choices: [{message: {content: '请先指出题目中最能决定坐标系方向的条件。'}}]});
  }
  if (req.method === 'POST' && url.pathname === '/v1/ai/vision') {
    const result = await geometryWorkflow.run(input);
    return send(res, 200, {choices: [{message: {content: JSON.stringify(workflowToDraft(result, input))}}]});
  }
  if (req.method === 'POST' && url.pathname === '/v1/polyhedron-geometry/compile') {
    const compiled = compilePolyhedronGeometryIR(input.problemIR || input);
    const statusCode = compiled.status === 'verified_unique' ? 200
      : compiled.status === 'schema_invalid' ? 422
        : compiled.status === 'unsupported' ? 422 : 409;
    return send(res, statusCode, compiled);
  }
  if (req.method === 'POST' && url.pathname === '/v1/circular-geometry/solve') {
    const parsed = input.problemIR?.schemaVersion === 'geometry-ir/v2'
      ? input.problemIR
      : parseCircularGeometryText(input.questionText, input.studentAnswer);
    if (!parsed) return send(res, 422, {error: 'CIRCULAR_GEOMETRY_NOT_RECOGNIZED', message: '请写明圆柱、圆锥或球，以及半径、高、截面关系或所求。'});
    if (parsed.status === 'needs_more_context') {
      const whyNeededByLabel = {
        '圆柱半径': '精确模型需要底面半径的真实尺度，不能从示意图猜测。',
        '圆柱高': '两底面间的垂直距离决定柱体高度。',
        '圆锥底面半径': '精确模型需要底面半径的真实尺度，不能从示意图猜测。',
        '圆锥高': '顶点到底面的垂直距离决定锥体比例；已知母线长与半径时高可由 l²=r²+h² 导出。',
        '球半径': '球模型需要真实半径尺度。',
        '球心到截平面的距离（若截面过球心，请明确写“过球心”）': '截面圆半径由球半径与球心到截平面的距离共同确定。'
      };
      const item = await createIncompleteGeometryIngestion({...input, source: 'text'});
      item.status = item.workflowStatus = 'needs_more_context';
      item.guidance = `要建立可验证模型，还缺：${parsed.missing.join('、')}。不过你现在可以先进入 AI 陪练与得分点训练。`;
      item.mistakeCase.modelStatus = 'needs_more_context'; item.mistakeCase.modelMessage = item.guidance;
      await persist();
      return send(res, 202, {...item,
        missingItems: parsed.missing.map(label => ({
          id: 'circular-' + label,
          label,
          whyNeeded: whyNeededByLabel[label] || '这是建立可验证模型所需的真实尺度。',
          prompt: `请补充${label}。`
        }))
      });
    }
    if (parsed.status === 'unsupported') {
      const item = await createIncompleteGeometryIngestion({...input, source: 'text'});
      item.status = item.workflowStatus = 'model_unsupported';
      item.guidance = `${parsed.message || '当前圆体引擎尚未覆盖这个已识别的问法。'} 你仍可立即进入 AI 陪练、得分点提示和闭环复习。`;
      item.mistakeCase.modelStatus = 'model_unsupported'; item.mistakeCase.modelMessage = item.guidance;
      await persist();
      return send(res, 202, item);
    }
    if (!parsed.body || !parsed.problem) {
      return send(res, 422, {error: 'INVALID_CIRCULAR_GEOMETRY_IR', message: '圆体 IR 缺少实体或题目信息，未生成模型。'});
    }
    const result = await solveConfirmedGeometry(parsed);
    if (result.solverStatus !== 'verified') {
      const status = result.solverStatus === 'contradictory' ? 'contradictory' : result.solverStatus === 'needs_more_context' ? 'needs_more_context' : 'unsupported';
      return send(res, 202, {status, error: result.failureCode || 'CIRCULAR_MODEL_NOT_VERIFIED', result, message: status === 'contradictory' ? '题目条件彼此不成立，因此没有生成模型。' : '题目信息已保留；当前不能生成经过验证的圆体模型。'});
    }
    const bodyType = parsed.body.type;
    const bodyLabel = {right_cylinder: '圆柱', right_cone: '圆锥', sphere: '球'}[bodyType] || '圆体';
    const caseId = randomUUID();
    const mistakeCase = {
      id: caseId,
      ...(input.studentId ? {studentId: input.studentId} : {}),
      subject: '数学',
      unit: '空间几何',
      question: parsed.problem.questionText,
      studentAnswer: parsed.studentAnswer || '待补充学生作答过程',
      correctAnswer: result.answer.displayPlain,
      correctAnswerLatex: result.answer.latex,
      analysis: `${bodyLabel}的坐标模型、截面与计算均来自已验证的 geometry-ir/v2。`,
      knowledgePoints: [bodyLabel, ...(['section_circle', 'axis_section', 'parallel_base_section'].includes(parsed.query.type) ? ['截面'] : ['体积与表面积'])],
      errorCauses: [],
      verificationStatus: 'verified',
      problemSpec: parsed,
      geometryResult: result,
      visualization: {renderer: 'three', interactive: true, scene: result.scene},
      origin: 'circular_geometry_deterministic',
      createdAt: now(),
      confirmedAt: now()
    };
    db.cases = [mistakeCase, ...db.cases.filter(item => item.id !== caseId)];
    db.ingestions.unshift({id: randomUUID(), caseId, ...(input.studentId ? {studentId: input.studentId} : {}), source: 'text', templateId: `circular-${bodyType}`, status: 'verified', workflowStatus: 'completed', result, draft: mistakeCase, createdAt: now()});
    await persist();
    return send(res, 201, {status: 'verified', mistakeCase, result});
  }
  const intakeImageMatch = url.pathname.match(/^\/v1\/wrong-questions\/images\/([a-f0-9]{64})$/);
  if (req.method === 'GET' && intakeImageMatch) {
    const owned = db.intakeDrafts.find(item => (item.imageHash === intakeImageMatch[1] || item.supplementaryImageHash === intakeImageMatch[1]) && canAccessPersonalRecord(item))
      || db.cases.find(item => canAccessPersonalRecord(item)
        && (item.electricFieldModel?.supplementaryImage?.hash === intakeImageMatch[1] || item.supplementaryImage?.hash === intakeImageMatch[1]
          || item.sourceImage?.hash === intakeImageMatch[1]));
    if (!owned) return send(res, 404, {error:'IMAGE_NOT_FOUND'});
    try {
      const bytes = await readFile(path.join(INTAKE_IMAGE_ROOT, intakeImageMatch[1]));
      const mimeType=(owned.imageHash===intakeImageMatch[1]?owned.imageMimeType:owned.supplementaryImageMimeType)
        || owned.electricFieldModel?.supplementaryImage?.mimeType || owned.supplementaryImage?.mimeType
        || owned.sourceImage?.mimeType || 'image/jpeg';
      res.writeHead(200, {'content-type':mimeType,'cache-control':'private, max-age=3600',
        'access-control-allow-origin':CORS_ORIGIN});
      return res.end(bytes);
    } catch { return send(res, 404, {error:'IMAGE_NOT_FOUND'}); }
  }
  const electricCaseMatch=url.pathname.match(/^\/v1\/mistake-cases\/([^/]+)\/electric-field-model$/);
  if (electricCaseMatch && ['POST','PATCH'].includes(req.method)) {
    const caseId=decodeURIComponent(electricCaseMatch[1]);
    const record=db.cases.find(item=>item.id===caseId && canAccessPersonalRecord(item));
    if(!record)return send(res,404,{error:'MISTAKE_CASE_NOT_FOUND'});
    let image=null;
    if(input.imageData){
      try{image=parseImageData(input.imageData)}catch(error){return send(res,error.statusCode||400,{error:error.message})}
      await mkdir(INTAKE_IMAGE_ROOT,{recursive:true});
      const file=path.join(INTAKE_IMAGE_ROOT,image.hash);
      if(!existsSync(file))await writeFile(file,image.bytes);
    }
    const incoming=input.model&&typeof input.model==='object'&&!Array.isArray(input.model)?input.model:{};
    const previous=record.electricFieldModel&&typeof record.electricFieldModel==='object'?record.electricFieldModel:{};
    const safeCurve=Array.isArray(incoming.adjustedCurve)?incoming.adjustedCurve.slice(0,81).map(Number).filter(Number.isFinite).map(value=>Math.max(-1,Math.min(1,value))):previous.adjustedCurve;
    const safeProfile=key=>Array.isArray(incoming[key])&&incoming[key].length===41&&incoming[key].every(value=>Number.isFinite(Number(value)))?incoming[key].map(value=>Math.max(-1,Math.min(1,Number(value)))):previous[key];
    const adjustedPotentialCurve=safeProfile('adjustedPotentialCurve'),adjustedFieldCurve=safeProfile('adjustedFieldCurve');
    const incomingSimulation=incoming.simulation&&typeof incoming.simulation==='object'?incoming.simulation:null;
    const allowedModes=new Set(['uniform','points','ring','shell','solid']);
    const safeCharges=Array.isArray(incomingSimulation?.charges)?incomingSimulation.charges.slice(0,8).filter(charge=>charge&&Number.isFinite(Number(charge.x))&&Number.isFinite(Number(charge.y))&&Number.isFinite(Number(charge.q))).map(charge=>({x:Math.max(-2.5,Math.min(2.5,Number(charge.x))),y:Math.max(-1.55,Math.min(1.55,Number(charge.y))),q:Math.max(-3,Math.min(3,Number(charge.q)))})):null;
    const safeSimulation=incomingSimulation?{mode:allowedModes.has(incomingSimulation.mode)?incomingSimulation.mode:'points',charge:Math.max(-5,Math.min(5,Number(incomingSimulation.charge)||0)),radius:Math.max(.1,Math.min(10,Number(incomingSimulation.radius)||1)),testX:Math.max(-10,Math.min(10,Number(incomingSimulation.testX)||0)),testY:Math.max(-10,Math.min(10,Number(incomingSimulation.testY)||0)),testCharge:Number(incomingSimulation.testCharge)<0?-1:1,showLines:incomingSimulation.showLines!==false,showMotion:incomingSimulation.showMotion!==false,...(safeCharges?{charges:safeCharges}:{})}:null;
    const updated={...previous,
      ...(incoming.spec&&typeof incoming.spec==='object'?{spec:incoming.spec}:{}),
      ...(incoming.bench&&typeof incoming.bench==='object'?{bench:incoming.bench}:{}),
      ...(incoming.graphAnalysis&&typeof incoming.graphAnalysis==='object'?{graphAnalysis:incoming.graphAnalysis}:{}),
      ...(incoming.motionPrinciple&&typeof incoming.motionPrinciple==='object'?{motionPrinciple:incoming.motionPrinciple}:{}),
      ...(safeCurve?{adjustedCurve:safeCurve}:{}),
      ...(adjustedPotentialCurve?{adjustedPotentialCurve}:{}),
      ...(adjustedFieldCurve?{adjustedFieldCurve}:{}),
      ...(typeof incoming.calibrationLocked==='boolean'?{calibrationLocked:incoming.calibrationLocked}:{}),
      ...(incoming.displayMode==='curves'||incoming.displayMode==='panel'?{displayMode:incoming.displayMode}:{}),
      ...(incoming.calibratedAt===null?{calibratedAt:null}:typeof incoming.calibratedAt==='string'?{calibratedAt:incoming.calibratedAt.slice(0,40)}:{}),
      ...(incoming.status?{status:String(incoming.status).slice(0,80)}:{}),
      ...(image?{supplementaryImage:{hash:image.hash,mimeType:image.mimeType,fileName:String(input.fileName||'补充题图').slice(0,160)}}:{}),
      ...(safeSimulation?{simulation:safeSimulation}:{})
    };
    record.electricFieldModel={...updated,sourceImage:record.sourceImage||previous.sourceImage||null,version:'electric-problem-spec/v1',updatedAt:now()};
    record.updatedAt=now();
    await persist();
    return send(res,200,{mistakeCase:record});
  }
  if (req.method === 'GET' && url.pathname === '/v1/wrong-questions/drafts/latest') {
    const draft=db.intakeDrafts.find(item=>item.status==='awaiting_confirmation'
      && item.source==='image' && canAccessPersonalRecord(item)
      && Date.now()-Date.parse(item.createdAt)<24*60*60*1000);
    return send(res,200,{draft:draft || null});
  }
  if (req.method === 'GET' && url.pathname === '/v1/papers/drafts/latest') {
    const draft=db.intakeDrafts.find(item=>item.source==='paper_batch' && canAccessPersonalRecord(item)
      && Date.now()-Date.parse(item.createdAt)<7*24*60*60*1000);
    return send(res,200,{draft:draft || null});
  }
  const paperImageMatch=url.pathname.match(/^\/v1\/papers\/images\/([a-f0-9]{64})$/);
  if (req.method === 'GET' && paperImageMatch) {
    const owned=db.intakeDrafts.filter(item=>item.source==='paper_batch' && canAccessPersonalRecord(item))
      .flatMap(item=>[...item.paperImages,...item.answerImages]).find(image=>image.hash===paperImageMatch[1]);
    if (!owned) return send(res,404,{error:'IMAGE_NOT_FOUND'});
    try {
      const bytes=await readFile(path.join(INTAKE_IMAGE_ROOT,paperImageMatch[1]));
      res.writeHead(200,{'content-type':owned.mimeType,'cache-control':'private, max-age=3600',
        'access-control-allow-origin':CORS_ORIGIN});
      return res.end(bytes);
    } catch {return send(res,404,{error:'IMAGE_NOT_FOUND'})}
  }
  if (req.method === 'POST' && url.pathname === '/v1/papers/preview') {
    const paperData=Array.isArray(input.paperImages)?input.paperImages:[];
    const answerData=Array.isArray(input.answerImages)?input.answerImages:[];
    const tooMany=paperData.length>PAPER_MAX_PAGES_PER_BATCH||answerData.length>PAPER_MAX_PAGES_PER_BATCH;
    const owner=authResolution?.user.id || 'local-student';
    const requestedDraftId=String(input.draftId || '');
    let draft=requestedDraftId
      ? db.intakeDrafts.find(item=>item.id===requestedDraftId && item.source==='paper_batch' && canAccessPersonalRecord(item))
      : null;
    if (draft && draft.status==='confirmed') draft=null;
    /* 两个入口的职责在这里分开，不再靠「传没传答题卡」猜：
       试卷上传（exam_paper）＝试卷 + 答题卡都必须有，AI 结合两者按题号配对；
       批量错题（batch）＝一次多张错题照片，没有批改痕迹，AI 自己读手写作业判对错，
         判不清的题交给学生自己定（前端把 status==='needs_review' 标成「你来定」）。
       没显式传 mode 时沿用草稿已选模式，避免追加批次时换错模式。 */
    const mode = input.mode === 'exam_paper' || (!input.mode && draft?.mode === 'exam_paper') ? 'exam_paper' : 'batch';
    if (mode === 'exam_paper' && !paperData.length && !answerData.length)
      return send(res,400,{error:'试卷上传需要同时选试卷和答题卡（两者都必须有）；只想传几张错题照片请用「批量错题」'});
    if (!paperData.length || tooMany)
      return send(res,400,{error:`请至少上传 1 页题目照片，每批每类最多 ${PAPER_MAX_PAGES_PER_BATCH} 页`});
    const paperImages=paperData.map(parseImageData),answerImages=answerData.map(parseImageData);
    if ([...paperImages,...answerImages].reduce((sum,image)=>sum+image.bytes.length,0)>8*1024*1024)
      return send(res,413,{error:'本批图片超过 8 MB，请减少页数后重新识别；已识别的批次会保留'});
    if (mode === 'exam_paper' && !answerData.length && !(draft?.answerImages.length))
      return send(res,400,{error:'试卷上传需要同时选试卷和答题卡；只想传几张错题照片请用「批量错题」'});
    let analysis;
    let analysisError=null;
    try {
      analysis=await createPaperAnalysisAdapter({endpoint:modelConfig.endpoint,apiKey:modelConfig.apiKey,
        model:process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash',
        fast: input.fast === true})(
        {paperImages:paperData,answerImages:answerData});
    } catch(error) {
      analysisError=error;
      /* 以前这里只 warn 前 100 字符，并且回给前端的是一句没有原因的话，
         导致「本批识别暂未完成」根本无法定位。现在把真实原因记全、也回传。 */
      const reason=String(error?.message || error);
      console.warn('[paper-intake] analysis failed:', reason.slice(0, 500));
      if (!input.preflightOnly) {
        return send(res,503,{error:'PAPER_ANALYSIS_FAILED',
          // 把原因拼进 message：前端 requestAt 只会用 body.message 当错误文案，
          // 单独加个字段前端拿不到，等于白记。
          reasonCode:error?.code || '',
          reason:reason.slice(0, 300),
          message:`本批识别暂未完成（${reason.slice(0, 160)}）。照片仍在当前页面，可重试。`});
      }
    }
    /* 上传前预检：只回答「照片能不能看清、题目有没有分开、做题过程读到没有」，
       不落草稿、不写库。学生据此判断该不该重新拍，再决定是否真的入库。 */
    if (input.preflightOnly) {
      const report=paperPreflight({paperImageCount:paperImages.length,answerImageCount:answerImages.length,analysis,error:analysisError});
      return send(res,200,{...report, fast: input.fast === true,
        autoFill:paperAutoFill(analysis?.questions || []),
        subject: report.subject !== '未分类' ? report.subject : (analysis?.subject || '未分类')});
    }
    await mkdir(INTAKE_IMAGE_ROOT,{recursive:true});
    for (const image of [...paperImages,...answerImages]) {
      const file=path.join(INTAKE_IMAGE_ROOT,image.hash);
      if (!existsSync(file)) await writeFile(file,image.bytes);
    }
    const pageOffset=draft?draft.paperImages.length:0;
    const answerOffset=draft?draft.answerImages.length:0;
    // 分批识别时模型只能看到自己那一批，页号必须按整份草稿平移，否则第 2 批又会从第 1 页开始。
    // 先按整题上限截断再平移，避免最后一题被截断后页码对不上。
    const batchQuestions=analysis.questions.slice(0,Math.max(0,PAPER_MAX_QUESTIONS-(draft?draft.questions.length:0)));
    // 分批识别时模型只能看到自己那一批，两个视角都要补：
    // ① 页号按整份草稿平移，否则第 2 批又会从第 1 页开始；
    // ② 跨批去重，否则同一页被重复上传时「1:求 f(2)」这类同号同题会被算两次。
    const seenKeys=new Set((draft?.questions||[]).map(item=>`${item.number}:${item.question}`));
    const shiftPages=items=>items.map(item=>({...item,
      paperPage:item.paperPage?item.paperPage+pageOffset:null,
      answerPage:item.answerPage?item.answerPage+answerOffset:null}))
      .filter(item=>{const key=`${item.number}:${item.question}`;if(seenKeys.has(key))return false;seenKeys.add(key);return true;});
    if (!draft) {
      draft={id:randomUUID(),studentId:owner,user_id:owner,source:'paper_batch',status:'awaiting_confirmation',
        mode,subject:analysis.subject,
        /* 记下这一批用的是快速还是深度：界面上要如实标出「薄弱点/卡点本次未预判」。 */
        fast: input.fast === true,
        questions:[],paperImages:[],answerImages:[],batchCount:0,createdAt:now()};
      db.intakeDrafts.unshift(draft);
    }
    draft.questions.push(...shiftPages(batchQuestions));
    if (analysis.subject && analysis.subject!=='未分类') draft.subject=analysis.subject;
    draft.paperImages.push(...paperImages.map(image=>({hash:image.hash,mimeType:image.mimeType})));
    draft.answerImages.push(...answerImages.map(image=>({hash:image.hash,mimeType:image.mimeType})));
    draft.batchCount=(draft.batchCount||0)+1;
    draft.updatedAt=now();
    await persist();
    return send(res,draft.batchCount>1?200:201,{draft,batchCount:draft.batchCount,questionCount:draft.questions.length});
  }
  const paperConfirm=url.pathname.match(/^\/v1\/papers\/drafts\/([^/]+)\/confirm$/);
  if (req.method === 'POST' && paperConfirm) {
    const draft=db.intakeDrafts.find(item=>item.id===paperConfirm[1] && item.source==='paper_batch' && canAccessPersonalRecord(item));
    if (!draft) return send(res,404,{error:'PAPER_DRAFT_NOT_FOUND'});
    if (draft.status==='confirmed') {
      const cases=(draft.caseIds||[]).map(id=>db.cases.find(item=>item.id===id && canAccessPersonalRecord(item))).filter(Boolean);
      return send(res,200,{mistakeCases:cases,alreadyConfirmed:true});
    }
    let cases;
    const uploadedQuestionImages=[];
    try {
      const selectedIds=Array.isArray(input.selectedIds)?[...new Set(input.selectedIds.map(String))]:[];
      const questionImages=input.questionImages&&typeof input.questionImages==='object'&&!Array.isArray(input.questionImages)
        ? input.questionImages : {};
      const corrections={...(input.corrections&&typeof input.corrections==='object'?input.corrections:{})};
      let imageBytes=0;
      for (const [itemId,dataUrl] of Object.entries(questionImages)) {
        if (!selectedIds.includes(itemId)) throw new Error('本题题图只能附在已勾选入库的题目上');
        if (!(draft.questions||[]).some(item=>item.id===itemId)) throw new Error('PAPER_ITEM_NOT_FOUND');
        const image=parseImageData(dataUrl);
        imageBytes+=image.bytes.length;
        if (imageBytes>6*1024*1024) return send(res,413,{error:'本批本题裁切图片超过 6 MB，请减少附图后重试'});
        uploadedQuestionImages.push(image);
        corrections[itemId]={...(corrections[itemId]||{}),questionImage:{hash:image.hash,mimeType:image.mimeType,fileName:`第${(draft.questions.find(item=>item.id===itemId)?.number)||''}题题图`}};
      }
      cases=confirmPaperItems(draft,{...input,corrections},authResolution?.user.id || 'local-student');
    } catch(error){return send(res,error.statusCode||400,{error:error.message})}
    if (uploadedQuestionImages.length) {
      await mkdir(INTAKE_IMAGE_ROOT,{recursive:true});
      for (const image of uploadedQuestionImages) {
        const file=path.join(INTAKE_IMAGE_ROOT,image.hash);
        if (!existsSync(file)) await writeFile(file,image.bytes);
      }
    }
    /* 学生在这批里勾了「需要 3D 模型」的题：入库的同时就排队生成，
       不用之后再回错题库一题题点「重新生成 3D 模型」。
       注意：前端勾的是**草稿里题目的 id**，入库后生成的是新的 case id，
       所以要用 paperSource.itemId 对应回去。 */
    const requestedIds=new Set((Array.isArray(input.model3dCaseIds)?input.model3dCaseIds:[]).map(String));
    const buildQueue=cases.filter(item=>requestedIds.has(String(item.paperSource?.itemId||''))
      && String(item.subject||'').trim().startsWith('数学'));
    for (const item of buildQueue) {
      item.geometryModelRequested=true;
      item.geometryBuildStatus='queued';
      item.modelMessage='题目已入库，正在排队生成 3D 模型…';
    }
    db.cases.unshift(...cases);
    // 做题记录里暴露的卡点写成薄弱点：入库即生成，不需要再点一次「分析」。
    const fresh=dedupeWeakPoints(db.weakPoints,paperWeakPointsFromCases(cases));
    db.weakPoints.unshift(...fresh);
    Object.assign(draft,{status:'confirmed',caseIds:cases.map(item=>item.id),confirmedAt:now()});
    await persist();
    /* 建模在后台跑：入库响应立刻返回，前端靠轮询 /v1/mistake-cases 看到模型出现。 */
    for (const item of buildQueue) void runConfirmedGeometryBuild(item).catch(()=>{});
    return send(res,201,{mistakeCases:cases,weakPoints:fresh,
      geometryQueue:buildQueue.map(item=>({id:item.id,status:'queued',message:item.modelMessage}))});
  }
  if (req.method === 'POST' && url.pathname === '/v1/wrong-questions/preview') {
    const source = input.source === 'image' ? 'image' : 'text';
    const questionText = String(input.questionText || '').trim();
    if (source === 'text' && !questionText) return send(res, 400, {error:'请先输入题目'});
    let image = null, supplementaryImage=null;
    if (input.imageData) image = parseImageData(input.imageData);
    if (input.supplementalImageData) supplementaryImage=parseImageData(input.supplementalImageData);
    const recognitionImage=image||supplementaryImage;
    if(source==='image'&&!recognitionImage)return send(res,400,{error:'请先上传题目照片或题目附件图'});
    if (image||supplementaryImage) {
      await mkdir(INTAKE_IMAGE_ROOT,{recursive:true});
      for(const attachment of [image,supplementaryImage].filter(Boolean)){
        const file=path.join(INTAKE_IMAGE_ROOT,attachment.hash);
        if(!existsSync(file))await writeFile(file,attachment.bytes);
      }
    }
    const {preview,recognitionStatus,recognitionProvider,recognitionError,recognitionAttempts}=
      await recognizeWrongQuestion({source:recognitionImage?'image':'text',imageData:recognitionImage?`data:${recognitionImage.mimeType};base64,${recognitionImage.bytes.toString('base64')}`:'',questionText});
    const draft = createIntakeDraft({studentId:authResolution?.user.id || 'local-student',source,fileName:input.fileName,
      imageHash:image?.hash,imageMimeType:image?.mimeType,supplementaryImageHash:supplementaryImage?.hash,
      supplementaryImageMimeType:supplementaryImage?.mimeType,supplementaryImageName:input.supplementImageName,
      preview,recognitionStatus,recognitionProvider,rawQuestion:questionText});
    db.intakeDrafts.unshift(draft);
    await persist();
    const recognitionMessage=recognitionStatus==='suggested'?null:describeRecognitionFailure({recognitionError,recognitionAttempts});
    return send(res, 201, {draft,recognitionError,recognitionAttempts,message:recognitionMessage});
  }
  const wrongQuestionRetry = url.pathname.match(/^\/v1\/wrong-questions\/drafts\/([^/]+)\/retry-preview$/);
  if (req.method === 'POST' && wrongQuestionRetry) {
    const draft=db.intakeDrafts.find(item=>item.id===wrongQuestionRetry[1] && canAccessPersonalRecord(item));
    const retryImageHash=draft?.imageHash||draft?.supplementaryImageHash;
    if (!draft || draft.status!=='awaiting_confirmation' || draft.source!=='image' || !retryImageHash)
      return send(res,404,{error:'INTAKE_DRAFT_NOT_AVAILABLE'});
    if (draft.recognitionStatus==='suggested' && draft.preview?.question)
      return send(res,200,{draft,recognitionError:'',recognitionAttempts:[],cacheHit:true});
    let bytes;
    try {bytes=await readFile(path.join(INTAKE_IMAGE_ROOT,retryImageHash))}
    catch {return send(res,404,{error:'INTAKE_IMAGE_NOT_FOUND'})}
    const retryMime=draft.imageHash?draft.imageMimeType:draft.supplementaryImageMimeType;
    const imageData=`data:${retryMime || 'image/jpeg'};base64,${bytes.toString('base64')}`;
    const result=await recognizeWrongQuestion({source:'image',imageData,questionText:draft.rawQuestion || ''});
    if (result.recognitionStatus==='suggested') {
      Object.assign(draft,{preview:result.preview,recognitionStatus:result.recognitionStatus,
        recognitionProvider:result.recognitionProvider,recognizedAt:now()});
      await persist();
    }
    const recognized=result.recognitionStatus==='suggested';
    const details=recognized?'':String(result.recognitionError||'视觉模型暂未返回可用识别结果');
    const message=recognized?undefined:describeRecognitionFailure(result);
    return send(res,recognized?200:503,{draft,
      error:recognized?undefined:'INTAKE_RECOGNITION_UNAVAILABLE',message:recognized?undefined:message,
      recognitionError:details,recognitionAttempts:result.recognitionAttempts});
  }
  const wrongQuestionConfirm = url.pathname.match(/^\/v1\/wrong-questions\/drafts\/([^/]+)\/confirm$/);
  if (req.method === 'POST' && wrongQuestionConfirm) {
    const draft = db.intakeDrafts.find(item => item.id === wrongQuestionConfirm[1] && canAccessPersonalRecord(item));
    if (!draft) return send(res, 404, {error:'INTAKE_DRAFT_NOT_FOUND'});
    if (draft.status === 'confirmed') {
      const existing = db.cases.find(item => item.id === draft.caseId && canAccessPersonalRecord(item));
      if (!existing) return send(res, 409, {error:'INTAKE_CONFIRMATION_INCONSISTENT'});
      if ((input.model3d===true||existing.geometryModelRequested===true) && String(existing.subject||'').trim().startsWith('数学') && !existing.geometryResult?.scene) {
        const built=await runConfirmedGeometryBuild(existing);
        return send(res, 200, {mistakeCase:built.case,geometryBuild:{status:built.ok?'ready':'failed',message:built.message}});
      }
      return send(res, 200, {mistakeCase:existing});
    }
    if(input.supplementalImageData){
      let attachment;try{attachment=parseImageData(input.supplementalImageData)}catch(error){return send(res,error.statusCode||400,{error:error.message})}
      await mkdir(INTAKE_IMAGE_ROOT,{recursive:true});const file=path.join(INTAKE_IMAGE_ROOT,attachment.hash);if(!existsSync(file))await writeFile(file,attachment.bytes);
      Object.assign(draft,{supplementaryImageHash:attachment.hash,supplementaryImageMimeType:attachment.mimeType,supplementaryImageName:String(input.supplementImageName||'题目附件图').slice(0,180)});
    }
    const mistakeCase = confirmWrongQuestion(draft, input);
    const discardSourceImage=input.retainSourceImage===false;
    if(discardSourceImage)mistakeCase.sourceImage=null;
    if(String(mistakeCase.subject||'').startsWith('物理')&&/电场|电势|点电荷|带电|电子|极板/.test(mistakeCase.question||'')){
      const electric=compileElectricFieldProblem(mistakeCase.question);
      mistakeCase.electricFieldModel={spec:electric.spec,bench:electric.bench,motionPrinciple:electric.motionPrinciple,
        notice:electric.notice,sourceImage:mistakeCase.sourceImage||null,status:electric.status,version:'electric-problem-spec/v1'};
    }
    const buildRequested=input.model3d===true && String(mistakeCase.subject||'').trim().startsWith('数学');
    mistakeCase.geometryModelRequested=buildRequested;
    if(buildRequested){mistakeCase.geometryBuildStatus='queued';mistakeCase.modelMessage='题目已保存，正在排队生成 3D 模型…';}
    // 本题得分点：入库后按题目反推（数学 / 物理），前端会轮询状态，不阻塞入库响应。
    mistakeCase.aiStepsStatus=supportsAiRubric(mistakeCase.subject)?'queued':'skipped';
    mistakeCase.aiStepsMessage=supportsAiRubric(mistakeCase.subject)?'正在按这道题反推得分点…':'';
    mistakeCase.aiStepsUpdatedAt=now();
    db.cases.unshift(mistakeCase);
    const discardedImageHash=discardSourceImage?draft.imageHash:null;
    Object.assign(draft, {status:'confirmed',caseId:mistakeCase.id,confirmedAt:now(),
      ...(discardSourceImage?{imageHash:null,imageMimeType:null}:{} )});
    db.events.push({id:randomUUID(),type:'wrong_question_confirmed',caseId:mistakeCase.id,
      payload:{changedFields:mistakeCase.studentCorrections.changedFields,source:draft.source,geometryModelRequested:buildRequested},createdAt:now()});
    await persist();
    if(discardedImageHash){
      const stillReferenced=db.intakeDrafts.some(item=>item.imageHash===discardedImageHash||item.supplementaryImageHash===discardedImageHash)
        ||db.cases.some(item=>item.sourceImage?.hash===discardedImageHash||item.supplementaryImage?.hash===discardedImageHash
          ||item.electricFieldModel?.supplementaryImage?.hash===discardedImageHash);
      if(!stillReferenced)await rm(path.join(INTAKE_IMAGE_ROOT,discardedImageHash),{force:true}).catch(()=>{});
    }
    if(buildRequested) {
      /* 不 await：立刻把「已入库 + 正在生成 3D 模型」返回给前端，
         前端在错题库里立刻能看到这道题和「正在生成中」的面板，生成完再自动回填。 */
      void runConfirmedGeometryBuild(mistakeCase).catch(()=>{});
      return send(res,201,{mistakeCase,geometryBuild:{status:'queued',message:mistakeCase.modelMessage}});
    }
    // 没有请求 3D 建模时，得分点反推同样在后台跑。
    void runConfirmedAiRubricBuild(mistakeCase).catch(()=>{});
    return send(res, 201, {mistakeCase});
  }
  if (req.method === 'GET' && url.pathname === '/v1/weak-points') {
    // 两个来源：AI 陪练里的答错/不完整（answer_evaluation），以及拍照录入时从手写做题记录反推的卡点（process_review）。
    return send(res, 200, db.weakPoints.filter(item=>canAccessPersonalRecord(item)
      && (['answer_evaluation','process_review'].includes(item.evidenceType) || ['回答错误','回答不完整'].includes(item.signal))));
  }
  if (req.method === 'POST' && url.pathname === '/v1/ingestions') {
    input.modelingMode = input.modelingMode === 'tutor_only' ? 'tutor_only' : 'model_first';
    input.modelAttemptTrace = [];
    if (input.modelingMode === 'tutor_only') {
      const item = await createIncompleteGeometryIngestion(input);
      Object.assign(item, {status:'tutor_only', workflowStatus:'completed', modelingMode:'tutor_only', modelAttemptTrace:[{stage:'student_choice',status:'skipped',reason:'tutor_only'}]});
      Object.assign(item.mistakeCase, {verificationStatus:'learning_without_3d', modelStatus:'skipped_by_student', modelMessage:'你选择了仅 AI 问答；本题不会调用或生成 3D，可随时重新以“3D 优先”提交。', visualization:{renderer:'none',reason:'skipped_by_student'}});
      item.draft = item.mistakeCase;
      await persist();
      return send(res, 201, item);
    }
    if (!input.templateId && trustedGeometryPipeline && (String(input.questionText || '').trim() || input.imageData)) {
      const normalized = normalizeGeometryInput(input);
      /* ------------------------------------------------------------------
         异步作业模式（input.asyncJob === true）
         立体几何编译要 80~150 秒，让 HTTP 请求一直挂着等很不稳：
         浏览器/代理/网关随时可能断开，用户也看不到任何进展。
         这里立刻返回作业号，编译放到后台跑，由前端轮询进度。
         ------------------------------------------------------------------ */
      if (input.asyncJob === true) {
        const cachedCase = findVerifiedGeometryCache(input, normalized);
        if (cachedCase) {
          input.modelAttemptTrace.push({stage:'verified_cache',status:'verified'});
          const ingestion = await persistTrustedGeometry(input, compiledFromCachedCase(cachedCase), {cacheHit: true});
          return send(res, 201, {...ingestion, modelingMode:'model_first', modelAttemptTrace:input.modelAttemptTrace});
        }
        const job = createGeometryJob(input, normalized);
        startGeometryJob(job);
        return send(res, 202, {jobId: job.id, status: job.status, stage: job.stage, message: job.message, asyncJob: true});
      }
      const cachedCase = findVerifiedGeometryCache(input, normalized);
      if (cachedCase) {
        input.modelAttemptTrace.push({stage:'verified_cache',status:'verified'});
        const ingestion = await persistTrustedGeometry(input, compiledFromCachedCase(cachedCase), {cacheHit: true});
        return send(res, 201, {...ingestion, modelingMode:'model_first', modelAttemptTrace:input.modelAttemptTrace});
      }
      try {
        const compiled = await compileGeometryWithModelCache(input);
        if (compiled.status === 'verified_unique' || compiled.status === 'verified_representative' || compiled.status === 'ai_reference') {
          input.modelAttemptTrace.push({stage:'deepseek_validator',status:compiled.status === 'ai_reference' ? 'reference' : 'verified',result:compiled.status});
          const ingestion = await persistTrustedGeometry(input, compiled, {cacheHit: Boolean(compiled.cacheHit)});
          return send(res, 201, {...ingestion, modelingMode:'model_first', modelAttemptTrace:input.modelAttemptTrace});
        }
        input.modelAttemptTrace.push({stage:'deepseek_validator',status:'failed',result:compiled.status});
        input.trustedGeometryFailure = {
          status: compiled.status,
          failureCategory: compiled.failureCategory || null,
          httpStatus: compiled.httpStatus || null,
          retryable: compiled.retryable !== false,
          attempts: compiled.attempts || [],
          failedConstraints: compiled.validation?.failedConstraints || [],
          gateIssues: compiled.gate?.issues || [],
          retainedCandidate: compiled.retainedCandidate || null,
          validation: compiled.validation || null
        };
      } catch (error) {
        input.modelAttemptTrace.push({stage:'deepseek_validator',status:'failed',result:'model_request_failed',failureCategory:error.code||'MODEL_REQUEST_ERROR',provider:error.provider||'deepseek',httpStatus:error.httpStatus||null,requestId:error.requestId||null});
        input.trustedGeometryFailure = {status: 'model_request_failed', failureCategory:error.code||'MODEL_REQUEST_ERROR',provider:error.provider||'deepseek',httpStatus:error.httpStatus||null,requestId:error.requestId||null,retryable:error.retryable!==false,message: String(error.message || error)};
      }
    }
    if (input.source === 'text' && !input.templateId) {
      const cubeIR = parseCubeGeometryText(input.questionText);
      if (cubeIR) {
        const result = buildVerifiedCubeGeometry(cubeIR), caseId = randomUUID(), createdAt = now();
        const mistakeCase = {
          id:caseId,...(input.studentId?{studentId:input.studentId}:{}),subject:'数学',unit:'空间几何',question:cubeIR.text,
          studentAnswer:String(input.studentAnswer||'').trim()||'待开始真实作答',correctAnswer:'请逐项验证后作答',correctAnswerLatex:'',
          analysis:'正方体基础模型由棱长和标准拓扑确定；各选项的辅助构造由当前小问独立驱动。',knowledgePoints:['正方体','空间关系'],microSkills:['用坐标与空间关系逐项验证'],errorCauses:[],
          verificationStatus:'verified',geometryResult:result,visualization:{renderer:'three',interactive:true,scene:result.scene},origin:'cube_geometry_deterministic',createdAt,confirmedAt:createdAt
        };
        input.modelAttemptTrace.push({stage:'deterministic_cube',status:'verified'});
        const item={id:randomUUID(),caseId,source:'text',templateId:'cube-standard-topology',status:'verified',workflowStatus:'completed',modelingMode:'model_first',modelAttemptTrace:input.modelAttemptTrace,result,draft:mistakeCase,mistakeCase,...(input.studentId?{studentId:input.studentId}:{}),createdAt};
        db.cases.unshift(mistakeCase);db.ingestions.unshift(item);await persist();return send(res,201,item);
      }
      const polyhedronInput=parseStandardPolyhedronText(input.questionText);
      if(polyhedronInput&&!polyhedronInput.status){
        const compiled=compilePolyhedronGeometryIR(polyhedronInput.problemIR);
        if(compiled.status==='verified_unique'){
          const result=compiled.result,caseId=randomUUID(),createdAt=now();
          const mistakeCase={id:caseId,...(input.studentId?{studentId:input.studentId}:{}),subject:'数学',unit:'空间几何',question:polyhedronInput.questionText,studentAnswer:String(input.studentAnswer||'').trim()||'待开始真实作答',correctAnswer:result.answer.displayPlain,correctAnswerLatex:'',analysis:'本题已进入统一多面体 IR；拓扑、空间角/距离和截面均由确定性几何内核逐项验证。',knowledgePoints:polyhedronInput.labels,microSkills:['从点线面约束建立模型','用投影或法向量计算空间关系','用截平面与棱求真实交点'],errorCauses:[],verificationStatus:'verified',modelStatus:'verified',goalResult:compiled.goalResult,problemSpec:polyhedronInput.problemIR,geometryResult:result,visualization:{renderer:'three',interactive:true,scene:result.scene},origin:'polyhedron_geometry_deterministic',createdAt,confirmedAt:createdAt};
          input.modelAttemptTrace.push({stage:'deterministic_polyhedron',status:'verified'});
          const item={id:randomUUID(),caseId,source:'text',templateId:'polyhedron-ir-v1',status:'verified',workflowStatus:'completed',modelingMode:'model_first',modelAttemptTrace:input.modelAttemptTrace,result,problemIR:polyhedronInput.problemIR,queryResults:compiled.queryResults,goalResult:compiled.goalResult,draft:mistakeCase,mistakeCase,...(input.studentId?{studentId:input.studentId}:{}),createdAt};
          db.cases.unshift(mistakeCase);db.ingestions.unshift(item);await persist();return send(res,201,item);
        }
      }
      if(polyhedronInput?.status==='needs_more_context'){
        input.modelAttemptTrace.push({stage:'deterministic_polyhedron',status:'needs_more_context',missing:polyhedronInput.missing});
        const trustedFailureStatus=input.trustedGeometryFailure?.status||'';
        const trustedFailureMustNotMasqueradeAsMissing=['model_request_failed','provider_unavailable','provider_auth_failed','provider_billing_required','provider_rate_limited','ir_invalid','evidence_failed','validation_failed','solver_failed'].includes(trustedFailureStatus);
        if(!trustedFailureMustNotMasqueradeAsMissing){
          const item=await createIncompleteGeometryIngestion({...input,source:'text'});item.status=item.workflowStatus='needs_more_context';item.guidance=`要生成经过验证的多面体模型，目前只缺：${polyhedronInput.missing.join('、')}。补充后会直接重新解析，不需要重新上传。`;item.mistakeCase.modelStatus='needs_more_context';item.mistakeCase.modelMessage=item.guidance;await persist();return send(res,202,{...item,missingItems:polyhedronInput.missing.map(label=>({id:'polyhedron-'+label,label,whyNeeded:'这是确定真实比例或空间位置所需的最小建模信息。',prompt:`请补充${label}。`}))});
        }
      }
      const circularIR = parseCircularGeometryText(input.questionText, input.studentAnswer);
      if (circularIR && !circularIR.status && circularIR.body && circularIR.problem?.questionText) {
        const circularResult = await solveConfirmedGeometry(circularIR);
        if (circularResult.solverStatus === 'verified') {
          input.modelAttemptTrace.push({stage:'deterministic_circular',status:'verified'});
          const mistakeCase = makeVerifiedCircularCase(circularIR, circularResult, {source: 'text', studentId: input.studentId});
          const ingestion = {
            id: randomUUID(), caseId: mistakeCase.id, source: 'text', templateId: `circular-${circularIR.body.type}`,
            ...(input.studentId ? {studentId: input.studentId} : {}),
            status: 'verified', workflowStatus: 'completed', modelingMode:'model_first', modelAttemptTrace:input.modelAttemptTrace, result: circularResult, problemIR: circularIR,
            internalReview: {status: 'passed', independent: true, reviewer: 'circular_constraint_validator_v2', issues: [], checks: circularResult.verification?.checks || [], reviewedAt: now()},
            draft: mistakeCase, mistakeCase, createdAt: now()
          };
          db.cases.unshift(mistakeCase);
          db.ingestions.unshift(ingestion);
          await persist();
          return send(res, 201, ingestion);
        }
      }
      const triangularIR=parseProjectionDihedralTriangularPyramid(input.questionText);
      if(triangularIR){
        const solved=await solveGeometryIRV3(adaptGeometryIRV3(triangularIR));
        if(solved.status!=='verified')return send(res,422,{error:solved.failureCode||'TRIANGULAR_PYRAMID_NOT_VERIFIED',result:solved});
        const result=solved.result,caseId=randomUUID();
        const mistakeCase={
          id:caseId,subject:'数学',unit:'空间几何',question:input.questionText,
          ...(input.studentId?{studentId:input.studentId}:{}),
          studentAnswer:String(input.studentAnswer||'').trim()||'待补充学生作答过程',
          correctAnswer:result.answer.displayPlain,correctAnswerLatex:result.answer.latex,
          analysis:'题目条件已转换为统一 geometry-ir/v3，并由 SymPy 坐标约束与独立复核共同验证。',
          knowledgePoints:['三棱锥','垂直关系证明','二面角','线面角','棱锥体积'],errorCauses:[],
          verificationStatus:'verified',problemSpec:solved.problemIR,geometryResult:result,
          visualization:{renderer:'three',interactive:true,scene:result.scene},origin:'triangular_pyramid_deterministic',createdAt:now(),confirmedAt:now()
        };
        input.modelAttemptTrace.push({stage:'deterministic_triangular_pyramid',status:'verified'});
        db.cases.unshift(mistakeCase);db.ingestions.unshift({id:randomUUID(),caseId,source:'text',templateId:'triangular-pyramid-projection-dihedral',status:'verified',workflowStatus:'completed',modelingMode:'model_first',modelAttemptTrace:input.modelAttemptTrace,result,draft:mistakeCase,...(input.studentId?{studentId:input.studentId}:{}),createdAt:now()});
        await persist();return send(res,201,{status:'verified',modelingMode:'model_first',modelAttemptTrace:input.modelAttemptTrace,mistakeCase,result,problemIR:solved.problemIR});
      }
      const parsed = parseDeterministicGeometryText(input.questionText, input.studentAnswer)
        || parseAllEqualPyramidText(input.questionText, input.studentAnswer);
      if (!parsed) {
        input.modelAttemptTrace.push({stage:'deterministic_registry',status:'not_matched'});
        const item = await createIncompleteGeometryIngestion(input);
        const error = item.status === 'provider_pending_retry' ? 'PROVIDER_PENDING_RETRY'
          : item.status === 'provider_auth_failed' ? 'PROVIDER_AUTH_FAILED'
          : item.status === 'provider_billing_required' ? 'PROVIDER_BILLING_REQUIRED'
          : item.status === 'provider_rate_limited' ? 'PROVIDER_RATE_LIMITED'
          : item.status === 'model_parse_failed' ? 'MODEL_RESPONSE_INVALID'
          : item.status === 'model_evidence_failed' ? 'MODEL_EVIDENCE_FAILED'
          : item.status === 'model_validation_failed' ? 'MODEL_VALIDATION_FAILED'
          : item.status === 'model_unsupported' ? 'MODEL_CAPABILITY_UNSUPPORTED'
          : 'TEXT_PROBLEM_NEEDS_MORE_CONTEXT';
        return send(res, 202, {...item, error, supportedCapability: DETERMINISTIC_TEMPLATE, supplementPanel: item.modelAudit});
      }
      const item = await createDeterministicIngestion({...parsed, studentId: input.studentId});
      const job = await enqueueInternallyReviewedIngestion(item);
      if (!job) return send(res, 202, {...item, status: 'needs_more_context', workflowStatus: 'needs_more_context', guidance: item.guidance || missingInformationGuidance(item.internalReview)});
      return send(res, 202, {...item, workflowId: job.id});
    }
    if (isDeterministicTemplate(input)) {
      if (!hasValidDeterministicParameters(input)) return send(res, 422, {error: 'INVALID_DETERMINISTIC_PARAMETERS'});
      const item = await createDeterministicIngestion(input);
      return send(res, 201, item);
    }
    if (input.templateId) return send(res, 422, {error: 'CAPABILITY_NOT_REGISTERED'});
    if (input.source === 'image' && !(modelConfig.endpoint && modelConfig.apiKey) && !(process.env.QWEN_VL_ENDPOINT && process.env.QWEN_API_KEY)) {
      const item = await createIncompleteGeometryIngestion({...input, questionText: input.questionText || ''});
      item.internalReview = {
          status: 'failed',
          independent: true,
          reviewer: 'geometry_scene_validator_v1',
          issues: ['未配置 DeepSeek Vision 或其他视觉模型，图片尚未被真实读取，未写入错题库'],
          warnings: [],
          reviewedAt: now()
      };
      await persist();
      return send(res, 202, {...item, error: 'IMAGE_EXTRACTION_UNAVAILABLE', supplementPanel: item.modelAudit});
    }
    const result = await geometryWorkflow.run(input);
    // 图片识别不能只停在“通用场景”。如果视觉模型读出了圆体及尺寸，
    // 立即复用和文本完全相同的 IR → SymPy → Three.js 验证链路。
    const circularCandidate = result.extraction?.circularGeometry;
    const circularIR = parseCircularGeometryText(
      result.extraction?.questionText || input.questionText || '',
      result.extraction?.studentAnswer || input.studentAnswer || '',
      circularCandidate
    );
    if (circularIR && !circularIR.status && circularIR.body && circularIR.problem?.questionText) {
      try {
        const circularResult = await solveConfirmedGeometry(circularIR);
        if (circularResult.solverStatus === 'verified') {
          const mistakeCase = makeVerifiedCircularCase(circularIR, circularResult, {source: input.source || 'image', fileName: input.fileName || '', studentId: input.studentId});
          const item = {id: randomUUID(), ...(input.studentId ? {studentId: input.studentId} : {}), workflowId: result.id, caseId: mistakeCase.id, status: 'verified', workflowStatus: 'completed', fileName: input.fileName || '几何错题', createdAt: now(), internalReview: {status: 'passed', independent: true, reviewer: 'geometry_ir_constraint_validator_v1', issues: [], warnings: result.validation.warnings, reviewedAt: now()}, mistakeCase};
          db.ingestions.unshift(item);
          db.workflows.unshift({id: result.id, ...(input.studentId ? {studentId: input.studentId} : {}), type: result.type, status: 'completed', stages: result.stages, result: {...result, verifiedCircularIR: circularIR, verifiedCircularResult: circularResult}, createdAt: result.createdAt, completedAt: now()});
          db.cases.unshift(mistakeCase);
          await persist();
          return send(res, 201, item);
        }
      } catch {
        // 保留视觉流程的原始诊断；不能因一个候选模型失败就丢失题目。
      }
    }
    const authenticImageExtraction = input.source !== 'image'
      || (result.extraction.provider !== 'local-demo' && result.extraction.model !== 'geometry-vision-fallback');
    const internalReview = {
      status: result.validation.valid && authenticImageExtraction ? 'passed' : 'failed',
      independent: true,
      reviewer: 'geometry_scene_validator_v1',
      issues: [
        ...result.validation.issues,
        ...(!authenticImageExtraction ? ['未配置真实视觉模型，禁止用本地占位几何替代学生上传题目'] : [])
      ],
      warnings: result.validation.warnings,
      reviewedAt: now()
    };
    const baseDraft = workflowToDraft(result, input);
    const mistakeCase = internalReview.status === 'passed' ? {
      ...baseDraft,
      id: randomUUID(),
      ...(input.studentId ? {studentId: input.studentId} : {}),
      verificationStatus: 'internally_reviewed',
      internalReview,
      structuredProblem: {extraction: result.extraction, scene: result.scene},
      createdAt: now()
    } : null;
    const item = {id: randomUUID(), ...(input.studentId ? {studentId: input.studentId} : {}), workflowId: result.id, status: result.status, fileName: input.fileName || '几何错题', createdAt: now(), internalReview, ...(mistakeCase ? {mistakeCase} : {})};
    db.ingestions.unshift(item);
    db.workflows.unshift({id: result.id, ...(input.studentId ? {studentId: input.studentId} : {}), type: result.type, status: result.status, stages: result.stages, result, createdAt: result.createdAt, completedAt: now()});
    if (mistakeCase) db.cases.unshift(mistakeCase);
    await persist();
    return internalReview.status === 'passed'
      ? send(res, 201, item)
      : send(res, 202, {
        status: 'needs_more_context',
        error: authenticImageExtraction ? 'INTERNAL_REVIEW_FAILED' : 'IMAGE_EXTRACTION_UNAVAILABLE',
        ingestionId: item.id,
        internalReview,
        guidance: missingInformationGuidance(internalReview)
      });
  }
  const ingestionMatch = url.pathname.match(/^\/v1\/ingestions\/([^/]+)$/);
  const supplementMatch = url.pathname.match(/^\/v1\/ingestions\/([^/]+)\/supplements$/);
  if (req.method === 'POST' && supplementMatch) {
    const ingestion = db.ingestions.find(entry => entry.id === supplementMatch[1] && canAccessPersonalRecord(entry));
    const supplementText = String(input.supplementText || '').trim();
    if (!ingestion) return send(res, 404, {error: 'ingestion_not_found'});
    if (!supplementText) return send(res, 422, {error: 'SUPPLEMENT_TEXT_REQUIRED'});
    if(input.expectedRevision!==undefined&&Number(input.expectedRevision)!==Number(ingestion.revision||1))return send(res,409,{error:'REVISION_CONFLICT',currentRevision:ingestion.revision||1});
    const originalQuestion = String(ingestion.draft?.question || '').trim();
    const normalizedSupplement = value => String(value || '').replace(/\\[()]/g, '').replace(/\s+/g, '').toUpperCase();
    const correctionPairs=[...supplementText.matchAll(/([A-Z][A-Z0-9_]*)\s*(?:改为|应为|更正为)\s*([A-Z][A-Z0-9_]*)/gi)].map(match=>[match[1],match[2]]);
    let revisedQuestion=originalQuestion;
    for(const [before,after] of correctionPairs)revisedQuestion=revisedQuestion.replace(new RegExp(before.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),after);
    const isCorrection=correctionPairs.length>0;
    const alreadyIncluded = normalizedSupplement(revisedQuestion).includes(normalizedSupplement(supplementText));
    ingestion.draft.question = isCorrection||alreadyIncluded ? revisedQuestion : `${revisedQuestion}\n补充信息：${supplementText}`.trim();
    if (typeof input.studentAnswer === 'string' && input.studentAnswer.trim()) ingestion.draft.studentAnswer = input.studentAnswer.trim();
    ingestion.revision = Number(ingestion.revision || 1) + 1;
    if (!ingestion.supplementHistory.some(item => normalizedSupplement(item.text) === normalizedSupplement(supplementText))) ingestion.supplementHistory.push({text: supplementText, kind:isCorrection?'correction':'supplement', replacements:correctionPairs.map(([from,to])=>({from,to})), createdAt: now()});
    const polyhedronInput = parseStandardPolyhedronText(ingestion.draft.question);
    if (polyhedronInput && !polyhedronInput.status) {
      const compiled = compilePolyhedronGeometryIR(polyhedronInput.problemIR);
      if (compiled.status === 'verified_unique') {
        const result=compiled.result,createdAt=ingestion.draft.createdAt||ingestion.createdAt||now();
        const mistakeCase={...ingestion.draft,id:ingestion.caseId,subject:'数学',unit:'空间几何',question:polyhedronInput.questionText,studentAnswer:ingestion.draft.studentAnswer||'待开始真实作答',correctAnswer:result.answer.displayPlain,correctAnswerLatex:result.answer.latex||'',analysis:'补充信息已进入统一多面体 IR；全部坐标、派生点和向量关系已通过确定性验证。',knowledgePoints:polyhedronInput.labels,microSkills:['识别等式链与根式尺寸','由中点构造派生点','用点积求空间向量夹角'],errorCauses:[],verificationStatus:'verified',modelStatus:'verified',goalResult:compiled.goalResult,revision:ingestion.revision,supplementHistory:structuredClone(ingestion.supplementHistory),problemSpec:polyhedronInput.problemIR,geometryResult:result,visualization:{renderer:'three',interactive:true,scene:result.scene},origin:'polyhedron_geometry_deterministic',createdAt,confirmedAt:now(),updatedAt:now()};
        Object.assign(ingestion,{status:'verified',workflowStatus:'completed',templateId:'polyhedron-ir-v1',result,problemIR:polyhedronInput.problemIR,queryResults:compiled.queryResults,goalResult:compiled.goalResult,draft:mistakeCase,mistakeCase});
        db.cases=[mistakeCase,...db.cases.filter(entry=>entry.id!==mistakeCase.id)];await persist();return send(res,200,ingestion);
      }
    }
    const parsed = parseDeterministicGeometryText(ingestion.draft.question, ingestion.draft.studentAnswer);
    if (!parsed) {
      const audit = auditSolidGeometryModelInput({questionText: ingestion.draft.question, studentAnswer: ingestion.draft.studentAnswer, source: ingestion.source});
      const nextStatus = audit.status === 'unsupported' ? 'model_unsupported' : 'needs_more_context';
      ingestion.modelAudit = audit; ingestion.status = nextStatus; ingestion.workflowStatus = nextStatus;
      ingestion.guidance = missingInformationGuidance(audit); await persist();
      return send(res, 202, {...ingestion, supplementPanel: audit});
    }
    ingestion.parameters = parsed.parameters;
    ingestion.draft.extraction = parsed.draft.extraction;
    const job = await enqueueInternallyReviewedIngestion(ingestion);
    if (!job) return send(res, 202, {...ingestion, supplementPanel: ingestion.modelAudit});
    return send(res, 202, {...ingestion, workflowId: job.id});
  }
  if (req.method === 'GET' && ingestionMatch) {
    const item = db.ingestions.find(entry => entry.id === ingestionMatch[1] && canAccessPersonalRecord(entry));
    return item ? send(res, 200, item) : send(res, 404, {error: 'ingestion_not_found'});
  }
  const confirmMatch = url.pathname.match(/^\/v1\/mistake-cases\/([^/]+)\/confirm$/);
  if (req.method === 'POST' && confirmMatch) {
    const ingestion = db.ingestions.find(entry => entry.caseId === confirmMatch[1] && entry.templateId === DETERMINISTIC_TEMPLATE && canAccessPersonalRecord(entry));
    if (ingestion) {
      const idempotencyKey = req.headers['idempotency-key'];
      if (!idempotencyKey) return send(res, 400, {error: 'IDEMPOTENCY_KEY_REQUIRED'});
      const idempotencyScope = `confirm:${ingestion.studentId || 'local'}:${ingestion.caseId}:${idempotencyKey}`;
      const payloadKey = JSON.stringify(input);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      db.idempotency = db.idempotency.filter(entry => Date.parse(entry.createdAt) >= cutoff);
      const persistedPrevious = db.idempotency.find(entry => entry.key === idempotencyScope);
      const pendingPrevious = pendingIdempotency.get(idempotencyScope);
      const previous = persistedPrevious || pendingPrevious;
      if (previous && previous.payloadKey !== payloadKey) return send(res, 409, {error: 'IDEMPOTENCY_KEY_REUSED'});
      if (pendingPrevious) {
        const completed = await pendingPrevious.completion;
        return completed ? send(res, 202, pendingPrevious.response) : send(res, 503, {error: 'CONFIRMATION_PERSIST_FAILED'});
      }
      if (persistedPrevious) return send(res, 202, persistedPrevious.response);
      if (input.expectedRevision !== ingestion.revision) return send(res, 409, {error: 'REVISION_CONFLICT'});
      if (input.acceptedTemplateVersion !== ingestion.templateVersion) return send(res, 409, {error: 'TEMPLATE_VERSION_CONFLICT'});
      const confirmed = new Set(input.confirmedRelationIds || []);
      if (!confirmed.has('r-base') || !confirmed.has('r-height')) return send(res, 422, {error: 'REQUIRED_RELATIONS_UNCONFIRMED'});
      ingestion.confirmedRelationIds = ['r-base', 'r-height'];
      ingestion.confirmedAt = now();
      const workflowId = randomUUID();
      const response = {workflowId, workflowStatus: 'queued', solverStatus: 'not_started'};
      let completePending;
      const completion = new Promise(resolve => { completePending = resolve; });
      pendingIdempotency.set(idempotencyScope, {key: idempotencyScope, payloadKey, response, completion});
      try {
        await enqueueDeterministicWorkflow(ingestion, workflowId);
        db.idempotency.push({key: idempotencyScope, externalKey: idempotencyKey, caseId: ingestion.caseId, payloadKey, response, createdAt: now()});
        await persist();
        completePending(true);
      } catch (error) {
        completePending(false);
        throw error;
      } finally {
        pendingIdempotency.delete(idempotencyScope);
      }
      return send(res, 202, response);
    }
    const existingCase = db.cases.find(entry => entry.id === confirmMatch[1]);
    if (AUTH_REQUIRED && existingCase && !canAccessPersonalRecord(existingCase)) return send(res, 404, {error: 'MISTAKE_CASE_NOT_FOUND'});
    const item = {...input, id: confirmMatch[1], ...(authResolution ? {studentId: authResolution.user.id} : {}), verificationStatus: 'confirmed', confirmedAt: now()};
    db.cases = [item, ...db.cases.filter(entry => entry.id !== item.id)];
    await persist();
    return send(res, 201, item);
  }
  if (req.method === 'POST' && url.pathname === '/v1/tutor/sessions') {
    const canonicalCase = db.cases.find(item => item.id === input.caseId && canAccessPersonalRecord(item));
    if (AUTH_REQUIRED && !canonicalCase) return send(res, 404, {error: 'MISTAKE_CASE_NOT_FOUND'});
    if (canonicalCase?.problemSpec?.questionKind === 'single_choice' || canonicalCase?.problemSpec?.questionKind === 'multiple_choice') {
      input.context = {...(input.context || {}), choiceAnswer:Array.isArray(canonicalCase.problemSpec.choiceAnswer) ? canonicalCase.problemSpec.choiceAnswer : []};
    }
    // 把这道题真实的几何编译数据带进陪练上下文：得分点由题目本身的解题步骤与所问量推导，
    // 调用方显式给出的字段优先。只影响新建会话，已有会话继续沿用自己保存的上下文。
    if (canonicalCase) {
      const compiledContext = tutorGeometryContext(canonicalCase);
      // 本题得分点：AI 反推的结果随题目持久化，这里带进会话上下文供 tutor-session 优先取用。
      const aiRubric = canonicalCase.aiRubric && Array.isArray(canonicalCase.aiRubric.steps) && canonicalCase.aiRubric.steps.length
        ? canonicalCase.aiRubric : null;
      input.context = {subject:canonicalCase.subject,question:canonicalCase.question,
        knowledgePoints:canonicalCase.knowledgePoints || [],
        handwrittenNotes:canonicalCase.handwrittenNotes || [],
        confirmedErrorCause:canonicalCase.errorCauses?.[0] || '',
        confirmedErrorCauseEvidence:canonicalCase.errorCauseEvidence || '',
        // 试卷/批量录入时抄下来的解题过程与卡点：陪练据此从学生停下的那一步接着教。
        solutionSteps:canonicalCase.processSteps || [],
        stuckPoint:canonicalCase.stuckAt || null,
        // 学生当时写的原话答案 + 题干旁的批注：这两样是「学生当时的思路」，
        // 陪练判断薄弱点要引用它们，而不是只看正确结论。
        ...(String(canonicalCase.studentAnswer||'').trim()?{studentAnswer:String(canonicalCase.studentAnswer).slice(0,1200)}:{}),
        ...(Array.isArray(canonicalCase.marginNotes)&&canonicalCase.marginNotes.length?{marginNotes:canonicalCase.marginNotes.slice(0,12)}:{}),
        // 答案来源必须一起传：derived 表示答案是 AI 自己推的，
        // 陪练不能把一份「可能是错的」推导当成标准答案去纠正学生。
        ...(canonicalCase.answerSource?{answerSource:String(canonicalCase.answerSource)}:{}),
        ...(canonicalCase.answerConfidence?{answerConfidence:String(canonicalCase.answerConfidence)}:{}),
        ...(aiRubric?{aiRubric}:{}),
        ...(compiledContext || {}),...(input.context || {})};
    }
    const subproblemId = String(input.context?.subproblemId || '');
    const initialStudentMessage = String(input.initialStudentMessage || '').trim();
    const matchingSessions = db.tutorSessions.filter(item => item.caseId === input.caseId
      && canAccessPersonalRecord(item)
      && String(item.context?.subproblemId || '') === subproblemId
    );
    let session = matchingSessions.find(item => item.status !== 'completed')
      || (!initialStudentMessage ? matchingSessions[0] : null);
    const resumed = Boolean(session);
    if (!session) {
      session = createTutorSession(input);
      if (authResolution) {session.studentId = authResolution.user.id;session.user_id = authResolution.user.id;}
      else session.user_id = session.studentId || 'local-student';
      db.tutorSessions.unshift(session);
      db.events.push({id: randomUUID(), type: 'tutor_session_started', payload: session, createdAt: now()});
    } else reconcileTutorSession(session);
    if (initialStudentMessage) {
      await advanceTutorSession(session, {studentMessage: initialStudentMessage}, tutorAdapter);
      recordTutorSignals(session,{studentMessage:initialStudentMessage},session.latestTurn);
      const weakPoint = weakPointFromTutorTurn(session, session.latestTurn);
      if (weakPoint) db.weakPoints.unshift(weakPoint);
      db.events.push({id: randomUUID(), type: 'tutor_turn_evaluated', sessionId: session.id, payload: session.latestTurn, createdAt: now()});
    }
    if (resumed) db.events.push({id: randomUUID(), type: 'tutor_session_resumed', sessionId: session.id, createdAt: now()});
    await persist();
    return send(res, resumed ? 200 : 201, session);
  }
  const tutorCardsMatch=url.pathname.match(/^\/v1\/tutor\/sessions\/([^/]+)\/knowledge-cards$/);
  if(req.method==='POST'&&tutorCardsMatch){
    const session=db.tutorSessions.find(item=>item.id===tutorCardsMatch[1]&&canAccessPersonalRecord(item));
    if(!session)return send(res,404,{error:'TUTOR_SESSION_NOT_FOUND'});
    const localOnly=input?.localOnly===true;
    const job=await generateKnowledgeCards(localOnly?`tutor-local-v2:${session.id}`:`tutor:${session.id}`,tutorCardSource(session),localOnly?{engine:localEvidenceCardEngine}:undefined);
    return send(res,job.status==='completed'?200:503,{job,cards:db.knowledgeCards.filter(card=>card.sourceCaseIds?.includes(session.caseId))});
  }
  const tutorMatch = url.pathname.match(/^\/v1\/tutor\/sessions\/([^/]+)\/events$/);
  const tutorStreamMatch = url.pathname.match(/^\/v1\/tutor\/sessions\/([^/]+)\/events\/stream$/);
  if (req.method === 'POST' && tutorStreamMatch) {
    const session = db.tutorSessions.find(item => item.id === tutorStreamMatch[1] && canAccessPersonalRecord(item));
    if (!session) return send(res, 404, {error:'TUTOR_SESSION_NOT_FOUND'});
    res.writeHead(200, {'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform',
      'connection':'keep-alive','access-control-allow-origin':CORS_ORIGIN});
    const emit = (kind,payload) => {if (!res.destroyed) res.write(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`)};
    emit('status',{stage:'evaluating'});
    try {
      await advanceTutorSession(session,input,tutorAdapter);
      if (input.action !== 'complete') {
        recordTutorSignals(session,input,session.latestTurn);
        const weakPoint = weakPointFromTutorTurn(session,session.latestTurn);
        if (weakPoint) db.weakPoints.unshift(weakPoint);
      }
      db.events.push({id:randomUUID(),type:input.action==='complete'?'tutor_session_completed':'tutor_turn_evaluated',
        sessionId:session.id,payload:session.latestTurn || null,createdAt:now()});
      if(input.action==='complete'||session.learningState?.scoreProgress?.percent===100)
        session.knowledgeCardGeneration=await generateKnowledgeCards(`tutor:${session.id}`,tutorCardSource(session));
      await persist();
      emit('session',session);
    } catch(error) { emit('error',{error:String(error.message||error)}) }
    return res.end();
  }
  if (req.method === 'POST' && tutorMatch) {
    const session = db.tutorSessions.find(item => item.id === tutorMatch[1] && canAccessPersonalRecord(item));
    if (!session) return send(res, 404, {error: 'TUTOR_SESSION_NOT_FOUND'});
    await advanceTutorSession(session, input, tutorAdapter);
    if (input.action !== 'complete') {
      recordTutorSignals(session,input,session.latestTurn);
      const weakPoint = weakPointFromTutorTurn(session, session.latestTurn);
      if (weakPoint) db.weakPoints.unshift(weakPoint);
    }
    db.events.push({id: randomUUID(), type: input.action === 'complete' ? 'tutor_session_completed' : 'tutor_turn_evaluated', sessionId: session.id, payload: session.latestTurn || null, createdAt: now()});
    if(input.action==='complete'||session.learningState?.scoreProgress?.percent===100)session.knowledgeCardGeneration=await generateKnowledgeCards(`tutor:${session.id}`,tutorCardSource(session));
    await persist();
    return send(res, 200, session);
  }
  if(req.method==='GET'&&url.pathname==='/v1/knowledge-cards'){
    const favorite=url.searchParams.get('favorite'),status=url.searchParams.get('status'),due=url.searchParams.get('due'),today=now();
    const cards=db.knowledgeCards.filter(card=>canAccessPersonalRecord(card)&&(favorite===null||Boolean(card.favorite)===(favorite==='true'))&&(!status||card.masteryStatus===status)&&(!due||due!=='today'||(card.masteryStatus!=='mastered'&&Boolean(card.reviewSchedule?.dueAt)&&card.reviewSchedule.dueAt<=today)));
    return send(res,200,cards);
  }
  const cardMatch=url.pathname.match(/^\/v1\/knowledge-cards\/([^/]+)$/);
  if(req.method==='PATCH'&&cardMatch){
    const card=db.knowledgeCards.find(item=>item.id===cardMatch[1]&&canAccessPersonalRecord(item));if(!card)return send(res,404,{error:'KNOWLEDGE_CARD_NOT_FOUND'});
    for(const [key,maxLength] of [['title',120],['subject',40],['knowledgePoint',120],['insight',8000],['content',8000],['ai_explanation',8000],['frontContent',8000],['backContent',8000]]){
      if(Object.prototype.hasOwnProperty.call(input,key)
        &&(typeof input[key]!=='string'||(['title','subject'].includes(key)&&input[key].trim().length===0)||input[key].length>maxLength))
        return send(res,422,{error:'INVALID_KNOWLEDGE_CARD_FIELD',field:key,maxLength});
    }
    if(typeof input.favorite==='boolean')card.favorite=input.favorite;
    if(['learning','mastered'].includes(input.masteryStatus)){card.masteryStatus=input.masteryStatus;if(input.masteryStatus==='mastered')card.reviewSchedule={...(card.reviewSchedule||{}),dueAt:null};else card.reviewSchedule={...(card.reviewSchedule||{}),dueAt:now(),intervalDays:0,streak:0}}
    for(const [key,maxLength] of [['title',120],['subject',40],['knowledgePoint',120],['insight',8000]]){
      if(Object.prototype.hasOwnProperty.call(input,key)){
        card[key]=input[key].trim();
      }
    }
    for(const key of ['content','ai_explanation'])if(Object.prototype.hasOwnProperty.call(input,key))card[key]=input[key].trim();
    if(Object.prototype.hasOwnProperty.call(input,'ai_explanation'))card.insight=input.ai_explanation.trim();
    for(const key of ['frontContent','backContent'])if(Object.prototype.hasOwnProperty.call(input,key))card[key]=input[key].trim();
    // 正面就是闯关题面：改了正面必须同步 challengePrompt，否则卡库显示的是新正面，
    // AI 判卷和复习队列还在用旧题面（与 2026-10-05「正面内容丢失」同类的脱钩问题）。
    if(Object.prototype.hasOwnProperty.call(input,'frontContent')){
      const nextFront=String(input.frontContent||'').trim();
      card.frontContent=nextFront;
      card.challengePrompt=nextFront||String(card.title||card.knowledgePoint||'').trim();
    }
    if(Object.prototype.hasOwnProperty.call(input,'backContent'))card.insight=input.backContent.trim();
    if(Object.prototype.hasOwnProperty.call(input,'knowledgePoint'))card.microSkill=card.knowledgePoint;
    card.updatedAt=now();await persist();return send(res,200,card);
  }
  if(req.method==='DELETE'&&cardMatch){
    const ownedCard=db.knowledgeCards.find(item=>item.id===cardMatch[1]&&canAccessPersonalRecord(item));if(!ownedCard)return send(res,404,{error:'KNOWLEDGE_CARD_NOT_FOUND'});const before=db.knowledgeCards.length;db.knowledgeCards=db.knowledgeCards.filter(item=>item.id!==cardMatch[1]);if(before===db.knowledgeCards.length)return send(res,404,{error:'KNOWLEDGE_CARD_NOT_FOUND'});
    db.knowledgeCardReviews=db.knowledgeCardReviews.filter(item=>item.cardId!==cardMatch[1]);await persist();return send(res,200,{deleted:true,id:cardMatch[1]});
  }
  const cardReviewMatch=url.pathname.match(/^\/v1\/knowledge-cards\/([^/]+)\/reviews$/);
  if(req.method==='POST'&&cardReviewMatch){
    const studentAnswer=String(input.studentAnswer||'').trim();if(!studentAnswer)return send(res,422,{error:'STUDENT_ANSWER_REQUIRED'});
    const attemptId=String(input.attemptId||'').trim().slice(0,100)||randomUUID(),reviewKey=cardReviewMatch[1]+':'+attemptId;
    const execute=async()=>{
      const cardIndex=db.knowledgeCards.findIndex(item=>item.id===cardReviewMatch[1]&&canAccessPersonalRecord(item));if(cardIndex<0)return {status:404,body:{error:'KNOWLEDGE_CARD_NOT_FOUND'}};
      const previous=db.knowledgeCardReviews.find(item=>item.cardId===cardReviewMatch[1]&&item.attemptId===attemptId);
      if(previous)return {status:200,body:{card:db.knowledgeCards[cardIndex],review:previous,replayed:true}};
      try{const evaluation=await knowledgeCardReviewAdapter({card:db.knowledgeCards[cardIndex],studentAnswer}),result=knowledgeCardEngine.review({card:db.knowledgeCards[cardIndex],studentAnswer,...evaluation});result.review.attemptId=attemptId;if(['again','unsure','know'].includes(input.selfRating))result.review.selfRating=input.selfRating;db.knowledgeCards[cardIndex]=result.card;db.knowledgeCardReviews.unshift(result.review);await persist();return {status:201,body:result}}catch(error){return {status:503,body:{error:String(error.message||error),answerPreserved:true}}}
    };
    let execution=cardReviewInFlight.get(reviewKey);
    if(!execution){execution=cardReviewQueue.then(execute,execute);cardReviewQueue=execution.then(()=>undefined,()=>undefined);cardReviewInFlight.set(reviewKey,execution)}
    try{const outcome=await execution;return send(res,outcome.status,outcome.body)}finally{if(cardReviewInFlight.get(reviewKey)===execution)cardReviewInFlight.delete(reviewKey)}
  }
  if(req.method==='POST'&&url.pathname==='/v1/note-sources'){
    const content=String(input.content||''),sourceType=String(input.sourceType||'paste');
    if(!['paste','txt','md'].includes(sourceType))return send(res,415,{error:'NOTE_SOURCE_TYPE_UNSUPPORTED'});
    if(!content.trim())return send(res,422,{error:'NOTE_CONTENT_REQUIRED'});
    if(Buffer.byteLength(content,'utf8')>512*1024)return send(res,413,{error:'NOTE_CONTENT_TOO_LARGE'});
    const note={id:randomUUID(),studentId:input.studentId||'local-student',title:String(input.title||'未命名笔记').slice(0,160),subject:String(input.subject||'未分类').slice(0,40),knowledgePoint:String(input.knowledgePoint||'').slice(0,120),sourceType,content,contentHash:createHash('sha256').update(content).digest('hex'),createdAt:now()};db.noteSources.unshift(note);await persist();return send(res,201,{...note,content:undefined});
  }
  const noteCardsMatch=url.pathname.match(/^\/v1\/note-sources\/([^/]+)\/knowledge-cards$/);
  if(req.method==='POST'&&noteCardsMatch){
    const note=db.noteSources.find(item=>item.id===noteCardsMatch[1]&&canAccessPersonalRecord(item));if(!note)return send(res,404,{error:'NOTE_SOURCE_NOT_FOUND'});
    const job=await generateKnowledgeCards(`note:${note.id}`,noteCardSource(note));return send(res,job.status==='completed'?200:503,{job,cards:db.knowledgeCards.filter(card=>card.sourceCaseIds?.includes(`note:${note.id}`))});
  }
  if (req.method === 'POST' && url.pathname === '/v1/review-attempts') {
    const review = {id: randomUUID(), ...input, createdAt: now()};
    db.reviews.unshift(review);
    await persist();
    return send(res, 201, review);
  }
  if (req.method === 'GET' && url.pathname === '/v1/geometry-regression/metrics') {
    return send(res, 200, runPolyhedronRegression());
  }
  if (req.method === 'POST' && url.pathname === '/v1/geometry-exam-coverage/audit') {
    return send(res, 200, auditExamCoverage(input,{trustedDatasetHashes:TRUSTED_EXAM_DATASET_HASHES}));
  }
  if (req.method === 'GET' && url.pathname === '/v1/grade10-example-problems') {
    return send(res, 200, grade10ExampleCatalog());
  }
  const grade10ExampleStartMatch = url.pathname.match(/^\/v1\/grade10-example-problems\/([^/]+)\/start$/);
  if (req.method === 'POST' && grade10ExampleStartMatch) {
    const exampleId = decodeURIComponent(grade10ExampleStartMatch[1]);
    const existingIndex = db.cases.findIndex(item => item.origin === 'configured_example_upload' && item.configuredExampleId === exampleId);
    if (existingIndex >= 0) {
      const existing=db.cases[existingIndex],fresh=createGrade10ExampleCase(exampleId,{id:existing.id,createdAt:existing.createdAt});
      db.cases[existingIndex]={...existing,...fresh,studentAnswer:existing.studentAnswer||fresh.studentAnswer,learningProfile:existing.learningProfile||fresh.learningProfile};
      await persist();
      return send(res, 200, db.cases[existingIndex]);
    }
    const createdAt = now();
    const mistakeCase = createGrade10ExampleCase(exampleId, {id: randomUUID(), createdAt});
    if (!mistakeCase) return send(res, 404, {error:'GRADE10_EXAMPLE_NOT_FOUND'});
    db.cases.unshift(mistakeCase);
    db.events.push({id:randomUUID(),type:'configured_example_uploaded',caseId:mistakeCase.id,payload:{exampleId},createdAt});
    await persist();
    return send(res, 201, mistakeCase);
  }
  if (req.method === 'POST' && url.pathname === '/v1/grade10-example-problems/import-all') {
    const cases = [];
    for (const example of grade10ExampleCatalog()) {
      const existingIndex=db.cases.findIndex(item => item.origin === 'configured_example_upload' && item.configuredExampleId === example.id);
      let mistakeCase;
      if (existingIndex < 0) {
        const createdAt = now();
        mistakeCase = createGrade10ExampleCase(example.id, {id:randomUUID(),createdAt});
        db.cases.unshift(mistakeCase);
        db.events.push({id:randomUUID(),type:'configured_example_uploaded',caseId:mistakeCase.id,payload:{exampleId:example.id},createdAt});
      } else {
        const existing=db.cases[existingIndex],fresh=createGrade10ExampleCase(example.id,{id:existing.id,createdAt:existing.createdAt});
        mistakeCase={...existing,...fresh,studentAnswer:existing.studentAnswer||fresh.studentAnswer,learningProfile:existing.learningProfile||fresh.learningProfile};
        db.cases[existingIndex]=mistakeCase;
      }
      cases.push(mistakeCase);
    }
    await persist();
    return send(res, 200, {cases});
  }
  if (req.method === 'GET' && url.pathname === '/v1/public-problem-templates') {
    return send(res, 200, publicTemplates());
  }
  if (req.method === 'POST' && url.pathname === '/v1/public-problem-templates/match') {
    const candidate = {
      question: String(input.question || input.questionText || ''), subject: input.subject,
      unit: input.unit, knowledgePoints: Array.isArray(input.knowledgePoints) ? input.knowledgePoints : [],
      microSkills: Array.isArray(input.microSkills) ? input.microSkills : [], questionType: input.questionType,
      problemSpec: input.problemIR || input.problemSpec, geometryResult: input.geometryResult
    };
    if (!candidate.question.trim()) return send(res, 422, {error: 'QUESTION_REQUIRED'});
    return send(res, 200, {matches: findPublicProblemMatches(candidate)});
  }
  const publicTemplateChoiceMatch = url.pathname.match(/^\/v1\/mistake-cases\/([^/]+)\/public-template-choice$/);
  if (req.method === 'POST' && publicTemplateChoiceMatch) {
    const mistakeCase = db.cases.find(item => item.id === publicTemplateChoiceMatch[1]);
    if (!mistakeCase) return send(res, 404, {error: 'MISTAKE_CASE_NOT_FOUND'});
    const choice = String(input.choice || '');
    const templateId = String(input.templateId || '');
    if (!['use_model', 'method_only', 'different'].includes(choice)) return send(res, 422, {error: 'INVALID_PUBLIC_TEMPLATE_CHOICE'});
    const matches = findPublicProblemMatches(mistakeCase);
    const match = matches.find(item => item.template.id === templateId);
    if (!match) return send(res, 422, {error: 'PUBLIC_TEMPLATE_NOT_MATCHED', message: '该公共题型与本题不够相近，不能建立引用。'});
    const revalidation = choice === 'use_model' ? validatePublicTemplateUse(templateId, mistakeCase) : {ok: true, message: choice === 'method_only' ? '将只展示公共方法，不载入公共模型。' : '已记录：这是不同题型，不再自动推荐此模板。'};
    const record = {
      id: randomUUID(), caseId: mistakeCase.id, templateId, choice, status: revalidation.ok ? 'accepted' : 'rejected',
      message: revalidation.message, createdAt: now()
    };
    db.publicTemplateChoices.unshift(record);
    mistakeCase.publicTemplateReference = {
      templateId, choice, status: record.status, selectedAt: record.createdAt,
      ...(choice === 'use_model' && revalidation.ok ? {revalidatedScene: true, preview: revalidation.template.preview} : {})
    };
    db.events.push({id: randomUUID(), type: 'public_template_choice', caseId: mistakeCase.id, payload: record, createdAt: now()});
    await persist();
    return send(res, revalidation.ok ? 200 : 409, {choice: record, revalidation, mistakeCase});
  }
  if (req.method === 'GET' && url.pathname === '/v1/mistake-cases/deleted-ids') {
    return send(res, 200, {ids: db.deletedCaseIds.filter(id => !AUTH_REQUIRED
      || db.deletedCaseOwners[id] === authResolution?.user.id)});
  }
  if (req.method === 'POST' && url.pathname === '/v1/mistake-cases/sync') {
    const incoming = Array.isArray(input.cases) ? input.cases.slice(0, 80) : [];
    const importedIds = [], existingIds = [], rejected = [];
    for (const candidate of incoming) {
      const caseId = String(candidate?.id || '');
      const question = String(candidate?.question || '').trim();
      if (db.deletedCaseIds.includes(caseId)) {
        rejected.push({id: caseId, reason: 'deleted_on_server'});
        continue;
      }
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(caseId) || !question || question.length > 40000
        || JSON.stringify(candidate).length > 1_000_000
        || candidate.origin === 'configured_example_upload' || candidate.origin === 'demo_seed'
        || candidate.modelVersion === 'local-geometry-demo'
        || candidate.source === 'random' || candidate.randomization
        || /示例错题/.test(question)) {
        rejected.push({id: caseId || null, reason: 'invalid_or_demo_record'});
        continue;
      }
      const existingIndex = db.cases.findIndex(item => item.id === caseId);
      if (existingIndex >= 0) {
        if (!canAccessPersonalRecord(db.cases[existingIndex])) {
          rejected.push({id: caseId, reason: 'record_belongs_to_another_account'});
          continue;
        }
        // Sync is a recovery/import path only. Existing server truth (especially
        // verified geometry and learning history) must never be overwritten by
        // a stale browser snapshot.
        existingIds.push(caseId);
        continue;
      }
      const imported = {...candidate, id: caseId,
        studentId: authResolution?.user.id || 'local-student',
        user_id: authResolution?.user.id || 'local-student',
        createdAt: Number.isFinite(Date.parse(candidate.createdAt)) ? candidate.createdAt : now(),
        updatedAt: now()};
      // Uploaded images are stored separately by the intake route; never accept
      // accidental data URLs as part of a browser-state recovery payload.
      for (const key of ['imageData', 'rawImage', 'imageBase64', 'dataUrl']) delete imported[key];
      db.cases.unshift(imported);
      importedIds.push(caseId);
    }
    if (importedIds.length) {
      db.events.push({id: randomUUID(), type: 'local_mistake_records_recovered',
        payload: {count: importedIds.length, caseIds: importedIds}, createdAt: now()});
      await persist();
    }
    return send(res, 200, {importedIds, existingIds, rejected});
  }
  if (req.method === 'GET' && url.pathname === '/v1/mistake-cases') {
    let migratedTriangularCases = false;
    for (let index = 0; index < db.cases.length; index += 1) {
      const legacy = db.cases[index];
      const repaired = await repairLegacyGeometryCase(legacy);
      if (repaired) {
        db.cases[index] = {...legacy, problemSpec: repaired.problemSpec, geometryResult: repaired.result || repaired.geometryResult,
          verificationStatus: repaired.verificationStatus, modelStatus: repaired.modelStatus, modelMessage: repaired.modelMessage,
          modelProvenance: repaired.modelProvenance, visualization: repaired.visualization, updatedAt: repaired.updatedAt};
        migratedTriangularCases = true;
        continue;
      }
      const gridAligned = await refreshLegacyPyramidGridFrame(legacy);
      if (gridAligned) {
        db.cases[index] = gridAligned;
        migratedTriangularCases = true;
        continue;
      }
      const dimensionAligned = refreshPolyhedronDimensions(legacy);
      if (dimensionAligned) {
        db.cases[index] = dimensionAligned;
        migratedTriangularCases = true;
        continue;
      }
      const pedagogical = attachLegacyPedagogy(legacy);
      if (pedagogical) {
        db.cases[index] = pedagogical;
        migratedTriangularCases = true;
        continue;
      }
      const hasRetiredSubproblemScene = Boolean(legacy.geometryResult?.scene?.subproblemViews)
        || (legacy.geometryResult?.scene?.elements || []).some(element => element.role === 'subproblem-auxiliary');
      if (legacy.origin !== 'triangular_pyramid_deterministic'
        || (Array.isArray(legacy.problemSpec?.subproblems) && !hasRetiredSubproblemScene)) continue;
      const ir = parseProjectionDihedralTriangularPyramid(legacy.question);
      if (!ir) continue;
      const solved = await solveGeometryIRV3(adaptGeometryIRV3(ir));
      if (solved.status !== 'verified') continue;
      db.cases[index] = {...legacy, problemSpec: solved.problemIR, geometryResult: solved.result,
        visualization: {...legacy.visualization, renderer:'three', interactive:true, scene:solved.result.scene}};
      migratedTriangularCases = true;
    }
    if (migratedTriangularCases) await persist();
    const cases = db.cases.filter(canAccessPersonalRecord).map(mistakeCase => {
      const normalizedCase = {
        ...mistakeCase,
        subject: mistakeCase.subject === '数学·几何' ? '数学' : mistakeCase.subject,
        unit: ['数学', '数学·几何'].includes(mistakeCase.subject) && /立体|空间|棱锥|线面角|法向量/.test([mistakeCase.unit, mistakeCase.question, ...(mistakeCase.knowledgePoints || [])].join(' ')) ? '空间几何' : mistakeCase.unit
      };
      const sessions = db.tutorSessions
        .filter(session => session.caseId === mistakeCase.id)
        .sort((a, b) => String(b.learningState?.updatedAt || b.createdAt || '').localeCompare(String(a.learningState?.updatedAt || a.createdAt || '')));
      const latest = sessions.find(session => session.learningState?.completionReview) || sessions[0];
      return {
        ...normalizedCase,
        publicTemplateMatches: findPublicProblemMatches(normalizedCase),
        ...(latest?.learningState ? {
          tutorLearningState: latest.learningState,
          completionReview: latest.learningState.completionReview || null
        } : {})
      };
    });
    return send(res, 200, cases);
  }
  if (req.method === 'POST' && url.pathname === '/v1/transfer-items') {
    const caseId = String(input.id || `transfer-${randomUUID()}`);
    const existing = db.cases.find(entry => entry.id === caseId);
    const attemptId = String(input.attemptId || randomUUID());
    const createdAt = now();
    const previousAttempts = Array.isArray(existing?.trainingAttempts) ? existing.trainingAttempts : [];
    const attempt = {
      ...(previousAttempts.find(entry => entry.id === attemptId) || {}),
      id: attemptId,
      caseId,
      answer: String(input.studentAnswer || ''),
      correctness: input.correctness || 'pending',
      hintCount: Math.max(0, Number(input.hintCount || 0)),
      createdAt: previousAttempts.find(entry => entry.id === attemptId)?.createdAt || createdAt,
      updatedAt: createdAt
    };
    const trainingAttempts = [...previousAttempts.filter(entry => entry.id !== attemptId), attempt];
    let geometryResult = existing?.geometryResult || null;
    if (!geometryResult && /几何|棱锥|直线|平面|向量/.test([input.unit, input.question, ...(input.knowledgePoints || [])].join(' '))) {
      const parsed = parseDeterministicGeometryText(String(input.question || ''), String(input.studentAnswer || ''));
      if (parsed) {
        try {
          geometryResult = await solveConfirmedGeometry(makeDeterministicRequest({
            ...parsed,
            caseId,
            revision: 1,
            internalReview: {status: 'passed'}
          }));
        } catch {
          geometryResult = null;
        }
      }
      if (!geometryResult) geometryResult = buildVectorTransferGeometry(input.question);
    }
    const totalAttempts = trainingAttempts.filter(entry => entry.correctness !== 'pending').length;
    const independentCompletions = trainingAttempts.filter(entry => entry.correctness === 'correct' && entry.hintCount === 0).length;
    const hintCount = trainingAttempts.reduce((sum, entry) => sum + Number(entry.hintCount || 0), 0);
    const mastery = Math.min(100, Math.max(15, 25 + independentCompletions * 22 + Math.max(0, totalAttempts - hintCount) * 6));
    const mistakeCase = {
      ...existing,
      id: caseId,
      origin: 'transfer_training',
      parentCaseId: input.parentCaseId || existing?.parentCaseId || null,
      transferLevel: input.transferLevel || existing?.transferLevel || null,
      subject: (input.subject || existing?.subject) === '数学·几何' ? '数学' : (input.subject || existing?.subject || '数学'),
      unit: (['数学', '数学·几何'].includes(input.subject || existing?.subject || '数学') && /立体|空间|棱锥|线面角|法向量|^几何$/.test([input.unit, input.question, ...(input.knowledgePoints || [])].join(' '))) ? '空间几何' : (input.unit || existing?.unit || '待归纳'),
      question: String(input.question || existing?.question || ''),
      studentAnswer: String(input.studentAnswer || existing?.studentAnswer || ''),
      knowledgePoints: Array.isArray(input.knowledgePoints) ? input.knowledgePoints : (existing?.knowledgePoints || []),
      microSkills: Array.isArray(input.microSkills) ? input.microSkills : (existing?.microSkills || []),
      errorCauses: Array.isArray(input.errorCauses) ? input.errorCauses : (existing?.errorCauses || []),
      questionType: input.questionType || existing?.questionType || '三阶迁移题',
      verificationStatus: geometryResult?.solverStatus === 'verified' ? 'verified' : 'attempted',
      trainingAttempts,
      trainingMetrics: {
        totalAttempts,
        independentCompletions,
        hintCount,
        mastery,
        status: mastery >= 80 ? '基本掌握' : mastery >= 50 ? '部分掌握' : '需要大量提示'
      },
      ...(geometryResult?.solverStatus === 'verified' ? {
        geometryResult,
        correctAnswer: geometryResult.answer?.displayPlain || '',
        correctAnswerLatex: geometryResult.answer?.latex || '',
        visualization: {renderer: 'three', interactive: true, scene: geometryResult.scene}
      } : {}),
      createdAt: existing?.createdAt || createdAt,
      updatedAt: createdAt
    };
    db.cases = [mistakeCase, ...db.cases.filter(entry => entry.id !== caseId)];
    db.events.push({id: randomUUID(), type: existing ? 'transfer_attempt_updated' : 'transfer_mistake_created', caseId, payload: {attempt, trainingMetrics: mistakeCase.trainingMetrics}, createdAt});
    await persist();
    return send(res, existing ? 200 : 201, {mistakeCase, attempt});
  }
  if (req.method === 'GET' && url.pathname === '/v1/learner-profile') return send(res, 200, db.profile);
  if (req.method === 'POST' && url.pathname === '/v1/learner-profile') {
    db.profile = {...db.profile, ...input, updatedAt: now()};
    await persist();
    return send(res, 200, db.profile);
  }
  if (req.method === 'GET' && url.pathname === '/v1/study-plan') return send(res, 200, db.plans[0] || null);
  if (req.method === 'POST' && url.pathname === '/v1/study-plan') {
    const plan = {id: randomUUID(), ...input, updatedAt: now()};
    db.plans.unshift(plan);
    await persist();
    return send(res, 201, plan);
  }
  if (req.method === 'POST' && url.pathname === '/v1/ima/sync') {
    const sync = {id: randomUUID(), status: 'queued', ...input, createdAt: now()};
    db.imaSync.unshift(sync);
    await persist();
    return send(res, 202, sync);
  }
  const modelCacheMatch = url.pathname.match(/^\/v1\/model-cache\/([a-f0-9]{64})$/);
  if (req.method === 'GET' && modelCacheMatch) {
    const entry = db.modelCache.find(item => item.hash === modelCacheMatch[1]);
    const resourceUser=(authResolution || identity.resolve(sessionBearer))?.user;
    const resourceOwner=resourceUser?.id || (!AUTH_REQUIRED ? 'local-student' : '');
    const canRead = Boolean(entry?.model_url) && db.cases.some(item => (item.user_id || item.studentId) === resourceOwner && (item.modelUrl === entry.model_url || item.geometryResult?.modelUrl === entry.model_url));
    if (!canRead) return send(res,404,{error:'MODEL_CACHE_NOT_FOUND'});
    return entry?.scene
      ? send(res, 200, {hash:entry.hash, subject:entry.subject, model:entry.scene, reuse_count:entry.reuse_count, generated_at:entry.generated_at})
      : send(res, 404, {error:'MODEL_CACHE_NOT_FOUND'});
  }
  /* 归纳页 / 复习队列 / 我的理解：独立路由模块，只在 /v1/study 前缀下接管请求。
     放在 404 兜底之前；不触碰上面任何既有路由，也不修改它们的逻辑。 */
  if (url.pathname.startsWith('/v1/study')) {
    const handleStudy = createStudyRouter({db, persist, canAccess: canAccessPersonalRecord,
      requestBody:input,currentUserId:authResolution?.user.id || 'local-student',
      /* 点知识网络连线时的 AI 衔接提示卡；没配密钥时路由器会回本地兜底卡片。 */
      relationTipAdapter:createDeepSeekRelationTipAdapter(modelConfig)});
    if (await handleStudy(req, res, url)) return;
  }
  /* 错题编辑 / 删除：只在 /v1/mistake-cases/:id（无子路径）上接管 PATCH 与 DELETE。
     带 /confirm、/public-template-choice 等子路径的请求仍由上面的既有路由处理。 */
  if (url.pathname.startsWith('/v1/mistake-cases/')) {
    // The optional local-mode gate leaves authResolution null; plane models still
    // belong to the signed-in student, never to a token supplied in the body.
    const isPlaneModel = /^\/v1\/mistake-cases\/[^/]+\/plane-model$/.test(url.pathname);
    const planeIdentity = isPlaneModel ? (authResolution || (sessionBearer ? identity.resolve(sessionBearer) : null)) : null;
    if (isPlaneModel && sessionBearer && !planeIdentity) return send(res,401,{error:'AUTHENTICATION_REQUIRED'});
    const handleMistakeAdmin = createMistakeAdminRouter({db, persist, canAccess: canAccessPersonalRecord,
      requestBody: input, currentUserId: (isPlaneModel ? planeIdentity : authResolution)?.user.id || 'local-student',
      /* 自动建模与错题库手动重建共用同一管线，避免规则漂移。 */
      rebuildModel: rebuildGeometryForCase,
      /* 得分点反推同理：错题库里的「重新反推」走同一条管线。 */
      rebuildSteps: record=>aiRubricBuilder.build(record,{force:true})});
    if (await handleMistakeAdmin(req, res, url)) return;
  }
  return send(res, 404, {error: 'not_found', path: url.pathname});
}

if (!['127.0.0.1', '::1', 'localhost'].includes(HOST) && !API_TOKEN && !AUTH_REQUIRED) {
  throw new Error('AUTH_OR_API_TOKEN_REQUIRED_FOR_NON_LOOPBACK_HOST');
}
if (!['127.0.0.1', '::1', 'localhost'].includes(HOST) && AUTH_REQUIRED && CORS_ORIGIN === '*') {
  throw new Error('EXPLICIT_CORS_ORIGIN_REQUIRED_FOR_SCHOOL_MODE');
}

for(const ingestion of db.ingestions.filter(entry=>entry.geometryRetry?.status==='queued'||entry.geometryRetry?.status==='running')){
  ingestion.geometryRetry.status='queued';
  scheduleTrustedGeometryRetry(ingestion.id);
}
for(const record of db.cases.filter(item=>item.geometryModelRequested===true
  && ['queued','building'].includes(item.geometryBuildStatus) && !item.geometryResult?.scene)) {
  setTimeout(()=>void runConfirmedGeometryBuild(record),0);
}

/* ------------------------------------------------------------------
   启动监听：端口被占用时自动顺延，不要一撞上 4180 就整体失败
   ------------------------------------------------------------------
   演示机（老师的笔记本）上 4180 很可能被别的东西占着。
   旧实现直接 listen(PORT) —— EADDRINUSE 抛错、进程退出、浏览器白屏，
   台上很难当场排查。这里改成依次尝试 PORT、PORT+1、PORT+2 …
   绑定成功后再把实际端口打印出来（并按需自动打开浏览器）。
   ------------------------------------------------------------------ */
const PORT_PROBE_LIMIT = Math.max(1, Math.min(50, Number(process.env.PORT_PROBE_LIMIT || 10)));
const AUTO_OPEN_BROWSER = process.env.AUTO_OPEN_BROWSER === '1';

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(command[0], command[1], {detached: true, stdio: 'ignore'});
    child.on('error', () => {});
    child.unref();
  } catch (error) { /* 打不开浏览器不影响服务 */ }
}

function listenWithFallback(server, startPort, host, attempt = 0) {
  if (attempt >= PORT_PROBE_LIMIT) {
    console.error(`[启动失败] ${host}:${startPort} 起的 ${PORT_PROBE_LIMIT} 个端口都被占用，无法启动服务。`);
    process.exit(1);
  }
  const port = startPort + attempt;
  const onError = error => {
    server.removeListener('listening', onListening);
    if (error && error.code === 'EADDRINUSE') {
      console.warn(`[端口占用] ${host}:${port} 已被占用，尝试 ${port + 1} …`);
      listenWithFallback(server, startPort, host, attempt + 1);
      return;
    }
    console.error('[启动失败]', error && error.message || error);
    process.exit(1);
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/index.html`;
    console.log(`EduCompanion loop server listening on http://${host}:${port}`);
    console.log(`演示地址：${url}`);
    if (port !== startPort) console.log(`（端口 ${startPort} 被占用，已自动改用 ${port}）`);
    if (AUTO_OPEN_BROWSER) openBrowser(url);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, host);
}

const httpServer = http.createServer((req, res) => route(req, res).catch(error => send(res, error.statusCode || 500, {error: error.message || 'server_error'})));
listenWithFallback(httpServer, PORT, HOST);
