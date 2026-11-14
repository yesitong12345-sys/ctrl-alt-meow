/* 两种录入方式共用服务端 WrongQuestion 草稿；确认前不计入真实错题。 */
(function () {
  const subjects = ['未分类','语文','数学','英语','物理','化学','生物','政治','历史','地理'];
  const causes = ['','概念不清','规则不熟','审题偏差','策略选错','计算失误','粗心惯性','知识漏洞'];
  const intake = state.wqIntake = state.wqIntake && typeof state.wqIntake === 'object'
    ? state.wqIntake : {mode:'text',questionText:'',draft:null,error:'',loading:false};
  intake.loading = false;
  if (intake.model3dPreferenceVersion !== 2) { intake.model3d=false; intake.model3dPreferenceVersion=2; }
  if (typeof intake.model3d !== 'boolean') intake.model3d = false;
  if (typeof intake.combineWeakPoints !== 'boolean') intake.combineWeakPoints = false;
  if (typeof intake.retainSourceImage !== 'boolean') intake.retainSourceImage = true;
  if (typeof intake.supplementImageData !== 'string') intake.supplementImageData = '';
  if (typeof intake.supplementImageName !== 'string') intake.supplementImageName = '';
  const geometryBuilds = new Set();
  const escape = value => esc(value ?? '');
  const apiBase = () => location.protocol.startsWith('http') && !['127.0.0.1','localhost','::1'].includes(location.hostname)
    ? location.origin : String(state.apiBase || (location.protocol.startsWith('http') ? location.origin : 'http://127.0.0.1:4180')).replace(/\/$/,'');
  function loadOwnWeakPoints(){const stamp=Date.now();if(stamp-(window.__wqWeakFetchedAt||0)<15000)return;window.__wqWeakFetchedAt=stamp;
    const token=window.__eduAuthSessionToken||state.apiToken;
    fetch(apiBase()+'/v1/weak-points',{headers:token?{authorization:'Bearer '+token}:{}}).then(response=>response.ok?response.json():[]).then(items=>{
      if(!Array.isArray(items))return;state.wqWeakPoints=items;save();if(state.tab==='upload'||state.tab==='clusters')render();
    }).catch(()=>{});
  }
  async function call(path, body) {
    const token = window.__eduAuthSessionToken || state.apiToken;
    const response = await fetch(apiBase()+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    const result = await response.json().catch(()=>({}));
    if(response.status===401&&result.error==='AUTHENTICATION_REQUIRED'){
      await window.__eduRequireLogin?.();
      state.tab='account-settings';
      throw new Error('请先登录，题目已保留，登录后可重试。');
    }
    if (!response.ok) throw new Error(result.message || result.error || `学习服务返回 ${response.status}`);
    return result;
  }
  async function ensureGeometryModel(caseId, question) {
    const item=(state.mistakes||[]).find(entry=>entry.id===caseId);
    if(!item||geometryBuilds.has(caseId))return;
    if(item.geometryResult?.scene){item.geometryBuildStatus='ready';return}
    geometryBuilds.add(caseId);
    item.geometryBuildStatus='building';item.modelMessage='正在自动生成 3D 模型…';save();render();
    try{
      const rebuilt=await call('/v1/mistake-cases/'+encodeURIComponent(caseId)+'/rebuild-model',{
        question:question||item.question,localCase:item
      });
      if(!rebuilt.case?.geometryResult?.scene)throw new Error('服务已响应，但没有返回可展示的 3D 场景');
      const updated={...rebuilt.case,geometryBuildStatus:'ready',modelMessage:''};
      state.mistakes=[updated,...state.mistakes.filter(entry=>entry.id!==caseId)];
      save();render();openTutorForCase(caseId);
    }catch(error){
      const current=(state.mistakes||[]).find(entry=>entry.id===caseId);
      if(current){current.geometryBuildStatus='failed';current.modelMessage='3D 模型生成失败：'+error.message+'。题目已保存，可点击重试。';save();render()}
    }finally{geometryBuilds.delete(caseId)}
  }
  async function watchGeometryBuild(caseId) {
    const active=window.__wqGeometryBuildWatches||(window.__wqGeometryBuildWatches=new Set());
    if(active.has(caseId))return;
    active.add(caseId);    const token=window.__eduAuthSessionToken||state.apiToken;
    try {
      for(let attempt=0;attempt<120;attempt++) {
        await new Promise(resolve=>setTimeout(resolve,5000));
        const response=await fetch(apiBase()+'/v1/mistake-cases',{headers:token?{authorization:'Bearer '+token}:{}});
        if(!response.ok)continue;
        const records=await response.json(),remote=Array.isArray(records)?records.find(item=>item.id===caseId):null;
        if(!remote)return;
        const previous=(state.mistakes||[]).find(item=>item.id===caseId)||{};
        const changed=Boolean(remote.geometryResult?.scene)!==Boolean(previous.geometryResult?.scene)
          ||remote.geometryBuildStatus!==previous.geometryBuildStatus||remote.modelMessage!==previous.modelMessage;
        const merged={...previous,...remote};
        state.mistakes=[merged,...(state.mistakes||[]).filter(item=>item.id!==caseId)];
        if(Array.isArray(state.__serverMistakes))state.__serverMistakes=[merged,...state.__serverMistakes.filter(item=>item.id!==caseId)];
        if(changed){save();if(state.tab==='library')render()}
        if(remote.geometryResult?.scene||remote.geometryBuildStatus==='failed')return;
      }
    } catch {}
    finally { active.delete(caseId); }
  }
  /* 别的模块（如错题编辑里的「重新生成 3D 模型」）也让这道题进入轮询等待。 */
  window.__wqWatchGeometryBuild = watchGeometryBuild;
  async function compressPhoto(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('请选择图片文件');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url});
      const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=canvas.getContext('2d');
      if (!ctx) throw new Error('设备无法压缩图片');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',0.86);
    } finally {URL.revokeObjectURL(url)}
  }
  const select=(values,selected)=>values.map(value=>`<option value="${escape(value)}" ${value===selected?'selected':''}>${escape(value || '待确认')}</option>`).join('');
  function previewHtml() {
    const draft=intake.draft, p=draft?.preview;
    if (!p) return '';
    const providerLabel=({'deepseek-vision':'DeepSeek 图片识别','doubao-vision':'豆包图片识别','doubao-text':'豆包文字整理'})[draft.recognitionProvider]||'';
    return `<section class="wq-review" aria-label="核对 AI 预判结果"><div class="head"><h3>核对识别结果</h3><span class="pill ${draft.recognitionStatus==='needs_manual'?'warn':'good'}">${draft.recognitionStatus==='needs_manual'?'请手动核对':escape(providerLabel||'AI 建议')}</span></div>
      ${window.__wqLocalImage?`<img class="wq-photo-preview" src="${window.__wqLocalImage}" alt="本次录入的题目照片">`:''}
      ${intake.supplementImageData?`<figure class="wq-photo-attachment"><img src="${intake.supplementImageData}" alt="随题附加的电场题图"><figcaption>题目附件：${escape(intake.supplementImageName||'电场题图')}</figcaption></figure>`:''}
      <label>识别到的题目<textarea id="wq-question" placeholder="请核对并补全题干">${escape(p.question)}</textarea></label>
      <label>手写笔记 <small>与印刷题干分开保存</small><textarea id="wq-handwriting" placeholder="没有手写笔记可留空">${escape(p.handwriting.join('\n'))}</textarea></label>
      <div class="wq-two"><label>科目预判<select id="wq-subject">${select(subjects,p.subject)}</select></label><label>错因预判<select id="wq-cause">${select(causes,p.errorCause)}</select></label></div>
      <label>错因依据 <small>有手写作答时，请引用其中的原文；没有手写可留空</small><textarea id="wq-evidence" placeholder="例如：手写“我算成 3”">${escape(p.errorCauseEvidence)}</textarea></label>
      <label>知识点 <small>用逗号分隔，可增删</small><input id="wq-knowledge" value="${escape(p.knowledgePoints.join('、'))}" placeholder="待你确认"></label>
      <div class="wq-options"><label><input id="wq-model3d" type="checkbox" ${intake.model3d?'checked':''}> 立体几何题自动生成 3D 模型</label><label><input id="wq-combine-weak" type="checkbox" ${intake.combineWeakPoints?'checked':''}> 结合我已有的错点安排陪练与复习</label></div>
      ${draft.source==='image'?`<div class="wq-options"><label><input id="wq-retain-photo" type="checkbox" ${intake.retainSourceImage?'checked':''}> 将这张原题照片一并保存在错题库</label><small>取消勾选后，错题库只保存核对后的文字，不保留这张原图。</small></div>`:''}
      ${intake.combineWeakPoints?`<p class="muted">将关联本人已记录的薄弱知识点；不会把错点当作本题已知条件。${(state.wqWeakPoints||[]).length?' 当前可关联 '+Math.min(5,state.wqWeakPoints.length)+' 项。':' 暂无陪练错点，完成真实作答后再积累。'}</p>`:''}
      <div class="row"><button class="primary" id="wq-confirm" ${intake.loading?'disabled':''}>✅ 确认无误，存入错题库</button>${draft.source==='image'&&draft.recognitionStatus==='needs_manual'?'<button id="wq-retry-photo" type="button">🔄 重新识别这张照片</button>':''}<button id="wq-restart">重新录入</button></div>
      <p class="muted">科目、错因和知识点都只是建议；你修改后的版本会与原建议一起保存。</p></section>`;
  }
  function entryHtml() {
    return `<section class="panel wq-entry"><div class="head"><div><h2>录入一道错题</h2><p class="muted">拍照或说出题目，核对后再存入错题库。</p></div></div>
      <div class="wq-entry-switch"><button data-wq-mode="image" class="${intake.mode==='image'?'active':''}">📷 拍照录入</button><button data-wq-mode="text" class="${intake.mode==='text'?'active':''}">✍️ 文字/语音录入</button></div>
      ${intake.mode==='image'?`<div class="row"><button id="wq-camera">打开摄像头</button><button id="wq-gallery">从相册选择</button></div><input id="wq-camera-file" hidden type="file" accept="image/*" capture="environment"><input id="wq-gallery-file" hidden type="file" accept="image/*"><p class="muted">图片会在设备上压缩，再由学习服务识别；看不清的内容请在下方手动改正。</p>`:
      `<label>题目文字<textarea id="wq-text" placeholder="键盘输入，或点击语音按钮说出题目">${escape(intake.questionText)}</textarea></label><div class="row"><button id="wq-voice" type="button">🎙️ 开始语音输入</button><button id="wq-preview" class="primary" ${intake.loading?'disabled':''}>识别并核对</button></div><p class="muted" id="wq-voice-status">语音由当前浏览器识别；若设备不支持，仍可使用键盘。</p>`}
      <div class="wq-attachment"><div><b>题目附件图（可选）</b><p class="muted">上传电场示意图或坐标图；确认后会和题目文字一起进入错题库。</p></div><input id="wq-attachment-file" type="file" accept="image/*" hidden><button id="wq-attachment-pick" type="button">＋ 添加/截取题图</button>${intake.supplementImageData?`<img src="${intake.supplementImageData}" alt="题目附件预览"><button id="wq-attachment-remove" type="button">移除附件</button>`:''}</div>
      ${intake.loading?`<p class="wq-status" role="status">${escape(intake.statusMessage||'正在识别，请稍候…')}</p>`:''}${intake.error?`<p class="wq-error" role="alert">${escape(intake.error)}</p>`:''}<div class="wq-geometry-status">${escape(state.autoReview?.message||'')}</div>${previewHtml()}</section>`;
  }
  async function preview({imageData='',fileName=''}) {
    if(!imageData&&!intake.supplementImageData)window.__wqLocalImage=null;
    intake.loading=true;intake.error='';render();
    try {
      const result=await call('/v1/wrong-questions/preview',{source:imageData||intake.supplementImageData?'image':'text',imageData,
        supplementalImageData:intake.supplementImageData,supplementImageName:intake.supplementImageName,
        fileName,questionText:String(intake.questionText||'').trim()});
      intake.draft=result.draft;
      if(result.draft.recognitionStatus==='needs_manual') intake.error=`${result.message||('自动识别暂未完成（'+(result.recognitionError||'模型未配置')+'）')}。请手动核对题干后继续。`;
    } catch(error) {intake.error=`录入未完成：${error.message}。输入已保留，可重试。`}
    finally {intake.loading=false;save();render()}
  }
  async function retryPhotoRecognition(){
    const draft=intake.draft;if(!draft)return;
    intake.loading=true;intake.error='';render();
    try{const result=await call('/v1/wrong-questions/drafts/'+encodeURIComponent(draft.id)+'/retry-preview',{});
      intake.draft=result.draft;intake.error='';save();
    }catch(error){intake.error='重新识别未完成：'+error.message+'。照片仍保留，可稍后再试。'}
    finally{intake.loading=false;render()}
  }
  async function restoreLatestPhotoDraft(){
    if(intake.draft)return;
    const token=window.__eduAuthSessionToken||state.apiToken;
    try{const response=await fetch(apiBase()+'/v1/wrong-questions/drafts/latest',{
      headers:token?{authorization:'Bearer '+token}:{}});
      if(!response.ok)return;
      const {draft}=await response.json();
      if(!draft||intake.draft||draft.id===intake.dismissedDraftId)return;
      intake.draft=draft;intake.mode='image';save();render();
    }catch{}
  }
  async function selectedPhoto(file) {
    if(!file)return;
    intake.loading=true;intake.error='正在压缩图片…';render();
    try {const imageData=await compressPhoto(file);window.__wqLocalImage=imageData;await preview({imageData,fileName:file.name})}
    catch(error){intake.loading=false;intake.error=`图片处理失败：${error.message}`;render()}
  }
  async function selectedSupplementPhoto(file){if(!file)return;try{intake.supplementImageData=await compressPhoto(file);intake.supplementImageName=file.name||'题目附件图';intake.error='';save();render()}catch(error){intake.error='附件图片处理失败：'+error.message;render()}}
  async function confirm() {
    const draft=intake.draft;if(!draft)return;
    const question=document.querySelector('#wq-question')?.value.trim();
    if(!question){intake.error='请先核对并填写题目文字。';return render()}
    const handwriting=(document.querySelector('#wq-handwriting')?.value||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const subject=document.querySelector('#wq-subject')?.value;
    const errorCause=document.querySelector('#wq-cause')?.value;
    const errorCauseEvidence=document.querySelector('#wq-evidence')?.value.trim() || '';
    const knowledgePoints=(document.querySelector('#wq-knowledge')?.value||'').split(/[、,，;；]+/).map(s=>s.trim()).filter(Boolean);
    draft.preview={...draft.preview,question,handwriting,subject,errorCause,errorCauseEvidence,knowledgePoints};
    intake.model3d=Boolean(document.querySelector('#wq-model3d')?.checked);
    intake.combineWeakPoints=Boolean(document.querySelector('#wq-combine-weak')?.checked);
    const linkedWeakPoints=intake.combineWeakPoints?(state.wqWeakPoints||[]).filter(point=>knowledgePoints.some(tag=>{const name=point.knowledgePoint||point.microSkill||'';return tag&&name&&(tag.includes(name)||name.includes(tag))})).slice(0,5).map(point=>({id:point.id,knowledgePoint:point.knowledgePoint||point.microSkill||'',signal:point.signal||''})):[];
    const shouldBuild3d=String(subject||'').trim().startsWith('数学')&&intake.model3d&&/立体几何|空间几何|空间直角坐标系|二面角|线面角|线线角|点到平面距离|平面与平面/.test(question);
    intake.loading=true;intake.statusMessage=shouldBuild3d?'题目正在保存，随后会自动生成 3D 模型；建模期间请稍候。':'正在保存题目…';intake.error='';render();
    try {
      intake.retainSourceImage=Boolean(document.querySelector('#wq-retain-photo')?.checked);
      const result=await call('/v1/wrong-questions/drafts/'+encodeURIComponent(draft.id)+'/confirm',{question,handwriting,subject,errorCause,errorCauseEvidence,knowledgePoints,model3d:shouldBuild3d,retainSourceImage:intake.retainSourceImage,supplementalImageData:intake.supplementImageData,supplementImageName:intake.supplementImageName});
      const m=result.mistakeCase;
      if(linkedWeakPoints.length)m.relatedWeakPoints=linkedWeakPoints;
      state.mistakes=[m,...(state.mistakes||[]).filter(item=>item.id!==m.id)];
      state.focusMistakeId=m.id;state.libraryDetailId=m.id;state.tab='library';
      state.demo3DOnly=false;state.query='';state.subjectFilter='全部';state.libraryLimit=12;
      intake.dismissedDraftId=draft.id;intake.draft=null;intake.questionText='';intake.supplementImageData='';intake.supplementImageName='';intake.loading=false;intake.statusMessage='';state.wqPendingWeakLink=null;
      save();render();
      openTutorForCase(m.id);
      if(shouldBuild3d&&!m.geometryResult?.scene&&!['queued','building','failed'].includes(m.geometryBuildStatus))await ensureGeometryModel(m.id,question);
      if(m.geometryBuildStatus==='queued'||m.geometryBuildStatus==='building')watchGeometryBuild(m.id);
    } catch(error){intake.error=`入库未完成：${error.message}。修正内容已保留，可重试。`;intake.loading=false;intake.statusMessage='';render()}
  }
  function bindEntry(v) {
    v.querySelectorAll('[data-wq-mode]').forEach(button=>button.onclick=()=>{intake.mode=button.dataset.wqMode;intake.error='';if(intake.mode==='text')window.__wqLocalImage=null;save();render()});
    const text=v.querySelector('#wq-text');if(text)text.oninput=()=>{intake.questionText=text.value;save()};
    const submit=v.querySelector('#wq-preview');if(submit)submit.onclick=()=>preview({});
    const camera=v.querySelector('#wq-camera-file'),gallery=v.querySelector('#wq-gallery-file');
    if(camera){v.querySelector('#wq-camera').onclick=()=>camera.click();camera.onchange=()=>selectedPhoto(camera.files?.[0])}
    if(gallery){v.querySelector('#wq-gallery').onclick=()=>gallery.click();gallery.onchange=()=>selectedPhoto(gallery.files?.[0])}
    const attachment=v.querySelector('#wq-attachment-file');if(attachment){v.querySelector('#wq-attachment-pick').onclick=()=>attachment.click();attachment.onchange=()=>selectedSupplementPhoto(attachment.files?.[0]);const remove=v.querySelector('#wq-attachment-remove');if(remove)remove.onclick=()=>{intake.supplementImageData='';intake.supplementImageName='';save();render()}}
    const voice=v.querySelector('#wq-voice');if(voice)voice.onclick=()=>{
      const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!Speech){v.querySelector('#wq-voice-status').textContent='当前浏览器不支持语音识别，请使用键盘输入。';return}
      const recognition=new Speech();recognition.lang='zh-CN';recognition.interimResults=true;
      const base=intake.questionText||'';
      recognition.onresult=event=>{const transcript=Array.from(event.results).map(result=>result[0].transcript).join('');
        intake.questionText=[base,transcript].filter(Boolean).join(' ');text.value=intake.questionText;save()};
      recognition.onerror=event=>{v.querySelector('#wq-voice-status').textContent=`语音识别未完成（${event.error}），已保留文字，可继续输入。`};
      recognition.onend=()=>{voice.textContent='🎙️ 开始语音输入'};
      voice.textContent='聆听中…';recognition.start();
    };
    const confirmation=v.querySelector('#wq-confirm');if(confirmation)confirmation.onclick=confirm;
    const retryPhoto=v.querySelector('#wq-retry-photo');if(retryPhoto)retryPhoto.onclick=retryPhotoRecognition;
    const weak=v.querySelector('#wq-combine-weak');if(weak)weak.onchange=()=>{intake.combineWeakPoints=weak.checked;save();if(weak.checked)loadOwnWeakPoints();render()};
    const model=v.querySelector('#wq-model3d');if(model)model.onchange=()=>{intake.model3d=model.checked;save()};
    const retainPhoto=v.querySelector('#wq-retain-photo');if(retainPhoto)retainPhoto.onchange=()=>{intake.retainSourceImage=retainPhoto.checked;save()};
    const restart=v.querySelector('#wq-restart');if(restart)restart.onclick=()=>{intake.dismissedDraftId=intake.draft?.id;intake.draft=null;intake.error='';window.__wqLocalImage=null;save();render()};
  }
  const originalHome=renderHome;
  renderHome=function(v){originalHome(v);const panel=document.createElement('section');panel.className='panel wq-home';
    panel.innerHTML='<h2>从一道题开始</h2><p>拍下题目，或直接说出你卡住的地方。</p><div class="wq-entry-switch"><button data-wq-home="image">📷 拍照录入</button><button data-wq-home="text">✍️ 文字/语音录入</button></div>';
    v.prepend(panel);panel.querySelectorAll('[data-wq-home]').forEach(button=>button.onclick=()=>{intake.mode=button.dataset.wqHome;state.tab='upload';render()})};
  const originalUpload=renderUpload;
  renderUpload=function(v){originalUpload(v);if(state.autoReview?.status==='failed')intake.loading=false;v.className='work wq-upload-layout';const legacy=v.querySelector(':scope > .panel');if(legacy)legacy.classList.add('wq-legacy-engine');const review=v.querySelector('#auto-review-status')?.closest('.panel');if(review)review.classList.add('wq-legacy-review',...(review.querySelector('.supplement-panel')?['wq-review-actionable']:[]));const wrapper=document.createElement('div');wrapper.innerHTML=entryHtml();const panel=wrapper.firstElementChild;
    v.prepend(panel);bindEntry(panel);if(intake.combineWeakPoints)loadOwnWeakPoints();
    const draft=intake.draft;
    if(draft?.source==='image'&&draft.recognitionStatus==='needs_manual'&&!draft.preview?.question
        &&window.__wqAutoRetryId!==draft.id){window.__wqAutoRetryId=draft.id;setTimeout(retryPhotoRecognition,0)}
    if(!draft&&!window.__wqLatestDraftRequested){window.__wqLatestDraftRequested=true;setTimeout(restoreLatestPhotoDraft,0)}
  };
  const originalLibrary=renderLibrary;
  function openTutorForCase(caseId) {
    const card=Array.from(document.querySelectorAll('[data-mistake-id]'))
      .find(element=>element.dataset.mistakeId===caseId);
    card?.querySelector('details.tutor')?.setAttribute('open','');
  }
  const electricImageDataUrl=async(hash)=>{const token=window.__eduAuthSessionToken||state.apiToken,response=await fetch(apiBase()+'/v1/wrong-questions/images/'+encodeURIComponent(hash),{headers:token?{authorization:'Bearer '+token}:{}});if(!response.ok)throw new Error('题图读取失败');const blob=await response.blob();return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=reject;reader.readAsDataURL(blob)})};
  const compactImage=async(file)=>{if(!file||!/^image\//.test(file.type))throw new Error('请选择图片');const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.84)}finally{URL.revokeObjectURL(url)}};
  const fieldDefaults={mode:'points',charge:1,radius:1,sourceX:0,sourceY:0,charges:[{x:-1.15,y:0,q:1},{x:1.15,y:0,q:-1}],testX:0,testY:-.7,testCharge:1,showLines:true,showMotion:true};
  const safeFieldModel=model=>{const simulation={...fieldDefaults,...(model?.simulation||{})};simulation.charges=Array.isArray(simulation.charges)?simulation.charges.slice(0,8).filter(charge=>Number.isFinite(Number(charge?.x))&&Number.isFinite(Number(charge?.y))&&Number.isFinite(Number(charge?.q))).map(charge=>({x:Number(charge.x),y:Number(charge.y),q:Number(charge.q)})):fieldDefaults.charges.map(charge=>({...charge}));if(!simulation.charges.length)simulation.charges=fieldDefaults.charges.map(charge=>({...charge}));return{...model,simulation,calibrationLocked:model?.calibrationLocked===true,displayMode:model?.displayMode==='curves'?'curves':'panel',adjustedPotentialCurve:Array.isArray(model?.adjustedPotentialCurve)?model.adjustedPotentialCurve.slice(0,41):null,adjustedFieldCurve:Array.isArray(model?.adjustedFieldCurve)?model.adjustedFieldCurve.slice(0,41):Array.isArray(model?.adjustedCurve)?model.adjustedCurve.slice(0,41):null}};
  /* —— 追加：本题电场实验台 · 实验室按钮 + 分步高亮（不改动上面已有代码）—— */
  const efStepCache=new WeakMap();         // 每个题卡上一次 AI 返回的结构化步骤表（AI 上传时写入）
  const efDefaultDipole=()=>fieldDefaults.charges.map(charge=>({...charge}));
  const efTargetTypes=['scene','mode','charge','radius','testq','lines','point-sources','source-charge','curves','analyze','save','complete','edit','play','reset-dipole','reset-position','panel'];
  const efStepOps=['highlight','focus','set-mode','set-charge','set-radius','set-testq','set-lines','move-test','toggle-motion','reset-dipole','reset-position'];
  function efStepText(value,limit){return String(value??'').replace(/\s+/g,' ').trim().slice(0,limit)}
  function efStepTargets(step){const raw=Array.isArray(step?.targets)?step.targets:[step?.target];const list=[...new Set(raw.map(item=>efStepText(item,24)).filter(item=>efTargetTypes.includes(item)))];return list.length?list:['scene']}
  function efStepAction(step){const action=step?.action&&typeof step.action==='object'?step.action:null;if(!action||!efStepOps.includes(action.op))return null;
    const number=value=>Number.isFinite(Number(value))?Number(value):undefined;
    return{op:action.op,target:efStepText(action.target,24),value:number(action.value),text:efStepText(action.text,40),
      x:number(action.x),y:number(action.y),charge:efStepText(action.charge,8),show:typeof action.show==='boolean'?action.show:undefined}}
  const efFactoryCache=new WeakMap();      // 同一份步骤数组只归一化一次
  function efStepFactory(list){const raw=Array.isArray(list)?list:[];
    if(raw.length&&efFactoryCache.has(raw))return efFactoryCache.get(raw);
    const read=()=>efStepFactory.read(raw);
    if(raw.length)efFactoryCache.set(raw,read);
    return read}
  efStepFactory.read=raw=>(Array.isArray(raw)?raw:[]).slice(0,10).map((step,index)=>({id:efStepText(step?.id,32)||('step-'+(index+1)),title:efStepText(step?.title,64)||('第 '+(index+1)+' 步'),
    detail:efStepText(step?.detail,180),key:efStepText(step?.key,140),targets:efStepTargets(step),action:efStepAction(step)}));
  function efRenderSteps(root,factory,index){const rows=factory();const host=root.querySelector('[data-ef-guidance]');if(!host)return rows;
    host.dataset.efGuidanceStep=String(index);
    const output=rows.map((row,position)=>`<li class="ef-step-row${position===index?' active':''}"><div class="ef-step-head"><span class="ef-step-no">${position+1}</span><b>${escape(row.title)}</b>${position===index?'<span class="ef-step-flag">当前</span>':''}</div>${row.detail?`<p class="ef-step-detail">${escape(row.detail)}</p>`:''}${row.key?`<p class="ef-step-key">关键点：${escape(row.key)}</p>`:''}<p class="ef-step-target">高亮对象：${escape(row.targets.join(' · '))}</p></li>`).join('');
    host.innerHTML=`<div class="ef-mini-sources-head"><b>思维步骤表</b><span>${rows.length} 步 · 第 ${Math.min(index+1,rows.length||1)} 步</span></div><ol class="ef-steps">${output}</ol><div class="ef-mini-row ef-step-actions"><button type="button" data-ef-step-prev>◀ 上一步</button><button type="button" data-ef-step-run>高亮这一步</button><button type="button" data-ef-step-next>下一步 ▶</button><button type="button" data-ef-step-exit>退出高亮</button></div><p class="ef-step-status" data-ef-step-status aria-live="polite">${rows.length?'点「高亮这一步」在面板上依次点亮对应控件；也可以直接点上一步 / 下一步。':'AI 还没有返回步骤表，可点「AI分析题图/曲线」重新生成。'}</p>`;
    return rows}
  function efStepTarget(root,type,index){const list={scene:()=>root.querySelector('[data-ef-mini-scene]'),mode:()=>root.querySelector('[data-ef-mini-mode]'),charge:()=>root.querySelector('[data-ef-mini-charge]'),radius:()=>root.querySelector('[data-ef-mini-radius]'),testq:()=>root.querySelector('[data-ef-mini-testq]'),lines:()=>root.querySelector('[data-ef-mini-lines]'),'point-sources':()=>root.querySelector('[data-ef-mini-point-sources]'),'source-charge':()=>root.querySelector(`[data-ef-source-charge="${Number(index)||0}"]`)||root.querySelector('[data-ef-source-charge]'),curves:()=>root.querySelector('[data-ef-mini-curve-v]'),analyze:()=>root.querySelector('[data-ef-mini-analyze]'),save:()=>root.querySelector('[data-ef-mini-save]'),complete:()=>root.querySelector('[data-ef-mini-calibration-complete]'),edit:()=>root.querySelector('[data-ef-mini-edit]'),play:()=>root.querySelector('[data-ef-mini-play]'),'reset-dipole':()=>root.querySelector('[data-ef-mini-reset-dipole]'),'reset-position':()=>root.querySelector('[data-ef-mini-reset-position]'),panel:()=>root.closest('.ef-case-panel')||root};
    const pick=list[type];const element=pick?pick():null;return element instanceof Element?element:root}
  function efScrollContainer(from){let node=from;while(node&&node!==document.body){const style=getComputedStyle(node);if(/(auto|scroll|overlay)/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+8)return node;node=node.parentElement}return document.scrollingElement}
  function efFocusTarget(element){if(!element||typeof element.scrollIntoView!=='function')return;const box=efScrollContainer(element);if(box&&typeof box.scrollTo==='function'){const top=element.getBoundingClientRect().top-box.getBoundingClientRect().top+box.scrollTop-box.clientHeight/2+element.offsetHeight/2;box.scrollTo({top:Math.max(0,top),behavior:'smooth'})}else element.scrollIntoView({block:'center',behavior:'smooth'});
    element.classList.remove('ef-step-target-hit');void element.offsetWidth;element.classList.add('ef-step-target-hit');let ticks=0;const timer=setInterval(()=>{ticks+=1;if(ticks>6||!element.isConnected){clearInterval(timer);return}element.classList.add('ef-step-target-hit')},220)}
  /* AI 上传/分析接口的响应钩子：把结构化步骤表（guidanceSteps）缓存到对应题卡。
     这样无需改动 270 行起已有的 mountElectricMini / 识别按钮代码。 */
  (function hookElectricCompileSteps(){
    const originalFetch=window.fetch;
    if(typeof originalFetch!=='function'||window.__efStepFetchHooked)return;
    window.__efStepFetchHooked=true;
    window.fetch=async function(input,init){
      const response=await originalFetch.apply(this,arguments);
      try{
        const url=typeof input==='string'?input:(input&&input.url)||'';
        if(/\/v1\/electric-field\/compile(?:\?|$)/.test(url)&&response.ok){
          response.clone().json().then(result=>{
            const steps=Array.isArray(result?.guidanceSteps)?result.guidanceSteps:[];
            if(!steps.length)return;
            const roots=document.querySelectorAll('[data-ef-mini-root]');
            roots.forEach(node=>{efStepCache.set(node,steps);node.dispatchEvent(new CustomEvent('ef-mini-refresh',{bubbles:true}))});
          }).catch(()=>{});
        }
      }catch(_){}
      return response;
    };
  })();
  function installElectricMiniStepReset(){
    /* 迁移完整实验台：错题库里的电场面板直接用实验室那一套（electric-field-lab.js 的 __eduMountElectricLab）。
       不再用迷你画布，所以这里覆盖掉 mini 画布版本的 mountElectricMini。 */
    const efLabMounts=new WeakMap();
    const efRecordSimulation=model=>{const raw=model&&typeof model==='object'?model.simulation:null;if(!raw||typeof raw!=='object')return {};
      const sim={};for(const key of ['mode','testX','testY','testCharge','charge','radius','showLines']){if(raw[key]!==undefined&&raw[key]!==null)sim[key]=raw[key]}
      if(typeof sim.mode==='string'&&!['uniform','points','ring','shell','solid'].includes(sim.mode))delete sim.mode;
      sim.showMotion=raw.showMotion===true;return sim};
    mountElectricMini=function(card,record,model){
      const root=card.querySelector('[data-ef-mini-root]');if(!root)return;
      model=safeFieldModel(model);
      const mountLab=typeof window.__eduMountElectricLab==='function'?window.__eduMountElectricLab:null;
      root.innerHTML=`<div class="ef-mini-head"><div><strong>⚡ 本题电场实验台</strong><p>${escape(record.question||'')}</p></div><span class="ef-mini-status">${escape(model.status||'可交互')}</span></div><div data-ef-case-lab></div>`;
      if(!mountLab){const host=root.querySelector('[data-ef-case-lab]');if(host)host.innerHTML='<p class="muted">电场实验台尚未就绪（electric-field-lab.js 未加载），请刷新页面后重试。</p>';return}
      const remountLab=()=>{
        const live=(card.querySelector('[data-ef-mini-root]')||root);
        const old=live.querySelector('[data-ef-case-lab]');if(!old)return;
        const fresh=document.createElement('div');fresh.setAttribute('data-ef-case-lab','');
        const prev=efLabMounts.get(live);
        old.replaceWith(fresh);
        try{
          const liveState=(prev&&prev.state&&typeof prev.state==='object')?prev.state:efRecordSimulation(model);
          efLabMounts.set(live,mountLab(fresh,{panel:true,persist:false,storageKey:'educompanion:electric-lab:inline',render:remountLab,state:liveState}));
        }catch(error){fresh.innerHTML='<p class="muted">电场实验台重画失败：'+escape(error.message)+'</p>'}
      };
      let instance=null;
      try{
        instance=mountLab(root.querySelector('[data-ef-case-lab]'),{panel:true,persist:false,storageKey:'educompanion:electric-lab:inline',render:remountLab,state:efRecordSimulation(model)});
      }catch(error){const host=root.querySelector('[data-ef-case-lab]');if(host)host.innerHTML=`<p class="muted">电场实验台挂载失败：${escape(error.message)}</p>`;return}
      efLabMounts.set(root,instance);
    };
  }
  if(typeof window!=='undefined')window.__efStepModel=model=>({steps:Array.isArray(model?.guidanceSteps)?model.guidanceSteps:[],source:model?._efStepsFrom||'(none)',detail:model?._efStepsDetail||''});
  const efPatchedRoots=new WeakSet();   // 同一块题卡面板只补一次，避免重复追加按钮
  function installElectricMiniLab(card,record,root,model){
    if(efPatchedRoots.has(root))return null;
    efPatchedRoots.add(root);
    let liveRoot=root;
    const activeRoot=()=>{if(liveRoot&&liveRoot.isConnected)return liveRoot;const found=card.querySelector('[data-ef-mini-root]');if(found)liveRoot=found;return liveRoot||root};
    const by=selector=>activeRoot().querySelector(selector);
    const sim=model.simulation||{};
    const locked=()=>activeRoot().classList.contains('calibration-locked');
    const status=text=>{const node=by('[data-ef-mini-status]');if(node)node.textContent=text};
    const setStepStatus=text=>{const node=by('[data-ef-step-status]');if(node)node.textContent=text};
    let current=0;
    const factory=efStepFactory(efStepCache.get(root));
    const guidance=document.createElement('section');guidance.className='ef-mini-guidance';guidance.dataset.efGuidance='';
    const anchor=by('[data-ef-mini-point-sources]');
    if(anchor)anchor.after(guidance);else by('.ef-mini-controls')?.prepend(guidance);
    efRenderSteps(activeRoot(),factory,current);
    const actions=document.createElement('div');actions.className='ef-mini-row ef-lab-actions';
    const resetDipole=document.createElement('button'),resetPosition=document.createElement('button');
    resetDipole.type=resetPosition.type='button';resetDipole.dataset.efMiniResetDipole='';resetPosition.dataset.efMiniResetPosition='';
    resetDipole.textContent='⟲ 恢复电偶极';resetPosition.textContent='⌖ 回到初始位置';
    resetDipole.title='把两个点电荷恢复到实验室的标准电偶极子（左 +q、右 −q，对称摆放）';
    resetPosition.title='把试探电荷放回出发点，并把理论运动暂停在 t=0';
    actions.append(resetDipole,resetPosition);
    by('.ef-mini-controls')?.append(actions);
    const isPlaying=()=>{const play=by('[data-ef-mini-play]');return Boolean(play&&play.textContent.includes('暂停'))};
    const stopMotion=()=>{sim.playing=false;sim.motionProgress=0;const play=by('[data-ef-mini-play]');if(play){play.disabled=false;play.textContent='↻ 重播理论运动'}};
    const needUnlock=()=>{if(!locked())return false;status('本题模型已确认完成调制；请先点「编辑电场」解锁，再修改实验台。');setStepStatus('已确认状态只读：先点「编辑电场」解锁，再改参数。');return true};
    const resetDipoleRun=()=>{if(needUnlock())return false;
      sim.charges=efDefaultDipole();sim.mode='points';sim.testCharge=1;model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;model.adjustedCurve=null;
      const mode=by('[data-ef-mini-mode]');if(mode)mode.value='points';
      const testq=by('[data-ef-mini-testq]');if(testq)testq.value='1';
      window.dispatchEvent(new CustomEvent('ef-mini-dipole-reset',{bubbles:true,detail:{caseId:record.id}}));
      status('已恢复标准电偶极：左 +q、右 −q，各 1 个电荷、左右对称。');
      setStepStatus('已恢复电偶极：场源回到初始对称位置。');return true};
    const resetPositionRun=()=>{stopMotion();sim.testX=fieldDefaults.testX;sim.testY=fieldDefaults.testY;
      const curve=by('[data-ef-mini-curve-t]');if(curve)curve.removeAttribute('data-ef-progress');
      window.dispatchEvent(new CustomEvent('ef-mini-position-reset',{bubbles:true,detail:{caseId:record.id}}));
      status('试探电荷已回到初始位置（'+Number(fieldDefaults.testX).toFixed(2)+'，'+Number(fieldDefaults.testY).toFixed(2)+'），理论运动暂停在 t=0。');
      setStepStatus('已回到初始位置：试探电荷复位，运动回到 t=0。');return true};
    const applyAction=action=>{if(!action)return null;
      if(action.op==='set-mode'&&['uniform','points','ring','shell','solid'].includes(action.text)){sim.mode=action.text;model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;const select=by('[data-ef-mini-mode]');if(select)select.value=sim.mode;return'set-mode'}
      if(action.op==='set-charge'&&Number.isFinite(action.value)){sim.charge=Math.max(-3,Math.min(3,action.value));const input=by('[data-ef-mini-charge]');if(input)input.value=String(sim.charge);return'set-charge'}
      if(action.op==='set-radius'&&Number.isFinite(action.value)){sim.radius=Math.max(.3,Math.min(1.5,action.value));model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;const input=by('[data-ef-mini-radius]');if(input)input.value=String(sim.radius);return'set-radius'}
      if(action.op==='set-testq'){sim.testCharge=(action.charge&&/-|−|minus/.test(action.charge))||action.value===-1?-1:1;const select=by('[data-ef-mini-testq]');if(select)select.value=String(sim.testCharge);return'set-testq'}
      if(action.op==='set-lines'){sim.showLines=action.show!==false;const box=by('[data-ef-mini-lines]');if(box)box.checked=sim.showLines;return'set-lines'}
      if(action.op==='move-test'){if(Number.isFinite(action.x))sim.testX=action.x;if(Number.isFinite(action.y))sim.testY=action.y;return'move-test'}
      if(action.op==='toggle-motion'){if(action.show===false){stopMotion();return'motion-pause'}sim.motionProgress=0;const play=by('[data-ef-mini-play]');if(play&&!isPlaying()&&!play.disabled)play.click();return'motion-play'}
      if(action.op==='reset-dipole'){return resetDipoleRun()?'reset-dipole':null}
      if(action.op==='reset-position'){return resetPositionRun()?'reset-position':null}
      return null};
    const stepTargetElement=row=>{const action=row.action||{};const type=action.target||row.targets[0]||'scene';return efStepTarget(activeRoot(),type,action.value)};
    const runStep=index=>{const rows=factory();
      if(!rows.length){setStepStatus('还没有步骤表：点「AI分析题图/曲线」让 AI 生成「每步 + 关键点 + 该动哪个控件」。');return}
      current=Math.max(0,Math.min(rows.length-1,Number.isFinite(index)?index:0));const row=rows[current];
      const applied=locked()?null:applyAction(row.action);
      efFocusTarget(stepTargetElement(row));
      setStepStatus('第 '+(current+1)+'/'+rows.length+' 步 · '+row.title+(row.key?'（关键点：'+row.key+'）':'')+(applied?'［已同步参数］':'')+(locked()?'［已确认状态，仅高亮不改参数］':''));
      repaintSteps()};
    function bindStepControls(){const host=activeRoot().querySelector('[data-ef-guidance]');if(!host)return;
      host.querySelectorAll('.ef-step-row').forEach((row,position)=>{row.onclick=()=>runStep(position)});
      host.querySelector('[data-ef-step-prev]')?.addEventListener('click',()=>runStep(current-1));
      host.querySelector('[data-ef-step-next]')?.addEventListener('click',()=>runStep(current+1));
      host.querySelector('[data-ef-step-run]')?.addEventListener('click',()=>runStep(current));
      host.querySelector('[data-ef-step-exit]')?.addEventListener('click',()=>{activeRoot().querySelectorAll('.ef-step-target-hit').forEach(node=>node.classList.remove('ef-step-target-hit'));setStepStatus('已退出分步高亮；步骤表保留，可随时重新开始。')})}
    function repaintSteps(){efRenderSteps(activeRoot(),factory,current);bindStepControls()}
    resetDipole.addEventListener('click',()=>{resetDipoleRun();repaintSteps()});
    resetPosition.addEventListener('click',()=>{resetPositionRun();repaintSteps()});
    bindStepControls();
    document.addEventListener('ef-mini-refresh',event=>{if(!liveRoot.isConnected)return;if(!(event.target instanceof Node)||!card.contains(event.target))return;if(!factory().length)return;repaintSteps()});
    return{runStep,repaintSteps}};
  installElectricMiniStepReset();
  function drawElectricMini(root,record,model){
    const scene=root.querySelector('[data-ef-mini-scene]'),potentialCanvas=root.querySelector('[data-ef-mini-curve-v]'),fieldCanvas=root.querySelector('[data-ef-mini-curve-e]'),timeCanvas=root.querySelector('[data-ef-mini-curve-t]');
    if(!scene||!potentialCanvas||!fieldCanvas||!timeCanvas)return;
    const fit=canvas=>{const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);if(!rect.width||!rect.height)return null;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w:rect.width,h:rect.height}};
    const sim=model.simulation,layout=fit(scene);if(!layout)return;
    const{ctx,w,h}=layout,ox=w/2,oy=h/2,s=Math.min((w-56)/5.5,(h-50)/3.6),px=x=>ox+x*s,py=y=>oy-y*s;
    const baseField=(x,y)=>{if(sim.mode==='uniform')return{ex:sim.charge,ey:0};if(sim.mode==='points')return sim.charges.reduce((field,charge)=>{const dx=x-charge.x,dy=y-charge.y,d=Math.max(.15,Math.hypot(dx,dy));field.ex+=charge.q*dx/d**3;field.ey+=charge.q*dy/d**3;return field},{ex:0,ey:0});const dx=x-(sim.sourceX||0),dy=y-(sim.sourceY||0);if(sim.mode==='ring'){const d=Math.sqrt(dx*dx+dy*dy+sim.radius*sim.radius);return{ex:sim.charge*dx/d**3,ey:sim.charge*dy/d**3}}const r=Math.hypot(dx,dy)||.001,E=sim.mode==='shell'?(r<sim.radius?0:sim.charge/r**2):(r<sim.radius?sim.charge*r/sim.radius**3:sim.charge/r**2);return{ex:E*dx/r,ey:E*dy/r}};
    const sample=(values,x)=>{const at=Math.max(0,Math.min(40,(x+2.5)/5*40)),i=Math.floor(at),j=Math.min(40,i+1),t=at-i;return values[i]*(1-t)+values[j]*t};
    const fieldProfile=model.adjustedFieldCurve;
    const field=(x,y)=>{const value=baseField(x,y);if(Array.isArray(fieldProfile)&&fieldProfile.length===41)value.ex=sample(fieldProfile,x);return value};
    const potentialProfile=Array.isArray(model.adjustedPotentialCurve)&&model.adjustedPotentialCurve.length===41?model.adjustedPotentialCurve:(()=>{const raw=Array.from({length:41},(_,i)=>{const x=-2.5+i*.125;if(sim.mode==='uniform')return-sim.charge*x;if(sim.mode==='points')return sim.charges.reduce((sum,charge)=>sum+charge.q/Math.sqrt((x-charge.x)**2+charge.y**2+.03),0);return sim.charge/Math.sqrt((x-(sim.sourceX||0))**2+(sim.sourceY||0)**2+sim.radius**2)}),scale=Math.max(.01,...raw.map(value=>Math.abs(value)));return raw.map(value=>value/scale*.36)})();
    model.adjustedPotentialCurve=potentialProfile;
    ctx.fillStyle='#fbfdff';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#e7edf5';ctx.lineWidth=1;
    for(let x=-2.5;x<=2.5;x+=.5){ctx.beginPath();ctx.moveTo(px(x),16);ctx.lineTo(px(x),h-16);ctx.stroke()}
    for(let y=-1.5;y<=1.5;y+=.5){ctx.beginPath();ctx.moveTo(20,py(y));ctx.lineTo(w-20,py(y));ctx.stroke()}
    ctx.strokeStyle='#7185a1';ctx.beginPath();ctx.moveTo(20,oy);ctx.lineTo(w-16,oy);ctx.moveTo(ox,h-14);ctx.lineTo(ox,14);ctx.stroke();ctx.fillStyle='#526784';ctx.font='12px system-ui';ctx.fillText('x',w-17,oy-7);ctx.fillText('y',ox+7,17);
    if(sim.showLines){ctx.strokeStyle='#3973ddaa';ctx.lineWidth=1.5;const seeds=sim.mode==='points'?sim.charges.filter(charge=>charge.q>0).flatMap(charge=>Array.from({length:12},(_,index)=>({charge,angle:index*Math.PI/6,dir:1}))):Array.from({length:12},(_,index)=>({charge:{x:sim.sourceX||0,y:sim.sourceY||0,q:sim.charge},angle:index*Math.PI/6,dir:Math.sign(sim.charge)||1}));for(const seed of seeds){const sign=seed.dir;let x=seed.charge.x+Math.cos(seed.angle)*.13,y=seed.charge.y+Math.sin(seed.angle)*.13;ctx.beginPath();ctx.moveTo(px(x),py(y));for(let i=0;i<100;i++){const f=field(x,y),m=Math.max(.001,Math.hypot(f.ex,f.ey));x+=f.ex/m*.035*sign;y+=f.ey/m*.035*sign;if(Math.abs(x)>2.7||Math.abs(y)>1.7)break;if(sim.mode==='points'&&sim.charges.some(charge=>charge.q<0&&Math.hypot(charge.x-x,charge.y-y)<.1))break;ctx.lineTo(px(x),py(y))}ctx.stroke()}}
    if(sim.mode==='uniform'){ctx.fillStyle='#dce5f1';ctx.fillRect(px(-2.2),py(1.2),8,2.4*s);ctx.fillRect(px(2.2)-8,py(1.2),8,2.4*s);ctx.fillStyle='#37517a';ctx.fillText('+',px(-2.2)-12,oy);ctx.fillText('−',px(2.2)+5,oy)}else if(sim.mode==='points'){for(const charge of sim.charges){ctx.beginPath();ctx.arc(px(charge.x),py(charge.y),15,0,Math.PI*2);ctx.fillStyle=charge.q>0?'#d94949':'#386bd5';ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 17px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(charge.q>0?'+':'−',px(charge.x),py(charge.y));ctx.textAlign='left';ctx.textBaseline='alphabetic'}}else{ctx.beginPath();ctx.arc(px(sim.sourceX||0),py(sim.sourceY||0),sim.radius*s,0,Math.PI*2);ctx.fillStyle='#ffd85d55';ctx.fill();ctx.strokeStyle='#bf922c';ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(px(sim.sourceX||0),py(sim.sourceY||0),5,0,Math.PI*2);ctx.fillStyle='#b44747';ctx.fill();ctx.fillStyle='#b44747';ctx.fillText(sim.charge<0?'−Q':'+Q',px(sim.sourceX||0)+7,py(sim.sourceY||0)-7)}
    const trajectory=[];let tx=sim.testX,ty=sim.testY,vx=.04,vy=0;trajectory.push({x:tx,y:ty});for(let i=0;i<80;i++){const a=field(tx,ty);vx+=a.ex*.0008*sim.testCharge;vy+=a.ey*.0008*sim.testCharge;tx+=vx*.045;ty+=vy*.045;if(Math.abs(tx)>2.6||Math.abs(ty)>1.65)break;trajectory.push({x:tx,y:ty})}
    if(sim.showMotion&&trajectory.length>1){ctx.strokeStyle='#de8241';ctx.lineWidth=2;ctx.beginPath();trajectory.forEach((point,index)=>index?ctx.lineTo(px(point.x),py(point.y)):ctx.moveTo(px(point.x),py(point.y)));ctx.stroke()}
    const particle=trajectory.length?trajectory[Math.min(trajectory.length-1,Math.floor((sim.motionProgress||0)*(trajectory.length-1)))]:{x:sim.testX,y:sim.testY},x=particle.x,y=particle.y,f=field(x,y),m=Math.hypot(f.ex,f.ey)||1,fieldDx=f.ex/m*35,fieldDy=-f.ey/m*35;
    ctx.beginPath();ctx.arc(px(x),py(y),9,0,Math.PI*2);ctx.fillStyle=sim.testCharge>0?'#f1b443':'#aa7bd2';ctx.fill();ctx.fillStyle='#24344d';ctx.font='bold 11px system-ui';ctx.fillText(sim.testCharge>0?'+q₀':'−q₀',px(x)+11,py(y)-7);ctx.strokeStyle='#26775e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px(x),py(y));ctx.lineTo(px(x)+fieldDx,py(y)+fieldDy);ctx.stroke();ctx.fillStyle='#26775e';ctx.fillText('E',px(x)+fieldDx+3,py(y)+fieldDy);ctx.strokeStyle='#df762d';ctx.beginPath();ctx.moveTo(px(x),py(y));ctx.lineTo(px(x)+fieldDx*sim.testCharge,py(y)+fieldDy*sim.testCharge);ctx.stroke();ctx.fillStyle='#bf5d1e';ctx.fillText('F',px(x)+fieldDx*sim.testCharge+3,py(y)+fieldDy*sim.testCharge);
    const paintCurve=(canvas,values,color,label,editable)=>{const box=fit(canvas);if(!box)return;const c=box.ctx,cw=box.w,ch=box.h;c.fillStyle='#fff';c.fillRect(0,0,cw,ch);c.strokeStyle='#e0e8f2';c.beginPath();c.moveTo(24,ch/2);c.lineTo(cw-12,ch/2);c.moveTo(24,10);c.lineTo(24,ch-12);c.stroke();c.fillStyle='#526784';c.font='12px system-ui';c.fillText(label,5,12);c.fillText('x',cw-17,ch-4);c.strokeStyle=color;c.lineWidth=2.5;c.beginPath();values.forEach((value,i)=>{const xx=24+i*(cw-40)/(values.length-1),yy=ch/2-Math.max(-.44,Math.min(.44,Number(value)||0))*(ch*.92);i?c.lineTo(xx,yy):c.moveTo(xx,yy)});c.stroke();if(editable){c.fillStyle=color;values.forEach((value,i)=>{if(i%4)return;c.beginPath();c.arc(24+i*(cw-40)/(values.length-1),ch/2-value*(ch*.92),4,0,Math.PI*2);c.fill()})}};
    const fieldValues=fieldProfile||Array.from({length:41},(_,i)=>{const value=baseField(-2.5+i*.125,sim.testY).ex;return Math.max(-.44,Math.min(.44,value*.15))});
    paintCurve(potentialCanvas,potentialProfile,'#d88a36','V(x)',!model.calibrationLocked);
    paintCurve(fieldCanvas,fieldValues,'#27866b','Eₓ(x)',!model.calibrationLocked);
    const timeValues=trajectory.map((point,index)=>point.x),timeBox=fit(timeCanvas);if(timeBox){const c=timeBox.ctx,tw=timeBox.w,th=timeBox.h;c.fillStyle='#fff';c.fillRect(0,0,tw,th);c.strokeStyle='#e0e8f2';c.beginPath();c.moveTo(24,th/2);c.lineTo(tw-12,th/2);c.moveTo(24,10);c.lineTo(24,th-12);c.stroke();c.fillStyle='#526784';c.font='12px system-ui';c.fillText('x(t)',5,12);c.fillText('t',tw-17,th-4);const lo=Math.min(...timeValues),hi=Math.max(...timeValues);c.strokeStyle='#3369e8';c.lineWidth=2.5;c.beginPath();timeValues.forEach((value,i)=>{const xx=24+i*(tw-40)/Math.max(1,timeValues.length-1),yy=th-14-(value-lo)/Math.max(.01,hi-lo)*(th-28);i?c.lineTo(xx,yy):c.moveTo(xx,yy)});c.stroke();if(Number.isFinite(sim.motionProgress)){const xx=24+(sim.motionProgress||0)*(tw-40);c.strokeStyle='#253b5b';c.setLineDash([3,3]);c.beginPath();c.moveTo(xx,8);c.lineTo(xx,th-12);c.stroke();c.setLineDash([])}}
  }
  async function saveElectricModel(record,model,imageData='',fileName=''){
    const token=window.__eduAuthSessionToken||state.apiToken,response=await fetch(apiBase()+'/v1/mistake-cases/'+encodeURIComponent(record.id)+'/electric-field-model',{method:'PATCH',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({model,...(imageData?{imageData,fileName}:{})})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||body.error||'模型保存失败');const updated=body.mistakeCase;state.mistakes=(state.mistakes||[]).map(item=>item.id===record.id?{...item,...updated}:item);if(Array.isArray(state.__serverMistakes))state.__serverMistakes=state.__serverMistakes.map(item=>item.id===record.id?{...item,...updated}:item);save();return updated;
  }
  function mountElectricMini(card,record,model){
    const root=card.querySelector('[data-ef-mini-root]');if(!root)return;model=safeFieldModel(model);const sim=model.simulation;
    root.innerHTML=`<div class="ef-mini-head"><div><strong>⚡ 本题电场实验台</strong><p>${model.calibrationLocked?'已完成调制；可继续拖动电荷观察场线变化。':'已迁入电场实验台：支持双点电荷叠加、试探电荷拖动和曲线调制。'}</p></div><span class="ef-mini-status" data-ef-mini-status>${escape(model.calibrationLocked?'已确认 · 随本题保存':model.graphAnalysis?'已识别候选，待核对':model.status||'待调制')}</span></div><div class="ef-mini-layout"><div class="ef-mini-visual"><div class="ef-mini-source">${record.sourceImage?.hash?`<img src="${apiBase()}/v1/wrong-questions/images/${encodeURIComponent(record.sourceImage.hash)}" alt="原题图片" loading="lazy">`:''}${model.supplementaryImage?.hash?`<img src="${apiBase()}/v1/wrong-questions/images/${encodeURIComponent(model.supplementaryImage.hash)}" alt="补充题图" loading="lazy">`:''}</div><div><canvas data-ef-mini-scene aria-label="可拖动的正负点电荷与试探电荷"></canvas><small>拖动正、负点电荷或试探电荷</small></div></div><section class="ef-mini-controls"><div class="ef-mini-row"><label>模型<select data-ef-mini-mode><option value="uniform">匀强电场/平行板</option><option value="points">点电荷与叠加</option><option value="ring">带电圆环轴线</option><option value="shell">带电球壳</option><option value="solid">均匀带电实心球</option></select></label><label data-ef-mini-single-charge>场源电荷 <input data-ef-mini-charge type="range" min="-3" max="3" step="0.1"></label><label>半径 <input data-ef-mini-radius type="range" min="0.3" max="1.5" step="0.05"></label><label>试探电荷<select data-ef-mini-testq><option value="1">正电荷 +q₀</option><option value="-1">负电荷 −q₀</option></select></label></div><div data-ef-mini-point-sources></div><div class="ef-mini-row"><label><input type="checkbox" data-ef-mini-lines> 显示场线</label><button type="button" data-ef-mini-analyze>AI分析题图/曲线</button><button type="button" class="primary" data-ef-mini-save>保存本题模型</button></div><div class="ef-mini-graph"><canvas data-ef-mini-curve aria-label="可拖动编辑的电场曲线"></canvas><small>拖动 V(x) 或 Eₓ(x) 校准；拖动 x(t) 可查看对应的理论运动位置。</small></div></section></div>`;
    const by=s=>root.querySelector(s),setStatus=text=>{if(by('[data-ef-mini-status]'))by('[data-ef-mini-status]').textContent=text};
    const firstCurve=by('[data-ef-mini-curve]'),graph=firstCurve?.closest('.ef-mini-graph'),hint=graph?.querySelector('small'),dragHint=root.querySelector('.ef-mini-visual small');
    firstCurve?.setAttribute('data-ef-mini-curve-v','');firstCurve?.setAttribute('aria-label','电势随位置 V(x)，可拖动校准');
    const fieldCurve=firstCurve.cloneNode(false),timeCurve=firstCurve.cloneNode(false);fieldCurve.removeAttribute('data-ef-mini-curve');timeCurve.removeAttribute('data-ef-mini-curve');fieldCurve.setAttribute('data-ef-mini-curve-e','');fieldCurve.setAttribute('aria-label','场强随位置 Eₓ(x)，可拖动校准');timeCurve.setAttribute('data-ef-mini-curve-t','');timeCurve.setAttribute('aria-label','位置随时间 x(t)，拖动可查看进度');
    firstCurve.after(fieldCurve,timeCurve);if(hint)hint.textContent='拖动橙色 V(x) 或绿色 Eₓ(x) 曲线校准；拖动蓝色 x(t) 可查看对应运动位置。';
    by('[data-ef-mini-motion]')?.closest('label')?.remove();
    const editButton=document.createElement('button'),completeButton=document.createElement('button'),playButton=document.createElement('button');
    editButton.type=completeButton.type=playButton.type='button';editButton.dataset.efMiniEdit='';completeButton.dataset.efMiniCalibrationComplete='';playButton.dataset.efMiniPlay='';
    editButton.textContent='编辑电场';completeButton.textContent='确定完成调制';playButton.textContent='▶ 播放理论运动';completeButton.className='primary';
    const actionRow=document.createElement('div');actionRow.className='ef-mini-row ef-calibration-actions';actionRow.append(completeButton,editButton,playButton);by('.ef-mini-controls').append(actionRow);
    const viewSwitch=document.createElement('div');viewSwitch.className='ef-mini-view-switch';viewSwitch.dataset.efMiniViewSwitch='';viewSwitch.innerHTML='<b>确认后显示</b><button type="button" data-ef-mini-view="panel">完整实验面板</button><button type="button" data-ef-mini-view="curves">只看曲线</button>';by('.ef-mini-controls').append(viewSwitch);
    by('[data-ef-mini-mode]').value=sim.mode;by('[data-ef-mini-charge]').value=sim.charge;by('[data-ef-mini-radius]').value=sim.radius;by('[data-ef-mini-testq]').value=sim.testCharge;by('[data-ef-mini-lines]').checked=sim.showLines;
    let dragging=false,animationFrame=0,miniFrame=0;const scene=by('[data-ef-mini-scene]');
    const render=()=>{if(miniFrame)return;miniFrame=requestAnimationFrame(()=>{miniFrame=0;if(root.isConnected)drawElectricMini(root,record,model)})};
    render();
    const pointSources=by('[data-ef-mini-point-sources]');
    const paintPointSources=()=>{pointSources.hidden=sim.mode!=='points';by('[data-ef-mini-single-charge]').hidden=sim.mode==='points';pointSources.innerHTML=sim.mode!=='points'?'':`<div class="ef-mini-sources-head"><b>点电荷与叠加</b><span>${sim.charges.length} 个场源</span></div>${sim.charges.map((charge,index)=>`<div class="ef-mini-source-row"><b class="${charge.q<0?'negative':'positive'}">${charge.q<0?'−':'+'}</b><label>q${index+1} <output data-ef-source-output="${index}">${charge.q>0?'+':''}${charge.q.toFixed(1)}</output><input data-ef-source-charge="${index}" type="range" min="-3" max="3" step="0.1" value="${charge.q}"></label><button type="button" data-ef-source-remove="${index}" aria-label="移除点电荷 ${index+1}" ${sim.charges.length<2?'disabled':''}>×</button></div>`).join('')}<div class="ef-mini-row"><button type="button" data-ef-source-add="1" ${sim.charges.length>=8?'disabled':''}>＋ 添加正电荷</button><button type="button" data-ef-source-add="-1" ${sim.charges.length>=8?'disabled':''}>− 添加负电荷</button></div>`;
      pointSources.querySelectorAll('[data-ef-source-charge]').forEach(input=>input.oninput=event=>{if(model.calibrationLocked)return;const index=Number(event.target.dataset.efSourceCharge),charge=sim.charges[index];charge.q=Number(event.target.value);pointSources.querySelector(`[data-ef-source-output="${index}"]`).textContent=`${charge.q>0?'+':''}${charge.q.toFixed(1)}`;const marker=event.target.closest('.ef-mini-source-row').querySelector('b');marker.textContent=charge.q<0?'−':'+';marker.classList.toggle('negative',charge.q<0);marker.classList.toggle('positive',charge.q>=0);model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;render()});
      pointSources.querySelectorAll('[data-ef-source-remove]').forEach(button=>button.onclick=()=>{if(model.calibrationLocked||sim.charges.length<2)return;sim.charges.splice(Number(button.dataset.efSourceRemove),1);model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;paintPointSources();render()});
      pointSources.querySelectorAll('[data-ef-source-add]').forEach(button=>button.onclick=()=>{if(model.calibrationLocked||sim.charges.length>=8)return;const index=sim.charges.length;sim.charges.push({x:(index%2?1:-1)*(0.8+Math.floor(index/2)*.25),y:Math.floor(index/2)*.45,q:Number(button.dataset.efSourceAdd)});model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;paintPointSources();render()});
    };
    paintPointSources();
    const setCalibrationUI=()=>{const locked=model.calibrationLocked===true;for(const control of root.querySelectorAll('[data-ef-mini-mode],[data-ef-mini-charge],[data-ef-mini-radius],[data-ef-mini-testq],[data-ef-mini-lines],[data-ef-mini-analyze],[data-ef-mini-save],[data-ef-source-charge],[data-ef-source-remove],[data-ef-source-add]'))control.disabled=locked||(control.hasAttribute('data-ef-source-remove')&&sim.charges.length<2)||(control.hasAttribute('data-ef-source-add')&&sim.charges.length>=8);scene.style.pointerEvents='auto';scene.style.cursor='grab';for(const curve of [firstCurve,fieldCurve])curve.style.pointerEvents=locked?'none':'auto';completeButton.hidden=locked;editButton.hidden=!locked;playButton.hidden=!locked;playButton.disabled=sim.playing;viewSwitch.hidden=!locked;viewSwitch.querySelectorAll('[data-ef-mini-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.efMiniView===model.displayMode)));root.classList.toggle('calibration-locked',locked);root.classList.toggle('curves-only',locked&&model.displayMode==='curves')};
    setCalibrationUI();
    by('[data-ef-mini-mode]').onchange=e=>{if(model.calibrationLocked)return;sim.mode=e.target.value;model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;paintPointSources();render()};by('[data-ef-mini-charge]').oninput=e=>{if(model.calibrationLocked)return;sim.charge=Number(e.target.value);render()};by('[data-ef-mini-radius]').oninput=e=>{if(model.calibrationLocked)return;sim.radius=Number(e.target.value);model.adjustedFieldCurve=null;model.adjustedPotentialCurve=null;render()};by('[data-ef-mini-testq]').onchange=e=>{if(model.calibrationLocked)return;sim.testCharge=Number(e.target.value);render()};by('[data-ef-mini-lines]').onchange=e=>{if(model.calibrationLocked)return;sim.showLines=e.target.checked;render()};
    let dragTarget='test',dragSourceIndex=-1;const moveScenePoint=e=>{const r=scene.getBoundingClientRect(),s=Math.min((r.width-56)/5.5,(r.height-50)/3.6),x=Math.max(-2.5,Math.min(2.5,(e.clientX-r.left-r.width/2)/s)),y=Math.max(-1.55,Math.min(1.55,(r.height/2-(e.clientY-r.top))/s));if(dragTarget==='source'&&sim.mode==='points'&&sim.charges[dragSourceIndex]){sim.charges[dragSourceIndex].x=x;sim.charges[dragSourceIndex].y=y}else if(dragTarget==='source'){sim.sourceX=x;sim.sourceY=y}else{sim.testX=x;sim.testY=y}render()};scene.onpointerdown=e=>{e.preventDefault();const r=scene.getBoundingClientRect(),s=Math.min((r.width-56)/5.5,(r.height-50)/3.6),x=(e.clientX-r.left-r.width/2)/s,y=(r.height/2-(e.clientY-r.top))/s;dragSourceIndex=sim.mode==='points'?sim.charges.findIndex(charge=>Math.hypot(x-charge.x,y-charge.y)<.34):-1;dragTarget=sim.mode!=='uniform'&&(dragSourceIndex>=0||Math.hypot(x-(sim.sourceX||0),y-(sim.sourceY||0))<.28)?'source':'test';dragging=true;scene.setPointerCapture(e.pointerId);moveScenePoint(e)};scene.onpointermove=e=>{if(dragging)moveScenePoint(e)};const finishSceneDrag=async()=>{if(!dragging)return;dragging=false;if(!model.calibrationLocked)return;if(dragHint)dragHint.textContent='正在保存电荷位置…';try{const saved=await saveElectricModel(record,{...model,simulation:sim});record.electricFieldModel=saved.electricFieldModel;if(dragHint)dragHint.textContent='拖动正、负点电荷或试探电荷';}catch(error){if(dragHint)dragHint.textContent=`位置未保存：${error.message}`}};scene.onpointerup=scene.onpointercancel=finishSceneDrag;
    const updateCurve=(curve,kind,e)=>{if(model.calibrationLocked)return;const r=curve.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left-24)/(r.width-40))),index=Math.round(x*40),value=Math.max(-.44,Math.min(.44,(r.height/2-(e.clientY-r.top))/(r.height*.92)));if(kind==='potential'){model.adjustedPotentialCurve=model.adjustedPotentialCurve||Array.from({length:41},(_,i)=>Math.sin(i/40*Math.PI*2)*.18);model.adjustedPotentialCurve[index]=value;model.adjustedFieldCurve=Array.from({length:41},(_,i)=>{const left=model.adjustedPotentialCurve[Math.max(0,i-1)],right=model.adjustedPotentialCurve[Math.min(40,i+1)];return Math.max(-.44,Math.min(.44,-(right-left)/(i===0||i===40?.125:.25)))})}else{model.adjustedFieldCurve=model.adjustedFieldCurve||Array.from({length:41},(_,i)=>Math.max(-.44,Math.min(.44,(sim.charge||1)*.15)));model.adjustedFieldCurve[index]=value;const anchor=model.adjustedPotentialCurve?.[0]||0;model.adjustedPotentialCurve=[anchor];for(let i=1;i<41;i++)model.adjustedPotentialCurve.push(model.adjustedPotentialCurve[i-1]-(model.adjustedFieldCurve[i-1]+model.adjustedFieldCurve[i])*.0625)}render()};
    const bindCurve=(curve,kind)=>{curve.onpointerdown=e=>{if(model.calibrationLocked)return;curve.setPointerCapture(e.pointerId);updateCurve(curve,kind,e)};curve.onpointermove=e=>{if(curve.hasPointerCapture(e.pointerId))updateCurve(curve,kind,e)};curve.onpointerup=curve.onpointercancel=()=>{}};bindCurve(firstCurve,'potential');bindCurve(fieldCurve,'field');
    timeCurve.onpointerdown=e=>{const r=timeCurve.getBoundingClientRect();sim.motionProgress=Math.max(0,Math.min(1,(e.clientX-r.left-24)/(r.width-40)));sim.playing=false;if(animationFrame)cancelAnimationFrame(animationFrame);setCalibrationUI();render();timeCurve.setPointerCapture(e.pointerId)};timeCurve.onpointermove=e=>{if(timeCurve.hasPointerCapture(e.pointerId)){const r=timeCurve.getBoundingClientRect();sim.motionProgress=Math.max(0,Math.min(1,(e.clientX-r.left-24)/(r.width-40)));render()}};
    completeButton.onclick=async()=>{model.calibrationLocked=true;model.calibratedAt=new Date().toISOString();setCalibrationUI();completeButton.disabled=true;setStatus('正在保存调制结果…');try{const saved=await saveElectricModel(record,{...model,simulation:sim});record.electricFieldModel=saved.electricFieldModel;model=safeFieldModel(record.electricFieldModel);setCalibrationUI();if(dragHint)dragHint.textContent='拖动正、负点电荷或试探电荷';setStatus('已完成调制并保存。');render()}catch(error){model.calibrationLocked=false;setCalibrationUI();setStatus('调制结果未能保存：'+error.message+'。仍可继续调整后重试。')}};
    editButton.onclick=async()=>{model.calibrationLocked=false;model.calibratedAt=null;sim.playing=false;sim.motionProgress=0;if(animationFrame)cancelAnimationFrame(animationFrame);setCalibrationUI();setStatus('已解锁电场与三条曲线，可以继续调整。');try{await saveElectricModel(record,{...model,simulation:sim})}catch(error){setStatus('已解锁，但保存状态失败：'+error.message)}render()};
    playButton.onclick=()=>{if(!model.calibrationLocked)return;sim.playing=true;sim.motionProgress=0;setCalibrationUI();setStatus('理论运动播放中…');const step=()=>{if(!sim.playing||!root.isConnected)return;sim.motionProgress=Math.min(1,(sim.motionProgress||0)+.008);render();if(sim.motionProgress>=1){sim.playing=false;playButton.disabled=false;playButton.textContent='↻ 重播理论运动';setStatus('理论运动播放完成；可拖动 x(t) 回看，或编辑电场重新调制。');return}animationFrame=requestAnimationFrame(step)};animationFrame=requestAnimationFrame(step)};
    viewSwitch.querySelectorAll('[data-ef-mini-view]').forEach(button=>button.onclick=async()=>{if(!model.calibrationLocked)return;const previous=model.displayMode;model.displayMode=button.dataset.efMiniView;setCalibrationUI();viewSwitch.querySelectorAll('button').forEach(item=>item.disabled=true);try{const saved=await saveElectricModel(record,{...model,simulation:sim});record.electricFieldModel=saved.electricFieldModel;model=safeFieldModel(record.electricFieldModel);setCalibrationUI();setStatus(model.displayMode==='curves'?'已保存曲线视图。':'已保存完整实验面板。')}catch(error){model.displayMode=previous;setCalibrationUI();setStatus('视图切换未能保存：'+error.message)}finally{viewSwitch.querySelectorAll('button').forEach(item=>item.disabled=false)}});
    by('[data-ef-mini-analyze]').onclick=async()=>{setStatus('正在识别题图坐标轴和走势…');try{let imageData='';if(model.supplementaryImage?.hash)imageData=await electricImageDataUrl(model.supplementaryImage.hash);if(!imageData&&record.sourceImage?.hash)imageData=await electricImageDataUrl(record.sourceImage.hash);const token=window.__eduAuthSessionToken||state.apiToken,response=await fetch(apiBase()+'/v1/electric-field/compile',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify({question:record.question,...(imageData?{imageData}:{})})}),result=await response.json();if(!response.ok)throw new Error(result.message||result.error||`服务返回 ${response.status}`);const bench=result.bench||{};model={...model,spec:result.spec,bench,graphAnalysis:result.graphAnalysis||null,motionPrinciple:result.motionPrinciple||model.motionPrinciple,status:result.status,simulation:{...sim,mode:bench.mode||sim.mode,charge:Number(bench.q??bench.field??sim.charge),radius:Number(bench.radius||sim.radius),testX:Number(bench.testX??sim.testX),testY:Number(bench.testY??sim.testY),testCharge:Number(bench.testQ??sim.testCharge)}};const segments=model.graphAnalysis?.segments||[];if(segments.length){let y=0;const anchors=[0];for(const item of segments){y+=item.trend==='increasing' ? 0.32 : item.trend==='decreasing' ? -0.32 : 0;anchors.push(Math.max(-.4,Math.min(.4,y)))}model.adjustedCurve=Array.from({length:41},(_,i)=>{const position=i/40*(anchors.length-1),index=Math.min(anchors.length-2,Math.floor(position)),fraction=position-index;return anchors[index]*(1-fraction)+anchors[index+1]*fraction})}const saved=await saveElectricModel(record,model);record.electricFieldModel=saved.electricFieldModel;model=safeFieldModel(record.electricFieldModel);setStatus(result.notice||'AI 识别完成，请核对图像、坐标轴和曲线。');mountElectricMini(card,record,model)}catch(error){setStatus('识别暂未完成：'+error.message+'。模型与题目仍保留，可重新尝试。')}};
    by('[data-ef-mini-save]').onclick=async()=>{setStatus('正在保存本题模型…');try{const saved=await saveElectricModel(record,{...model,simulation:sim});record.electricFieldModel=saved.electricFieldModel;setStatus('模型和曲线调整已保存到本题。')}catch(error){setStatus('保存失败：'+error.message)}};
    if((record.sourceImage?.hash||record.supplementaryImage?.hash||model.supplementaryImage?.hash)&&!model.graphAnalysis){const runs=window.__efGraphAutoRuns||(window.__efGraphAutoRuns=new Set());if(!runs.has(record.id)){runs.add(record.id);setTimeout(()=>{if(by('[data-ef-mini-analyze]'))by('[data-ef-mini-analyze]').click()},120)}}
  }
  renderLibrary=function(v){const pending=state.wqPendingWeakLink,focused=(state.mistakes||[]).find(m=>m.id===state.focusMistakeId);if(pending&&focused&&focused.question===pending.question){focused.relatedWeakPoints=pending.linkedWeakPoints;state.wqPendingWeakLink=null;intake.draft=null;intake.questionText='';intake.loading=false;save()}originalLibrary(v);v.querySelectorAll('[data-open-case]').forEach(button=>{
    button.textContent='AI 陪练';button.onclick=()=>{state.libraryDetailId=button.dataset.openCase;state.focusMistakeId=button.dataset.openCase;save();render();
      openTutorForCase(button.dataset.openCase)};
    const card=button.closest('[data-mistake-id]');const record=state.mistakes.find(m=>m.id===button.dataset.openCase);
    if(card&&record?.createdAt&&!card.querySelector('.wq-created')){
      const time=document.createElement('p');time.className='muted wq-created';time.textContent='录入 '+new Date(record.createdAt).toLocaleString('zh-CN');button.before(time)}
  });
    v.querySelectorAll('[data-mistake-id]').forEach(card=>{
      const record=(state.mistakes||[]).find(item=>item.id===card.dataset.mistakeId);
      if(!record||!String(record.subject||'').startsWith('物理')||!/电场|电势|点电荷|带电|极板|电荷/.test(String(record.question||''))||card.querySelector('[data-ef-mini-root]'))return;
      if(record.id!==state.libraryDetailId&&record.id!==state.focusMistakeId)return;
      const model={...(record.electricFieldModel||{}),supplementaryImage:record.electricFieldModel?.supplementaryImage||record.supplementaryImage||null};
      const panel=document.createElement('section');panel.className='geometry-scene ef-case-panel';panel.dataset.efMiniRoot='';
      card.append(panel);
      mountElectricMini(card,record,model);
    });
    /* 当前聚焦的这道错题：① 从 AI 陪练内容生成个人知识卡；② 展示上次的做题记录与卡点。
       两段都挂在聚焦卡片上，只读不改，和 paper-upload 的核对面板共用样式。 */
    if(focused){
      const card=[...v.querySelectorAll('[data-mistake-id]')].find(element=>element.dataset.mistakeId===focused.id);
      if(card&&!card.querySelector('[data-wq-generate-card]')){
        const createCard=document.createElement('button');createCard.type='button';createCard.dataset.wqGenerateCard=focused.id;createCard.className='wq-share';
        createCard.textContent='生成知识卡片';
        const sessions=Object.entries(state.tutorSessions||{}).filter(([key])=>key===focused.id||String(key).startsWith(focused.id+'::'));
        createCard.onclick=()=>{
          if(typeof window.__createKnowledgeCardFromMistake!=='function'){alert('知识卡功能还未加载，请刷新页面后再试。');return}
          const tutorTurns=sessions.flatMap(([,session])=>session.turns||[]);
          const learnedContent=tutorTurns.flatMap(turn=>[turn.directAnswer,turn.understanding,turn.explanation]).map(text=>String(text||'').trim()).filter(Boolean);
          const nextStep=sessions.map(([,session])=>session.diagnosis?.nextStep).filter(Boolean).slice(-1)[0]||focused.errorThoughtInsight?.warning||'';
          if(!tutorTurns.length){alert('请先在这道题的 AI 陪练中完成至少一轮，再把刚学会的方法整理成知识卡。');return}
          window.__createKnowledgeCardFromMistake({caseId:focused.id,knowledgePoint:(focused.knowledgePoints||[])[0]||focused.unit||'本题方法',subject:focused.subject||'数学',caseQuestion:focused.question||'',weakPoint:sessions.map(([,session])=>session.diagnosis?.pattern).filter(Boolean).slice(-1)[0]||focused.stuckAt?.evidence||'',errorCauses:focused.errorCauses||[],studentAnswer:focused.studentAnswer||'',correctAnswer:focused.correctAnswer||'',tutorTurns,learnedContent,nextStep});
        };
        card.append(createCard);
      }
      const steps=Array.isArray(focused.processSteps)?focused.processSteps:[];
      const stuck=focused.stuckAt&&typeof focused.stuckAt==='object'?focused.stuckAt:null;
      if(card&&(steps.length||stuck)&&!card.querySelector('[data-wq-record]')){
        const panel=document.createElement('details');panel.className='paper-process wq-record';panel.dataset.wqRecord='';
        const flag=value=>value==='wrong'?'<span class="paper-step-flag">这一步出错</span>':value==='correct'?'<span class="paper-step-flag ok">这一步正确</span>':'';
        panel.innerHTML=`<summary>我上次的做题记录${stuck?' · 卡点在第 '+escape(String(stuck.stepIndex||'?'))+' 步':''}</summary>`
          +`<ol class="paper-steps">${steps.map(step=>{
            const isStuck=Boolean(stuck)&&(Number(stuck.stepIndex)===Number(step.index)||(!stuck.stepIndex&&step.index===1));
            return `<li class="paper-step${isStuck?' stuck':''}"><b>第 ${escape(String(step.index))} 步${step.label?' · '+escape(step.label):''}</b>${flag(step.verdict)}`
              +`${step.detail?`<p>${escape(step.detail)}</p>`:''}${step.formula?`<p class="paper-step-formula">${escape(step.formula)}</p>`:''}</li>`}).join('')}</ol>`
          +(stuck?`<div class="paper-stuck"><b>卡点：${escape(stuck.label||(stuck.stepIndex?'第 '+stuck.stepIndex+' 步':'解题中途'))}</b><p>手写原文：${escape(stuck.evidence||'（无原文引用）')}</p></div>`:'')
          +'<p class="muted">进入 AI 陪练会从这一步接着问，不会再让你从头复述。</p>';
        card.append(panel);
      }
    }
    if(focused&&String(focused.subject||'').trim().startsWith('数学')&&/立体几何|空间几何|空间直角坐标系|二面角|线面角|线线角|点到平面距离|平面与平面/.test(String(focused.question||''))&&!focused.geometryResult?.scene){
      const card=[...v.querySelectorAll('[data-mistake-id]')].find(element=>element.dataset.mistakeId===focused.id);
      if(card&&!card.querySelector('[data-retry-geometry]')){
        const panel=document.createElement('section');panel.className='wq-model-cta';panel.setAttribute('aria-label','立体几何 3D 模型');
        const status=document.createElement('p');status.className='geometry-alert';status.setAttribute('role','status');
        const building=['queued','building'].includes(focused.geometryBuildStatus);
        status.textContent=focused.modelMessage||(building?'3D 模型正在生成…':'立体几何题 · 还没有 3D 模型');
        const retry=document.createElement('button');retry.type='button';retry.dataset.retryGeometry=focused.id;
        retry.className='primary';retry.textContent=building?'正在生成 3D 模型…':focused.geometryBuildStatus==='failed'?'重试生成 3D 模型':'生成 3D 模型';
        retry.disabled=building;
        retry.onclick=()=>ensureGeometryModel(focused.id,focused.question);
        panel.append(status,retry);card.append(panel);
      }
    }
    (state.mistakes||[]).filter(item=>item.geometryModelRequested===true&&['queued','building'].includes(item.geometryBuildStatus)).forEach(item=>watchGeometryBuild(item.id));
  };
  const originalClusters=renderClusters;
  renderClusters=function(v){originalClusters(v);const points=(Array.isArray(state.wqWeakPoints)?state.wqWeakPoints:[])
    .filter(point=>point&&(point.knowledgePoint||point.microSkill));
    if(points.length){const fromTutor=points.filter(point=>point.evidenceType!=='process_review').length;
      const panel=document.createElement('section');panel.className='panel';
      panel.innerHTML=`<h2>薄弱点证据</h2><p class="muted">共 ${points.length} 条：AI 陪练对话 ${fromTutor} 条 · 拍照录入的做题记录 ${points.length-fromTutor} 条。每条都带学生原文引用，不是按题目难度猜的。</p>`
        +points.slice(0,10).map(point=>{const fromProcess=point.evidenceType==='process_review';
          const head=`${escape(point.knowledgePoint||point.microSkill||'本题思路')} · ${escape(point.signal||'')}`;
          const page=fromProcess&&point.questionNumber?`第 ${escape(point.questionNumber)} 题 · `:'';
          return `<div class="review-item"><div><b>${head}</b><span class="pill">${fromProcess?'做题记录':'AI 陪练'}</span><p>${page}学生原文：${escape(point.evidenceQuote)}</p><p class="muted">${escape(point.feedback)}</p></div></div>`}).join('');
      v.prepend(panel)}
    loadOwnWeakPoints();
  };
  const originalPlan=renderPlan;
  renderPlan=function(v){originalPlan(v);const first=[...v.querySelectorAll(':scope > .panel')].find(panel=>panel.querySelector('h2')?.textContent==='今天优先修复');if(!first)return;
    const point=(state.wqWeakPoints||[]).find(item=>item&&item.knowledgePoint&&(item.signal||item.evidenceQuote));
    const summary=document.createElement('p');summary.className='wq-plan-insight';
    summary.textContent=point
      ?`AI 陪练发现你在「${point.knowledgePoint}」上${point.signal||'仍有卡点'}；这次先复习该知识点，再用原题验证能否独立完成。`
      :'完成一轮真实 AI 陪练后，这里会用一句话总结你暴露出的薄弱知识点。';
    first.querySelector('.head')?.after(summary);
  };
  document.head.insertAdjacentHTML('beforeend',`<style>
    .wq-home h2{margin:0 0 6px}.wq-home p{color:#52617a}.wq-entry-switch{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
    .wq-entry-switch button{min-height:68px;border:1px solid #a8bfed;border-radius:16px;font-weight:700;font-size:17px;color:#254a87;background:#f3f7ff}
    .wq-entry-switch button.active,.wq-home .wq-entry-switch button{background:#356bea;color:#fff;border-color:#356bea}
    .wq-entry{grid-column:1/-1}.wq-entry label,.wq-review label{display:block;margin:12px 0 5px;font-weight:650}
    .wq-photo-preview{display:block;max-width:100%;max-height:320px;object-fit:contain;margin:10px auto;border:1px solid #d7e1f3;border-radius:10px}.wq-photo-attachment{display:inline-grid;gap:5px;max-width:min(100%,360px);margin:8px;padding:8px;border:1px solid #b8cae5;border-radius:12px;background:#f7f9fd}.wq-photo-attachment img{max-width:100%;max-height:220px;object-fit:contain}.wq-attachment{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0;padding:12px;border:1px dashed #b8cae5;border-radius:12px;background:#f9fbff}.wq-attachment p{margin:3px 0}.wq-attachment img{max-width:160px;max-height:120px;object-fit:contain;border-radius:8px}
    .wq-entry label small{font-weight:400;color:#5a6372}.wq-entry textarea{min-height:112px;margin-top:6px}.wq-review{margin-top:18px;padding-top:16px;border-top:1px solid #d7e1f3}
    .wq-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wq-status{color:#315dcc}.wq-error{padding:10px;border-radius:12px;background:#fff2df;color:#743c00}
    .wq-entry button:focus-visible,.wq-home button:focus-visible{outline:3px solid #234eac;outline-offset:2px}
    .ef-case-principle{margin:10px 0;padding:12px;border:1px solid #cddcf5;border-radius:14px;background:#f5f8ff;color:#25415f}.ef-case-principle p{margin:6px 0;line-height:1.55}
     .ef-case-panel{margin:12px 0;padding:14px;border:1px solid #b8cae5;border-radius:16px;background:#fffefa;color:#142847}.ef-case-panel.geometry-scene{background:#fffefa;border-color:#b8cae5;color:#142847}.ef-mini-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.ef-mini-head p{margin:4px 0 10px;color:#465d7c}.ef-mini-status{font-size:13px;color:#365eaa}.ef-mini-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,.85fr);gap:14px}.ef-mini-visual{display:grid;grid-template-columns:minmax(130px,.7fr) minmax(220px,1.3fr);gap:10px;align-items:start}.ef-mini-source{display:grid;gap:8px}.ef-mini-source img{width:100%;max-height:260px;object-fit:contain;background:#f4f7fc;border:1px solid #d5dfed;border-radius:10px}.ef-mini-pick{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 12px;border:1px solid #b5c7e4;border-radius:12px;background:#f3f7ff;cursor:pointer}.ef-mini-visual canvas{display:block;width:100%;height:290px;touch-action:none;background:#fbfdff;border:1px solid #d5dfed;border-radius:12px}.ef-mini-visual small,.ef-mini-graph small{display:block;color:#526782;margin-top:5px}.ef-mini-controls{min-width:0}.ef-mini-row{display:flex;flex-wrap:wrap;align-items:end;gap:10px;margin:8px 0}.ef-mini-row label{display:grid;gap:4px;color:#263e60}.ef-mini-row button,.ef-mini-row select,.ef-mini-row input{min-height:42px}.ef-mini-row input[type=range]{width:130px}.ef-mini-row input[type=checkbox]{min-height:auto;accent-color:#3369e8}.ef-mini-sources-head{display:flex;justify-content:space-between;margin:8px 0;color:#29415e}.ef-mini-source-row{display:grid;grid-template-columns:30px minmax(0,1fr) 36px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #e8edf4}.ef-mini-source-row>b{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;color:#fff}.ef-mini-source-row>b.positive{background:#d94949}.ef-mini-source-row>b.negative{background:#386bd5}.ef-mini-source-row label{display:grid;grid-template-columns:auto auto;align-items:center;gap:3px 8px;margin:0}.ef-mini-source-row input{grid-column:1/-1;min-height:auto;accent-color:#3369e8}.ef-mini-graph{display:grid;gap:8px}.ef-mini-graph canvas{width:100%;height:130px;display:block;touch-action:none;border:1px solid #d5dfed;border-radius:10px;background:#fff}.ef-calibration-actions{padding-top:8px;border-top:1px solid #dfe7f2}.ef-calibration-actions button{min-height:42px}.ef-mini-view-switch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;padding:10px;border:1px solid #dce6f4;border-radius:12px;background:#f7f9fd}.ef-mini-view-switch button[aria-pressed=true]{background:#356bea;color:#fff;border-color:#356bea}.ef-case-panel.curves-only .ef-mini-layout{display:block}.ef-case-panel.curves-only .ef-mini-visual,.ef-case-panel.curves-only .ef-mini-controls>.ef-mini-row,.ef-case-panel.curves-only .ef-mini-controls>.ef-calibration-actions{display:none!important}.ef-case-panel.curves-only .ef-mini-graph canvas{height:180px}.ef-calibration-locked [data-ef-mini-scene]{filter:saturate(.92)}.ef-mini-row button:focus-visible,.ef-mini-pick:focus-visible,.ef-mini-view-switch button:focus-visible{outline:3px solid #f0bd36;outline-offset:2px}.ef-case-panel.calibration-locked{padding:8px}.ef-case-panel.calibration-locked .ef-mini-head,.ef-case-panel.calibration-locked .ef-mini-controls,.ef-case-panel.calibration-locked .ef-mini-source{display:none!important}.ef-case-panel.calibration-locked .ef-mini-layout,.ef-case-panel.calibration-locked .ef-mini-visual{display:block}.ef-case-panel.calibration-locked .ef-mini-visual canvas{height:260px}.wq-model-cta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding:10px 12px;border:1px dashed #b8cae5;border-radius:14px;background:#f7faff}.wq-model-cta p{margin:0;color:#526782}.wq-model-cta button{min-height:42px;white-space:nowrap}
    /* 追加：分步高亮步骤表 + 实验室按钮 */
    .ef-mini-guidance{margin:10px 0;padding:11px 12px;border:1px solid #cddcf5;border-radius:14px;background:#f5f8ff}
    .ef-steps{list-style:none;margin:6px 0;padding:0;display:grid;gap:6px}
    .ef-step-row{padding:8px 10px;border:1px solid #dbe4f1;border-radius:11px;background:#fff;cursor:pointer}
    .ef-step-row.active{border-color:#3369e8;box-shadow:0 3px 0 #cfdcf8;background:#eef4ff}
    .ef-step-row:focus-visible{outline:3px solid #f0bd36;outline-offset:2px}
    .ef-step-head{display:flex;align-items:center;gap:7px}.ef-step-head b{font-size:14px;color:#1c3251}
    .ef-step-no{display:grid;place-items:center;width:21px;height:21px;border-radius:50%;background:#3369e8;color:#fff;font-size:12px;font-weight:800;flex:0 0 auto}
    .ef-step-flag{margin-left:auto;padding:1px 7px;border-radius:999px;background:#3369e8;color:#fff;font-size:11px}
    .ef-step-row p{margin:4px 0 0;line-height:1.5;color:#3d5573;font-size:13px}
    .ef-step-key{color:#1d5c46!important}.ef-step-target{color:#6b7a90!important;font-size:12px!important}
    .ef-step-status{margin:6px 0 0;color:#315dcc;font-size:13px}
    .ef-step-actions button{border-color:#b5c7e4;background:#f3f7ff}
    .ef-lab-actions{border-top:1px dashed #d7e1f3;padding-top:9px}
    .ef-lab-actions button{border-color:#cbb98a;background:#fff9e4;color:#5c4715;font-weight:650}
    .ef-lab-actions button:focus-visible{outline:3px solid #234eac;outline-offset:2px}
    .ef-step-target-hit{outline:4px solid #f0bd36!important;outline-offset:3px;border-radius:12px;box-shadow:0 0 0 9px rgba(240,189,54,.24)!important;animation:efStepPulse 1.1s ease-in-out infinite}
    @keyframes efStepPulse{0%,100%{box-shadow:0 0 0 6px rgba(240,189,54,.20)}50%{box-shadow:0 0 0 12px rgba(240,189,54,.36)}}
    @media(prefers-reduced-motion:reduce){.ef-step-target-hit{animation:none}}
    @media(max-width:760px){.ef-mini-guidance{grid-template-columns:1fr}.ef-mini-layout{grid-template-columns:1fr}.ef-mini-visual{grid-template-columns:minmax(105px,.6fr) minmax(180px,1.4fr)}.ef-mini-visual canvas{height:240px}}@media(max-width:560px){.wq-entry-switch,.wq-two{grid-template-columns:1fr}.wq-entry-switch button{min-height:58px}.ef-case-panel{padding:10px}.ef-mini-visual{grid-template-columns:1fr}.ef-mini-source{grid-template-columns:1fr 1fr}.ef-mini-source img{max-height:210px}.ef-mini-visual canvas{height:220px}}
  </style>`);
  render();
})();
