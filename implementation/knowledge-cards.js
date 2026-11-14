(function(){
  'use strict';
  var app=null,busy=false,lastLoad=0;
  var ui={cards:[],filter:'today',subject:'全部',editingCardId:null,editDraft:null,answers:{},selfRatings:{},reviewAttempts:{},results:{},error:'',note:{title:'',subject:'数学',knowledgePoint:'',content:'',sourceType:'paste'},newCardText:'',newFrontText:'',newBackText:'',promptedRounds:new Set()};
  var style=document.createElement('style');
  style.textContent='.kc-shell{margin-top:16px}.kc-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.kc-tabs button.active{background:#315efb;color:#fff}.kc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}.kc-card{border:1px solid #dce5f5;border-radius:18px;padding:16px;background:#fff}.kc-card.challenge{background:linear-gradient(145deg,#f4f8ff,#fffaf2);border-color:#a9c4ff}.kc-card label{display:block;margin:10px 0 4px;font-size:13px;color:#52637c}.kc-card input,.kc-card textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:10px;border:1px solid #ccd8eb;border-radius:10px;font:inherit}.kc-card textarea{min-height:120px}.kc-star{color:#e79c00;font-size:18px}.kc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.kc-actions button{padding:8px 12px}.kc-answer{width:100%;min-height:88px;margin-top:10px}.kc-feedback{background:#ecf5ff;border:1px solid #b8d2ff;border-radius:10px;padding:12px;margin-top:10px}.kc-note{display:grid;grid-template-columns:1fr 1fr;gap:10px}.kc-note textarea{grid-column:1/-1;min-height:130px}.kc-status{font-size:13px;color:#65738b}.kc-source{font-size:13px;color:#6a7382}.kc-empty{padding:22px;text-align:center;color:#758095;border:1px dashed #c8d3e5;border-radius:14px}.kc-rotation{max-width:720px;margin:18px auto}.kc-rotation .kc-card{box-shadow:0 18px 48px rgba(49,94,251,.12)}.kc-rotation-progress{height:8px;background:#e6edff;border-radius:999px;overflow:hidden;margin:12px 0}.kc-rotation-progress i{display:block;height:100%;background:linear-gradient(90deg,#315efb,#72a8ff);border-radius:inherit}.kc-rotation-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.kc-math-preview{min-height:24px;margin:7px 0 14px;padding:10px 12px;border:1px solid #dbe6f8;border-radius:12px;background:#f6f9ff;color:#1e3556;line-height:1.85;overflow-x:auto;overflow-wrap:anywhere}.kc-math-preview:empty{display:none}.kc-math-preview-label{margin:6px 0 0;font-size:12px;color:#6c7b91}.kc-composer-side{margin-top:14px;padding:14px;border:1px solid #dbe6f8;border-radius:14px;background:#fbfdff}.kc-composer-side h3{margin:0 0 8px}.kc-source-options{display:grid;gap:8px}.kc-card label.kc-source-option{display:flex;align-items:flex-start;gap:9px;padding:10px;border:1px solid #e1e9f6;border-radius:11px;background:#fff;margin:0}.kc-source-option input[type=checkbox]{display:block;flex:0 0 auto;width:18px;height:18px;margin:2px 0 0;accent-color:#315efb}.kc-source-option span{min-width:0}.kc-source-option b,.kc-source-option small{display:block}.kc-source-option small{margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere;color:#66758a;max-height:88px;overflow:auto}.kc-composer-side textarea{min-height:130px}.kc-edit-previews{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.kc-edit-preview{min-width:0;min-height:100px;padding:14px;border:1px solid #c7d9ff;border-radius:14px;background:#f6f9ff;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}.kc-edit-preview.back{background:#fffaf0;border-color:#eed9a8}.kc-edit-preview b{display:block;margin-bottom:8px;font-size:12px;color:#3158a4}.kc-edit-preview .kc-preview-text:empty:after{content:attr(data-placeholder);color:#758095}@media(max-width:720px){.kc-note{grid-template-columns:1fr}.kc-note textarea{grid-column:auto}.kc-edit-previews{grid-template-columns:1fr}}';
  document.head.appendChild(style);
  var promptStyle=document.createElement('style');
  promptStyle.textContent='.kc-finish-dialog{max-width:min(440px,calc(100vw - 28px));border:1px solid #d8e3f8;border-radius:18px;background:#fffefa;color:#142847;padding:20px;box-shadow:0 18px 42px #1428472b}.kc-finish-dialog::backdrop{background:#14284788}.kc-finish-dialog h2{margin:0 0 10px}.kc-finish-dialog .row{justify-content:flex-end}.kc-new{max-width:720px;margin:16px auto}.kc-new textarea{min-height:180px}.kc-new .row{margin-top:12px}.kc-new-meta{font-size:13px;color:#56677e}.kc-share-after{display:flex!important;align-items:flex-start;gap:9px;margin:14px 0;padding:12px;border:1px solid #d8e3f8;border-radius:12px;background:#f7faff;font-size:14px;color:#344762}.kc-share-after input{width:auto;margin:3px 0 0;flex:0 0 auto}';
  document.head.appendChild(promptStyle);
  var composerStyle=document.createElement('style');
  composerStyle.textContent='.kc-new{max-width:980px}.kc-composer-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;margin-top:18px}.kc-composer-side{margin:0;background:#fffefa;border:1px solid #b8cbe9;box-shadow:6px 7px 0 #e2ebff;border-radius:18px}.kc-composer-side.back{box-shadow:6px 7px 0 #fff0c2}.kc-composer-side h3{color:#142847}.kc-composer-side .kc-side-help{font-size:13px;color:#52637c;margin:0 0 12px}.kc-card-preview{min-height:145px;margin:12px 0 18px;padding:18px;border:1px solid #b9cbe6;border-radius:15px;background:#fff;box-shadow:4px 5px 0 #e7efff}.kc-composer-side.back .kc-card-preview{background:#fffdf5;box-shadow:4px 5px 0 #fff0c2}.kc-card-preview .kc-preview-label{display:block;margin-bottom:12px;color:#3158a4;font-size:12px;font-weight:700}.kc-preview-body{white-space:pre-wrap;line-height:1.7;overflow-wrap:anywhere;color:#142847}.kc-preview-body:empty:before{content:attr(data-placeholder);color:#66758a}.kc-source-option:has(input:checked){border-color:#6d95e9;background:#f6f9ff}.kc-source-option:focus-within{outline:2px solid #3369e8;outline-offset:2px}.kc-composer-side .kc-source-option small{max-height:none;overflow:visible;white-space:pre-wrap}.kc-composer-side textarea{min-height:135px}.kc-new .row button{min-height:44px}@media(max-width:760px){.kc-composer-grid{grid-template-columns:1fr}.kc-composer-side{box-shadow:4px 5px 0 #e2ebff}}';
  document.head.appendChild(composerStyle);

  function e(value){return app.esc(String(value==null?'':value))}
  function typesetChallengeFronts(root){
    if(!root||!window.renderMathInElement)return;
    root.querySelectorAll('.kc-front-prompt').forEach(function(node){
      var raw=node.textContent||'',normalized=window.__eduNormalizeMathDelimiters?.(raw)||raw;
      node.textContent=window.EduMathDisplay?.wrapBareLatex?.(normalized)||normalized;
      try{window.renderMathInElement(node,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,strict:'ignore'})}catch(_){}
    });
  }
  function sourceOptions(details,point){
    var front=[],back=[];
    function add(list,id,label,value,checked){var text=String(value==null?'':value).trim();if(text)list.push({id:id,label:label,text:text,checked:!!checked})}
    function usefulTutorExcerpt(value,kind){
      var text=String(value==null?'':value).trim();if(!text)return'';
      if(kind==='directAnswer'&&/暂不公布最终(?:数值|答案)/.test(text))return'';
      if(kind==='understanding'&&/(?:你|学生)(?:已经|明确|仍然).{0,36}(?:不会|不懂|没有写出|尚未写出)|没有写出可确认的解题步骤/.test(text))return'';
      if(kind==='explanation'&&/(?:当前目标仍是|我们需要从.{0,30}开始.{0,40}(?:把题目转化|重新开始)|只是先推进到)/.test(text))return'';
      return text;
    }
    add(front,'knowledge-point','主要知识点','知识点：'+point,true);
    (Array.isArray(details.knowledgePoints)?details.knowledgePoints:[]).forEach(function(value,index){var text=String(value||'').trim();if(text&&text!==point)add(front,'related-knowledge-'+index,'相关知识点 '+(index+1),'知识点：'+text,false);});
    (Array.isArray(details.microSkills)?details.microSkills:[]).forEach(function(value,index){add(front,'method-'+index,'解题方法要点 '+(index+1),'解题方法：'+value,true);});
    (Array.isArray(details.knowledgePoints)?details.knowledgePoints:[]).forEach(function(value,index){var text=String(value||'').trim();if(text&&text!==point)add(back,'related-knowledge-back-'+index,'相关知识点 '+(index+1),'知识点：'+text,false);});
    (Array.isArray(details.microSkills)?details.microSkills:[]).forEach(function(value,index){add(back,'method-back-'+index,'解题方法要点 '+(index+1),'解题方法：'+value,false);});
    add(front,'question','本题题目',details.caseQuestion&&'题目：'+details.caseQuestion,true);
    add(back,'question-back','本题题目',details.caseQuestion&&'题目：'+details.caseQuestion,false);
    add(front,'weak-point','薄弱点',details.weakPoint&&'薄弱点：'+details.weakPoint,false);
    add(back,'weak-point-back','薄弱点',details.weakPoint&&'薄弱点：'+details.weakPoint,false);
    (Array.isArray(details.errorCauses)?details.errorCauses:[]).forEach(function(cause,index){add(front,'error-cause-'+index,'错因 '+(index+1),'错因：'+cause,false);add(back,'error-cause-back-'+index,'错因 '+(index+1),'错因：'+cause,false)});
    add(front,'wrong-answer','我当时的错误答案',details.studentAnswer&&'我当时写的是：'+details.studentAnswer,false);
    add(back,'wrong-answer-back','我当时的错误答案',details.studentAnswer&&'我当时写的是：'+details.studentAnswer,false);
    add(front,'correct-answer','正确答案',details.correctAnswer&&'正确答案：'+details.correctAnswer,false);
    add(back,'correct-answer-back','正确答案',details.correctAnswer&&'正确答案：'+details.correctAnswer,false);
    var turns=Array.isArray(details.tutorTurns)?details.tutorTurns:[];
    turns.forEach(function(turn,index){
      var number=index+1;
      add(front,'student-turn-'+index,'第 '+number+' 轮 · 我的问题/作答',turn.studentMessage&&'我的问题/作答：'+turn.studentMessage,false);
      add(front,'guide-question-'+index,'第 '+number+' 轮 · AI 追问',turn.nextQuestion&&'想一想：'+turn.nextQuestion,false);
      add(back,'ai-answer-'+index,'第 '+number+' 轮 · AI 直接回答',usefulTutorExcerpt(turn.directAnswer,'directAnswer'),false);
      add(back,'ai-understanding-'+index,'第 '+number+' 轮 · AI 引导思路',usefulTutorExcerpt(turn.understanding,'understanding'),false);
      add(back,'ai-explanation-'+index,'第 '+number+' 轮 · AI 讲解原文',usefulTutorExcerpt(turn.explanation,'explanation'),false);
      add(back,'ai-question-'+index,'第 '+number+' 轮 · AI 追问',turn.nextQuestion,false);
    });
    if(!turns.length){
      add(front,'thinking-question','AI 引导思考',details.thinkingQuestion&&'想一想：'+details.thinkingQuestion,false);
      (Array.isArray(details.learnedContent)?details.learnedContent:[]).forEach(function(value,index){add(back,'learned-'+index,'陪练片段 '+(index+1),value,false)});
    }
    return {front:front,back:back};
  }
  function promptAfterTutor(details){
    if(!app||!details||!details.caseId)return;
    var round=String(details.roundId||details.caseId);
    if(ui.promptedRounds.has(round))return;
    ui.promptedRounds.add(round);
    var point=String(details.knowledgePoint||'这个知识点').trim();
    var weak=String(details.weakPoint||'').trim();
    var dialog=document.createElement('dialog');
    dialog.className='kc-finish-dialog';
    dialog.setAttribute('aria-labelledby','kc-finish-title');
    dialog.innerHTML='<span class="pill good">本轮陪练结束</span><h2 id="kc-finish-title">留下你的独门秘籍？</h2>'
      +'<p>刚练过「'+e(point)+'」'+(weak?'，也看到了「'+e(weak)+'」这个卡点':'')+'。用自己的话写一句提醒，下次复习就只看这个知识点，不重复看整道原题。</p>'
      +'<div class="row"><button type="button" data-kc-prompt-skip>直接跳过</button><button type="button" class="primary" data-kc-prompt-create>好的，去记录</button></div>';
    document.body.appendChild(dialog);
    function close(){dialog.close();dialog.remove()}
    dialog.querySelector('[data-kc-prompt-skip]').onclick=close;
    dialog.querySelector('[data-kc-prompt-create]').onclick=function(){
      close();
      startKnowledgeCard(details);
    };
    dialog.addEventListener('cancel',function(){setTimeout(function(){dialog.remove()},0)});
    dialog.showModal();
  }

  function startKnowledgeCard(details){
    var point=String(details.knowledgePoint||'这个知识点').trim(),question=String(details.caseQuestion||'').trim();
    var sources=sourceOptions(details,point);
    var frontOptions=Array.isArray(details.frontOptions)&&details.frontOptions.length?details.frontOptions.slice():sources.front;
    // 老入口/旧缓存可能只传了知识点素材；非空 frontOptions 会覆盖 sourceOptions，
    // 因此必须把当前错题原题合并进去，否则卡片只剩知识点。若学生明确取消则保留取消状态。
    if(question){
      var questionText='题目：'+question;
      var questionIndex=frontOptions.findIndex(function(item){return item.id==='question'||item.label==='本题题目'});
      if(questionIndex<0)frontOptions.push({id:'question',label:'本题题目',text:questionText,checked:true});
      else frontOptions[questionIndex]=Object.assign({},frontOptions[questionIndex],{id:'question',label:'本题题目',text:questionText,checked:frontOptions[questionIndex].checked!==false});
    }
    if(!frontOptions.length){
      if(question)frontOptions.push({id:'question',label:'本题题目',text:'题目：'+question,checked:true});
      frontOptions.push({id:'knowledge-point',label:'对应知识点',text:'知识点：'+point,checked:true});
      if(details.thinkingQuestion)frontOptions.push({id:'thinking-question',label:'AI 引导思考问题',text:'引导思考：'+String(details.thinkingQuestion).trim(),checked:true});
    }
    var backOptions=Array.isArray(details.backOptions)&&details.backOptions.length?details.backOptions.slice():sources.back;
    if(!backOptions.length){var learned=Array.isArray(details.learnedContent)?details.learnedContent:[];backOptions=learned.map(function(text,index){return{id:'ai-'+index,label:'AI 陪练片段 '+(index+1),text:String(text||'').trim(),checked:false}}).filter(function(item){return item.text});if(backOptions.length)backOptions[backOptions.length-1].checked=true}
    frontOptions=frontOptions.map(function(item,index){return{id:String(item.id||'front-'+index),label:String(item.label||'正面素材 '+(index+1)),text:String(item.text||'').trim(),checked:item.checked!==false}}).filter(function(item){return item.text});
    backOptions=backOptions.map(function(item,index){return{id:String(item.id||'back-'+index),label:String(item.label||'陪练片段 '+(index+1)),text:String(item.text||'').trim(),checked:item.checked!==false}}).filter(function(item){return item.text});
    var frontText=frontOptions.filter(function(item){return item.checked}).map(function(item){return item.text}).join('\n\n');
    var backText=backOptions.filter(function(item){return item.checked}).map(function(item){return item.text}).join('\n\n')||String(details.draftText||'').trim();
    app.state.pendingKnowledgeCard={caseId:details.caseId,knowledgePoint:point,subject:details.subject||'数学',returnTab:app.state.tab,frontOptions:frontOptions,backOptions:backOptions,shareAfterSave:false};
    ui.newFrontText=frontText;ui.newBackText=backText;ui.newCardText=backText;ui.error='';app.state.tab='knowledge-card-new';app.save();app.render();
  }

  function renderCreate(v){
    var pending=app.state.pendingKnowledgeCard||{};
    if(!ui.newBackText&&ui.newCardText)ui.newBackText=ui.newCardText;
    if(!ui.newBackText&&pending.draftText){ui.newBackText=String(pending.draftText);ui.newCardText=ui.newBackText}
    v.className='work';
    v.innerHTML='<section class="panel kc-new"><span class="pill good">新建知识卡</span><h2>把这次学会的方法留下来</h2>'
      +'<p class="kc-new-meta">'+e(pending.subject||'数学')+' · '+e(pending.knowledgePoint||'知识点')+' · 默认只进个人库；勾选后才同步到共享广场</p>'
      +'<div class="kc-new-meta">先勾选正面要给自己的提示，再挑选 AI 陪练里最有用的一段放到背面；两面都能继续编辑。</div>'
      +'<div class="kc-composer-grid">'
      +'<section class="kc-composer-side"><h3>卡片正面 · 先看到什么？</h3><p class="kc-side-help">默认放入原题、主要知识点和具体解题方法；相关知识点、错因、答案及对话引导均可选择或编辑。</p><div class="kc-source-options" data-kc-front-options>'+selectionOptions(pending.frontOptions,'front')+'</div><label for="kc-new-front">正面内容（可继续修改）</label><textarea id="kc-new-front" data-kc-front-content maxlength="8000" placeholder="勾选素材，或自己写一个复习提示">'+e(ui.newFrontText)+'</textarea><div class="kc-card-preview" data-kc-front-preview aria-live="polite"><span class="kc-preview-label">正面预览 · 先回忆</span><div class="kc-preview-body" data-kc-preview-body data-placeholder="这里会显示卡片正面"></div></div></section>'
      +'<section class="kc-composer-side back"><h3>卡片背面 · 翻开后看什么？</h3><p class="kc-side-help">可挑选错因、错答、正确答案及 AI 的讲解原文；不含陪练状态提示。每段可单独勾选并继续编辑。</p><div class="kc-source-options" data-kc-back-options>'+selectionOptions(pending.backOptions,'back')+'</div><label for="kc-new-back">背面内容（可继续修改）</label><textarea id="kc-new-back" data-kc-back-content maxlength="8000" placeholder="勾选有用的内容，再编辑成自己看得懂的理解">'+e(ui.newBackText)+'</textarea><div class="kc-card-preview" data-kc-back-preview aria-live="polite"><span class="kc-preview-label">背面预览 · 翻卡后看到</span><div class="kc-preview-body" data-kc-preview-body data-placeholder="这里会显示卡片背面"></div></div></section>'
      +'</div>'
      +'<label class="kc-share-after"><input type="checkbox" data-kc-share-after '+(pending.shareAfterSave?'checked':'')+'> 保存到个人库后，同时分享到共享知识库（勾选即确认其他学生可查看卡片内容）</label>'
      +(ui.error?'<p class="geometry-alert" role="status">'+e(ui.error)+'</p>':'')
      +'<div class="row"><button type="button" class="primary" data-kc-new-save '+(busy?'disabled':'')+'>保存并加入复习</button><button type="button" data-kc-new-back>暂不记录</button></div></section>';
    bindComposer(v,pending);
    var shareAfter=v.querySelector('[data-kc-share-after]');if(shareAfter)shareAfter.onchange=function(){pending.shareAfterSave=shareAfter.checked;app.save()};
    v.querySelector('[data-kc-new-back]').onclick=function(){app.state.tab=pending.returnTab||'library';delete app.state.pendingKnowledgeCard;app.save();app.render()};
    v.querySelector('[data-kc-new-save]').onclick=async function(){
      // 保存瞬间重新读取 checkbox，而不是只信赖 change 回调写入的内存草稿。
      // 个别移动端/重绘时 change 与保存点击会紧邻发生，旧草稿会丢掉已勾选原题。
      (pending.frontOptions||[]).forEach(function(item){var input=v.querySelector('[data-kc-front-option="'+CSS.escape(item.id)+'"]');if(input)item.checked=input.checked});
      // 文本框也以 DOM 为准：任何一次外层重渲染都可能让 ui.newFrontText / ui.newBackText 过期。
      var frontField=v.querySelector('[data-kc-front-content]'),backField=v.querySelector('[data-kc-back-content]');
      if(frontField)ui.newFrontText=frontField.value;
      if(backField){ui.newBackText=backField.value;ui.newCardText=backField.value}
      var frontContent=String(ui.newFrontText||'').trim(),backContent=String(ui.newBackText||'').trim();
      var selectedQuestion=(pending.frontOptions||[]).find(function(item){return (item.id==='question'||item.label==='本题题目')&&item.checked});
      if(selectedQuestion&&!frontContent.includes(selectedQuestion.text))frontContent=selectedQuestion.text+(frontContent?'\n\n'+frontContent:'');
      ui.newFrontText=frontContent;
      if(backContent.length<8){ui.error='请在卡片背面留下至少 8 个字的理解或陪练要点。';return renderCreate(v)}
      // 正面为空又没有可回填的题干时直接拦下：这种卡进了队列只会显示兜底句，看起来正常其实没有线索。
      var hasQuestionOption=(pending.frontOptions||[]).some(function(item){return (item.id==='question'||item.label==='本题题目')&&String(item.text||'').trim()});
      if(!frontContent&&!hasQuestionOption){ui.error='卡片正面是空的，这道题也没有可回填的题干：请自己写一句正面提示再保存。';return renderCreate(v)}
      if(!frontContent)console.warn('[knowledge-card] 正面为空，已显式传空串，交给服务端用原题回填。');
      busy=true;ui.error='';renderCreate(v);
      try{
        var savedResult=await app.request('/v1/study/understanding',{method:'POST',body:JSON.stringify({text:backContent,frontContent:frontContent,backContent:backContent,title:pending.knowledgePoint+' · 复习卡',knowledgePoint:pending.knowledgePoint,subject:pending.subject,sourceCaseIds:pending.caseId?[pending.caseId]:[],trigger:'tutor_complete'})});
        ui.cards=await app.request('/v1/knowledge-cards');
        var savedCard=ui.cards.find(function(item){return item.id===savedResult.card?.id})||savedResult.card;
        if(savedCard&&pending.shareAfterSave){
          try{
            await app.request('/v1/shared-knowledge/share',{method:'POST',body:JSON.stringify({cardId:savedCard.id,sharingConfirmed:true})});
            window.__eduSharedKnowledgeRefresh?.();
            app.state.lastKnowledgeCardShare='知识卡已先保存到个人库，并已分享到共享知识库。';
          }catch(shareError){app.state.lastKnowledgeCardShare='知识卡已保存到个人库，但分享到共享广场失败：'+shareError.message+'。可在卡库中稍后重试。'}
        }else if(savedCard){app.state.lastKnowledgeCardShare='知识卡已保存到个人库。';}
        ui.newCardText='';ui.newFrontText='';ui.newBackText='';delete app.state.pendingKnowledgeCard;app.save();
        if(savedCard&&window.__openKnowledgeCardLibrary)window.__openKnowledgeCardLibrary(savedCard.id);
        else{app.state.tab='card-challenge';app.render()}
      }catch(error){busy=false;ui.error='保存失败：'+error.message+'。你的文字还在，可以重试。';app.render()}
      finally{busy=false}
    };
  }
  function selectionOptions(items,side){
    return (Array.isArray(items)?items:[]).map(function(item){return '<label class="kc-source-option"><input type="checkbox" data-kc-'+side+'-option="'+e(item.id)+'" '+(item.checked?'checked':'')+'><span><b>'+e(item.label)+'</b><small>'+e(item.text)+'</small></span></label>'}).join('')||'<p class="kc-status">暂时没有可选素材；可以直接编辑下面的内容。</p>';
  }
  function bindComposer(root,pending){
    var front=root.querySelector('[data-kc-front-content]'),back=root.querySelector('[data-kc-back-content]');
    function updatePreview(field,node){
      if(!node)return;
      var body=node.querySelector('[data-kc-preview-body]');if(!body)return;
      var raw=field.value||'';
      var normalized=window.__eduNormalizeMathDelimiters?.(raw)||raw;
      body.textContent=window.EduMathDisplay?.wrapBareLatex?.(normalized)||normalized;
      if(window.renderMathInElement)try{window.renderMathInElement(body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,strict:'ignore'})}catch{};
    }
    function updateFromOptions(side,field){
      var key=side==='front'?'frontOptions':'backOptions',options=pending[key]||[];
      var previous=options.filter(function(item){return item.checked}).map(function(item){return item.text}).join('\n\n');
      var added=[],removed=[];
      options.forEach(function(item){var checkbox=root.querySelector('[data-kc-'+side+'-option="'+CSS.escape(item.id)+'"]');if(!checkbox||checkbox.checked===item.checked)return;(checkbox.checked?added:removed).push(item.text);item.checked=checkbox.checked});
      var selected=options.filter(function(item){return item.checked}).map(function(item){return item.text}).join('\n\n');
      var current=field.value;
      if(current===previous)current=selected;
      else{
        removed.forEach(function(value){var block=current.indexOf(value);if(block<0)return;current=(current.slice(0,block)+current.slice(block+value.length)).replace(/^\n\n|\n\n$/g,'').replace(/\n{3,}/g,'\n\n')});
        added.forEach(function(value){if(!current.includes(value))current+=(current.trim()?'\n\n':'')+value});
      }
      field.value=current;if(side==='front')ui.newFrontText=current;else{ui.newBackText=current;ui.newCardText=current}updatePreview(field,root.querySelector('[data-kc-'+side+'-preview]'));
    }
    root.querySelectorAll('[data-kc-front-option]').forEach(function(input){input.onchange=function(){updateFromOptions('front',front)}});
    root.querySelectorAll('[data-kc-back-option]').forEach(function(input){input.onchange=function(){updateFromOptions('back',back)}});
    front.oninput=function(){ui.newFrontText=front.value;updatePreview(front,root.querySelector('[data-kc-front-preview]'))};
    back.oninput=function(){ui.newBackText=back.value;ui.newCardText=back.value;updatePreview(back,root.querySelector('[data-kc-back-preview]'))};
    updatePreview(front,root.querySelector('[data-kc-front-preview]'));updatePreview(back,root.querySelector('[data-kc-back-preview]'));
  }
  function due(card){return card.masteryStatus!=='mastered'&&card.reviewSchedule&&card.reviewSchedule.dueAt&&card.reviewSchedule.dueAt<=new Date().toISOString()}
  function subjectCards(){return ui.subject==='全部'?ui.cards:ui.cards.filter(function(card){return (card.subject||'未分类')===ui.subject})}
  function filtered(){
    var cards=subjectCards();
    if(ui.filter==='favorite')return cards.filter(function(card){return card.favorite});
    if(ui.filter==='mastered')return cards.filter(function(card){return card.masteryStatus==='mastered'});
    if(ui.filter==='today')return cards.filter(due);
    return cards;
  }
  function dynamicDetails(card){
    var parts=[];
    if(card.nextTimeAction)parts.push('<p><b>下次怎么想：</b>'+e(card.nextTimeAction)+'</p>');
    if(card.memoryHook)parts.push('<p><b>记忆钩子：</b>'+e(card.memoryHook)+'</p>');
    if(card.sourceQuotes&&card.sourceQuotes.length)parts.push('<details><summary>查看真实来源证据</summary>'+card.sourceQuotes.map(function(q){return '<p class="kc-source">“'+e(q)+'”</p>'}).join('')+'</details>');
    return parts.join('');
  }
  function challenge(card){
    var result=ui.results[card.id],answer=ui.answers[card.id]||'';
    var front=String(card.frontContent||card.challengePrompt||'').trim();
    return '<article class="kc-card challenge"><div class="head"><div><span class="pill">'+e(card.cardKind||'知识卡')+'</span><h3>先回忆卡片正面</h3></div>'+(card.starredAsRecurring?'<span class="kc-star" title="相似卡点重复出现">★ ×'+Number(card.recurrenceCount||1)+'</span>':'')+'</div><div class="kc-front-prompt" style="white-space:pre-wrap;line-height:1.75;font-size:17px;padding:14px;border:1px solid #dbe6f8;border-radius:12px;background:#fff">'+e(front||'这张卡片正面还没有内容，请先编辑添加提示。')+'</div><p><b>回忆任务：</b>根据正面提示作答，不要直接照抄背面。</p><textarea class="kc-answer" data-kc-answer="'+e(card.id)+'" placeholder="先用自己的话回忆、判断或说明方法">'+e(answer)+'</textarea><div class="kc-self-rating" role="group" aria-label="作答前自评"><p class="kc-self-label">先选一个：你觉得自己掌握了吗？AI 会单独评价你的回答。</p>'+[['again','不会'],['unsure','有点模糊'],['know','会了']].map(function(option){return '<button type="button" data-kc-self-rating="'+e(card.id)+'" data-rating="'+option[0]+'" aria-pressed="'+(ui.selfRatings[card.id]===option[0])+'">'+option[1]+'</button>'}).join('')+'</div><div class="kc-actions"><button class="primary" data-kc-review="'+e(card.id)+'" '+(busy?'disabled':'')+'>提交闯关</button><button data-kc-favorite="'+e(card.id)+'">'+(card.favorite?'取消收藏':'收藏')+'</button></div>'+(result?'<div class="kc-feedback"><b>'+e(result.correctness==='correct'?'回答正确':result.correctness==='partial'?'部分正确':'回答错误')+'</b><p>'+e(result.feedback)+'</p><p><b>本卡结论：</b>'+e(card.insight)+'</p>'+dynamicDetails(card)+'<button data-kc-next="'+e(card.id)+'">继续下一张</button></div>':'<p class="kc-status">结论已隐藏。提交后会明确告诉你答对、部分正确还是错误。</p>')+'</article>';
  }
  function libraryCard(card){
    if(ui.editingCardId===card.id){var draft=ui.editDraft||card;return '<article class="kc-card"><h3>编辑知识卡</h3><label>标题<input data-kc-edit-field="title" value="'+e(draft.title)+'" maxlength="120"></label><label>学科<input data-kc-edit-field="subject" value="'+e(draft.subject)+'" maxlength="40"></label><label>知识点<input data-kc-edit-field="knowledgePoint" value="'+e(draft.knowledgePoint)+'" maxlength="120"></label><label>正面内容（学生先看到的提示）<textarea data-kc-edit-field="frontContent" maxlength="8000">'+e(draft.frontContent||draft.challengePrompt||'')+'</textarea></label><label>背面内容（翻卡后看到的答案与理解）<textarea data-kc-edit-field="backContent" maxlength="8000">'+e(draft.backContent||draft.content||draft.insight||'')+'</textarea></label><div class="kc-edit-previews" aria-live="polite"><div class="kc-edit-preview"><b>正面预览 · 学生先看到</b><div class="kc-preview-text kc-front-prompt" data-kc-edit-preview="frontContent" data-placeholder="正面暂时为空">'+e(draft.frontContent||draft.challengePrompt||'')+'</div></div><div class="kc-edit-preview back"><b>背面预览 · 翻卡后看到</b><div class="kc-preview-text kc-front-prompt" data-kc-edit-preview="backContent" data-placeholder="背面暂时为空">'+e(draft.backContent||draft.content||draft.insight||'')+'</div></div></div><div class="kc-actions"><button class="primary" data-kc-edit-save="'+e(card.id)+'">保存修改</button><button data-kc-edit-cancel>取消</button></div></article>'}
    return '<article class="kc-card"><div class="head"><div><span class="pill">'+e(card.cardKind||'知识卡')+'</span><h3>'+e(card.title)+'</h3></div>'+(card.starredAsRecurring?'<span class="kc-star">★ ×'+Number(card.recurrenceCount||1)+'</span>':'')+'</div><p><b>正面：</b>'+e(String(card.frontContent||card.challengePrompt||'').trim()||'（这张卡正面为空：点「编辑」补齐题目或提示，别让它继续冒充正常提问）')+'</p><p><b>背面：</b>'+e(card.backContent||card.content||card.insight||'')+'</p>'+dynamicDetails(card)+'<p class="kc-status">'+e(card.subject)+(card.knowledgePoint?' · '+e(card.knowledgePoint):'')+' · '+(card.masteryStatus==='mastered'?'已掌握':'学习中')+'</p><div class="kc-actions"><button data-kc-favorite="'+e(card.id)+'">'+(card.favorite?'取消收藏':'收藏')+'</button><button data-kc-master="'+e(card.id)+'">'+(card.masteryStatus==='mastered'?'取消掌握':'标记掌握')+'</button><button data-kc-share="'+e(card.id)+'">分享到共享知识库</button><button data-kc-edit="'+e(card.id)+'">编辑</button><button data-kc-delete="'+e(card.id)+'">删除</button></div></article>';
  }
  function hub(){
    var list=filtered(),subjectList=Array.from(new Set(ui.cards.map(function(card){return card.subject||'未分类'}))).sort(function(a,b){return a.localeCompare(b,'zh')}),scoped=subjectCards(),today=scoped.filter(due),challengeCard=scoped.find(function(card){return ui.results[card.id]})||today[0];
    var subjects='<div class="kc-tabs" aria-label="按学科筛选知识卡"><button data-kc-subject="全部" class="'+(ui.subject==='全部'?'active':'')+'">全部学科</button>'+subjectList.map(function(subject){return '<button data-kc-subject="'+e(subject)+'" class="'+(ui.subject===subject?'active':'')+'">'+e(subject)+'</button>'}).join('')+'</div>';
    var groupedCards=subjectList.map(function(subject){var cardsForSubject=list.filter(function(card){return (card.subject||'未分类')===subject});return cardsForSubject.length?'<section class="kc-subject-group"><h3>'+e(subject)+' <span>'+cardsForSubject.length+' 张</span></h3><div class="kc-grid">'+cardsForSubject.map(libraryCard).join('')+'</div></section>':''}).join('');
    return '<section class="panel kc-shell"><div class="head"><div><span class="pill good">Gizmo 式真实回忆</span><h2>知识卡片闯关</h2><p class="muted">个人知识卡只保存在你的账号；发布到共享广场是另一项独立操作。</p></div><span class="pill warn">'+today.length+' 张今日到期'+(ui.subject!=='全部'?' · '+e(ui.subject):'')+'</span></div>'+subjects+'<div class="kc-tabs"><button data-kc-filter="today" class="'+(ui.filter==='today'?'active':'')+'">今日闯关</button><button data-kc-filter="all" class="'+(ui.filter==='all'?'active':'')+'">全部</button><button data-kc-filter="favorite" class="'+(ui.filter==='favorite'?'active':'')+'">收藏</button><button data-kc-filter="mastered" class="'+(ui.filter==='mastered'?'active':'')+'">已掌握</button></div>'+(ui.error?'<div class="kc-feedback">'+e(ui.error)+'</div>':'')+(ui.filter==='today'?(challengeCard?challenge(challengeCard):'<div class="kc-empty">今天没有到期知识卡。完成真实陪练或导入笔记后，系统会按复习间隔安排闯关。</div>'):(groupedCards||'<div class="kc-empty">这个分类还没有知识卡。</div>'))+'</section><section class="panel kc-shell"><div class="head"><div><h2>从笔记提炼知识卡</h2><p class="muted">支持粘贴文本、TXT、Markdown；只引用原文，不补写文章没有表达的观点。</p></div><span class="pill">最大 512 KB</span></div><div class="kc-note"><input data-note-field="title" placeholder="笔记标题" value="'+e(ui.note.title)+'"><input data-note-field="knowledgePoint" placeholder="知识点（可选）" value="'+e(ui.note.knowledgePoint)+'"><select data-note-field="subject"><option '+(ui.note.subject==='数学'?'selected':'')+'>数学</option><option '+(ui.note.subject==='化学'?'selected':'')+'>化学</option><option '+(ui.note.subject==='物理'?'selected':'')+'>物理</option><option '+(ui.note.subject==='英语'?'selected':'')+'>英语</option><option '+(ui.note.subject==='语文'?'selected':'')+'>语文</option></select><input type="file" data-note-file accept=".txt,.md,text/plain,text/markdown"><textarea data-note-field="content" placeholder="粘贴笔记或文章内容">'+e(ui.note.content)+'</textarea></div><div class="kc-actions"><button class="primary" data-note-generate '+(busy?'disabled':'')+'>提炼并加入闯关</button></div></section>';
  }
  function rotation(){
    var holder=app.state.knowledgeCardUi||(app.state.knowledgeCardUi={});
    return holder.rotation||(holder.rotation={ids:[],index:0,finished:false});
  }
  function startRotation(){
    var scoped=subjectCards(),candidates=scoped.filter(due);
    if(!candidates.length)candidates=scoped.filter(function(card){return card.masteryStatus!=='mastered'});
    if(!candidates.length){app.state.tab='card-challenge';app.save();return app.render()}
    var current=rotation();
    current.ids=candidates.map(function(card){return card.id});
    current.index=0;current.finished=false;ui.error='';
    app.state.tab='card-challenge';app.save();app.render();
  }
  function advanceRotation(){
    var current=rotation();
    var cards=current.ids.map(function(id){return ui.cards.find(function(card){return card.id===id})}).filter(Boolean);
    current.ids=cards.map(function(card){return card.id});
    if(current.index+1>=cards.length)current.finished=true;else current.index+=1;
    app.save();app.render();
  }
  function renderRotation(v){
    var current=rotation();
    var cards=current.ids.map(function(id){return ui.cards.find(function(card){return card.id===id})}).filter(Boolean);
    current.ids=cards.map(function(card){return card.id});
    v.className='work';
    if(!cards.length){v.innerHTML='<section class="panel kc-rotation"><span class="pill warn">暂时无法开局</span><h2>还没有可闯关的知识卡</h2><div class="kc-empty">知识卡只能从已完成的真实陪练或真实笔记中提炼；不会用演示内容凑卡。完成一题陪练后会自动加入这里。</div><div class="kc-actions"><button data-kc-back-loop>返回闭环</button></div></section>';bind(v);return}
    if(current.finished){v.innerHTML='<section class="panel kc-rotation"><span class="pill good">本轮完成</span><h2>这轮知识卡闯关完成了</h2><p class="muted">复习结果已回写到你的掌握证据与下次复习安排。</p><div class="kc-actions"><button class="primary" data-kc-restart>再来一轮</button><button data-kc-back-loop>返回闭环</button></div></section>';bind(v);return}
    var index=Math.min(current.index,cards.length-1),card=cards[index],percent=Math.round((index/cards.length)*100);
    v.innerHTML='<section class="panel kc-rotation"><div class="kc-rotation-top"><div><button data-kc-back-loop>← 返回闭环</button><h2>知识卡片闯关</h2><p class="muted">第 '+(index+1)+' / '+cards.length+' 张：先回忆，再看结论。</p></div><span class="pill">'+percent+'%</span></div><div class="kc-rotation-progress"><i style="width:'+percent+'%"></i></div>'+challenge(card)+'</section>';
    typesetChallengeFronts(v);bind(v);
  }
  async function load(force){
    if(busy||(!force&&Date.now()-lastLoad<5000))return;
    busy=true;
    try{ui.cards=await app.request('/v1/knowledge-cards');ui.error='';lastLoad=Date.now()}catch(error){ui.error=error.message}finally{busy=false;if(app.state.tab==='loop'||app.state.tab==='plan')app.render()}
  }
  async function patchCard(id,body){
    busy=true;try{await app.request('/v1/knowledge-cards/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(body)});ui.cards=await app.request('/v1/knowledge-cards');lastLoad=Date.now();ui.error='';return true}catch(error){ui.error=error.message;return false}finally{busy=false;app.render()}
  }
  function bind(root){
    root.querySelectorAll('[data-kc-start]').forEach(function(button){button.onclick=startRotation});
    root.querySelectorAll('[data-kc-back-loop]').forEach(function(button){button.onclick=function(){app.state.tab='loop';app.save();app.render()}});
    root.querySelectorAll('[data-kc-restart]').forEach(function(button){button.onclick=startRotation});
    root.querySelectorAll('[data-kc-filter]').forEach(function(button){button.onclick=function(){ui.filter=button.dataset.kcFilter;app.render()}});
    root.querySelectorAll('[data-kc-subject]').forEach(function(button){button.onclick=function(){ui.subject=button.dataset.kcSubject;app.state.knowledgeCardUi.subject=ui.subject;app.save();app.render()}});
    root.querySelectorAll('[data-kc-edit-field]').forEach(function(input){input.oninput=function(){if(!ui.editDraft)ui.editDraft={};ui.editDraft[input.dataset.kcEditField]=input.value;var preview=root.querySelector('[data-kc-edit-preview="'+input.dataset.kcEditField+'"]');if(preview){preview.textContent=input.value;typesetChallengeFronts(preview.parentNode)}}});
    root.querySelectorAll('[data-kc-edit]').forEach(function(button){button.onclick=function(){var card=ui.cards.find(function(item){return item.id===button.dataset.kcEdit});ui.editingCardId=card&&card.id;ui.editDraft=card?{title:card.title,subject:card.subject,knowledgePoint:card.knowledgePoint,frontContent:card.frontContent||card.challengePrompt||'',backContent:card.backContent||card.content||card.insight||''}:null;app.render()}});
    root.querySelectorAll('[data-kc-edit-cancel]').forEach(function(button){button.onclick=function(){ui.editingCardId=null;ui.editDraft=null;app.render()}});
    root.querySelectorAll('[data-kc-edit-save]').forEach(function(button){button.onclick=function(){var draft=ui.editDraft||{};if(!String(draft.title||'').trim()||!String(draft.subject||'').trim()||!String(draft.backContent||'').trim()){ui.error='标题、学科和背面内容不能为空。';return app.render()}patchCard(button.dataset.kcEditSave,{title:String(draft.title).trim(),subject:String(draft.subject).trim(),knowledgePoint:String(draft.knowledgePoint||'').trim(),frontContent:String(draft.frontContent||draft.challengePrompt||'').trim(),backContent:String(draft.backContent).trim()}).then(function(saved){if(saved){ui.editingCardId=null;ui.editDraft=null;app.render()}})}});
    root.querySelectorAll('[data-kc-answer]').forEach(function(input){input.oninput=function(){ui.answers[input.dataset.kcAnswer]=input.value}});
    root.querySelectorAll('[data-kc-self-rating]').forEach(function(button){button.onclick=function(){var id=button.dataset.kcSelfRating;ui.selfRatings[id]=button.dataset.rating;root.querySelectorAll('[data-kc-self-rating]').forEach(function(option){if(option.dataset.kcSelfRating===id)option.setAttribute('aria-pressed',String(option.dataset.rating===ui.selfRatings[id]))})}});
    root.querySelectorAll('[data-kc-review]').forEach(function(button){button.onclick=async function(){var id=button.dataset.kcReview,answer=(ui.answers[id]||'').trim();if(!answer){ui.error='请先写下你的回忆或判断。';return app.render()}var attemptId=ui.reviewAttempts[id]||(ui.reviewAttempts[id]=(crypto.randomUUID?crypto.randomUUID():'attempt-'+Date.now()+'-'+Math.random()));busy=true;ui.error='';app.render();try{var result=await app.request('/v1/knowledge-cards/'+encodeURIComponent(id)+'/reviews',{method:'POST',body:JSON.stringify({studentAnswer:answer,selfRating:ui.selfRatings[id]||null,attemptId:attemptId})});ui.results[id]=result.review;ui.cards=ui.cards.map(function(card){return card.id===id?result.card:card});delete ui.answers[id];delete ui.reviewAttempts[id]}catch(error){ui.error=error.message+' 你的回答已保留，可以直接重试。'}finally{busy=false;app.render()}}});
    root.querySelectorAll('[data-kc-next]').forEach(function(button){button.onclick=function(){delete ui.results[button.dataset.kcNext];if(app.state.tab==='card-challenge')advanceRotation();else app.render()}});
    root.querySelectorAll('[data-kc-favorite]').forEach(function(button){button.onclick=function(){var card=ui.cards.find(function(item){return item.id===button.dataset.kcFavorite});if(card)patchCard(card.id,{favorite:!card.favorite})}});
    root.querySelectorAll('[data-kc-master]').forEach(function(button){button.onclick=function(){var card=ui.cards.find(function(item){return item.id===button.dataset.kcMaster});if(card)patchCard(card.id,{masteryStatus:card.masteryStatus==='mastered'?'learning':'mastered'})}});
    root.querySelectorAll('[data-kc-share]').forEach(function(button){button.onclick=async function(){
      if(typeof window.__eduShareToPlaza!=='function'){ui.error='共享知识库还没加载，刷新页面后再试。';return app.render()}
      var label=button.textContent;button.disabled=true;button.textContent='正在分享…';
      var result=await window.__eduShareToPlaza({cardId:button.dataset.kcShare});
      button.disabled=false;button.textContent=result&&result.ok?(result.shared?'已在共享知识库':'已分享到共享知识库'):label;
    }});
    root.querySelectorAll('[data-kc-delete]').forEach(function(button){button.onclick=async function(){if(!window.confirm('删除这张知识卡及其复习记录？'))return;busy=true;try{await app.request('/v1/knowledge-cards/'+encodeURIComponent(button.dataset.kcDelete),{method:'DELETE'});ui.cards=await app.request('/v1/knowledge-cards');lastLoad=Date.now();ui.error=''}catch(error){ui.error=error.message}finally{busy=false;app.render()}}});
    root.querySelectorAll('[data-note-field]').forEach(function(input){input.oninput=function(){ui.note[input.dataset.noteField]=input.value;delete ui.note.sourceId;app.state.knowledgeCardUi.note=ui.note;app.save()}});
    var file=root.querySelector('[data-note-file]');if(file)file.onchange=async function(){var picked=file.files&&file.files[0];if(!picked)return;if(picked.size>512*1024){ui.error='文件超过 512 KB，未读取。';return app.render()}var ext=(picked.name.split('.').pop()||'').toLowerCase();if(ext!=='txt'&&ext!=='md'){ui.error='首版只支持 TXT 和 Markdown。';return app.render()}ui.note.title=ui.note.title||picked.name.replace(/\.[^.]+$/,'');ui.note.sourceType=ext;ui.note.content=await picked.text();delete ui.note.sourceId;app.state.knowledgeCardUi.note=ui.note;app.save();app.render()};
    var generate=root.querySelector('[data-note-generate]');if(generate)generate.onclick=async function(){var content=ui.note.content.trim();if(!content){ui.error='请先粘贴笔记或选择 TXT / Markdown 文件。';return app.render()}busy=true;ui.error='';app.render();try{if(!ui.note.sourceId){var source=await app.request('/v1/note-sources',{method:'POST',body:JSON.stringify(ui.note)});ui.note.sourceId=source.id;app.state.knowledgeCardUi.note=ui.note;app.save()}var outcome=await app.request('/v1/note-sources/'+encodeURIComponent(ui.note.sourceId)+'/knowledge-cards',{method:'POST'});ui.cards=await app.request('/v1/knowledge-cards');ui.note={title:'',subject:'数学',knowledgePoint:'',content:'',sourceType:'paste'};app.state.knowledgeCardUi.note=ui.note;ui.error=outcome.cards.length?'已从真实原文生成 '+outcome.cards.length+' 张知识卡。':'这份笔记没有需要单独制卡的高价值内容，因此生成 0 张。';app.save()}catch(error){ui.error=error.message+' 原文与生成任务已保留，可直接重试。'}finally{busy=false;app.render()}};
  }
  var feature={
    activate:function(context){app=context;app.state.knowledgeCardUi=app.state.knowledgeCardUi||{};ui.subject=app.state.knowledgeCardUi.subject||ui.subject;ui.note=Object.assign(ui.note,app.state.knowledgeCardUi.note||{});window.__promptKnowledgeCard=promptAfterTutor;window.__createKnowledgeCardFromMistake=startKnowledgeCard;window.__acceptSavedKnowledgeCard=function(card){ui.cards=[card].concat(ui.cards.filter(function(item){return item.id!==card.id}));lastLoad=Date.now()};load(true)},
    renderCreate:renderCreate,
    renderLoop:function(v){v.insertAdjacentHTML('beforeend',hub());var shell=v.querySelector('.kc-shell');if(shell){var target=shell.querySelector('.kc-tabs');if(target)target.insertAdjacentHTML('beforebegin','<div class="kc-actions"><button class="primary" data-kc-start>开始知识卡闯关</button><span class="kc-status">进入独立页面，逐张回忆、作答与反馈。</span></div>')}typesetChallengeFronts(v);bind(v);load(false)},
    renderChallenge:renderRotation,
    renderPlan:function(v){var cards=ui.cards.filter(due),practiced=ui.cards.filter(function(card){return card.reviewSchedule&&card.reviewSchedule.lastReviewedAt}),mastered=ui.cards.filter(function(card){return card.masteryStatus==='mastered'});v.insertAdjacentHTML('afterbegin','<section class="panel"><div class="head"><div><h2>知识卡复习安排</h2><p class="muted">计划页只安排到期卡片；闭环页负责真实回忆作答。</p></div><button data-open-card-loop>去闯关</button></div>'+(cards.slice(0,3).map(function(card){return '<div class="review-item"><div><b>'+e(card.title)+'</b><p class="muted">'+e(card.microSkill||card.knowledgePoint||card.subject)+' · '+(card.starredAsRecurring?'相似卡点再次出现 ×'+Number(card.recurrenceCount||1):'按记忆间隔复习')+'</p></div></div>'}).join('')||'<p class="muted">当前没有到期知识卡。</p>')+'<div class="evidence"><b>知识卡能力变化</b><p>已完成真实回忆 '+practiced.length+' 张 · 连续稳定后掌握 '+mastered.length+' 张；这部分不计入原始错题数量。</p></div></section>');var button=v.querySelector('[data-open-card-loop]');if(button)button.onclick=function(){app.state.tab='loop';ui.filter='today';app.render()};load(false)}
  };
  if(window.__registerKnowledgeCards)window.__registerKnowledgeCards(feature);
})();
