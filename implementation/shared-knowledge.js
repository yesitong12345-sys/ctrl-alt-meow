(function () {
  'use strict';
  let app;
  const ui = {mode: 'mistakes', items: [], loadedFor: null, loadedAt: 0, loading: false, busy: false, message: '', query: '', category: 'cards', subject: '全部', publishOpen: false, file: null, draft: {}};
  const sessionKey = 'educompanion.student.session';
  const token = () => { try { return sessionStorage.getItem(sessionKey) || ''; } catch { return ''; } };
  // Public deployment uses an HttpOnly cookie; the browser must not read its token.
  const accountIdentity = () => token() || String(window.__eduCurrentOwner || '');
  const e = value => app.esc(String(value == null ? '' : value));

  async function load() {
    const current = accountIdentity();
    // 广场本身是公开内容：没有登录也要能加载出来逛，只是不能发布/下载/收藏。
    if (ui.loading || (ui.loadedFor === current && Date.now() - ui.loadedAt < 30000)) return;
    ui.loading = true;
    try {
      const items = await app.request('/v1/shared-knowledge');
      if (current !== accountIdentity()) return;
      ui.items = Array.isArray(items) ? items : [];
      ui.loadedFor = current;
      ui.loadedAt = Date.now();
      if (ui.message.startsWith('知识库加载失败：')) ui.message = '';
      if (current) {
        try { const account = await app.request('/v1/auth/me'); if (current === accountIdentity()) {window.__eduSharedUserId = account.user.id; window.__eduSharedUserRole = account.user.role;} }
        catch { if (current === accountIdentity()) window.__eduSharedUserId = ''; }
      }
    } catch (error) { if (current === accountIdentity()) { ui.loadedFor = current; ui.loadedAt = Date.now(); ui.message = '知识库加载失败：' + error.message; } }
    finally { ui.loading = false; if (ui.mode === 'shared' && app.state.tab === 'upload') app.render(); }
  }

  /* 一键分享：错题库和知识卡库都通过它把「自己的东西」发到广场，不用重打一遍。 */
  async function shareSource(source) {
    const current = accountIdentity();
    if (!current) { ui.publishOpen = false; ui.message = '分享需要先登录。登录后就能把错题和知识卡发到广场。'; app.state.tab = 'account-settings'; app.render(); return {ok: false}; }
    const publication = await window.__eduSharedLibraryUi?.prepareSource(source);
    if (!publication || current !== accountIdentity()) return {ok: false};
    try {
      const result = await app.request('/v1/shared-knowledge/share', {method: 'POST', body: JSON.stringify({...publication, ...source, sharingConfirmed: true})});
      if (current !== accountIdentity()) return {ok: false, error: '账号已切换，请在原账号查看发布结果。'};
      ui.loadedFor = null;
      ui.message = result?.alreadyShared ? '这份内容已经在广场上了。' : '已分享到学生共享知识广场。';
      await load();
      ui.category = source.cardId ? 'cards' : 'mistakes';
      ui.subject = '全部';
      ui.mode = 'shared';
      app.state.tab = 'upload';
      if (typeof app.save === 'function') app.save();
      app.render();
      return {ok: true, shared: Boolean(result?.alreadyShared)};
    } catch (error) {
      ui.message = '分享失败：' + error.message;
      app.render();
      return {ok: false, error: error.message};
    }
  }
  window.__eduShareToPlaza = shareSource;
  window.__eduSharedKnowledgeRefresh = () => { ui.loadedFor = null; void load(); };
  const refreshVisible = () => {
    if (app && ui.mode === 'shared' && app.state.tab === 'upload' && !document.hidden && !ui.publishOpen) void load();
  };
  window.addEventListener('focus', () => { ui.loadedAt = 0; refreshVisible(); });
  document.addEventListener('visibilitychange', refreshVisible);
  setInterval(refreshVisible, 30000);

  function fileBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  // 旧版直接发布的 note 是学习资料，归入知识卡片；不删除旧资料或改变导入能力。
  const plazaCategory = item => item.kind === 'collection' ? 'collections' : item.kind === 'misconception' ? 'mistakes' : 'cards';
  function kindBadge(item) {
    return (item.kind === 'collection' ? '章节／今日合集' : plazaCategory(item) === 'mistakes' ? '错题分享' : '知识卡片') + (item.hasAttachment ? ' · 有附件' : '');
  }
  /* 空广场不能只告诉学生「还没有资料」——要把发布入口直接放在他眼前。 */
  function emptyStateHtml(loggedIn, categoryCount, visibleCount) {
    if (ui.items.length) {
      const categoryEmpty = categoryCount === 0;
      const heading = categoryEmpty ? (ui.category === 'mistakes' ? '还没有同学分享错题' : '还没有同学分享知识卡片') : '没有找到匹配的资料';
      const next = categoryEmpty ? (ui.category === 'mistakes' ? '去错题库选一道题，确认后就能分享到这里。' : '你可以分享一张自己的知识卡，或直接写一份学习整理。') : '试试其他学科或搜索词。';
      const action = categoryEmpty && loggedIn ? (ui.category === 'mistakes'
        ? '<button data-shared-go-mistakes>去错题库分享</button>'
        : '<button data-shared-open-empty>＋ 发布知识卡片</button>') : '';
      return '<div class="shared-plaza-empty" data-shared-empty ' + (visibleCount ? 'hidden' : '') + '><span aria-hidden="true">✏️</span><h3>' + heading + '</h3><p>' + next + '</p>' + action + '</div>';
    }
    return '<div class="shared-plaza-empty shared-plaza-empty-first" data-shared-empty>'
      + '<span aria-hidden="true">✏️</span><h3>广场还没有资料，第一份可以是你整理的</h3>'
      + '<p>知识卡片可以在这里直接发布；错题分享请从自己的错题库选择。</p>'
      + (loggedIn
        ? '<div class="row shared-plaza-first-actions"><button class="primary" data-shared-open-empty>＋ 发布知识卡片</button><button data-shared-go-mistakes>去错题库分享</button></div>'
        : '<div class="row shared-plaza-first-actions"><button class="primary" data-shared-login>登录后就能发布</button></div>')
      + '</div>';
  }
  function draw(panel) {
    window.__eduSharedPlazaItems = ui.items;
    panel.hidden = false;
    const draftOwner = accountIdentity();
    const ownerChanged = ui.draftOwner !== draftOwner;
    if (ownerChanged) { ui.draftOwner = draftOwner; ui.draft = {}; ui.file = null; ui.publishOpen = false; }
    if (!ownerChanged) panel.querySelectorAll('[data-shared-title],[data-shared-subject],[data-shared-point],[data-shared-description],[data-shared-consent]').forEach(input => {
      ui.draft[input.dataset.sharedConsent !== undefined ? 'consent' : input.hasAttribute('data-shared-title') ? 'title' : input.hasAttribute('data-shared-subject') ? 'subject' : input.hasAttribute('data-shared-point') ? 'point' : 'description'] = input.type === 'checkbox' ? input.checked : input.value;
    });
    // 渲染前先确保容器可见：面板在 tab 之间切换时会被复用，样式可能残留。
    panel.hidden = false;
    const current = accountIdentity();
    const categoryItems = ui.items.filter(item => plazaCategory(item) === ui.category);
    const subjects = [...new Set(categoryItems.map(item => String(item.subject || '未分类').trim() || '未分类'))].sort((a, b) => a.localeCompare(b, 'zh'));
    if (ui.subject !== '全部' && !subjects.includes(ui.subject)) ui.subject = '全部';
    const filtered = categoryItems.filter(item => ui.subject === '全部' || (item.subject || '未分类') === ui.subject);
    const matches = item => [item.title, item.subject, item.knowledgePoint, item.description, item.authorName].join(' ').toLowerCase().includes(ui.query.toLowerCase());
    const visibleCount = filtered.filter(matches).length;
    const cards = filtered.map(item => '<article class="shared-plaza-card" data-shared-card ' + (matches(item) ? '' : 'hidden') + '>'
      + '<div class="shared-plaza-card-top"><span class="shared-plaza-subject">' + e(item.subject || '未分类') + '</span><span class="shared-plaza-kind">' + e(kindBadge(item)) + '</span></div>'
      + '<p class="shared-plaza-point">' + e(item.knowledgePoint || '学习笔记') + '</p><h3>' + e(item.title) + '</h3>'
      + '<p class="shared-plaza-excerpt">' + e(item.description || '打开附件查看完整资料。') + '</p>'
      + '<div class="shared-plaza-card-bottom"><span>由 ' + e(item.authorName || '同学') + ' 分享</span>'
      + (item.hasAttachment ? '<button data-shared-download="' + e(item.id) + '" aria-label="下载' + e(item.title) + '的附件">下载附件</button>' : '<span>' + e(item.kind === 'misconception' ? '错题与解析' : '知识卡内容') + '</span>')
      + '</div>' + (item.hasAttachment ? '<p class="shared-plaza-file" title="' + e(item.fileName) + '">📎 ' + e(item.fileName) + '</p>' : '')
      + '<button data-shared-detail="' + e(item.id) + '">查看完整内容</button>'
      + (current
        ? '<button class="primary shared-plaza-import" data-shared-import="' + e(item.id) + '">' + (item.kind === 'misconception' ? (item.importedByCurrentUser ? '已导入 · 查看我的错题' : '导入我的错题库') : (item.importedByCurrentUser ? '已收藏 · 去知识卡闯关' : '收藏并导入我的知识库')) + '</button>'
          + '<button class="shared-plaza-remove" data-shared-remove="' + e(item.id) + '" hidden>撤回我的资料</button>'
        : '<button class="shared-plaza-import" data-shared-login>登录后收藏</button>')
      + '</article>').join('');
    panel.innerHTML = '<section class="panel shared-knowledge-panel">'
      + '<div class="shared-plaza-hero"><div><span class="shared-plaza-kicker">同学们的学习角</span><h2>学生共享知识库</h2><p>知识卡片与错题分享分开逛，都能按学科筛选。知识卡导入个人卡库，错题导入个人错题库；内容直接复用，复习进度各自独立。</p></div><div class="shared-plaza-hero-actions"><span>' + ui.items.length + ' 份共享资料</span><button data-shared-refresh>刷新</button>' + (current ? '<button class="primary" data-shared-open aria-expanded="' + ui.publishOpen + '">＋ 发布知识卡片</button>' : '<button class="primary" data-shared-login>登录后分享</button>') + '</div></div>'
      + '<div class="shared-plaza-categories" role="group" aria-label="资料类别">'
      + '<button data-shared-category="cards" aria-pressed="' + (ui.category === 'cards') + '">知识卡片 <span>' + ui.items.filter(item => plazaCategory(item) === 'cards').length + '</span></button>'
      + '<button data-shared-category="mistakes" aria-pressed="' + (ui.category === 'mistakes') + '">错题分享 <span>' + ui.items.filter(item => plazaCategory(item) === 'mistakes').length + '</span></button><button data-shared-category="collections" aria-pressed="' + (ui.category === 'collections') + '">章节／今日合集</button></div>'
      + '<div class="shared-plaza-tools"><label class="shared-plaza-search">搜索<input data-shared-search type="search" placeholder="搜索知识点、标题或分享者" value="' + e(ui.query) + '"></label><div class="shared-plaza-subjects" role="group" aria-label="按当前类别的学科筛选">'
      + ['全部', ...subjects].map(subject => '<button data-shared-subject-filter="' + e(subject) + '" aria-pressed="' + (ui.subject === subject) + '">' + e(subject) + (subject === '全部' ? ' · ' + categoryItems.length : ' · ' + categoryItems.filter(item => (item.subject || '未分类') === subject).length) + '</button>').join('') + '</div></div>'
      + '<div class="shared-plaza-result"><h3>' + (ui.category === 'cards' ? '大家分享的知识卡片' : ui.category === 'collections' ? '章节与今日合集' : '大家分享的错题') + '</h3><span data-shared-result-count>' + visibleCount + ' 份</span></div><div class="shared-plaza-cards" data-shared-list>' + cards + emptyStateHtml(Boolean(current), categoryItems.length, visibleCount) + '</div>'
      + (current
        ? '<section class="shared-plaza-publish" data-shared-publish-panel ' + (ui.publishOpen ? '' : 'hidden') + '><div class="shared-plaza-publish-head"><div><h3>发布知识卡片</h3><p>填写知识点与自己的理解，也可附上小文件；错题请从个人错题库分享，避免把个人作答误发出去。</p></div><button data-shared-close aria-label="收起分享表单">收起</button></div><div class="shared-plaza-form"><label>标题<input data-shared-title maxlength="120" placeholder="例如：函数单调性整理"></label><label>学科<input data-shared-subject maxlength="40" placeholder="例如：数学"></label><label>知识点<input data-shared-point maxlength="80" placeholder="例如：单调性"></label><label class="shared-plaza-wide">我的理解<textarea data-shared-description maxlength="2000" placeholder="用自己的话写下知识点、方法或易错提醒"></textarea></label><label>来源<input data-shared-source maxlength="300" placeholder="自编／获授权来源"></label><label>许可<select data-shared-license><option value="">请选择</option><option value="original">原创，可在本站分享</option><option value="authorized">已获授权，可在本站分享</option><option value="personal">仅限个人学习，不公开</option></select></label><label class="shared-plaza-wide">文字附件（可选，最大 300 KB）<input data-shared-file type="file" accept=".txt,.md,text/plain,text/markdown"></label><p class="muted shared-plaza-wide" data-shared-file-name></p><label class="shared-plaza-consent shared-plaza-wide"><input data-shared-consent type="checkbox"> 我确认资料可供本站其他学生查看和下载，且不含个人隐私或真实学生信息。</label><button class="primary shared-plaza-publish-button" data-shared-publish ' + (ui.busy ? 'disabled' : '') + '>发布到知识卡片广场</button></div></section>'
        : '<p class="muted shared-plaza-guest">现在可以自由浏览；登录后才能分享、下载附件和收藏到自己的知识库。</p>')
      + (ui.message ? '<p class="geometry-alert">' + e(ui.message) + '</p>' : '') + '</section>';
    panel.querySelector('[data-shared-refresh]').onclick = () => { ui.loadedFor = null; void load(); };
    const draftNames = {title: 'title', subject: 'subject', point: 'point', description: 'description', consent: 'consent', source: 'source', license: 'license'};
    Object.keys(draftNames).forEach(key => { const input = panel.querySelector('[data-shared-' + draftNames[key] + ']'); if (input) { if (key === 'consent') input.checked = Boolean(ui.draft[key]); else input.value = ui.draft[key] || ''; input.addEventListener('input', () => { ui.draft[key] = key === 'consent' ? input.checked : input.value; }); } });
    panel.querySelectorAll('[data-shared-detail]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const item = current ? await app.request('/v1/shared-knowledge/' + encodeURIComponent(button.dataset.sharedDetail)) : ui.items.find(x => x.id === button.dataset.sharedDetail);
        const snapshot = item.snapshot || {};
        const sections = snapshot.type === 'knowledge_card' ? [['正面 · 自测', snapshot.frontContent], ['背面 · 方法与答案', snapshot.backContent]] : snapshot.type === 'wrong_question' ? [['题目', snapshot.question], ['参考答案', snapshot.correctAnswer], ['解析', snapshot.analysis], ['分享者的作答（不是你的作答）', snapshot.exampleAnswer]] : [['资料内容', item.description]];
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'width:min(760px,90vw);max-height:85vh;overflow:auto;border:1px solid #b9cdf4;border-radius:16px;padding:24px';
        dialog.innerHTML = '<button data-close-detail style="float:right">关闭</button><h2>' + e(item.title) + '</h2>' + sections.filter(s => s[1]).map(s => '<h3>' + e(s[0]) + '</h3><div style="white-space:pre-wrap;overflow-wrap:anywhere">' + e(s[1]) + '</div>').join('');
        document.body.appendChild(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.querySelector('[data-close-detail]').onclick = () => dialog.close(); dialog.showModal();
        window.renderMathInElement?.(dialog, {delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}, {left: '\\(', right: '\\)', display: false}], throwOnError: false});
      } catch (error) { ui.message = '查看失败：' + error.message; draw(panel); }
      finally { button.disabled = false; }
    });
    panel.querySelectorAll('[data-shared-category]').forEach(button => button.onclick = () => { ui.category = button.dataset.sharedCategory; ui.subject = '全部'; draw(panel); });
    // 游客态下「登录」按钮有多处（顶部、空状态、卡片、底部提示），全部接上。
    panel.querySelectorAll('[data-shared-login]').forEach(button => button.addEventListener('click', () => { app.state.tab = 'account-settings'; app.render(); }));
    const openPublish = () => { ui.publishOpen = true; draw(panel); panel.querySelector('[data-shared-title]')?.focus(); };
    panel.querySelector('[data-shared-open]')?.addEventListener('click', () => { if (ui.publishOpen) { ui.publishOpen = false; draw(panel); panel.querySelector('[data-shared-open]')?.focus(); } else openPublish(); });
    panel.querySelector('[data-shared-open-empty]')?.addEventListener('click', openPublish);
    panel.querySelector('[data-shared-go-mistakes]')?.addEventListener('click', () => { app.state.tab = 'library'; app.render(); });
    panel.querySelector('[data-shared-close]')?.addEventListener('click', () => { ui.publishOpen = false; draw(panel); panel.querySelector('[data-shared-open]')?.focus(); });
    panel.querySelectorAll('[data-shared-subject-filter]').forEach(button => button.onclick = () => { ui.subject = button.dataset.sharedSubjectFilter; draw(panel); });
    const search = panel.querySelector('[data-shared-search]');
    if (search) search.oninput = () => {
      ui.query = search.value;
      const normalized = ui.query.toLowerCase();
      let visible = 0;
      panel.querySelectorAll('[data-shared-card]').forEach(card => { card.hidden = !card.textContent.toLowerCase().includes(normalized); if (!card.hidden) visible++; });
      panel.querySelector('[data-shared-result-count]').textContent = visible + ' 份';
      const empty = panel.querySelector('[data-shared-empty]');
      // 广场整体为空时，空状态同时是「引导发布」的入口，搜索不该把它藏起来。
      if (empty) empty.hidden = visible > 0;
    };
    const picked = panel.querySelector('[data-shared-file]');
    if (picked) picked.onchange = () => { ui.file = picked.files?.[0] || null; panel.querySelector('[data-shared-file-name]').textContent = ui.file ? ui.file.name : ''; };
    panel.querySelector('[data-shared-publish]')?.addEventListener('click', async () => {
      const publisher = accountIdentity();
      const title = panel.querySelector('[data-shared-title]').value.trim();
      const subject = panel.querySelector('[data-shared-subject]').value.trim();
      const knowledgePoint = panel.querySelector('[data-shared-point]').value.trim();
      const description = panel.querySelector('[data-shared-description]').value.trim();
      if (!title || !subject || (!description && !ui.file)) { panel.querySelector('.shared-knowledge-panel').insertAdjacentHTML('beforeend', '<p class="geometry-alert">请填写标题、学科，以及内容说明或附件。</p>'); return; }
      if (!panel.querySelector('[data-shared-consent]').checked) { panel.querySelector('.shared-knowledge-panel').insertAdjacentHTML('beforeend', '<p class="geometry-alert">请先确认资料可以公开给本站其他学生，且不含隐私信息。</p>'); return; }
      if (ui.file && ui.file.size > 300 * 1024) { panel.querySelector('.shared-knowledge-panel').insertAdjacentHTML('beforeend', '<p class="geometry-alert">附件不能超过 300 KB；大文件请放到网盘后把链接写进我的理解。</p>'); return; }
      ui.busy = true;
      const button = panel.querySelector('[data-shared-publish]'); button.disabled = true;
      try {
        const payload = {kind: 'card', title, subject, knowledgePoint, description, sharingConfirmed: true, source: panel.querySelector('[data-shared-source]').value, license: panel.querySelector('[data-shared-license]').value};
        if (ui.file) { payload.fileName = ui.file.name; payload.fileType = ui.file.type || (ui.file.name.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain'); payload.fileData = await fileBase64(ui.file); }
        if (publisher !== accountIdentity()) return;
        await app.request('/v1/shared-knowledge', {method: 'POST', body: JSON.stringify(payload)});
        if (publisher !== accountIdentity()) return;
        ui.file = null; ui.draft = {}; ui.loadedFor = null; ui.publishOpen = false; ui.category = 'cards'; ui.subject = '全部'; ui.message = '知识卡片已发布到广场。';
        await load();
      } catch (error) { ui.message = '发布失败：' + error.message; button.disabled = false; }
      finally { ui.busy = false; app.render(); }
    });
    panel.querySelectorAll('[data-shared-download]').forEach(button => button.onclick = async () => {
      try {
        const item = await app.request('/v1/shared-knowledge/' + encodeURIComponent(button.dataset.sharedDownload));
        const binary = atob(item.fileData || '');
        const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
        const href = URL.createObjectURL(new Blob([bytes], {type: item.fileType || 'application/octet-stream'}));
        const link = document.createElement('a'); link.href = href; link.download = item.fileName || '学习资料'; link.click();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
      } catch (error) { ui.message = '下载失败：' + error.message; draw(panel); }
    });
    panel.querySelectorAll('[data-shared-import]').forEach(button => button.onclick = async () => {
      const importer = accountIdentity();
      const item = ui.items.find(entry => entry.id === button.dataset.sharedImport);
      if (!item) return;
      button.disabled = true;
      button.textContent = '正在导入…';
      try {
        const imported = await app.request('/v1/shared-knowledge/' + encodeURIComponent(item.id) + '/import', {method: 'POST', body: JSON.stringify({})});
        if (importer !== accountIdentity()) return;
        item.importedByCurrentUser = true;
        if (imported.mistakeCase) {
          const record = imported.mistakeCase;
          app.state.mistakes = [record, ...(app.state.mistakes || []).filter(x => x.id !== record.id)];
          app.state.__serverMistakes = [record, ...(app.state.__serverMistakes || []).filter(x => x.id !== record.id)];
          app.state.query = ''; app.state.subjectFilter = '全部';
          app.state.focusMistakeId = record.id; app.state.libraryDetailId = record.id; app.state.tab = 'library';
          if (typeof app.save === 'function') app.save();
          app.render(); return;
        }
        ui.message = '已导入你的知识卡库，并加入知识卡闯关队列。';
        if (typeof window.__openRollingQuizForSubject === 'function') {
          window.__openRollingQuizForSubject((imported.card && imported.card.subject) || item.subject || 'all');
        } else {
          app.state.tab = 'card-challenge';
          app.save();
          app.render();
        }
      } catch (error) {
        ui.message = '导入失败：' + error.message;
        button.disabled = false;
        button.textContent = '重试导入';
      }
    });
    // The server enforces ownership; this is only a convenience in the interface.
    const ownId = window.__eduSharedUserId || '';
    panel.querySelectorAll('[data-shared-remove]').forEach(button => {
      const item = ui.items.find(entry => entry.id === button.dataset.sharedRemove);
      button.hidden = !item || item.authorId !== ownId;
      button.onclick = async () => {
        if (!window.confirm('撤回这份共享资料？之后不能新导入，已有个人副本不会被删除。')) return;
        try { await app.request('/v1/shared-knowledge/' + encodeURIComponent(item.id), {method: 'DELETE'}); ui.items = ui.items.filter(entry => entry.id !== item.id); app.render(); }
        catch (error) { ui.message = '删除失败：' + error.message; draw(panel); }
      };
    });
    window.__eduSharedLibraryUi?.enhance(panel, app, () => {ui.loadedFor=null; void load();});
  }

  const PAPER_MODES = ['paper', 'batch'];
  window.__registerSharedKnowledge?.({
    activate(context) { app = context; window.__eduSharedLibraryUi?.activate(context, () => {ui.loadedFor=null; void load();}); },
    decorateUpload(view) {
      const original = document.createElement('div'); original.className = 'work two';
      while (view.firstChild) original.appendChild(view.firstChild);
      const tabs = document.createElement('div'); tabs.className = 'row shared-knowledge-tabs';
      tabs.innerHTML = '<button data-shared-mode="mistakes">单题录入</button><button data-shared-mode="batch">批量错题</button><button data-shared-mode="paper">试卷 + 答题卡</button><button data-shared-mode="shared">学生共享知识库</button>';
      const panel = document.createElement('div');
      panel.dataset.paperPanel = '';
      view.className = 'work'; view.append(tabs, original, panel);
      original.hidden = ui.mode !== 'mistakes';
      // 这个 panel 是试卷上传 / 批量错题 / 共享知识库三个模式共用的容器；
      // 之前写成「不在 PAPER_MODES 里就隐藏」，导致共享知识库整块被藏掉（白屏）。
      panel.hidden = ui.mode === 'mistakes';
      tabs.querySelectorAll('button').forEach(button => {
        button.classList.toggle('primary', button.dataset.sharedMode === ui.mode);
        button.onclick = () => { ui.mode = button.dataset.sharedMode; if (ui.mode === 'shared') ui.loadedAt = 0; app.render(); };
      });
      if (ui.mode === 'shared') {
        if (ui.loadedFor !== accountIdentity()) { ui.items = []; window.__eduSharedUserId = ''; void load(); }
        else if (Date.now() - ui.loadedAt >= 30000) void load();
        draw(panel);
      }
      if (PAPER_MODES.includes(ui.mode)) {
        // 两个 tab 共用同一个渲染器，靠这个开关切换「强制试卷+答题卡」还是「批量错题」。
        window.__eduPaperEntry = ui.mode === 'paper' ? 'examPaper' : 'batch';
        if (typeof window.__eduPaperUploadRender === 'function') window.__eduPaperUploadRender(panel);
        else {
          panel.innerHTML = '<section class="panel"><h2>试卷上传尚未加载</h2><p>页面和学习服务版本暂时不一致。先刷新页面；若仍出现此提示，请重启本机学习服务或更新服务器代码。</p><button data-paper-reload>刷新页面</button></section>';
          panel.querySelector('[data-paper-reload]').onclick = () => location.reload();
        }
      }
    }
  });
}());
