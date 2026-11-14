/*
 * 本题得分点的后台反推任务。
 *
 * 为什么单独一个模块：错题确认入库（server.mjs）和错题库里的「重新反推得分点」
 * （mistake-admin-routes.mjs）要走同一条管线，避免规则漂移；状态写在题目记录上，
 * 前端轮询 mistakeCase.aiStepsStatus 就知道有没有好。
 *
 * 状态机：
 *   queued / building  正在反推
 *   ready              反推完成，aiRubric 可用（陪练优先用它）
 *   failed             失败，aiStepsMessage 写明原因，可重试
 *   skipped            不在范围内（当前只覆盖数学 / 物理）
 */
import {createDeepSeekAiRubricAdapter, supportsAiRubric} from './ai-rubric.mjs';
import {strictQuestionFingerprint} from './shared-content-fingerprint.mjs';
import visualContract from '../../implementation/step-visual-contract.js';
import {planeEntityCatalog,createPlaneVisualBinding,planeStepVisuals,matchesPlaneGeometry} from './plane-geometry.mjs';

const MESSAGES = {
  skipped: '这道题不在 AI 反推得分点的范围内（当前只覆盖数学与物理）。',
  notConfigured: '学习服务没有配置大模型密钥，因此没有反推本题得分点；陪练会使用通用兜底步骤。',
  building: '正在按这道题反推得分点…',
};

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {Function} deps.persist
 * @param {object} deps.modelConfig  服务端模型配置（endpoint / apiKey / model）
 * @param {Function} [deps.clock]
 * @param {Function} [deps.createAdapter] 便于测试注入
 * @param {Function} [deps.recordEvent]   写 db.events
 */
export function createAiRubricBuilder({
  db, persist, modelConfig = {}, clock = () => new Date(),
  createAdapter = createDeepSeekAiRubricAdapter, recordEvent = null,
} = {}) {
  if (!db) throw new Error('createAiRubricBuilder 需要 db');
  const active = new Map();
  const caseOf = id => (db.cases || []).find(item => item.id === id);

  function stamp(target, status, message) {
    if (!target) return;
    target.aiStepsStatus = status;
    target.aiStepsMessage = message || '';
    target.aiStepsUpdatedAt = clock().toISOString();
    if (status === 'ready') target.updatedAt = target.aiStepsUpdatedAt;
  }

  async function run(record, {force = false} = {}) {
    if (!record || !record.id) return {ok: false, status: 'ai_rubric_no_record'};
    const current = caseOf(record.id) || record;
    if(!force && current.aiRubric?.steps?.length){
      if(current.aiRubric.fingerprint && current.aiRubric.fingerprint!==strictQuestionFingerprint(current.question,current.subject)){
        stamp(current,'not_requested','题干已变化，旧得分点不可复用；需要时请主动重新生成。');current.aiRubric=null;await persist();return {ok:false,status:'stale_question'};
      }
      // A read/reuse must not replace a plane binding with a 3D binding or bless
      // legacy hints against new parameters. The GET projection handles staleness.
      if(current.aiRubric.planeVisualBinding||planeEntityCatalog(current).length){
        if(current.aiStepsStatus!=='ready'){stamp(current,'ready','');await persist();}
        return {ok:true,status:'ready',reused:true,rubric:current.aiRubric};
      }
      const stale=current.aiRubric.visualBinding&&!visualContract.bindingMatches(current.aiRubric.visualBinding,current);
      const source=stale?{...current.aiRubric,steps:current.aiRubric.steps.map(s=>({...s,visual:{mode:'text_only',hint:s.hint,reason:'模型已变化，旧图形提示已停用。'}})),parts:(current.aiRubric.parts||[]).map(p=>({...p,visual:{mode:'text_only',hint:p.hint,reason:'模型已变化，旧图形提示已停用。'}}))}:current.aiRubric;
      const bound=visualContract.bindRubric(source,current);
      if(JSON.stringify(bound)!==JSON.stringify(current.aiRubric)||current.aiStepsStatus!=='ready'){current.aiRubric=bound;stamp(current,'ready','');await persist();}
      return {ok:true,status:'ready',reused:true,rubric:current.aiRubric};
    }

    if (!supportsAiRubric(current.subject)) {
      stamp(current, 'skipped', MESSAGES.skipped);
      await persist();
      return {ok: false, status: 'skipped'};
    }

    const adapter = createAdapter(modelConfig);
    if (!adapter) {
      stamp(current, 'failed', MESSAGES.notConfigured);
      await persist();
      return {ok: false, status: 'ai_rubric_not_configured'};
    }

    stamp(current, 'building', MESSAGES.building);
    await persist();

    const fingerprint = strictQuestionFingerprint(current.question, current.subject);
    const visualBinding = visualContract.bindingFor(current);
    const planeCatalog = planeEntityCatalog(current);
    const planeBinding = planeCatalog.length ? {...current.planeGeometry.binding} : null;
    const owner = current.user_id || current.studentId || 'local-student';
    try {
      const rubric = await adapter({
        question: current.question,
        subject: current.subject,
        knowledgePoints: current.knowledgePoints,
        answer: current.correctAnswer || current.aiSuggestedAnswer,
        entityCatalog: planeBinding ? planeCatalog : visualContract.catalogFor(current),
        ...(planeBinding?{modelDimension:'2d',modelParameters:structuredClone(current.planeGeometry.canonicalInput)}:{}),
      });
      rubric.scope = 'public_question';
      rubric.fingerprint = fingerprint;
      const target = caseOf(current.id) || current;
      if(planeBinding&&(target.user_id||target.studentId||'local-student')!==owner)return {ok:false,status:'stale_owner'};
      if (strictQuestionFingerprint(target.question, target.subject) !== fingerprint) {
        stamp(target, 'not_requested', '题干已修改，旧得分点未保存；需要时可重新生成。');
        await persist();
        return {ok: false, status: 'stale_question'};
      }
      const samePlane=planeBinding&&matchesPlaneGeometry(target.planeGeometry,target)
        &&Object.keys(planeBinding).every(key=>target.planeGeometry.binding[key]===planeBinding[key]);
      if(planeBinding?!samePlane:!visualContract.bindingMatches(visualBinding,target)){
        rubric.steps=(rubric.steps||[]).map(s=>({...s,visual:{mode:'text_only',hint:s.hint,reason:'生成期间模型发生变化，保留文字提示。'}}));
        rubric.parts=(rubric.parts||[]).map(p=>({...p,visual:{mode:'text_only',hint:p.hint,reason:'生成期间模型发生变化，保留文字提示。'}}));
      }
      if(planeBinding){
        // Never trust a model-produced binding, executable style or result label.
        delete rubric.planeVisualBinding;delete rubric.visualBinding;
        if(samePlane){
          rubric.planeVisualBinding=createPlaneVisualBinding({...target,aiRubric:rubric});
          const safe=planeStepVisuals({...target,aiRubric:rubric});
          rubric.steps=(rubric.steps||[]).map((step,i)=>({...step,visual:safe.steps[i]?.visual||{mode:'text_only',entityIds:[],reason:'UNKNOWN_STEP'}}));
          rubric.parts=(rubric.parts||[]).map((part,i)=>({...part,visual:safe.parts[i]?.visual||{mode:'text_only',entityIds:[],reason:'UNKNOWN_PART'}}));
          rubric.planeVisualBinding=createPlaneVisualBinding({...target,aiRubric:rubric});
        }
        target.aiRubric=rubric;
      }else target.aiRubric = visualContract.bindRubric(rubric,target);
      stamp(target, 'ready', '');
      if (recordEvent) recordEvent({type: 'mistake_case_ai_rubric_ready', caseId: current.id,
        payload: {steps: rubric.steps.length, source: rubric.source}});
      await persist();
      return {ok: true, status: 'ready', steps: rubric.steps.length, rubric};
    } catch (error) {
      const target = caseOf(current.id) || current;
      if(planeBinding&&(target.user_id||target.studentId||'local-student')!==owner)return {ok:false,status:'stale_owner'};
      const reason = String((error && error.message) || error).slice(0, 160);
      stamp(target, 'failed', `本题得分点反推未完成：${reason}。陪练先用通用兜底步骤，可稍后重试。`);
      if (recordEvent) recordEvent({type: 'mistake_case_ai_rubric_failed', caseId: current.id,
        payload: {status: String((error && error.code) || reason).slice(0, 80)}});
      await persist();
      return {ok: false, status: 'ai_rubric_failed', message: reason};
    }
  }

  /* 同一道题同时只跑一条；重复调用复用同一次结果。 */
  function build(record, options = {}) {
    if (!record || !record.id) return Promise.resolve({ok: false, status: 'ai_rubric_no_record'});
    const running = active.get(record.id);
    if (running) return running;
    const task = run(record,options).finally(() => active.delete(record.id));
    active.set(record.id, task);
    return task;
  }

  return {build, isRunning: id => active.has(id)};
}

export {MESSAGES as AI_RUBRIC_MESSAGES};
