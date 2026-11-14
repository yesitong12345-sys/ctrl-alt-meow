import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedLibrary} from '../workflows/shared-library.mjs';
import {buildVerifiedCubeGeometry} from '../workflows/cube-geometry-entry.mjs';
import {strictQuestionFingerprint} from '../workflows/shared-content-fingerprint.mjs';
import {compilePlaneGeometry, createPlaneVisualBinding, planeStepVisuals} from '../workflows/plane-geometry.mjs';

const publication = {title: '今日立体几何', subject: '数学', chapter: '空间向量', studyDate: '2026-10-11', source: '自编练习', license: 'original', sharingConfirmed: true};
test('严格去重保留上标、大小写、单位、数值与设问，只消除明确排版差异',()=>{
  const hash=q=>strictQuestionFingerprint(q,'数学');
  assert.equal(hash('  求 AB\t 长度。\r\n'),hash('求 AB 长度。'));
  for(const [a,b] of [['x²','x2'],['AB','ab'],['2 cm','2 m'],['2','3'],['求长度','求面积']])assert.notEqual(hash(a),hash(b));
});
function setup() {
  const db = {cases: [{id: 'q1', user_id: 'a', subject: '数学', question: '求 AB 的长度。', studentAnswer: '私人错误', analysis: '用距离公式。', correctAnswer: '2', knowledgePoints: ['距离'], learningProfile: {mastery: 99}}], knowledgeCards: [{id: 'k1', user_id: 'a', subject: '数学', frontContent: '如何求距离？', backContent: '距离公式', fsrs: {stability: 99}}], sharedKnowledge: []};
  let saves = 0;
  const library = createSharedLibrary({db, persist: async () => {saves++;}, modelVersion: 'test-v1'});
  const call = (method, path, input = {}, user = {id: 'a', role: 'student'}) => library.handle({method, path, input, user});
  return {db, call, saves: () => saves};
}
test('章节合集公开快照无私人记录；两账号导入独立、重复提交幂等且一次落盘', async () => {
  const {db, call, saves} = setup();
  const published = await call('POST', '/v1/shared-knowledge/collections', {...publication, items: [{caseId: 'q1'}, {cardId: 'k1'}]});
  assert.equal(published.status, 201);
  assert.equal(published.body.kind, 'collection');
  assert.equal(JSON.stringify(published.body).includes('私人错误'), false);
  assert.equal(published.body.items[0].snapshot.analysis, '');
  assert.equal(JSON.stringify(published.body).includes('stability'), false);
  for (const owner of ['b', 'c']) {
    const before = saves();
    const copy = await call('POST', `/v1/shared-knowledge/${published.body.id}/import`, {}, {id: owner});
    assert.equal(copy.status, 201); assert.equal(copy.body.items.length, 2); assert.equal(saves(), before + 1);
    assert.equal(copy.body.items[0].mistakeCase.studentAnswer, '');
    assert.equal(copy.body.items[1].card.fsrs, null);
    const repeat = await call('POST', `/v1/shared-knowledge/${published.body.id}/import`, {}, {id: owner});
    assert.equal(repeat.status, 200); assert.equal(repeat.body.alreadyImported, true);
  }
  assert.equal(db.cases.filter(x => x.user_id === 'b').length, 1);
  assert.equal(db.cases.filter(x => x.user_id === 'c').length, 1);
});

test('许可、隐私、相似题确认、失败落盘和旧版本附件权限', async () => {
  const {db, call} = setup();
  assert.equal((await call('POST', '/v1/shared-knowledge/collections', {...publication, license:'personal', items:[{caseId:'q1'}]})).status, 422);
  assert.equal((await call('POST', '/v1/shared-knowledge', {...publication, description:'测试',fileName:'photo.png',fileType:'image/png',fileData:'YWJj'})).status,422);
  db.cases[0].question='正方体棱长为 2，求体积。';
  const published=await call('POST','/v1/shared-knowledge/collections',{...publication,items:[{caseId:'q1'}]});
  db.cases.push({id:'old-b',user_id:'b',subject:'数学',question:'正方体棱长为 3，求体积。',studentAnswer:'旧作答'});
  const route='/v1/shared-knowledge/'+published.body.id+'/import';
  assert.equal((await call('POST',route,{}, {id:'b'})).status,409);
  assert.equal(db.cases.filter(x=>x.user_id==='b').length,1);
  assert.equal((await call('POST',route,{allowSimilarEntryKeys:['case:q1']},{id:'b'})).status,201);
  assert.equal(db.cases.find(x=>x.id==='old-b').studentAnswer,'旧作答');
  const before=db.cases.length;
  const failing=createSharedLibrary({db,persist:async()=>{throw new Error('DISK_TEST_FAILURE');}});
  await assert.rejects(failing.handle({method:'POST',path:route,user:{id:'c'},input:{}}),/DISK_TEST_FAILURE/);
  assert.equal(db.cases.length,before);
  db.sharedKnowledge.push({id:'legacy-file',kind:'card',fileData:'YWJj',fileType:'image/png',fileName:'private.png',description:'旧资料'});
  const legacy=await call('GET','/v1/shared-knowledge/legacy-file',{}, {id:'b'});
  assert.equal(legacy.body.fileData,undefined); assert.equal(legacy.body.hasAttachment,false);
  const moderator={id:'mod',role:'admin'};
  const report=await call('POST','/v1/shared-knowledge/'+published.body.id+'/report',{category:'privacy',reason:'核查正文'}, {id:'b'});
  assert.equal((await call('GET','/v1/shared-knowledge/moderation',{}, {id:'b'})).status,403);
  assert.equal((await call('POST','/v1/shared-knowledge/reports/'+report.body.id+'/resolve',{action:'withdraw',reason:'隐私核查后下架'},moderator)).status,200);
  assert.equal((await call('POST',route,{}, {id:'c'})).status,410);
});

test('复用已校验几何和公共得分点；参考模型、改数值和过期版本不会误用', async () => {
  const {db, call} = setup();
  const original = db.cases[0];
  original.question = '正方体 ABCD-A1B1C1D1 棱长为 2，求 AB 长度。';
  original.geometryResult = buildVerifiedCubeGeometry({edge: 2});
  original.verificationStatus = 'verified_unique'; original.geometryCompilation = {versionKey: 'test-v1'};
  original.aiRubric = {scope: 'public_question', fingerprint: strictQuestionFingerprint(original.question, '数学'), steps: [{id: 's1', label: '观察 AB', hint: '寻找 AB', keywords: ['AB'], visual: {entities: ['AB'], focus: 'length', labels: [{text: 'AB', value: '2', fromAnswer: true}]}}], parts: [{id: 's1', label: '观察 AB', steps: ['s1']}]};
  original.geometryResult.scene.grid.providerPayload='PRIVATE_PROVIDER_PAYLOAD';
  original.geometryResult.scene.pedagogy.originalInput='PRIVATE_PROVIDER_PAYLOAD';
  original.aiRubric.steps[0].visual.personalNotes='PRIVATE_PROVIDER_PAYLOAD';
  const published = await call('POST', '/v1/shared-knowledge/collections', {...publication, items: [{caseId: 'q1', publicRubricConfirmed: true}]});
  const route = '/v1/shared-knowledge/' + published.body.id;
  assert.equal(JSON.stringify(published.body).includes('PRIVATE_PROVIDER_PAYLOAD'),false);
  const imported = await call('POST', route + '/import', {}, {id: 'b'});
  const copy = imported.body.items[0].mistakeCase;
  assert.ok(copy.geometryResult?.scene); assert.equal(copy.aiStepsStatus, 'ready');
  assert.equal(copy.aiRubric.steps[0].visual.entities[0], 'AB');
  assert.equal(copy.geometryCompilation.cacheHit, true); assert.notEqual(copy.geometryBuildStatus, 'queued');
  const fresh = (await call('GET', route + '/model?entryKey=case:q1', {}, {id: 'b'}));
  assert.equal(fresh.status, 200);
  original.question=original.question.replace('为 2','为 3');
  await call('PATCH',route,{...publication,expectedRevision:1,items:[{caseId:'q1'}]});
  copy.studentAnswer='我的独立计算';copy.learningProfile.fsrs={stability:7};
  await call('POST',route+'/update-copy',{copyId:copy.id,revision:2,fields:['question']},{id:'b'});
  assert.equal(copy.geometryResult,null);assert.equal(copy.aiRubric,null);assert.equal(copy.studentAnswer,'我的独立计算');assert.equal(copy.learningProfile.fsrs.stability,7);
  original.verificationStatus = 'ai_reference';
  const reference = await call('POST', '/v1/shared-knowledge/collections', {...publication, items: [{caseId: 'q1'}]});
  assert.equal(reference.body.items[0].resources.model, null);
  assert.equal((await call('POST', '/v1/shared-knowledge/' + reference.body.id + '/import', {}, {id: 'c'})).body.items[0].mistakeCase.geometryResult, null);
  original.verificationStatus = 'verified_unique'; original.geometryCompilation.versionKey = 'outdated';
  const outdated = await call('POST', '/v1/shared-knowledge/collections', {...publication, items: [{caseId: 'q1'}]});
  assert.equal(outdated.body.items[0].resources.model, null);
  assert.notEqual(strictQuestionFingerprint(original.question, '数学'), strictQuestionFingerprint(original.question.replace('为 3', '为 4'), '数学'));
  await call('DELETE', route);
  assert.equal((await call('GET', route + '/model?entryKey=case:q1', {}, {id: 'b'})).status, 410);
});

test('共享直线圆模型与公共得分点只在完整绑定一致时导入，且不带出个人学习记录', async () => {
  const {db, call} = setup();
  const original = db.cases[0];
  original.question = '圆 x²+y²=25 与直线 x=3 的交点和弦长。';
  original.studentAnswer = '我的私人草稿';
  original.learningProfile = {mastery: 91, fsrs: {stability: 12}};
  original.planeGeometry = compilePlaneGeometry({question: original.question, subject: '数学', confirmed: true, input: {
    schemaVersion: 'plane-ir/v1', circle: {id: 'circle-c', center: [0, 0], radius: 5}, line: {id: 'line-l', coefficients: [1, 0, -3]}
  }});
  original.aiRubric = {scope: 'public_question', fingerprint: strictQuestionFingerprint(original.question, '数学'),
    steps: [{id: 's1', label: '先看直线与圆', visual: {mode: 'highlight', entityIds: ['line-l', 'circle-c']}}],
    parts: [{id: 'p1', label: '确定交点', steps: ['s1']}]
  };
  original.aiRubric.planeVisualBinding = createPlaneVisualBinding(original);
  const published = await call('POST', '/v1/shared-knowledge/collections', {...publication, items: [{caseId: 'q1', publicRubricConfirmed: true}]});
  const entry = published.body.items[0];
  assert.ok(entry.resources.planeModel, '公开快照应含已校验二维模型');
  assert.equal(JSON.stringify(entry.resources).includes('我的私人草稿'), false);
  assert.equal(entry.resources.planeModel.model.solution, undefined, '公开快照不保存可直接读取的数值结果');
  assert.equal(entry.resources.planeModel.model.scene, undefined, '公开快照只带确定性参数，不带原始渲染场景');
  const exposed = await call('GET', `/v1/shared-knowledge/${published.body.id}/model?entryKey=case:q1`, {}, {id: 'b'});
  assert.equal(exposed.status, 200);
  assert.equal(exposed.body.renderVersion, 'shared-plane/v1');
  const imported = await call('POST', `/v1/shared-knowledge/${published.body.id}/import`, {}, {id: 'b'});
  const copy = imported.body.items[0].mistakeCase;
  assert.ok(copy.planeGeometry, '精确同题导入应绑定二维模型，而非重新生成');
  assert.equal(planeStepVisuals(copy).status, 'ready');
  assert.equal(copy.studentAnswer, '');
  assert.equal(copy.learningProfile.mastery, 0);
  assert.equal(copy.geometryResult, null);
  original.question = original.question.replace('x=3', 'x=4');
  const changed = await call('PATCH', `/v1/shared-knowledge/${published.body.id}`, {...publication, expectedRevision: 1, items: [{caseId: 'q1', publicRubricConfirmed: true}]});
  assert.equal(changed.status, 200);
  assert.equal(changed.body.items[0].resources.planeModel, null, '题干变化后旧二维快照不能复用');
});

test('教师逐项核对、更新作废审核；对比更新不覆盖个人理解，举报与撤回不删个人副本', async () => {
  const {db, call} = setup();
  const published = await call('POST', '/v1/shared-knowledge/collections', {...publication, items: [{caseId: 'q1'}, {cardId: 'k1'}]});
  const route = '/v1/shared-knowledge/' + published.body.id;
  assert.equal((await call('POST', route + '/review', {revision: 1, entryKeys: ['case:q1', 'card:k1']})).status, 403);
  await call('POST', route + '/review', {revision: 1, entryKeys: ['case:q1']}, {id: 't', role: 'teacher'});
  assert.equal((await call('GET', route)).body.teacherReviewed, false);
  await call('POST', route + '/review', {revision: 1, entryKeys: ['card:k1']}, {id: 't', role: 'teacher'});
  assert.equal((await call('GET', route)).body.teacherReviewed, true);
  const imported = await call('POST', route + '/import', {}, {id: 'b'});
  const card = imported.body.items[1].card;
  card.backContent = '我的独立理解'; card.fsrs = {stability: 8};
  db.knowledgeCards.find(x => x.id === 'k1').backContent = '更新的公共方法';
  assert.equal((await call('PATCH', route, {...publication, expectedRevision: 1, items: [{caseId: 'q1'}, {cardId: 'k1'}]})).status, 200);
  const updated = (await call('GET', route)).body;
  assert.equal(updated.revision, 2); assert.equal(updated.teacherReviewed, false);
  assert.equal(db.sharedKnowledge[0].versions[0].items[1].snapshot.backContent, '距离公式');
  const compare = await call('GET', route + '/compare?copyId=' + card.id, {}, {id: 'b'});
  assert.equal(compare.body.personal.backContent, '我的独立理解'); assert.equal(compare.body.latest.backContent, '更新的公共方法');
  assert.equal((await call('POST', route + '/update-copy', {copyId: card.id, revision: 2, fields: ['backContent']}, {id: 'b'})).status, 200);
  assert.equal(card.backContent, '更新的公共方法'); assert.equal(card.fsrs.stability, 8);
  assert.equal((await call('POST', route + '/report', {category: 'copyright', reason: '请核查授权'}, {id: 'b'})).status, 201);
  assert.equal((await call('GET', route)).status, 200, '举报不等于违规');
  assert.equal((await call('DELETE', route, {}, {id: 'b'})).status, 403);
  assert.equal((await call('DELETE', route)).status, 200);
  assert.equal((await call('POST', route + '/import', {}, {id: 'c'})).status, 410);
  assert.equal(db.knowledgeCards.includes(card), true);
  assert.equal((await call('GET', '/v1/shared-knowledge/updates', {}, {id: 'b'})).body.some(x => x.unavailable), true);
});
