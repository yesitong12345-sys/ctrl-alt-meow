(function () {
  'use strict';
  let app, refresh, dialogOwner = '';
  const dialogs = new Set();
  let styled=false;
  const identity = () => String(window.__eduAuthSessionToken || window.__eduCurrentOwner || '');
  const e = value => app.esc(String(value ?? ''));
  function modal(title, html) {
    if(!styled){const style=document.createElement('style');style.textContent='.shared-library-dialog{color:#163453;background:#fffdf9}.shared-library-dialog::backdrop{background:#15284c55}.shared-library-dialog>label{display:grid;gap:6px;margin:12px 0}.shared-library-dialog textarea{display:block;width:100%;min-height:85px}.shared-library-dialog input[type=checkbox]{width:auto;margin-right:8px}.shared-library-dialog section{overflow-wrap:anywhere}.shared-library-dialog pre{max-width:100%;overflow-wrap:anywhere}.shared-library-dialog button{margin:5px 5px 5px 0}.shared-library-dialog h3{font-size:17px}.shared-library-dialog [data-message]{color:#315dcc}';document.head.appendChild(style);styled=true;}
    const dialog = document.createElement('dialog');
    dialog.className = 'shared-library-dialog';
    dialog.style.cssText = 'width:min(850px,94vw);max-height:88vh;overflow:auto;border:1px solid #b9cdf4;border-radius:18px;padding:22px';
    dialog.innerHTML = '<button data-close style="float:right">关闭</button><h2>' + e(title) + '</h2>' + html + '<p data-message role="status"></p>';
    dialogs.add(dialog); document.body.appendChild(dialog);
    dialog.dataset.owner = identity();
    dialog.addEventListener('click', event => {
      if (dialog.dataset.owner !== identity()) {event.preventDefault(); event.stopImmediatePropagation(); dialog.close();}
    }, true);
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {dialogs.delete(dialog); dialog.remove();}); dialog.showModal();
    return dialog;
  }
  async function request(route, options) {
    const before = identity();
    const result = await app.request('/v1/shared-knowledge' + route, options);
    if (before !== identity()) throw new Error('账号已切换，已停止使用旧账号响应。');
    return result;
  }
  const post = (route, input, method = 'POST') => request(route, {method, body: JSON.stringify(input)});
  const safely = action => () => {Promise.resolve().then(action).catch(error => {modal('操作未完成', '<p>' + e(error.message) + '</p>');});};
  const field = (name, title, value = '') => '<label>' + title + '<input data-field="' + name + '" value="' + e(value) + '"></label>';
  const metadata = item => field('title', '合集／资料名称', item?.title || '今日错题') + field('subject', '学科', item?.subject || '数学') + field('chapter', '章节', item?.chapter || '') + '<label>学习日期（可选）<input type="date" data-field="studyDate" value="' + e(item?.studyDate || '') + '"></label>' + field('source', '题目／资料来源', item?.source || '') + '<label>使用许可<select data-field="license"><option value="">请选择</option><option value="original">原创，可在本站分享</option><option value="authorized">已获授权，可在本站分享</option><option value="personal">仅限个人学习，不可公开</option></select></label>';
  function readMeta(dialog) {return Object.fromEntries([...dialog.querySelectorAll('[data-field]')].map(x => [x.dataset.field, x.value.trim()]));}
  function previewHtml(entries) {
    return entries.map((entry, index) => '<section data-preview-entry="' + index + '" style="padding:12px;border:1px solid #d7e4f7;border-radius:12px;margin:10px 0"><h3>' + e(entry.title) + '</h3>' + (entry.snapshot.type === 'wrong_question'
      ? '<div style="white-space:pre-wrap">' + e(entry.snapshot.question) + '</div><h4>参考答案</h4><div>' + e(entry.snapshot.correctAnswer) + '</div><label>公开解析（可删改）<textarea data-public-analysis>' + e(entry.snapshot.analysis) + '</textarea></label><p>' + e(entry.resources?.model ? '可复用：已校验几何模型' : entry.resources?.modelReason || '') + '</p>'
      : '<h4>知识卡正面</h4><div style="white-space:pre-wrap">' + e(entry.snapshot.frontContent) + '</div><h4>知识卡背面</h4><div style="white-space:pre-wrap">' + e(entry.snapshot.backContent) + '</div>')
      + (entry.resources?.rubric ? '<div><h4>公开得分点</h4>' + entry.resources.rubric.steps.map(s => '<p>' + e(s.label + '：' + (s.hint || '')) + '</p>').join('') + '</div>' : '')
      + (entry.kind === 'misconception' ? '<label><input type="checkbox" data-rubric-confirm ' + (entry.resources?.rubric ? 'checked' : '') + '> 我已核对可共享的公共得分点（若无公共得分点，将不共享）</label>' : '') + '</section>').join('');
  }
  async function composer(resource, sourceOnly) {
    const openedBy = identity();
    let sources = sourceOnly ? [sourceOnly] : [];
    const dialog = modal(sourceOnly ? '核对实际公开内容' : resource ? '发布合集新版本' : '按章节／日期发布合集', metadata(resource) + '<p>只公开核对后的正文；不分享个人聊天、作答、学习进度和原始照片。</p><div data-sources></div><button data-preview>预览公开内容</button><div data-preview></div>');
    dialog.querySelector('[data-field="license"]').value = resource?.license || '';
    if (!sourceOnly) {
      const [cases, cards] = await Promise.all([app.request('/v1/mistake-cases'), app.request('/v1/knowledge-cards')]);
      if (openedBy !== identity()) {dialog.close(); return null;}
      sources = [...cases.map(x => ({caseId: x.id, title: x.question})), ...cards.map(x => ({cardId: x.id, title: x.title || x.knowledgePoint}))];
      dialog.querySelector('[data-sources]').innerHTML = sources.map((s, i) => '<label style="display:block"><input data-source-index="' + i + '" type="checkbox" ' + (resource?.items?.some(x => x.sourceRef?.caseId === s.caseId && s.caseId || x.sourceRef?.cardId === s.cardId && s.cardId) ? 'checked' : '') + '> ' + e(s.title?.slice(0, 100)) + ' <input data-order="' + i + '" aria-label="排列顺序" type="number" min="1" value="' + (i + 1) + '" style="width:65px"></label>').join('');
    }
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(null), {once: true});
      dialog.querySelector('[data-preview]').onclick = async () => {
        try {
          const selected = sourceOnly ? sources : [...dialog.querySelectorAll('[data-source-index]:checked')].sort((a,b) => Number(dialog.querySelector('[data-order="'+a.dataset.sourceIndex+'"]').value) - Number(dialog.querySelector('[data-order="'+b.dataset.sourceIndex+'"]').value)).map(x => sources[Number(x.dataset.sourceIndex)]);
          if (!selected.length) throw new Error('先勾选至少一题或一张卡。');
          const refs = selected.map(({caseId, cardId}) => ({caseId, cardId, publicRubricConfirmed: true}));
          const preview = await post('/preview', {items: refs});
          if (!dialog.isConnected || openedBy !== identity()) return;
          if(sourceOnly){dialog.querySelector('[data-field="title"]').value=preview.items[0].title;dialog.querySelector('[data-field="subject"]').value=preview.items[0].subject;}
          dialog.querySelector('[data-preview]').disabled = true;
          dialog.querySelector('div[data-preview]').innerHTML = previewHtml(preview.items) + '<label><input data-public-consent type="checkbox"> 已核对以上实际公开内容，确认没有隐私，并有权分享</label><button class="primary" data-publish-version>确认发布</button>';
          dialog.querySelector('[data-publish-version]').onclick = async event => {
            try {
              if (openedBy !== identity()) throw new Error('账号已切换，请重新发布。');
              const meta = readMeta(dialog);
              if (!meta.source || !['original','authorized'].includes(meta.license)) throw new Error('请填写来源并确认公开许可。');
              if (!dialog.querySelector('[data-public-consent]').checked) throw new Error('请确认实际公开内容。');
              const items = refs.map((ref, i) => ({...ref, publicAnalysis: dialog.querySelector('[data-preview-entry="'+i+'"] [data-public-analysis]')?.value, publicRubricConfirmed: Boolean(dialog.querySelector('[data-preview-entry="'+i+'"] [data-rubric-confirm]')?.checked)}));
              event.target.disabled = true;
              const payload = {...meta, sharingConfirmed: true};
              if (sourceOnly) {resolve({...payload, ...items[0]}); dialog.close(); return;}
              await post(resource ? '/' + encodeURIComponent(resource.id) : '/collections', {...payload, items, ...(resource ? {expectedRevision: resource.revision || 1} : {})}, resource ? 'PATCH' : 'POST');
              dialog.close(); refresh(); resolve({ok:true});
            } catch(error) {dialog.querySelector('[data-message]').textContent = error.message; event.target.disabled = false;}
          };
        } catch (error) {dialog.querySelector('[data-message]').textContent = error.message;}
      };
      if (sourceOnly) dialog.querySelector('[data-preview]').click();
    });
  }
  async function openResource(id, action) {
    const item = await request('/' + encodeURIComponent(id));
    if (action === 'edit') return composer(item);
    const entries = item.items || [{key:'single',kind:item.kind,title:item.title,snapshot:item.snapshot,resources:item.resources}];
    const dialog = modal(item.title, '<p>来源：' + e(item.source || '旧资料，来源待补充') + ' · 版本 ' + (item.revision || 1) + ' · ' + (item.teacherReviewed ? '教师已核对' : '作者已核对·教师未审核') + '</p>' + previewHtml(entries));
    if (action === 'import' || action === 'review') {
      const label = action === 'review' ? '我已核对这一项' : '加入我的个人库';
      dialog.querySelectorAll('[data-preview-entry]').forEach((section, i) => section.insertAdjacentHTML('afterbegin', '<label><input data-entry-key="' + e(entries[i].key) + '" type="checkbox" ' + (action === 'import' ? 'checked' : '') + '> ' + label + '</label>'));
      dialog.insertAdjacentHTML('beforeend', '<button class="primary" data-submit-entries>' + (action === 'review' ? '提交核对结果' : '导入选中项目') + '</button>');
      dialog.querySelector('[data-submit-entries]').onclick = async event => {
        event.target.disabled = true;
        try {
          const entryKeys = [...dialog.querySelectorAll('[data-entry-key]:checked')].map(x => x.dataset.entryKey);
          if(!entryKeys.length)throw new Error('请先勾选至少一个项目。');
          const result = await post('/'+encodeURIComponent(id)+'/'+action, {entryKeys, revision:item.revision||1});
          dialog.querySelector('[data-message]').textContent = action === 'review' ? '核对结果已保存。' : '已加入个人库；自己的复习进度独立。';
          if (result.items) {
            const owner = identity(), cases = await app.request('/v1/mistake-cases');
            if (owner !== identity()) throw new Error('账号已切换，未使用旧账号数据。');
            app.state.mistakes=cases; app.state.__serverMistakes=cases;
          }
          refresh();
        } catch(error) {
          dialog.querySelector('[data-message]').textContent = error.message;
          // A similarity conflict must be consciously confirmed; never merge numeric variants.
          if ((String(error.message).includes('SIMILAR_QUESTION_CONFIRMATION_REQUIRED') || String(error.message).includes('相似题')) && window.confirm('已有相似题，数值或条件可能不同。确认将选中项目另建为题目？不会合并。')) {
            const keys=[...dialog.querySelectorAll('[data-entry-key]:checked')].map(x=>x.dataset.entryKey);
            try {await post('/'+encodeURIComponent(id)+'/import',{entryKeys:keys,allowSimilarEntryKeys:keys}); dialog.close(); refresh();} catch(e){dialog.querySelector('[data-message]').textContent=e.message;}
          }
        } finally {event.target.disabled=false;}
      };
    }
  }
  async function updates() {
    const rows = await request('/updates');
    const dialog = modal('我的共享副本更新', rows.length ? rows.map(x => '<section><p>' + e(x.title) + ' · ' + e(x.unavailable ? x.reason : '有新版，个人内容不会自动覆盖') + '</p>' + (!x.unavailable ? '<button data-compare-copy="'+e(x.copyId)+'" data-resource="'+e(x.resourceId)+'">对比并选择更新</button>' : '') + '</section>').join('') : '<p>暂无新版本或撤回提醒。</p>');
    dialog.querySelectorAll('[data-compare-copy]').forEach(button => button.onclick = safely(async () => {
      const route='/'+encodeURIComponent(button.dataset.resource), comparison=await request(route+'/compare?copyId='+encodeURIComponent(button.dataset.compareCopy));
      const details=modal('对比公开版本与我的副本',comparison.allowedFields.filter(f=>f!=='model').map(f=>'<section><label><input data-update-field="'+f+'" type="checkbox"> 更新 '+e(f)+'</label><p>我的内容：</p><pre style="white-space:pre-wrap">'+e(comparison.personal[f])+'</pre><p>原公开版本：</p><pre style="white-space:pre-wrap">'+e(comparison.base?.[f])+'</pre><p>新版：</p><pre style="white-space:pre-wrap">'+e(comparison.latest[f])+'</pre></section>').join('')+(comparison.allowedFields.includes('model')?'<label><input data-update-field="model" type="checkbox"> 更新模型与公共得分点（题干变化时也须勾选题干）</label>':'')+'<button data-apply-update>应用选中的公共字段</button>');
      details.querySelector('[data-apply-update]').onclick=async()=>{try{await post(route+'/update-copy',{copyId:button.dataset.compareCopy,revision:comparison.revision,fields:[...details.querySelectorAll('[data-update-field]:checked')].map(x=>x.dataset.updateField)}); details.close(); dialog.close(); refresh();}catch(error){details.querySelector('[data-message]').textContent=error.message;}};
    }));
  }
  async function moderation() {
    const reports = await request('/moderation');
    const dialog = modal('举报核查', reports.filter(x => x.status === 'pending').map(x => '<section><p>' + e(x.category + '：' + x.reason) + '</p><textarea data-resolution="'+e(x.id)+'" placeholder="核查结论与理由"></textarea><button data-dismiss="'+e(x.id)+'">未发现违规</button><button data-withdraw="'+e(x.id)+'">核查后下架</button></section>').join('') || '<p>没有待处理举报。</p>');
    dialog.querySelectorAll('[data-dismiss],[data-withdraw]').forEach(button => button.onclick = safely(async () => {
      const id = button.dataset.dismiss || button.dataset.withdraw;
      await post('/reports/'+encodeURIComponent(id)+'/resolve', {action: button.dataset.withdraw ? 'withdraw' : 'dismiss', reason: dialog.querySelector('[data-resolution="'+CSS.escape(id)+'"]').value});
      dialog.close(); refresh();
    }));
  }
  window.__eduSharedLibraryUi = {
    activate(context, reload) {app=context; refresh=reload;},
    prepareSource: source => composer(null,source),
    enhance(panel, context, reload) {
      app=context; refresh=reload;
      if(dialogOwner!==identity()){dialogs.forEach(d=>d.close());dialogOwner=identity();}
      const hero=panel.querySelector('.shared-plaza-hero-actions'); if(!hero||!identity())return;
      hero.insertAdjacentHTML('beforeend','<button data-create-collection>＋ 发布章节／今日合集</button><button data-library-updates>我的副本更新</button>');
      hero.querySelector('[data-create-collection]').onclick=safely(()=>composer()); hero.querySelector('[data-library-updates]').onclick=safely(()=>updates());
      if(window.__eduSharedUserRole==='admin'){hero.insertAdjacentHTML('beforeend','<button data-moderation>举报核查</button>');hero.querySelector('[data-moderation]').onclick=safely(()=>moderation());}
      panel.querySelectorAll('[data-shared-card]').forEach(card=>{
        const id=card.querySelector('[data-shared-detail]')?.dataset.sharedDetail; if(!id)return;
        const item=window.__eduSharedPlazaItems?.find(x=>x.id===id); if(!item)return;
        card.insertAdjacentHTML('beforeend','<p>'+e(item.teacherReviewed?'教师已核对':'作者已核对·教师未审核')+' · v'+(item.revision||1)+'</p><button data-report>举报错解／隐私／版权</button>'+(item.authorId===window.__eduSharedUserId&&item.kind==='collection'?'<button data-edit-collection>发布合集新版本</button>':'')+(['teacher','admin'].includes(window.__eduSharedUserRole)?'<button data-teacher-review>逐项核对</button>':''));
        card.querySelector('[data-report]').onclick=()=>{const d=modal('举报资料','<select data-report-category><option value="wrong_solution">错解</option><option value="privacy">隐私</option><option value="copyright">版权</option></select><textarea data-report-reason placeholder="说明具体问题，不要填入新的个人隐私"></textarea><button data-send-report>提交举报</button>'); d.querySelector('[data-send-report]').onclick=async()=>{try{await post('/'+encodeURIComponent(id)+'/report',{category:d.querySelector('[data-report-category]').value,reason:d.querySelector('[data-report-reason]').value});d.querySelector('[data-message]').textContent='已提交，等待管理员核查。举报不会自动判定违规。';}catch(error){d.querySelector('[data-message]').textContent=error.message;}};};
        card.querySelector('[data-edit-collection]')?.addEventListener('click',safely(()=>openResource(id,'edit')));
        card.querySelector('[data-teacher-review]')?.addEventListener('click',safely(()=>openResource(id,'review')));
        if(item.kind==='collection'){card.querySelector('[data-shared-detail]').onclick=safely(()=>openResource(id,'view')); card.querySelector('[data-shared-import]').onclick=safely(()=>openResource(id,'import')); card.querySelector('[data-shared-import]').textContent='选择项目，加入个人库';}
      });
    }
  };
})();
