/* 错题编辑 / 删除（独立模块）
 *
 * 接入方式：index.html 里的 window.__registerMistakeEditor(feature)
 *
 * 只在错题库列表的每张卡片上「追加」两个按钮（编辑 / 删除），
 * 点开是一个独立浮层表单。刻意不改动 renderLibrary / mistakeHtml 的原有渲染逻辑，
 * 避免与正在并行修改错题库的代码冲突。
 *
 * 后端：server/workflows/mistake-admin-routes.mjs
 *   PATCH  /v1/mistake-cases/:id
 *   DELETE /v1/mistake-cases/:id
 */
(function () {
  'use strict';

  var app = null;
  var busy = false;

  var ui = {
    overlay: null,     // 当前打开的编辑浮层
    error: '',
    toast: '',
    banner: ''         // 删除后的持久提示（render 会清空 .work，所以在这里补回页面顶部）
  };

  var SUBJECTS = ['数学', '物理', '化学', '生物', '语文', '英语', '历史', '地理', '政治'];
  var QUESTION_TYPES = ['选择题', '填空题', '解答题', '证明题', '计算题', '作图题'];

  /* ---------------- 样式 ---------------- */
  var style = document.createElement('style');
  style.textContent = [
    '.me-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}',
    '.me-actions button{padding:6px 12px;font-size:13px}',
    '.me-actions .me-danger{color:#c0392b;border-color:#f0c4bf}',
    '.me-actions [data-me-rebuild]{font-weight:600}',
    '.me-detail-actions{margin:10px 0 4px}',
    '.me-detail-actions button{padding:7px 14px;font-size:13.5px}',
    '.me-panel [data-me-rebuild-text]{width:100%;min-height:130px;margin-top:10px;padding:10px;border:1px solid #d7e1f2;border-radius:12px;font-family:inherit;line-height:1.6}',
    '.me-note{font-size:12px;color:#65738b;margin:8px 0 0}',
    '.me-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto}',
    '.me-panel{background:#fff;border-radius:18px;max-width:720px;width:100%;padding:20px;box-shadow:0 24px 60px rgba(15,23,42,.28)}',
    '.me-panel h2{margin:2px 0 4px}',
    '.me-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}',
    '.me-grid label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:#4a5568}',
    '.me-grid .me-wide{grid-column:1/-1}',
    '.me-grid input,.me-grid select,.me-grid textarea{padding:8px 10px;border:1px solid #d7e1f2;border-radius:10px;font-size:14px;font-family:inherit}',
    '.me-grid textarea{min-height:88px;resize:vertical}',
    '.me-hint{font-size:12px;color:#8593a8;margin-top:2px}',
    '.me-foot{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}',
    '.me-error{background:#fdeef0;color:#a83a4a;border-radius:10px;padding:10px;margin-top:12px;font-size:13px}',
    '.me-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#10203a;color:#fff;padding:10px 18px;border-radius:999px;z-index:9100;font-size:14px}',
    '.me-3d{display:inline-block;font-size:12px;border-radius:999px;padding:2px 8px;margin-right:6px;vertical-align:1px;white-space:nowrap}',
    '.me-3d.ok{background:#eefaf1;color:#1f7a45;border:1px solid #b7e3c8}',
    '.me-3d.ref{background:#fff7e8;color:#a8641a;border:1px solid #f0d9b0}',
    '.me-3d.none{background:#f2f4f8;color:#8593a8;border:1px solid #e0e6f0}',
    '.me-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#eefaf1;border:1px solid #b7e3c8}',
    '.me-banner b{color:#1f7a45}',
    '.me-banner span{flex:1;font-size:14px;color:#2c4a38}',
    '.me-banner em{font-style:normal;font-size:12px;color:#5f7a6a}',
    /* 没有模型时不再插占位卡片；这一条只给「正在生成中」的进度面板用 */
    '.geometry-scene.me-3d-building{border:1px solid #b8cae5;background:#f5f9ff}',
    '.me-building-body{display:flex;gap:12px;align-items:flex-start}',
    '.me-building-body .me-note{margin:6px 0 0}',
    '.me-building-spinner{flex:0 0 auto;width:18px;height:18px;margin-top:2px;border:3px solid #c9d9f2;border-top-color:#3369e8;border-radius:50%;animation:me-3d-spin 0.9s linear infinite}',
    '@keyframes me-3d-spin{to{transform:rotate(360deg)}}',
    '@media(prefers-reduced-motion:reduce){.me-building-spinner{animation:none}}',
    '.me-webgl-warn{background:#fdeef0;border:1px solid #f0c4bf;color:#8f2f3d}',
    '.me-webgl-warn b{color:#a83a4a}',
    '.me-webgl-warn span{flex:1;font-size:14px;line-height:1.7}',
    /* 3D 自检：在用户自己的浏览器里实测一遍，用来定位"3D 面板为什么没出现" */
    '.me-diag-row{display:flex;gap:10px;padding:7px 0;border-bottom:1px dashed #e6ebf3;font-size:13px;align-items:flex-start}',
    '.me-diag-row:last-child{border-bottom:0}',
    '.me-diag-row b{min-width:124px;flex:0 0 124px;color:#4a5568;font-weight:600}',
    '.me-diag-row span{flex:1;word-break:break-word;color:#22314a;line-height:1.55}',
    '.me-diag-row span.ok{color:#1f7a45}',
    '.me-diag-row span.bad{color:#a83a4a;font-weight:600}',
    '.me-diag-verdict{margin-top:12px;padding:10px 12px;border-radius:10px;background:#f4f8ff;border:1px solid #d7e1f2;font-size:13px;color:#33415c;line-height:1.7}',
    '.me-quote{background:#f8fbff;border-left:4px solid #8fb2ff;border-radius:10px;padding:12px;font-size:14px;color:#33415c;line-height:1.6;margin-top:10px}',
    '.me-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}',
    '.me-chips span{font-size:12px;background:#eef3ff;color:#3158b8;border-radius:999px;padding:2px 8px}',
    '@media(max-width:640px){.me-grid{grid-template-columns:1fr}}'
  ].join('');
  document.head.appendChild(style);

  function e(value) { return app.esc(String(value == null ? '' : value)); }
  function listText(value) { return Array.isArray(value) ? value.join('、') : String(value == null ? '' : value); }

  /* ---------------- 提示 ---------------- */
  function toast(message, duration) {
    var node = document.createElement('div');
    node.className = 'me-toast';
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(function () { node.remove(); }, Number(duration) || 2400);
  }

  /* ---------------- 编辑浮层 ---------------- */
  function closeEditor() {
    if (ui.overlay) { ui.overlay.remove(); ui.overlay = null; }
    ui.error = '';
  }

  function openEditor(caseId) {
    var record = (app.state.mistakes || []).find(function (item) { return item.id === caseId; })
      || (app.state.__serverMistakes || []).find(function (item) { return item.id === caseId; });
    if (!record) { toast('找不到这道错题，请刷新后重试'); return; }
    closeEditor();

    var overlay = document.createElement('div');
    overlay.className = 'me-overlay';
    overlay.innerHTML = [
      '<div class="me-panel" role="dialog" aria-label="编辑错题">',
      '  <div class="head"><div><span class="pill">编辑错题</span><h2>修改学科与题目标识</h2>',
      '  <p class="muted">只影响这道题的分类信息，3D 模型与验证结果不会被改动。</p></div></div>',
      '  <div class="me-grid">',
      '    <label>学科<select data-me="subject">',
      SUBJECTS.map(function (s) { return '<option ' + (record.subject === s ? 'selected' : '') + '>' + e(s) + '</option>'; }).join(''),
      '    </select></label>',
      '    <label>单元 / 章节<input data-me="unit" value="' + e(record.unit || '') + '" placeholder="例如：空间几何"></label>',
      '    <label>题型<select data-me="questionType">',
      '<option value="" ' + (!record.questionType ? 'selected' : '') + '>（未标注）</option>',
      QUESTION_TYPES.map(function (t) { return '<option ' + (record.questionType === t ? 'selected' : '') + '>' + e(t) + '</option>'; }).join(''),
      '    </select></label>',
      '    <label>知识点<span class="me-hint">用顿号或逗号分隔，会被当作「题目标识」</span>',
      '      <input data-me="knowledgePoints" value="' + e(listText(record.knowledgePoints)) + '" placeholder="线面角、法向量"></label>',
      '    <label class="me-wide">微技能<span class="me-hint">同样用顿号或逗号分隔</span>',
      '      <input data-me="microSkills" value="' + e(listText(record.microSkills)) + '" placeholder="建系、夹角转换"></label>',
      '    <label class="me-wide">错因<span class="me-hint">决定归纳页「错因分布」饼图，用顿号或逗号分隔</span>',
      '      <input data-me="errorCauses" value="' + e(listText(record.errorCauses)) + '" placeholder="概念混淆、计算失误"></label>',
      '    <label class="me-wide">题干<textarea data-me="question">' + e(record.question || '') + '</textarea></label>',
      '    <label class="me-wide">我的作答（可选）<textarea data-me="studentAnswer">' + e(record.studentAnswer || '') + '</textarea></label>',
      '  </div>',
      '  <div class="me-error" data-me-error hidden></div>',
      '  <div class="me-foot">',
      '    <button data-me-cancel>取消</button>',
      '    <button class="primary" data-me-save ' + (busy ? 'disabled' : '') + '>保存修改</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);
    ui.overlay = overlay;

    overlay.addEventListener('click', function (event) { if (event.target === overlay) closeEditor(); });
    overlay.querySelector('[data-me-cancel]').onclick = closeEditor;
    overlay.querySelector('[data-me-save]').onclick = function () { saveEditor(record.id, overlay); };
    var first = overlay.querySelector('[data-me="subject"]');
    if (first) first.focus();
  }

  function collect(overlay) {
    var patch = {};
    overlay.querySelectorAll('[data-me]').forEach(function (field) {
      patch[field.dataset.me] = field.value;
    });
    return patch;
  }

  function saveEditor(caseId, overlay) {
    if (busy) return;
    var patch = collect(overlay);
    var errorBox = overlay.querySelector('[data-me-error]');
    if (!String(patch.question || '').trim()) {
      errorBox.hidden = false;
      errorBox.textContent = '题干不能为空。';
      return;
    }
    busy = true;
    errorBox.hidden = true;
    app.request('/v1/mistake-cases/' + encodeURIComponent(caseId), {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }).then(function (result) {
      busy = false;
      // 同步本地列表，避免整页重新拉取
      var updated = result && result.case;
      if (updated) {
        var lists = [app.state.mistakes, app.state.__serverMistakes];
        lists.forEach(function (list) {
          if (!Array.isArray(list)) return;
          var index = list.findIndex(function (item) { return item.id === caseId; });
          if (index >= 0) list[index] = Object.assign({}, list[index], updated);
        });
      }
      closeEditor();
      app.save();
      app.render();
      toast('已保存修改');
    }).catch(function (error) {
      busy = false;
      errorBox.hidden = false;
      errorBox.textContent = '保存失败：' + error.message;
    });
  }

  /* ---------------- 删除 ---------------- */
  /* ---------------- 重新生成 3D 模型 ---------------- */
  function openRebuild(caseId, record) {
    if (busy) return;
    var existing = document.querySelector('[data-me-rebuild-overlay]');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.className = 'me-overlay';
    overlay.setAttribute('data-me-rebuild-overlay', '');
    overlay.innerHTML = '<div class="me-panel">'
      + '<div class="head"><div><span class="pill">重新生成模型</span><h2>先确认题干，再建模</h2></div></div>'
      + '<p class="muted">建模完全依据下面这段题干。如果当初是语音识别错的（例如 a1B1、2ae 这种），'
      + '先在这里改对再生成；题干不清楚时模型一定建不出来。</p>'
      + '<p class="muted">点开始后可以离开这一页去做别的：模型会在后台生成，好了自动出现在这道题上。</p>'
      + '<textarea data-me-rebuild-text>' + e(String((record && record.question) || '')) + '</textarea>'
      + '<div class="me-error" data-me-rebuild-error hidden></div>'
      + '<div class="me-foot"><button data-me-rebuild-cancel>取消</button>'
      + '<button class="primary" data-me-rebuild-go>开始在后台生成</button></div>'
      + '</div>';
    document.body.appendChild(overlay);

    var close = function () { overlay.remove(); };
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    overlay.querySelector('[data-me-rebuild-cancel]').onclick = close;

    overlay.querySelector('[data-me-rebuild-go]').onclick = function () {
      var button = overlay.querySelector('[data-me-rebuild-go]');
      var errorBox = overlay.querySelector('[data-me-rebuild-error]');
      var text = String(overlay.querySelector('[data-me-rebuild-text]').value || '').trim();
      if (!text) { errorBox.hidden = false; errorBox.textContent = '题干不能为空。'; return; }
      button.disabled = true;
      button.textContent = '正在提交…';
      errorBox.hidden = true;
      /* 后台生成：不再让学生盯着「请不要关闭页面」。
         提交后立刻关掉浮层，卡片显示「正在生成中」，生成完自动出现。
         换页、看别的错题、甚至刷新浏览器都不影响——服务端自己跑完并落盘。 */
      app.request('/v1/mistake-cases/' + encodeURIComponent(caseId) + '/rebuild-model', {
        method: 'POST',
        // 旧版错题可能只在当前浏览器里。让服务端按同一 ID 原位导入，
        // 再建模；只传题目与学习进度所需字段，不上传本机其他记录。
        body: JSON.stringify({background: true, question: text, localCase: {
          id: caseId,
          question: text,
          subject: record && record.subject,
          unit: record && record.unit,
          questionType: record && record.questionType,
          studentAnswer: record && record.studentAnswer,
          knowledgePoints: record && record.knowledgePoints,
          microSkills: record && record.microSkills,
          errorCauses: record && record.errorCauses,
          createdAt: record && record.createdAt,
          learningProfile: record && record.learningProfile
        }})
      }).then(function (result) {
        close();
        var pending = Object.assign({}, record, (result && result.case) || {}, {
          geometryBuildStatus: 'building',
          geometryModelRequested: true,
          modelMessage: (result && result.message) || '正在后台生成 3D 模型，可以先去别的地方。'
        });
        markBuilding(pending);
        toast('已在后台开始生成 3D 模型，你可以先去别的地方；生成好会自动出现在这道题上。', 6000);
      }).catch(function (error) {
        button.disabled = false;
        button.textContent = '重试生成';
        errorBox.hidden = false;
        errorBox.textContent = String((error && error.message) || error);
      });
    };
  }

  /* 把一条记录标成「正在生成中」，并交给 wrong-question-entry 的轮询去收尾。
     收尾逻辑（每 5 秒查一次、有模型或失败就停）已在那边实现，这里不重复写。 */
  function markBuilding(record) {
    [app.state.mistakes, app.state.__serverMistakes].forEach(function (list) {
      if (!Array.isArray(list)) return;
      var index = list.findIndex(function (item) { return item.id === record.id; });
      if (index >= 0) list[index] = Object.assign({}, list[index], record);
      else list.unshift(record);
    });
    app.save();
    app.render();
    if (typeof window.__wqWatchGeometryBuild === 'function') window.__wqWatchGeometryBuild(record.id);
  }

  function deleteCase(caseId) {
    var record = (app.state.mistakes || []).find(function (item) { return item.id === caseId; });
    var label = String((record && record.question) || caseId).slice(0, 40);
    if (busy) return;
    /* 用自绘确认浮层替代 window.confirm：
       原生 confirm 是同步阻塞的，且会被部分浏览器/插件直接禁用或拦截，
       那时 confirm() 返回 false，删除静默失效 —— 表现出来就是「删除失败」。 */
    var existing = document.querySelector('[data-me-confirm-overlay]');
    if (existing) existing.remove();
    var confirmBox = document.createElement('div');
    confirmBox.className = 'me-overlay';
    confirmBox.setAttribute('data-me-confirm-overlay', '');
    confirmBox.innerHTML = '<div class="me-panel" style="max-width:540px">'
      + '<div class="head"><div><span class="pill">确认删除</span><h2>删除这道错题？</h2></div></div>'
      + '<div class="me-quote">' + e(label) + '</div>'
      + '<ul class="muted" style="font-size:13px;line-height:1.9;margin:12px 0 0 18px">'
      + '<li>关联的 AI 陪练会话会一并清理</li>'
      + '<li>由它生成的知识卡只会解除来源引用，<b>不会被删除</b></li>'
      + '<li>此操作不可撤销</li>'
      + '</ul>'
      + '<div class="me-error" data-me-del-error hidden></div>'
      + '<div class="me-foot"><button data-me-del-cancel>取消</button>'
      + '<button class="me-danger" data-me-del-confirm>确认删除</button></div>'
      + '</div>';
    document.body.appendChild(confirmBox);

    var close = function () { confirmBox.remove(); };
    confirmBox.addEventListener('click', function (event) { if (event.target === confirmBox) close(); });
    confirmBox.querySelector('[data-me-del-cancel]').onclick = close;

    confirmBox.querySelector('[data-me-del-confirm]').onclick = function () {
      var button = confirmBox.querySelector('[data-me-del-confirm]');
      var errorBox = confirmBox.querySelector('[data-me-del-error]');
      button.disabled = true;
      button.textContent = '正在删除…';
      errorBox.hidden = true;
      busy = true;
      app.request('/v1/mistake-cases/' + encodeURIComponent(caseId), {method: 'DELETE'})
        .then(function (result) {
          busy = false;
          closeEditor();
          close();
          var drop = function (list) {
            if (!Array.isArray(list)) return list;
            return list.filter(function (item) { return item.id !== caseId; });
          };
          app.state.mistakes = drop(app.state.mistakes);
          if (Array.isArray(app.state.__serverMistakes)) app.state.__serverMistakes = drop(app.state.__serverMistakes);
          app.state.libraryDetailId = app.state.libraryDetailId === caseId ? null : app.state.libraryDetailId;
          app.state.focusMistakeId = app.state.focusMistakeId === caseId ? null : app.state.focusMistakeId;
          app.save();
          // 明确反馈：删掉的是哪一道，以及列表为什么会「看起来没变」
          ui.banner = '「' + label + '」已从错题库移除'
            + (result && result.removedSessions ? '，并清理了 ' + result.removedSessions + ' 条陪练会话' : '')
            + (result && result.detachedCards ? '，' + result.detachedCards + ' 张知识卡解除了来源引用' : '');
          app.render();
          toast('已删除「' + label + '」', 4000);
        })
        .catch(function (error) {
          // 失败时留在浮层里，把原因说清楚，不要静默关掉
          busy = false;
          button.disabled = false;
          button.textContent = '重试删除';
          errorBox.hidden = false;
          errorBox.textContent = '删除失败：' + error.message + '。这条记录还在，可以直接重试。';
        });
    };

    var confirmButton = confirmBox.querySelector('[data-me-del-confirm]');
    if (confirmButton) confirmButton.focus();
  }

  /* ---------------- 没有模型时，在同一个位置占住 3D 面板 ----------------
  /* ---------------- 没有模型时不再占位（原来那张大卡片已删除） ----------------
     失败原因放到卡片上的状态标记悬停提示里，重新生成按钮仍在 me-actions。 */
  var MODEL_STATUS_TEXT = {
    needs_more_context: '旧版解析曾判为条件不足；语音或 OCR 错字也可能造成误判，请核对题干后重新生成。',
    model_unsupported: '这道题超出了当前建模器的范围（可能是非空间几何题，或题型暂不支持）。',
    provider_unavailable: '调用 AI 建模服务时连不上（网络或服务临时不可用）。',
    provider_pending_retry: 'AI 建模服务响应超时，后台还在自动重试。',
    provider_auth_failed: 'AI 建模服务的密钥无效或已过期。',
    provider_billing_required: 'AI 建模服务账户余额不足。',
    provider_rate_limited: 'AI 建模服务被限流，过一会儿重试即可。',
    model_parse_failed: 'AI 返回的内容没法解析成坐标。',
    model_evidence_failed: 'AI 给出的坐标没通过几何校验。',
    model_validation_failed: '生成的模型与题意不一致，已被拦下。'
  };

  function missingModelBadge(record) {
    var status = record && record.modelStatus;
    if (status === 'provider_unavailable' || status === 'provider_pending_retry'
      || status === 'provider_auth_failed' || status === 'provider_billing_required'
      || status === 'provider_rate_limited') return '当时 AI 服务失败';
    if (status === 'model_unsupported' || status === 'unsupported') return '旧引擎未覆盖';
    if (status === 'needs_more_context') return '旧解析未建模';
    return '本条无 3D 数据';
  }

  /* 判断这道题是不是立体几何题：不是的话"没有 3D 模型"本来就应该，不该吓得用户以为坏了。 */
  var SOLID_HINTS = /棱柱|棱锥|棱台|正方体|长方体|四面体|多面体|圆柱|圆锥|圆台|球面|球体|空间|立体|体积|表面积|二面角|异面|线面角|面面角|三视图|直三棱|正四棱|平面\s*[A-Z]|垂直|平行六面体/;

  function looksLikeSolidGeometry(record) {
    if (!record) return true;                       // 不知道就按几何题处理，给出修复入口
    if (record.geometryResult && record.geometryResult.scene) return true;
    var text = [record.question, record.unit, Array.isArray(record.knowledgePoints) ? record.knowledgePoints.join(' ') : '']
      .filter(Boolean).join(' ');
    return SOLID_HINTS.test(text);
  }

  /* 没有模型时的悬停说明：一句话讲清原因，替代原来那张大卡片。 */
  function missingModelReason(record) {
    var status = record && (record.modelStatus || (record.geometryResult && record.geometryResult.failureCode));
    var why = MODEL_STATUS_TEXT[status]
      || '这道题当初录入时建模没有成功。最常见的原因是题干在录入（尤其是语音输入）时出错，例如符号变成了乱码。';
    if (!looksLikeSolidGeometry(record)) return '这道题不属于立体几何，不需要 3D 模型。' + why;
    return why;
  }

  /* 只有「正在生成中」才占住 3D 面板的位置：生成完才有挂载点，不用刷新。 */
  function insertBuildingPanel(card, caseId, record) {
    var tutor = card.querySelector('.tutor');
    if (!tutor || !tutor.parentNode) return;
    if (card.querySelector('.geometry-scene')) return;
    if (!record || (record.geometryBuildStatus !== 'queued' && record.geometryBuildStatus !== 'building')) return;
    var building = document.createElement('section');
    building.className = 'geometry-scene me-3d-building';
    building.setAttribute('data-me-3d-building', caseId);
    building.innerHTML = '<div class="head"><b>AI 空间模型</b><span class="pill">正在生成中</span></div>'
      + '<div class="me-building-body"><span class="me-building-spinner" aria-hidden="true"></span>'
      + '<div><b>' + e(record.modelMessage || '题目已保存，正在后台生成 3D 模型…') + '</b>'
      + '<p class="me-note">这道题已经进入错题库，下面的 AI 陪练、得分点和复习计划现在就能用。'
      + '模型生成好后会自动出现在这里，不用刷新，也不用再点一次「重新生成」。</p></div></div>';
    tutor.parentNode.insertBefore(building, tutor);
  }

  /* ---------------- 浏览器层面能不能做 3D ----------------
     如果 WebGL 被关掉，所有画布都会退化成静态示意图；这时必须明说，
     否则用户会以为是我们把功能改坏了。 */
  var webglSupport = null;
  function webglUsable() {
    if (webglSupport !== null) return webglSupport;
    try {
      var probe = document.createElement('canvas');
      webglSupport = Boolean(window.WebGLRenderingContext
        && (probe.getContext('webgl2') || probe.getContext('webgl')));
    } catch (error) { webglSupport = false; }
    return webglSupport;
  }

  function warnIfNoWebGL(view) {
    if (webglUsable()) return;
    if (view.querySelector('[data-me-webgl-warn]')) return;
    var node = document.createElement('section');
    node.className = 'panel me-banner me-webgl-warn';
    node.setAttribute('data-me-webgl-warn', '');
    node.innerHTML = '<b>这个浏览器没有开启 3D 渲染</b>'
      + '<span>浏览器报告 WebGL 不可用，所以所有可旋转的 3D 面板都会显示成静态示意图。'
      + '常见原因是浏览器设置里关掉了「使用硬件加速」，或者显卡驱动被浏览器列入黑名单。'
      + '在地址栏打开 edge://gpu（Chrome 是 chrome://gpu）能看到具体原因；'
      + '开启「使用硬件加速」后完全重启浏览器即可恢复。</span>'
      + '<button data-me-webgl-close>知道了</button>';
    view.insertBefore(node, view.firstChild);
    node.querySelector('[data-me-webgl-close]').onclick = function () { node.remove(); };
  }

  /* ---------------- 挂载失败时，把原因直接写进面板 ----------------
     以前失败是静默的：用户要么看到一个不会转的静态图，要么以为面板"消失"了。
     现在把真实原因写在面板里，再配合工具栏的「3D 自检」定位。
     注意：enhancement 层会在 three.js 就绪后重新赋值 __mountDeterministicThree，
     所以这里做成"每次渲染时按需包一层"，而不是脚本加载时包一次。 */
  function annotateMountFailure(container, reason) {
    if (!container || !container.closest) return;
    var scene = container.closest('.geometry-scene');
    if (!scene) return;
    var note = scene.querySelector('[data-me-mount-failure]');
    if (!note) {
      note = document.createElement('p');
      note.className = 'me-note';
      note.setAttribute('data-me-mount-failure', '');
      note.style.color = '#a8641a';
      scene.appendChild(note);
    }
    var text = webglUsable()
      ? '3D 模型这次没能挂载成可旋转画布' + (reason ? '（' + reason + '）' : '')
        + '。可以点「启用可旋转 3D 模型」重试；如果一直不行，点工具栏的「3D 自检」，'
        + '它会在你这台电脑上实测并说明原因。'
      : '这台电脑的浏览器没有开启 3D 渲染（WebGL 不可用），所以这里只能显示静态示意图。'
        + '在浏览器设置里打开「使用硬件加速」，然后完全退出浏览器再重开即可恢复。';
    if (note.textContent !== text) note.textContent = text;
  }

  var wrappedMount = null;
  function ensureMountWrapped() {
    var inner = window.__mountDeterministicThree;
    if (typeof inner !== 'function' || inner === wrappedMount) return;
    var previous = inner;
    var wrapped = function (container, result) {
      try {
        var ok = previous.apply(this, arguments);
        if (!ok) annotateMountFailure(container, '');
        return ok;
      } catch (error) {
        annotateMountFailure(container, String((error && error.message) || error));
        return false;
      }
    };
    wrapped.__meWrapped = true;
    window.__mountDeterministicThree = wrapped;
    wrappedMount = wrapped;
  }

  /* ---------------- 3D 自检 ----------------
     用一句话说清"3D 面板为什么没出来"。学生/老师只要点一下再截图，
     就能区分是浏览器没有 WebGL、three.js 没加载，还是这道题缺模型数据。 */
  function describeCoords(result) {
    var src = result.__normalizedCoordinates || result.canonicalCoordinates
      || result.finalCoordinates || result.candidateCoordinates;
    if (!src || typeof src !== 'object') return '缺少坐标';
    var names = Object.keys(src);
    if (!names.length) return '坐标是空的';
    var kinds = {};
    names.forEach(function (name) {
      var point = src[name];
      if (!Array.isArray(point)) { kinds['不是数组'] = (kinds['不是数组'] || 0) + 1; return; }
      point.forEach(function (value) {
        var kind = typeof value === 'number' ? '普通数字'
          : (value && value.op ? '表达式节点(' + value.op + ')' : '未知格式');
        kinds[kind] = (kinds[kind] || 0) + 1;
      });
    });
    var detail = Object.keys(kinds).map(function (k) { return k + ' × ' + kinds[k]; }).join('，');
    return names.length + ' 个点（' + names.slice(0, 8).join('、') + (names.length > 8 ? '…' : '') + '）；坐标格式：' + detail;
  }

  function findRecord(caseId) {
    var state = (app && app.state) || {};
    var list = state.mistakes || state.__serverMistakes || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === caseId) return list[i];
    return null;
  }

  async function collectDiagnostics() {
    var rows = [];
    function add(label, value, tone) { rows.push({label: label, value: String(value), tone: tone || ''}); }

    add('页面地址', location.href);
    add('浏览器', navigator.userAgent);
    add('窗口 / 缩放', innerWidth + ' × ' + innerHeight + ' · DPR ' + devicePixelRatio);

    /* three.js 是否真的加载成功 */
    var three = window.__THREE || null;
    var ready = null;
    try {
      ready = await Promise.race([
        Promise.resolve(window.__eduThreeReady),
        new Promise(function (resolve) { setTimeout(function () { resolve('__timeout__'); }, 4000); })
      ]);
    } catch (error) { ready = null; }
    if (three) {
      add('three.js 库', '已加载 · r' + three.REVISION, 'ok');
    } else if (ready === '__timeout__') {
      add('three.js 库', '4 秒内还没加载完（网络或模块加载被拦住）', 'bad');
    } else {
      add('three.js 库', '没有加载成功，three.module.js 可能被拦截或缺失', 'bad');
    }

    /* WebGL 是否可用 */
    var webglText = '不可用', webglTone = 'bad';
    try {
      var probe = document.createElement('canvas');
      var gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (gl) {
        var ext = gl.getExtension('WEBGL_debug_renderer_info');
        var gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '（浏览器未提供显卡信息）';
        webglText = '可用 · ' + gpu;
        webglTone = 'ok';
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } else {
        webglText = '不可用（浏览器拒绝创建 WebGL 上下文，通常是关掉了「使用硬件加速」）';
      }
    } catch (error) { webglText = '不可用：' + (error && error.message); }
    add('WebGL / 3D 渲染', webglText, webglTone);

    /* 页面上的舞台 */
    var stages = document.querySelectorAll('.three-stage');
    var canvases = document.querySelectorAll('.three-stage canvas');
    add('3D 舞台 / 画布', stages.length + ' 个舞台 · ' + canvases.length + ' 个已生成画布',
      canvases.length ? 'ok' : (stages.length ? 'bad' : ''));

    /* 当前打开的这道题 */
    var state = (app && app.state) || {};
    var activeId = document.querySelector('[data-case-three]');
    var caseId = (activeId && activeId.getAttribute('data-case-three')) || state.focusMistakeId || state.libraryDetailId;
    add('当前题目 ID', caseId || '（当前没有打开任何错题）');
    var record = caseId ? findRecord(caseId) : null;
    var result = record && record.geometryResult;
    add('这道题的模型数据', result && result.scene ? '有 scene' : '没有 scene（所以只会显示说明面板）',
      result && result.scene ? 'ok' : 'bad');
    if (result) {
      add('solverStatus', result.solverStatus || '（空）');
      var grid = result.scene && result.scene.grid;
      add('单位网格', grid
        ? ('unit=' + grid.unit + ' · size=' + grid.size + ' · divisions=' + grid.divisions + ' · 来源=' + grid.valueSource)
        : '缺少 grid');
      add('坐标格式', describeCoords(result),
        /普通数字/.test(describeCoords(result)) ? '' : 'ok');
    }
    var stage = document.querySelector('.three-stage');
    add('舞台已记住结果', stage && stage.__geometryResult ? '是' : '否');
    add('可旋转控制器', stage && stage.__geometryController ? '已创建（能旋转缩放）' : '未创建（就是它导致看不到模型）',
      stage && stage.__geometryController ? 'ok' : 'bad');

    /* 结论 */
    var hasWebgl = webglTone === 'ok';
    var hasThree = Boolean(three);
    var hasController = Boolean(stage && stage.__geometryController);
    var verdict;
    if (!hasWebgl) {
      verdict = '结论：这个浏览器没有可用的 WebGL，所有 3D 画布都会退化成静态示意图。'
        + '请在浏览器设置里打开「使用硬件加速」（Edge/Chrome：设置 → 系统和性能 → 使用硬件加速），'
        + '然后在地址栏打开 edge://gpu（Chrome 用 chrome://gpu）确认为「Hardware accelerated」，完全退出浏览器再重开。';
    } else if (!hasThree) {
      verdict = '结论：WebGL 正常，但 three.js 没加载成功。请确认服务目录里的 three.module.js 存在，'
        + '并检查浏览器是否拦截了 .js 模块请求（广告拦截插件、公司代理、Content-Security-Policy 都可能拦）。';
    } else if (!hasController && result && result.scene) {
      verdict = '结论：环境没问题，是这道题的模型数据没能挂载成画布。把这一页截图发我，'
        + '重点看「坐标格式」那一行。';
    } else if (hasController) {
      verdict = '结论：3D 渲染链路完全正常——three.js、WebGL、画布和可旋转控制器都到位了。'
        + '如果你还是看不到模型，请把窗口调大或向下滚动，模型面板就在题目下方、「AI 陪我拆解」上方。';
    } else {
      verdict = '结论：当前没有打开带模型的错题。请先在上面的列表里点一张带「◌ 3D 可交互」标签的卡片，再点一次「3D 自检」。';
    }
    return {rows: rows, verdict: verdict};
  }

  function openDiagnostics() {
    var existing = document.querySelector('[data-me-diag-overlay]');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.className = 'me-overlay';
    overlay.setAttribute('data-me-diag-overlay', '');
    overlay.innerHTML = '<div class="me-panel"><h2>3D 自检</h2>'
      + '<p class="me-note">在你现在这个浏览器里实测一遍，用来判断 3D 面板为什么没出现。把这一页截图发我即可。</p>'
      + '<div data-me-diag-body><p class="me-note">正在检测…</p></div>'
      + '<div class="me-foot"><button data-me-diag-copy>复制结果</button>'
      + '<button class="primary" data-me-diag-close>关闭</button></div></div>';
    document.body.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.querySelector('[data-me-diag-close]').onclick = close;
    overlay.onclick = function (event) { if (event.target === overlay) close(); };

    collectDiagnostics().then(function (report) {
      var body = overlay.querySelector('[data-me-diag-body]');
      if (!body) return;                                   // 用户已经关掉了
      body.innerHTML = report.rows.map(function (row) {
        return '<div class="me-diag-row"><b>' + e(row.label) + '</b>'
          + '<span class="' + e(row.tone) + '">' + e(row.value) + '</span></div>';
      }).join('') + '<div class="me-diag-verdict">' + e(report.verdict) + '</div>';
      overlay.querySelector('[data-me-diag-copy]').onclick = function () {
        var text = report.rows.map(function (row) { return row.label + '：' + row.value; }).join('\n')
          + '\n' + report.verdict;
        var done = function () { toast('自检结果已复制'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
        } else { fallbackCopy(text); done(); }
      };
    }).catch(function (error) {
      var body = overlay.querySelector('[data-me-diag-body]');
      if (body) body.innerHTML = '<div class="me-error">自检本身出错了：' + e(error && error.message) + '</div>';
    });
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (error) { /* 忽略 */ }
    area.remove();
  }

  /* ---------------- 往错题库卡片追加按钮 ---------------- */
  function decorateLibrary(view) {
    warnIfNoWebGL(view);
    ensureMountWrapped();
    var toolbar = view.querySelector('.toolbar');
    if (toolbar && !toolbar.querySelector('[data-me-diag-open]')) {
      var diagButton = document.createElement('button');
      diagButton.setAttribute('data-me-diag-open', '');
      diagButton.textContent = '3D 自检';
      diagButton.title = '在你这个浏览器里实测 three.js、WebGL 和当前题目的模型数据，用来定位 3D 面板为什么没出现';
      diagButton.onclick = openDiagnostics;
      toolbar.insertBefore(diagButton, toolbar.lastElementChild);
    }
    var cards = view.querySelectorAll('article.mistake[data-mistake-id]');

    /* 批量录入的逐题裁切图与 AI 识别旁注跟随错题详情显示；
       图片接口受登录态保护，因此用 Bearer 请求取回 Blob，不能直接写裸 <img src>。 */
    cards.forEach(function (card) {
      var record = (app.state.mistakes || []).find(function (item) { return item.id === card.dataset.mistakeId; })
        || (app.state.__serverMistakes || []).find(function (item) { return item.id === card.dataset.mistakeId; });
      if (!record || !card.querySelector('section.tutor') || (!record.sourceImage?.hash && !(record.marginNotes || []).length)) return;
      if (card.querySelector('[data-me-paper-source]')) return;
      var block = document.createElement('section');
      block.setAttribute('data-me-paper-source', '');
      block.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #d7e1f2;border-radius:12px;background:#f8fbff';
      if (record.sourceImage?.hash) {
        var image = document.createElement('img');
        image.alt = '本题裁切题图'; image.loading = 'lazy';
        image.style.cssText = 'display:block;max-width:100%;max-height:420px;object-fit:contain;border-radius:8px;background:#fff';
        block.appendChild(image);
        var token = window.__eduAuthSessionToken || app.state.apiToken || '';
        fetch(location.origin + '/v1/wrong-questions/images/' + encodeURIComponent(record.sourceImage.hash), {
          headers: token ? {authorization: 'Bearer ' + token} : {}
        }).then(function (response) {
          if (!response.ok) throw new Error('题图暂时无法读取');
          return response.blob();
        }).then(function (blob) {
          if (image.isConnected) image.src = URL.createObjectURL(blob);
        }).catch(function () {
          if (image.isConnected) { image.alt = '本题题图暂时无法读取'; image.insertAdjacentText('afterend', '本题题图暂时无法读取，请确认已登录后刷新。'); }
        });
      }
      if ((record.marginNotes || []).length) {
        var notes = document.createElement('div'); notes.style.cssText = 'margin-top:8px;white-space:pre-wrap;line-height:1.65';
        var heading = document.createElement('b'); heading.textContent = 'AI 识别的题干旁注'; notes.appendChild(heading);
        (record.marginNotes || []).forEach(function (note) { var line = document.createElement('p'); line.style.margin = '5px 0 0'; line.textContent = note; notes.appendChild(line); });
        block.appendChild(notes);
      }
      var title = card.querySelector('h3.math');
      if (title) title.insertAdjacentElement('afterend', block); else card.insertBefore(block, card.firstChild);
    });

    /* 展开的原题详情页：顶部给两个明确入口「开启 AI 陪练」「回看解析」。
       归纳·复习页点一条错题跳过来时，落点就是这两个动作，不用自己找。 */
    cards.forEach(function (card) {
      var tutor = card.querySelector('section.tutor');
      if (!tutor || card.querySelector('[data-me-start-tutor]')) return;
      var bar = document.createElement('div');
      bar.className = 'me-actions me-detail-actions';
      bar.innerHTML = '<button class="primary" data-me-start-tutor>开启 AI 陪练</button>'
        + '<button data-me-review-analysis>回看解析</button>';
      var head = card.querySelector('.head');
      if (head && head.parentNode === card) head.insertAdjacentElement('afterend', bar);
      else card.insertBefore(bar, card.firstChild);
      bar.querySelector('[data-me-start-tutor]').onclick = function () {
        var box = card.querySelector('[data-tinput]');
        if (box && box.scrollIntoView) {
          box.scrollIntoView({behavior: 'smooth', block: 'center'});
          try { box.focus(); } catch (error) { /* 忽略聚焦失败 */ }
        } else if (tutor.scrollIntoView) {
          tutor.scrollIntoView({behavior: 'smooth', block: 'start'});
        }
      };
      bar.querySelector('[data-me-review-analysis]').onclick = function () {
        var block = card.querySelector('.answer-block') || tutor;
        if (block && block.scrollIntoView) block.scrollIntoView({behavior: 'smooth', block: 'start'});
      };
    });

    /* 详情页里 3D 面板原本排在「AI 陪练」后面，用户点开只看到陪练，
       以为「模型被藏起来了」。这里把它提到陪练之前，一打开就看得到。 */
    var scene = view.querySelector('.geometry-scene');
    var tutor = view.querySelector('.tutor');
    if (window.__meDisableSceneMove !== true && scene && tutor && tutor.parentNode && scene.previousElementSibling !== tutor) {
      tutor.parentNode.insertBefore(scene, tutor);
    }
    // 删除后的持久提示：render 会清空 .work，所以在这里补回页面顶部
    if (ui.banner) {
      var bannerNode = document.createElement('section');
      bannerNode.className = 'panel me-banner';
      bannerNode.innerHTML = '<b>已删除</b><span>' + e(ui.banner) + '</span>'
        + '<em>列表会自动补上后面的题目，所以张数看起来没变，但那条记录已经不在服务端了。</em>'
        + '<button data-me-banner-close>知道了</button>';
      view.insertBefore(bannerNode, view.firstChild);
      bannerNode.querySelector('[data-me-banner-close]').onclick = function () { bannerNode.remove(); };
      ui.banner = '';
    }

    cards.forEach(function (card) {
      if (card.querySelector('[data-me-edit]')) return;   // 每次 render 会重建 DOM，这里只是保险
      var caseId = card.dataset.mistakeId;
      if (!caseId) return;

      // 3D 状态标记：在错题库列表里就能看出哪些题可以旋转查看
      var record = (app.state.mistakes || []).find(function (item) { return item.id === caseId; })
        || (app.state.__serverMistakes || []).find(function (item) { return item.id === caseId; });
      var geometry = record && record.geometryResult;
      var has3D = Boolean(geometry && geometry.scene);
      var verified = Boolean(geometry && geometry.solverStatus === 'verified');
      var badge = document.createElement('span');
      badge.setAttribute('data-me-3d', '');
      badge.className = 'me-3d ' + (has3D ? (verified ? 'ok' : 'ref') : 'none');
      badge.textContent = has3D ? (verified ? '✓ 3D 已验证' : '◌ 3D 可交互') : missingModelBadge(record);
      badge.title = has3D
        ? '点「查看题目并开始 AI 陪练」即可旋转、缩放、切换 XYZ 网格'
        : missingModelReason(record) + ' 核对题干后可点「重新生成 3D 模型」。';
      var head = card.querySelector('.head > div') || card.querySelector('.head');
      if (head) head.appendChild(badge);

      var bar = document.createElement('div');
      bar.className = 'me-actions';
      bar.innerHTML = '<button data-me-edit="' + e(caseId) + '">编辑</button>'
        + '<button data-me-share="' + e(caseId) + '">分享到共享错题广场</button>'
        + '<button class="me-danger" data-me-delete="' + e(caseId) + '">删除</button>'
        + (has3D ? '' : '<button class="primary" data-me-rebuild="' + e(caseId) + '">重新生成 3D 模型</button>');
      card.appendChild(bar);
      if (record && record.sourceSharedKnowledgeId && card.querySelector('section.tutor')) {
        var sharedNote = document.createElement('details');
        sharedNote.innerHTML = '<summary>共享来源与参考作答（不计入我的错因）</summary><p>由 ' + e(record.sharedSource?.authorName || '同学') + ' 分享；你的作答与复习进度独立记录。</p>'
          + (record.sharedExampleAnswer ? '<p style="white-space:pre-wrap">参考作答：' + e(record.sharedExampleAnswer) + '</p>' : '')
          + ((record.sharedExampleErrors || []).length ? '<p>分享者的易错提醒：' + e(record.sharedExampleErrors.join('、')) + '</p>' : '');
        card.appendChild(sharedNote);
      }
      bar.querySelector('[data-me-share]').onclick = function (event) {
        event.stopPropagation();
        if (typeof window.__eduShareToPlaza === 'function') window.__eduShareToPlaza({caseId: caseId});
        else window.alert('共享模块尚未加载，请刷新页面后重试。');
      };
      bar.querySelector('[data-me-edit]').onclick = function (event) {
        event.stopPropagation();
        openEditor(caseId);
      };
      bar.querySelector('[data-me-delete]').onclick = function (event) {
        event.stopPropagation();
        deleteCase(caseId);
      };
      var rebuildButton = bar.querySelector('[data-me-rebuild]');
      if (rebuildButton) rebuildButton.onclick = function (event) {
        event.stopPropagation();
        openRebuild(caseId, record);
      };

      /* 没有模型时不再插一整张「AI 参考空间模型」卡片（太占面积）。
         失败原因在状态标记的悬停提示里，重新生成按钮留在上面的 me-actions。
         只有「正在生成中」才占位，保证后台建完能在页面上自动出现。 */
      if (!has3D) insertBuildingPanel(card, caseId, record);
    });
  }

  /* ---------------- 注册 ---------------- */
  var feature = {
    activate: function (context) { app = context; },
    decorateLibrary: decorateLibrary,
    openEditor: openEditor,
    deleteCase: deleteCase
  };

  if (window.__registerMistakeEditor) window.__registerMistakeEditor(feature);
})();
