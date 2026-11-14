/* 计划页重排（独立模块）—— 2026-09 重构
 *
 * 接入方式：index.html 里的 window.__registerPlanPage(feature)
 * 工作方式：包装 renderPlan，在原渲染完成后做 DOM 后处理（保留原有事件绑定）。
 *
 * 页面结构：今日知识卡大闯关 → 按学生指定顺序排列的学科复习计划。
 * 每科独立设每日知识点数量；系统在该科内按遗忘、错误频次与知识权重推荐。
 * 原题只藏在对应知识点的关联错题详情里，不与知识卡闯关混排。
 */
(function () {
  'use strict';

  var app = null;
  var MAX_UNDERSTANDING = 200;

  var ui = {
    summary: null,
    queue: null,
    quiz: null,
    graph: null,
    loading: false,
    preferencesLoaded: false,
    preferencesDirty: false,
    preferenceWrite: Promise.resolve(),
    preferenceTimer: null,
    understanding: null,
    error: ''
  };

  /* 明确要删掉的模块（按标题匹配） */
  var DROP_PATTERN = /接下来怎么复习|知识卡复习安排|从笔记提炼知识卡/;

  var style = document.createElement('style');
  style.textContent = [
    '.pp-hero{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:linear-gradient(140deg,#f2f7ff,#fff)}',
    '.pp-hero h2{margin:0 0 4px}',
    '.pp-hero .pp-big{font-size:34px;font-weight:700;color:#24467f;margin-right:4px}',
    '.pp-hero-line{font-size:13px;color:#65738b;margin:2px 0 0}',
    '.pp-receipt{margin-top:10px;padding:8px 12px;border-radius:12px;background:#eefaf1;border:1px solid #b7e3c8;font-size:13px;color:#1f7a45}',
    '.pp-focus{border:1px solid #cddcf8;background:linear-gradient(150deg,#f7faff,#fff)}',
    '.pp-row{display:flex;gap:10px;padding:7px 0;border-bottom:1px dotted #e6edf8;font-size:14px;color:#33415c}',
    '.pp-row:last-of-type{border-bottom:none}',
    '.pp-row b{flex:0 0 78px;color:#5a6a80;font-weight:600}',
    '.pp-row span{flex:1;line-height:1.6}',
    '.pp-quote{background:#f8fbff;border:1px solid #dbe6f7;border-radius:8px;padding:8px 10px}',
    '.pp-bar{height:9px;background:#e6edff;border-radius:999px;overflow:hidden;margin:6px 0 2px}',
    '.pp-bar i{display:block;height:100%;background:linear-gradient(90deg,#f0a13c,#f5c46b)}',
    '.pp-bar.done i{background:linear-gradient(90deg,#2f9e5f,#63c98a)}',
    '.pp-bar.mastery i{background:linear-gradient(90deg,#e0574f,#f0a13c,#63c98a)}',
    '.pp-steps{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}',
    '.pp-steps span{font-size:12px;border:1px solid #dbe5f5;border-radius:999px;padding:2px 10px;color:#65738b}',
    '.pp-steps span.on{border-color:#2f9e5f;color:#1f7a45;background:#eefaf1}',
    /* 按薄弱点分组 */
    '.pp-group{border:1px solid #e3eaf6;border-radius:14px;background:#fff;padding:12px;margin:10px 0}',
    '.pp-group-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}',
    '.pp-group-head b{font-size:15px;color:#22314a}',
    '.pp-group-meta{font-size:12px;color:#65738b;margin-top:3px;line-height:1.6}',
    '.pp-group-cases{margin:8px 0 0;padding-left:2px;list-style:none}',
    '.pp-group-cases li{font-size:13px;color:#3c4a5f;padding:5px 0 5px 12px;border-bottom:1px dotted #e6edf8;position:relative;line-height:1.55}',
    '.pp-group-cases li:before{content:"·";position:absolute;left:0;color:#8fb2ff;font-weight:700}',
    '.pp-group-cases li:last-child{border-bottom:none}',
    '.pp-tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:#eef3ff;color:#3158b8;margin-left:6px}',
    '.pp-tag.warn{background:#fdeef0;color:#a83a4a}',
    '.pp-next{font-size:12px;color:#8593a8;margin-left:6px}',
    '.pp-fold{margin-top:16px}',
    '.pp-fold>summary{cursor:pointer;font-weight:600;color:#4a5a73;padding:6px 0}',
    '.pp-fold[open]>summary{margin-bottom:10px}',
    '.pp-fold .panel{border:none;box-shadow:none;padding:12px 0 0;background:transparent}',
    '.pp-under textarea{width:100%;min-height:96px;margin-top:8px;padding:10px;border:1px solid #d7e1f2;border-radius:12px;font-family:inherit}',
    '.pp-count{font-size:12px;color:#8593a8}',
    '.pp-count.over{color:#c0392b}',
    '.pp-card1{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;border:1px solid #e3eaf6;border-radius:14px;padding:14px;background:#fff}',
    '.pp-card1 b{font-size:15px;color:#22314a}',
    '.pp-card1 p{margin:4px 0 0;font-size:13px;color:#65738b;line-height:1.6}'
    ,'.pp-challenge{position:relative;overflow:hidden;background:linear-gradient(125deg,#fff4c8 0%,#fffaf0 46%,#eef5ff 100%);border:2px solid #263b62;box-shadow:7px 8px 0 #b8cefa,10px 11px 0 1px #263b62;padding:clamp(18px,3vw,30px);margin:6px 10px 28px 0}'
    ,'.pp-challenge:after{content:"✦";position:absolute;right:20px;top:8px;font-size:44px;color:#f1b53d;opacity:.45;pointer-events:none}'
    ,'.pp-challenge h2{margin:4px 0 8px;color:#142847;font-size:clamp(25px,3vw,34px);letter-spacing:.02em}'
    ,'.pp-challenge-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}'
    ,'.pp-challenge-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-left:auto}'
    ,'.pp-card-overview{cursor:pointer;border:1px solid #cddcf8;border-radius:999px;padding:10px 14px;background:#fff;color:#24467f;min-height:44px;font:inherit;font-weight:650}'
    ,'.pp-card-overview:hover{border-color:#315efb;background:#f5f8ff}'
    ,'.pp-settings{position:relative;z-index:5}'
    ,'.pp-settings>summary{cursor:pointer;list-style:none;border:1px solid #cddcf8;border-radius:999px;padding:10px 14px;background:#fff;color:#24467f;min-height:44px}'
    ,'.pp-settings>summary::-webkit-details-marker{display:none}'
    ,'.pp-settings-body{position:absolute;right:0;top:calc(100% + 8px);width:min(440px,calc(100vw - 28px));max-height:min(70vh,620px);overflow:auto;padding:16px;background:#fffefa;border:1px solid #cddcf8;border-radius:16px;box-shadow:0 12px 32px #14284725}'
    ,'.pp-choice-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}'
    ,'.pp-challenge>[data-pp-start-challenge],.pp-challenge>[data-pp-start]{min-height:52px;padding:12px 24px;border:2px solid #20375f;border-radius:15px;box-shadow:4px 5px 0 #a9c2f4;font-weight:750;font-size:16px}'
    ,'.pp-choice-row button[aria-pressed="true"],.pp-subjects button[aria-pressed="true"]{background:#3369e8;color:#fff;border-color:#3369e8}'
    ,'.pp-choice-row select{width:auto;min-width:130px;max-width:100%}'
    ,'.pp-subjects{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}'
    ,'.pp-subject-plan{border-top:1px solid #e3eaf6;padding:12px 0}'
    ,'.pp-subject-plan:first-of-type{border-top:0}'
    ,'.pp-subject-plan label{display:flex;align-items:center;gap:8px;font-weight:650}'
    ,'.pp-subject-plan input[type="number"]{width:76px;min-height:44px;text-align:center}'
    ,'.pp-point-list{display:grid;gap:7px;margin-top:12px}'
    ,'.pp-point-option{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;border-radius:12px;color:#253b59}'
    ,'.pp-point-option[aria-pressed="true"]{background:#eef3ff;border-color:#93b2f3}'
    ,'.pp-point-option span{min-width:0;overflow-wrap:anywhere}'
    ,'.pp-point-option small{display:block;color:#56677e;font-size:12px}'
    ,'.pp-daily-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}'
    ,'.pp-subject-section{border-top:1px solid #dfe8f6;padding:20px 0 8px}'
    ,'.pp-subject-section:first-of-type{border-top:0}'
    ,'.pp-subject-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}'
    ,'.pp-subject-head h3{margin:0 0 4px;font-size:21px;color:#142847}'
    ,'.pp-subject-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    ,'.pp-subject-controls input{width:64px;min-height:44px;text-align:center}'
    ,'.pp-move{min-width:44px;min-height:44px;padding:8px}'
    ,'.pp-point{padding:14px 0;border-bottom:1px dotted #dfe8f6}'
    ,'.pp-point:last-child{border-bottom:0}'
    ,'.pp-point-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}'
    ,'.pp-point-title b{color:#22314a;font-size:16px}'
    ,'.pp-point-reason{margin:6px 0;color:#41536b;font-size:13px;line-height:1.5}'
    ,'.pp-point details{margin-top:8px}.pp-point summary{cursor:pointer;color:#3158b8;font-size:13px}'
    ,'.pp-plan-empty{padding:12px 0;color:#56677e}'
    ,'@media(max-width:560px){.pp-challenge .primary{width:100%}.pp-subject-plan label{flex-wrap:wrap}.pp-choice-row select{flex:1}.pp-settings-body{right:-2px}.pp-challenge-actions{width:100%;justify-content:flex-start}.pp-card-overview,.pp-settings>summary{min-height:42px;padding:8px 11px}}'
  ].join('');
  document.head.appendChild(style);

  function e(value) { return app.esc(String(value == null ? '' : value)); }

  /* ---------------- 数据 ---------------- */
  function ensureData(force) {
    if (ui.loading) return;
    ui.loading = true;
    var jobs = [];
    if (force || !ui.summary) {
      jobs.push(app.request('/v1/study/summary').then(function (r) { ui.summary = r; }).catch(function () {}));
    }
    if (force || !ui.queue) {
      jobs.push(app.request('/v1/study/review-queue?limit=200').then(function (r) { ui.queue = r; }).catch(function () {}));
    }
    if (force || !ui.quiz) {
      jobs.push(app.request('/v1/study/rolling-quiz?subject=all').then(function (r) { ui.quiz = r; }).catch(function () {}));
    }
    if (force || !ui.graph) {
      jobs.push(app.request('/v1/study/knowledge-graph').then(function (r) { ui.graph = r; }).catch(function () { ui.graph = null; }));
    }
    if (!ui.preferencesLoaded) {
      ui.preferencesLoaded = true;
      jobs.push(app.request('/v1/study/daily-plan-preferences').then(function (r) {
        if (r && r.preferences && !ui.preferencesDirty) app.state.dailyStudyPlanV1 = r.preferences;
      }).catch(function () { ui.error = '今日计划暂时只保存在本机；学习服务恢复后可再调整一次。'; }));
    }
    if (!jobs.length) { ui.loading = false; return; }
    Promise.all(jobs).then(function () {
      ui.loading = false;
      if (app.state.tab === 'plan') app.render();
    });
  }

  function mistakes() { return (app.state && app.state.mistakes) || []; }
  function mistakeById(id) {
    return mistakes().find(function (item) { return item.id === id; }) || null;
  }

  /** 三阶变式进度：从 transferSessions 里筛这道题的子关卡 */
  function transferProgress(mistakeId) {
    var sessions = (app.state.transferSessions || {});
    var keys = Object.keys(sessions).filter(function (key) { return key.indexOf(mistakeId) >= 0; });
    var attempted = keys.filter(function (key) { return sessions[key] && sessions[key].attempted; }).length;
    var passed = keys.filter(function (key) { return sessions[key] && sessions[key].correctness === 'correct'; }).length;
    return {attempted: Math.min(attempted, 3), passed: Math.min(passed, 3), total: 3};
  }

  /** 「下次复习：X 天后」——直接读 FSRS 排出来的 dueAt */
  function nextReviewText(mistake) {
    var profile = mistake && mistake.learningProfile;
    var due = profile && profile.dueAt;
    if (!due) return '下次复习：还没排（完成一次评分后自动安排）';
    var stamp = new Date(due).getTime();
    if (!Number.isFinite(stamp)) return '下次复习：还没排';
    var days = (stamp - Date.now()) / 86400000;
    if (days <= 0) return '下次复习：已到期（逾期 ' + Math.max(1, Math.round(-days)) + ' 天）';
    if (days < 1) return '下次复习：今天稍后';
    return '下次复习：' + Math.round(days) + ' 天后';
  }

  /** 某个知识点下最久的逾期天数（用来参与排序） */
  function overdueOf(point) {
    var items = (ui.queue && ui.queue.items) || [];
    var max = 0;
    items.forEach(function (item) {
      if (item.knowledgePoint !== point) return;
      var value = Number(item.overdueDays) || 0;
      if (value > max) max = value;
    });
    return max;
  }

  /**
   * 按薄弱点分组的复习清单。
   * 排序：掌握度低、错误频次高（priority 已含时间衰减）、逾期久 → 最上面。
   * 用的是跟复习队列一致的公式，保证两个页面顺序不打架。
   */
  function groups() {
    var list = (ui.summary && ui.summary.drilldown) || [];
    var graph = ui.graph || {nodes:[],edges:[]};
    var nodeById = new Map((graph.nodes || []).map(function (node) { return [node.id, node]; }));
    return list
      .filter(function (group) { return group && group.mistakes && group.mistakes.length; })
      .map(function (group) {
        var mastery = group.mastery == null ? 50 : Number(group.mastery);
        var gap = Math.max(0.15, (100 - Math.max(0, Math.min(100, mastery))) / 100);
        var overdue = overdueOf(group.knowledgePoint);
        var boost = 1 + Math.log1p(Math.max(0, overdue));
        var related = (graph.edges || []).filter(function (edge) { return edge.type === 'CO_OCCURS_WITH' && edge.frequency > 0; }).map(function (edge) {
          var a=nodeById.get(edge.source),b=nodeById.get(edge.target), current=a&&a.name===group.knowledgePoint?a:b&&b.name===group.knowledgePoint?b:null, other=current?(current.id===edge.source?b:a):null;
          return current&&other&&current.subject===group.subject?{name:other.name,frequency:Number(edge.frequency)||1}:null;
        }).filter(Boolean).sort(function(a,b){return b.frequency-a.frequency;});
        var coOccurrenceWeight = related.reduce(function(sum,item){return sum+item.frequency;},0);
        var score = Number(((Number(group.priority) || 0) * (0.4 + 0.6 * gap) * boost * (1 + Math.min(.25, Math.log1p(coOccurrenceWeight) * .06))).toFixed(4));
        return Object.assign({}, group, {
          mastery: mastery,
          overdueDays: overdue,
          score: score,
          coOccurrenceWith: related.slice(0,3)
        });
      })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        if (a.mastery !== b.mastery) return a.mastery - b.mastery;
        return b.mistakes.length - a.mistakes.length;
      });
  }

  function preferences() {
    var value = app.state.dailyStudyPlanV1;
    if (!value || typeof value !== 'object') value = app.state.dailyStudyPlanV1 = {};
    value.counts = value.counts || {};
    value.pinned = value.pinned || {};
    value.excluded = value.excluded || {};
    value.subjectOrder = Array.isArray(value.subjectOrder) ? value.subjectOrder : [];
    value.focusSubject = value.focusSubject || 'all';
    value.challengeMode = value.challengeMode === 'single' ? 'single' : 'all';
    var today = app.dayStamp();
    if (value.selectedDate !== today) {
      value.selectedDate = today;
      value.pinned = {};
      value.excluded = {};
    }
    return value;
  }

  function subjects() {
    var available = [...new Set(groups().map(function (group) { return group.subject; }).filter(Boolean))];
    var defaults = ['数学', '语文', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];
    var preferred = preferences().subjectOrder.filter(function (subject) { return available.includes(subject); });
    var remaining = available.filter(function (subject) { return !preferred.includes(subject); });
    remaining.sort(function (a, b) {
      var ai = defaults.indexOf(a), bi = defaults.indexOf(b);
      return (ai < 0 ? defaults.length : ai) - (bi < 0 ? defaults.length : bi) || a.localeCompare(b, 'zh');
    });
    return preferred.concat(remaining);
  }

  function countForSubject(subject, available) {
    var stored = preferences().counts[subject];
    var amount = stored === undefined ? 2 : Number(stored);
    return Math.max(0, Math.min(10, available, Number.isFinite(amount) ? Math.floor(amount) : 2));
  }

  function selectedForSubject(subject) {
    var prefs = preferences();
    var available = groups().filter(function (group) { return group.subject === subject; });
    var count = countForSubject(subject, available.length);
    var pinned = prefs.pinned[subject] || [];
    var excluded = new Set(prefs.excluded[subject] || []);
    var byKey = new Map(available.map(function (group) { return [group.key, group]; }));
    var chosen = pinned.map(function (key) { return byKey.get(key); }).filter(Boolean).slice(0, count);
    var seen = new Set(chosen.map(function (group) { return group.key; }));
    for (var group of available) {
      if (chosen.length >= count) break;
      if (!seen.has(group.key) && !excluded.has(group.key)) { chosen.push(group); seen.add(group.key); }
    }
    return chosen;
  }

  function selectedGroups() {
    return subjects().flatMap(selectedForSubject);
  }

  function savePreferences() {
    ui.preferencesDirty = true;
    app.save();
    if (ui.preferenceTimer) clearTimeout(ui.preferenceTimer);
    ui.preferenceTimer = setTimeout(function () {
      ui.preferenceTimer = null;
      var snapshot = JSON.parse(JSON.stringify(preferences()));
      ui.preferenceWrite = ui.preferenceWrite.catch(function () {}).then(function () {
        return app.request('/v1/study/daily-plan-preferences', {method:'PUT', body:JSON.stringify(snapshot)});
      }).catch(function (error) { ui.error = '今日计划未同步到本机服务：' + error.message; if (app.state.tab === 'plan') app.render(); });
    }, 300);
  }

  /* ---------------- 首屏 ---------------- */
  function challengeHtml() {
    var prefs = preferences();
    var available = (ui.quiz && ui.quiz.subjects) || [];
    var chosen = available.includes(prefs.challengeSubject) ? prefs.challengeSubject : (available[0] || '');
    return '<section class="panel pp-challenge" data-pp="challenge">'
      + '<div class="pp-challenge-head"><div><span class="pill good">放在最前面 · 随时开练</span><h2>今日大闯关</h2>'
      + '<p class="muted">只复习知识卡上的知识点，不重复展示整道原题。</p></div>'
      + '<div class="pp-challenge-actions"><button type="button" class="pp-card-overview" data-pp-card-overview>卡片总览</button>'
      + '<details class="pp-settings" data-pp-settings' + (ui.settingsOpen ? ' open' : '') + '><summary>⚙ 今日知识点设置</summary><div class="pp-settings-body">'
      + subjectPlanHtml() + '</div></details></div>'
      + '<div class="pp-choice-row" role="group" aria-label="闯关学科模式">'
      + '<button type="button" data-pp-challenge-mode="all" aria-pressed="' + (prefs.challengeMode === 'all') + '">全科混合</button>'
      + '<button type="button" data-pp-challenge-mode="single" aria-pressed="' + (prefs.challengeMode === 'single') + '">单科闯关</button>'
      + (prefs.challengeMode === 'single' ? '<label>学科 <select data-pp-challenge-subject aria-label="选择闯关学科">'
        + available.map(function (subject) { return '<option value="' + e(subject) + '"' + (subject === chosen ? ' selected' : '') + '>' + e(subject) + '</option>'; }).join('')
        + '</select></label>' : '') + '</div>'
      + '<button class="primary" data-pp-start-challenge' + (available.length ? '' : ' disabled') + '>开始今日大闯关</button>'
      + (available.length ? '' : '<p class="muted">还没有知识卡。完成一次陪练并记录自己的理解后，就能开始闯关。</p>')
      + '</section>';
  }

  function subjectPlanHtml() {
    var available = subjects();
    if (!available.length) return '<div data-pp="subject-plan"><h2>今日复习设置</h2><p class="muted">录入错题后，这里会按学科给出薄弱知识点。</p></div>';
    return '<div data-pp="subject-plan"><div class="head"><div><span class="pill">按学科安排</span>'
      + '<h2>今日复习设置</h2><p class="muted">每科默认推荐 2 个知识点。设为 0 可跳过；在下方学科标题旁用箭头调整学科顺序。</p></div></div>'
      + available.map(function (subject) {
        var pool = groups().filter(function (group) { return group.subject === subject; });
        var selected = selectedForSubject(subject);
        var selectedKeys = new Set(selected.map(function (group) { return group.key; }));
        var count = countForSubject(subject, pool.length);
        return '<div class="pp-subject-plan" data-pp-subject-plan="' + e(subject) + '">'
          + '<label>' + e(subject) + ' · 今日复习 <input type="number" min="0" max="' + Math.min(10, pool.length)
          + '" value="' + count + '" data-pp-point-count="' + e(subject) + '"> 个知识点</label>'
          + '<p class="pp-next">已选 ' + selected.length + '/' + count + '：' + e(selected.map(function (group) { return group.knowledgePoint; }).join('、') || '暂无') + '</p>'
          + '<details data-pp-picker="' + e(subject) + '"' + (ui.openPickerSubject === subject ? ' open' : '') + '><summary>自行挑选 / 替换 ' + e(subject) + ' 的薄弱知识点</summary>'
          + '<p class="pp-next">点亮要练的点；不想练推荐项，点它即可自动补入下一个较薄弱的点。</p>'
          + '<div class="pp-point-list">' + pool.map(function (group, index) {
            return '<button type="button" class="pp-point-option" data-pp-point="' + e(group.key) + '" aria-pressed="' + selectedKeys.has(group.key) + '">'
              + '<span><b>' + e(group.knowledgePoint) + '</b><small>' + (index === 0 ? '本学科优先推荐 · ' : '')
              + '掌握度 ' + e(group.mastery) + ' · 关联错题 ' + group.mistakes.length + ' 道</small></span><b>'
              + (selectedKeys.has(group.key) ? '✓ 已选' : '加入') + '</b></button>';
          }).join('') + '</div></details></div>';
      }).join('')
      + '<p class="pp-next">每日数量和学科顺序会保留；手选知识点次日重新按薄弱程度推荐。</p>'
      + '</div>';
  }

  function heroHtml() {
    var stats = (ui.queue && ui.queue.stats) || null;
    var totals = (ui.summary && ui.summary.totals) || {};
    var due = stats ? stats.due : '—';
    var cards = stats ? stats.cards : (totals.dueCards || 0);
    var wrongs = stats ? stats.mistakes : (totals.errors || 0);
    var receipt = app.state.lastReviewReceipt;
    return '<section class="panel pp-hero" data-pp="hero">'
      + '<div><h2><span class="pp-big">' + e(due) + '</span>项今日待复习</h2>'
      + '<p class="pp-hero-line">知识卡 <b>' + e(cards) + '</b> 张 · 错题 <b>' + e(wrongs) + '</b> 道 · 做完一项就会按 FSRS 重排下一次</p>'
      + (receipt
        ? '<div class="pp-receipt">上次评分：' + e(receipt.label || '')
          + (receipt.knowledgePoint ? '「' + e(receipt.knowledgePoint) + '」' : '')
          + ' · 下次复习：' + e(receipt.intervalText || (Math.round(Number(receipt.intervalDays) || 0) + ' 天后')) + '</div>'
        : '')
      + '</div>'
      + '<button class="primary" data-pp-start>开始所选知识点复习</button></section>';
  }

  /** 今日最高优先级：只展示 1 个 */
  function focusHtml() {
    var top = selectedGroups()[0];
    if (!top) {
      return '<section class="panel" data-pp="focus"><span class="pill">今日最高优先级</span>'
        + '<h2>今天没有要攻克的薄弱点</h2>'
        + '<p class="muted">先录入一道错题，完成诊断后这里会自动选出收益最高的那一个点。</p></section>';
    }
    var topMistake = top.mistakes[0] || {};
    // 注意：drilldown 里的 id 不一定在本地 state.mistakes 里，这里必须全部走兜底
    var mistake = mistakeById(topMistake.id);
    var insight = (mistake && mistake.errorThoughtInsight) || {};
    var review = mistake && mistake.completionReview;
    var progress = mistake ? transferProgress(mistake.id) : {attempted: 0, passed: 0, total: 3};
    var percent = Math.round(progress.passed / progress.total * 100);
    var labels = ['近迁移', '变式迁移', '混合迁移'];
    var questionText = (mistake && mistake.question) || topMistake.question || '（这个知识点下还没有关联错题）';
    var diagnosisText = (insight.warning || insight.cause)
      || (topMistake.analysis && topMistake.analysis.summary)
      || top.topCause
      || '这个知识点反复出错，先把判断依据说清楚。';
    var studentText = (mistake && mistake.studentAnswer) || topMistake.studentAnswer || '（还没有记录到你的原话）';
    var nextText = nextReviewText(mistake || {learningProfile: null});

    return '<section class="panel pp-focus" data-pp="focus">'
      + '<div class="head"><div><span class="pill warn">今日最高优先级</span><h2>' + e(top.knowledgePoint) + '</h2>'
      + '<p class="muted">掌握度 ' + top.mastery + ' · 错误 ' + top.mistakes.length + ' 道 · 逾期 '
      + Math.round(top.overdueDays) + ' 天 · 优先级 ' + top.score + '</p></div>'
      + '<button class="primary" data-pp-attack="' + e(topMistake.id || '') + '">单独攻克这个点</button></div>'
      + '<div class="pp-row"><b>原题摘要</b><span>' + e(String(questionText).slice(0, 120)) + '</span></div>'
      + '<div class="pp-row"><b>AI 诊断</b><span>' + e(String(diagnosisText).slice(0, 140)) + '</span></div>'
      + '<div class="pp-row"><b>学生原话</b><span class="pp-quote">' + e(String(studentText).slice(0, 110)) + '</span></div>'
      + '<div style="margin-top:12px"><b style="font-size:13px;color:#5a6a80">三阶迁移进度 ' + progress.passed + '/' + progress.total + '</b>'
      + '<div class="pp-bar' + (progress.passed >= progress.total ? ' done' : '') + '"><i style="width:' + percent + '%"></i></div>'
      + '<div class="pp-steps">' + labels.map(function (label, index) {
        return '<span class="' + (index < progress.passed ? 'on' : '') + '">' + (index < progress.passed ? '✓ ' : '') + label + '</span>';
      }).join('') + '</div>'
      + '<p class="pp-next">' + e(nextText) + '</p></div></section>';
  }

  /* ---------------- 今日复习：按学科独立选点 ---------------- */
  function groupsHtml() {
    var ordered = subjects();
    if (!ordered.length) return '<section class="panel" data-pp="groups"><h2>今日复习计划</h2>'
      + '<p class="pp-plan-empty">还没有可推荐的知识点。先录入错题或完成一次 AI 陪练。</p></section>';
    return '<section class="panel" data-pp="groups"><div class="pp-daily-head"><div><span class="pill">按学科安排</span>'
      + '<h2>今日复习计划</h2><p class="muted">每科按遗忘时间、掌握度、错误频次与知识权重推荐；顺序和数量由你决定。</p></div>'
      + '<button type="button" class="primary" data-pp-start>开始今日所选复习</button></div>'
      + (ui.error ? '<p class="geometry-alert" role="status">' + e(ui.error) + '</p>' : '')
      + ordered.map(function (subject, subjectIndex) {
        var pool = groups().filter(function (group) { return group.subject === subject; });
        var selected = selectedForSubject(subject);
        var count = countForSubject(subject, pool.length);
        return '<section class="pp-subject-section" data-pp-subject="' + e(subject) + '">'
          + '<div class="pp-subject-head"><div><h3>' + e(subject) + '</h3>'
          + '<p class="muted">今日安排 ' + selected.length + ' 个知识点 · 本科可选 ' + pool.length + ' 个</p></div>'
          + '<div class="pp-subject-controls"><label>' + e(subject) + ' 每日 <input type="number" min="0" max="' + Math.min(10, pool.length)
          + '" value="' + count + '" data-pp-point-count="' + e(subject) + '"> 个</label>'
          + '<button type="button" class="pp-move" data-pp-move-subject="' + e(subject) + '" data-direction="up" aria-label="将' + e(subject) + '上移"' + (subjectIndex ? '' : ' disabled') + '>↑</button>'
          + '<button type="button" class="pp-move" data-pp-move-subject="' + e(subject) + '" data-direction="down" aria-label="将' + e(subject) + '下移"' + (subjectIndex < ordered.length - 1 ? '' : ' disabled') + '>↓</button>'
          + '<button type="button" data-pp-start-subject="' + e(subject) + '"' + (selected.length ? '' : ' disabled') + '>练' + e(subject) + '</button></div></div>'
          + (selected.length ? selected.map(function (group, index) {
            var cases = group.mistakes.slice(0, 4);
            var reasons = [];
            if (group.overdueDays > 0) reasons.push('已逾期 ' + Math.round(group.overdueDays) + ' 天');
            if (group.mastery < 60) reasons.push('掌握度 ' + group.mastery);
            if (group.mistakes.length > 1) reasons.push('同类错题 ' + group.mistakes.length + ' 道');
            if (Number(group.weight) > 1) reasons.push('重点知识');
            if (group.coOccurrenceWith && group.coOccurrenceWith.length) reasons.push('常与 ' + group.coOccurrenceWith.map(function(item){return item.name;}).join('、') + ' 同题共现');
            if (!reasons.length) reasons.push('近期出现的薄弱点');
            return '<div class="pp-point" data-pp-group="' + e(group.key) + '">'
              + '<div class="pp-point-title"><div><span class="pp-tag">本科第 ' + (index + 1) + ' 优先</span> <b>' + e(group.knowledgePoint) + '</b></div>'
              + '<button type="button" data-pp-train="' + e(group.key) + '">练这个点</button></div>'
              + '<p class="pp-point-reason">推荐原因：' + e(reasons.join(' · ')) + '</p>'
              + (group.coOccurrenceWith && group.coOccurrenceWith.length ? '<p class="pp-next">' + e(group.coOccurrenceWith.map(function(item){return item.name+'（共现 '+item.frequency+' 次）';}).join(' · ')) + ' · 这两个知识点经常一起考，建议一起复习。</p>' : '')
              + '<details><summary>查看关联错题（' + group.mistakes.length + '）</summary><ul class="pp-group-cases">'
              + cases.map(function (mistake) { return '<li>' + e(String(mistake.question || '（无题干）').slice(0, 100)) + '</li>'; }).join('')
              + '</ul>' + (group.mistakes.length > cases.length ? '<p class="pp-next">其余 ' + (group.mistakes.length - cases.length) + ' 道会在训练中出现。</p>' : '')
              + '</details></div>';
          }).join('') : '<p class="pp-plan-empty">' + (count === 0 ? '今天已设为 0 个知识点；需要时可在这里调整。' : '本科暂无可推荐知识点。') + '</p>')
          + '</section>';
      }).join('') + '</section>';
  }

  /* ---------------- 底部 ---------------- */
  function progressHtml() {
    var cells = ((ui.summary && ui.summary.heatmap) || []).slice()
      .sort(function (a, b) { return (Number(b.priority) || 0) - (Number(a.priority) || 0); })
      .slice(0, 6);
    if (!cells.length) return '<p class="muted">完成第一道真实错题的诊断与训练后，这里会展示能力变化。</p>';
    return '<p class="muted">每个薄弱点的当前掌握度（知识卡来自 FSRS stability，错题来自学习档案）；条越短越该先练。</p>'
      + cells.map(function (cell) {
        var mastery = cell.mastery == null ? cell.masteryFallback : cell.mastery;
        var value = Math.max(0, Math.min(100, Number(mastery) || 0));
        var label = value < 40 ? '需要大量提示' : value < 60 ? '需要少量提示' : value < 80 ? '基本独立完成' : '已经稳定';
        return '<div style="margin:9px 0"><div style="display:flex;justify-content:space-between;font-size:13px;color:#33415c">'
          + '<span>' + e(cell.knowledgePoint) + '<span class="pp-tag">' + e(label) + '</span></span><b>' + value + '</b></div>'
          + '<div class="pp-bar mastery"><i style="width:' + value + '%"></i></div></div>';
      }).join('');
  }

  function cardsHtml() {
    var items = (ui.quiz && ui.quiz.items) || [];
    if (!items.length) {
      return '<section class="panel" data-pp="cards"><div class="head"><div><span class="pill good">零碎时间</span><h2>零碎时间知识卡</h2>'
        + '<p class="muted">现在没有到期卡片。写下「我的理解」后会自动排进这里。</p></div></div>'
        + '<div class="muted">今日到期 0 张。</div></section>';
    }
    // 只展示今日到期的 1 张
    var item = items[0];
    var front = item.front || {};
    return '<section class="panel" data-pp="cards"><div class="head"><div><span class="pill good">零碎时间</span><h2>零碎时间知识卡</h2>'
      + '<p class="muted">碎片时间只推 1 张，点开就是滚动测验。</p></div>'
      + '<button data-pp-quiz>去闯关</button></div>'
      + '<div class="pp-card1"><div><b>' + e(item.knowledgePoint) + '</b>'
      + '<p>' + e(String(front.cue || item.prompt || '').slice(0, 60)) + '</p>'
      + '<p>知识卡 · 掌握度 ' + e(item.mastery)
      + (item.overdueDays > 0 ? ' · 逾期 ' + e(item.overdueDays) + ' 天' : ' · 今天到期') + '</p></div>'
      + '<button class="primary" data-pp-quiz>去闯关</button></div>'
      + (items.length > 1 ? '<p class="pp-next">今天另有 ' + (items.length - 1) + ' 张到期卡，去闯关会逐张出现。</p>' : '')
      + '</section>';
  }

  function understandingHtml() {
    var state = ui.understanding;
    if (!state) return '';
    if (state.saved) {
      return '<section class="panel pp-under" data-pp="under"><span class="pill good">已保存</span><h2>你的理解已经进复习队列</h2>'
        + '<p class="muted">它会成为下次复习时卡片背面的「我的理解」。</p></section>';
    }
    var length = String(state.text || '').length;
    return '<section class="panel pp-under" data-pp="under"><span class="pill">我的理解</span>'
      + '<h2>用你自己的话，总结「' + e(state.knowledgePoint || '这个知识点') + '」</h2>'
      + '<p class="muted">不超过 ' + MAX_UNDERSTANDING + ' 字；写下来才会进 FSRS 复习队列。</p>'
      + '<textarea data-pp-under maxlength="' + MAX_UNDERSTANDING + '" placeholder="它是解决什么问题的？关键判断是什么？">' + e(state.text || '') + '</textarea>'
      + '<p class="pp-count' + (length > MAX_UNDERSTANDING ? ' over' : '') + '">' + length + ' / ' + MAX_UNDERSTANDING + ' 字</p>'
      + '<div class="row"><button class="primary" data-pp-under-save>保存为知识卡</button>'
      + '<button data-pp-under-skip>跳过</button></div>'
      + '<p class="pp-count">' + e(ui.error || '') + '</p></section>';
  }

  /* ---------------- 后处理 ---------------- */
  function decoratePlan(view) {
    if (view.querySelector('[data-pp="groups-host"]')) return;      // 防止重复处理
    try {
      buildPlan(view);
    } catch (error) {
      /* 任何一块数据缺字段都不能让整页只渲染一半：保留原计划页，并把原因说清楚 */
      try {
        var warn = document.createElement('section');
        warn.className = 'panel';
        warn.innerHTML = '<b>计划页排版这一步出错了</b>'
          + '<p class="muted">下面仍是原有的计划内容，功能没丢。原因：' + e(error && error.message) + '</p>';
        view.insertBefore(warn, view.firstChild);
      } catch (inner) { /* 连提示都插不进去就算了 */ }
    }
  }

  function buildPlan(view) {
    var panels = Array.prototype.slice.call(view.children).filter(function (node) {
      return node.classList && node.classList.contains('panel');
    });

    var drop = [], progressPanel = null, rest = [];
    panels.forEach(function (panel) {
      var title = panel.querySelector('h2');
      var text = title ? title.textContent : '';
      if (DROP_PATTERN.test(text)) { drop.push(panel); return; }
      if (/我的进步/.test(text)) { progressPanel = panel; return; }
      rest.push(panel);
    });
    // 明确删除的模块直接移除（「接下来怎么复习」「知识卡复习安排」「从笔记提炼知识卡」）
    drop.forEach(function (panel) { panel.remove(); });

    // 1) 知识卡闯关始终位于今日复习计划前面。
    var challenge = document.createElement('section');
    challenge.className = 'panel pp-challenge';
    challenge.setAttribute('data-pp', 'challenge');
    challenge.innerHTML = challengeHtml().replace(/^<section[^>]*>/, '').replace(/<\/section>$/, '');
    view.insertBefore(challenge, view.firstChild);

    // 2) 一个按学科顺序排列的今日复习计划，不再穿插总数与跨科单点推荐。
    var groupHost = document.createElement('div');
    groupHost.setAttribute('data-pp', 'groups-host');
    groupHost.innerHTML = groupsHtml();
    challenge.after(groupHost);

    // 3) 底部：我的进步（折叠）
    var progressFold = document.createElement('details');
    progressFold.className = 'panel pp-fold';
    progressFold.setAttribute('data-pp', 'progress');
    progressFold.innerHTML = '<summary>我的进步（每个薄弱点的掌握度 · 点击展开）</summary>';
    var progressBody = document.createElement('div');
    progressBody.innerHTML = progressHtml();
    progressFold.appendChild(progressBody);
    if (progressPanel) progressFold.appendChild(progressPanel);
    view.appendChild(progressFold);

    // 4) 其余原有模块（我的学习资源 / 自动复习回流 / 今天优先修复 / 几何任务回流 / 得分点）
    //    它们的内容已经被上面的分组清单覆盖，这里折叠收好，保证没有功能丢失。
    if (rest.length) {
      var more = document.createElement('details');
      more.className = 'panel pp-fold';
      more.setAttribute('data-pp', 'more');
      more.innerHTML = '<summary>更多：学习资源 · 任务明细 · 自动复习回流（点击展开）</summary>';
      rest.forEach(function (panel) { more.appendChild(panel); });
      view.appendChild(more);
    }

    var under = document.createElement('div');
    under.setAttribute('data-pp', 'under-host');
    view.appendChild(under);
    under.innerHTML = ui.understanding ? understandingHtml() : '';

    bind(view);
    ensureData();
  }

  /* ---------------- 进入闭环页 ---------------- */
  function openLoop(mistakeIds, activeId) {
    var state = app.state;
    state.loop = state.loop || {evidence: [], weekly: [], activeId: null};
    var list = (mistakeIds || []).filter(Boolean);
    state.loop.trainingQueue = list;
    state.loop.activeId = activeId || list[0] || state.loop.activeId;
    state.loop.activeTaskId = null;
    state.tab = 'loop';
    app.save();
    app.render();
  }

  /** 按智能排队顺序：队列里第一道题（优先错题），没有就去闯关 */
  function startTodayReview() {
    var selected = selectedGroups();
    var selectedIds = [...new Set(selected.flatMap(function (group) {
      return group.mistakes.map(function (mistake) { return mistake.id; });
    }))].filter(function (id) { return !!mistakeById(id); });
    if (selectedIds.length) { ui.error = ''; openLoop(selectedIds, selectedIds[0]); return; }
    ui.error = selectedGroups().length
      ? '所选知识点的错题尚未同步到本机，请稍后刷新错题库再试。'
      : '今天各科都未安排知识点。请把至少一科的每日数量设为 1 或更多。';
    app.render();
  }

  /* ---------------- 事件 ---------------- */
  function bind(view) {
    var settings = view.querySelector('[data-pp-settings]');
    if (settings) settings.ontoggle = function () { ui.settingsOpen = settings.open; };
    var cardOverview = view.querySelector('[data-pp-card-overview]');
    if (cardOverview) cardOverview.onclick = function () {
      if (typeof window.__openKnowledgeCardLibrary === 'function') window.__openKnowledgeCardLibrary();
      else { ui.error = '卡片库正在加载，请稍后再试。'; app.render(); }
    };
    view.querySelectorAll('[data-pp-challenge-mode]').forEach(function (button) {
      button.onclick = function () { preferences().challengeMode = button.dataset.ppChallengeMode; savePreferences(); app.render(); };
    });
    var challengeSubject = view.querySelector('[data-pp-challenge-subject]');
    if (challengeSubject) challengeSubject.onchange = function () { preferences().challengeSubject = challengeSubject.value; savePreferences(); };
    var startChallenge = view.querySelector('[data-pp-start-challenge]');
    if (startChallenge) startChallenge.onclick = function () {
      var prefs = preferences();
      var available = (ui.quiz && ui.quiz.subjects) || [];
      var target = prefs.challengeMode === 'single'
        ? (available.includes(prefs.challengeSubject) ? prefs.challengeSubject : available[0]) : 'all';
      if (!available.length) { ui.error = '还没有可闯关的学科，先录入一道错题。'; app.render(); return; }
      if (typeof window.__openRollingQuizForSubject === 'function') window.__openRollingQuizForSubject(target);
      else { app.state.tab = 'card-challenge'; app.render(); }
    };
    view.querySelectorAll('[data-pp-plan-subject]').forEach(function (button) {
      button.onclick = function () { preferences().focusSubject = button.dataset.ppPlanSubject; ui.openPickerSubject = null; savePreferences(); app.render(); };
    });
    view.querySelectorAll('[data-pp-point-count]').forEach(function (input) {
      input.onchange = function () {
        var subject = input.dataset.ppPointCount;
        var total = groups().filter(function (group) { return group.subject === subject; }).length;
        var amount = Number(input.value);
        preferences().counts[subject] = Math.max(0, Math.min(10, total, Number.isFinite(amount) ? Math.floor(amount) : 2));
        savePreferences(); app.render();
      };
    });
    view.querySelectorAll('[data-pp-move-subject]').forEach(function (button) {
      button.onclick = function () {
        var order = subjects();
        var at = order.indexOf(button.dataset.ppMoveSubject);
        var target = at + (button.dataset.direction === 'up' ? -1 : 1);
        if (at < 0 || target < 0 || target >= order.length) return;
        var moved = order.splice(at, 1)[0];
        order.splice(target, 0, moved);
        preferences().subjectOrder = order;
        savePreferences(); app.render();
      };
    });
    view.querySelectorAll('[data-pp-picker]').forEach(function (details) {
      details.ontoggle = function () { if (details.open) ui.openPickerSubject = details.dataset.ppPicker; };
    });
    view.querySelectorAll('[data-pp-point]').forEach(function (button) {
      button.onclick = function () {
        var key = button.dataset.ppPoint;
        var group = groups().find(function (item) { return item.key === key; });
        if (!group) return;
        var prefs = preferences();
        var subject = group.subject;
        var wasSelected = selectedForSubject(subject).some(function (item) { return item.key === key; });
        var pinned = prefs.pinned[subject] || [];
        var excluded = prefs.excluded[subject] || [];
        prefs.pinned[subject] = pinned.filter(function (value) { return value !== key; });
        prefs.excluded[subject] = excluded.filter(function (value) { return value !== key; });
        if (wasSelected) prefs.excluded[subject].push(key);
        else {
          prefs.pinned[subject].unshift(key);
          if (countForSubject(subject, groups().filter(function (item) { return item.subject === subject; }).length) === 0) prefs.counts[subject] = 1;
        }
        ui.openPickerSubject = subject;
        savePreferences(); app.render();
      };
    });
    var start = view.querySelector('[data-pp-start]');
    if (start) start.onclick = function () { ui.error = ''; startTodayReview(); };
    view.querySelectorAll('[data-pp-start-subject]').forEach(function (button) {
      button.onclick = function () {
        var selected = selectedForSubject(button.dataset.ppStartSubject);
        var ids = [...new Set(selected.flatMap(function (group) { return group.mistakes.map(function (mistake) { return mistake.id; }); }))]
          .filter(function (id) { return !!mistakeById(id); });
        if (!ids.length) { ui.error = '本科所选知识点暂时没有可打开的错题。'; app.render(); return; }
        ui.error = ''; openLoop(ids, ids[0]);
      };
    });

    // 单独攻克这个点
    view.querySelectorAll('[data-pp-attack]').forEach(function (button) {
      button.onclick = function () {
        var id = button.dataset.ppAttack;
        var top = selectedGroups()[0];
        var ids = top ? top.mistakes.map(function (m) { return m.id; }) : [];
        if (!id && !ids.length) { ui.error = '还没有可以攻克的目标。'; return app.render(); }
        openLoop(ids, id || ids[0]);
      };
    });

    // 每一组只有一个按钮：开始训练
    view.querySelectorAll('[data-pp-train]').forEach(function (button) {
      button.onclick = function () {
        var key = button.dataset.ppTrain;
        var group = groups().find(function (item) { return item.key === key; });
        if (!group || !group.mistakes.length) { ui.error = '这一组暂时没有可训练的题。'; return app.render(); }
        openLoop(group.mistakes.map(function (m) { return m.id; }), group.mistakes[0].id);
      };
    });

    // 去闯关（知识卡滚动测验）
    view.querySelectorAll('[data-pp-quiz]').forEach(function (button) {
      button.onclick = function () { app.state.tab = 'card-challenge'; app.save(); app.render(); };
    });

    view.querySelectorAll('[data-pp-subject]').forEach(function (button) {
      button.onclick = function () {
        ui.quiz = null;
        ensureData(true);
        app.render();
      };
    });

    var textarea = view.querySelector('[data-pp-under]');
    if (textarea) textarea.oninput = function () {
      ui.understanding.text = textarea.value;
      var counter = view.querySelector('.pp-count');
      if (counter) {
        counter.textContent = textarea.value.length + ' / ' + MAX_UNDERSTANDING + ' 字';
        counter.classList.toggle('over', textarea.value.length > MAX_UNDERSTANDING);
      }
    };
    view.querySelectorAll('[data-pp-under-save]').forEach(function (button) {
      button.onclick = function () {
        var state = ui.understanding;
        if (!state) return;
        var value = String(state.text || '').trim();
        if (value.length < 8) { ui.error = '再多写一点。'; return app.render(); }
        app.request('/v1/study/understanding', {
          method: 'POST',
          body: JSON.stringify({text: value, knowledgePoint: state.knowledgePoint, trigger: 'self_complete'})
        }).then(function () {
          state.saved = true; ui.error = ''; app.render();
        }).catch(function (error) { ui.error = '保存失败：' + error.message; app.render(); });
      };
    });
    view.querySelectorAll('[data-pp-under-skip]').forEach(function (button) {
      button.onclick = function () { ui.understanding = null; app.render(); };
    });
  }

  /* 每次点底部的「计划」都刷新一次，保证从闭环页回来时数字是新的 */
  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== document) {
      if (node.dataset && node.dataset.tab === 'plan') {
        ui.queue = null; ui.summary = null; ui.quiz = null;
        break;
      }
      node = node.parentNode;
    }
  }, true);

  var feature = {
    activate: function (context) { app = context; ensureData(); },
    decoratePlan: decoratePlan,
    openUnderstanding: function (knowledgePoint) {
      ui.understanding = {knowledgePoint: knowledgePoint, text: '', saved: false};
    }
  };

  if (window.__registerPlanPage) window.__registerPlanPage(feature);
})();
