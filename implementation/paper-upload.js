/* 两个入口，职责不同，共用同一套分批/核对界面：
   ① 批量错题（default）：一次传好几张错题照片，没有批改痕迹，AI 自己读手写作业判对错；
      判不清（照片模糊、字潦草、看不到作答）的题会被标成「你来定」，由学生自己决定。
   ② 试卷上传：强制试卷 + 答题卡，AI 结合两者按题号配对，以批改痕迹和逐题得分为准。 */
(function () {
  const MAX_PAGES_PER_BATCH = 12;
  const MAX_FILES = 24;
  const MAX_TOTAL_CHARS = 10 * 1024 * 1024;
  // 与单题录入、后端 SUBJECTS 白名单保持一致
  const SUBJECTS = ['未分类','语文','数学','英语','物理','化学','生物','政治','历史','地理'];
  const ui={paperFiles:[],answerFiles:[],draft:null,busy:false,message:'',progress:'',loadedFor:null,entry:'batch',preflight:null,preflightFor:'',questionImages:{},
    /* 快速识别：默认关，保持原有的深度行为。
       实测（同一张整页 1289×1080）：快速约 40 秒 / 深度约 73 秒——只有约 1.8 倍，
       因为模型读整页图本身就要推理 ~12k tokens，把提示词压到 176 字反而更慢（58~60 秒）。
       所以这是个"少读一点、快一点、但没有薄弱点"的取舍，交给学生自己勾。 */
    fastMode:false};
  const cropStyle=document.createElement('style');cropStyle.textContent='.paper-image-tools{margin:12px 0;padding:12px;border:1px dashed #aabbd2;border-radius:14px;background:#f8fbff}.paper-image-picker{display:inline-flex!important;align-items:center;gap:6px;position:relative;cursor:pointer}.paper-image-picker input{position:absolute!important;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.paper-image-preview{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}.paper-image-preview img{max-width:min(100%,360px);max-height:180px;object-fit:contain;border:1px solid #cfdaeb;border-radius:10px;background:white}.paper-crop-backdrop{position:fixed;inset:0;z-index:9200;background:#0b1735bb;display:grid;place-items:center;padding:16px}.paper-crop-dialog{width:min(980px,100%);max-height:94vh;overflow:auto;background:white;border:2px solid #1e3151;border-radius:20px;padding:16px;box-shadow:0 18px 55px #07142c55}.paper-crop-dialog .head{display:flex;justify-content:space-between;align-items:start;gap:12px}.paper-crop-dialog .head p{margin:4px 0}.paper-crop-stage{display:grid;place-items:center;max-height:68vh;overflow:auto;margin:12px 0}.paper-crop-stage canvas{display:block;max-width:100%;max-height:65vh;width:auto;height:auto;touch-action:none;border:1px solid #ced9e8;border-radius:8px}.paper-crop-dialog .row{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}';document.head.appendChild(cropStyle);
  const escape=value=>window.__eduPaperEscape ? window.__eduPaperEscape(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const owner=()=>window.__eduCurrentOwner || 'local-student';
  /* 入口由 tab 决定：试卷上传强制要答题卡，批量错题只要错题照片。 */
  const mode=()=>ui.entry==='examPaper'?'exam_paper':'batch';
  async function call(path,options={}) {
    if (!window.__eduRequest) throw new Error('学习服务尚未就绪');
    return window.__eduRequest(path,options);
  }
  function compress(file) {
    return new Promise((resolve,reject)=>{
      if (!file || !/^image\//.test(file.type)) return reject(new Error('请按页上传 JPG、PNG 或 WebP 照片'));
      const url=URL.createObjectURL(file),image=new Image();
      image.onload=()=>{
        try {
          const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
          canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
          const context=canvas.getContext('2d');
          if (!context) throw new Error('设备不支持图片压缩');
          context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
          context.drawImage(image,0,0,canvas.width,canvas.height);
          resolve(canvas.toDataURL('image/jpeg',0.78));
        } catch(error) {reject(error)} finally {URL.revokeObjectURL(url)}
      };
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('图片无法读取'))};
      image.src=url;
    });
  }
  function setQuestionImage(itemId,dataUrl,fileName) {
    ui.questionImages[itemId]={dataUrl,fileName:String(fileName||'本题题图').slice(0,160)};
  }
  async function imageForCrop(item) {
    const page=Number(item.paperPage);
    const reference=page>0?ui.draft?.paperImages?.[page-1]:null;
    if(!reference?.hash) throw new Error('这道题没有关联到试卷页，请用相册选择本题图片。');
    const token=window.__eduAuthSessionToken||'';
    const response=await fetch('/v1/papers/images/'+encodeURIComponent(reference.hash),{headers:token?{authorization:'Bearer '+token}:{}});
    if(!response.ok) throw new Error('原试卷页读取失败，请重新上传试卷照片后再裁切。');
    const url=URL.createObjectURL(await response.blob());
    try {
      const image=await new Promise((resolve,reject)=>{const element=new Image();element.onload=()=>resolve(element);element.onerror=()=>reject(new Error('原试卷图片无法解码'));element.src=url});
      return {image,url,fileName:`试卷第${page}页`};
    } catch(error) {URL.revokeObjectURL(url);throw error}
  }
  async function openCrop(panel,item,file=null) {
    let sourceUrl='',image;
    try {
      if(file){const compressed=await compress(file);sourceUrl=URL.createObjectURL(await(await fetch(compressed)).blob());image=await new Promise((resolve,reject)=>{const element=new Image();element.onload=()=>resolve(element);element.onerror=()=>reject(new Error('图片无法读取'));element.src=sourceUrl})}
      else ({image,url:sourceUrl}=await imageForCrop(item));
    } catch(error) {ui.message=error.message;renderPaper(panel);return}
    const scale=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');context.drawImage(image,0,0,canvas.width,canvas.height);
    let start=null,selection=null;
    const overlay=document.createElement('div');overlay.className='paper-crop-backdrop';
    overlay.innerHTML=`<section class="paper-crop-dialog" role="dialog" aria-modal="true" aria-label="裁切本题题图"><div class="head"><div><b>裁切第 ${escape(item.number)} 题的题图</b><p class="muted">在试卷页上拖动框选本题区域，蓝框中的内容会附在这道错题旁。</p></div><button type="button" data-crop-close>取消</button></div><div class="paper-crop-stage"></div><div class="row"><button type="button" data-crop-clear>清除选区</button><button class="primary" type="button" data-crop-save disabled>确认裁切并附到本题</button></div></section>`;
    const stage=overlay.querySelector('.paper-crop-stage');stage.append(canvas);document.body.append(overlay);
    const close=()=>{overlay.remove();URL.revokeObjectURL(sourceUrl)};
    const draw=()=>{context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);if(selection){context.save();context.fillStyle='rgba(37,99,235,.12)';context.strokeStyle='#2563eb';context.lineWidth=Math.max(2,canvas.width/700);context.setLineDash([8,5]);context.fillRect(selection.x,selection.y,selection.width,selection.height);context.strokeRect(selection.x,selection.y,selection.width,selection.height);context.restore()}overlay.querySelector('[data-crop-save]').disabled=!(selection&&selection.width>=12&&selection.height>=12)};
    const position=event=>{const bounds=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(event.clientX-bounds.left)*canvas.width/bounds.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-bounds.top)*canvas.height/bounds.height))}};
    canvas.onpointerdown=event=>{event.preventDefault();start=position(event);selection={x:start.x,y:start.y,width:0,height:0};canvas.setPointerCapture?.(event.pointerId);draw()};
    canvas.onpointermove=event=>{if(!start)return;const point=position(event);selection={x:Math.min(start.x,point.x),y:Math.min(start.y,point.y),width:Math.abs(point.x-start.x),height:Math.abs(point.y-start.y)};draw()};
    canvas.onpointerup=()=>{start=null;draw()};
    overlay.querySelector('[data-crop-close]').onclick=close;overlay.addEventListener('click',event=>{if(event.target===overlay)close()});
    overlay.querySelector('[data-crop-clear]').onclick=()=>{selection=null;draw()};
    overlay.querySelector('[data-crop-save]').onclick=()=>{
      if(!selection)return;
      const output=document.createElement('canvas'),outScale=Math.min(1,1000/Math.max(selection.width,selection.height));output.width=Math.max(1,Math.round(selection.width*outScale));output.height=Math.max(1,Math.round(selection.height*outScale));
      output.getContext('2d').drawImage(canvas,selection.x,selection.y,selection.width,selection.height,0,0,output.width,output.height);
      const dataUrl=output.toDataURL('image/jpeg',.78);
      if(dataUrl.length>1100*1024){ui.message='裁切图仍然太大，请缩小裁切范围后再试。';close();renderPaper(panel);return}
      setQuestionImage(item.id,dataUrl,`${item.number}题题图.jpg`);ui.message='题图已附到第 '+item.number+' 题，确认入库后会一并保存。';close();renderPaper(panel);
    };
    draw();
  }
  function questionImageHtml(item) {
    const pending=ui.questionImages[item.id];
    const crop=item.paperPage?`<button type="button" data-paper-crop="${escape(item.id)}">✂️ 添加题图（从本次上传的第 ${escape(item.paperPage)} 页原图裁切）</button>`:'';
    return `<section class="paper-image-tools"><div class="row">${crop}<label class="paper-image-picker">📷 相册添加本题图<input type="file" accept="image/*" data-paper-image-file="${escape(item.id)}"></label></div>${pending?`<div class="paper-image-preview"><img src="${escape(pending.dataUrl)}" alt="第 ${escape(item.number)} 题待保存题图"><span>${escape(pending.fileName)}</span><button type="button" data-paper-image-remove="${escape(item.id)}">移除</button></div>`:'<p class="muted">点左侧按钮可直接裁切本次上传的原试卷照片，无需重复上传；也可从相册单独添加。</p>'}</section>`;
  }
  /* 「判不清」不是失败：AI 看不清就明确交回学生，所以这里把三种结果分开说，
     并把 AI 的判断理由摆出来，学生才能核对它有没有判错。 */
  function statusLabel(item) {
    if (item.status==='needs_review') return '你来定：AI 看不清';
    if (item.status==='wrong') return item.markEvidence?'批改证据判定做错':'AI 判定做错';
    return item.markEvidence?'批改证据判定做对':'AI 判定做对';
  }
  function judgementHtml(item) {
    const reason=item.aiJudgementReason||item.explanation||'';
    /* 选择题/填空题没有手写过程可看，别再说「手写看不清」——学生会被误导去补拍笔记。 */
    const head=item.status==='needs_review'
      ? (item.type==='written'
        ? 'AI 没能确认这道题的对错（手写看不清、被遮挡，或照片模糊）。请你自己判断后勾选：是错题就留着，做对了就取消勾选。'
        : `AI 没能确认这道${typeLabel(item)}的对错（选项或最终答案看不清、被遮挡，或照片模糊）。请你自己判断后勾选：是错题就留着，做对了就取消勾选。`)
      : `AI 判断：${item.status==='wrong'?'做错':'做对'}。`;
    return `<div class="paper-judgement ${item.status==='needs_review'?'unknown':item.status}"><b>${escape(head)}</b>${reason?`<p>${escape(reason)}</p>`:''}</div>`;
  }
  /* 立体几何才谈得上 3D 模型；命中这些词就认为「本来具备条件」。
     批量录入时每个立体几何题旁边都给一个小勾选框，**默认勾好**——
     本来就能建模的题不该让学生一题题手动点。不想要的可以自己取消。 */
  const SOLID_HINTS = /棱柱|棱锥|棱台|正方体|长方体|四面体|多面体|圆柱|圆锥|圆台|球面|球体|空间|立体|体积|表面积|二面角|异面|线面角|面面角|三视图|直三棱|正四棱|侧棱|底面|母线/;
  function looksSolid(item) {
    if (item.geometryResult?.scene) return false;      // 已经有模型了，不用再勾
    const text = [item.question, item.knowledgePoints, item.weakPoints, item.stuckAt?.label, item.processSteps].flat(3).filter(Boolean).join(' ');
    return SOLID_HINTS.test(String(text));
  }
  function model3dHtml(item) {
    if (!looksSolid(item)) return '';
    return `<label class="paper-3d"><input type="checkbox" data-paper-3d checked> 生成 3D 模型<span class="me-hint">入库后在后台生成，不用守着页面；不需要就取消勾选</span></label>`;
  }
  /* 只有解答题谈得上「做题过程」。AI 读不清手写时不要瞎猜，
     请学生自己把思路打一遍；他愿意写，AI 就从他的表达里提薄弱点和错因，不写就只当题目入库。 */
  function typeLabel(item) {
    return item.type==='choice'?'选择题':item.type==='fill'?'填空题':'解答题';
  }
  function processHtml(item) {
    const steps=Array.isArray(item.processSteps)?item.processSteps:[];
    if (item.type!=='written') return `<p class="muted">${typeLabel(item)}只看最终答案对不对，不需要做题过程。</p>`;
    if (!steps.length && !item.stuckAt) return '<p class="muted">这一题没有识别到手写解题过程。你可以在下面自己写一遍思路，我据此找卡点和薄弱点；不写就只当题目存下来。</p>';
    const stuckIndex=item.stuckAt?.stepIndex||null;
    const rows=steps.map(step=>{
      const isStuck=stuckIndex===step.index||(!stuckIndex&&item.stuckAt&&step.index===1);
      const label=[`第 ${step.index} 步`,step.label].filter(Boolean).join(' · ');
      return `<li class="paper-step${isStuck?' stuck':''}">
        <b>${escape(label)}</b>${step.verdict==='wrong'?'<span class="paper-step-flag">这一步出错</span>':step.verdict==='correct'?'<span class="paper-step-flag ok">这一步正确</span>':''}
        ${step.detail?`<p>${escape(step.detail)}</p>`:''}
        ${step.formula?`<p class="paper-step-formula">${escape(step.formula)}</p>`:''}</li>`;
    }).join('');
    const stuck=item.stuckAt?`<div class="paper-stuck"><b>卡点：${escape(item.stuckAt.label||(item.stuckAt.stepIndex?`第 ${item.stuckAt.stepIndex} 步`:'解题中途'))}</b>
      <p>AI 引用的手写原文：${escape(item.stuckAt.evidence||'（缺少原文引用，未采用）')}</p></div>`:'';
    return `${steps.length?`<ol class="paper-steps">${rows}</ol>`:''}${stuck}`;
  }
  /* AI 看不清的解答题：给一个「我自己写」的输入框 */
  function studentProcessHtml(item) {
    if (item.type!=='written') return '';
    const steps=Array.isArray(item.processSteps)?item.processSteps:[];
    const missing=!steps.length&&!item.stuckAt;
    if (!missing) return '';
    return `<div class="paper-mine"><b>AI 没看清你的手写过程。要不你自己写一遍？</b>
      <p class="muted">写清「我先做了什么、卡在哪一步」就够了。写了我会从中找出卡点和薄弱点；不想写就直接入库，只当题目存下来。</p>
      <textarea data-paper-mine placeholder="例如：我先建系写了 A(0,0,0)，然后算法向量的时候不确定方向，就停在这里了">${escape(item.studentProcess||'')}</textarea></div>`;
  }
  function weakPointHtml(item) {
    const claims=Array.isArray(item.weakPointClaims)?item.weakPointClaims:[];
    if (!claims.length) return '<p class="muted">薄弱点：暂无带原文的过程证据，本题不预判薄弱点。</p>';
    return `<div class="paper-weak"><b>AI 从做题记录反推的卡点（学生确认后进入薄弱点）</b><ul>${claims.map(claim=>
      `<li>${escape(claim.knowledgePoint)}${claim.stepIndex?`（第 ${claim.stepIndex} 步）`:''}<p class="muted">证据：${escape(claim.evidence)}</p></li>`).join('')}</ul></div>`;
  }
  /* 上传前预检报错面板：直接回答「照片能不能看清、题目有没有分开、做题过程读到没有」，
     并且总是给出下一步该怎么做，而不是一句「识别失败」。 */
  function preflightHtml() {
    const report=ui.preflight;
    if (!report) return '';
    const tone=report.level==='bad'?'bad':report.level==='warn'?'warn':'good';
    const head=report.level==='bad'?'这组照片暂时没法识别'
      : report.level==='warn'?`读到 ${report.questionCount} 道题，但有 ${report.needsReviewCount} 道判不了对错`
      : `读到 ${report.questionCount} 道题，${report.withProcessCount} 道有做题过程`;
    const buttons=report.level==='bad'
      ? '<div class="row"><button type="button" data-preflight-retry>我重新拍 / 重选照片</button><button type="button" data-preflight-anyway>仍然试着识别一次</button></div>'
      : report.level==='warn'
        /* 「补拍做题过程那一页」只对着解答题有意义：全是选择题/填空题时改提示「重选照片」，
           否则学生会被引导去补拍一张本来就不存在的做题笔记。 */
        ? `<div class="row"><button class="primary" type="button" data-preflight-continue>继续，我来核对这 ${report.needsReviewCount} 道</button>`
          + (report.needsProcessPhoto ? '<button type="button" data-preflight-retry>补拍做题过程那一页</button>' : '<button type="button" data-preflight-retry>重选照片</button>') + '</div>'
        : '<div class="row"><button class="primary" type="button" data-preflight-continue>继续识别并入库</button><button type="button" data-preflight-retry>重选照片</button></div>';
    return `<section class="paper-preflight ${tone}" role="status"><b>${escape(head)}</b>`
      + (report.error?`<p class="paper-preflight-reason">${escape(report.error.hint)}${report.error.detail?`（${escape(report.error.detail)}）`:''}</p>`:'')
      + (report.advice.length?`<ul class="paper-preflight-advice">${report.advice.map(line=>`<li>${escape(line)}</li>`).join('')}</ul>`:'')
      + buttons + '</section>';
  }
  /* 归纳信息自动填充：把 AI 识别到的科目 / 知识点 / 错因预填进每张卡片，学生只做微调。 */
  function fillHtml(item) {
    const points=(item.weakPoints||[]).join('、');
    return `<div class="paper-fill"><p class="muted">AI 已自动填好下面几项，你可以直接改。</p>
      <div class="paper-pair"><label>科目<select data-paper-subject>${SUBJECTS.map(name=>`<option ${name===(ui.draft?.subject||'')?'selected':''}>${escape(name)}</option>`).join('')}</select></label>
      <label>错因<select data-paper-cause>${['','概念不清','规则不熟','审题偏差','策略选错','计算失误','粗心惯性','知识漏洞'].map(name=>`<option value="${escape(name)}" ${name===(item.errorCause||'')?'selected':''}>${escape(name||'待确认')}</option>`).join('')}</select></label></div>
      <label>知识点<span class="me-hint">用顿号分隔，第一个会作为热力图归类</span><input data-paper-points value="${escape(points)}" placeholder="AI 没识别到时自己填"></label></div>`;
  }
  function itemHtml(item) {
    const wrongPoints=Array.isArray(item.weakPoints)?item.weakPoints:[];
    /* 默认勾选规则：AI 判做错的、或抄到了手写过程的，默认入库；
       AI 判做对、以及判不清的，默认不勾，让学生自己决定。 */
    const preChecked = item.status==='wrong' || (item.status==='needs_review' && Boolean(item.processSteps?.length));
    return `<article class="paper-item" data-paper-item="${escape(item.id)}" data-paper-status="${escape(item.status)}">
      <div class="head"><label class="paper-check"><input type="checkbox" data-paper-select ${preChecked?'checked':''}><b>第 ${escape(item.number)} 题 · ${typeLabel(item)}</b></label><span class="pill ${item.status==='wrong'?'warn':item.status==='needs_review'?'':'good'}">${statusLabel(item)}</span></div>
      ${judgementHtml(item)}
      <label>识别题目<textarea data-paper-question>${escape(item.question)}</textarea></label>
      ${answerCompareHtml(item)}
      <div class="paper-pair"><label>学生的做题记录 / 作答原文${item.type==='choice'?'（核对所选选项）':''}<textarea data-paper-answer placeholder="AI 没抄到手写过程时，请把解题过程补在这里">${escape(item.studentAnswer)}</textarea></label>
      <label>${item.answerSource==='derived'?'参考答案（AI 推导，可能是错的；不对就改掉）':'参考答案（印在卷子上的，或你自己输入的）'}<textarea data-paper-correct placeholder="没有答案或看不清，可留空">${escape(item.correctAnswer)}</textarea></label></div>
      <label class="paper-note">题干旁的批注 / 旁注（学生当时写在题目边上的字，一行一条）<textarea data-paper-notes placeholder="例如：这里我算错了符号">${escape((item.marginNotes||[]).join('\n'))}</textarea></label>
      ${questionImageHtml(item)}
      <p class="muted">${item.score===null?'逐题得分未识别':`得分 ${escape(item.score)}${item.maxScore===null?'':` / ${escape(item.maxScore)}`}`} · ${item.paperPage?'试卷第 '+escape(item.paperPage)+' 页':'试卷页码待核对'} · ${item.answerPage?'答题卡第 '+escape(item.answerPage)+' 页':'未配答题卡'}${item.errorCause?` · 错因预判：${escape(item.errorCause)}`:''}</p>
      ${item.markEvidence?`<p>批改依据：${escape(item.markEvidence)}</p>`:''}
      <section class="paper-process"><h4>AI 识别的解题过程</h4>${processHtml(item)}</section>
      ${studentProcessHtml(item)}
      ${model3dHtml(item)}
      ${weakPointHtml(item)}
      ${fillHtml(item)}
    </article>`;
  }
  /* 逐题对照：学生选了什么 → 正确答案是什么 → 为什么这样答是错的。
     答案来源分三档，界面必须如实标出来：卷上印的和自己输入的可信，
     AI 自己推的要明说「可能是错的」，否则学生会被 AI 的错答教错。 */
  function answerCompareHtml(item) {
    const mine=String(item.studentAnswer||'').trim();
    const correct=String(item.correctAnswer||'').trim();
    if (!mine && !correct) return '';
    const derived=item.answerSource==='derived'&&Boolean(correct);
    const sourceLabel=!correct?''
      :item.answerSource==='printed'?'卷子上的答案'
        :item.answerSource==='provided'?'你输入的答案'
          :'AI 推导';
    const confidenceText=derived&&item.answerConfidence==='low'?' · AI 自己把握不大'
      :derived&&item.answerConfidence==='medium'?' · AI 把握一般':'';
    const mismatch=mine&&correct&&mine.replace(/\s/g,'').toUpperCase()!==correct.replace(/\s/g,'').toUpperCase();
    const steps=Array.isArray(item.correctAnswerSteps)?item.correctAnswerSteps:[];
    const why=String(item.aiJudgementReason||item.explanation||'').trim();
    return `<section class="paper-compare">
      <div class="paper-compare-grid">
        <div class="paper-compare-cell"><h5>你当时写的</h5><p class="paper-compare-value${mine?'':' empty'}">${mine?escape(mine):'（没抄到你的作答）'}</p></div>
        <div class="paper-compare-cell ${derived?'is-derived':'is-right'}"><h5>正确答案${sourceLabel?`<span class="paper-compare-badge">${escape(sourceLabel)}${escape(confidenceText)}</span>`:''}</h5><p class="paper-compare-value${correct?'':' empty'}">${correct?escape(correct):'（没有答案）'}</p></div>
      </div>
      ${steps.length?`<div class="paper-compare-why"><b>AI 是怎么推出来的</b><ol class="paper-compare-steps">${steps.map(step=>`<li>${escape(step)}</li>`).join('')}</ol></div>`:''}
      ${why?`<div class="paper-compare-why"><b>${mine&&correct?(mismatch?'为什么这样答不对':'AI 的判断依据'):'AI 的判断'}</b><p>${escape(why)}</p></div>`:''}
      ${derived?'<div class="paper-compare-why paper-compare-feedback"><button type="button" data-paper-answer-wrong>这个答案不对</button><span class="muted"> 点了就清空上面的参考答案，等你手动填。</span></div>':''}
    </section>`;
  }
  function orderHtml(files,kind) {
    if (!files.length) return '';
    return `<ol class="paper-file-order">${files.map((file,index)=>`<li><span>第 ${index+1} 页 · ${escape(file.name)}</span><span><button type="button" data-paper-move="${kind}:${index}:-1" ${index===0?'disabled':''} aria-label="将第 ${index+1} 页上移">↑</button><button type="button" data-paper-move="${kind}:${index}:1" ${index===files.length-1?'disabled':''} aria-label="将第 ${index+1} 页下移">↓</button><button type="button" data-paper-remove="${kind}:${index}" aria-label="移除第 ${index+1} 页">×</button></span></li>`).join('')}</ol>`;
  }
  function renderPaper(panel) {
    if (ui.loadedFor!==owner()) {ui.draft=null;ui.paperFiles=[];ui.answerFiles=[];ui.questionImages={};ui.loadedFor=owner();void restore()}
    // 切 tab 时换入口：试卷上传要强制配答题卡，批量错题不需要。
    /* 旧版换入口会把学生刚选的照片连同草稿一起清空：只要点错一次 tab（比如手机上手滑碰到
       「试卷 + 答题卡」），刚拍好的练习题照片就没了，还会被要求再补一张根本不存在的答题卡。
       照片是学生自己选的，不能因为换入口就丢。现在：入口照换、照片留下。
       - 题目照片在两个入口都成立（试卷题目页 / 错题照片），一律保留；
       - 答题卡只在试卷入口有位置，回到批量入口时清掉并在提示里说明；
       - 草稿带着旧入口的 mode，清掉以免确认时串档。 */
    const entry=window.__eduPaperEntry==='examPaper'?'examPaper':'batch';
    if (entry!==ui.entry) {
      const toExamPaper=entry==='examPaper';
      const droppedAnswers=!toExamPaper&&ui.answerFiles.length;
      ui.entry=entry;
      ui.draft=null;ui.preflight=null;ui.preflightFor='';
      if (droppedAnswers) ui.answerFiles=[];
      if (ui.paperFiles.length||droppedAnswers) {
        ui.message=toExamPaper
          ? (ui.answerFiles.length?'已切到试卷上传：题目照片已保留，答题卡也在，可以直接开始。':'已切到试卷上传：题目照片已保留，还差答题卡（必传）。只想做练习题请点「批量错题」，照片不会丢。')
          : `已切到批量错题：题目照片已保留${droppedAnswers?'（答题卡不在这条流程里了）':''}，选几张错题照片即可，AI 自己判对错。`;
        ui.progress='';
      }
    }
    const examPaper=ui.entry==='examPaper';
    const pageTotal=ui.paperFiles.length+ui.answerFiles.length;
    const batchTotal=Math.max(1,Math.ceil(Math.max(ui.paperFiles.length,ui.answerFiles.length,1)/MAX_PAGES_PER_BATCH));
    panel.innerHTML=`<section class="panel paper-upload ${examPaper?'paper-upload--exam':'paper-upload--batch'}"><div class="head"><div><h2>${examPaper?'试卷 + 答题卡':'批量错题'}</h2><p class="muted">${examPaper
        ? `试卷和答题卡都要选，AI 结合两者按题号配对，以红笔批改和逐题得分为准。一页可以有多道题；超过 ${MAX_PAGES_PER_BATCH} 页自动分批，汇总成同一份草稿。`
        : `一张错题照片就是一份独立素材，可以连续添加多张；AI 会逐题读取题目和手写作答，不需要整理成整套试卷，也不需要答题卡。判不清的题会标成「你来定」，由你决定是否入库。`}</p></div><span class="pill">学生确认后入库</span></div>
      ${examPaper
        ? `<div class="paper-exam-pairing" aria-label="试卷与答题卡配对上传">
            <div class="paper-exam-source"><span class="paper-upload-step">A</span><label>试卷题目<input data-paper-files type="file" accept="image/*" multiple><small>上传题目页，可多页；每页可含多道题</small></label>${orderHtml(ui.paperFiles,'paper')}</div>
            <div class="paper-pair-link" aria-hidden="true">题号配对 <span>↔</span></div>
            <div class="paper-exam-source paper-exam-answer"><span class="paper-upload-step">B</span><label>答题卡 / 批改页<input data-answer-files type="file" accept="image/*" multiple><small>必传。AI 按题号对应答案、红笔批注和得分</small></label>${orderHtml(ui.answerFiles,'answer')}</div>
          </div>`
        : `<div class="paper-batch-queue"><div class="paper-batch-intro"><span class="paper-upload-step">照片队列</span><b>逐张加入你做错的题</b><p>可以一次多选，也可以分几次追加。只上传题目和自己的作答照片即可。</p></div>
            <label class="paper-batch-picker"><span class="paper-batch-plus" aria-hidden="true">＋</span><span>选择错题照片<small>JPG、PNG 或 WebP · 最多 ${MAX_FILES} 页</small></span><input data-paper-files type="file" accept="image/*" multiple></label>
            ${ui.paperFiles.length?`<div class="paper-batch-count">已加入 ${ui.paperFiles.length} 张照片 · ${pageTotal} 页 · 预计 ${batchTotal} 批</div>${orderHtml(ui.paperFiles,'paper')}`:'<p class="paper-batch-empty">还没有照片。加入后可调整顺序，也能移除单张。</p>'}</div>`}
      <p class="paper-mode-note">${examPaper?'两类照片都会按题号配对；缺少试卷或答题卡时不能开始。':'AI 依据题目和手写作答判断；没有手写过程时不会猜错因。'} 手写解题过程会作为薄弱点证据；空白答题区不会被猜。</p>
      <label class="paper-fast"><input type="checkbox" data-paper-fast ${ui.fastMode?'checked':''}> ⚡ 快速识别（默认关；同一张整页图实测约 40 秒，深度约 70 秒）
        <small>快速模式只读题干、作答和对错，不预判薄弱点与卡点，适合只想把题收进错题库。模型读整页图本身要推理上万 tokens，所以快得有限——想更快要按题裁图，或换更小的视觉模型。</small></label>
      <button class="primary" data-paper-analyze ${ui.busy||!ui.paperFiles.length?'disabled':''}>${ui.busy?'正在识别，请稍候…':examPaper?'配对并分析试卷':'识别这批错题'}</button>
      ${ui.progress?`<p class="paper-progress" role="status">${escape(ui.progress)}</p>`:''}
      ${preflightHtml()}
      ${ui.message?`<p class="paper-message" role="status">${escape(ui.message)}</p>`:''}
      ${ui.draft?`<section class="paper-review"><div class="head"><div><h3>目前已识别的题目</h3><p class="muted">${ui.draft.fast?'本次是快速识别：只读了题干、作答和对错，薄弱点与卡点没有预判——需要它们就取消「⚡ 快速识别」后把这页重新识别一遍。':'逐题核对 AI 的判断与依据；标着「你来定」的题是 AI 看不清，需要你自己决定。薄弱点按手写原文引用生成，确认后进入薄弱点体系；看不出来就不要勾。'}</p></div><span class="pill">${ui.draft.questions.length} 题 · ${ui.draft.batchCount||1} 批${ui.draft.fast?' · ⚡ 快速':''}</span></div>
        <div class="row paper-bulk"><button type="button" data-paper-select-all>全选</button><button type="button" data-paper-select-none>全不选</button><button type="button" data-paper-select-unknown>只选「你来定」</button></div>
        ${ui.draft.questions.map(itemHtml).join('')}
        <button class="primary" data-paper-confirm ${ui.busy?'disabled':''}>确认勾选题目，一键存入错题库</button></section>`:''}
    </section>`;
    panel.querySelector('[data-paper-files]').onchange=event=>{ui.paperFiles=[...ui.paperFiles,...event.target.files].slice(0,MAX_FILES);event.target.value='';ui.message='';renderPaper(panel)};
    const answerInput=panel.querySelector('[data-answer-files]');
    if(answerInput) answerInput.onchange=event=>{ui.answerFiles=[...ui.answerFiles,...event.target.files].slice(0,MAX_FILES);event.target.value='';ui.message='';renderPaper(panel)};
    const fastToggle=panel.querySelector('[data-paper-fast]');
    if(fastToggle) fastToggle.onchange=()=>{
      ui.fastMode=fastToggle.checked;
      /* 换了识别档位，之前的预检结论就不适用了，必须丢掉重来。 */
      ui.preflight=null;ui.preflightFor='';
      ui.message=ui.fastMode?'已切到快速识别：只读题干、作答和对错，实测约 40 秒/页，不预判薄弱点与卡点。':'已切到深度识别：会读每道题的手写过程、卡点与判错依据，实测约 70 秒/页。';
      renderPaper(panel);
    };
    panel.querySelectorAll('[data-paper-crop]').forEach(button=>button.onclick=()=>{
      const item=ui.draft?.questions?.find(question=>question.id===button.dataset.paperCrop);
      if(item)void openCrop(panel,item);
    });
    panel.querySelectorAll('[data-paper-image-file]').forEach(input=>input.onchange=async event=>{
      const file=event.target.files?.[0],itemId=input.dataset.paperImageFile;event.target.value='';if(!file)return;
      try {setQuestionImage(itemId,await compress(file),file.name);ui.message='相册图片已附到本题，确认入库后会一并保存。'}
      catch(error){ui.message='本题图片添加失败：'+error.message}
      renderPaper(panel);
    });
    panel.querySelectorAll('[data-paper-image-remove]').forEach(button=>button.onclick=()=>{
      delete ui.questionImages[button.dataset.paperImageRemove];ui.message='已移除这道题的待保存题图。';renderPaper(panel);
    });
    const setAll=predicate=>{
      panel.querySelectorAll('[data-paper-item]').forEach(card=>{card.querySelector('[data-paper-select]').checked=predicate(card)});
    };
    panel.querySelector('[data-paper-select-all]')?.addEventListener('click',()=>setAll(()=>true));
    panel.querySelector('[data-paper-select-none]')?.addEventListener('click',()=>setAll(()=>false));
    panel.querySelector('[data-paper-select-unknown]')?.addEventListener('click',()=>setAll(card=>card.dataset.paperStatus==='needs_review'));
    /* 「这个答案不对」：只针对 AI 自己推导的答案。
       点了就清空参考答案并聚焦，让学生自己填 —— 提交时那份答案会算作他确认的（provided）。 */
    panel.querySelectorAll('[data-paper-answer-wrong]').forEach(button=>{
      button.addEventListener('click',()=>{
        const card=button.closest('[data-paper-item]');
        const field=card&&card.querySelector('[data-paper-correct]');
        if(!field) return;
        field.value='';
        const compare=card.querySelector('.paper-compare');
        if(compare) compare.remove();
        field.focus();
        ui.message='已清空 AI 推导的答案，请把你确认的正确答案填进去。';
      });
    });
    panel.querySelectorAll('[data-paper-move]').forEach(button=>button.onclick=()=>{
      const [kind,rawIndex,rawStep]=button.dataset.paperMove.split(':');
      const files=kind==='paper'?ui.paperFiles:ui.answerFiles,index=Number(rawIndex),next=index+Number(rawStep);
      if (index<0 || next<0 || next>=files.length) return;
      [files[index],files[next]]=[files[next],files[index]];renderPaper(panel);
    });
    panel.querySelectorAll('[data-paper-remove]').forEach(button=>button.onclick=()=>{
      const [kind,rawIndex]=button.dataset.paperRemove.split(':');
      const files=kind==='paper'?ui.paperFiles:ui.answerFiles;
      files.splice(Number(rawIndex),1);ui.message='';renderPaper(panel);
    });
    /* 识别分两步：① 预检（这组照片值不值得识别）→ ② 真识别（建草稿）。
       预检会把「照片看不清 / 题目分不开 / 没读到做题过程」直接讲清楚，并给出下一步。 */
    const runPreflight=async(panel,{force=false}={})=>{
      const examPaperNow=ui.entry==='examPaper';
      if (!ui.paperFiles.length) {ui.message=examPaperNow?'请先选择试卷照片。':'请先选择至少 1 页错题照片。';return renderPaper(panel)}
      if (examPaperNow && !ui.answerFiles.length) {ui.message='试卷上传需要同时选答题卡；只想传几张错题照片请用「批量错题」页面。';return renderPaper(panel)}
      const signature=[...ui.paperFiles,...ui.answerFiles].map(file=>file.name+':'+file.size).join('|');
      if (!force && ui.preflight && ui.preflightFor===signature) return; // 同一组照片不重复预检
      ui.busy=true;ui.message='';ui.preflight=null;ui.progress='正在预检照片（能不能看清、题目有没有分开）…';renderPaper(panel);
      try {
        const paperImages=await Promise.all(ui.paperFiles.map(compress));
        const answerImages=await Promise.all(ui.answerFiles.map(compress));
        const report=await call('/v1/papers/preview',{method:'POST',body:JSON.stringify({
          paperImages,...(answerImages.length?{answerImages}:{}),mode:mode(),preflightOnly:true,fast:ui.fastMode!==false})});
        ui.preflight=report;
        /* 只有「能用」的报告才按这组照片缓存。识别失败（level==='bad'）时不缓存：
           否则同一张照片再选一次会直接命中缓存、连请求都不发，
           学生看到的就是「明明重新传了，还是上一道题那个错误」——像是有缓存黏着。 */
        ui.preflightFor=report.level==='bad'?'':signature;
        ui.message=report.level==='bad'?'这组照片先别入库，按下面的建议重拍会更省时间。':'';
      } catch(error) {ui.message='预检没做完：'+error.message+'。可以直接点识别，或重新选照片。'}
      finally {ui.busy=false;ui.progress='';renderPaper(panel)}
    };
    const runAnalyze=async(panel)=>{
      if (!ui.paperFiles.length) {ui.message=examPaper?'请先选择试卷照片。':'请先选择至少 1 页错题照片。';return renderPaper(panel)}
      if (examPaper && !ui.answerFiles.length) {ui.message='试卷上传需要同时选答题卡；只想传几张错题照片请用「批量错题」页面。';return renderPaper(panel)}
      ui.busy=true;ui.message='';ui.progress='正在压缩照片…';renderPaper(panel);
      try {
        const paperImages=await Promise.all(ui.paperFiles.map(compress));
        const answerImages=await Promise.all(ui.answerFiles.map(compress));
        const chunks=Math.max(Math.ceil(paperImages.length/MAX_PAGES_PER_BATCH),Math.ceil(answerImages.length/MAX_PAGES_PER_BATCH),1);
        let draft=null,questions=0;
        for (let index=0;index<chunks;index++) {
          const paperBatch=paperImages.slice(index*MAX_PAGES_PER_BATCH,(index+1)*MAX_PAGES_PER_BATCH);
          const answerBatch=answerImages.slice(index*MAX_PAGES_PER_BATCH,(index+1)*MAX_PAGES_PER_BATCH);
          if ([...paperBatch,...answerBatch].reduce((sum,image)=>sum+image.length,0)>MAX_TOTAL_CHARS)
            throw new Error(`第 ${index+1} 批照片合计过大，请减少这一批的页数`);
          ui.progress=`正在识别第 ${index+1}/${chunks} 批（${paperBatch.length} 页题目${answerBatch.length?` + ${answerBatch.length} 页答题卡`:''}）…`;
          renderPaper(panel);
          const result=await call('/v1/papers/preview',{method:'POST',body:JSON.stringify({
            paperImages:paperBatch,...(answerBatch.length?{answerImages:answerBatch}:{}),mode:mode(),fast:ui.fastMode!==false,...(draft?.id?{draftId:draft.id}:{})})});
          draft=result.draft;questions=Number(result.questionCount)||draft.questions.length;
        }
        ui.draft=draft;ui.progress='';ui.preflight=null;ui.preflightFor='';
        const unknown=(draft.questions||[]).filter(item=>item.status==='needs_review').length;
        const filled=(draft.questions||[]).filter(item=>item.processSteps?.length).length;
        ui.message=`已识别 ${questions} 题，其中 ${filled} 题读到了做题过程。`
          +(unknown?`${unknown} 题 AI 看不准，标了「你来定」，请你判断后决定入不入库。`:'请逐题核对题干、做题记录与卡点后勾选入库。')
          +'科目、知识点、错因我已经按识别结果填好了，可以直接改。';
      } catch(error) {ui.progress='';ui.message='识别未完成：'+error.message+'。照片仍在本页，可重试。'}
      finally {ui.busy=false;renderPaper(panel)}
    };
    panel.querySelector('[data-paper-analyze]').onclick=()=>runPreflight(panel);
    panel.querySelector('[data-preflight-continue]')?.addEventListener('click',()=>runAnalyze(panel));
    panel.querySelector('[data-preflight-anyway]')?.addEventListener('click',()=>runAnalyze(panel));
    panel.querySelector('[data-preflight-retry]')?.addEventListener('click',()=>{
      ui.preflight=null;ui.preflightFor='';ui.message='把照片重拍或重选后再点识别；一页只放 1~2 道题最稳。';
      panel.querySelector('[data-paper-files]')?.click();
      renderPaper(panel);
    });
    panel.querySelector('[data-paper-confirm]')?.addEventListener('click',async()=>{
      const report=message=>{ui.message=message;panel.querySelector('.paper-message')?.remove();
        panel.querySelector('[data-paper-analyze]').insertAdjacentHTML('afterend',`<p class="paper-message" role="status">${escape(message)}</p>`)};
      const selected=[...panel.querySelectorAll('[data-paper-item]')].filter(card=>card.querySelector('[data-paper-select]').checked);
      if (!selected.length) return report('请先勾选要加入错题库的题目。');
      const corrections=Object.fromEntries(selected.map(card=>[card.dataset.paperItem,{
        question:card.querySelector('[data-paper-question]').value.trim(),
        studentAnswer:card.querySelector('[data-paper-answer]').value.trim(),
        correctAnswer:card.querySelector('[data-paper-correct]').value.trim(),
        // 题干旁的批注：一行一条，单独一段，不混进解题过程
        marginNotes:(card.querySelector('[data-paper-notes]')||{}).value||'',
        // 归纳信息：AI 已自动填好，学生改过的值以这里为准
        subject:(card.querySelector('[data-paper-subject]')||{}).value||'',
        errorCause:(card.querySelector('[data-paper-cause]')||{}).value||'',
        knowledgePoints:(card.querySelector('[data-paper-points]')||{}).value||'',
        // 学生自己写的思路：写了就当成做题记录，并作为薄弱点证据
        studentProcess:(card.querySelector('[data-paper-mine]')||{}).value||''}]));
      if (Object.values(corrections).some(item=>!item.question)) return report('勾选题目的题干不能为空。');
      // 勾了「需要 3D 模型」的题：随入库一起排队生成，不用之后再回错题库点
      const model3dIds=selected.filter(card=>card.querySelector('[data-paper-3d]')?.checked).map(card=>card.dataset.paperItem);
      const questionImages=Object.fromEntries(selected.map(card=>[card.dataset.paperItem,ui.questionImages[card.dataset.paperItem]?.dataUrl])
        .filter(([,dataUrl])=>Boolean(dataUrl)));
      const questionImageBytes=Object.values(questionImages).reduce((total,dataUrl)=>total+Math.floor(dataUrl.length*.75),0);
      if(questionImageBytes>5*1024*1024)return report('每题题图总量超过 5 MB，请移除部分附图或缩小裁切范围后重试。');
      ui.busy=true;panel.querySelector('[data-paper-confirm]').disabled=true;
      try {
        const result=await call('/v1/papers/drafts/'+encodeURIComponent(ui.draft.id)+'/confirm',
          {method:'POST',body:JSON.stringify({selectedIds:selected.map(card=>card.dataset.paperItem),corrections,model3dCaseIds:model3dIds,questionImages})});
        const saved=result.mistakeCases||[];
        const fresh=Array.isArray(result.weakPoints)?result.weakPoints:[];
        state.mistakes=[...saved,...(state.mistakes||[]).filter(item=>!saved.some(entry=>entry.id===item.id))];
        if (fresh.length) state.wqWeakPoints=[...fresh,...(Array.isArray(state.wqWeakPoints)?state.wqWeakPoints:[])];
        window.__wqWeakFetchedAt=0;
        // 勾了 3D 的题：立刻标成「正在生成中」，交给已有的轮询在后台收尾
        const queued=Array.isArray(result.geometryQueue)?result.geometryQueue:[];
        for (const entry of queued) {
          const index=state.mistakes.findIndex(item=>item.id===entry.id);
          if (index>=0) state.mistakes[index]={...state.mistakes[index],geometryModelRequested:true,
            geometryBuildStatus:'queued',modelMessage:entry.message||'正在后台生成 3D 模型…'};
        }
        ui.draft=null;ui.paperFiles=[];ui.answerFiles=[];ui.questionImages={};ui.message='';
        if (typeof window.__eduPaperDone==='function') window.__eduPaperDone(saved,fresh);
        ui.message=`已入库 ${saved.length} 题`
          +(fresh.length?`，并从做题记录生成 ${fresh.length} 条薄弱点`:'')
          +(queued.length?`；${queued.length} 道立体几何题正在后台生成 3D 模型，好了会自动出现在错题库`:'')
          +'。';
        state.tab='library';save();render();
        // 入库后页面切到错题库，轮询让模型生成完自动出现
        if (typeof window.__wqWatchGeometryBuild==='function') {
          for (const entry of queued) window.__wqWatchGeometryBuild(entry.id);
        }
      } catch(error) {ui.busy=false;panel.querySelector('[data-paper-confirm]').disabled=false;
        report('入库未完成：'+error.message+'；核对内容仍在本页，请重试。')}
    });
  }
  async function restore() {
    try {
      const current=owner(),result=await call('/v1/papers/drafts/latest');
      if (owner()===current && result?.draft?.status==='awaiting_confirmation') {
        ui.draft=result.draft;
        if (document.querySelector('[data-paper-panel]')) renderPaper(document.querySelector('[data-paper-panel]'));
      }
    } catch {}
  }
  window.__eduPaperUploadRender=renderPaper;
})();
