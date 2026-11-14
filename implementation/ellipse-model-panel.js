/* Explicit ellipse model panel: local SVG rendering only.  It never asks AI
 * to infer a model, and score-point highlights consume only server-validated
 * ellipseStepVisuals. */
(function(){
  'use strict';
  let app,revision=0;
  const owner=()=>String(window.__eduCurrentOwner||window.__eduSessionUserId||'local-student')+'|'+String(window.__eduAuthSessionToken||'');
  const states=new Map();
  const fields=[['a','半长轴 a'],['b','半短轴 b'],['la','直线 A'],['lb','直线 B'],['lc','直线 C']];
  const esc=value=>app.esc(String(value??''));
  const questionOf=record=>String(record?.subject||'')+'\n'+String(record?.question||'');
  const recordOf=id=>(app?.state.mistakes||[]).find(item=>item.id===id);
  const nodeOf=id=>document.querySelector('[data-ellipse-panel="'+CSS.escape(id)+'"]');
  const fresh=record=>({key:questionOf(record),loaded:false,loading:false,saving:false,model:null,visuals:null,fingerprint:'',ids:[],zoom:1,confirmed:false,draft:Object.fromEntries(fields.map(([id])=>[id,''])),message:'',error:false});
  const same=(id,state,token,scope)=>token===revision&&scope===owner()&&states.get(id)===state&&questionOf(recordOf(id))===state.key;

  const style=document.createElement('style');
  style.textContent='.ellipse-panel{margin:14px 0;color:#142847}.ellipse-panel summary{cursor:pointer;min-height:44px;padding:12px 0;font-weight:700}.ellipse-panel p{line-height:1.65}.ellipse-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.ellipse-grid label{display:grid;gap:5px;font-size:14px}.ellipse-grid input{min-width:0;min-height:44px;padding:8px;border:1px solid #9babbe;border-radius:9px;font:inherit}.ellipse-panel button{min-height:44px;font:inherit}.ellipse-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.ellipse-figure{max-width:640px;overflow:hidden;border:1px solid #c7d5e8;border-radius:12px}.ellipse-status{min-height:24px;font-size:14px}.ellipse-status[data-error=true]{color:#9c233c}@media(max-width:640px){.ellipse-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ellipse-actions button{flex:1 1 110px}}';
  document.head.appendChild(style);

  function adopt(state,model){
    const input=model.canonicalInput;state.model=model;state.ids=[];state.zoom=1;state.confirmed=false;
    state.draft={a:String(input.ellipse.semiMajor),b:String(input.ellipse.semiMinor),la:String(input.line.coefficients[0]),lb:String(input.line.coefficients[1]),lc:String(input.line.coefficients[2])};
  }
  async function request(id,options={}){
    const token=window.__eduAuthSessionToken||app.state.apiToken||'';
    const response=await fetch(location.origin+'/v1/mistake-cases/'+encodeURIComponent(id)+'/ellipse-model',{...options,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(body.reason||body.error||'HTTP '+response.status);error.code=body.error;error.status=response.status;throw error;}
    return body;
  }
  function explain(error){
    if(error.code==='QUESTION_CHANGED')return '题干已变化，尚未保存；请重新读取并核对参数。';
    if(error.code==='ELLIPSE_MODEL_NOT_VERIFIED')return '参数未通过校验：需要 a>b>0，直线 A、B 不能同时为 0。';
    if(error.status===404)return '无法读取本人的这道题，或学习服务尚未更新。';
    return '读取或保存没有完成；输入还保留在页面上，可以稍后重试。';
  }
  function redraw(id,state){
    const host=nodeOf(id)?.querySelector('.ellipse-figure');if(!host||!state.model)return;
    const result=window.__eduPlaneEllipse?.render(state.model,{entityIds:state.ids,zoom:state.zoom,completed:false,answerUnlocked:false});
    host.innerHTML=result?.svg||'';
  }
  async function load(id,state){
    if(state.loading)return;const token=revision,scope=owner();state.loading=true;state.message='正在读取本题椭圆模型…';state.error=false;paint(id,state);
    try{const result=await request(id);if(!same(id,state,token,scope))return;
      if(result.question!==recordOf(id)?.question||result.subject!==recordOf(id)?.subject)throw Error('STALE');
      state.loaded=true;state.fingerprint=result.questionFingerprint;state.visuals=result.stepVisuals||null;
      if(result.status==='ready'&&result.model){adopt(state,result.model);state.message='已保存本题椭圆模型；缩放和高亮只在本机重绘。';}
      else state.message=result.status==='stale'?'题干或参数已变化，旧模型不展示。':'尚未保存椭圆模型；请按原题填写显式参数。';
    }catch(error){if(same(id,state,token,scope)){state.error=true;state.message=error.message==='STALE'?'当前题干不是服务端最新版本，请刷新题目。':explain(error);}}
    finally{if(same(id,state,token,scope)){state.loading=false;paint(id,state);}}
  }
  async function save(id,state){
    if(!state.loaded||!state.confirmed||state.saving)return;
    const values=fields.map(([name])=>state.draft[name].trim());
    if(values.some(value=>!value||!Number.isFinite(Number(value)))){state.error=true;state.message='请填完整的五个有限数值。';return paint(id,state);}
    const [a,b,la,lb,lc]=values.map(Number),token=revision,scope=owner();state.saving=true;state.error=false;state.message='正在本地校验并保存…';paint(id,state);
    try{const result=await request(id,{method:'POST',body:JSON.stringify({confirmed:true,questionFingerprint:state.fingerprint,input:{schemaVersion:'plane-ellipse/v1',ellipse:{id:'ellipse-e',semiMajor:a,semiMinor:b},line:{id:'line-l',coefficients:[la,lb,lc]}}})});
      if(!same(id,state,token,scope))return;if(result.status!=='ready'||!result.model)throw Error('NOT_SAVED');adopt(state,result.model);state.message='已保存到本题；刷新后仍可回看。';
    }catch(error){if(same(id,state,token,scope)){state.error=true;state.message=explain(error);}}
    finally{if(same(id,state,token,scope)){state.saving=false;paint(id,state);}}
  }
  function paint(id,state){
    const panel=nodeOf(id),body=panel?.querySelector('.ellipse-body');if(!body)return;const busy=state.loading||state.saving;
    body.innerHTML='<p>仅支持中心在原点、坐标轴为主轴的标准椭圆与一条直线。不会从题干猜参数或调用 AI。</p><p>'+esc(recordOf(id)?.question)+'</p><details '+(!state.model?'open':'')+'><summary>核对 / 修改参数</summary><fieldset '+(busy?'disabled':'')+'><div class="ellipse-grid">'+fields.map(([name,label])=>'<label>'+label+'<input name="'+name+'" type="number" step="any" value="'+esc(state.draft[name])+'"></label>').join('')+'</div></fieldset><p>椭圆：x²/a² + y²/b² = 1；直线：Ax + By + C = 0；要求 a＞b＞0。</p><label><input name="confirmed" type="checkbox" '+(state.confirmed?'checked':'')+'> 我已按题干核对以上参数</label><div class="ellipse-actions"><button data-ellipse-save '+(!state.loaded||!state.confirmed||busy?'disabled':'')+'>确认参数并保存</button><button data-ellipse-reload '+(busy?'disabled':'')+'>重新读取</button></div></details><p class="ellipse-status" data-error="'+state.error+'">'+esc(state.message)+'</p>'+(state.model?'<div class="ellipse-actions"><button data-ellipse-focus="ellipse-e">突出椭圆</button><button data-ellipse-focus="line-l">突出直线</button><button data-ellipse-focus="point-i-1">突出交点 I₁</button><button data-ellipse-reset>恢复完整模型</button><button data-ellipse-zoom="1.2">放大</button><button data-ellipse-zoom="0.8">缩小</button></div><div class="ellipse-figure"></div><p>图形提示只突出已验证实体；计算结论仍受原有答案解锁规则控制。</p>':'');
    body.querySelectorAll('input[type=number]').forEach(input=>input.oninput=()=>{state.draft[input.name]=input.value;state.confirmed=false;paint(id,state);});
    const check=body.querySelector('[name=confirmed]');check.onchange=()=>{state.confirmed=check.checked;paint(id,state);};
    body.querySelector('[data-ellipse-save]').onclick=()=>save(id,state);body.querySelector('[data-ellipse-reload]').onclick=()=>load(id,state);
    body.querySelectorAll('[data-ellipse-focus]').forEach(button=>button.onclick=()=>{state.ids=[button.dataset.ellipseFocus];redraw(id,state);});
    const reset=body.querySelector('[data-ellipse-reset]');if(reset)reset.onclick=()=>{state.ids=[];state.zoom=1;redraw(id,state);};
    body.querySelectorAll('[data-ellipse-zoom]').forEach(button=>button.onclick=()=>{state.zoom=Math.max(.5,Math.min(4,state.zoom*Number(button.dataset.ellipseZoom)));redraw(id,state);});redraw(id,state);
  }
  function eligible(record){return record&&record.subject==='数学'&&(!record.geometryResult)&&(/椭圆/.test([record.unit,record.question,...(record.knowledgePoints||[])].join(' '))||record.planeEllipse);}
  function decorate(view){
    view.querySelectorAll('article.mistake[data-mistake-id]').forEach(card=>{const id=card.dataset.mistakeId,record=recordOf(id);if(!eligible(record)||!card.querySelector('section.tutor')||nodeOf(id))return;
      let state=states.get(id);if(!state||state.key!==questionOf(record)){state=fresh(record);states.set(id,state);}const panel=document.createElement('details');panel.className='ellipse-panel';panel.dataset.ellipsePanel=id;panel.innerHTML='<summary>椭圆与直线 · 二维模型</summary><div class="ellipse-body"></div>';card.querySelector('section.tutor').before(panel);paint(id,state);panel.ontoggle=()=>{if(panel.open&&!state.loaded&&!state.loading)load(id,state);if(!panel.open){state.ids=[];state.zoom=1;}};
    });
  }
  window.addEventListener('edu-account-session-changed',()=>{revision++;states.clear();document.querySelectorAll('[data-ellipse-panel]').forEach(node=>node.remove());});
  window.__registerMistakeEditor?.({activate(context){app=context;},decorateLibrary:decorate});
})();
