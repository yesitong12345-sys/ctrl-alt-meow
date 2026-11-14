/* 归纳 · 复习（独立模块）
 *
 * 对应后端：server/workflows/study-routes.mjs（/v1/study/*）
 * 接入方式：index.html 里的 window.__registerStudyInsights(feature)
 *
 * 页面架构（2026-09 重构）：
 *   一个滚动页面，不再有「归纳页 / 复习队列」平行 Tab：
 *     ① 顶部固定总览：今日待复习 / 知识点总数 / 错题总数
 *     ② 今日最该复习的 3 个知识点（置顶卡片）
 *     ③ 热力图 —— 复习队列的视觉概览，点格子即过滤下面的队列
 *     ④ 复习队列 —— 按「错误频次 × 知识点权重 × 时间衰减」排序
 *     ⑤ 复习做题流 / 我的理解
 *   底部折叠区：学科分布 / 错因分布 / 掌握度雷达（不占首屏）
 *
 *   「按学科深入分析」平行标签已彻底删除；下钻改成"就地展开"，
 *   点「看这个知识点的错题」直接在当前位置展开错题列表，不再跳到页面底部。
 */
(function () {
  'use strict';

  var app = null;
  var busy = false;
  var lastSummary = 0;
  var lastQueue = 0;
  var lastGraph = 0;
  var lastCards = 0;

  var ui = {
    subject: 'all',            // 全科混合 or 单科
    subjects: [],
    summary: null,
    graph: null,
    graphSelected: null,
    graphSubject: null,
    queue: null,
    error: '',
    filterPoint: null,         // 热力图选中的知识点（按名字过滤复习队列）
    drill: null,               // {key, origin} 就近展开的知识点错题列表
    openPaper: {},             // 知识点 key -> 原卷分组展开状态
    session: null,             // 复习会话 { ids, index, records }
    hints: {},                 // cardId -> 评分提示
    reveal: {},                // cardId -> 是否已翻到背面
    understanding: null,       // { knowledgePoint, trigger, text, saved }
    radarMode: 'knowledgePoint',
    stale: true                // 每次切回本页时强制刷新一次
  };

  var SUBJECT_ALL = 'all';

  /* ---------------- 样式 ---------------- */
  var style = document.createElement('style');
  style.textContent = [
    '.st-shell{margin-top:16px}',
    /* 复习日期表 */
    '.st-calendar{margin-bottom:14px}',
    '.st-cal-sum{margin:8px 0 6px;font-size:14px;color:#5c4a2e}',
    '.st-cal-sum b{color:#b4593a;font-size:16px}',
    '.st-cal-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13.5px}',
    '.st-cal-table th{text-align:left;font-weight:600;color:#8a7a5e;padding:6px 8px;border-bottom:1px solid #e8dfd0}',
    '.st-cal-table td{padding:7px 8px;border-bottom:1px dashed #f0e8da;vertical-align:top}',
    '.st-cal-table tr:last-child td{border-bottom:none}',
    '.st-cal-now td{background:#fff6ee}',
    '.st-cal-now td:first-child{color:#b4593a;font-weight:600}',
    '.st-cal-row{cursor:pointer}',
    '.st-cal-row:hover td{background:#fdf8f1}',
    '.st-cal-open td{background:#fdf3e8}',
    '.st-cal-drill td{background:#fffdf9;padding:0}',
    '.st-cal-drill-in{padding:10px 14px 12px;border-left:3px solid #d7b98f}',
    '.st-cal-drill-in ul{margin:6px 0 0;padding-left:18px}',
    '.st-cal-drill-in li{margin:4px 0;font-size:13px;line-height:1.5}',
    /* 顶部固定总览 */
    '.st-sticky{position:sticky;top:0;z-index:30;margin:0 0 14px;padding:10px 0 12px;background:linear-gradient(180deg,#fffdf8 70%,rgba(255,253,248,.88));border-bottom:1px solid #ece2d2}',
    '.st-sticky-row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px}',
    '.st-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:10px}',
    /* 顶部第一行：选要复习的科目 */
    '.st-subject-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 0 10px;margin-bottom:8px;border-bottom:1px dashed #e8dfd0}',
    '.st-subject-bar b{font-size:13.5px;color:#5c4a2e;margin-right:2px}',
    '.st-chip{padding:5px 14px;font-size:13px;border-radius:999px;border:1px solid #e2d6c2;background:#fff;color:#6b5a3e;cursor:pointer}',
    '.st-chip:hover{border-color:#315efb;color:#315efb}',
    '.st-chip.active{background:#315efb;border-color:#315efb;color:#fff;font-weight:600}',
    '.st-metric{border:1px solid #e6ddcd;border-radius:14px;padding:10px 12px;background:#fff}',
    '.st-metric b{display:block;font-size:26px;line-height:1.15;color:#315efb}',
    '.st-metric span{font-size:12px;color:#65738b}',
    '.st-metric.hot b{color:#c0392b}',
    /* 置顶卡片 */
    '.st-top{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:12px 0}',
    '.st-top-list{display:flex;flex-direction:column;gap:12px;margin:12px 0}',
    '.st-topcard{border:1px solid #dce5f5;border-radius:18px;padding:14px;background:linear-gradient(145deg,#f6f9ff,#fff)}',
    '.st-topcard h4{margin:6px 0 4px;font-size:16px}',
    '.st-topcard .st-why{font-size:13px;color:#65738b}',
    '.st-rank{display:inline-flex;width:24px;height:24px;border-radius:50%;background:#315efb;color:#fff;align-items:center;justify-content:center;font-size:13px}',
    '.st-pin{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:#fdeef0;color:#a83a4a;margin-left:6px;vertical-align:1px}',
    '.st-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
    /* 热力图 */
    '.st-heat-subject{margin:14px 0 4px;color:#243854;font-size:15px}',
    '.st-heat{display:grid;grid-template-columns:repeat(auto-fill,minmax(126px,1fr));gap:8px;margin:8px 0 14px}',
    '.kg-scroll{box-sizing:border-box;width:100%;height:clamp(260px,42vh,420px);min-height:240px;max-height:62vh;resize:vertical;overflow:auto;overscroll-behavior:contain;border:1px solid #e2e9f3;border-radius:16px;background:#fbfdff}.kg-svg{display:block;width:100%;height:auto;max-width:100%}.kg-edge{cursor:pointer;stroke:#8ba2c5;opacity:.6}.kg-edge-dep{stroke:#e8a712}.kg-edge-conf{stroke:#df4b45}.kg-edge-co{stroke:#2f9e63}.kg-edge-related{stroke-dasharray:4 6;stroke:#aab8cb;opacity:.48}.kg-edge.kg-edge-active{stroke-width:6!important;opacity:1}.kg-edge.kg-edge-active.kg-edge-dep{stroke:#b57c00}.kg-edge.kg-edge-active.kg-edge-conf{stroke:#b52a24}.kg-edge.kg-edge-active.kg-edge-co{stroke:#1c7345}.kg-edge-hit{stroke:transparent;stroke-width:16;stroke-linecap:round}.kg-exam-label{font:700 11px system-ui;fill:#183c79;paint-order:stroke;stroke:#fbfdff;stroke-width:5px;stroke-linejoin:round;pointer-events:none}.kg-edge:hover{opacity:1;stroke-width:5}.kg-node{cursor:pointer}.kg-node circle{fill:#fff;stroke:#4d78d4;stroke-width:2}.kg-node.reviewed circle{fill:#fff1b8;stroke:#d69817;stroke-width:4}.kg-node.selected circle{fill:#315efb;stroke:#183caa;stroke-width:4}.kg-node text{font:12px system-ui;fill:#233b60;pointer-events:none}.kg-node.selected text{fill:#fff;font-weight:700}.kg-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#65738b;align-items:center}.kg-legend i{display:inline-block;width:22px;height:4px;border-radius:2px;margin-right:5px;vertical-align:2px}.kg-legend .kg-line-dep{background:#e8a712}.kg-legend .kg-line-conf{background:#df4b45}.kg-legend .kg-line-co{background:#2f9e63}.kg-legend .kg-line-related{background:repeating-linear-gradient(90deg,#aab8cb 0 4px,transparent 4px 8px)}.kg-focus-switch{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:2px 0 8px}.kg-focus-switch button{min-height:38px;padding:6px 14px;border-radius:999px;border:1px solid #cbd8ee;background:#fff;color:#263d60;cursor:pointer}.kg-focus-switch button.active{background:#3369e8;border-color:#3369e8;color:#fff;font-weight:700}.kg-focus-switch .muted{font-size:12px}.kg-subject-tabs{display:flex;gap:7px;overflow:auto;padding:4px 2px 10px;margin:4px 0 8px;scrollbar-width:thin}.kg-subject-tabs button{flex:0 0 auto;min-height:42px;padding:7px 15px;border:1px solid #cbd8ee;border-radius:999px;background:#fffefa;color:#263d60;cursor:pointer}.kg-subject-tabs button.active{background:#3369e8;border-color:#3369e8;color:white;font-weight:700;box-shadow:0 3px 0 #a9c3f4}.kg-recs{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.kg-rec{border:1px solid #dce5f2;border-radius:12px;padding:9px;background:#f8fbff}.kg-detail{margin-top:10px;padding:10px;border-radius:12px;background:#f4f8ff}.kg-detail button{margin:4px}',
    /* 连线详情里的 AI 衔接提示卡 */
    '.kg-tip{border:1px solid #cddcf5;border-left-width:6px;border-radius:14px;padding:12px;background:#fbfdff;margin-top:10px}',
    '.kg-tip.dep{border-left-color:#e8a712}.kg-tip.conf{border-left-color:#df4b45}.kg-tip.co{border-left-color:#2f9e63}',
    '.kg-tip h4{margin:0 0 6px;font-size:15px}',
    '.kg-tip p{margin:6px 0;line-height:1.6;color:#2c3f5c}',
    '.kg-tip .kg-tip-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;margin-left:6px}',
    '.kg-tip.dep .kg-tip-pill{background:#fdf1d2;color:#8a5f00}.kg-tip.conf .kg-tip-pill{background:#fde3e1;color:#9c2b25}.kg-tip.co .kg-tip-pill{background:#dff3e7;color:#1c6b41}',
    '.kg-tip .kg-tip-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
    '.kg-tip .kg-tip-actions button{min-height:40px}',
    '.kg-tip .kg-tip-note{font-size:12px;color:#65738b}',
    '.kg-tip-spinner{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px;border:2px solid #cddcf5;border-top-color:#3369e8;border-radius:50%;animation:kg-tip-spin .9s linear infinite}',
    '@keyframes kg-tip-spin{to{transform:rotate(360deg)}}',
    '@media(prefers-reduced-motion:reduce){.kg-tip-spinner{animation:none}}',
    '.st-cell{border-radius:12px;padding:10px;cursor:pointer;border:2px solid transparent;transition:border-color .15s;text-align:left}',
    '.st-cell:hover{border-color:#315efb}',
    '.st-cell.active{border-color:#315efb;box-shadow:0 6px 18px rgba(49,94,251,.18)}',
    '.st-cell b{display:block;font-size:13px;line-height:1.3;margin-bottom:4px;word-break:break-all}',
    '.st-cell span{font-size:12px;color:#4a5568}',
    '.st-cell .st-cell-link{display:inline-block;margin-top:6px;font-size:12px;color:#315efb;text-decoration:underline}',
    '.st-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#65738b;margin:6px 0 2px}',
    '.st-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-1px}',
    /* 复习队列 */
    '.st-queue-item{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid #e3eaf6;border-radius:12px;padding:10px 12px;margin:6px 0;background:#fff}',
    '.st-queue-item.pin{border-color:#f0c4bf;background:#fffafa}',
    '.st-queue-item b{font-size:14px}',
    '.st-queue-item .st-note{margin:2px 0 0}',
    '.st-queue-main{flex:1;min-width:0}',
    '.st-bar-sm{width:92px;height:8px;background:#e6edff;border-radius:999px;overflow:hidden;flex:0 0 auto}',
    '.st-bar-sm i{display:block;height:100%;background:linear-gradient(90deg,#315efb,#72a8ff)}',
    /* 就地展开的错题列表 */
    '.st-drill{border:1px solid #dbe5f5;border-radius:14px;background:#fbfdff;padding:12px;margin:10px 0}',
    '.st-drill-head{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}',
    '.st-paper{border:1px solid #e6edf8;border-radius:12px;margin:8px 0;overflow:hidden;background:#fff}',
    '.st-paper>summary{cursor:pointer;padding:9px 12px;background:#f5f9ff;font-size:13px;font-weight:600;color:#33415c}',
    '.st-paper>summary span{font-weight:400;color:#65738b;margin-left:6px}',
    '.st-case{border-top:1px dotted #e6edf8;padding:10px 12px}',
    '.st-case h6{margin:0 0 5px;font-size:13.5px;line-height:1.55;font-weight:600;color:#2b3a4f}',
    '.st-case .st-note{margin:2px 0}',
    /* 复习做题流 */
    '.st-pie{display:flex;gap:18px;align-items:center;flex-wrap:wrap}',
    '.st-pie svg{width:150px;height:150px;flex:0 0 auto}',
    '.st-pie-list{flex:1;min-width:190px}',
    '.st-pie-list div{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0}',
    '.st-pie-list i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}',
    '.st-subject-row{display:flex;align-items:center;gap:10px;font-size:13px;margin:7px 0}',
    '.st-subject-row b{min-width:56px}',
    '.st-subject-track{flex:1;height:10px;background:#eef3ff;border-radius:999px;overflow:hidden}',
    '.st-subject-track i{display:block;height:100%;background:linear-gradient(90deg,#8fb2ff,#4a7cff)}',
    '.st-src{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:#eef3ff;color:#3158b8;margin:2px 6px 2px 0}',
    '.st-src.tutor{background:#eaf4ff;color:#1f6bb5}',
    '.st-src.note{background:#fff4e5;color:#a8641a}',
    '.st-src.intake{background:#eefaf1;color:#1f7a45}',
    '.st-src.review{background:#fdeef0;color:#a83a4a}',
    '.st-analysis{background:#f7faff;border-left:3px solid #6f9bff;border-radius:8px;padding:10px;margin-top:8px;font-size:13px}',
    '.st-bar{height:8px;background:#e6edff;border-radius:999px;overflow:hidden;margin:8px 0}',
    '.st-bar i{display:block;height:100%;background:linear-gradient(90deg,#315efb,#72a8ff)}',
    '.st-bar.warn i{background:linear-gradient(90deg,#f0a13c,#f5c46b)}',
    '.st-bar.danger i{background:linear-gradient(90deg,#e0574f,#f08a7f)}',
    /* 更多分析：掌握度进度条 + 统计 */
    '.st-metrics-inline{grid-template-columns:repeat(4,minmax(92px,1fr));gap:8px;margin:0;min-width:340px}',
    '.st-mastery-row{margin:9px 0}',
    '.st-mastery-label{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#33415c}',
    '.st-mastery-label b{color:#24467f}',
    '.st-sub{margin-top:14px;border-top:1px dashed #e6edf3;padding-top:10px}',
    '.st-sub>summary{cursor:pointer;font-size:13px;font-weight:600;color:#4a5a73}',
    '.st-sub .st-fold-body{padding-top:8px}',
    /* 我的进步 */
    '.st-progress-row{border:1px solid #e9eef7;border-radius:12px;padding:10px 12px;margin:8px 0;background:#fff}',
    '.st-progress-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px}',
    '.st-progress-head .st-note{margin-left:auto}',
    '.st-mastered{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;background:#1f7a45;color:#fff;font-weight:600}',
    /* 复习队列 · 我的进步 合并行 */
    '.st-review-row{border:1px solid #e9eef7;border-radius:14px;padding:11px 13px;margin:9px 0;background:#fff}',
    '.st-review-row.pin{border-color:#f0c4bf;background:#fffafa}',
    '.st-review-row.mastered{background:#f6fbf7;border-color:#c9e6d4}',
    '.st-review-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px}',
    '.st-review-top b{color:#22314a}',
    '.st-review-due{margin-left:auto}',
    '.st-tag-sub{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:#eef3ff;color:#3158b8}',
    '.st-mastered-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0;padding:9px 12px;border-radius:12px;background:#f2fbf5;border:1px solid #c9e6d4}',
    '.st-mastered-chip{display:inline-block;font-size:12px;padding:2px 9px;border-radius:999px;background:#fff;border:1px solid #b7e3c8;color:#1f7a45}',
    /* 科目拖拽排序 */
    '.st-chip[draggable="true"]{cursor:grab}',
    '.st-chip.dragging{opacity:.45}',
    '.st-chip.drop-target{outline:2px dashed #315efb;outline-offset:2px}',
    '.st-filter{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}',
    '.st-filter button.active{background:#315efb;color:#fff}',
    '.st-rate{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:12px}',
    '.st-rate button{padding:12px;border-radius:14px;border:1px solid #d7e1f2;background:#fff;text-align:left;cursor:pointer}',
    '.st-rate button:hover{border-color:#315efb;background:#f7faff}',
    '.st-rate b{display:block;font-size:15px}',
    '.st-rate span{font-size:12px;color:#65738b}',
    '.st-rate button.repeat b{color:#d9483f}',
    '.st-quiz{max-width:720px}',
    '.st-quiz .st-front{background:linear-gradient(145deg,#f4f8ff,#fffaf2);border:1px solid #a9c4ff;border-radius:18px;padding:18px}',
    '.st-quiz .st-back{margin-top:14px;background:#ecf5ff;border-left:4px solid #4779ff;border-radius:12px;padding:14px}',
    '.st-under textarea{width:100%;min-height:110px;margin-top:8px}',
    '.st-note{font-size:13px;color:#65738b}',
    '.st-empty{padding:22px;text-align:center;color:#758095;border:1px dashed #c8d3e5;border-radius:14px}',
    '.st-ok{color:#1f7a45}',
    '.st-bad{color:#c0392b}',
    '.st-radar{display:flex;justify-content:center;padding:8px 0}',
    '.st-radar svg{width:340px;height:340px;max-width:100%}',
    /* 底部折叠区 */
    '.st-fold{margin-top:16px;border:1px solid #e6ddcd;border-radius:14px;background:#fffdf8}',
    '.st-fold>summary{cursor:pointer;padding:12px 14px;font-weight:600}',
    '.st-fold-body{padding:0 14px 16px}'
  ].join('');
  document.head.appendChild(style);

  function e(value) { return app.esc(String(value == null ? '' : value)); }

  /* ---------------- 数据 ---------------- */
  async function loadSummary(force) {
    if (busy && !force) return;
    if (!force && Date.now() - lastSummary < 4000) return;
    try {
      ui.summary = await app.request('/v1/study/summary');
      ui.error = '';
      lastSummary = Date.now();
    } catch (error) {
      ui.error = '归纳数据加载失败：' + error.message;
    }
  }

  async function loadQueue(force) {
    if (!force && Date.now() - lastQueue < 4000) return;
    try {
      // 一次拿够（上限 200），知识点过滤在前端做，点热力图不用再等网络
      ui.queue = await app.request('/v1/study/review-queue?limit=200&subject=' + encodeURIComponent(ui.subject));
      ui.subjects = (ui.queue && ui.queue.subjects) || ui.subjects;
      ui.error = '';
      lastQueue = Date.now();
    } catch (error) {
      ui.error = '复习队列加载失败：' + error.message;
    }
  }

  async function loadGraph(force) {
    if (!force && Date.now() - lastGraph < 4000) return;
    try { ui.graph = await app.request('/v1/study/knowledge-graph'); lastGraph = Date.now(); }
    catch (error) { ui.graph = {nodes:[],edges:[],coOccurrences:[]}; ui.graphError = error.message; }
  }

  /* 知识卡（日期表要用每张卡的 reviewSchedule.dueAt） */
  async function loadCards(force) {
    if (!force && Date.now() - lastCards < 4000) return;
    try { ui.cards = (await app.request('/v1/knowledge-cards')) || []; lastCards = Date.now(); }
    catch (error) { if (!Array.isArray(ui.cards)) ui.cards = []; }
  }

  function loadAll(force) {
    return Promise.all([loadSummary(force), loadQueue(force), loadGraph(force), loadCards(force)]);
  }

  function pointOf(key) { return String(key || '').split('::')[1] || ''; }

  function drillGroup() {
    if (!ui.drill) return null;
    return ((ui.summary && ui.summary.drilldown) || []).find(function (group) { return group.key === ui.drill.key; }) || null;
  }

  /** 当前复习队列（按热力图选中的知识点过滤） */
  function queueItems() {
    var items = (ui.queue && ui.queue.items) || [];
    if (!ui.filterPoint) return items;
    return items.filter(function (item) { return item.knowledgePoint === ui.filterPoint; });
  }

  /** 复习流里排在最前面的一道错题（闭环页需要错题 id） */
  function firstMistake(items) {
    for (var i = 0; i < items.length; i++) if (items[i].type === 'mistake') return items[i];
    return null;
  }

  /* ---------------- 顶部：先选科目（页面第一件事） ---------------- */
  /** 当前科目下可见的知识点格子（全部科目时就是全量） */
  function visibleCells() {
    var cells = (ui.summary && ui.summary.heatmap) || [];
    if (ui.subject !== SUBJECT_ALL) cells = cells.filter(function (cell) { return cell.subject === ui.subject; });
    var order = subjectOptions();
    return cells.slice().sort(function (a, b) {
      if (ui.subject === SUBJECT_ALL) {
        var subjectDelta = order.indexOf(a.subject) - order.indexOf(b.subject);
        if (subjectDelta) return subjectDelta;
      }
      return (Number(b.priority) || 0) - (Number(a.priority) || 0)
        || String(a.knowledgePoint || '').localeCompare(String(b.knowledgePoint || ''), 'zh');
    });
  }

  /* 科目自定义排序：用户拖拽后的顺序存本地偏好，刷新/重启后仍然生效。
     （只存顺序这一个偏好，用 localStorage 就够，不必新增后端接口。） */
  var SUBJECT_ORDER_KEY = 'dsh.subjectOrder';

  function savedSubjectOrder() {
    try {
      var raw = window.localStorage.getItem(SUBJECT_ORDER_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (name) { return typeof name === 'string' && name; }) : [];
    } catch (error) { return []; }
  }

  function saveSubjectOrder(list) {
    try { window.localStorage.setItem(SUBJECT_ORDER_KEY, JSON.stringify(list)); } catch (error) { /* 隐私模式下写不了就算了 */ }
  }

  function orderSubjects(list) {
    var saved = savedSubjectOrder();
    if (!saved.length) return list;
    var rank = {};
    saved.forEach(function (name, index) { rank[name] = index; });
    return list.slice().sort(function (a, b) {
      var ra = rank[a] == null ? Number.MAX_SAFE_INTEGER : rank[a];
      var rb = rank[b] == null ? Number.MAX_SAFE_INTEGER : rank[b];
      if (ra !== rb) return ra - rb;
      return String(a).localeCompare(String(b), 'zh');
    });
  }

  /** 可选的科目：优先用后端给的列表，再补上热力图里出现过的；最后按用户自定义顺序排 */
  function subjectOptions() {
    var list = (ui.subjects || []).slice();
    ((ui.summary && ui.summary.heatmap) || []).forEach(function (cell) {
      if (cell.subject && list.indexOf(cell.subject) < 0) list.push(cell.subject);
    });
    return orderSubjects(list.filter(Boolean));
  }

  function scoped() { return ui.subject !== SUBJECT_ALL; }

  function subjectBarHtml() {
    var options = subjectOptions();
    var custom = savedSubjectOrder().length > 0;
    return '<div class="st-subject-bar">'
      + '<b>先选要复习的科目</b>'
      + '<button class="st-chip' + (ui.subject === SUBJECT_ALL ? ' active' : '') + '" data-st-subject="' + e(SUBJECT_ALL) + '">全部科目</button>'
      + options.map(function (subject) {
        return '<button class="st-chip' + (ui.subject === subject ? ' active' : '') + '"'
          + ' data-st-subject="' + e(subject) + '" data-st-subject-chip="' + e(subject) + '"'
          + ' draggable="true" title="点一下筛选；按住可以拖动排序">' + e(subject) + '</button>';
      }).join('')
      + (custom ? '<button class="st-chip" data-st-subject-order-reset title="恢复默认顺序">重置顺序</button>' : '')
      + '<span class="st-note">' + (scoped()
        ? '下面只看「' + e(ui.subject) + '」的内容'
        : '下面显示全部科目的内容') + '　·　科目可以按住拖动排序，顺序会自动记住</span>'
      + '</div>';
  }

  /* ---------------- 顶部总览 ---------------- */
  function metricsHtml() {
    var summary = ui.summary;
    var queue = ui.queue;
    var cells = visibleCells();
    var totals = (summary && summary.totals) || {knowledgePoints: 0, errors: 0, dueCards: 0};
    var due = queue ? queue.stats.due : '—';
    var pinned = (queue && queue.stats && queue.stats.pinned) || 0;
    // 选了科目之后，总数跟着所选科目走，不再是全量
    var pointCount = scoped() ? cells.length : totals.knowledgePoints;
    var errorCount = scoped()
      ? cells.reduce(function (sum, cell) { return sum + (Number(cell.errorCount) || 0); }, 0)
      : totals.errors;
    return '<div class="st-sticky">'
      + subjectBarHtml()
      + '<div class="st-sticky-row">'
      + '<div><span class="pill good">归纳 · 复习</span><h2 style="display:inline;margin-left:8px">今天该练什么</h2>'
      + '<p class="st-note" style="margin:4px 0 0">优先级 = 错误频次 × 知识点权重 × 时间衰减（30 天减半）；掌握度越低、错得越多、逾期越久，排得越前。</p></div>'
      + '<div class="st-actions" style="margin-top:0"><button data-st-refresh>刷新</button></div></div>'
      + '<div class="st-metrics">'
      + '<div class="st-metric' + (Number(due) > 0 ? ' hot' : '') + '"><b>' + e(due) + '</b><span>今日待复习（知识卡 + 错题）</span></div>'
      + '<div class="st-metric"><b>' + pointCount + '</b><span>知识点总数' + (scoped() ? '（' + e(ui.subject) + '）' : '') + '</span></div>'
      + '<div class="st-metric"><b>' + errorCount + '</b><span>错题总数' + (scoped() ? '（' + e(ui.subject) + '）' : '') + '</span></div>'
      + '<div class="st-metric"><b>' + pinned + '</b><span>置顶的高频易错项</span></div>'
      + '</div>'
      + (ui.error ? '<div class="st-analysis st-bad">' + e(ui.error) + '</div>' : '')
      + '</div>';
  }

  /* ---------------- 今日最该复习的 3 个知识点 ---------------- */
  /* 后端只给「全局前三」。选了科目之后，要按该科目的热力图重新取前三，
     否则像物理这种不在全局前三的科目会错误地显示成「没有薄弱点」。 */
  function topItems() {
    var all = (ui.summary && ui.summary.topToday) || [];
    if (!scoped()) return all;
    return visibleCells()
      .slice()
      .sort(function (a, b) { return b.priority - a.priority; })
      .slice(0, 3)
      .map(function (cell) {
        return Object.assign({}, cell, {
          isDue: false,
          reason: cell.errorCount >= 2
            ? '错过 ' + cell.errorCount + ' 次的反复卡点'
            : '近期新出现的薄弱点'
        });
      });
  }

  function topTodayHtml() {
    var summary = ui.summary;
    var items = topItems();
    if (!items.length) {
      return '<section class="panel st-shell"><div class="head"><div><span class="pill good">置顶</span><h2>今日最该复习的知识点</h2></div></div>'
        + '<div class="st-empty">' + (scoped()
          ? '「' + e(ui.subject) + '」还没有薄弱点数据。换个科目，或先去错题库录入一道错题。'
          : '还没有薄弱点数据。先去错题库录入一道错题，或完成一次 AI 陪练。') + '</div></section>';
    }
    return '<section class="panel st-shell" data-st-top-panel><div class="head"><div><span class="pill good">置顶</span><h2>今日最该复习的 ' + items.length + ' 个知识点'
      + (scoped() ? '（' + e(ui.subject) + '）' : '') + '</h2>'
      + '<p class="muted">点「看这个知识点的错题」会在这里就地展开错题列表，不用往下翻。</p></div>'
      + '<span class="pill warn">' + ((summary.totals && summary.totals.dueCards) || 0) + ' 张知识卡已到期</span></div>'
      + '<div class="st-top-list">'
      + items.map(function (item, index) {
        var mastery = item.mastery == null ? item.masteryFallback : item.mastery;
        var open = ui.drill && ui.drill.key === item.key && ui.drill.origin === 'top';
        return '<div class="st-topcard" data-st-top-card="' + e(item.key) + '">'
          + '<span class="st-rank">' + (index + 1) + '</span>'
          + (item.isDue ? '<span class="st-pin">FSRS 到期</span>' : '')
          + '<h4>' + e(item.knowledgePoint) + '</h4>'
          + '<div class="st-why">' + e(item.reason) + '</div>'
          + '<div class="st-bar"><i style="width:' + Math.max(6, Math.min(100, mastery || 0)) + '%"></i></div>'
          + '<div class="st-why">掌握度 ' + (mastery == null ? '—' : mastery) + ' · 错误 ' + item.errorCount + ' 次 · 优先级 ' + item.priority + '</div>'
          + '<div>' + sourcesHtml(item.sources) + '</div>'
          + '<div class="st-actions">'
          + '<button class="primary" data-st-drill-point="' + e(item.key) + '" data-st-drill-origin="top">' + (open ? '收起错题' : '看这个知识点的错题') + '</button>'
          + '<button data-st-filter-point="' + e(item.knowledgePoint) + '">只看它的复习队列</button>'
          + '<button data-st-start-point="' + e(item.knowledgePoint) + '">开始复习</button>'
          + '</div>'
          + (open ? drillHtml() : '')
          + '</div>';
      }).join('') + '</div></section>';
  }

  /* ---------------- 热力图（复习队列的视觉概览） ---------------- */
  function heatColor(priority, maxPriority) {
    var p = Math.max(0, Number(priority) || 0);
    var max = Math.max(0, Number(maxPriority) || 0);
    var intensity = max ? Math.max(0.12, Math.min(1, p / max)) : 0.12;
    var lightness = 96 - intensity * 39;
    var saturation = 62 + intensity * 30;
    return 'hsl(4,' + saturation.toFixed(0) + '%,' + lightness.toFixed(0) + '%)';
  }

  function heatmapHtml() {
    var cells = visibleCells();
    if (!cells.length) {
      return '<div class="st-empty">' + (scoped()
        ? '「' + e(ui.subject) + '」还没有知识点数据。'
        : '还没有知识点数据。先录入错题或完成一次 AI 陪练。') + '</div>';
    }
    var pinned = (ui.queue && ui.queue.pinnedPoints) || [];
    var maxPriority = cells.reduce(function (max, cell) { return Math.max(max, Number(cell.priority) || 0); }, 0);
    var groups = [];
    cells.forEach(function (cell) {
      var subject = cell.subject || '未分类';
      var group = groups.find(function (item) { return item.subject === subject; });
      if (!group) { group = {subject: subject, cells: []}; groups.push(group); }
      group.cells.push(cell);
    });
    return '<div class="st-legend"><span><i style="background:' + heatColor(maxPriority * .15, maxPriority) + '"></i>优先级较低</span>'
      + '<span><i style="background:' + heatColor(maxPriority * .55, maxPriority) + '"></i>优先级中</span>'
      + '<span><i style="background:' + heatColor(maxPriority, maxPriority) + '"></i>优先级最高</span>'
      + '<span>格子里的数字＝带时间衰减的错误频次；点格子＝展开这个知识点的原题列表，并过滤下面的复习队列</span></div>'
      + groups.map(function (group) { return (ui.subject === SUBJECT_ALL ? '<h3 class="st-heat-subject">' + e(group.subject) + '</h3>' : '') + '<div class="st-heat">' + group.cells.map(function (cell) {
        var mastery = cell.mastery == null ? cell.masteryFallback : cell.mastery;
        var active = ui.filterPoint === cell.knowledgePoint;
        var open = ui.drill && ui.drill.key === cell.key && ui.drill.origin === 'heat';
        return '<div class="st-cell' + (active ? ' active' : '') + '" style="background:' + heatColor(cell.priority, maxPriority) + '"'
          + ' data-st-filter-point="' + e(cell.knowledgePoint) + '" data-st-cell-key="' + e(cell.key) + '" role="button" tabindex="0">'
          + '<b>' + e(cell.knowledgePoint) + '</b>'
          + (pinned.indexOf(cell.knowledgePoint) >= 0 ? '<span class="st-pin">高频易错</span>' : '')
          + (cell.mastered ? '<span class="st-mastered">已攻克</span>' : '')
          + '<span>' + e(cell.subject) + ' · 错误 ' + cell.errorCount + ' 次</span><br>'
          + '<span>掌握度 ' + (mastery == null ? '—' : mastery) + ' · 优先级 ' + cell.priority + '</span>'
          + '<span class="st-cell-link" data-st-drill-point="' + e(cell.key) + '" data-st-drill-origin="heat">' + (open ? '收起原题' : '展开原题列表') + '</span>'
          + '</div>';
      }).join('') + '</div>'; }).join('');
  }

  function heatPanelHtml() {
    var active = ui.filterPoint;
    return '<section class="panel st-shell" data-st-heat-panel><div class="head"><div><span class="pill">热力图</span><h2>薄弱点热力图与复习队列</h2>'
      + '<p class="muted">颜色越红＝复习优先级越高；全部科目按学科分组，组内按优先级从高到低排列。点格子可展开对应知识点的原题列表。</p></div>'
      + '<div class="st-actions" style="margin-top:0">'
      + (active ? '<button data-st-filter-clear>清除筛选（' + e(active) + '）</button>' : '')
      + '<button class="primary" data-st-start>' + (active ? '开始复习「' + e(active) + '」' : '开始复习') + '</button>'
      + '</div></div>'
      + heatmapHtml()
      + (ui.drill && ui.drill.origin === 'heat' ? drillHtml() : '')
      + '</section>';
  }

  /* ---------------- 就地展开的错题列表 ---------------- */
  function sourcesHtml(sources) {
    if (!sources || !sources.length) return '';
    return sources.map(function (source) {
      return '<span class="st-src ' + e(source.key) + '" title="' + e(source.hint) + '">' + e(source.label) + '</span>';
    }).join('');
  }

  function drillHtml() {
    var group = drillGroup();
    if (!group) return '<div class="st-drill"><div class="st-note">这个知识点的错题数据还没加载完，稍等一下或点「刷新」。</div></div>';
    var mistakes = group.mistakes || [];
    if (!mistakes.length) {
      return '<div class="st-drill"><div class="st-drill-head"><b>' + e(group.knowledgePoint) + '</b>'
        + '<button data-st-drill-close>收起</button></div>'
        + '<div class="st-note">这个知识点下暂时还没有错题。</div></div>';
    }
    // 按「原卷 / 真题」分组
    var papers = [];
    var index = {};
    mistakes.forEach(function (mistake) {
      var paper = mistake.paper || {key: 'unknown', label: '未分类原卷'};
      if (!index[paper.key]) { index[paper.key] = {key: paper.key, label: paper.label, items: []}; papers.push(index[paper.key]); }
      index[paper.key].items.push(mistake);
    });
    var openMap = ui.openPaper[group.key] || {};
    return '<div class="st-drill"><div class="st-drill-head">'
      + '<div><b>' + e(group.knowledgePoint) + '</b> <span class="st-note">' + mistakes.length + ' 道错题 · '
      + papers.length + ' 份原卷 · 掌握度 ' + (group.mastery == null ? '—' : group.mastery) + ' · 优先级 ' + group.priority + '</span>'
      + '<div>' + sourcesHtml(group.sources) + '</div></div>'
      + '<button data-st-drill-close>收起</button></div>'
      + papers.map(function (paper) {
        var opened = openMap[paper.key] !== false;      // 默认展开
        return '<details class="st-paper"' + (opened ? ' open' : '') + ' data-st-paper="' + e(group.key + '|' + paper.key) + '">'
          + '<summary>' + e(paper.label) + '<span>' + paper.items.length + ' 题</span></summary>'
          + paper.items.map(function (mistake) {
            return '<div class="st-case" data-st-case="' + e(mistake.id) + '">'
              + '<h6>' + e(mistake.question || '（无题干）') + '</h6>'
              + '<div class="st-note">当时错因：' + e((mistake.errorCauses || []).join(' / ') || '未标注') + (mistake.has3D ? ' · 有 3D 模型' : '') + '</div>'
              + '<div class="st-note">AI 诊断：' + e((mistake.analysis && mistake.analysis.summary) || '还没有生成复盘解析，可以去 AI 陪练里把它走完。') + '</div>'
              + '<div>' + sourcesHtml(mistake.sources) + '</div>'
              + '<div class="st-actions"><button class="primary" data-st-goto-case="' + e(mistake.id) + '">去错题库看原题</button></div>'
              + '</div>';
          }).join('')
          + '</details>';
      }).join('') + '</div>';
  }

  /* ---------------- 复习队列 ---------------- */
  /* ---------------- 复习队列 · 我的进步（合并成一张表） ----------------
     以前「复习队列」按卡片/错题平铺，「我的进步」又按知识点把掌握度列一遍，
     同一个知识点出现两次、掌握度看两遍，功能重合。
     现在一行 = 一个知识点：左边是到期情况，右边是练习进度和操作。 */
  function reviewRows() {
    var byPoint = {};
    queueItems().forEach(function (item) {
      var row = byPoint[item.knowledgePoint]
        || (byPoint[item.knowledgePoint] = {cards: 0, mistakes: 0, overdue: 0, priority: 0, pinned: false});
      if (item.type === 'card') row.cards += 1; else row.mistakes += 1;
      row.overdue = Math.max(row.overdue, Number(item.overdueDays) || 0);
      row.priority = Math.max(row.priority, Number(item.priority) || 0);
      if (item.pinned) row.pinned = true;
    });
    return visibleCells().map(function (cell) {
      var due = byPoint[cell.knowledgePoint] || {cards: 0, mistakes: 0, overdue: 0, priority: 0, pinned: false};
      return {
        key: cell.key,
        point: cell.knowledgePoint,
        subject: cell.subject,
        cards: due.cards,
        mistakes: due.mistakes,
        due: due.cards + due.mistakes,
        overdue: due.overdue,
        priority: due.priority,
        pinned: due.pinned,
        mastery: masteryValue(cell),
        practiced: cell.practiced || 0,
        independent: cell.independent || 0,
        hinted: cell.hinted || 0,
        streak: cell.streak || 0,
        mastered: Boolean(cell.mastered)
      };
    }).sort(function (a, b) {
      if (a.mastered !== b.mastered) return a.mastered ? 1 : -1;      // 已攻克的沉到最下面
      if ((b.due > 0) !== (a.due > 0)) return b.due > 0 ? 1 : -1;      // 有到期的排前面
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.mastery !== b.mastery) return a.mastery - b.mastery;
      return b.practiced - a.practiced;
    });
  }

  /** 已攻克的知识点：单独一行带徽章（它们已经移出每日复习队列） */
  function masteredLine(mastered) {
    if (!mastered || !mastered.length) return '';
    return '<div class="st-mastered-line"><span class="st-mastered">已攻克 ' + mastered.length + ' 个</span>'
      + mastered.map(function (row) {
        return '<span class="st-mastered-chip">' + e(row.point) + '（连续 ' + row.streak + ' 次）</span>';
      }).join('')
      + '<span class="st-note">已移出每日复习队列</span></div>';
  }

  /* 复习日期表：把知识卡按到期日排成一张表，并把「空档」暴露出来。
     数据 = 每张卡的 reviewSchedule.dueAt（FSRS 算出的下次复习时间）。
     这张表就是「评分真的改变了频率」的可视化证据：
     评「不会」→ dueAt 被拉回今天（进「今天」行）；评「会了」→ 推到几十天后。
     如果出现「未来 N 天没有任何安排」，说明那些卡都被评成会了、系统认为你记住了。 */
  function calendarHtml() {
    var cards = Array.isArray(ui.cards) ? ui.cards : [];
    if (!cards.length) return '';
    var DAY = 86400000;
    var t0 = new Date(); t0.setHours(0, 0, 0, 0); t0 = t0.getTime();

    var rows = {};       // 第几天 -> {count, points:{}, cards:[]}
    var now = {count: 0, points: {}, cards: []};
    var undated = 0;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i] || {};
      var point = card.knowledgePoint || card.title || '未命名';
      var dueRaw = card.reviewSchedule && card.reviewSchedule.dueAt;
      if (!dueRaw) { undated++; continue; }
      var due = Date.parse(dueRaw);
      if (!isFinite(due)) { undated++; continue; }
      var idx = Math.floor((due - t0) / DAY);
      if (idx <= 0) { now.count++; now.points[point] = 1; now.cards.push(card); continue; }
      if (!rows[idx]) rows[idx] = {count: 0, points: {}, cards: []};
      rows[idx].count++;
      rows[idx].points[point] = 1;
      rows[idx].cards.push(card);
    }
    var keys = Object.keys(rows).map(Number).sort(function (a, b) { return a - b; });
    var totalAhead = 0;
    keys.forEach(function (k) { totalAhead += rows[k].count; });
    var firstGap = keys.length ? keys[0] : null;
    var fmtDate = function (idx) { var d = new Date(t0 + idx * DAY); return (d.getMonth() + 1) + '/' + d.getDate(); };
    var labelOf = function (idx) { return idx === 1 ? '明天' : idx + ' 天后'; };
    var pointsOf = function (bag, n) { return Object.keys(bag).slice(0, n).join('、'); };

    var html = '<section class="panel st-calendar"><div class="head"><div><span class="pill">复习日期表</span>'
      + '<h3>未来该练什么（按你每次评分自动排）</h3>'
      + '<p class="muted">评「不会」会把这张卡拉回今天，评「会了」会推到几十天后。这里就是你评分的直接结果。</p>'
      + '</div></div>'
      + '<div class="st-cal-sum">今天要做 <b>' + now.count + '</b> 项'
      + (totalAhead ? '　·　之后还有 <b>' + totalAhead + '</b> 项，最远排到 ' + fmtDate(keys[keys.length - 1]) : '')
      + (undated ? '　·　另有 ' + undated + ' 张卡还没排期' : '')
      + '</div>';

    if (firstGap !== null && firstGap > 2) {
      html += '<p class="geometry-alert">接下来 <b>' + (firstGap - 1) + ' 天没有任何安排</b> ——'
        + ' 说明这些卡都被评成「会了」，系统认为你已经记住。若其实没底，去知识闯关诚实评一次「有点模糊」，它就会立刻回到近期。</p>';
    }

    html += '<table class="st-cal-table"><thead><tr><th>日期</th><th>待复习</th><th>知识点</th></tr></thead><tbody>';
    if (now.count) {
      html += '<tr class="st-cal-now st-cal-row' + (ui.calOpen === 0 ? ' st-cal-open' : '') + '" data-st-cal-day="0">'
        + '<td><b>今天</b>（含逾期）</td><td><b>' + now.count + '</b></td><td>'
        + app.esc(pointsOf(now.points, 6)) + ' <span class="muted">▾ 点开看是哪几张</span></td></tr>';
      if (ui.calOpen === 0) html += calDrillHtml(0, now.cards);
    }
    for (var k = 0; k < keys.length && k < 12; k++) {
      var idx2 = keys[k], slot = rows[idx2];
      html += '<tr class="st-cal-row' + (ui.calOpen === idx2 ? ' st-cal-open' : '') + '" data-st-cal-day="' + idx2 + '">'
        + '<td>' + fmtDate(idx2) + ' <span class="muted">' + labelOf(idx2) + '</span></td><td>' + slot.count + '</td><td>'
        + app.esc(pointsOf(slot.points, 5)) + '</td></tr>';
      if (ui.calOpen === idx2) html += calDrillHtml(idx2, slot.cards);
    }
    if (!keys.length && !now.count) html += '<tr><td colspan="3" class="muted">还没有排期</td></tr>';
    html += '</tbody></table></section>';
    return html;
  }

  /* 日期表的下钻：点某一天，就地展开那天的卡片清单。
     目前只展示（知识点 / 标题 / 掌握状态），不做跨页跳转 —— 直接开练需要接闯关页。 */
  function calDrillHtml(dayIdx, cards) {
    var list = Array.isArray(cards) ? cards : [];
    var when = dayIdx === 0 ? '今天（含逾期）' : dayIdx + ' 天后';
    var html = '<tr class="st-cal-drill"><td colspan="3"><div class="st-cal-drill-in">'
      + '<p class="muted">' + when + ' 要复习的 <b>' + list.length + '</b> 张卡：</p><ul>';
    for (var i = 0; i < list.length && i < 12; i++) {
      var card = list[i] || {};
      var name = card.knowledgePoint || card.title || '未命名';
      var schedule = card.reviewSchedule || {};
      html += '<li><b>' + app.esc(name) + '</b>'
        + (card.title && card.title !== card.knowledgePoint ? '　<span class="muted">' + app.esc(String(card.title).slice(0, 44)) + '</span>' : '')
        + (schedule.streak ? '　<span class="pill">连续答对 ' + schedule.streak + '</span>' : '')
        + (schedule.lastResult ? '　<span class="muted">上次：' + app.esc(String(schedule.lastResult)) + '</span>' : '')
        + '</li>';
    }
    if (list.length > 12) html += '<li class="muted">…还有 ' + (list.length - 12) + ' 张，先练完这些</li>';
    html += '</ul></div></td></tr>';
    return html;
  }

  function queueHtml() {
    var queue = ui.queue;
    var items = queueItems();
    var filtering = Boolean(ui.filterPoint);
    var all = reviewRows();
    // 已攻克的移出每日复习队列，单独用一行带徽章展示
    var mastered = all.filter(function (row) { return row.mastered; });
    var rows = all.filter(function (row) { return !row.mastered && (row.due > 0 || row.practiced > 0); });
    var head = '<div class="head"><div><span class="pill">复习队列</span><h2>'
      + (filtering ? '「' + e(ui.filterPoint) + '」的待复习内容'
        : scoped() ? '「' + e(ui.subject) + '」的待复习内容'
          : '复习队列 · 我的进步') + '</h2>'
      + '<p class="muted">一行一个知识点：左边看到期情况，右边看你的练习进度；'
      + '高频易错置顶，连续 3 次独立答对就移出队列、标记为「已攻克」。评分 1~2 会重新入队。</p></div>'
      + '<div class="st-actions" style="margin-top:0">'
      + (filtering ? '<button data-st-filter-clear>看全部队列</button>' : '')
      + '<button class="primary" data-st-start>' + (filtering ? '开始复习这一类' : '开始复习') + '</button>'
      + '</div></div>';
    if (!queue) return '<section class="panel st-shell" data-st-queue-panel>' + head + '<div class="st-empty">正在读取复习队列…</div></section>';
    if (!items.length && !rows.length) {
      return '<section class="panel st-shell" data-st-queue-panel>' + head
        + '<div class="st-empty">' + (filtering ? '这个知识点今天没有到期的复习内容，换个知识点或看全部队列。' : '暂无待复习，去错题库添加新错题。')
        + '</div>'
        + '<div class="st-actions">' + (filtering ? '<button data-st-filter-clear>看全部队列</button>' : '')
        + '<button data-st-goto-library>去错题库</button></div>'
        + masteredLine(mastered) + '</section>';
    }
    var visible = rows.slice(0, 12);
    return '<section class="panel st-shell" data-st-queue-panel>' + head
      + '<div class="st-note">到期 ' + items.length + ' 项（知识卡 '
      + items.filter(function (i) { return i.type === 'card'; }).length + ' · 错题 '
      + items.filter(function (i) { return i.type === 'mistake'; }).length + '）· 涉及 '
      + rows.filter(function (r) { return r.due > 0; }).length + ' 个知识点</div>'
      + masteredLine(mastered)
      + visible.map(function (row) {
        var open = ui.drill && ui.drill.key === row.key && ui.drill.origin === 'queue';
        return '<div class="st-review-row' + (row.pinned ? ' pin' : '') + '">'
          + '<div class="st-review-top"><b>' + e(row.point) + '</b>'
          + (row.mastered ? '<span class="st-mastered">已攻克</span>' : '')
          + (row.pinned ? '<span class="st-pin">高频易错</span>' : '')
          + '<span class="st-tag-sub">' + e(row.subject) + '</span>'
          + '<span class="st-note st-review-due">' + (row.due > 0
            ? '到期 ' + row.due + ' 项（知识卡 ' + row.cards + ' · 错题 ' + row.mistakes + '）'
              + (row.overdue > 0 ? ' · 逾期 ' + Math.round(row.overdue) + ' 天' : '')
            : '今天没有到期') + '</span></div>'
          + '<div class="st-bar' + (row.mastery < 40 ? ' danger' : row.mastery < 60 ? ' warn' : '') + '"><i style="width:' + row.mastery + '%"></i></div>'
          + '<div class="st-note">掌握度 ' + row.mastery + '% · 已练同类题 ' + row.practiced
          + ' 次 · 独立完成 ' + row.independent + ' 次 · 提示 ' + row.hinted + ' 次'
          + (row.streak ? ' · 连续答对 ' + row.streak + ' 次' : '') + '</div>'
          + '<div class="st-actions">'
          + (row.due > 0 ? '<button class="primary" data-st-start-point="' + e(row.point) + '">开始复习</button>'
            : '<button data-st-start-point="' + e(row.point) + '" disabled>今天不用复习</button>')
          + '<button data-st-drill-point="' + e(row.key) + '" data-st-drill-origin="queue">' + (open ? '收起原题' : '展开原题列表') + '</button>'
          + '</div>'
          + (open ? drillHtml() : '')
          + '</div>';
      }).join('')
      + (rows.length > visible.length ? '<div class="st-note">还有 ' + (rows.length - visible.length) + ' 个知识点；用上面的科目和热力图筛选会更清楚。</div>' : '')
      + '</section>';
  }

  /* ---------------- 复习做题流 ---------------- */
  function sessionHtml() {
    var session = ui.session;
    if (!session) return '';
    var queue = session.ids;
    if (!queue.length) {
      return '<section class="panel st-shell"><div class="head"><div><span class="pill good">本轮完成</span><h2>复习完成</h2>'
        + '<p class="muted">共处理 ' + session.records.length + ' 张，其中重新入队 '
        + session.records.filter(function (r) { return r.repeat; }).length + ' 张。'
        + '回到复习队列会看到下一张已经前移。</p></div></div>'
        + '<div class="st-actions"><button data-st-session-end>结束本轮</button>'
        + '<button data-st-refresh>刷新队列</button></div></section>';
    }
    var currentId = queue[session.index];
    var item = (ui.queue && ui.queue.items || []).find(function (entry) { return entry.id === currentId; });
    if (!item) { session.ids.splice(session.index, 1); return ''; }
    var revealed = Boolean(ui.reveal[currentId]);
    var hints = ui.hints[currentId] || [];
    var percent = Math.round((session.records.length / Math.max(1, session.records.length + queue.length)) * 100);

    return '<section class="panel st-shell st-quiz"><div class="head"><div><span class="pill">复习中</span><h2>' + e(item.knowledgePoint) + '</h2>'
      + '<p class="muted">' + (item.type === 'card' ? '知识卡' : '错题') + ' · 剩余 ' + queue.length + ' 张 · 已评 ' + session.records.length + ' 张</p></div>'
      + '<span class="pill">' + percent + '%</span></div>'
      + '<div class="st-bar"><i style="width:' + percent + '%"></i></div>'
      + '<div class="st-front"><b>' + e(item.prompt || '（没有题干）') + '</b>'
      + (revealed
        ? '<div class="st-back"><b>完整内容</b><p>' + e(item.answer || '（这张卡还没有写下结论）') + '</p>'
          + (item.nextTimeAction ? '<p class="st-note">下次这样做：' + e(item.nextTimeAction) + '</p>' : '')
          + '<div class="st-actions"><button class="primary" data-st-really="' + e(currentId) + '">确实记住了，继续</button>'
          + '<button data-st-lost="' + e(currentId) + '">对不起，我刚忘掉了</button></div></div>'
        : '<div class="st-actions"><button class="primary" data-st-reveal="' + e(currentId) + '">记住了，看完整卡片</button></div>')
      + '</div>'
      + (revealed ? ratingHtml(currentId, hints) : '<p class="st-note">先回忆，再翻到背面确认。翻面后按真实感受评分。</p>')
      + '</section>';
  }

  function ratingHtml(cardId, hints) {
    var labels = hints.length ? hints : [
      {value: 1, label: '忘了', hint: '完全想不起来', intervalText: '—', repeat: true},
      {value: 2, label: '有点难', hint: '想起来了但很吃力', intervalText: '—', repeat: true},
      {value: 3, label: '还行', hint: '顺利回忆起来', intervalText: '—', repeat: false},
      {value: 4, label: '太简单', hint: '毫不费力', intervalText: '—', repeat: false}
    ];
    return '<div class="st-rate">' + labels.map(function (item) {
      return '<button class="' + (item.repeat ? 'repeat' : '') + '" data-st-rate="' + e(cardId) + '" data-st-value="' + item.value + '">'
        + '<b>' + e(item.label) + '（' + item.value + '）</b>'
        + '<span>' + e(item.hint) + ' · 下次 ' + e(item.intervalText || '—') + (item.repeat ? ' · 重新入队' : '') + '</span></button>';
    }).join('') + '</div>';
  }

  function understandingHtml() {
    var state = ui.understanding;
    if (!state) return '';
    if (state.saved) {
      return '<section class="panel st-shell st-under"><div class="head"><div><span class="pill good">已保存</span><h2>你的理解已经进复习队列</h2>'
        + '<p class="muted">它会在合适的时间以卡片形式再次出现，用来检验是不是真的记住了。</p></div></div>'
        + '<div class="st-actions"><button data-st-under-close>好</button></div></section>';
    }
    return '<section class="panel st-shell st-under"><div class="head"><div><span class="pill">我的理解</span><h2>用你自己的话，总结「' + e(state.knowledgePoint || '这个知识点') + '」</h2>'
      + '<p class="muted">' + e(state.triggerLabel || '复习完成') + '：它是解决什么问题的？关键判断是什么？下次第一步做什么？</p></div></div>'
      + '<textarea data-st-under-text placeholder="' + e(state.placeholder || '用自己的话写下来，越具体越好') + '">' + e(state.text || '') + '</textarea>'
      + '<div class="st-actions"><button class="primary" data-st-under-save ' + (busy ? 'disabled' : '') + '>保存为知识卡</button>'
      + '<button data-st-under-skip>暂时跳过</button></div>'
      + '<p class="st-note">' + e(ui.error || '写下来才会进复习队列；跳过不会丢失本轮复习结果。') + '</p></section>';
  }

  /* ---------------- 底部折叠区：不占首屏的次要图表 ---------------- */
  function subjectDistributionHtml() {
    var counts = new Map();
    ((app && app.state && app.state.mistakes) || []).forEach(function (item) {
      if (!item || !item.question || item.origin === 'configured_example_upload') return;
      if (scoped() && (item.subject || '未分类') !== ui.subject) return;
      var subject = item.subject || '未分类';
      counts.set(subject, (counts.get(subject) || 0) + 1);
    });
    var rows = Array.from(counts.entries()).sort(function (a, b) { return b[1] - a[1]; });
    var max = rows.length ? rows[0][1] : 1;
    return '<h3 style="margin:4px 0 8px">错题来自哪些学科</h3>'
      + (rows.length ? rows.map(function (row) {
        return '<div class="st-subject-row"><b>' + e(row[0]) + '</b><div class="st-subject-track"><i style="width:'
          + Math.round(row[1] / max * 100) + '%"></i></div><span>' + row[1] + ' 题</span></div>';
      }).join('') : '<p class="muted">录入错题后显示学科分布。</p>');
  }

  function pieHtml(distribution) {
    var items = (distribution && distribution.items) || [];
    if (!items.length) return '<h3 style="margin:18px 0 8px">错因分布</h3><div class="st-empty">还没有错因记录。</div>';
    var colors = ['#4a7cff', '#f2a33c', '#e0574f', '#38b48b', '#9b6bdf', '#5ec8d8', '#d98cb3'];
    var total = items.reduce(function (sum, item) { return sum + item.weight; }, 0) || 1;
    var angle = -Math.PI / 2;
    var paths = [];
    items.forEach(function (item, index) {
      var fraction = item.weight / total;
      var next = angle + fraction * Math.PI * 2;
      var color = colors[index % colors.length];
      if (fraction >= 0.999) {
        paths.push('<circle cx="50" cy="50" r="46" fill="' + color + '"></circle>');
      } else {
        var x1 = 50 + 46 * Math.cos(angle), y1 = 50 + 46 * Math.sin(angle);
        var x2 = 50 + 46 * Math.cos(next), y2 = 50 + 46 * Math.sin(next);
        var large = fraction > 0.5 ? 1 : 0;
        paths.push('<path d="M50 50 L' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A46 46 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" fill="' + color + '"></path>');
      }
      angle = next;
    });
    return '<h3 style="margin:18px 0 8px">错因分布</h3>'
      + '<div class="st-pie"><svg viewBox="0 0 100 100" role="img" aria-label="错因分布">' + paths.join('') + '</svg>'
      + '<div class="st-pie-list">' + items.slice(0, 7).map(function (item, index) {
        return '<div><span><i style="background:' + colors[index % colors.length] + '"></i>' + e(item.cause) + '</span><b>' + item.percent + '%</b></div>';
      }).join('') + '</div></div>';
  }

  function radarHtml(radar) {
    var mode = ui.radarMode || 'knowledgePoint';
    var set = mode === 'subject' ? (radar && radar.bySubject) : (radar && radar.byKnowledgePoint);
    var axes = (set && set.axes) || [];
    var buttons = '<div class="st-filter">'
      + '<button class="' + (mode === 'knowledgePoint' ? 'active' : '') + '" data-st-radar="knowledgePoint">按知识点</button>'
      + '<button class="' + (mode === 'subject' ? 'active' : '') + '" data-st-radar="subject">按学科</button></div>';
    var head = '<h3 style="margin:18px 0 8px">掌握度雷达</h3><p class="st-note">越靠外＝掌握越好；面积越小说明整体越薄弱。</p>' + buttons;
    if (axes.length < 3) {
      return head + '<div class="st-empty">至少需要 3 个维度才能画雷达图；当前只有 ' + axes.length + ' 个。</div>';
    }
    var size = 320, cx = size / 2, cy = size / 2 + 4, R = size / 2 - 52, n = axes.length;
    var grid = [0.25, 0.5, 0.75, 1].map(function (ratio) {
      var points = [];
      for (var i = 0; i < n; i++) {
        var angle = -Math.PI / 2 + i * 2 * Math.PI / n;
        points.push((cx + R * ratio * Math.cos(angle)).toFixed(1) + ',' + (cy + R * ratio * Math.sin(angle)).toFixed(1));
      }
      return '<polygon points="' + points.join(' ') + '" fill="none" stroke="#e2e9f6" stroke-width="1"></polygon>';
    }).join('');
    var spokes = '', labels = '', dataPoints = [];
    for (var i = 0; i < n; i++) {
      var angle = -Math.PI / 2 + i * 2 * Math.PI / n;
      var x = cx + R * Math.cos(angle), y = cy + R * Math.sin(angle);
      spokes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="#e2e9f6" stroke-width="1"></line>';
      var value = Math.max(0, Math.min(100, Number(axes[i].mastery) || 0)) / 100;
      dataPoints.push((cx + R * value * Math.cos(angle)).toFixed(1) + ',' + (cy + R * value * Math.sin(angle)).toFixed(1));
      var lx = cx + (R + 24) * Math.cos(angle), ly = cy + (R + 24) * Math.sin(angle);
      var anchor = Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : (Math.cos(angle) > 0 ? 'start' : 'end');
      labels += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="11" fill="#5a6a80" text-anchor="' + anchor
        + '" dominant-baseline="middle">' + e(String(axes[i].label).slice(0, 8)) + ' ' + axes[i].mastery + '</text>';
    }
    var dots = dataPoints.map(function (point) {
      var parts = point.split(',');
      return '<circle cx="' + parts[0] + '" cy="' + parts[1] + '" r="2.8" fill="#3158b8"></circle>';
    }).join('');
    return head + '<div class="st-radar"><svg viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="掌握度雷达图">'
      + grid + spokes
      + '<polygon points="' + dataPoints.join(' ') + '" fill="rgba(74,124,255,.22)" stroke="#4a7cff" stroke-width="2"></polygon>'
      + dots + labels + '</svg></div>';
  }

  function masteryValue(cell) {
    return Math.max(0, Math.min(100, Number(cell.mastery == null ? cell.masteryFallback : cell.mastery) || 0));
  }

  /* ---------------- 更多分析（移到最上方：掌握度进度条 + 统计） ---------------- */
  /* 归纳·复习页不再讲「掌握度」：这一块只留客观计数与分布，
     学习状态改由下面知识网络的依赖 / 易混淆 / 常结合关系表达。 */
  function analysisHtml() {
    var summary = ui.summary || {};
    var cells = visibleCells();
    var weak = cells.filter(function (cell) { return masteryValue(cell) < 60; }).length;
    var withCases = cells.filter(function (cell) { return (cell.caseIds || []).length; }).length;
    var chip = function (label, value) {
      return '<div class="st-metric"><b>' + e(value) + '</b><span>' + e(label) + '</span></div>';
    };
    return '<section class="panel st-shell" data-st-analysis>'
      + '<div class="head"><div><span class="pill">更多分析</span><h2>错题分布</h2>'
      + '<p class="muted">' + (scoped() ? '当前只看「' + e(ui.subject) + '」' : '全部科目')
      + '；这里只数客观记录，不给知识点打掌握度分数。</p></div>'
      + '<div class="st-metrics st-metrics-inline">'
      + chip('知识点', cells.length) + chip('有原题的知识点', withCases)
      + chip('错得较多', weak) + chip('错题总数', (summary.heatmap || []).reduce(function (sum, cell) { return sum + (cell.errorCount || 0); }, 0))
      + '</div></div>'
      + '<details class="st-sub" open><summary>学科分布 / 错因分布</summary><div class="st-fold-body">'
      + subjectDistributionHtml()
      + pieHtml(scoped()
        ? ((summary.errorCausesBySubject || {})[ui.subject] || {items: [], total: 0})
        : summary.errorCauses)
      + '</div></details></section>';
  }

  /* ---------------- 连线详情：两个知识点的 AI 衔接提示卡 ----------------
     学生点一条线，想知道的是"这两个到底怎么一起用 / 怎么区分"。
     提示卡按需向服务端取（服务端会缓存并做本地兜底），可以一键导入知识闯关。 */
  var relationTipKey = function (edge) { return edge.type + '|' + [edge.source, edge.target].sort().join(':'); };
  function relationTipOf(edge) {
    var store = ui.relationTips || (ui.relationTips = {});
    return store[relationTipKey(edge)] || null;
  }
  function relationTipColorKey(kind) {
    return kind.cls === 'kg-edge-dep' ? 'dep' : kind.cls === 'kg-edge-conf' ? 'conf' : kind.cls === 'kg-edge-co' ? 'co' : 'related';
  }
  function relationTipHtml(edge, from, to, kind) {
    var colorKey = relationTipColorKey(kind);
    var tip = relationTipOf(edge);
    if (!tip) {
      /* 生成一张要 9~14 秒（服务端会落库，第二次点同一对就秒开），
         所以这里必须有明确的"在算"反馈，否则学生以为点坏了。 */
      var loading = ui.relationTipsLoading && ui.relationTipsLoading[relationTipKey(edge)] ? '（已经等了 ' + ui.relationTipsLoading[relationTipKey(edge)] + ' 秒，通常要 10 秒左右）' : '';
      return '<div class="kg-tip ' + colorKey + ' is-loading" data-kg-tip="' + e(edge.id) + '">'
        + '<h4>这两个知识点怎么一起用？<span class="kg-tip-pill">' + e(kind.label) + '</span></h4>'
        + '<p class="muted"><span class="kg-tip-spinner" aria-hidden="true"></span>正在按「' + e(from.name) + '」和「' + e(to.name) + '」生成衔接提示…' + e(loading) + '</p>'
        + '<p class="kg-tip-note">生成好的提示会存下来，下次点同一条线立刻就能看到。</p></div>';
    }
    var importState = tip.imported ? '<p class="kg-tip-note">已导入知识闯关：在「闭环 · 知识卡」里能看到它，到点会安排复习。</p>' : '';
    /* 这里以前一律写"本地兜底提示（当前没有可用的模型密钥）"，不管是哪种失败都这么说，
       学生根本看不懂，而且经常是在谎报原因（密钥其实是配好的）。现在按真实来源说清楚。 */
    var tipSourceText = tip.source === 'ai' ? 'AI 按这两个知识点生成的提示'
      : tip.source === 'error' ? '这张提示卡没取回来'
        : tip.source === 'ai_failed' ? 'AI 这次没有生成成功，下面是本地兜底内容' + (tip.aiError ? '（' + tip.aiError + '）' : '')
          : tip.source === 'ai_not_configured' ? '学习服务没有配置大模型密钥，下面是本地兜底内容'
            : '下面是根据这两个知识点的关系给出的兜底提示';
    return '<div class="kg-tip ' + colorKey + '" data-kg-tip="' + e(edge.id) + '">'
      + '<h4>' + e(tip.headline || (from.name + ' 与 ' + to.name)) + '<span class="kg-tip-pill">' + e(tip.relationLabel || kind.label) + '</span></h4>'
      + (tip.body ? '<p>' + e(tip.body) + '</p>' : '')
      + (tip.solution ? '<p><b>通用解法：</b>' + e(tip.solution) + '</p>' : '')
      + (tip.tip ? '<p><b>怎么做：</b>' + e(tip.tip) + '</p>' : '')
      + (tip.pitfall ? '<p><b>最容易错：</b>' + e(tip.pitfall) + '</p>' : '')
      + (tip.question ? '<p class="muted">自查：' + e(tip.question) + '</p>' : '')
      + importState
      + '<p class="kg-tip-note">' + e(tipSourceText)
      + (tip.relatedCases && tip.relatedCases.length ? ' · 相关错题 ' + tip.relatedCases.length + ' 道' : '') + '</p>'
      + '<div class="kg-tip-actions">'
      + (tip.imported ? '' : '<button class="primary" data-kg-tip-import="' + e(edge.id) + '">导入知识闯关</button>')
      + (tip.relatedCases && tip.relatedCases.length ? '<button data-kg-tip-cases="' + e(edge.id) + '">先看这 ' + tip.relatedCases.length + ' 道错题</button>' : '')
      + (tip.source !== 'ai' ? '<button data-kg-tip-retry="' + e(edge.id) + '">再让 AI 试一次</button>' : '')
      + '</div></div>';
  }
  function currentGraphEdge(edgeId) {
    var graph = ui.graph || {};
    return (graph.edges || []).find(function (edge) { return edge.id === edgeId; }) || null;
  }
  function graphNodeName(nodeId) {
    var graph = ui.graph || {};
    var node = (graph.nodes || []).find(function (item) { return item.id === nodeId; });
    return node ? node.name : '';
  }
  function loadRelationTip(edgeId, force) {
    var edge = currentGraphEdge(edgeId);
    if (!edge) return Promise.resolve(null);
    var store = ui.relationTips || (ui.relationTips = {});
    var key = relationTipKey(edge);
    if (store[key] && !force) return Promise.resolve(store[key]);
    delete store[key];
    /* 计时器：让学生看到"在算，等了多久"，而不是一个静止的加载态。 */
    var loading = ui.relationTipsLoading || (ui.relationTipsLoading = {});
    loading[key] = 0;
    if (ui.relationTipsTimer) clearInterval(ui.relationTipsTimer);
    ui.relationTipsTimer = setInterval(function () {
      loading[key] = (loading[key] || 0) + 1;
      if (ui.graphSelectedEdge) app.render();
    }, 2000);
    var finish = function () { clearInterval(ui.relationTipsTimer); ui.relationTipsTimer = null; delete loading[key]; };
    return app.request('/v1/study/knowledge-graph/relation-tip', {
      method: 'POST',
      body: JSON.stringify({pointA: edge.source, pointB: edge.target, relationType: edge.type, frequency: edge.frequency})
    }).then(function (tip) {
      finish();
      store[key] = tip || null;
      return store[key];
    }).catch(function (error) {
      finish();
      store[key] = {source: 'error', headline: '提示卡暂时取不到', body: error.message || '稍后再试。',
        relationLabel: '', pointA: graphNodeName(edge.source), pointB: graphNodeName(edge.target), relatedCases: []};
      return store[key];
    }).then(function (tip) {
      if (ui.graphSelectedEdge === edgeId) app.render();
      return tip;
    });
  }
  function importRelationTip(edgeId) {
    var edge = currentGraphEdge(edgeId);
    if (!edge) { ui.error = '这条连线已经不在当前图里了，刷新后再试。'; app.render(); return Promise.resolve(null); }
    /* 不依赖内存里的 tip（图会随服务端刷新重建），没有就先取一张再导入 */
    var tip = relationTipOf(edge);
    var ready = tip && tip.source !== 'error' ? Promise.resolve(tip) : loadRelationTip(edgeId, false);
    return ready.then(function (resolved) {
      if (!resolved || resolved.source === 'error') { ui.error = '提示卡还没生成好，稍等一下再点导入。'; app.render(); return null; }
      return app.request('/v1/study/knowledge-graph/relation-card', {
        method: 'POST',
        body: JSON.stringify({
          pointA: edge.source, pointB: edge.target, relationType: edge.type,
          caseIds: (resolved.relatedCases || []).map(function (item) { return item.id; }),
          tip: {headline: resolved.headline, body: resolved.body, solution: resolved.solution, tip: resolved.tip, pitfall: resolved.pitfall},
          aiExplanation: resolved.body || ''
        })
      }).then(function (result) {
        resolved.imported = true;
        ui.notice = result && result.message ? result.message : '已导入知识闯关。';
        ui.error = '';
        lastCards = 0;   // 知识卡列表变了，下次进闭环/计划页重新拉
        app.render();
        return result;
      });
    }).catch(function (error) {
      ui.error = '导入失败：' + (error.message || error);
      app.render();
      return null;
    });
  }

  /* 点连线时自动推送两端知识点的错题；同时考到两个知识点的「点题」置顶。 */
  function edgeMistakesHtml(from, to) {
    var fromName = from && from.name, toName = to && to.name;
    var mistakes = (app && app.state && Array.isArray(app.state.mistakes)) ? app.state.mistakes : [];
    var both = [], onlyFrom = [], onlyTo = [];
    mistakes.forEach(function (m) {
      if (!m || !m.question) return;
      var points = Array.isArray(m.knowledgePoints) ? m.knowledgePoints : [];
      var hasFrom = fromName && points.indexOf(fromName) >= 0;
      var hasTo = toName && points.indexOf(toName) >= 0;
      if (hasFrom && hasTo) both.push(m);
      else if (hasFrom) onlyFrom.push(m);
      else if (hasTo) onlyTo.push(m);
    });
    if (!both.length && !onlyFrom.length && !onlyTo.length) {
      return '<div class="kg-edge-cases"><p class="muted">当前还没有这两端的错题记录，先录入或完成一次陪练。</p></div>';
    }
    var itemHtml = function (m) {
      return '<div class="st-case"><h6>' + e(m.question || '（无题干）') + '</h6>'
        + '<div class="st-note">' + e((m.subject || '') + ' · ' + ((m.knowledgePoints || []).join(' / ') || '未标注知识点')) + '</div>'
        + '<div class="st-actions"><button class="primary" data-st-goto-case="' + e(m.id) + '">去错题库看原题</button></div></div>';
    };
    var group = function (title, list) {
      return list.length ? '<div class="kg-edge-cases-group"><b>' + e(title) + '</b>' + list.map(itemHtml).join('') + '</div>' : '';
    };
    return '<div class="kg-edge-cases">'
      + group('同时考到这两个知识点 · 点题', both)
      + group('「' + fromName + '」的错题', onlyFrom)
      + group('「' + toName + '」的错题', onlyTo)
      + '</div>';
  }

  function knowledgeGraphHtml() {
    var graph = ui.graph || {nodes:[], edges:[], coOccurrences:[]};
    var nodes = graph.nodes || [], edges = graph.edges || [];    // Keep the network useful when a page is newer than its running API process:
    // the heatmap is already server-confirmed and includes the exact weak-point
    // labels plus source case ids, so use it as a safe graph fallback instead of
    // falsely telling the student that no records exist.
    if (!nodes.length) {
      var cells = (ui.summary && ui.summary.heatmap) || [];
      nodes = cells.map(function (cell, index) {
        return {id:'heat-' + index, name:cell.knowledgePoint, subject:cell.subject || '未分类',
          mastery_avg:cell.mastery == null ? (cell.masteryFallback == null ? null : cell.masteryFallback) : cell.mastery,
          caseIds:cell.caseIds || [], hasVisualization:false, reviewedToday:false};
      }).filter(function (node) { return node.name; });
      var fallbackEdges = [], fallbackPairs = [];
      for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
        if (nodes[i].subject !== nodes[j].subject) continue;
        var aCases = new Set(nodes[i].caseIds), sharedCases = (nodes[j].caseIds || []).filter(function (id) { return aCases.has(id); });
        if (!sharedCases.length) continue;
        var edge = {id:'heat-co-' + i + '-' + j, source:nodes[i].id, target:nodes[j].id,
          type:'CO_OCCURS_WITH', frequency:sharedCases.length, sourceType:'heatmap_case_overlap', caseIds:sharedCases};
        fallbackEdges.push(edge);
        fallbackPairs.push({pointA_id:nodes[i].id, pointB_id:nodes[j].id, frequency:sharedCases.length, source:'heatmap_case_overlap'});
      }
      for (var ri = 0; ri < nodes.length; ri++) for (var rj = ri + 1; rj < nodes.length; rj++) {
        if (curriculumNodesRelated(nodes[ri], nodes[rj]) && !fallbackEdges.some(function (edge) {
          return edge.type === 'RELATED_TO' && ((edge.source === nodes[ri].id && edge.target === nodes[rj].id) || (edge.source === nodes[rj].id && edge.target === nodes[ri].id));
        })) fallbackEdges.push({id:'heat-related-' + ri + '-' + rj, source:nodes[ri].id, target:nodes[rj].id,
          type:'RELATED_TO', frequency:1, sourceType:'curriculum_semantic_cluster'});
      }
      edges = fallbackEdges;
      graph = {nodes:nodes, edges:edges, coOccurrences:fallbackPairs, provider:'heatmap-fallback'};
      /* 关键：把兜底图写回 ui.graph。
         否则点连线时按 id 去 ui.graph 里找边会找不到（ui.graph 还是空的），
         提示卡会永远停在"正在生成"。 */
      ui.graph = graph;
    }
    if (!nodes.length) return '<section class="panel st-shell"><div class="head"><div><span class="pill">知识网络</span><h2>知识网络图</h2></div></div><div class="st-empty">录入错题或知识卡后，这里会按当前账号的数据生成知识点网络。</div></section>';
    /* 科目联动：知识网络跟随顶部「先选要复习的科目」，不再维护自己的学科标签页。 */
    var activeSubject = ui.subject === SUBJECT_ALL ? '全部' : ui.subject;
    var visibleNodes = activeSubject === '全部' ? nodes : nodes.filter(function (node) { return (node.subject || '未分类') === activeSubject; });
    var visibleIds = new Set(visibleNodes.map(function (node) { return node.id; }));
    var visibleEdges = edges.filter(function (edge) { return visibleIds.has(edge.source) && visibleIds.has(edge.target); });
    var subjects = Array.from(new Set(visibleNodes.map(function (node) { return node.subject || '未分类'; })));
    var viewportWidth = Number(window.innerWidth) || 1100;
    var responsiveWidth = Math.max(240, Math.min(1000, viewportWidth - 56));
    var width = activeSubject === '全部'
      ? Math.max(responsiveWidth, Math.min(1250, subjects.length * 300))
      : responsiveWidth;
    var height = Math.max(480, Math.min(720, Math.ceil(visibleNodes.length / 3) * 155 + 130));
    var coords = layoutKnowledgeNodes(visibleNodes, visibleEdges, subjects, width, height);
    nodes = visibleNodes; edges = visibleEdges;
    var selected = ui.graphSelected && coords[ui.graphSelected] ? coords[ui.graphSelected].node : null;
    var selectedEdge = ui.graphSelectedEdge && edges.find(function (edge) { return edge.id === ui.graphSelectedEdge; });
    /* 三类关系 = 三种颜色；线粗细 = 两个知识点同时出现的频率。
       依赖是课程先修关系，没有统计频次，固定最细。 */
    var EDGE_KIND = {
      DEPENDS_ON: {cls:'kg-edge-dep', label:'依赖', color:'#e8a712', hint:'B 没掌握，A 也学不会'},
      CONFUSES_WITH: {cls:'kg-edge-conf', label:'易混淆', color:'#df4b45', hint:'这两个学生老搞混'},
      CO_OCCURS_WITH: {cls:'kg-edge-co', label:'常结合', color:'#2f9e63', hint:'考试里经常一起出现'},
      RELATED_TO: {cls:'kg-edge-related', label:'课程相关', color:'#aab8cb', hint:'课程上相关，未必在同一道题里出现'}
    };
    function edgeKind(edge) { return EDGE_KIND[edge.type] || EDGE_KIND.CO_OCCURS_WITH; }
    function edgeWeight(edge) {
      var frequency = Number(edge.frequency) || 1;
      if (edge.type === 'DEPENDS_ON' || edge.type === 'RELATED_TO') return 2;
      return Math.max(2, Math.min(9, 1.6 + Math.sqrt(frequency) * 1.5));
    }
    var edgeMarkup = edges.map(function (edge) {
      var a = coords[edge.source], b = coords[edge.target]; if (!a || !b) return '';
      var kind = edgeKind(edge);
      var frequency = Number(edge.frequency) || 1;
      var weight = edgeWeight(edge);
      var active = !!(selected && (edge.source === selected.id || edge.target === selected.id)) || !!(selectedEdge && selectedEdge.id === edge.id);
      var frequencyText = edge.type === 'DEPENDS_ON' || edge.type === 'RELATED_TO' ? '' : ' · 同题出现 ' + frequency + ' 次';
      var title = kind.label + frequencyText + ' · ' + (edge.sourceType || '统计')
        + '（' + kind.hint + '）点这条线看怎么用 + 跳到相关错题';
      return '<g data-kg-edge="' + e(edge.id) + '" tabindex="0" role="button" aria-label="' + e(title) + '"><title>' + e(title) + '</title>'
        + '<line class="kg-edge-hit" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>'
        + '<line class="kg-edge ' + kind.cls + (active ? ' kg-edge-active' : '') + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke-width="' + weight + '"/>'
        + '</g>';
    }).join('');
    var nodeMarkup = nodes.map(function (node) {
      var point = coords[node.id], active = selected && selected.id === node.id, neighbor = selected && edges.some(function (edge) { return (edge.source === selected.id && edge.target === node.id) || (edge.target === selected.id && edge.source === node.id); });
      var cls = 'kg-node' + (node.reviewedToday ? ' reviewed' : '') + (active ? ' selected' : '');
      var opacity = selected && !active && !neighbor ? '.35' : '1';
      return '<g class="' + cls + '" data-kg-node="' + e(node.id) + '" tabindex="0" role="button" aria-label="' + e(node.subject + ' ' + node.name) + '" opacity="' + opacity + '"><title>' + e(node.subject + ' · 掌握度 ' + (node.mastery_avg == null ? '未评' : node.mastery_avg + '%') + (node.hasVisualization ? ' · 有 3D 可视化' : '')) + '</title><circle cx="' + point.x + '" cy="' + point.y + '" r="17"/><text x="' + point.x + '" y="' + (point.y + 37) + '" text-anchor="middle">' + e(node.name.length > 13 ? node.name.slice(0,12) + '…' : node.name) + '</text></g>';
    }).join('');
    var detail = '';
    if (selected) {
      var related = edges.filter(function (edge) { return edge.source === selected.id || edge.target === selected.id; }).map(function (edge) { var otherId = edge.source === selected.id ? edge.target : edge.source; return {edge:edge,node:(graph.nodes||[]).find(function (node) { return node.id === otherId; })}; }).filter(function (item) { return item.node; });
      detail = '<div class="kg-detail"><b>' + e(selected.subject + ' · ' + selected.name) + '</b><span class="muted">' + (selected.reviewedToday ? ' · 今日已复习' : '') + (selected.hasVisualization ? ' · 有 3D 模型' : '') + '</span><div>' + (related.length ? related.map(function (item) { return '<button data-kg-edge="' + e(item.edge.id) + '">' + e(item.node.name) + ' · ' + e(item.edge.type) + ' ×' + e(item.edge.frequency || 1) + '</button>'; }).join('') : '<span class="muted">暂无关联知识点。</span>') + '</div></div>';
    } else if (selectedEdge) {
      var from = coords[selectedEdge.source]?.node, to = coords[selectedEdge.target]?.node;
      if (from && to) {
        var kind = edgeKind(selectedEdge);
        var frequency = Number(selectedEdge.frequency) || 1;
        var frequencyLine = selectedEdge.type === 'DEPENDS_ON' || selectedEdge.type === 'RELATED_TO'
          ? '课程先修关系，按题目里出现的知识点连出来'
          : '两个知识点在同一道错题里同时出现 ' + frequency + ' 次（线越粗 = 一起考得越多）';
        detail = '<div class="kg-detail"><b>' + e(from.name + ' ↔ ' + to.name) + '</b>'
          + '<p class="muted">' + e(kind.label + ' · ' + frequencyLine) + '</p>'
          + relationTipHtml(selectedEdge, from, to, kind)
          + edgeMistakesHtml(from, to)
          + '<div class="row"><button class="primary" data-kg-open-point="' + e(from.name) + '">看「' + e(from.name) + '」的错题</button>'
          + '<button data-kg-open-point="' + e(to.name) + '">看「' + e(to.name) + '」的错题</button></div></div>';
      }
    }
    var recs = (graph.coOccurrences || []).slice().sort(function (a,b) { return b.frequency - a.frequency; }).slice(0,6);
    var recHtml = recs.length ? '<div class="kg-recs">' + recs.map(function (item) { var a=nodes.find(function(n){return n.id===item.pointA_id}),b=nodes.find(function(n){return n.id===item.pointB_id}); return a&&b?'<div class="kg-rec"><b>'+e(a.name)+' + '+e(b.name)+'</b><p class="muted">这两个知识点经常一起考，建议一起复习 · '+e(item.frequency)+' 题</p><button data-kg-open-point="'+e(a.name)+'">一起复习</button></div>':''; }).join('') + '</div>' : '<p class="muted">积累到同题包含多个知识点的记录后，会在这里给出共现建议。</p>';
    var graphNotice = graph.provider === 'heatmap-fallback' ? '<p class="muted" role="status">按当前账号的错题生成。</p>' : '';
    var legend = '<div class="kg-legend" data-kg-legend>'
      + '<span><i class="kg-line-dep"></i>依赖：B 没掌握，A 也学不会</span>'
      + '<span><i class="kg-line-conf"></i>易混淆：这两个老搞混</span>'
      + '<span><i class="kg-line-co"></i>常结合：考试经常一起出现</span>'
      + '<span>线越粗 = 一起考得越多</span>'
      + '<span>点线看「怎么一起用」并跳到相关错题</span></div>';
    return '<section class="panel st-shell" data-knowledge-graph><div class="head"><div><span class="pill">知识网络</span><h2>知识网络图</h2><p class="muted">只画你自己错题里出现过的知识点；连线分三类（依赖 / 易混淆 / 常结合），点一条线看怎么一起用，并能跳到相关错题。</p>' + graphNotice + '</div><span class="pill">' + nodes.length + ' 个知识点</span></div>' + legend + '<div class="kg-scroll"><svg class="kg-svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + e(activeSubject) + '知识点关系图">' + subjects.map(function (subject) { var x = subjects.length===1?width/2:120+subjects.indexOf(subject)*(width-240)/(subjects.length-1); return '<text x="'+x+'" y="28" text-anchor="middle" fill="#334c70" font-size="14" font-weight="700">'+e(subject)+'</text>'; }).join('') + edgeMarkup + nodeMarkup + '</svg></div>' + detail + '<details class="st-sub"><summary>知识点共现建议</summary><div class="st-fold-body">' + recHtml + '</div></details></section>';
  }

  function curriculumNodesRelated(a, b) {
    if ((a.subject || '') !== '数学' || (b.subject || '') !== '数学') return false;
    function families(name) { var text=String(name||''); return {
      space:/空间|立体|多面体|棱锥|棱柱/.test(text), angle:/角|二面|线面/.test(text),
      distance:/距离|点面距|点到平面/.test(text), vector:/法向量|空间向量|向量/.test(text),
      perpendicular:/垂直|垂线/.test(text)
    }; }
    var x=families(a.name),y=families(b.name),keys=Object.keys(x);
    var isDihedral = function (text) { return /二面角/.test(text); };
    var isPlaneDistance = function (text) { return /点到平面|点面距离/.test(text); };
    var isSolidGeometry = function (text) { return /立体几何|空间几何/.test(text); };
    if ((isSolidGeometry(a.name) && isDihedral(b.name)) || (isSolidGeometry(b.name) && isDihedral(a.name))) return true;
    if ((isDihedral(a.name) && isPlaneDistance(b.name)) || (isDihedral(b.name) && isPlaneDistance(a.name))) return true;
    if ((x.angle && y.vector) || (y.angle && x.vector)) return true;
    if ((x.distance && y.vector) || (y.distance && x.vector)) return true;
    return (x.perpendicular && y.vector) || (y.perpendicular && x.vector);
  }

  function layoutKnowledgeNodes(nodes, edges, subjects, width, height) {
    var coords={}, byId=new Map();
    var labelWidth=function(node){return Math.min(13,[...String(node.name||'')].length)*12+8;};
    subjects.forEach(function (subject,index) {
      var list=nodes.filter(function (node) { return (node.subject||'未分类')===subject; });
      var centerX=subjects.length===1?width/2:150+index*(width-300)/(subjects.length-1),centerY=height/2;
      var radius=Math.max(70,Math.min(width/(subjects.length+1),height)*0.28);
      list.forEach(function (node,i) { var angle=i*2.399963229728653,r=radius*Math.sqrt((i+0.5)/Math.max(1,list.length));
        var p={x:centerX+Math.cos(angle)*r,y:centerY+Math.sin(angle)*r,node:node,vx:0,vy:0,cx:centerX,cy:centerY};coords[node.id]=p;byId.set(node.id,p);
      });
    });
    // Multiple relationship types for the same pair must not multiply spring force.
    var springByPair=new Map();
    edges.forEach(function(edge){var key=[edge.source,edge.target].sort().join('|');if(!springByPair.has(key)||edge.type==='CO_OCCURS_WITH')springByPair.set(key,edge);});
    var springs=[...springByPair.values()];
    for (var step=0;step<100;step++) {
      nodes.forEach(function (node,i) { var p=coords[node.id];
        for (var j=i+1;j<nodes.length;j++) { var q=coords[nodes[j].id];if(p.node.subject!==q.node.subject)continue;
          var dx=p.x-q.x,dy=p.y-q.y,d=Math.max(1,Math.hypot(dx,dy));if(d<150){var push=(150-d)*0.025/d;p.vx+=dx*push;p.vy+=dy*push;q.vx-=dx*push;q.vy-=dy*push;}
        }
      });
      springs.forEach(function (edge) { var a=byId.get(edge.source),b=byId.get(edge.target);if(!a||!b)return;
        var dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),rest=edge.type==='CO_OCCURS_WITH'?165:180,pull=(d-rest)*0.001;
        a.vx+=dx*pull;a.vy+=dy*pull;b.vx-=dx*pull;b.vy-=dy*pull;
      });
      nodes.forEach(function (node) { var p=coords[node.id];p.vx+=(p.cx-p.x)*0.0018;p.vy+=(p.cy-p.y)*0.0018;p.x+=p.vx;p.y+=p.vy;p.vx*=0.78;p.vy*=0.78;
        p.x=Math.max(90,Math.min(width-90,p.x));p.y=Math.max(72,Math.min(height-72,p.y));
      });
    }
    // Final label-aware collision pass. The force layout positions circles; this
    // projection reserves actual Chinese label width so text cannot stack.
    for(var pass=0;pass<180;pass++){
      var overlaps=0;
      for(var i=0;i<nodes.length;i++)for(var j=i+1;j<nodes.length;j++){
        var a=coords[nodes[i].id],b=coords[nodes[j].id],dx=b.x-a.x,dy=b.y-a.y;
        var overlapX=(labelWidth(a.node)+labelWidth(b.node))/2+14-Math.abs(dx),overlapY=20-Math.abs(dy);
        if(overlapX>0&&overlapY>0){
          overlaps++;
          var pushX=Math.min(overlapX/2+1,18),pushY=Math.min(overlapY/2+1,18),preferY=overlapY<=overlapX;
          if(preferY){var sy=dy<0?-1:1;a.y-=sy*pushY;b.y+=sy*pushY;}else{var sx=dx<0?-1:1;a.x-=sx*pushX;b.x+=sx*pushX;}
          a.x=Math.max(90,Math.min(width-90,a.x));b.x=Math.max(90,Math.min(width-90,b.x));
          a.y=Math.max(72,Math.min(height-72,a.y));b.y=Math.max(72,Math.min(height-72,b.y));
        }
        var d=Math.max(1,Math.hypot(dx,dy));
        if(d<58){var spread=(58-d)/2+1,sx2=dx/d,sy2=dy/d;a.x-=sx2*spread;b.x+=sx2*spread;a.y-=sy2*spread;b.y+=sy2*spread;overlaps++;}
      }
      if(!overlaps)break;
    }
    return coords;
  }

  /* 「我的进步」不再单独成块：已合并进「复习队列 · 我的进步」一张表（见 queueHtml）。
     掌握度、已练 / 独立 / 提示次数、连续答对、已攻克徽章都在那一行里。 */

  /* ---------------- 页面渲染 ---------------- */
  /* 我的进步已经合并进上面的「复习队列 · 我的进步」一张表，这里不再单独渲染一遍。
     保留 masteryValue() 供分析区和合并行共用。 */
  function renderStudy(v) {
    v.className = 'work';
    v.innerHTML = metricsHtml()
      + calendarHtml()
      + analysisHtml()
      + knowledgeGraphHtml()
      + heatPanelHtml()
      + queueHtml()
      + sessionHtml()
      + understandingHtml();

    bind(v);

    if (!ui.summary || !ui.queue || !ui.graph || ui.stale) {
      ui.stale = false;
      loadAll(true).then(function () { app.render(); });
    }
  }

  /* ---------------- 首页装饰 ---------------- */
  function decorateHome(v) {
    var summary = ui.summary;
    var queue = ui.queue;
    var dueCount = queue ? queue.stats.due : '…';
    var top = (summary && summary.topToday) || [];
    var panel = document.createElement('section');
    panel.className = 'panel st-shell';
    panel.innerHTML = '<div class="head"><div><span class="pill good">今日复习</span><h2>今天要复习 ' + dueCount + ' 项</h2>'
      + '<p class="muted">按 FSRS 间隔安排；答错会自动重新排进本轮队列。</p></div>'
      + '<button class="primary" id="st-open">去归纳与复习</button></div>'
      + (top.length
        ? '<div class="st-top">' + top.map(function (item, index) {
          var mastery = item.mastery == null ? item.masteryFallback : item.mastery;
          return '<div class="st-topcard"><span class="st-rank">' + (index + 1) + '</span><h4>' + e(item.knowledgePoint) + '</h4>'
            + '<div class="st-why">' + e(item.reason) + '</div>'
            + '<div class="st-why">错误 ' + item.errorCount + ' 次 · 掌握度 ' + (mastery == null ? '—' : mastery) + '</div>'
            + '<div>' + sourcesHtml(item.sources) + '</div></div>';
        }).join('') + '</div>'
        : '<div class="st-empty">还没有薄弱点数据。录入错题或完成一次陪练后，这里会显示最该复习的三个知识点。</div>');
    v.appendChild(panel);
    var open = panel.querySelector('#st-open');
    if (open) open.onclick = function () { ui.stale = true; app.state.tab = 'clusters'; app.save(); app.render(); };
    if (!summary || !queue) {
      loadAll(true).then(function () {
        if (app.state.tab === 'home') app.render();
      });
    }
  }

  /* ---------------- 跳转到错题库的原题详情页 ---------------- */
  function openCaseInLibrary(caseId) {
    if (!caseId) return;
    var state = app.state;
    // 清掉所有可能把这道题挡住的筛选条件
    state.query = '';
    state.subjectFilter = '全部';
    state.demo3DOnly = false;
    state.searchOnly = false;
    state.libraryLimit = Math.max(500, Number(state.libraryLimit) || 0);
    state.focusMistakeId = caseId;
    state.libraryDetailId = caseId;
    state.pendingFocusScroll = true;
    state.tab = 'library';
    app.save();
    app.render();
  }

  /* ---------------- 开始复习：直接进入闭环页 ---------------- */
  function startReview(pointName) {
    var items = queueItems();
    if (pointName && ui.filterPoint !== pointName) {
      ui.filterPoint = pointName;
      items = queueItems();
    }
    if (!items.length) {
      ui.error = '暂无待复习，去错题库添加新错题。';
      return app.render();
    }
    // 默认加载队列里的第一张卡：优先错题（闭环页按错题推进），否则走知识卡滚动测验
    var mistake = firstMistake(items);
    if (mistake) {
      app.state.loop = app.state.loop || {evidence: [], weekly: [], activeId: null};
      app.state.loop.activeId = mistake.id;
      app.state.loop.activeTaskId = null;
      app.state.tab = 'loop';
    } else {
      app.state.tab = 'card-challenge';
    }
    app.save();
    app.render();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind(root) {
    root.querySelectorAll('[data-kg-node]').forEach(function (node) {
      node.onclick = function () { ui.graphSelected = node.dataset.kgNode; ui.graphSelectedEdge = null; app.render(); };
      node.onkeydown = function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); } };
    });
    root.querySelectorAll('[data-kg-edge]').forEach(function (edge) {
      edge.onclick = function (event) {
        if (event) event.stopPropagation();
        ui.graphSelectedEdge = edge.dataset.kgEdge; ui.graphSelected = null; app.render();
        // 点线 = 要这两个知识点"怎么一起用"的提示，顺手取回来（服务端有缓存）
        loadRelationTip(edge.dataset.kgEdge, false);
      };
      edge.onkeydown = function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edge.click(); } };
    });
    root.querySelectorAll('[data-kg-tip-import]').forEach(function (button) {
      button.onclick = function (event) { if (event) event.stopPropagation(); button.disabled = true; importRelationTip(button.dataset.kgTipImport); };
    });
    root.querySelectorAll('[data-kg-tip-retry]').forEach(function (button) {
      button.onclick = function (event) { if (event) event.stopPropagation(); loadRelationTip(button.dataset.kgTipRetry, true); };
    });
    root.querySelectorAll('[data-kg-tip-cases]').forEach(function (button) {
      button.onclick = function (event) {
        if (event) event.stopPropagation();
        var edge = currentGraphEdge(button.dataset.kgTipCases);
        if (!edge) return;
        ui.filterPoint = graphNodeName(edge.source); ui.graphSelectedEdge = null; ui.graphSelected = null; ui.drill = null; lastQueue = 0;
        loadQueue(true).then(function () { app.render(); setTimeout(function () { document.querySelector('[data-st-queue-panel]')?.scrollIntoView({behavior:'smooth',block:'start'}); }, 80); });
        app.render();
      };
    });
    root.querySelectorAll('[data-kg-open-point]').forEach(function (button) {
      button.onclick = function () {
        ui.filterPoint = button.dataset.kgOpenPoint; ui.graphSelectedEdge = null; ui.graphSelected = null; ui.drill = null; lastQueue = 0;
        loadQueue(true).then(function () { app.render(); setTimeout(function () { document.querySelector('[data-st-queue-panel]')?.scrollIntoView({behavior:'smooth',block:'start'}); }, 80); });
        app.render();
      };
    });
    root.querySelectorAll('[data-st-refresh]').forEach(function (button) {
      button.onclick = function () {
        busy = true; ui.error = ''; ui.stale = false;
        loadAll(true).then(function () { busy = false; lastQueue = 0; app.render(); });
      };
    });
    /* 复习日期表：点某一天就地展开那天要复习的卡片（再点一次收起） */
    root.querySelectorAll('[data-st-cal-day]').forEach(function (row) {
      row.onclick = function () {
        var day = Number(row.getAttribute('data-st-cal-day'));
        ui.calOpen = (ui.calOpen === day) ? null : day;
        app.render();
      };
    });
    // 顶部第一件事：选要复习的科目。下面的置顶卡 / 热力图 / 队列全部跟着走。
    root.querySelectorAll('[data-st-subject]').forEach(function (button) {
      button.onclick = function () {
        var next = button.dataset.stSubject;
        if (next === ui.subject) return;
        ui.subject = next;
        ui.filterPoint = null;          // 换科目时清掉知识点筛选，避免筛出空列表
        ui.drill = null;
        ui.session = null;
        ui.error = '';
        lastQueue = 0;
        loadQueue(true).then(function () { app.render(); });
        app.render();
      };
    });
    /* 热力图：点格子 = ①过滤下方复习队列 ②直接在当前页展开该知识点的原题列表
       （不再只是弹小窗或只过滤队列；原题列表就在格子下方展开） */
    root.querySelectorAll('[data-st-filter-point]').forEach(function (node) {
      node.onclick = function (event) {
        if (event && event.target && event.target.closest && event.target.closest('[data-st-drill-point]')) return;
        var point = node.dataset.stFilterPoint;
        var wasActive = ui.filterPoint === point;
        ui.filterPoint = wasActive ? null : point;
        var key = node.dataset.stCellKey;
        if (key) ui.drill = (wasActive && ui.drill && ui.drill.key === key) ? null : {key: key, origin: 'heat'};
        ui.error = '';
        app.render();
        setTimeout(function () {
          var drill = document.querySelector('.st-drill');
          var target = drill || document.querySelector('[data-st-queue-panel]') || document.querySelectorAll('.panel')[2];
          if (target && target.scrollIntoView) target.scrollIntoView({behavior: 'smooth', block: 'start'});
        }, 80);
      };
    });
    root.querySelectorAll('[data-st-filter-clear]').forEach(function (button) {
      button.onclick = function () { ui.filterPoint = null; app.render(); };
    });
    // 科目拖拽排序（顺序存本地偏好，刷新后还在）
    (function bindSubjectDrag() {
      var chips = Array.prototype.slice.call(root.querySelectorAll('[data-st-subject-chip]'));
      var dragSource = null;
      var clearHints = function () {
        chips.forEach(function (chip) { chip.classList.remove('drop-target', 'dragging'); });
      };
      chips.forEach(function (chip) {
        chip.addEventListener('dragstart', function (event) {
          dragSource = chip.dataset.stSubjectChip;
          chip.classList.add('dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            try { event.dataTransfer.setData('text/plain', dragSource); } catch (error) { /* 忽略 */ }
          }
        });
        chip.addEventListener('dragend', function () { dragSource = null; clearHints(); });
        chip.addEventListener('dragover', function (event) {
          event.preventDefault();
          if (dragSource && dragSource !== chip.dataset.stSubjectChip) chip.classList.add('drop-target');
        });
        chip.addEventListener('dragleave', function () { chip.classList.remove('drop-target'); });
        chip.addEventListener('drop', function (event) {
          event.preventDefault();
          var target = chip.dataset.stSubjectChip;
          clearHints();
          if (!dragSource || dragSource === target) return;
          var list = subjectOptions().slice();
          var from = list.indexOf(dragSource);
          var to = list.indexOf(target);
          if (from < 0 || to < 0) return;
          list.splice(from, 1);
          list.splice(to, 0, dragSource);
          saveSubjectOrder(list);
          dragSource = null;
          app.render();
        });
      });
    })();
    root.querySelectorAll('[data-st-subject-order-reset]').forEach(function (button) {
      button.onclick = function () { saveSubjectOrder([]); app.render(); };
    });
    // 就地展开错题列表（不跳底部）
    root.querySelectorAll('[data-st-drill-point]').forEach(function (node) {
      node.onclick = function (event) {
        if (event && event.stopPropagation) event.stopPropagation();
        var key = node.dataset.stDrillPoint;
        var origin = node.dataset.stDrillOrigin || 'top';
        if (ui.drill && ui.drill.key === key && ui.drill.origin === origin) ui.drill = null;
        else ui.drill = {key: key, origin: origin};
        app.render();
      };
    });
    root.querySelectorAll('[data-st-drill-close]').forEach(function (button) {
      button.onclick = function () { ui.drill = null; app.render(); };
    });
    root.querySelectorAll('[data-st-paper]').forEach(function (node) {
      node.addEventListener('toggle', function () {
        var parts = String(node.dataset.stPaper || '').split('|');
        if (parts.length !== 2) return;
        ui.openPaper[parts[0]] = ui.openPaper[parts[0]] || {};
        ui.openPaper[parts[0]][parts[1]] = node.open;
      });
    });
    root.querySelectorAll('[data-st-goto-case]').forEach(function (button) {
      button.onclick = function () { openCaseInLibrary(button.dataset.stGotoCase); };
    });
    root.querySelectorAll('[data-st-goto-library]').forEach(function (button) {
      button.onclick = function () { app.state.tab = 'library'; app.save(); app.render(); };
    });
    root.querySelectorAll('[data-st-radar]').forEach(function (button) {
      button.onclick = function () { ui.radarMode = button.dataset.stRadar; app.render(); };
    });

    // 开始复习（可带知识点）
    root.querySelectorAll('[data-st-start]').forEach(function (button) {
      button.onclick = function () { startReview(null); };
    });
    root.querySelectorAll('[data-st-start-point]').forEach(function (button) {
      button.onclick = function () { startReview(button.dataset.stStartPoint); };
    });

    // 翻到背面
    root.querySelectorAll('[data-st-reveal]').forEach(function (button) {
      button.onclick = function () {
        ui.reveal[button.dataset.stReveal] = true;
        loadHints(button.dataset.stReveal);
        app.render();
      };
    });
    root.querySelectorAll('[data-st-really]').forEach(function (button) {
      button.onclick = function () { submitRating(button.dataset.stReally, 3); };
    });
    root.querySelectorAll('[data-st-lost]').forEach(function (button) {
      button.onclick = function () { submitRating(button.dataset.stLost, 1, {forceRepeat: true}); };
    });
    root.querySelectorAll('[data-st-rate]').forEach(function (button) {
      button.onclick = function () { submitRating(button.dataset.stRate, Number(button.dataset.stValue)); };
    });
    root.querySelectorAll('[data-st-session-end]').forEach(function (button) {
      button.onclick = function () {
        var session = ui.session;
        var needs = session && session.records.some(function (record) { return record.rating <= 2; });
        var lastCardId = session && session.records.length ? session.records[session.records.length - 1].cardId : null;
        ui.session = null;
        if (needs && lastCardId) openUnderstanding(lastCardId, 'self_complete');
        else app.render();
      };
    });

    // 我的理解
    var text = root.querySelector('[data-st-under-text]');
    if (text) text.oninput = function () { ui.understanding.text = text.value; };
    root.querySelectorAll('[data-st-under-save]').forEach(function (button) {
      button.onclick = function () { saveUnderstanding(); };
    });
    root.querySelectorAll('[data-st-under-skip]').forEach(function (button) {
      button.onclick = function () { ui.understanding = null; app.render(); };
    });
    root.querySelectorAll('[data-st-under-close]').forEach(function (button) {
      button.onclick = function () { ui.understanding = null; app.render(); };
    });
  }

  function loadHints(cardId) {
    if (!cardId || ui.hints[cardId]) return;
    app.request('/v1/study/rating-hints/' + encodeURIComponent(cardId))
      .then(function (result) { ui.hints[cardId] = result.hints || []; app.render(); })
      .catch(function () { /* 提示拿不到不影响评分 */ });
  }

  function submitRating(cardId, rating, options) {
    if (!cardId || !rating) return;
    app.request('/v1/study/review', {method: 'POST', body: JSON.stringify({cardId: cardId, rating: rating})})
      .then(function (result) {
        var session = ui.session;
        if (session) {
          session.records.push({cardId: cardId, rating: rating, repeat: result.repeat, intervalDays: result.intervalDays});
          if (result.repeat || (options && options.forceRepeat)) {
            session.ids.push(cardId);           // 评分 <= 2：本轮再练一次
          }
          session.ids.splice(session.ids.indexOf(cardId), 1);
          session.index = 0;
          if (session.ids.length) {
            ui.reveal[cardId] = false;
            loadHints(session.ids[0]);
          }
        }
        delete ui.reveal[cardId];
        ui.hints[cardId] = null;
        if (rating <= 2) {
          var item = (ui.queue.items || []).find(function (entry) { return entry.id === cardId; });
          if (item && !ui.understanding) {
            ui.understanding = {
              knowledgePoint: item.knowledgePoint,
              trigger: 'self_complete',
              triggerLabel: '这次卡住了，正适合讲清楚',
              text: '',
              placeholder: '用一句话说清楚它到底在解决什么问题……',
              saved: false
            };
          }
        }
        ui.error = '';
        // 评分同时改变掌握度；队列和热力图摘要必须一同刷新。
        lastQueue = 0;
        lastSummary = 0;
        loadAll(true).then(function () { app.render(); });
      })
      .catch(function (error) { ui.error = '评分提交失败：' + error.message; app.render(); });
  }

  function openUnderstanding(cardId, trigger) {
    var item = (ui.queue && ui.queue.items || []).find(function (entry) { return entry.id === cardId; });
    ui.understanding = {
      knowledgePoint: (item && item.knowledgePoint) || '',
      trigger: trigger || 'self_complete',
      triggerLabel: '复习完成',
      text: '',
      placeholder: '用你自己的话把它讲一遍……',
      saved: false
    };
    app.render();
  }

  function saveUnderstanding() {
    var state = ui.understanding;
    if (!state) return;
    var value = String(state.text || '').trim();
    if (value.length < 8) { ui.error = '再多写一点，至少要让人看懂你的思路。'; return app.render(); }
    busy = true; ui.error = '';
    app.request('/v1/study/understanding', {
      method: 'POST',
      body: JSON.stringify({text: value, knowledgePoint: state.knowledgePoint, trigger: state.trigger || 'self_complete'})
    }).then(function () {
      busy = false;
      state.saved = true;
      lastQueue = 0;
      loadAll(true).then(function () { app.render(); });
    }).catch(function (error) {
      busy = false;
      ui.error = '保存失败：' + error.message; app.render();
    });
  }

  /* ---------------- 注册 ---------------- */
  /* 底部导航里合并成一个入口：归纳 · 复习（不再有平行 Tab） */
  function ensureTab() {
    var nav = document.querySelector('.tabs');
    if (!nav) return;
    var old = nav.querySelector('[data-tab="study"]');
    if (old) old.remove();
    var combined = nav.querySelector('[data-tab="clusters"] span');
    if (combined) combined.textContent = '归纳·复习';
  }

  /* 每次点底部的「归纳·复习」都强制刷新一次队列（复习完回来要看到前移） */
  document.addEventListener('click', function (event) {
    var node = event.target;
    while (node && node !== document) {
      if (node.dataset && node.dataset.tab === 'clusters') { ui.stale = true; lastQueue = 0; lastSummary = 0; break; }
      node = node.parentNode;
    }
  }, true);

  var feature = {
    activate: function (context) {
      app = context;
      ensureTab();
      loadAll(true).then(function () {
        if (app.state.tab === 'home' || app.state.tab === 'clusters') app.render();
      });
    },
    decorateHome: decorateHome,
    renderStudy: renderStudy
  };

  if (window.__registerStudyInsights) window.__registerStudyInsights(feature);
})();
