import {randomUUID} from 'node:crypto';
import {sharedCardSnapshot, sharedMistakeSnapshot, importedMistake} from './shared-learning-resources.mjs';
import {strictQuestionFingerprint} from './shared-content-fingerprint.mjs';
import {sharedModelResources, applySharedResources} from './shared-model-snapshot.mjs';
export {strictQuestionFingerprint} from './shared-content-fingerprint.mjs';

const text = (value, limit = 8000) => String(value ?? '').trim().slice(0, limit);
const error = (code, status = 422) => {throw Object.assign(new Error(code), {status});};
const owner = (record, user) => user && (record?.user_id || record?.studentId) === user.id;

export function createSharedLibrary({db, persist, now = () => new Date().toISOString(), modelVersion = '', onLearningChanged = () => {}}) {
  let writes = Promise.resolve();
  const list = () => db.sharedKnowledge || (db.sharedKnowledge = []);
  const visible = item => !item.status || item.status === 'published';
  function metadata(input) {
    if (input.sharingConfirmed !== true) error('SHARING_CONFIRMATION_REQUIRED');
    if (!['original', 'authorized'].includes(input.license)) error('PUBLIC_LICENSE_REQUIRED');
    if (!text(input.source, 300)) error('PUBLIC_SOURCE_REQUIRED');
    const studyDate = text(input.studyDate, 10);
    if (studyDate && (!/^\d{4}-\d{2}-\d{2}$/.test(studyDate) || !Number.isFinite(Date.parse(studyDate)) || new Date(studyDate).toISOString().slice(0, 10) !== studyDate)) error('INVALID_STUDY_DATE');
    return {title: text(input.title, 120), subject: text(input.subject, 40), chapter: text(input.chapter, 120), studyDate, source: text(input.source, 300), license: input.license};
  }
  function entryFromSource(ref, user) {
    if (ref.caseId) {
      const record = db.cases.find(x => x.id === ref.caseId && owner(x, user));
      if (!record) error('MISTAKE_CASE_NOT_FOUND', 404);
      const snapshot = sharedMistakeSnapshot(record, ['question', 'correctAnswer']);
      // Personal diagnostic analysis can quote handwriting/chat; never publish it by default.
      snapshot.analysis = text(ref.publicAnalysis ?? record.publicAnalysis ?? '');
      return {key: 'case:' + record.id, kind: 'misconception', subject: record.subject || '未分类', title: text(record.question, 120), sourceRef: {caseId: record.id, cardId: ''}, snapshot, resources: sharedModelResources(record, {modelVersion, rubricConfirmed: ref.publicRubricConfirmed === true})};
    }
    const card = db.knowledgeCards.find(x => x.id === ref.cardId && owner(x, user));
    if (!card) error('KNOWLEDGE_CARD_NOT_FOUND', 404);
    return {key: 'card:' + card.id, kind: 'card', subject: card.subject || '未分类', title: text(card.title || card.knowledgePoint || '知识卡', 120), knowledgePoint: card.knowledgePoint || '', sourceRef: {caseId: '', cardId: card.id}, snapshot: sharedCardSnapshot(card)};
  }
  const entries = item => item.items || [{key: 'single', kind: item.kind, subject: item.subject, title: item.title, knowledgePoint: item.knowledgePoint, snapshot: item.snapshot, description: item.description, resources: item.resources}];
  function singleContent(input, user) {
    if (input.caseId || input.cardId) {
      const entry = entryFromSource(input, user), s = entry.snapshot;
      const description = entry.kind === 'misconception' ? [['题目', s.question], ['参考答案', s.correctAnswer], ['解析/提醒', s.analysis]].filter(x => x[1]).map(x => `【${x[0]}】${x[1]}`).join('\n') : s.backContent;
      return {...entry, description, knowledgePoint: entry.knowledgePoint || s.knowledgePoints?.[0] || '', fileName: '', fileData: '', fileType: '', fileSize: 0};
    }
    const fileData = String(input.fileData || ''), fileType = text(input.fileType, 60), fileName = text(input.fileName, 160).replace(/[\\/\r\n]/g, '_');
    if (fileData && (!['text/plain', 'text/markdown'].includes(fileType) || !fileName || !/^[A-Za-z0-9+/]+={0,2}$/.test(fileData))) error('INVALID_SHARED_FILE');
    const bytes = fileData ? Buffer.from(fileData, 'base64') : null;
    if (bytes && (bytes.length > 300 * 1024 || bytes.toString('base64') !== fileData)) error('SHARED_FILE_TOO_LARGE_OR_INVALID', 413);
    const description = text(input.description, 2000);
    if (!description && !fileData) error('TITLE_SUBJECT_AND_CONTENT_REQUIRED');
    const attachment = bytes ? bytes.toString('utf8').replace(/\0/g, '').slice(0, 8000) : '';
    return {kind: 'card', description, knowledgePoint: text(input.knowledgePoint, 80),
      snapshot: {version: 1, type: 'knowledge_card', frontContent: text(input.frontContent || `回忆「${input.knowledgePoint || input.title}」的方法。`), backContent: text([description, attachment].filter(Boolean).join('\n\n'))},
      fileName, fileData, fileType, fileSize: bytes?.length || 0};
  }
  const contentVersion = item => {
    const {versions, reviewedEntries, teacherReviewed, status, withdrawalReason, ...content} = item;
    return structuredClone(content);
  };
  const changes = async (target, patch) => {
    const before = structuredClone(target);
    Object.assign(target, patch);
    try {await persist();} catch (e) {Object.keys(target).forEach(k => delete target[k]); Object.assign(target, before); throw e;}
  };
  function publicItem(item, user) {
    const {fileData, versions, reviewedEntries, ...safe} = item;
    return {...safe, teacherReviewed: Boolean(item.teacherReviewed), reviewedEntries: reviewedEntries || [], hasAttachment: Boolean(item.fileData && item.license && ['text/plain', 'text/markdown'].includes(item.fileType)),
      importedByCurrentUser: Boolean(user) && entries(item).every(entry => [...db.cases, ...db.knowledgeCards].some(x => owner(x, user) && x.sourceSharedKnowledgeId === item.id && (x.sourceSharedEntryKey || 'single') === entry.key))};
  }
  function makeCard(item, entry, user) {
    const stamp = now(), s = entry.snapshot || {}, point = entry.knowledgePoint || entry.title || item.title;
    const back = s.backContent || entry.description || item.description || '';
    return {id: randomUUID(), user_id: user.id, studentId: user.id, author_id: user.id, subject: entry.subject || item.subject, knowledgePoint: point, microSkill: point, title: entry.title || item.title,
      frontContent: s.frontContent || `回忆「${point}」的方法。`, backContent: back, challengePrompt: s.frontContent || `回忆「${point}」的方法。`, insight: back, content: back,
      nextTimeAction: s.nextTimeAction || '', memoryHook: s.memoryHook || '', frontSource: 'shared-snapshot', sourceType: 'shared_knowledge_import', sourceCaseIds: [], evidenceRefs: [], sourceQuotes: [], favorite: true,
      masteryStatus: 'learning', fsrs: null, reviewSchedule: {dueAt: stamp, intervalDays: 0, streak: 0, lastResult: null}, createdAt: stamp, updatedAt: stamp};
  }
  async function importItems(item, input, user) {
    if (input.entryKeys && !Array.isArray(input.entryKeys)) error('INVALID_COLLECTION_SELECTION');
    const selected = input.entryKeys ? entries(item).filter(x => input.entryKeys.includes(x.key)) : entries(item);
    if (!selected.length || (input.entryKeys && selected.length !== new Set(input.entryKeys).size)) error('INVALID_COLLECTION_SELECTION');
    const staged = [], results = [];
    for (const entry of selected) {
      const pool = entry.kind === 'misconception' ? db.cases : db.knowledgeCards;
      const existing = [...pool, ...staged.filter(x => x.pool === pool).map(x => x.record)].find(x => owner(x, user) && (x.sourceSharedKnowledgeId === item.id && (x.sourceSharedEntryKey || 'single') === entry.key || entry.kind === 'misconception' && strictQuestionFingerprint(x.question, x.subject) === strictQuestionFingerprint(entry.snapshot?.question, entry.subject)));
      if (!existing && entry.kind === 'misconception') {
        const signature = q => String(q || '').normalize('NFKC').replace(/\d+(?:\.\d+)?/g, '#').replace(/\s+/g, '');
        const similar = pool.filter(x => owner(x, user) && x.subject === entry.subject && signature(x.question) === signature(entry.snapshot?.question));
        if (similar.length && !input.allowSimilarEntryKeys?.includes(entry.key)) return {status: 409, body: {error: 'SIMILAR_QUESTION_CONFIRMATION_REQUIRED', message: '相似题的数值或条件可能不同，请确认另建题目，不会合并。', entryKey: entry.key, candidates: similar.map(x => ({id: x.id, question: x.question}))}};
      }
      const record = existing || (entry.kind === 'misconception' ? importedMistake({...item, ...entry, id: item.id}, {id: randomUUID(), userId: user.id, createdAt: now()}) : makeCard(item, entry, user));
      if (!record) error('SHARED_QUESTION_MISSING');
      if (!existing) {Object.assign(record, {sourceSharedKnowledgeId: item.id, sourceSharedEntryKey: entry.key, sourceSharedVersion: item.revision || 1, sharedSource: {source: item.source || '', license: item.license || '', sharedAt: item.createdAt}}); if (entry.kind === 'misconception') applySharedResources(record, entry, modelVersion); staged.push({pool, record});}
      results.push({key: entry.key, alreadyImported: Boolean(existing), ...(entry.kind === 'misconception' ? {mistakeCase: record} : {card: record})});
    }
    staged.forEach(({pool, record}) => pool.unshift(record));
    try {if (staged.length) {onLearningChanged(); await persist();}} catch (e) {staged.forEach(({record}) => {db.cases = db.cases.filter(x => x !== record); db.knowledgeCards = db.knowledgeCards.filter(x => x !== record);}); throw e;}
    return {status: staged.length ? 201 : 200, body: {imported: true, alreadyImported: !staged.length, items: results, ...(item.kind !== 'collection' ? results[0] : {})}};
  }
  async function route({method, path, input = {}, user}) {
    const url = new URL(path, 'http://local'), pathname = url.pathname;
    if (!pathname.startsWith('/v1/shared-knowledge')) return null;
    if (method === 'GET' && pathname === '/v1/shared-knowledge') {
      const subject = url.searchParams.get('subject'), kind = url.searchParams.get('kind'), q = text(url.searchParams.get('q')).toLowerCase();
      const quality = x => (x.teacherReviewed ? 100 : 0) + (entries(x).every(e => e.snapshot?.question || e.snapshot?.frontContent) ? 10 : 0) - ((db.sharedReports || []).filter(r => r.resourceId === x.id && r.status === 'pending').length ? 5 : 0) + Math.min(4, Math.log2(1 + Number(x.importCount || 0)));
      return {status: 200, body: list().filter(visible).filter(x => !subject || x.subject === subject).filter(x => !kind || x.kind === kind).filter(x => !q || [x.title, x.chapter, x.knowledgePoint, x.description].join(' ').toLowerCase().includes(q)).sort((a,b) => quality(b) - quality(a) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).map(x => publicItem(x, user))};
    }
    if (!user) error('AUTHENTICATION_REQUIRED', 401);
    if (method === 'GET' && pathname === '/v1/shared-knowledge/updates') {
      return {status: 200, body: [...db.cases, ...db.knowledgeCards].filter(x => owner(x, user) && x.sourceSharedKnowledgeId).flatMap(copy => {
        const item = list().find(x => x.id === copy.sourceSharedKnowledgeId);
        const unavailable = !item || !visible(item) || !entries(item).some(x => x.key === (copy.sourceSharedEntryKey || 'single'));
        return unavailable || (item.revision || 1) > (copy.sourceSharedVersion || 1) ? [{copyId: copy.id, resourceId: copy.sourceSharedKnowledgeId, title: copy.title || text(copy.question, 80), unavailable, reason: item?.withdrawalReason || (unavailable ? '来源已撤回或该项目已移除' : ''), revision: item?.revision || 1}] : [];
      })};
    }
    if (method === 'GET' && pathname === '/v1/shared-knowledge/moderation') {
      if (user.role !== 'admin') error('ADMIN_REQUIRED', 403);
      return {status: 200, body: db.sharedReports || []};
    }
    const resolution = pathname.match(/^\/v1\/shared-knowledge\/reports\/([^/]+)\/resolve$/);
    if (method === 'POST' && resolution) {
      if (user.role !== 'admin') error('ADMIN_REQUIRED', 403);
      const report = (db.sharedReports || []).find(x => x.id === resolution[1]);
      if (!report) error('REPORT_NOT_FOUND', 404);
      if (!['dismiss', 'withdraw'].includes(input.action) || !text(input.reason, 500)) error('MODERATION_REASON_REQUIRED');
      const resource = list().find(x => x.id === report.resourceId);
      const previous = structuredClone(report), previousResource = resource && structuredClone(resource);
      Object.assign(report, {status: input.action === 'withdraw' ? 'withdrawn' : 'dismissed', resolution: text(input.reason, 500), resolvedBy: user.id, resolvedAt: now()});
      if (resource && input.action === 'withdraw') Object.assign(resource, {status: 'withdrawn', withdrawalReason: text(input.reason, 500), withdrawnBy: user.id, withdrawnAt: now()});
      try {await persist();} catch(e) {Object.keys(report).forEach(k => delete report[k]); Object.assign(report, previous); if (resource) {Object.keys(resource).forEach(k => delete resource[k]); Object.assign(resource, previousResource);} throw e;}
      return {status: 200, body: {resolved: true}};
    }
    if (method === 'POST' && pathname === '/v1/shared-knowledge/preview') {
      const refs = input.items || [input];
      if (!Array.isArray(refs) || !refs.length || refs.length > 50) error('INVALID_COLLECTION');
      return {status: 200, body: {items: refs.map(ref => entryFromSource(ref, user))}};
    }
    if (method === 'POST' && [ '/v1/shared-knowledge', '/v1/shared-knowledge/share'].includes(pathname)) {
      if (pathname.endsWith('/share') && !input.caseId && !input.cardId) error('SHARE_SOURCE_REQUIRED', 400);
      // Resolve ownership before reading a private source or interpreting license claims.
      const content = singleContent(input, user), meta = metadata({...input, title: input.title || content.title, subject: input.subject || content.subject});
      if (!meta.title || !meta.subject) error('TITLE_SUBJECT_AND_CONTENT_REQUIRED');
      const duplicate = content.sourceRef && list().find(x => x.authorId === user.id && visible(x) && x.sourceRef?.caseId === content.sourceRef.caseId && x.sourceRef?.cardId === content.sourceRef.cardId);
      if (duplicate) {
        const changed = JSON.stringify(duplicate.snapshot) !== JSON.stringify(content.snapshot) || JSON.stringify(duplicate.resources) !== JSON.stringify(content.resources) || duplicate.source !== meta.source || duplicate.license !== meta.license;
        if (changed) {
          const next = {...duplicate, ...meta, ...content, revision: (duplicate.revision || 1) + 1, teacherReviewed: false, reviewedEntries: [], reviewedBy: null, reviewedAt: null, updatedAt: now()};
          next.versions = [...(duplicate.versions || [contentVersion(duplicate)]), contentVersion(next)]; await changes(duplicate, next);
        }
        return {status: 200, body: {alreadyShared: true, item: publicItem(duplicate, user)}};
      }
      const item = {id: randomUUID(), ...meta, ...content, revision: 1, status: 'published', authorId: user.id, authorName: '同学', createdAt: now(), updatedAt: now(), teacherReviewed: false, reviewedEntries: []};
      item.versions = [contentVersion(item)]; list().unshift(item);
      try {await persist();} catch (e) {db.sharedKnowledge = list().filter(x => x !== item); throw e;}
      return {status: 201, body: publicItem(item, user)};
    }
    if (method === 'POST' && pathname === '/v1/shared-knowledge/collections') {
      const meta = metadata(input);
      if (!meta.title || !meta.subject || !Array.isArray(input.items) || !input.items.length || input.items.length > 50) error('INVALID_COLLECTION');
      if (meta.studyDate && !/^\d{4}-\d{2}-\d{2}$/.test(meta.studyDate)) error('INVALID_STUDY_DATE');
      const items = input.items.map(ref => entryFromSource(ref, user));
      if(items.some(entry=>entry.subject!==meta.subject))error('COLLECTION_SUBJECT_MISMATCH');
      if (new Set(items.map(x => x.key)).size !== items.length) error('DUPLICATE_COLLECTION_ENTRY');
      const item = {id: randomUUID(), ...meta, kind: 'collection', items, revision: 1, status: 'published', authorId: user.id, authorName: '同学', createdAt: now(), updatedAt: now(), teacherReviewed: false};
      item.versions = [{revision: 1, ...structuredClone(meta), items: structuredClone(items), createdAt: now()}];
      list().unshift(item);
      try {await persist();} catch (e) {db.sharedKnowledge = list().filter(x => x !== item); throw e;}
      return {status: 201, body: publicItem(item, user)};
    }
    const match = pathname.match(/^\/v1\/shared-knowledge\/([^/]+)(?:\/(import|review|report|compare|update-copy|withdraw|model))?$/);
    const item = match && list().find(x => x.id === match[1]);
    if (!item) error('SHARED_KNOWLEDGE_NOT_FOUND', 404);
    if (method === 'POST' && match[2] === 'report') {
      if (!['wrong_solution', 'privacy', 'copyright'].includes(input.category) || !text(input.reason, 1000)) error('REPORT_REASON_REQUIRED');
      const report = {id: randomUUID(), resourceId: item.id, revision: item.revision || 1, category: input.category, reason: text(input.reason, 1000), reporterId: user.id, status: 'pending', createdAt: now()};
      db.sharedReports ||= []; db.sharedReports.unshift(report);
      try {await persist();} catch (e) {db.sharedReports = db.sharedReports.filter(x => x !== report); throw e;}
      return {status: 201, body: {reported: true, id: report.id}};
    }
    if (method === 'DELETE' || method === 'POST' && match[2] === 'withdraw') {
      if (item.authorId !== user.id && user.role !== 'admin') error('NOT_RESOURCE_OWNER', 403);
      const reason = text(input.reason, 500) || (item.authorId === user.id ? '作者已撤回' : '管理员已下架');
      await changes(item, {status: 'withdrawn', withdrawalReason: reason, withdrawnAt: now(), withdrawnBy: user.id});
      return {status: 200, body: {deleted: true, withdrawn: true, id: item.id}};
    }
    if (!visible(item)) error('SHARED_RESOURCE_UNAVAILABLE', 410);
    if (method === 'GET' && match[2] === 'model') {
      const entry = entries(item).find(x => x.key === (url.searchParams.get('entryKey') || 'single'));
      const model = entry?.resources?.model || entry?.resources?.planeModel;
      if (!model || model.permission !== 'published_resource' || (model.modelVersion && model.modelVersion !== modelVersion)) error('SHARED_MODEL_UNAVAILABLE', 404);
      return {status: 200, body: structuredClone(model)};
    }
    if (method === 'POST' && match[2] === 'review') {
      if (!['teacher', 'admin'].includes(user.role)) error('TEACHER_REQUIRED', 403);
      if (input.revision !== (item.revision || 1)) error('PUBLIC_VERSION_CHANGED', 409);
      if (!Array.isArray(input.entryKeys) || !input.entryKeys.length || input.entryKeys.some(key => !entries(item).some(x => x.key === key))) error('INVALID_COLLECTION_SELECTION');
      const reviewedEntries = [...new Set([...(item.reviewedEntries || []), ...input.entryKeys])];
      await changes(item, {reviewedEntries, teacherReviewed: entries(item).every(x => reviewedEntries.includes(x.key)), reviewRevision: item.revision || 1, reviewedBy: user.id, reviewedAt: now()});
      return {status: 200, body: publicItem(item, user)};
    }
    if (method === 'PATCH' && !match[2]) {
      if (item.authorId !== user.id) error('NOT_RESOURCE_OWNER', 403);
      if (input.expectedRevision !== (item.revision || 1)) error('PUBLIC_VERSION_CHANGED', 409);
      const meta = metadata(input), revision = (item.revision || 1) + 1;
      if (!meta.title || !meta.subject) error('TITLE_SUBJECT_AND_CONTENT_REQUIRED');
      const updated = item.kind === 'collection' ? {items: Array.isArray(input.items) && input.items.length && input.items.length <= 50 ? input.items.map(ref => entryFromSource(ref, user)) : error('INVALID_COLLECTION')} : singleContent(input, user);
      if(updated.items?.some(entry=>entry.subject!==meta.subject))error('COLLECTION_SUBJECT_MISMATCH');
      if (updated.items && new Set(updated.items.map(x => x.key)).size !== updated.items.length) error('DUPLICATE_COLLECTION_ENTRY');
      const next = {...item, ...meta, ...updated, revision, updatedAt: now(), reviewedEntries: [], teacherReviewed: false, reviewedBy: null, reviewedAt: null};
      next.versions = [...(item.versions || [contentVersion(item)]), contentVersion(next)];
      await changes(item, next);
      return {status: 200, body: publicItem(item, user)};
    }
    if (match[2] === 'compare' || match[2] === 'update-copy') {
      const copyId = method === 'GET' ? url.searchParams.get('copyId') : input.copyId;
      const copy = [...db.cases, ...db.knowledgeCards].find(x => x.id === copyId && owner(x, user) && x.sourceSharedKnowledgeId === item.id);
      if (!copy) error('PERSONAL_COPY_NOT_FOUND', 404);
      const entryKey = copy.sourceSharedEntryKey || 'single', latest = entries(item).find(x => x.key === entryKey);
      if (!latest) error('SHARED_ENTRY_REMOVED', 410);
      if (method === 'GET') {
        const base = (item.versions || []).find(v => v.revision === (copy.sourceSharedVersion || 1));
        return {status: 200, body: {revision: item.revision || 1, importedVersion: copy.sourceSharedVersion || 1, personal: structuredClone(copy), base: base ? entries(base).find(x => x.key === entryKey)?.snapshot || null : null, latest: structuredClone(latest.snapshot || {}), allowedFields: latest.kind === 'misconception' ? ['question', 'correctAnswer', 'analysis', 'model'] : ['frontContent', 'backContent', 'nextTimeAction']}};
      }
      if (input.revision !== (item.revision || 1)) error('PUBLIC_VERSION_CHANGED', 409);
      const allowed = latest.kind === 'misconception' ? ['question', 'correctAnswer', 'analysis', 'model'] : ['frontContent', 'backContent', 'nextTimeAction'];
      if (!Array.isArray(input.fields) || !input.fields.length || input.fields.some(x => !allowed.includes(x))) error('INVALID_UPDATE_FIELDS');
      const patch = {};
      for (const field of input.fields) {
        if (field !== 'model') patch[field] = text(latest.snapshot?.[field], field === 'question' ? 16000 : 8000);
      }
      if (input.fields.includes('model')) {
        if (latest.snapshot?.question !== copy.question && !input.fields.includes('question')) error('MODEL_QUESTION_MISMATCH');
        // Resource validation must use the new public question/subject, not a partial patch.
        const resources = applySharedResources({question: patch.question ?? copy.question, subject: copy.subject}, latest, modelVersion);
        Object.assign(patch, resources); delete patch.question; delete patch.subject;
        if (input.fields.includes('question')) patch.question = latest.snapshot.question;
      } else if ('question' in patch && strictQuestionFingerprint(patch.question, copy.subject) !== strictQuestionFingerprint(copy.question, copy.subject)) {
        const cleared = applySharedResources({question: patch.question, subject: copy.subject}, {resources: {modelReason:'题干已更新，旧模型与旧得分点已解绑；可选择更新公共模型。'}}, modelVersion);
        Object.assign(patch, cleared); delete patch.subject;
      }
      if ('frontContent' in patch) patch.challengePrompt = patch.frontContent;
      if ('backContent' in patch) patch.content = patch.insight = patch.backContent;
      patch.sourceSharedVersion = item.revision || 1; patch.updatedAt = now();
      onLearningChanged(); await changes(copy, patch);
      return {status: 200, body: {updated: true, copy: structuredClone(copy)}};
    }
    if (method === 'POST' && match[2] === 'import') return importItems(item, input, user);
    if (method === 'GET') return {status: 200, body: {...publicItem(item, user), ...(item.fileData && item.license && ['text/plain', 'text/markdown'].includes(item.fileType) ? {fileData: item.fileData} : {})}};
    error('METHOD_NOT_ALLOWED', 405);
  }
  async function handle(request) {
    const run = async () => {try {return await route(request);} catch (e) {if (e.status) return {status: e.status, body: {error: e.message, message: ({COLLECTION_SUBJECT_MISMATCH:'合集内请选择同一学科的错题和知识卡，并核对合集学科。',TEACHER_REQUIRED:'只有经运维确认的教师或管理员可以核对。',PUBLIC_LICENSE_REQUIRED:'请选择原创或获授权许可；仅限个人学习的内容不能公开。',PUBLIC_SOURCE_REQUIRED:'请填写题目或资料来源。',SHARED_FILE_TOO_LARGE_OR_INVALID:'文字附件不能超过 300 KB。',INVALID_SHARED_FILE:'首批仅支持 txt/md 文字附件，不公开原始照片。',PUBLIC_VERSION_CHANGED:'公开版本已变化，请重新对比后再提交。',SHARED_RESOURCE_UNAVAILABLE:'来源已撤回或下架，不能继续导入。'})[e.message] || e.message}}; throw e;}};
    if (request.method === 'GET') return run();
    const task = writes.then(run); writes = task.catch(() => {}); return task;
  }
  return {handle};
}
