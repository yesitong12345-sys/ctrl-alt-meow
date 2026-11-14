(function () {
  'use strict';
  var app = null;
  var ui = {templates: [], loading: false, error: '', loadedMatches: {}, choices: {}};
  var style = document.createElement('style');
  style.textContent = '.public-template{margin:12px 0;padding:13px;border:1px solid #cfe0ff;border-radius:16px;background:#f7faff}.public-template h4{margin:4px 0}.public-template ul{margin:8px 0;padding-left:20px}.public-template .template-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.public-template .template-preview{font-size:13px;color:#466899;background:#e9f1ff;border-radius:999px;padding:4px 8px;display:inline-block}.public-catalog{display:grid;gap:12px}.public-template-choice{margin:8px 0;padding:9px;border-radius:12px;background:#fff7e8;color:#704800;font-size:13px}';
  document.head.appendChild(style);

  function esc(value) { return app.esc(String(value == null ? '' : value)); }
  function realCases() { return (app.state.mistakes || []).filter(function (item) { return item && item.id && item.question && !item.excludeFromLearningAnalytics; }); }
  function visibleCases() {
    var query = String(app.state.query || '').trim().toLowerCase();
    return realCases().filter(function (item) {
      if (app.state.subjectFilter && app.state.subjectFilter !== '全部' && item.subject !== app.state.subjectFilter) return false;
      if (!query) return true;
      return [item.question, item.studentAnswer, item.analysis, item.subject, item.unit, item.questionType]
        .concat(item.knowledgePoints || [], item.microSkills || [], item.errorCauses || [])
        .join(' ').toLowerCase().includes(query);
    });
  }
  function selectedTemplate(caseItem) { return ui.choices[caseItem.id] || caseItem.publicTemplateReference || null; }
  function matchFor(caseItem) { return (caseItem.publicTemplateMatches || ui.loadedMatches[caseItem.id] || []).slice(0, 1)[0]; }
  function templateCard(caseItem, match) {
    if (!match) return '';
    var template = match.template, selected = selectedTemplate(caseItem), result = selected && selected.templateId === template.id ? selected : null;
    var decision = result ? '<div class="public-template-choice">' + (result.status === 'accepted' ? '已按你的选择保存：' : '本次未复用：') + esc(result.choice === 'use_model' ? '使用模型辅助理解' : result.choice === 'method_only' ? '只参考方法' : '这是不同题') + '</div>' : '';
    return '<section class="public-template"><span class="template-preview">' + esc(template.preview && template.preview.label || '公共题型资源') + '</span><h4>发现可参考的相近题型：' + esc(template.title) + '</h4><p class="muted">' + esc((match.reasons || []).join('；') || '知识点与关键条件相近。') + '</p><details><summary>查看共同条件、差异与可复用方法</summary><p><b>共同条件：</b>' + esc((match.sharedConditions || []).join('；')) + '</p><p><b>可复用构造：</b>' + esc((template.reusableConstructs || []).join('；')) + '</p><p><b>方法参考：</b>' + esc(template.method || '') + '</p><p class="muted">使用模型前会用本题自己的尺寸、标注、辅助线和所求对象重新校验，不会直接替换你的题目。</p></details>' + decision + (result ? '' : '<div class="template-actions"><button class="primary" data-public-choice="use_model" data-case-id="' + esc(caseItem.id) + '" data-template-id="' + esc(template.id) + '">使用这个模型辅助理解</button><button data-public-choice="method_only" data-case-id="' + esc(caseItem.id) + '" data-template-id="' + esc(template.id) + '">只参考方法</button><button data-public-choice="different" data-case-id="' + esc(caseItem.id) + '" data-template-id="' + esc(template.id) + '">这是不同题，不使用</button></div>') + '</section>';
  }
  function attachActions(root) {
    root.querySelectorAll('[data-public-choice]').forEach(function (button) {
      button.onclick = async function () {
        var caseId = button.dataset.caseId, templateId = button.dataset.templateId, choice = button.dataset.publicChoice;
        button.disabled = true;
        try {
          var response = await app.request('/v1/mistake-cases/' + encodeURIComponent(caseId) + '/public-template-choice', {method: 'POST', body: JSON.stringify({templateId: templateId, choice: choice})});
          var saved = response.choice;
          ui.choices[caseId] = {templateId: templateId, choice: choice, status: saved.status};
          var target = (app.state.mistakes || []).find(function (item) { return item.id === caseId; });
          if (target) target.publicTemplateReference = ui.choices[caseId];
          if (choice === 'use_model' && response.revalidation && response.revalidation.ok) {
            app.state.selected = caseId;
            app.state.tab = 'library';
          }
          ui.error = '';
        } catch (error) {
          ui.error = error.message || '本题条件暂时不能复用公共模型；你的个人题目不会被修改。';
        } finally { app.save(); app.render(); }
      };
    });
  }
  async function loadTemplates() {
    if (ui.loading || ui.templates.length) return;
    ui.loading = true;
    try { ui.templates = await app.request('/v1/public-problem-templates'); ui.error = ''; }
    catch (error) { ui.error = error.message; }
    finally { ui.loading = false; }
  }
  async function loadMatches() {
    var cases = realCases().filter(function (item) { return !item.publicTemplateMatches && !ui.loadedMatches[item.id]; });
    if (!cases.length) return false;
    try {
      await Promise.all(cases.slice(0, 8).map(async function (item) {
        var response = await app.request('/v1/public-problem-templates/match', {method: 'POST', body: JSON.stringify({question: item.question, subject: item.subject, unit: item.unit, knowledgePoints: item.knowledgePoints || [], microSkills: item.microSkills || [], questionType: item.questionType, problemSpec: item.problemSpec, geometryResult: item.geometryResult})});
        ui.loadedMatches[item.id] = response.matches || [];
      }));
      return true;
    } catch (error) { ui.error = error.message; return true; }
  }
  var feature = {
    activate: function (context) { app = context; loadTemplates().then(function () { loadMatches().then(function () { if (app.state.tab === 'library' || app.state.tab === 'home') app.render(); }); }); },
    decorateHome: function (root) {
      root.insertAdjacentHTML('beforeend', '<section class="panel"><div class="head"><div><span class="pill good">全校共享</span><h2>公共题型资源库</h2><p class="muted">浏览已验证的题型、空间模型和方法。你的错题、聊天与进度始终私有。</p></div><button class="primary" data-open-public-templates>浏览题型</button></div></section>');
      root.querySelector('[data-open-public-templates]').onclick = function () { app.state.tab = 'public-templates'; app.save(); app.render(); };
    },
    decorateLibrary: function (root) {
      var cases = visibleCases(), articles = root.querySelectorAll('.mistake');
      Array.prototype.forEach.call(articles, function (article, index) { var match = matchFor(cases[index]); if (cases[index] && match) article.insertAdjacentHTML('beforeend', templateCard(cases[index], match)); });
      if (ui.error) root.insertAdjacentHTML('afterbegin', '<section class="panel public-template-choice">公共题型匹配暂不可用：' + esc(ui.error) + '</section>');
      attachActions(root);
      loadMatches().then(function (updated) { if (updated && app.state.tab === 'library') app.render(); });
    },
    renderCatalog: function (root) {
      root.className = 'work';
      root.innerHTML = '<section class="panel"><div class="head"><div><span class="pill good">已验证公共资源</span><h2>公共题型资源库</h2><p class="muted">这里的模型、构造与方法不含任何学生题目、图片、答案或对话。开始个人练习时会创建独立记录。</p></div><button data-public-back>返回首页</button></div></section><section class="public-catalog">' + (ui.templates.map(function (template) { return '<article class="panel"><span class="template-preview">' + esc(template.preview && template.preview.label || '公共资源') + '</span><h3>' + esc(template.title) + '</h3><p><b>知识点：</b>' + esc((template.knowledgePoints || []).join('、')) + '</p><p><b>方法：</b>' + esc(template.method) + '</p><details><summary>查看可复用辅助构造</summary><ul>' + (template.reusableConstructs || []).map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul></details></article>'; }).join('') || '<section class="panel empty">正在加载公共题型资源…</section>') + '</section>';
      root.querySelector('[data-public-back]').onclick = function () { app.state.tab = 'home'; app.save(); app.render(); };
      loadTemplates().then(function () { if (app.state.tab === 'public-templates') app.render(); });
    }
  };
  if (window.__registerPublicProblemTemplates) window.__registerPublicProblemTemplates(feature);
}());
