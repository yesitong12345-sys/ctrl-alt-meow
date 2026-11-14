import {strictQuestionFingerprint} from './shared-content-fingerprint.mjs';
import {matchesPlaneGeometry, createPlaneVisualBinding, planeStepVisuals} from './plane-geometry.mjs';
const RENDER_VERSION = 'shared-three/v1';
const PLANE_RENDER_VERSION = 'shared-plane/v1';
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, structuredClone(value[k])]));
const SCENE_KEYS = ['schemaVersion', 'coordinateConvention', 'threeTransform', 'frameEdges', 'queryLine'];
const ELEMENT_KEYS = ['id', 'type', 'point', 'points', 'center', 'radius', 'normal', 'axis', 'height', 'direction', 'origin', 'label', 'color', 'opacity', 'style', 'role', 'value', 'kind', 'estimated'];
const publicVisual = visual => visual ? {...pick(visual,['mode','entityIds','hint','reason','focus','entities','highlight']), labels:(visual.labels||[]).map(x=>pick(x,['text','entity','value','fromAnswer']))} : null;
const publicStep = step => ({...pick(step,['id','label','hint','goal','understanding','explanation','keywords','nextQuestion','followUpQuestion','steps']),visual:publicVisual(step.visual)});

function sharedPlaneModel(record, {fingerprint, rubricConfirmed, rubric}) {
  if (!matchesPlaneGeometry(record?.planeGeometry, record)) return {planeModel: null, planeModelReason: '本题没有可复用的已校验二维模型'};
  if (!rubricConfirmed || !rubric?.steps?.length) {
    return {planeModel: null, planeModelReason: '二维模型尚未附带已确认的公共得分点'};
  }
  // The visual contract recomputes the binding and checks every entity id. A public
  // snapshot must not turn a stale/ambiguous visual into a reusable highlight.
  if (planeStepVisuals(record).status !== 'ready') return {planeModel: null, planeModelReason: '二维得分点绑定已失效，暂不复用'};
  // Do not copy the compiled scene or solution: the recipient recomputes it locally
  // from this explicit, verified input and answer labels remain behind the normal gate.
  return {planeModel: {fingerprint, renderVersion: PLANE_RENDER_VERSION, permission: 'published_resource',
    model: pick(record.planeGeometry, ['status', 'version', 'canonicalInput', 'binding'])}, planeModelReason: ''};
}

export function sharedModelResources(record, {modelVersion, rubricConfirmed = false}) {
  const fingerprint = strictQuestionFingerprint(record.question, record.subject), r = record.geometryResult;
  const checks = r?.verification?.checks || [];
  let model = null, modelReason = '本题没有通过校验的几何模型';
  const valid = ['verified_unique', 'verified_representative'].includes(record.verificationStatus || record.geometryCompilation?.status)
    && r?.solverStatus === 'verified' && r?.scene && checks.length && checks.every(x => x.pass === true);
  if (valid && record.geometryCompilation?.versionKey === modelVersion) {
    const geometry = pick(r, ['solverStatus', 'modelKind', 'canonicalCoordinates']);
    geometry.verification = {checks: checks.map(x => pick(x, ['id', 'pass', 'residual'])), mathVerification: r.verification.mathVerification || ''};
    geometry.scene = pick(r.scene, SCENE_KEYS);
    geometry.scene.grid = pick(r.scene.grid, ['unit','size','divisions','plane','valueSource']);
    geometry.scene.dimensions = (r.scene.dimensions || []).map(x => pick(x, ['id','points','label','value','kind','estimated','valueSource']));
    geometry.scene.elements = (r.scene.elements || []).map(x => pick(x, ELEMENT_KEYS));
    // No source documents, file URLs, original inputs, provider payloads or personal notes.
    model = {fingerprint, modelVersion, renderVersion: RENDER_VERSION, permission: 'published_resource', verificationStatus: record.verificationStatus || record.geometryCompilation.status, geometry};
    modelReason = '';
  } else if (valid) modelReason = '模型版本已变化，暂不复用旧模型';
  let rubric = null, rubricReason = '没有已确认的公共得分点';
  if (rubricConfirmed && record.aiRubric?.scope === 'public_question' && record.aiRubric.fingerprint === fingerprint) {
    const steps = (record.aiRubric.steps || []).slice(0, 12).filter(s => s.id && s.label).map(publicStep);
    if (steps.length) {rubric = {scope: 'public_question', fingerprint, source: 'shared_public', steps, parts: (record.aiRubric.parts || []).slice(0,12).map(publicStep),...(record.aiRubric.visualBinding?{visualBinding:structuredClone(record.aiRubric.visualBinding)}:{})}; rubricReason = '';}
  }
  const plane = sharedPlaneModel(record, {fingerprint, rubricConfirmed, rubric});
  if (plane.planeModel) {
    // The public rubric is deliberately smaller than the author's internal rubric.
    // Rebind only this public projection; keeping the author's hash would make the
    // imported copy look stale even though its visible score points are unchanged.
    rubric = structuredClone(rubric);
    rubric.planeVisualBinding = createPlaneVisualBinding({...record, aiRubric: rubric});
    if (!rubric.planeVisualBinding || planeStepVisuals({...record, aiRubric: rubric}).status !== 'ready') {
      plane.planeModel = null; plane.planeModelReason = '公开二维得分点无法完成实体绑定，暂不复用';
    }
  }
  return {fingerprint, model, modelReason, rubric, rubricReason, ...plane};
}
export function applySharedResources(copy, entry, modelVersion) {
  const resources = entry.resources || {}, model = resources.model, planeModel = resources.planeModel;
  const fingerprint = strictQuestionFingerprint(copy.question, copy.subject);
  const modelMatches = model && model.fingerprint === fingerprint && model.modelVersion === modelVersion && model.renderVersion === RENDER_VERSION && model.permission === 'published_resource';
  const planeMatches = planeModel && planeModel.fingerprint === fingerprint && planeModel.renderVersion === PLANE_RENDER_VERSION && planeModel.permission === 'published_resource'
    && matchesPlaneGeometry(planeModel.model, copy);
  Object.assign(copy, {geometryResult: modelMatches ? structuredClone(model.geometry) : null,
    visualization: modelMatches ? {renderer: 'three', interactive: true, scene: structuredClone(model.geometry.scene)} : {renderer: 'none'},
    geometryModelRequested: Boolean(modelMatches), geometryBuildStatus: modelMatches ? 'completed' : 'not_requested', modelStatus: modelMatches ? 'verified' : 'none',
    verificationStatus: modelMatches ? model.verificationStatus || 'verified_unique' : 'unverified',
    geometryCompilation: modelMatches ? {status: model.verificationStatus || 'verified_unique', versionKey: modelVersion, cacheHit: true, executionPath: 'shared_snapshot', inputHash: fingerprint} : null,
    sharedModelMessage: modelMatches ? '已复用校验模型；查看和步骤高亮不调用 AI。' : planeMatches ? '已复用校验二维模型；查看和步骤高亮不调用 AI。' : resources.modelReason || resources.planeModelReason || '本项未共享已校验模型，需要时可主动生成。',
    planeGeometry: planeMatches ? structuredClone(planeModel.model) : null});
  const rubric = resources.rubric;
  const publicRubric = rubric?.scope === 'public_question' && rubric.fingerprint === fingerprint ? structuredClone(rubric) : null;
  if (publicRubric && (!planeMatches || planeStepVisuals({...copy, aiRubric: publicRubric}).status === 'ready')) {
    copy.aiRubric = publicRubric; copy.aiStepsStatus = 'ready'; copy.aiStepsMessage = '';
  } else {copy.aiRubric = null; copy.aiStepsStatus = 'not_requested'; copy.aiStepsMessage = resources.rubricReason || '未共享公共得分点，需要时可主动生成。';}
  return copy;
}
