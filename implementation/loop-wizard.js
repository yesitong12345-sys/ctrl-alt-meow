/* 闭环页向导式重排（独立模块）
 *
 * 接入方式：index.html 里的 window.__registerLoopWizard(feature)
 * 工作方式：包装 renderLoop，在原渲染完成后把「一个长页面」改造成 3 步向导 ——
 *   Step 1 回顾诊断：只读展示原题 / AI 诊断 / 学生原话 / AI 总结 + 技能路径
 *   Step 2 三阶变式：一次只显示一个子关卡（近迁移 → 混合迁移 → 远迁移）
 *   Step 3 生成知识卡片：选择正面提示与 AI 陪练背面 → 可编辑 → 存入 FSRS 队列
 *                       「从笔记提炼知识卡」折叠在这一步下方
 *
 * 用 DOM 移动实现，原有的事件绑定（提交作答、开启陪练、完成按钮）全部保留。
 */
(function () {
  'use strict';

  var app = null;
  var MAX_UNDERSTANDING = 8000;

  var ui = {understanding: null, error: ''};

  var style = document.createElement('style');
  style.textContent = [
    '.lw-nav{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px}',
    '.lw-nav .lw-step{display:flex;align-items:center;gap:6px;font-size:13px;color:#8593a8;padding:6px 12px;border-radius:999px;border:1px solid #e3eaf6;background:#fff;cursor:pointer}',
    '.lw-nav .lw-step.on{border-color:#315efb;color:#24467f;background:#f2f7ff;font-weight:600}',
    '.lw-nav .lw-step.done{border-color:#2f9e5f;color:#1f7a45;background:#eefaf1}',
    '.lw-nav .lw-line{flex:1;height:2px;background:#e8eefb;min-width:14px}',
    '.lw-card{border:1px solid #dbe5f5;border-radius:18px;padding:18px;background:#fff}',
    '.lw-readonly .diagnosis{margin-top:10px}',
    '.lw-kids{display:flex;gap:6px;margin:10px 0 4px;flex-wrap:wrap}',
    '.lw-kid{font-size:12px;border:1px solid #dbe5f5;border-radius:999px;padding:3px 12px;color:#65738b}',
    '.lw-kid.on{border-color:#315efb;color:#24467f;background:#f2f7ff}',
    '.lw-kid.done{border-color:#2f9e5f;color:#1f7a45;background:#eefaf1}',
    '.lw-foot{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',
    '.lw-under textarea{width:100%;min-height:110px;margin-top:8px;padding:10px;border:1px solid #d7e1f2;border-radius:12px;font-family:inherit}',
    '.lw-count{font-size:12px;color:#8593a8}',
    '.lw-count.over{color:#c0392b}',
    '.lw-fold{margin-top:16px}',
    '.lw-fold>summary{cursor:pointer;font-weight:600;color:#4a5a73;padding:6px 0}',
    '.lw-hidden{display:none!important}',
    '.lw-three{margin:14px 0 4px}',
    '.lw-three-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}',
    '.lw-three .three-stage{aspect-ratio:1/1;max-width:420px;margin:0 auto}',
    /* 真实回忆作答 + FSRS 评分 */
    '.lw-recall{margin-top:16px;padding:14px;border:1px solid #dbe5f5;border-radius:16px;background:linear-gradient(150deg,#f7faff,#fff)}',
    '.lw-recall h3{margin:0 0 4px;font-size:16px}',
    '.lw-recall textarea{width:100%;min-height:80px;margin-top:8px;padding:10px;border:1px solid #d7e1f2;border-radius:12px;font-family:inherit}',
    '.lw-rate{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:10px}',
    '.lw-rate button{padding:12px;border-radius:14px;border:1px solid #d7e1f2;background:#fff;text-align:left;cursor:pointer}',
    '.lw-rate button:hover{border-color:#315efb;background:#f7faff}',
    '.lw-rate b{display:block;font-size:15px}',
    '.lw-rate span{font-size:12px;color:#65738b}',
    '.lw-rate button.repeat b{color:#d9483f}',
    '.lw-receipt{margin-top:10px;padding:10px 12px;border-radius:12px;background:#eefaf1;border:1px solid #b7e3c8;font-size:13px;color:#1f7a45}',
    /* 一组题按顺序做 */
    '.lw-queue{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}',
    '.lw-queue b{font-size:14px;color:#22314a}',
    '.lw-queue .lw-queue-actions{display:flex;gap:8px;flex-wrap:wrap}',
    '.lw-library-button{margin-left:auto}.lw-card-composer{margin:12px 0;padding:12px;border:1px solid #dbe5f5;border-radius:14px;background:#fbfdff}.lw-card-composer h3{margin:0 0 8px}.lw-source-options{display:grid;gap:7px;margin-bottom:10px}.lw-source-option{display:flex;gap:8px;align-items:flex-start;padding:9px;border:1px solid #e2eaf6;border-radius:10px;background:white;font-size:13px}.lw-source-option input{width:18px;height:18px;flex:0 0 auto;margin:1px 0 0;accent-color:#315efb}.lw-source-option span{min-width:0}.lw-source-option b,.lw-source-option small{display:block}.lw-source-option small{margin-top:3px;color:#6b7890;white-space:pre-wrap;overflow-wrap:anywhere;max-height:82px;overflow:auto}.lw-card-composer input,.lw-card-composer textarea{width:100%;box-sizing:border-box;margin:7px 0;padding:10px;border:1px solid #d7e1f2;border-radius:11px;font:inherit}.lw-card-composer textarea{min-height:140px}'
  ].join('');
  // .lw-card-composer 的文本框通用样式不能把复选框拉成整行；显式锁定素材行的两列布局。
  style.textContent += '.lw-card-composer .lw-source-option{display:flex!important;flex-flow:row nowrap!important;align-items:flex-start;width:100%;box-sizing:border-box}.lw-card-composer .lw-source-option input[type="checkbox"]{display:block!important;width:18px!important;min-width:18px!important;max-width:18px!important;height:18px!important;flex:0 0 18px!important;padding:0!important;margin:1px 0 0!important;border:0!important;box-sizing:border-box}.lw-card-composer .lw-source-option span{display:block!important;flex:1 1 auto!important;width:auto!important;min-width:0!important;white-space:normal!important;overflow-wrap:anywhere!important}.lw-card-composer .lw-source-option small{max-height:110px;line-height:1.55;word-break:normal}';
  document.head.appendChild(style);

  function e(value) { return app.esc(String(value == null ? '' : value)); }

  function cardSourceOptions(record, point, caseId, sourceQuestion) {
    var front = [], back = [];
    var question=String(record&&record.question||sourceQuestion||'').trim();
    if (question) front.push({id:'question',label:'本题题目',text:'题目：'+question,checked:true});
    front.push({id:'knowledge-point',label:'对应知识点',text:'知识点：'+point,checked:true});
    function addBoth(id,label,value){var text=String(value||'').trim();if(text){front.push({id:id,label:label,text:text,checked:false});back.push({id:id+'-back',label:label,text:text,checked:false})}}
    function useful(text,kind){var value=String(text||'').trim();if(!value)return'';if(kind==='directAnswer'&&/暂不公布最终(?:数值|答案)/.test(value))return'';if(kind==='understanding'&&/(?:你|学生)(?:已经|明确|仍然).{0,36}(?:不会|不懂|没有写出|尚未写出)|没有写出可确认的解题步骤/.test(value))return'';if(kind==='explanation'&&/(?:当前目标仍是|我们需要从.{0,30}开始.{0,40}(?:把题目转化|重新开始)|只是先推进到)/.test(value))return'';return value}
    var missed=record&&record.studentAnswer||'',answer=record&&(record.correctAnswerLatex||record.correctAnswer)||'';
    var weak=(record&&record.weakPoints||[])[0]||record&&record.stuckAt&&record.stuckAt.label||'';
    addBoth('weak-point','薄弱点',weak&&'薄弱点：'+weak);
    (record&&Array.isArray(record.errorCauses)?record.errorCauses:[]).forEach(function(cause,index){if(String(cause||'').trim())addBoth('error-cause-'+index,'错因 '+(index+1),'错因：'+cause)});
    addBoth('wrong-answer','我当时的错误答案',missed&&'我当时写的是：'+missed);
    addBoth('correct-answer','正确答案',answer&&'正确答案：'+answer);
    var sessions=app.state.tutorSessions||{},session=sessions[caseId]||Object.keys(sessions).filter(function(key){return key.indexOf(String(caseId)+'::')===0}).map(function(key){return sessions[key]}).pop()||{};
    var turns=Array.isArray(session.turns)?session.turns:[];
    var thinking=turns.slice().reverse().map(function(turn){return turn.nextQuestion||turn.followUpQuestion}).find(Boolean)||session.diagnosis&&session.diagnosis.nextStep||'';
    if(thinking)front.push({id:'thinking-question',label:'AI 引导思考',text:'引导思考：'+thinking,checked:false});
    turns.forEach(function(turn,index){var number=index+1;var candidates=[['direct-answer','AI 直接回答',useful(turn.directAnswer,'directAnswer')],['understanding','AI 引导思路',useful(turn.understanding,'understanding')],['explanation','AI 讲解原文',useful(turn.explanation,'explanation')]];candidates.forEach(function(candidate){if(candidate[2])back.push({id:'ai-turn-'+index+'-'+candidate[0],label:'第 '+number+' 轮 · '+candidate[1],text:candidate[2],checked:false})});var student=String(turn.studentMessage||'').trim();if(student)front.push({id:'student-turn-'+index,label:'第 '+number+' 轮 · 我的提问/作答',text:'我的提问/作答：'+student,checked:false});var next=String(turn.nextQuestion||turn.followUpQuestion||'').trim();if(next)front.push({id:'guide-question-'+index,label:'第 '+number+' 轮 · AI 引导问题',text:'想一想：'+next,checked:false})});
    return {front:front,back:back};
  }

  function renderCardSourceOptions(items, side) {
    return (items||[]).map(function(item){return '<label class="lw-source-option"><input type="checkbox" data-lw-'+side+'-choice="'+e(item.id)+'" '+(item.checked?'checked':'')+'><span><b>'+e(item.label)+'</b><small>'+e(item.text)+'</small></span></label>'}).join('')||'<p class="lw-count">当前没有可选的 AI 对话片段，可以直接填写背面。</p>';
  }

  function step() {
    var value = Number(app.state.loopWizardStep || 1);
    return value >= 1 && value <= 3 ? value : 1;
  }

  function setStep(next) {
    app.state.loopWizardStep = Math.max(1, Math.min(3, next));
    app.save();
    app.render();
    var view = document.querySelector('.work');
    if (view && view.scrollIntoView) view.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  /** 读某个子关卡的作答状态（data-transfer-answer 的 key 是 taskId|questionId） */
  function questionSession(input) {
    if (!input) return {};
    var key = String(input.dataset.transferAnswer || '').replace('|', ':');
    return (app.state.transferSessions || {})[key] || {};
  }

  function navHtml(current, doneFlags) {
    var labels = ['回顾诊断', '三阶迁移', '生成知识卡'];
    var parts = [];
    labels.forEach(function (label, index) {
      var number = index + 1;
      var cls = number === current ? 'on' : (doneFlags[index] ? 'done' : '');
      parts.push('<button class="lw-step ' + cls + '" data-lw-step="' + number + '">'
        + (doneFlags[index] && number !== current ? '✓ ' : '') + number + '. ' + label + '</button>');
      if (index < labels.length - 1) parts.push('<span class="lw-line"></span>');
    });
    return '<div class="lw-nav">' + parts.join('') + '</div>';
  }

  /* ---------------- 后处理 ---------------- */
  /* ---------------- 闭环页必备块：一组题进度 + 真实回忆评分 ----------------
     独立于三步向导：没有变式题的错题也要能在这里完成「回忆 → 评分 → FSRS 排下次」。 */
  function ensureLoopExtras(view) {
    var loopId = (app.state.loop && app.state.loop.activeId) || null;
    var trainingQueue = (app.state.loop && app.state.loop.trainingQueue) || [];

    // 1) 一组题按顺序做：进度 + 上一题 / 下一题
    if (trainingQueue.length > 1 && !view.querySelector('[data-lw-queue-bar]')) {
      var activeIndex = Math.max(0, trainingQueue.indexOf(loopId));
      var qbar = document.createElement('section');
      qbar.className = 'panel lw-queue';
      qbar.setAttribute('data-lw-queue-bar', '');
      qbar.innerHTML = '<div><b>本组训练：第 ' + (activeIndex + 1) + ' / ' + trainingQueue.length + ' 题</b>'
        + '<p class="muted" style="margin:2px 0 0">按薄弱点分组后的顺序推进；做完一题点「下一题」。</p></div>'
        + '<div class="lw-queue-actions">'
        + '<button data-lw-queue-prev="' + (activeIndex - 1) + '"' + (activeIndex <= 0 ? ' disabled' : '') + '>上一题</button>'
        + '<button class="primary" data-lw-queue-next="' + (activeIndex + 1) + '"'
        + (activeIndex >= trainingQueue.length - 1 ? ' disabled' : '') + '>下一题</button>'
        + '</div>';
      view.insertBefore(qbar, view.firstChild);
    }

    // 2) 真实回忆自评 + 评分（调用 FSRS，显示「下次复习：X 天后」）
    if (!view.querySelector('[data-lw-recall]')) {
      var recall = document.createElement('section');
      recall.className = 'panel lw-recall';
      recall.setAttribute('data-lw-recall', '');
      recall.innerHTML = '<h3>真实回忆自评</h3>'
        + '<p class="muted">合上笔记，先在心里回忆一遍：这个知识点解决什么问题？关键判断是什么？'
        + '再按真实感受评分——评分会立刻交给 FSRS 排出下次复习时间。</p>'
        + '<textarea data-lw-recall-text placeholder="（可选）把回忆写下来，写下来更容易记住"></textarea>'
        + '<div class="lw-rate" data-lw-rate-bar>'
        + '<button class="repeat" data-lw-rate="1"><b>不会</b><span data-lw-rate-hint="1">完全想不起来</span></button>'
        + '<button class="repeat" data-lw-rate="2"><b>有点模糊</b><span data-lw-rate-hint="2">想起来了但很吃力</span></button>'
        + '<button data-lw-rate="3"><b>会了</b><span data-lw-rate-hint="3">顺利回忆起来</span></button>'
        + '</div>'
        + '<div data-lw-rate-receipt></div>';
      view.appendChild(recall);
    }

    // 4)「从笔记提炼知识卡」已迁移到上传页，闭环/计划流程里不再出现。
    //    注意这一页可能同时存在两个 .kc-shell（「知识卡片闯关」和「从笔记提炼知识卡」），
    //    必须全部隐藏；用 querySelector 只会拿到第一个。
    Array.prototype.slice.call(view.querySelectorAll('.kc-shell')).forEach(function (node) {
      if (node.closest('[data-lw-migrated]')) return;
      node.style.display = 'none';
      node.setAttribute('data-lw-migrated', '');
    });

    // 5) 绑定（view 级别的按钮，向导重建 DOM 后依然有效）
    view.querySelectorAll('[data-lw-rate]').forEach(function (button) {
      button.onclick = function () { submitRecallRating(Number(button.dataset.lwRate)); };
    });
    view.querySelectorAll('[data-lw-queue-next]').forEach(function (button) {
      button.onclick = function () { gotoQueueIndex(Number(button.dataset.lwQueueNext)); };
    });
    view.querySelectorAll('[data-lw-queue-prev]').forEach(function (button) {
      button.onclick = function () { gotoQueueIndex(Number(button.dataset.lwQueuePrev)); };
    });
    loadRatingHints();
  }

  function wizardify(view) {
    /* 不管这一页有没有变式题，「真实回忆作答 + FSRS 评分」都必须存在：
       计划页的「开始训练 / 开始今日复习 / 单独攻克」都指望落到这里，否则就是点了没反应。 */
    ensureLoopExtras(view);

    // 组训练会在任务前插入同为 .panel 的进度条；不能把进度条当成任务正文。
    var root = view.querySelector(':scope > .panel:not([data-lw-queue-bar]):not([data-lw-recall])');
    if (!root || view.querySelector('[data-lw]')) return;

    var questions = Array.prototype.slice.call(root.querySelectorAll('.transfer-question'));
    var evidence = root.querySelector('.evidence');
    var head = root.querySelector('.head');
    // 只移动任务自己的操作区；不能误取第一道迁移题里的「开始练习」。
    var actions = evidence ? evidence.querySelector(':scope > .row') : null;
    var diagnosis = root.querySelector('.diagnosis');
    var thinking = root.querySelector('.thinking');
    var sourceLine = null;
    Array.prototype.slice.call(root.querySelectorAll('p')).some(function (p) {
      if (p.querySelector('b') && /来源原题/.test(p.textContent)) { sourceLine = p; return true; }
      return false;
    });

    // 如果这一页根本不是任务执行页（没有变式题），就不改造
    if (!questions.length && !evidence) return;

    var current = step();

    // ---- 构建三步容器 ----
    var wrap = document.createElement('div');
    wrap.setAttribute('data-lw', 'wrap');

    // Step 1：只读回顾
    var s1 = document.createElement('section');
    s1.className = 'panel lw-readonly';
    s1.setAttribute('data-lw-step-panel', '1');
    var s1title = document.createElement('div');
    s1title.className = 'head';
    s1title.innerHTML = '<div><span class="pill">Step 1</span><h2>回顾这次诊断</h2>'
      + '<p class="muted">先看清「错在哪、为什么错」，再动手做变式。这一步不需要作答。</p></div>';
    s1.appendChild(s1title);
    if (sourceLine) s1.appendChild(sourceLine);
    if (diagnosis) s1.appendChild(diagnosis);
    if (thinking) s1.appendChild(thinking);
    var libraryButton = document.createElement('button');
    libraryButton.type = 'button';
    libraryButton.className = 'lw-library-button';
    libraryButton.textContent = '我的知识卡库';
    libraryButton.setAttribute('data-lw-card-library-entry','');
    libraryButton.onclick = function(){if(window.__openKnowledgeCardLibrary)window.__openKnowledgeCardLibrary();};
    s1title.appendChild(libraryButton);
    var s1foot = document.createElement('div');
    s1foot.className = 'lw-foot';
    s1foot.innerHTML = '<button class="primary" data-lw-next="2">下一步，开始变式训练</button>';
    s1.appendChild(s1foot);

    /* Step 1 里补上原题的空间模型。
       AI 陪练这一路原本完全没有 3D 面板，用户会以为「模型被藏起来了」；
       放在「回顾诊断」里正好——先看清图形，再讲错在哪。 */
    var loopMistakeId = app.state.loop && app.state.loop.activeId;
    var loopRecord = (app.state.mistakes || []).find(function (item) { return item.id === loopMistakeId; });
    // 来源原题来自当前任务页，独立于错题记录查找。即使旧缓存/服务端 ID 对不上，
    // 题目仍必须能进入卡片正面，不能退化成只有知识点的提示卡。
    var sourceQuestion = '';
    Array.prototype.slice.call(s1.querySelectorAll('p')).some(function (node) {
      if (node.querySelector('b') && /来源原题/.test(node.textContent)) {
        sourceQuestion = node.textContent.replace(/^[\s\S]*?来源原题[：:]\s*/, '').trim();
        return true;
      }
      return false;
    });
    // activeId 可能为空（任务是从「今天到期」里挑出来的），这时再用原题反查记录 ID。
    if (!loopRecord) {
      if (sourceQuestion) {
        /* 注意别叫 head：上面第 169 行已经把 head 定义成「步骤标题元素」，
           var 是函数作用域，这里再声明一次会把那个元素覆盖成字符串，
           到下面 head.cloneNode(true) 就报 “head.cloneNode is not a function”，
           闭环页整个向导会因此中断。 */
        var sourceHead = sourceQuestion.slice(0, 20);
        loopRecord = (app.state.mistakes || []).find(function (item) {
          return String(item.question || '').replace(/\s+/g, '').indexOf(sourceHead.replace(/\s+/g, '')) === 0;
        }) || null;
      }
    }
    var sourceCaseId = loopRecord ? loopRecord.id : null;
    var knowledgePoint = String((loopRecord && ((loopRecord.knowledgePoints || [])[0] || (loopRecord.microSkills || [])[0]))
      || root.querySelector('.head h2')?.textContent || '').replace(/\s*·\s*三阶迁移练习\s*$/, '').trim();
    var originalQuestion=String(loopRecord&&loopRecord.question||sourceQuestion||'').trim();
    if (!ui.understanding || ui.understanding.sourceCaseId !== sourceCaseId || ui.understanding.knowledgePoint !== knowledgePoint || ui.understanding.question !== originalQuestion) {
      var sources=cardSourceOptions(loopRecord,knowledgePoint,sourceCaseId,originalQuestion);
      var defaultFront=sources.front.filter(function(item){return item.checked}).map(function(item){return item.text}).join('\n\n');
      var defaultBack=sources.back.filter(function(item){return item.checked}).map(function(item){return item.text}).join('\n\n');
      ui.understanding = {knowledgePoint: knowledgePoint, sourceCaseId: sourceCaseId, subject: (loopRecord && loopRecord.subject) || '数学', text: defaultBack, frontContent:defaultFront, backContent:defaultBack, frontChoices:sources.front, backChoices:sources.back, question:originalQuestion, saved: false};
      ui.error = '';
    }
    if (loopRecord && loopRecord.geometryResult && loopRecord.geometryResult.scene) {
      var verified = loopRecord.geometryResult.solverStatus === 'verified';
      var threeWrap = document.createElement('div');
      threeWrap.className = 'lw-three';
      threeWrap.innerHTML = '<div class="lw-three-head">'
        + '<b>原题的空间模型</b>'
        + '<span class="pill ' + (verified ? 'good' : 'warn') + '">' + (verified ? '已验证' : 'AI 参考 · 可交互') + '</span>'
        + '<span class="lw-count">按住拖动旋转 · 滚轮缩放 · 可切换 XYZ 网格</span></div>'
        + '<div class="three-stage" data-case-three="' + e(loopRecord.id) + '"></div>';
      if (thinking && thinking.parentNode === s1) s1.insertBefore(threeWrap, thinking);
      else s1.appendChild(threeWrap);
      setTimeout(function () {
        var stage = threeWrap.querySelector('.three-stage');
        if (stage && typeof window.__mountDeterministicThree === 'function') {
          try { window.__mountDeterministicThree(stage, loopRecord.geometryResult); } catch (error) {}
        }
      }, 80);
    }

    // Step 2：三阶变式，一次一个子关卡
    var s2 = document.createElement('section');
    s2.className = 'panel';
    s2.setAttribute('data-lw-step-panel', '2');
    var s2title = document.createElement('div');
    s2title.className = 'head';
    s2title.innerHTML = '<div><span class="pill">Step 2</span><h2>三阶迁移</h2></div>';
    s2.appendChild(s2title);
    var kidBar = document.createElement('div');
    kidBar.className = 'lw-kids';
    kidBar.setAttribute('data-lw-kids', '');
    s2.appendChild(kidBar);
    var stage = document.createElement('div');
    stage.setAttribute('data-lw-stage', '');
    questions.forEach(function (question, index) {
      question.setAttribute('data-lw-index', String(index));
      stage.appendChild(question);
    });
    s2.appendChild(stage);
    if (actions) s2.appendChild(actions);

    // 「真实回忆自评 + 评分」由 ensureLoopExtras 统一挂在页面底部，这里不重复渲染

    var s2foot = document.createElement('div');
    s2foot.className = 'lw-foot';
    s2foot.innerHTML = '<button data-lw-prev="1">返回诊断</button>'
      + '<button class="primary" data-lw-next="3">全部做完了，去写「我的理解」</button>';
    s2.appendChild(s2foot);

    // Step 3：生成知识卡片
    var s3 = document.createElement('section');
    s3.className = 'panel lw-under';
    s3.setAttribute('data-lw-step-panel', '3');
    s3.innerHTML = '<div class="head"><div><span class="pill">Step 3</span><h2>生成知识卡片</h2>'
      + '<p class="muted">把这次的理解写成自己的话，保存后会进入 FSRS 复习队列。</p></div></div>'
      + '<div data-lw-under-host></div>'
      + '<div class="lw-foot"><button data-lw-prev="2">返回变式</button></div>';

    /* 一组题进度条由 ensureLoopExtras 统一挂到页面顶部，这里不重复渲染 */
    wrap.appendChild(s1);
    wrap.appendChild(s2);
    wrap.appendChild(s3);

    // 清空 root 并重新装配（head 保留在最上方）
    var keepHead = head ? head.cloneNode(true) : null;
    root.innerHTML = '';
    if (keepHead) root.appendChild(keepHead);
    // 注意：navHtml 返回的是 HTML 字符串，必须用 insertAdjacentHTML 而不是 appendChild
    root.insertAdjacentHTML('beforeend', navHtml(current, [
      current > 1,
      questions.length ? questions.every(function (q) {
        var input = q.querySelector('[data-transfer-answer]');
        return questionSession(input).correctness === 'correct';
      }) : false,
      false
    ]));
    root.appendChild(wrap);

    // 「从笔记提炼知识卡」已迁移到上传页，这里不再折叠展示（隐藏逻辑见 ensureLoopExtras）

    applyStep(view, current, questions);
    bind(view, questions);
  }

  function applyStep(view, current, questions) {
    view.querySelectorAll('[data-lw-step-panel]').forEach(function (panel) {
      panel.classList.toggle('lw-hidden', Number(panel.dataset.lwStepPanel) !== current);
    });
    view.querySelectorAll('[data-lw-step]').forEach(function (button) {
      var number = Number(button.dataset.lwStep);
      button.classList.toggle('on', number === current);
    });

    if (current !== 2) return;

    // 一次只显示一个子关卡
    var index = Math.max(0, Math.min(questions.length - 1, Number(app.state.loopWizardKid || 0)));
    app.state.loopWizardKid = index;
    questions.forEach(function (question, i) {
      question.classList.toggle('lw-hidden', i !== index);
    });

    var kidBar = view.querySelector('[data-lw-kids]');
    if (kidBar) {
      var labels = ['① 近迁移', '② 变式迁移', '③ 混合迁移'];
      kidBar.innerHTML = questions.map(function (question, i) {
        var session = questionSession(question.querySelector('[data-transfer-answer]'));
        var done = session.correctness === 'correct';
        var cls = i === index ? 'on' : (done ? 'done' : '');
        return '<button class="lw-kid ' + cls + '" data-lw-kid="' + i + '">'
          + (done ? '✓ ' : '') + (labels[i] || ('第 ' + (i + 1) + ' 关')) + '</button>';
      }).join('');
    }

    // 当前关已通过 -> 给一个明确的「进入下一关」按钮
    var currentQuestion = questions[index];
    var session = questionSession(currentQuestion && currentQuestion.querySelector('[data-transfer-answer]'));
    var stage = view.querySelector('[data-lw-stage]');
    var existing = view.querySelector('[data-lw-kid-next]');
    if (existing) existing.remove();
    if (stage && session.correctness === 'correct' && index < questions.length - 1) {
      var next = document.createElement('div');
      next.className = 'lw-foot';
      next.innerHTML = '<button class="primary" data-lw-kid-next>✓ 这一关通过了，进入下一关</button>';
      stage.after(next);
    }
  }

  /* ---------------- Step 3 ---------------- */
  function renderUnderstanding() {
    var host = document.querySelector('[data-lw-under-host]');
    if (!host) return;
    var state = ui.understanding;
    if (state && state.saved) {
      host.innerHTML = '<div class="pp-quote" style="background:#eefaf1;border-left-color:#2f9e5f">'
        + '<b>已保存到个人知识卡库</b><p class="muted">你的理解已经成为一张知识卡，并进入 FSRS 复习队列；不会自动发布到学生共享广场。'
        + (state.sourceUnlinked ? '原题尚未同步到服务器，本卡暂未关联原题。' : '') + '</p>'
        + (state.libraryVerified === false ? '<p class="geometry-alert">服务器已返回保存成功，但暂未核对到知识卡列表；请打开知识卡库重试查看。</p>' : '')
        + '<button type="button" data-lw-open-card-library>查看我的知识卡库</button></div>';
      host.querySelector('[data-lw-open-card-library]').onclick = function () {
        if (window.__openKnowledgeCardLibrary) window.__openKnowledgeCardLibrary(state.savedCardId);
        else { app.state.tab = 'card-challenge'; app.save(); app.render(); }
      };
      return;
    }
    if (state && state.skipped) {
      host.innerHTML = '<p class="muted">这次先跳过。想补写时，仍可回到这里。</p><button data-lw-under-resume>补写知识卡</button>';
      host.querySelector('[data-lw-under-resume]').onclick = function () { state.skipped = false; renderUnderstanding(); };
      return;
    }
    var point = state ? state.knowledgePoint : '';
    var text = state ? (state.backContent||state.text) : '';
    host.innerHTML = '<p class="muted">勾选前页要显示的题目、知识点或引导问题；再选一段 AI 陪练内容作为背面。两面都可二次编辑。</p>'
      + '<section class="lw-card-composer"><h3>卡片正面 · 回忆提示</h3><div class="lw-source-options">' + renderCardSourceOptions(state&&state.frontChoices,'front') + '</div><label>正面内容<textarea data-lw-front maxlength="8000" placeholder="勾选上方素材，或在这里直接编辑完整的题目与提示。">' + e(state&&state.frontContent||'') + '</textarea></label></section>'
      + '<section class="lw-card-composer"><h3>卡片背面 · 我的理解 / AI 陪练</h3><div class="lw-source-options">' + renderCardSourceOptions(state&&state.backChoices,'back') + '</div><textarea data-lw-under maxlength="' + MAX_UNDERSTANDING + '" placeholder="勾选 AI 对话片段后，可继续编辑成自己看得懂的答案；也可以直接填写。">' + e(text || '') + '</textarea>'
      + '<p class="lw-count">' + String(text||'').length + ' / ' + MAX_UNDERSTANDING + ' 字</p></section>'
      + '<div class="lw-foot" style="justify-content:flex-start"><button class="primary" data-lw-under-save>保存为知识卡</button>'
      + '<button data-lw-under-skip>跳过</button></div>'
      + '<p class="lw-count">' + e(ui.error || '') + '</p>';

    var textarea = host.querySelector('[data-lw-under]');
    var frontInput=host.querySelector('[data-lw-front]');
    if(frontInput)frontInput.oninput=function(){if(ui.understanding)ui.understanding.frontContent=frontInput.value};
    function bindChoices(side, field, choicesKey, valueKey){
      host.querySelectorAll('[data-lw-'+side+'-choice]').forEach(function(input){input.onchange=function(){
        var choices=state[choicesKey]||[];choices.forEach(function(item){var option=host.querySelector('[data-lw-'+side+'-choice="'+CSS.escape(item.id)+'"]');if(option)item.checked=option.checked});
        var value=choices.filter(function(item){return item.checked}).map(function(item){return item.text}).join('\n\n');field.value=value;state[valueKey]=value;if(side==='back')state.text=value;
      }});
    }
    if (textarea) {
      textarea.oninput = function () {
        if (ui.understanding) {ui.understanding.text = textarea.value;ui.understanding.backContent=textarea.value;}
        var counter = host.querySelector('.lw-count');
        if (counter) {
          counter.textContent = textarea.value.length + ' / ' + MAX_UNDERSTANDING + ' 字';
          counter.classList.toggle('over', textarea.value.length > MAX_UNDERSTANDING);
        }
      };
      bindChoices('back',textarea,'backChoices','backContent');
    }
    var frontField=host.querySelector('[data-lw-front]');if(frontField)bindChoices('front',frontField,'frontChoices','frontContent');
      host.querySelectorAll('[data-lw-under-save]').forEach(function (button) {
      button.onclick = function () {
        if (!ui.understanding || ui.understanding.saving) return;
        var value = String(textarea.value || '').trim();
        ui.understanding.text = value;
        if (value.length < 8) { ui.error = '再多写一点。'; renderUnderstanding(); return; }
        ui.understanding.saving = true;
        button.disabled = true;
        // 保存前以实际 checkbox DOM 为准再同步一次，避免 UI 状态与内存草稿脱节。
        (ui.understanding.frontChoices||[]).forEach(function(item){var option=host.querySelector('[data-lw-front-choice="'+CSS.escape(item.id)+'"]');if(option)item.checked=option.checked});
        var frontContent=String(frontField&&frontField.value||ui.understanding.frontContent||'').trim();
        var selectedQuestion=(ui.understanding.frontChoices||[]).find(function(item){return item.id==='question'&&item.checked});
        if(selectedQuestion&&!frontContent.includes(selectedQuestion.text))frontContent=selectedQuestion.text+(frontContent?'\n\n'+frontContent:'');
        ui.understanding.frontContent=frontContent;
        var payload = {
          text: value,
          frontContent: frontContent,
          backContent: value,
          title: ui.understanding.knowledgePoint+' · 复习卡',
          knowledgePoint: ui.understanding.knowledgePoint,
          subject: ui.understanding.subject,
          sourceCaseIds: ui.understanding.sourceCaseId ? [ui.understanding.sourceCaseId] : [],
          trigger: 'self_complete'
        };
        function postCard(body) { return app.request('/v1/study/understanding', {
          method: 'POST',
          body: JSON.stringify(body)
        }); }
        postCard(payload).catch(function (error) {
          // 老演示题可能只在浏览器缓存中，服务端没有相同 ID。
          // 保留学生的卡片内容，但不能伪造对原题的关联。
          if (error.code !== 'SOURCE_CASE_NOT_FOUND') throw error;
          ui.understanding.sourceUnlinked = true;
          return postCard({...payload, sourceCaseIds: []});
        }).then(async function (result) {
          ui.understanding.savedCardId = result.card.id;
          ui.understanding.saved = true;
          ui.understanding.saving = false;
          ui.error = '';
          try {
            var cards = await app.request('/v1/knowledge-cards');
            var card = Array.isArray(cards) && cards.find(function (item) { return item.id === result.card.id; });
            ui.understanding.libraryVerified = Boolean(card);
            if (card && window.__acceptSavedKnowledgeCard) window.__acceptSavedKnowledgeCard(card);
          } catch (error) {
            ui.understanding.libraryVerified = false;
          }
          app.render();
        }).catch(function (error) {
          ui.understanding.saving = false;
          ui.error = '保存失败：' + error.message;
          renderUnderstanding();
        });
      };
    });
    host.querySelectorAll('[data-lw-under-skip]').forEach(function (button) {
      button.onclick = function () { ui.understanding.skipped = true; renderUnderstanding(); };
    });
  }

  /* ---------------- 真实回忆评分（FSRS） ---------------- */
  /** 当前这道题用于评分的 id：错题和知识卡共用同一套 /v1/study/review */
  function reviewTargetId() {
    var loop = app.state.loop || {};
    return loop.activeId || null;
  }

  /** 把「下次 X 天」写到三个评分按钮上 */
  function loadRatingHints() {
    var id = reviewTargetId();
    if (!id || !document.querySelector('[data-lw-rate-hint]')) return;
    app.request('/v1/study/rating-hints/' + encodeURIComponent(id))
      .then(function (result) {
        (result.hints || []).forEach(function (hint) {
          var node = document.querySelector('[data-lw-rate-hint="' + hint.value + '"]');
          if (!node) return;
          node.textContent = (hint.hint || '') + (hint.intervalText ? ' · 下次 ' + hint.intervalText : '');
        });
      })
      .catch(function () { /* 拿不到提示不影响评分 */ });
  }

  function submitRecallRating(rating) {
    var id = reviewTargetId();
    var receipt = document.querySelector('[data-lw-rate-receipt]');
    if (!id) {
      if (receipt) receipt.textContent = '这一步没有可评分的题目，请从计划页重新进入。';
      return;
    }
    var buttons = document.querySelectorAll('[data-lw-rate]');
    Array.prototype.forEach.call(buttons, function (button) { button.disabled = true; });
    app.request('/v1/study/review', {method: 'POST', body: JSON.stringify({cardId: id, rating: rating})})
      .then(function (result) {
        // 按钮上写的是「不会 / 有点模糊 / 会了」，回执也用同一套说法，避免一会儿「还行」一会儿「会了」
        var label = ({1: '不会', 2: '有点模糊', 3: '会了'})[rating] || result.label || String(rating);
        var days = Number(result.intervalDays);
        var text = Number.isFinite(days) ? (days < 1 ? '今天稍后' : Math.round(days) + ' 天后') : '—';
        if (receipt) {
          receipt.className = 'lw-receipt';
          receipt.style.background = '';
          receipt.style.borderColor = '';
          receipt.style.color = '';
          receipt.innerHTML = '<b>已记录：' + e(label) + '</b> · 下次复习：' + e(text)
            + (result.dueAt ? '（' + e(String(result.dueAt).slice(0, 10)) + '）' : '')
            + (result.repeat ? ' · 这一张会重新排进本轮队列' : '');
        }
        // 记到共享状态里，计划页会显示「上次评分 … · 下次复习：X 天后」
        var record = (app.state.mistakes || []).find(function (item) { return item.id === id; });
        app.state.lastReviewReceipt = {
          cardId: id,
          knowledgePoint: (record && (record.knowledgePoints || [])[0]) || '',
          rating: rating,
          label: label,
          intervalDays: Number.isFinite(days) ? days : null,
          intervalText: text,
          dueAt: result.dueAt || null,
          at: new Date().toISOString()
        };
        app.save();
        Array.prototype.forEach.call(buttons, function (button) { button.disabled = false; });
        loadRatingHints();
      })
      .catch(function (error) {
        if (receipt) {
          receipt.className = 'lw-receipt';
          receipt.style.background = '#fdeef0';
          receipt.style.borderColor = '#f0c4bf';
          receipt.style.color = '#a83a4a';
          receipt.textContent = '评分没提交成功：' + error.message + '（可以再点一次）';
        }
        Array.prototype.forEach.call(buttons, function (button) { button.disabled = false; });
      });
  }

  /** 一组题按顺序推进 */
  function gotoQueueIndex(index) {
    var queue = (app.state.loop && app.state.loop.trainingQueue) || [];
    if (!(index >= 0) || index >= queue.length) return;
    app.state.loop.activeId = queue[index];
    app.state.loop.activeTaskId = null;
    app.state.loopWizardStep = 1;          // 换一道题从「回顾诊断」重新开始
    app.save();
    app.render();
  }

  /* ---------------- 事件 ---------------- */
  function bind(view, questions) {
    view.querySelectorAll('[data-lw-step]').forEach(function (button) {
      button.onclick = function () { setStep(Number(button.dataset.lwStep)); renderUnderstanding(); };
    });
    view.querySelectorAll('[data-lw-next]').forEach(function (button) {
      button.onclick = function () { setStep(Number(button.dataset.lwNext)); renderUnderstanding(); };
    });
    view.querySelectorAll('[data-lw-prev]').forEach(function (button) {
      button.onclick = function () { setStep(Number(button.dataset.lwPrev)); renderUnderstanding(); };
    });
    view.querySelectorAll('[data-lw-kid]').forEach(function (button) {
      button.onclick = function () {
        app.state.loopWizardKid = Number(button.dataset.lwKid);
        app.save();
        app.render();
      };
    });
    view.querySelectorAll('[data-lw-kid-next]').forEach(function (button) {
      button.onclick = function () {
        app.state.loopWizardKid = Math.min(questions.length - 1, Number(app.state.loopWizardKid || 0) + 1);
        app.save();
        app.render();
      };
    });
    // 真实回忆评分 → 调 FSRS
    view.querySelectorAll('[data-lw-rate]').forEach(function (button) {
      button.onclick = function () { submitRecallRating(Number(button.dataset.lwRate)); };
    });
    // 一组题按顺序做
    view.querySelectorAll('[data-lw-queue-next]').forEach(function (button) {
      button.onclick = function () { gotoQueueIndex(Number(button.dataset.lwQueueNext)); };
    });
    view.querySelectorAll('[data-lw-queue-prev]').forEach(function (button) {
      button.onclick = function () { gotoQueueIndex(Number(button.dataset.lwQueuePrev)); };
    });
    loadRatingHints();
    renderUnderstanding();
  }

  var feature = {
    activate: function (context) { app = context; },
    wizardify: wizardify,
    setUnderstandingPoint: function (knowledgePoint, caseId) {
      ui.understanding = {knowledgePoint: knowledgePoint, sourceCaseId: caseId, text: '', saved: false};
    }
  };

  if (window.__registerLoopWizard) window.__registerLoopWizard(feature);
})();
