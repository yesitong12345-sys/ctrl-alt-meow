/* THESIS: 在原题下核对显式参数，不把近似课程当成本题。
 * OWN-WORLD: 沿用墨蓝、行动蓝与纸白；数学区无装饰动画。
 * STORY: 核对题干→确认参数→保存→本机观察，未知状态不展示旧图。
 * FIRST VIEWPORT: 错题详情中的折叠行；展开为窄屏单列表单和等比例SVG。
 * FORM: 既有错题详情的局部扩展，不改变原页面结构或评分规则。
 */
(function(){
  'use strict';
  let app,epoch=0,activeOwner='',activeCase='';
  const states=new Map();
  const fields=[['cx','圆心 x'],['cy','圆心 y'],['radius','半径 r'],['a','直线 A'],['b','直线 B'],['c','直线 C']];
  const owner=()=>String(window.__eduCurrentOwner||window.__eduSessionUserId||'local-student')+'|'+String(window.__eduAuthSessionToken||'');
  const recordFor=id=>(app?.state.mistakes||[]).find(m=>m.id===id);
  const questionKey=m=>String(m?.subject||'')+'\n'+String(m?.question||'');
  const esc=value=>app.esc(String(value??''));
  const style=document.createElement('style');
  style.textContent='.plane-panel{margin:16px 0;color:#142847;min-width:0}.plane-panel summary{cursor:pointer;padding:12px 0;font-weight:700;min-height:44px;box-sizing:border-box}.plane-panel p{line-height:1.65;max-width:70ch}.plane-panel .plane-body{padding:4px 0 12px}.plane-panel .plane-question{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 16px}.plane-panel .plane-help{font-size:14px;color:#405574}.plane-panel fieldset{border:0;margin:12px 0;padding:0;min-width:0}.plane-panel legend{font-weight:700;margin-bottom:8px}.plane-panel .plane-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.plane-panel label{display:grid;gap:6px;font-size:14px}.plane-panel input[type=number]{width:100%;box-sizing:border-box;min-width:0;min-height:44px;padding:9px;font:inherit;border:1px solid #9babbe;border-radius:9px;background:#fff}.plane-panel .plane-check{display:flex;align-items:flex-start;gap:9px;min-height:44px;line-height:1.6;margin:14px 0}.plane-panel .plane-check input{width:22px;height:22px;flex:none;margin-top:2px}.plane-panel .plane-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.plane-panel button{min-height:44px;min-width:44px;font:inherit}.plane-panel button:focus-visible,.plane-panel input:focus-visible,.plane-panel summary:focus-visible{outline:3px solid #3369e8;outline-offset:3px}.plane-panel button:disabled{opacity:.6;cursor:not-allowed}.plane-panel .plane-status{font-size:14px;min-height:24px;line-height:1.65;overflow-wrap:anywhere}.plane-panel .plane-status[data-error=true]{color:#9c233c}.plane-panel .plane-figure{max-width:640px;margin:12px 0;overflow:hidden;border:1px solid #c7d5e8;border-radius:12px}.plane-panel .plane-figure:empty{display:none}@media(max-width:640px){.plane-panel .plane-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.plane-panel .plane-actions button{flex:1 1 110px}}';
  document.head.appendChild(style);

  function fresh(record){return {question:questionKey(record),draft:Object.fromEntries(fields.map(([k])=>[k,''])),
    confirmed:false,loaded:false,loading:false,saving:false,model:null,stepVisuals:null,selection:0,fingerprint:'',message:'',error:false,open:false,zoom:1,ids:[],reveal:false};}
  function alive(id,state,ticket,scope){return ticket===epoch&&owner()===scope&&states.get(id)===state&&questionKey(recordFor(id))===state.question;}
  function mounted(id){return Array.from(document.querySelectorAll('[data-plane-panel]')).find(n=>n.dataset.planePanel===id);}
  function refresh(id,state){const node=mounted(id);if(node)paint(node,id,state);}
  function adopt(state,model){
    const input=model.canonicalInput;
    state.draft={cx:String(input.circle.center[0]),cy:String(input.circle.center[1]),radius:String(input.circle.radius),
      a:String(input.line.coefficients[0]),b:String(input.line.coefficients[1]),c:String(input.line.coefficients[2])};
    state.model=model;state.stepVisuals=null;state.confirmed=false;state.ids=[];state.zoom=1;state.reveal=false;state.formOpen=false;
  }
  async function call(id,options={}){
    const token=window.__eduAuthSessionToken||app.state.apiToken||'';
    const response=await fetch(location.origin+'/v1/mistake-cases/'+encodeURIComponent(id)+'/plane-model',{
      ...options,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(body.reason||body.error||'HTTP '+response.status);error.code=body.error;error.status=response.status;throw error;}
    return body;
  }
  function errorText(error){
    if(error.code==='QUESTION_CHANGED')return '题干已变化，未保存。输入还在，请刷新题目并重新核对参数。';
    if(error.status===401)return '登录已失效，未保存。请重新登录后核对本题。';
    if(error.status===404)return '无法读取本人的这道题，或学习服务尚未更新。输入还在，请确认账号与服务版本后重试。';
    if(error.message==='NEAR_TANGENCY')return '参数接近相切边界，需要更准确的数据；未保存，输入仍保留。';
    if(error.code==='PLANE_MODEL_NOT_VERIFIED')return '参数未通过校验。请检查半径为正、A和B不同时为0，以及数值范围；输入仍保留。';
    return '读取或保存没有完成，输入仍保留。请检查学习服务连接后重试。';
  }
  async function load(id,state){
    if(state.loading)return;
    const ticket=epoch,scope=owner();state.loading=true;state.loaded=false;state.model=null;state.stepVisuals=null;state.ids=[];state.reveal=false;state.error=false;state.message='正在读取本题模型…';refresh(id,state);
    try{
      const result=await call(id);
      if(!alive(id,state,ticket,scope))return;
      // Never ask a student to confirm parameters against a stale on-screen question.
      if(result.question!==recordFor(id)?.question||result.subject!==recordFor(id)?.subject)throw Error('STALE_VISIBLE_QUESTION');
      state.fingerprint=result.questionFingerprint;state.loaded=true;state.model=null;state.reveal=false;
      if(result.status==='ready'&&result.model){adopt(state,result.model);state.stepVisuals=result.stepVisuals;state.message='已保存本题模型。点当前或已完成得分点可查看本地提示；观察与缩放不请求AI。';}
      else state.message=result.status==='stale'?'题干或模型版本已变化，旧模型不再展示。请重新核对参数。':'尚未保存二维模型。请按原题填写参数，不会自动调用AI。';
    }catch(error){if(alive(id,state,ticket,scope)){state.error=true;state.message=error.message==='STALE_VISIBLE_QUESTION'?'当前题干不是服务端最新版本，请刷新题目；输入仍保留。':errorText(error);}}
    finally{if(alive(id,state,ticket,scope)){state.loading=false;refresh(id,state);}}
  }
  async function submit(id,state){
    if(state.saving||!state.confirmed||!state.loaded)return;
    state.selection++;
    const values=fields.map(([k])=>state.draft[k].trim());
    if(values.some(v=>!v||!Number.isFinite(Number(v)))){state.error=true;state.message='请填完整的六个有限数值；输入仍保留。';return refresh(id,state);}
    const [cx,cy,radius,a,b,c]=values.map(Number),ticket=epoch,scope=owner();
    const input={schemaVersion:'plane-ir/v1',circle:{id:'circle-c',center:[cx,cy],radius},line:{id:'line-l',coefficients:[a,b,c]}};
    state.saving=true;state.error=false;state.message='正在校验并保存，尚未确认保存成功…';refresh(id,state);
    try{
      const result=await call(id,{method:'POST',body:JSON.stringify({input,confirmed:true,questionFingerprint:state.fingerprint})});
      if(!alive(id,state,ticket,scope))return;
      if(result.status!=='ready'||!result.model||result.saved!==true)throw Error('MODEL_NOT_SAVED');
      adopt(state,result.model);state.message='已保存到本题，刷新后仍可回看。观察与缩放不调用AI。';
    }catch(error){if(alive(id,state,ticket,scope)){state.error=true;state.message=errorText(error);if(error.code==='QUESTION_CHANGED'){state.model=null;state.loaded=false;state.confirmed=false;}}}
    finally{if(alive(id,state,ticket,scope)){state.saving=false;refresh(id,state);}}
  }
  function resultAllowed(record){
    let progress;try{progress=window.__eduPlaneScoreProgress?.(record)||window.__eduScoreProgressFull?.(record);}catch{}
    const complete=Boolean(record?.completionReview)||Number(progress?.percent)===100;
    return complete&&window.__eduSharedModelAnswerUnlocked?.(record)===true;
  }
  function accessiblePart(id,partId){
    try{const progress=window.__eduPlaneScoreProgress?.(recordFor(id));
      return Boolean(progress?.rubric?.some(p=>p.id===partId)&&(progress.current?.id===partId||progress.done?.includes(partId)));
    }catch{return false;}
  }
  async function showPart(id,partId){
    const state=states.get(id),node=mounted(id);if(!state||!node)return;
    const ticket=epoch,scope=owner(),selection=++state.selection;
    const current=()=>alive(id,state,ticket,scope)&&state.selection===selection&&mounted(id)===node;
    state.ids=[];state.reveal=false;
    const report=message=>{state.message=message;state.error=false;refresh(id,state);};
    if(!accessiblePart(id,partId))return report('先完成当前步骤，再查看后续提示。');
    node.open=true;state.open=true;
    if(!state.loaded){if(state.loading)return report('模型正在读取，请稍后再点当前步骤。');await load(id,state);}
    if(!current())return;
    if(!accessiblePart(id,partId))return report('步骤状态已变化，请重新选择当前步骤。');
    const projection=state.stepVisuals,binding=projection?.binding,record=recordFor(id);
    // Match the current on-screen rubric, not just the rubric that existed at GET time.
    const {planeVisualBinding,...rubric}=record?.aiRubric||{},rubricText=JSON.stringify(rubric);
    let hash='';
    try{hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(rubricText))),b=>b.toString(16).padStart(2,'0')).join('');}catch{}
    if(!current())return;
    if(!accessiblePart(id,partId))return report('步骤状态已变化，请重新选择当前步骤。');
    const {planeVisualBinding:latestBinding,...latestRubric}=recordFor(id)?.aiRubric||{};
    const valid=projection===state.stepVisuals&&rubricText===JSON.stringify(latestRubric)&&projection?.status==='ready'&&binding?.contract==='plane-step-visual/v1'&&hash===binding.rubric
      &&['question','parameters','version'].every(key=>binding[key]===state.model?.binding?.[key]);
    const matches=projection?.parts?.filter(p=>p.id===partId)||[],visual=matches.length===1?matches[0].visual:null;
    if(!valid||visual?.mode!=='highlight'||!Array.isArray(visual.entityIds)||!visual.entityIds.length)return report('这一步暂无可验证的图形提示，请结合当前步骤文字思考；不会自动请求AI。');
    const rendered=window.__eduPlaneGeometry?.render(state.model,{entityIds:visual.entityIds});
    if(rendered?.mode!=='highlight')return report('这一步的对象无法准确对应，保留文字提示。');
    state.ids=[...visual.entityIds];report('已突出这一步的相关对象，其他对象变淡。提示在本机完成，不请求AI。');
  }
  function draw(node,id,state){
    const figure=node.querySelector('.plane-figure');if(!figure||!state.model)return;
    const unlocked=resultAllowed(recordFor(id));if(!unlocked)state.reveal=false;
    const result=window.__eduPlaneGeometry?.render(state.model,{entityIds:state.ids,zoom:state.zoom,
      completed:state.reveal&&unlocked,answerUnlocked:unlocked});
    figure.innerHTML=result?.svg||'';
  }
  function paint(node,id,state){
    const body=node.querySelector('.plane-body');if(!body)return;
    const working=state.loading||state.saving;
    body.innerHTML='<p class="plane-help">仅支持一条直线与一个圆的显式参数。先核对原题，不是任意题干自动建模。</p>'
      +'<p class="plane-question">'+esc(recordFor(id)?.question)+'</p><details class="plane-parameters" '+(!state.model||state.formOpen?'open':'')+'><summary>核对 / 修改参数</summary>'
      +'<fieldset '+(working?'disabled':'')+'><legend>圆：(x − x₀)² + (y − y₀)² = r²</legend><div class="plane-fields">'
      +fields.slice(0,3).map(([k,label])=>'<label>'+label+'<input type="number" step="any" name="'+k+'" value="'+esc(state.draft[k])+'"></label>').join('')+'</div></fieldset>'
      +'<fieldset '+(working?'disabled':'')+'><legend>直线：Ax + By + C = 0</legend><div class="plane-fields">'
      +fields.slice(3).map(([k,label])=>'<label>'+label+'<input type="number" step="any" name="'+k+'" value="'+esc(state.draft[k])+'"></label>').join('')+'</div></fieldset>'
      +'<p class="plane-help">半径范围0.0001～1000000，A、B不能同时为0。直线x=3可填A=1、B=0、C=−3。</p>'
      +'<label class="plane-check"><input type="checkbox" name="confirmed" '+(state.confirmed?'checked':'')+' '+(working?'disabled':'')+'>我已按上方题干核对这些参数</label>'
      +'<div class="plane-actions"><button type="button" class="primary" data-plane-save '+(!state.confirmed||!state.loaded||working?'disabled':'')+'>确认参数并保存</button><button type="button" data-plane-reload '+(working?'disabled':'')+'>重新读取</button></div></details>'
      +'<p class="plane-status" role="status" aria-live="polite" data-error="'+state.error+'">'+esc(state.message)+'</p>'
      +(state.model?'<div class="plane-actions"><button type="button" data-plane-focus="circle-c">突出圆</button><button type="button" data-plane-focus="line-l">突出直线</button><button type="button" data-plane-focus="point-foot">观察垂足H</button><button type="button" data-plane-reset>恢复完整模型</button><button type="button" data-plane-zoom="1.2">放大</button><button type="button" data-plane-zoom="0.8">缩小</button></div><div class="plane-figure"></div><p class="plane-help">本图按已保存参数绘制；编辑表单不会改动原图，需确认保存后更新。计算结果在完成本题且满足答案条件后可查看。</p><button type="button" data-plane-result-toggle '+(!resultAllowed(recordFor(id))?'disabled':'')+'>'+(state.reveal?'收起计算结果':'查看计算结果')+'</button>':'');
    body.querySelectorAll('input[type=number]').forEach(input=>input.oninput=()=>{state.draft[input.name]=input.value;state.confirmed=false;body.querySelector('[name=confirmed]').checked=false;body.querySelector('[data-plane-save]').disabled=true;});
    body.querySelector('.plane-parameters').ontoggle=e=>{state.formOpen=e.target.open;};
    body.querySelector('[name=confirmed]').onchange=e=>{state.confirmed=e.target.checked;body.querySelector('[data-plane-save]').disabled=!state.confirmed||!state.loaded||working;};
    body.querySelector('[data-plane-save]').onclick=()=>submit(id,state);
    body.querySelector('[data-plane-reload]').onclick=()=>{state.selection++;load(id,state);};
    body.querySelectorAll('[data-plane-focus]').forEach(button=>button.onclick=()=>{state.selection++;state.ids=[button.dataset.planeFocus];draw(node,id,state);});
    const reset=body.querySelector('[data-plane-reset]');if(reset)reset.onclick=()=>{state.selection++;state.ids=[];state.zoom=1;state.reveal=false;draw(node,id,state);};
    body.querySelectorAll('[data-plane-zoom]').forEach(button=>button.onclick=()=>{state.zoom=Math.max(.5,Math.min(4,state.zoom*Number(button.dataset.planeZoom)));draw(node,id,state);});
    const toggle=body.querySelector('[data-plane-result-toggle]');if(toggle)toggle.onclick=()=>{if(!resultAllowed(recordFor(id)))return;state.reveal=!state.reveal;toggle.textContent=state.reveal?'收起计算结果':'查看计算结果';draw(node,id,state);};
    draw(node,id,state);
  }
  function decorate(view){
    if(activeOwner!==owner()){activeOwner=owner();epoch++;states.clear();view.querySelectorAll('[data-plane-panel]').forEach(n=>n.remove());}
    const focused=view.querySelector('article.mistake[data-mistake-id] section.tutor')?.closest('[data-mistake-id]')?.dataset.mistakeId||'';
    if(activeCase!==focused){const previous=states.get(activeCase);if(previous){previous.selection++;previous.ids=[];previous.zoom=1;previous.reveal=false;}activeCase=focused;}
    view.querySelectorAll('article.mistake[data-mistake-id]').forEach(card=>{
      const id=card.dataset.mistakeId,record=recordFor(id);
      if(!record||record.subject!=='数学'||!card.querySelector('section.tutor')||(!record.planeGeometry&&!/圆|直线/.test([record.unit,record.question,...(record.knowledgePoints||[])].join(' '))))return;
      if(!record.geometryResult)card.querySelectorAll('[data-live-score-part]').forEach(chip=>{chip.title='点一下：在二维模型上高亮当前或已完成步骤；没有有效绑定时保留文字提示';});
      let state=states.get(id);
      if(!state||state.question!==questionKey(record)){state=fresh(record);states.set(id,state);}
      const existing=card.querySelector('[data-plane-panel]');if(existing)return;
      const node=document.createElement('details');node.className='plane-panel';node.dataset.planePanel=id;
      node.innerHTML='<summary>直线与圆 · 二维模型</summary><div class="plane-body"></div>';node.open=state.open;
      card.querySelector('section.tutor').before(node);paint(node,id,state);
      node.ontoggle=()=>{state.open=node.open;if(!node.open){state.selection++;state.ids=[];state.reveal=false;draw(node,id,state);}else if(!state.loaded&&!state.loading)load(id,state);};
    });
  }
  window.addEventListener('edu-account-session-changed',()=>{epoch++;states.clear();document.querySelectorAll('[data-plane-panel]').forEach(n=>n.remove());});
  function inspectStep(event){
    if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    const chip=event.target.closest?.('[data-live-score-part]'),card=chip?.closest('article.mistake[data-mistake-id]');
    if(!card?.querySelector('[data-plane-panel]'))return;
    const record=recordFor(card.dataset.mistakeId);
    // A solid question can mention a line/circle too. Keep its 3D handler until
    // the student explicitly opens/loads a valid independent 2D model.
    if(record?.geometryResult&&!states.get(record.id)?.model)return;
    // Only this 2D card consumes the gesture; leave all 3D cards on the incumbent path.
    event.preventDefault();event.stopImmediatePropagation();showPart(card.dataset.mistakeId,chip.dataset.liveScorePart);
  }
  document.addEventListener('click',inspectStep,true);
  document.addEventListener('keydown',inspectStep,true);
  document.addEventListener('click',event=>{const tab=event.target.closest?.('[data-tab]');if(tab&&tab.dataset.tab!=='library'){for(const state of states.values()){state.selection++;state.ids=[];state.zoom=1;state.reveal=false;}activeCase='';}},true);
  window.__registerMistakeEditor?.({activate(context){app=context;},decorateLibrary:decorate});
})();
