import {createHash} from 'node:crypto';
import core from '../../implementation/plane-geometry-core.js';
import {strictQuestionFingerprint} from './shared-content-fingerprint.mjs';

const parameterKey=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');

// Explicit parameters must be confirmed against the question by the caller.
// This is a math/binding module, NOT an authentication or sharing endpoint.
export function compilePlaneGeometry({question,subject='数学',input,confirmed=false}={}){
  if(subject!=='数学'||typeof question!=='string'||!question.trim())return {status:'invalid',reason:'MATH_QUESTION_REQUIRED'};
  if(confirmed!==true)return {status:'needs_confirmation',reason:'CONFIRM_EXPLICIT_PARAMETERS'};
  const result=core.compile(input);
  if(result.status!=='verified')return result;
  return {...result,binding:{version:core.VERSION,question:strictQuestionFingerprint(question,subject),parameters:parameterKey(result.canonicalInput)}};
}

export function matchesPlaneGeometry(model,{question,subject='数学',input}={}){
  if(model?.status!=='verified'||model.version!==core.VERSION||model.binding?.version!==core.VERSION||subject!=='数学'||typeof question!=='string'||!question.trim())return false;
  const stored=core.compile(model.canonicalInput),requested=core.compile(input??model.canonicalInput);
  return stored.status==='verified'&&requested.status==='verified'
    &&model.binding.question===strictQuestionFingerprint(question,subject)
    // Validate the stored parameters, but hash their original canonical bytes.
    // Re-normalizing a unit vector can change its last floating-point bit.
    &&model.binding.parameters===parameterKey(model.canonicalInput)
    &&model.binding.parameters===parameterKey(input===undefined?model.canonicalInput:requested.canonicalInput);
}

// Recompute a small catalog without exposing calculated coordinates or answers.
export function planeEntityCatalog(record){
  if(!record||!matchesPlaneGeometry(record.planeGeometry,record))return [];
  return core.compile(record.planeGeometry.canonicalInput).scene.elements.map(({id,type,role})=>({id,type,role}));
}

// Called only when the rubric is intentionally authored against this model.
// Read paths must never silently rebind an old rubric to a replacement model.
export function createPlaneVisualBinding(record){
  if(!record||!matchesPlaneGeometry(record.planeGeometry,record))return null;
  const r=record.aiRubric;
  if(!r||typeof r!=='object'||Array.isArray(r)||['steps','parts'].some(key=>
    r[key]!==undefined&&(!Array.isArray(r[key])||r[key].length>100||r[key].some(item=>!item||typeof item!=='object'||Array.isArray(item)))))return null;
  const {planeVisualBinding,...rubric}=record.aiRubric;
  try{return {contract:'plane-step-visual/v1',...record.planeGeometry.binding,rubric:parameterKey(rubric)};}catch{return null;}
}

export function planeStepVisuals(record){
  const binding=createPlaneVisualBinding(record),saved=record?.aiRubric?.planeVisualBinding;
  const valid=Boolean(binding&&saved)&&Object.keys(binding).every(key=>saved[key]===binding[key]);
  const catalog=valid?core.compile(record.planeGeometry.canonicalInput).scene.elements:[];
  const ids=new Set(catalog.map(e=>e.id));
  const text=reason=>({mode:'text_only',entityIds:[],reason});
  const resolve=raw=>{
    if(!valid)return text('PLANE_BINDING_MISSING_OR_STALE');
    if(raw?.mode==='text_only')return text('TEXT_ONLY_STEP');
    if(raw?.mode!==undefined&&raw.mode!=='highlight')return text('UNSUPPORTED_VISUAL_MODE');
    const wanted=raw?.entityIds??raw?.entities??raw?.highlight;
    if(!Array.isArray(wanted)||!wanted.length||wanted.length>12||wanted.some(id=>!ids.has(id)))return text('UNKNOWN_OR_AMBIGUOUS_ENTITY');
    return {mode:'highlight',entityIds:[...new Set(wanted)],reason:''};
  };
  const rows=key=>Array.isArray(record?.aiRubric?.[key])?record.aiRubric[key].slice(0,100):[];
  const unique=(item,list)=>typeof item?.id==='string'&&item.id.trim().length>0&&item.id.length<=128&&list.filter(s=>s?.id===item.id).length===1;
  const stepRows=rows('steps'),partRows=rows('parts');
  const steps=stepRows.map(step=>({id:typeof step?.id==='string'?step.id:'',visual:unique(step,stepRows)?resolve(step.visual):text('DUPLICATE_OR_INVALID_STEP_ID')}));
  const parts=partRows.map(part=>({id:typeof part?.id==='string'?part.id:'',visual:!unique(part,partRows)?text('DUPLICATE_OR_INVALID_PART_ID'):part.visual?resolve(part.visual):
    Array.isArray(part.steps)&&part.steps.length===1?steps.find(s=>s.id===part.steps[0])?.visual||text('UNKNOWN_STEP'):text('AMBIGUOUS_PART_STEPS')}));
  return {status:valid?'ready':'text_only',binding:valid?binding:null,steps,parts};
}
