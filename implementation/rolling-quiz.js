/* 知识卡片滚动测验（独立模块）
 *
 * 接入方式：index.html 里的 window.__registerRollingQuiz(feature)
 * 它接管 card-challenge 这个页面。
 *
 * 交互（扇贝单词式）：
 *   · 卡片是叠起来的一摞，按住上下拖动真实跟手，松手超过阈值就翻到下一张
 *   · 点「记住了」把当前卡翻转过来：上栏「我的理解」= 学生原话，下栏「AI 补充」= 标准解析
 *   · 正面三个选项只是预判，均须翻面核对，可撤回预判
 *   · 背面最终评分才写入 FSRS；选「不会」会在本轮末尾再出现一次
 *   · 顶部可一键预览整座知识卡片库
 *   · 评分 >= 3 后请他用自己的话总结该知识点（不超过 200 字）
 */
(function () {
  'use strict';

  var app = null;
  var busy = false;
  var MAX_UNDERSTANDING = 200;

  var ui = {
    quiz: null,
    subject: 'all',
    index: 0,
    flipped: false,
    precheck: null,
    records: [],
    understanding: null,
    library: null,        // 知识卡库
    libraryOpen: false,
    libraryDetail: null,
    libraryEdit: null,
    libraryOnly: false,
    libraryReturnTab: 'plan',
    error: '',
    toast: ''
  };

  var drag = {active: false, startY: 0, offsetY: 0, pointerId: null, moved: false};

  /* ---------------- 样式 ---------------- */
  var style = document.createElement('style');
  style.textContent = [
    '.rq-wrap{max-width:720px;margin:0 auto}',
    '.rq-bar{height:8px;background:#e6edff;border-radius:999px;overflow:hidden;margin:10px 0 8px}',
    '.rq-bar i{display:block;height:100%;background:linear-gradient(90deg,#315efb,#72a8ff)}',
    /* 卡片牌堆 */
    '.rq-deck{position:relative;height:420px;margin:14px 0 10px;perspective:1500px;touch-action:none;user-select:none}',
    '.rq-card{position:absolute;left:0;right:0;top:0;height:100%;transition:transform .26s cubic-bezier(.22,1,.36,1), opacity .26s}',
    '.rq-card.dragging{transition:none}',
    '.rq-card.behind{transform:translateY(16px) scale(.955);opacity:.62;pointer-events:none}',
    '.rq-card.behind2{transform:translateY(30px) scale(.91);opacity:.3;pointer-events:none}',
    '.rq-card.leaving{transform:translateY(-130%) rotate(-7deg);opacity:0}',
    '.rq-card.entering{transform:translateY(60%);opacity:0}',
    '.rq-inner{position:relative;width:100%;height:100%;transition:transform .5s cubic-bezier(.4,.2,.2,1);transform-style:preserve-3d}',
    '.rq-inner.flipped{transform:rotateY(180deg)}',
    '.rq-face{position:absolute;inset:0;backface-visibility:hidden;border-radius:22px;padding:24px;display:flex;flex-direction:column;justify-content:center;gap:12px;border:1px solid #dbe5f5;background:#fff;box-shadow:0 18px 40px rgba(21,45,90,.10);overflow:auto}',
    '.rq-front{background:linear-gradient(155deg,#f4f8ff,#fffaf2);border-color:#a9c4ff}',
    '.rq-back{transform:rotateY(180deg);background:#f7fbff;border-color:#bcd4ff;justify-content:flex-start}',
    '.rq-kp{font-size:24px;font-weight:650;color:#1d2b45;line-height:1.3}',
    '.rq-front-content{font-size:19px;font-weight:500;color:#1d2b45;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.rq-sub{font-size:13px;color:#65738b}',
    '.rq-quote{background:#fff;border:1px solid #c7d9ff;border-radius:10px;padding:12px;font-size:14px;color:#33415c;line-height:1.65}',
    '.rq-section-title{font-size:13px;font-weight:650;color:#3158b8;margin:10px 0 4px}',
    '.rq-hint-drag{text-align:center;font-size:12px;color:#8593a8;margin-top:6px}',
    '.rq-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}',
    '.rq-options button{padding:14px;border-radius:16px;border:1px solid #d7e1f2;background:#fff;cursor:pointer;text-align:left}',
    '.rq-options button:hover{border-color:#315efb;background:#f7faff}',
    '.rq-options b{display:block;font-size:15px;margin-bottom:2px}',
    '.rq-options span{font-size:12px;color:#65738b}',
    '.rq-options .rq-forgot b{color:#d9483f}',
    '.rq-options .rq-confirm b{color:#1f7a45}',
    '.rq-precheck{font-size:14px;line-height:1.5;color:#33415c;margin:12px 0 0}',
    '.rq-undo{margin-top:12px}',
    '@media(max-width:620px){.rq-options{grid-template-columns:1fr}.rq-options button{min-height:54px}}',
    '.rq-empty{padding:34px;text-align:center;color:#758095;border:1px dashed #c8d3e5;border-radius:16px}',
    '.rq-under textarea{width:100%;min-height:110px;margin-top:8px;padding:10px;border:1px solid #d7e1f2;border-radius:12px;font-family:inherit}',
    '.rq-note{font-size:12px;color:#8593a8}',
    '.rq-count{font-size:12px;color:#8593a8}',
    '.rq-count.over{color:#c0392b}',
    /* 卡片库浮层 */
    '.rq-lib{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9200;display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto}',
    '.rq-lib-panel{background:#fff;border-radius:20px;max-width:900px;width:100%;padding:20px}',
    '.rq-lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:14px}',
    '.rq-lib-subject{margin-top:18px}.rq-lib-subject h3{margin:0 0 8px;color:#24467f}.rq-lib-subject h3 span{font-size:12px;color:#65738b;font-weight:400}',
    '.rq-lib-card{border:1px solid #e3eaf6;border-radius:14px;padding:12px;cursor:pointer;background:#fff}',
    '.rq-lib-card:hover{border-color:#315efb;background:#f7faff}',
    '.rq-lib-card-actions{display:flex;gap:6px;margin-top:10px}',
    '.rq-lib-card-actions button{padding:6px 9px;font-size:12px}',
    '.rq-lib-edit-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}',
    '.rq-lib-edit-form label{display:block;font-size:13px;color:#52637c}',
    '.rq-lib-edit-form input,.rq-lib-edit-form textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1px solid #ccd8eb;border-radius:10px;font:inherit}',
    '.rq-lib-edit-form textarea{min-height:90px}',
    '.rq-lib-edit-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
    '.rq-lib-edit-preview section{min-width:0;border:1px solid #dbe5f5;border-radius:14px;padding:14px;background:#f5f8ff}',
    '.rq-lib-edit-preview section:last-child{background:#fffaf0;border-color:#f0dfb5}',
    '.rq-lib-edit-preview h4{margin:0 0 8px;color:#3158a4;font-size:13px}',
    '.rq-lib-preview-content{min-height:48px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7;color:#1d2b45}',
    '.rq-lib-preview-content:empty:before{content:attr(data-placeholder);color:#8593a8}',
    '.rq-lib-edit-form .wide{grid-column:1/-1}',
    '@media(max-width:620px){.rq-lib-edit-form{grid-template-columns:1fr}.rq-lib-edit-form .wide{grid-column:auto}.rq-lib-edit-preview{grid-template-columns:1fr}}',
    '.rq-lib-card b{display:block;font-size:14px;margin-bottom:4px}',
    '.rq-lib-card p{margin:0;font-size:12px;color:#65738b;line-height:1.5}',
    '.rq-lib-detail{margin-top:14px;border-top:1px solid #eef3fb;padding-top:14px}',
    '.rq-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#10203a;color:#fff;padding:10px 18px;border-radius:999px;z-index:9300;font-size:14px}'
  ].join('');
  document.head.appendChild(style);

  function e(value) { return app.esc(String(value == null ? '' : value)); }

  function typesetFrontMath(root) {
    if (!root || !window.renderMathInElement) return;
    root.querySelectorAll('.rq-front-content').forEach(function (node) {
      var raw = node.textContent || '';
      var normalized = window.__eduNormalizeMathDelimiters?.(raw) || raw;
      node.textContent = window.EduMathDisplay?.wrapBareLatex?.(normalized) || normalized;
      try { window.renderMathInElement(node, {delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,strict:'ignore'}); } catch (_) {}
    });
  }

  /* 卡片背面（我的理解 / AI 补充 / 知识卡库详情）用的是 .rq-quote，之前只排版了正面
     .rq-front-content，所以背面里的 $...$ 一直以原始 LaTeX 显示（\frac{0+6}{2} 之类）。
     这里和正面共用同一套归一化 + KaTeX 流程，保证同一段文字两面表现一致。 */
  function typesetQuoteMath(root) {
    if (!root || !window.renderMathInElement) return;
    root.querySelectorAll('.rq-quote').forEach(function (node) {
      var raw = node.textContent || '';
      var normalized = window.__eduNormalizeMathDelimiters?.(raw) || raw;
      node.textContent = window.EduMathDisplay?.wrapBareLatex?.(normalized) || normalized;
      try { window.renderMathInElement(node, {delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,strict:'ignore'}); } catch (_) {}
    });
  }

  function typesetEditPreviews(root) {
    if (!root || !window.renderMathInElement) return;
    root.querySelectorAll('.rq-lib-preview-content').forEach(function (node) {
      var raw = node.textContent || '';
      var normalized = window.__eduNormalizeMathDelimiters?.(raw) || raw;
      node.textContent = window.EduMathDisplay?.wrapBareLatex?.(normalized) || normalized;
      try { window.renderMathInElement(node, {delimiters:[{left:'$$',right:'$$',display:true},{left:'\\[',right:'\\]',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false}],throwOnError:false,strict:'ignore'}); } catch (_) {}
    });
  }

  function toast(message) {
    ui.toast = message;
    var node = document.createElement('div');
    node.className = 'rq-toast';
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, 2200);
  }

  /* ---------------- 数据 ---------------- */
  function load(force) {
    if (!force && ui.quiz) return Promise.resolve();
    return app.request('/v1/study/rolling-quiz?subject=' + encodeURIComponent(ui.subject))
      .then(function (result) {
        ui.quiz = result;
        ui.index = 0;
        ui.flipped = false;
        ui.precheck = null;
        ui.error = '';
      })
      .catch(function (error) { ui.error = '加载测验队列失败：' + error.message; });
  }

  function loadLibrary(force) {
    if (!force && ui.library) return Promise.resolve();
    return app.request('/v1/knowledge-cards')
      .then(function (cards) { ui.library = Array.isArray(cards) ? cards : (cards.cards || []); })
      .catch(function (error) { ui.error = '加载知识卡库失败：' + error.message; });
  }

  function saveLibraryCard(cardId) {
    var form = document.querySelector('[data-rq-lib-edit-form]');
    if (!form) return;
    var payload = {};
    form.querySelectorAll('[data-rq-edit-field]').forEach(function (field) { payload[field.dataset.rqEditField] = field.value.trim(); });
    if (!payload.title || !payload.subject) { ui.error = '卡片标题和学科不能为空。'; return app.render(); }
    busy = true; ui.error = '';
    app.request('/v1/knowledge-cards/' + encodeURIComponent(cardId), {method: 'PATCH', body: JSON.stringify(payload)})
      .then(function (updated) {
        ui.library = (ui.library || []).map(function (card) { return card.id === cardId ? updated : card; });
        ui.libraryEdit = null; ui.libraryDetail = cardId;
      })
      .catch(function (error) { ui.error = '保存失败：' + error.message; })
      .finally(function () { busy = false; app.render(); });
  }

  function deleteLibraryCard(cardId) {
    if (!window.confirm('删除这张知识卡及其复习记录？此操作无法撤销。')) return;
    busy = true; ui.error = '';
    app.request('/v1/knowledge-cards/' + encodeURIComponent(cardId), {method: 'DELETE'})
      .then(function () {
        ui.library = (ui.library || []).filter(function (card) { return card.id !== cardId; });
        if (ui.libraryDetail === cardId) ui.libraryDetail = null;
        if (ui.libraryEdit === cardId) ui.libraryEdit = null;
      })
      .catch(function (error) { ui.error = '删除失败：' + error.message; })
      .finally(function () { busy = false; app.render(); });
  }

  function currentItem() {
    if (!ui.quiz || !ui.quiz.items || !ui.quiz.items.length) return null;
    return ui.quiz.items[ui.index] || null;
  }

  function nextItem() {
    if (!ui.quiz || !ui.quiz.items) return null;
    return ui.quiz.items[ui.index + 1] || null;
  }

  function refIdOf(item) { return item ? item.ref_id : null; }

  function previewAnswer(choice) {
    if (busy || !currentItem()) return;
    ui.precheck = choice;
    ui.flipped = true;
    app.render();
  }

  /* ---------------- 提交 ---------------- */
  function submitRating(item, rating) {
    if (busy || !item) return;
    busy = true;
    app.request('/v1/study/review', {
      method: 'POST',
      body: JSON.stringify({cardId: refIdOf(item), rating: rating})
    }).then(function (result) {
      busy = false;
      toast('下次复习：' + (result.intervalText || '已按记忆间隔安排'));
      ui.records.push({
        ref_id: refIdOf(item), knowledgePoint: item.knowledgePoint,
        action: rating >= 3 ? 'passed' : rating === 2 ? 'fuzzy' : 'forgot', rating: rating, intervalText: result.intervalText
      });
      if (rating === 1) {
        // 已经按「不会」写入 FSRS；本轮末尾再出现，方便马上巩固。
        if (ui.quiz && ui.quiz.items.length > 1) {
          var moved = ui.quiz.items.splice(ui.index, 1)[0];
          ui.quiz.items.push(moved);
        } else {
          ui.index = 0;
        }
        ui.flipped = false;
        ui.precheck = null;
        app.render();
        return;
      }
      if (result.askUnderstanding) { openUnderstanding(item, rating); return; }
      advance();
    }).catch(function (error) {
      busy = false; ui.error = '提交失败：' + error.message; app.render();
    });
  }

  function advance() {
    ui.index += 1;
    ui.flipped = false;
    ui.precheck = null;
    app.render();
  }

  /* ---------------- 我的理解 ---------------- */
  function openUnderstanding(item, rating) {
    ui.understanding = {
      knowledgePoint: item.knowledgePoint,
      sourceCaseId: item.front && item.front.wrongQuestionId ? item.front.wrongQuestionId : null,
      text: '', saved: false, rating: rating
    };
    app.render();
  }

  function saveUnderstanding() {
    var state = ui.understanding;
    if (!state) return;
    var value = String(state.text || '').trim();
    if (value.length < 8) { ui.error = '再多写一点，至少要让人看懂你的思路。'; return app.render(); }
    if (value.length > MAX_UNDERSTANDING) { ui.error = '控制在 ' + MAX_UNDERSTANDING + ' 字以内。'; return app.render(); }
    busy = true; ui.error = '';
    app.request('/v1/study/understanding', {
      method: 'POST',
      body: JSON.stringify({
        text: value, knowledgePoint: state.knowledgePoint,
        sourceCaseIds: state.sourceCaseId ? [state.sourceCaseId] : [],
        trigger: 'review_passed'
      })
    }).then(function () {
      busy = false; state.saved = true; app.render();
      setTimeout(function () { ui.understanding = null; advance(); }, 900);
    }).catch(function (error) { busy = false; ui.error = '保存失败：' + error.message; app.render(); });
  }

  /* ---------------- 牌堆渲染 ---------------- */
  function faceHtml(item, isBack, hidden) {
    var front = item.front || {};
    var back = item.back || {};
    if (!isBack) {
      return '<div class="rq-face rq-front"' + (hidden ? ' aria-hidden="true"' : '') + '>'
        + '<div class="rq-sub">' + e(front.subject || item.subject) + ' · 知识卡</div>'
        + '<div class="rq-front-content">' + e(String(front.cue == null ? '' : front.cue).trim() || '卡片正面还没有内容，请先编辑添加提示。') + '</div>'
        + '</div>';
    }
    return '<div class="rq-face rq-back"' + (hidden ? ' aria-hidden="true"' : '') + '>'
      + '<div class="rq-section-title">我的理解</div>'
      + '<div class="rq-quote">' + (back.myUnderstanding ? e(back.myUnderstanding) : '<span class="rq-note">你还没有写过这个知识点的理解。</span>') + '</div>'
      + '<div class="rq-section-title">AI 补充</div>'
      + '<div class="rq-quote">' + (back.aiExplanation ? e(back.aiExplanation) : '<span class="rq-note">暂无标准解析，完成一次 AI 陪练后会自动补上。</span>') + '</div>'
      + (back.nextTimeAction ? '<div class="rq-note">下次这样做：' + e(back.nextTimeAction) + '</div>' : '')
      + '</div>';
  }

  function deckHtml(items) {
    var current = items[ui.index];
    var behind = items[ui.index + 1];
    var behind2 = items[ui.index + 2];
    return '<div class="rq-deck" data-rq-deck>'
      + (behind2 ? '<div class="rq-card behind2"><div class="rq-inner">' + faceHtml(behind2, false) + '</div></div>' : '')
      + (behind ? '<div class="rq-card behind"><div class="rq-inner">' + faceHtml(behind, false) + '</div></div>' : '')
      + '<div class="rq-card current" data-rq-drag>'
      + '<div class="rq-inner' + (ui.flipped ? ' flipped' : '') + '">' + faceHtml(current, false, ui.flipped) + faceHtml(current, true, !ui.flipped) + '</div>'
      + '</div>'
      + '</div>';
  }

  function optionsHtml() {
    if (ui.flipped) {
      var previewLabels = {remembered: '记住了', fuzzy: '有点模糊', forgot: '刚忘掉了'};
      return '<p class="rq-precheck" role="status">' + (ui.precheck
        ? '刚才预判「' + previewLabels[ui.precheck] + '」。核对后发现记错了？直接改选下面的最终结果。'
        : '先核对卡片背面，再决定真实掌握情况。') + '</p>'
        + '<div class="rq-options">'
        + '<button data-rq-again><b>不会</b><span>按 FSRS 安排，并在本轮再练一次</span></button>'
        + '<button data-rq-missed><b>有点模糊</b><span>按 FSRS 缩短间隔</span></button>'
        + '<button class="rq-confirm" data-rq-confirm><b>会了</b><span>按 FSRS 安排下一次复习</span></button>'
        + '</div>'
      + '<button type="button" class="rq-undo" data-rq-undo>撤回刚才的预判，回正面</button>';
    }
    return '<div class="rq-options">'
      + '<button data-rq-remember><b>记住了</b><span>翻到背面确认一下</span></button>'
      + '<button data-rq-fuzzy><b>有点模糊</b><span>先翻开卡片核对</span></button>'
      + '<button class="rq-forgot" data-rq-forgot><b>对不起，我刚忘掉了</b><span>先翻面确认，再决定怎么复习</span></button>'
      + '</div>'
      + '<p class="rq-hint-drag">↑ 也可以向上滑动卡片，翻开核对</p>';
  }

  function understandingHtml() {
    var state = ui.understanding;
    if (!state) return '';
    if (state.saved) {
      return '<section class="panel rq-under"><span class="pill good">已保存</span><h2>你的理解已经进复习队列</h2>'
        + '<p class="muted">它会成为下次复习时卡片背面的「我的理解」。</p></section>';
    }
    var length = String(state.text || '').length;
    return '<section class="panel rq-under"><span class="pill">我的理解</span>'
      + '<h2>用你自己的话，总结「' + e(state.knowledgePoint || '这个知识点') + '」</h2>'
      + '<p class="muted">你刚答对了，趁热把它变成自己的话（不超过 ' + MAX_UNDERSTANDING + ' 字）。</p>'
      + '<textarea data-rq-under maxlength="' + MAX_UNDERSTANDING + '" placeholder="它是解决什么问题的？关键判断是什么？下次第一步做什么？">' + e(state.text || '') + '</textarea>'
      + '<p class="rq-note rq-count' + (length > MAX_UNDERSTANDING ? ' over' : '') + '">' + length + ' / ' + MAX_UNDERSTANDING + ' 字</p>'
      + '<div class="row"><button class="primary" data-rq-under-save ' + (busy ? 'disabled' : '') + '>保存为知识卡</button>'
      + '<button data-rq-under-skip>跳过</button></div>'
      + '<p class="rq-note">' + e(ui.error || '写下来才会进复习队列。') + '</p></section>';
  }

  function summaryHtml() {
    var records = ui.records;
    var passed = records.filter(function (item) { return item.action === 'passed'; }).length;
    var fuzzy = records.filter(function (item) { return item.action === 'fuzzy'; }).length;
    var forgot = records.filter(function (item) { return item.action === 'forgot'; }).length;
    return '<section class="panel rq-wrap"><span class="pill good">本轮完成</span><h2>这一轮过完了</h2>'
      + '<p class="muted">会了 ' + passed + ' 张 · 仍需复习 ' + fuzzy + ' 张 · 忘掉重排 ' + forgot + ' 张。</p>'
      + '<div class="row"><button class="primary" data-rq-restart>再来一轮</button>'
      + '<button data-rq-library>预览知识卡库</button>'
      + '<button data-rq-back>返回归纳</button></div></section>' + understandingHtml();
  }

  /* ---------------- 知识卡库 ---------------- */
  function libraryHtml() {
    if (!ui.libraryOpen) return '';
    var cards = ui.library || [];
    var grouped = Array.from(new Set(cards.map(function(card){return card.subject||'未分类'}))).sort(function(a,b){return a.localeCompare(b,'zh')}).map(function(subject){
      var subjectCards=cards.filter(function(card){return (card.subject||'未分类')===subject});
      return '<section class="rq-lib-subject"><h3>'+e(subject)+' <span>'+subjectCards.length+' 张</span></h3><div class="rq-lib-grid">'+subjectCards.map(function(card){
        return '<div class="rq-lib-card" data-rq-lib-card="'+e(card.id)+'"><b>'+e(card.knowledgePoint||card.title||'未命名')+'</b><p>'+e(String(card.content||card.insight||'').slice(0,60))+'</p><p class="rq-note">'+e(card.subject||'')+(card.masteryStatus==='mastered'?' · 已掌握':' · 学习中')+'</p><div class="rq-lib-card-actions"><button data-rq-lib-share="'+e(card.id)+'">分享</button><button data-rq-lib-edit="'+e(card.id)+'">编辑</button><button data-rq-lib-delete="'+e(card.id)+'">删除</button></div></div>';
      }).join('')+'</div></section>';
    }).join('');
    // 编辑态收起长列表：否则点击编辑后表单被追加到列表末尾，重渲染又回到顶部，用户会以为按钮没反应。
    if (ui.libraryEdit) grouped = '';
    var detail = ui.libraryDetail
      ? (function () {
        var card = cards.find(function (item) { return item.id === ui.libraryDetail; });
        if (!card) return '';
        var editForm = ui.libraryEdit === card.id
          ? '<form class="rq-lib-edit-form" data-rq-lib-edit-form>'
            + '<label>卡片标题<input data-rq-edit-field="title" maxlength="120" value="' + e(card.title || '') + '"></label>'
            + '<label>学科<input data-rq-edit-field="subject" maxlength="40" value="' + e(card.subject || '未分类') + '"></label>'
            + '<label>知识点<input data-rq-edit-field="knowledgePoint" maxlength="120" value="' + e(card.knowledgePoint || '') + '"></label>'
            + '<label class="wide">正面内容（学生先看到的提示）<textarea data-rq-edit-field="frontContent" maxlength="8000">' + e(card.frontContent || card.challengePrompt || '') + '</textarea></label>'
            + '<label class="wide">背面内容（翻卡后看到的答案与理解）<textarea data-rq-edit-field="backContent" maxlength="8000">' + e(card.backContent || card.content || card.insight || '') + '</textarea></label>'
            + '<div class="wide rq-lib-edit-preview" aria-live="polite"><section><h4>正面预览 · 学生先看到</h4><div class="rq-lib-preview-content" data-rq-edit-preview="frontContent" data-placeholder="正面暂时为空">' + e(card.frontContent || card.challengePrompt || '') + '</div></section><section><h4>背面预览 · 翻卡后看到</h4><div class="rq-lib-preview-content" data-rq-edit-preview="backContent" data-placeholder="背面暂时为空">' + e(card.backContent || card.content || card.insight || '') + '</div></section></div>'
            + '<div class="wide" style="display:flex;gap:8px"><button type="button" class="primary" data-rq-lib-save="' + e(card.id) + '" ' + (busy ? 'disabled' : '') + '>保存</button><button type="button" data-rq-lib-edit-cancel>取消</button></div></form>'
          : '';
        return '<div class="rq-lib-detail">'
          + '<div class="rq-section-title">正面内容</div>'
          + (function () {
              // 正面为空时不再静默顶替成一句像样的问题：那会把「正面丢了」伪装成正常显示。
              var frontText = String(card.frontContent || card.challengePrompt || '').trim();
              if (frontText) return '<div class="rq-quote">' + e(frontText) + '</div>';
              return '<div class="rq-quote rq-quote-empty">（这张卡正面是空的：既没有题目也没有提示。点下面「编辑这张卡」补齐后再复习。）</div>';
            })()
          + '<div class="rq-section-title">背面内容</div>'
          + '<div class="rq-quote">' + e(card.backContent || card.content || card.insight || card.ai_explanation || '（暂无内容）') + '</div>'
          + (card.nextTimeAction ? '<p class="rq-note">下次这样做：' + e(card.nextTimeAction) + '</p>' : '')
          + (ui.error ? '<p class="rq-note" role="status">' + e(ui.error) + '</p>' : '')
          + '<div class="rq-lib-card-actions"><button data-rq-lib-share="' + e(card.id) + '">分享到共享知识库</button><button data-rq-lib-edit="' + e(card.id) + '">' + (ui.libraryEdit === card.id ? '正在编辑' : '编辑这张卡') + '</button><button data-rq-lib-delete="' + e(card.id) + '">删除这张卡</button></div>'
          + editForm
          + '</div>';
      })()
      : '';
    return '<div class="rq-lib" data-rq-lib-overlay><div class="rq-lib-panel">'
      + '<div class="head"><div><span class="pill good">知识卡库</span><h2>' + (ui.libraryEdit ? '编辑知识卡' : '我的知识卡片（' + cards.length + ' 张）') + '</h2>'
      + '<p class="muted">' + (ui.libraryEdit ? '修改卡片正面与背面，保存后会同步到个人知识卡库。' : '这里是你写过的全部「我的理解」，点任意一张看正反面。') + '</p></div>'
      + '<button data-rq-lib-close>' + (ui.libraryOnly ? (ui.libraryReturnTab === 'plan' ? '返回计划' : '返回上一页') : '关闭') + '</button></div>'
      + (app.state.lastKnowledgeCardShare ? '<p class="rq-note" role="status" data-rq-share-receipt>'+e(app.state.lastKnowledgeCardShare)+' <button type="button" data-rq-share-receipt-close aria-label="关闭提示">知道了</button></p>' : '')
      + (cards.length
        ? grouped
        : '<div class="rq-empty">还没有知识卡。完成一次复习并写下「我的理解」后就会出现在这里。</div>')
      + detail + '</div></div>';
  }

  /* ---------------- 页面 ---------------- */
  function renderQuiz(v) {
    v.className = 'work';
    if (ui.libraryOnly) {
      v.innerHTML = libraryHtml();
      typesetEditPreviews(v);
      typesetQuoteMath(v);
      bind(v);
      return;
    }
    if (!ui.quiz) {
      v.innerHTML = '<section class="panel rq-wrap"><div class="rq-empty">正在读取测验队列…</div></section>';
      load(true).then(function () { app.render(); });
      return;
    }
    var items = ui.quiz.items || [];
    var subjects = ui.quiz.subjects || [];
    var done = Math.min(ui.index, items.length);
    var percent = items.length ? Math.round(done / items.length * 100) : 0;

    var filter = '<div class="st-filter">'
      + '<button class="' + (ui.subject === 'all' ? 'active' : '') + '" data-rq-subject="all">全科混合</button>'
      + subjects.map(function (subject) {
        return '<button class="' + (ui.subject === subject ? 'active' : '') + '" data-rq-subject="' + e(subject) + '">' + e(subject) + '</button>';
      }).join('') + '</div>';

    var header = '<section class="panel rq-wrap"><div class="head"><div><span class="pill good">滚动测验</span><h2>卡片滚动测验</h2>'
      + '<p class="muted">只复习知识点，不展示原题；错题仍在错题库。翻面后评分，由 FSRS 安排下次复习。</p></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button data-rq-library>卡片总览</button><button data-rq-exit>退出闯关 · 返回计划</button></div></div>'
      + filter
      + '<div class="rq-bar"><i style="width:' + percent + '%"></i></div>'
      + '<div class="rq-note">待复习 <b>' + (ui.quiz.stats ? ui.quiz.stats.due : items.length) + '</b> 张 · 已过 ' + done + ' 张</div>'
      + (ui.error ? '<div class="st-analysis st-bad">' + e(ui.error) + '</div>' : '')
      + '</section>';

    var item = currentItem();
    var body;
    if (!item) {
      body = summaryHtml();
    } else if (ui.understanding && !ui.understanding.saved) {
      body = '<section class="panel rq-wrap">' + understandingHtml() + '</section>';
    } else {
      body = '<section class="panel rq-wrap">' + deckHtml(items) + optionsHtml()
        + '<p class="rq-note" style="text-align:center">第 ' + (ui.index + 1) + ' / ' + items.length + ' 张</p></section>'
        + understandingHtml();
    }

    v.innerHTML = header + body + libraryHtml();
    typesetFrontMath(v);
    typesetEditPreviews(v);
    typesetQuoteMath(v);
    bind(v);
  }

  /* ---------------- 拖拽 ---------------- */
  function attachDrag(card) {
    if (!card) return;
    card.addEventListener('pointerdown', function (event) {
      if (busy) return;
      drag.active = true;
      drag.pointerId = event.pointerId;
      drag.startY = event.clientY;
      drag.offsetY = 0;
      drag.moved = false;
      card.classList.add('dragging');
      try { card.setPointerCapture(event.pointerId); } catch (_) {}
    });
    card.addEventListener('pointermove', function (event) {
      if (!drag.active || event.pointerId !== drag.pointerId) return;
      drag.offsetY = event.clientY - drag.startY;
      if (Math.abs(drag.offsetY) > 6) drag.moved = true;
      var rotate = Math.max(-8, Math.min(8, drag.offsetY / 26));
      card.style.transform = 'translateY(' + drag.offsetY + 'px) rotate(' + rotate + 'deg)';
      card.style.opacity = String(Math.max(0.3, 1 - Math.abs(drag.offsetY) / 520));
    });
    var finish = function (event) {
      if (!drag.active || (event && event.pointerId !== drag.pointerId)) return;
      drag.active = false;
      card.classList.remove('dragging');
      card.style.transform = '';
      card.style.opacity = '';
      var moved = drag.moved;
      var offset = drag.offsetY;
      drag.offsetY = 0;
      // 上滑翻面，不允许绕开评分直接跳过知识卡。
      if (moved && offset < -90) {
        if (!ui.flipped) previewAnswer(null);
      } else if (moved && offset > 90 && ui.flipped) {
        ui.flipped = false;
        ui.precheck = null;
        app.render();
      } else if (moved && offset > 90 && ui.index > 0) {
        ui.index -= 1;
        ui.flipped = false;
        ui.precheck = null;
        app.render();
      }
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
    card.addEventListener('pointerleave', function (event) {
      if (drag.active) finish(event);
    });
  }

  /* ---------------- 事件 ---------------- */
  function bind(root) {
    root.querySelectorAll('[data-rq-exit]').forEach(function (button) {
      button.onclick = function () { app.state.tab = 'plan'; app.save(); app.render(); };
    });
    root.querySelectorAll('[data-rq-edit-field]').forEach(function (field) {
      field.oninput = function () {
        var preview = root.querySelector('[data-rq-edit-preview="' + field.dataset.rqEditField + '"]');
        if (preview) { preview.textContent = field.value; typesetEditPreviews(preview.parentNode); }
      };
    });
    root.querySelectorAll('[data-rq-subject]').forEach(function (button) {
      button.onclick = function () {
        ui.subject = button.dataset.rqSubject;
        ui.quiz = null; ui.records = []; ui.index = 0; ui.flipped = false; ui.precheck = null;
        load(true).then(function () { app.render(); });
      };
    });
    root.querySelectorAll('[data-rq-remember]').forEach(function (button) {
      button.onclick = function () { previewAnswer('remembered'); };
    });
    root.querySelectorAll('[data-rq-confirm]').forEach(function (button) {
      button.onclick = function () { submitRating(currentItem(), 3); };
    });
    root.querySelectorAll('[data-rq-again]').forEach(function (button) {
      button.onclick = function () { submitRating(currentItem(), 1); };
    });
    root.querySelectorAll('[data-rq-missed]').forEach(function (button) {
      button.onclick = function () { submitRating(currentItem(), 2); };
    });
    root.querySelectorAll('[data-rq-fuzzy]').forEach(function (button) {
      button.onclick = function () { previewAnswer('fuzzy'); };
    });
    root.querySelectorAll('[data-rq-forgot]').forEach(function (button) {
      button.onclick = function () { previewAnswer('forgot'); };
    });
    root.querySelectorAll('[data-rq-undo]').forEach(function (button) {
      button.onclick = function () { ui.flipped = false; ui.precheck = null; app.render(); };
    });
    var textarea = root.querySelector('[data-rq-under]');
    if (textarea) textarea.oninput = function () {
      ui.understanding.text = textarea.value;
      var counter = root.querySelector('.rq-count');
      if (counter) {
        counter.textContent = textarea.value.length + ' / ' + MAX_UNDERSTANDING + ' 字';
        counter.classList.toggle('over', textarea.value.length > MAX_UNDERSTANDING);
      }
    };
    root.querySelectorAll('[data-rq-under-save]').forEach(function (button) { button.onclick = saveUnderstanding; });
    root.querySelectorAll('[data-rq-under-skip]').forEach(function (button) {
      button.onclick = function () { ui.understanding = null; advance(); };
    });
    root.querySelectorAll('[data-rq-restart]').forEach(function (button) {
      button.onclick = function () {
        ui.records = []; ui.index = 0; ui.flipped = false; ui.precheck = null;
        load(true).then(function () { app.render(); });
      };
    });
    root.querySelectorAll('[data-rq-back]').forEach(function (button) {
      button.onclick = function () { app.state.tab = 'clusters'; app.save(); app.render(); };
    });
    // 知识卡库
    root.querySelectorAll('[data-rq-library]').forEach(function (button) {
      button.onclick = function () {
        ui.libraryOnly = false; ui.libraryOpen = true; ui.libraryDetail = null;
        loadLibrary(true).then(function () { app.render(); });
      };
    });
    function closeLibrary() {
      var returnTab = ui.libraryOnly ? ui.libraryReturnTab : null;
      ui.libraryOpen = false; ui.libraryOnly = false; ui.libraryDetail = null; ui.libraryEdit = null;
      if (returnTab) app.state.tab = returnTab;
      app.save(); app.render();
    }
    root.querySelectorAll('[data-rq-lib-close]').forEach(function (button) {
      button.onclick = closeLibrary;
    });
    root.querySelectorAll('[data-rq-share-receipt-close]').forEach(function (button) {
      button.onclick = function (event) { event.stopPropagation(); delete app.state.lastKnowledgeCardShare; app.save(); app.render(); };
    });
    root.querySelectorAll('[data-rq-lib-overlay]').forEach(function (overlay) {
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closeLibrary();
      });
    });
    root.querySelectorAll('[data-rq-lib-card]').forEach(function (node) {
      node.onclick = function () { ui.libraryDetail = node.dataset.rqLibCard; app.render(); };
    });
    root.querySelectorAll('[data-rq-lib-share]').forEach(function (button) {
      button.onclick = async function (event) {
        event.stopPropagation(); button.disabled = true;
        if (typeof window.__eduShareToPlaza !== 'function') { ui.error = '共享模块未加载，请刷新页面。'; button.disabled = false; return; }
        const result = await window.__eduShareToPlaza({cardId: button.dataset.rqLibShare});
        button.disabled = false;
        if (result?.ok) { ui.libraryOpen = false; ui.libraryOnly = false; ui.libraryDetail = null; ui.libraryEdit = null; }
      };
    });
    root.querySelectorAll('[data-rq-lib-edit]').forEach(function (button) {
      button.onclick = function (event) {
        event.stopPropagation();
        ui.libraryDetail = button.dataset.rqLibEdit;
        ui.libraryEdit = button.dataset.rqLibEdit;
        ui.error = '';
        app.render();
      };
    });
    root.querySelectorAll('[data-rq-lib-delete]').forEach(function (button) {
      button.onclick = function (event) { event.stopPropagation(); deleteLibraryCard(button.dataset.rqLibDelete); };
    });
    root.querySelectorAll('[data-rq-lib-save]').forEach(function (button) {
      button.onclick = function () { saveLibraryCard(button.dataset.rqLibSave); };
    });
    root.querySelectorAll('[data-rq-lib-edit-cancel]').forEach(function (button) {
      button.onclick = function () { ui.libraryEdit = null; ui.error = ''; app.render(); };
    });
    attachDrag(root.querySelector('[data-rq-drag]'));
  }

  /* ---------------- 注册 ---------------- */
  var feature = {
    activate: function (context) { app = context; load(true); },
    renderQuiz: renderQuiz,
    openLibrary: function (cardId) {
      ui.libraryReturnTab = app.state.tab || 'plan';
      ui.libraryOpen = true;
      ui.libraryOnly = true;
      ui.libraryDetail = cardId || null;
      app.state.tab = 'card-challenge';
      app.save();
      loadLibrary(true).then(function () {
        if (cardId && !(ui.library || []).some(function (item) { return item.id === cardId; })) {
          ui.error = '保存已完成，但当前知识卡列表未找到这张卡；请刷新后再查看。';
          ui.libraryDetail = null;
        }
        app.render();
      });
    },
    openForSubject: function (subject) {
      ui.subject = subject || 'all';
      ui.quiz = null; ui.records = []; ui.index = 0; ui.flipped = false; ui.precheck = null;
      app.state.tab = 'card-challenge';
      app.save(); app.render();
    }
  };

  window.__openRollingQuizForSubject = feature.openForSubject;
  window.__openKnowledgeCardLibrary = feature.openLibrary;
  if (window.__registerRollingQuiz) window.__registerRollingQuiz(feature);
})();
