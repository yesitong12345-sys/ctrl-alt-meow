import {createHash} from 'node:crypto';
import core from '../../implementation/plane-ellipse-core.js';
import {strictQuestionFingerprint} from './shared-content-fingerprint.mjs';

const key=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function compileEllipseGeometry({question,subject='数学',input,confirmed=false}={}){
  if(subject!=='数学'||typeof question!=='string'||!question.trim())return {status:'invalid',reason:'MATH_QUESTION_REQUIRED'};
  if(confirmed!==true)return {status:'needs_confirmation',reason:'CONFIRM_EXPLICIT_PARAMETERS'};
  const model=core.compile(input);
  if(model.status!=='verified')return model;
  return {...model,binding:{version:core.VERSION,question:strictQuestionFingerprint(question,subject),parameters:key(model.canonicalInput)}};
}

export function matchesEllipseGeometry(model,{question,subject='数学',input}={}){
  if(model?.status!=='verified'||model.version!==core.VERSION||model.binding?.version!==core.VERSION||subject!=='数学'||!String(question||'').trim())return false;
  const stored=core.compile(model.canonicalInput),requested=core.compile(input??model.canonicalInput);
  return stored.status==='verified'&&requested.status==='verified'
    &&model.binding.question===strictQuestionFingerprint(question,subject)
    &&model.binding.parameters===key(model.canonicalInput)
    &&model.binding.parameters===key(input===undefined?model.canonicalInput:requested.canonicalInput);
}

export function ellipseEntityCatalog(record){
  if(!record||!matchesEllipseGeometry(record.planeEllipse,record))return [];
  return core.compile(record.planeEllipse.canonicalInput).scene.elements.map(({id,type,role})=>({id,type,role}));
}

// This mirrors the circle-line contract, but uses a separate contract name so
// an old circle binding can never bless an ellipse highlight after a model swap.
export function createEllipseVisualBinding(record){
  if(!record||!matchesEllipseGeometry(record.planeEllipse,record))return null;
  const rubric=record.aiRubric;
  if(!rubric||typeof rubric!=='object'||Array.isArray(rubric)||['steps','parts'].some(name=>
    rubric[name]!==undefined&&(!Array.isArray(rubric[name])||rubric[name].length>100||rubric[name].some(row=>!row||typeof row!=='object'||Array.isArray(row)))))return null;
  const {ellipseVisualBinding,...publicRubric}=rubric;
  try{return {contract:'ellipse-step-visual/v1',...record.planeEllipse.binding,rubric:key(publicRubric)};}catch{return null;}
}

export function ellipseStepVisuals(record){
  const binding=createEllipseVisualBinding(record),saved=record?.aiRubric?.ellipseVisualBinding;
  const valid=Boolean(binding&&saved)&&Object.keys(binding).every(name=>saved[name]===binding[name]);
  const ids=new Set(valid?core.compile(record.planeEllipse.canonicalInput).scene.elements.map(item=>item.id):[]);
  const text=reason=>({mode:'text_only',entityIds:[],reason});
  const resolve=raw=>{
    if(!valid)return text('ELLIPSE_BINDING_MISSING_OR_STALE');
    if(raw?.mode==='text_only')return text('TEXT_ONLY_STEP');
    if(raw?.mode!==undefined&&raw.mode!=='highlight')return text('UNSUPPORTED_VISUAL_MODE');
    const wanted=raw?.entityIds??raw?.entities??raw?.highlight;
    if(!Array.isArray(wanted)||!wanted.length||wanted.length>12||wanted.some(id=>!ids.has(id)))return text('UNKNOWN_OR_AMBIGUOUS_ENTITY');
    return {mode:'highlight',entityIds:[...new Set(wanted)],reason:''};
  };
  const rows=name=>Array.isArray(record?.aiRubric?.[name])?record.aiRubric[name].slice(0,100):[];
  const unique=(row,list)=>typeof row?.id==='string'&&row.id.trim().length>0&&row.id.length<=128&&list.filter(item=>item?.id===row.id).length===1;
  const stepRows=rows('steps'),partRows=rows('parts');
  const steps=stepRows.map(step=>({id:typeof step?.id==='string'?step.id:'',visual:unique(step,stepRows)?resolve(step.visual):text('DUPLICATE_OR_INVALID_STEP_ID')}));
  const parts=partRows.map(part=>({id:typeof part?.id==='string'?part.id:'',visual:!unique(part,partRows)?text('DUPLICATE_OR_INVALID_PART_ID'):part.visual?resolve(part.visual):
    Array.isArray(part.steps)&&part.steps.length===1?steps.find(step=>step.id===part.steps[0])?.visual||text('UNKNOWN_STEP'):text('AMBIGUOUS_PART_STEPS')}));
  return {status:valid?'ready':'text_only',binding:valid?binding:null,steps,parts};
}
