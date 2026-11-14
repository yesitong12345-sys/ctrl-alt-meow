import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const {port} = server.address();
    server.close(() => resolve(port));
  });
});

const waitFor = async (check, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('timed out waiting for server state');
};

async function withServer(t) {
  const port = await reservePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-text-'));
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_FILE: path.join(tempDir, 'data.json'), MODEL_CONFIG_FILE: path.join(tempDir, 'model-config.json'), DEEPSEEK_API_KEY: ''},
    windowsHide: true,
    stdio: 'ignore'
  });
  t.after(async () => {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => (await fetch(`${base}/health`)).ok);
  return base;
}

test('粘贴题目后后台独立复核并自动进入求解队列', async t => {
  const base = await withServer(t);
  const questionText = '正四棱锥 P-ABCD 的底面边长为 6，高为 3，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。';
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText, studentAnswer: '我不会建立坐标系'})
  });

  assert.equal(response.status, 202);
  const ingestion = await response.json();
  assert.equal(ingestion.templateId, 'regular-quad-pyramid-be-pac');
  assert.equal(ingestion.workflowStatus, 'queued');
  assert.equal(ingestion.internalReview.status, 'passed');
  assert.equal(ingestion.internalReview.independent, true);
  assert.deepEqual(ingestion.confirmedRelationIds, ['r-base', 'r-height']);
  assert.deepEqual(ingestion.parameters, {
    baseEdge: {op: 'integer', value: 6},
    height: {op: 'integer', value: 3}
  });
  assert.equal(ingestion.draft.question, questionText);
  assert.equal(ingestion.draft.studentAnswer, '我不会建立坐标系');
  assert.equal(ingestion.draft.extraction.source, 'deterministic_text_parser');
  assert.equal(ingestion.draft.extraction.requiresConfirmation, false);
  assert.equal(typeof ingestion.workflowId, 'string');
});

test('随机出题会重掷不规整答案并自动进入后台复核', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/geometry/random-problems`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({seed: 7})
  });

  assert.equal(response.status, 202);
  const ingestion = await response.json();
  assert.equal(ingestion.source, 'random');
  assert.equal(ingestion.workflowStatus, 'queued');
  assert.equal(ingestion.randomization.seed, 7);
  assert.equal(ingestion.randomization.clean, true);
  assert.ok(ingestion.randomization.attempts >= 1);
  assert.match(ingestion.draft.question, /底面边长为\s*\d+/);
  assert.match(ingestion.draft.question, /高为\s*\d+/);
  assert.equal(ingestion.internalReview.status, 'passed');
  assert.equal(ingestion.draft.extraction.requiresConfirmation, false);
  assert.equal(typeof ingestion.workflowId, 'string');
  assert.equal('answer' in ingestion.randomization, false);
});

test('文本题仅提交一次就由 SymPy 验证并保留原题写回错题案例', async t => {
  const base = await withServer(t);
  const questionText = '正四棱锥 P-ABCD 的底面边长为 2，高为 1，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。';
  const ingestionResponse = await fetch(`${base}/v1/ingestions`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText})
  });
  const ingestion = await ingestionResponse.json();
  const workflow = await waitFor(async () => {
    const response = await fetch(`${base}/v1/workflows/geometry/${ingestion.workflowId}`);
    const value = await response.json();
    return value.workflowStatus === 'completed' ? value : null;
  });

  assert.equal(workflow.solverStatus, 'verified');
  assert.equal(workflow.result.answer.displayPlain, '2√22/11');
  assert.equal(workflow.mistakeCase.question, questionText);
  assert.equal(workflow.mistakeCase.verificationStatus, 'verified');
  assert.equal(workflow.mistakeCase.internalReview.status, 'passed');

  const casesResponse = await fetch(`${base}/v1/mistake-cases`);
  assert.equal(casesResponse.status, 200);
  const cases = await casesResponse.json();
  assert.ok(cases.some(item => item.id === workflow.mistakeCase.id));
  assert.ok(cases.some(item => item.question === questionText));
});

test('主上传入口可由截面直径与中心距反推球半径并直接写入带 3D 的错题库', async t => {
  const base = await withServer(t);
  const questionText = '平面截一球得到直径是6的圆面，球心到这个平面的距离是4，求球体积。';
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText})
  });
  const ingestion = await response.json();
  assert.equal(response.status, 201);
  assert.equal(ingestion.status, 'verified');
  assert.equal(ingestion.mistakeCase.question, questionText);
  assert.equal(ingestion.mistakeCase.geometryResult.solverStatus, 'verified');
  assert.ok(ingestion.mistakeCase.geometryResult.scene.elements.some(item => item.type === 'sphere'));
  assert.ok(ingestion.mistakeCase.geometryResult.scene.elements.some(item => item.type === 'section-circle'));
});

test('图片未被真实读取时保留本次提交，禁止伪造模型但允许进入陪练闭环', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'image', fileName: '立体几何题.png', imageData: 'data:image/png;base64,AA==',
      questionText: '四面体 ABCD 中，AD 垂直于平面 ABC，建立空间直角坐标系。'
    })
  });
  assert.equal(response.status, 202);
  const ingestion = await response.json();
  assert.equal(ingestion.error, 'IMAGE_EXTRACTION_UNAVAILABLE');
  assert.equal(ingestion.status, 'model_unsupported');
  assert.match(ingestion.guidance, /不是漏拍或缺条件/);
  assert.equal(ingestion.internalReview.status, 'failed');
  assert.equal(ingestion.internalReview.independent, true);
  assert.equal(ingestion.mistakeCase.verificationStatus, 'learning_without_3d');
  assert.equal(ingestion.mistakeCase.geometryResult, undefined);
  assert.equal(ingestion.mistakeCase.correctAnswer, undefined);
  assert.equal(typeof ingestion.draft.question, 'string');
});

test('图片缺少真实视觉识别时创建无模型学习记录，而不是占位 3D 案例', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'image',
      fileName: 'student-upload.png',
      imageData: 'data:image/png;base64,AA=='
    })
  });
  const result = await response.json();

  assert.equal(response.status, 202);
  assert.equal(result.error, 'IMAGE_EXTRACTION_UNAVAILABLE');
  assert.equal(result.status, 'needs_more_context');
  assert.equal(result.internalReview.status, 'failed');
  assert.equal(result.mistakeCase.verificationStatus, 'learning_without_3d');
  assert.equal(result.mistakeCase.visualization.renderer, 'none');
});

test('文本题缺少可验证关系时请求学生补充而不是要求重新提交', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText: '正四棱锥的高为 3，求夹角。'})
  });
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.equal(result.status, 'needs_more_context');
  assert.equal(typeof result.id, 'string');
  assert.ok(result.supplementPanel.missingItems.some(item => item.id === 'solid-topology'));
  assert.ok(result.supplementPanel.missingItems.some(item => item.id === 'target-relation'));
  assert.ok(!result.supplementPanel.missingItems.some(item => item.id === 'base-edge'));
});

test('只缺数值尺寸时明确指出缺项，补充后复用原题进入同一建模队列', async t => {
  const base = await withServer(t);
  const first = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '正四棱锥 P-ABCD 中，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。',
      studentAnswer: '我不知道怎么构造法向量。'
    })
  });
  const incomplete = await first.json();
  assert.equal(first.status, 202);
  assert.equal(incomplete.status, 'needs_more_context');
  assert.deepEqual(incomplete.supplementPanel.missingItems.map(item => item.id), ['base-edge', 'pyramid-height']);
  assert.match(incomplete.supplementPanel.learningDiagnosis.likelyAssessment, /线面角/);
  assert.match(incomplete.supplementPanel.learningDiagnosis.errorInference.likelyStuckPoint, /法向量/);

  const second = await fetch(`${base}/v1/ingestions/${incomplete.id}/supplements`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({supplementText: '底面边长为 6，棱锥的高为 3。'})
  });
  const completed = await second.json();
  assert.equal(second.status, 202);
  assert.equal(completed.id, incomplete.id);
  assert.equal(completed.revision, 2);
  assert.equal(completed.workflowStatus, 'queued');
  assert.match(completed.draft.question, /补充信息/);
  assert.equal(typeof completed.workflowId, 'string');
});

test('标准正方体题给出棱长后直接生成基础模型，不再误报引擎未覆盖', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '在正方体 ABCD-A1B1C1D1 中，棱长为 2，求直线 AC1 与平面 ABCD 所成角的正弦值。'
    })
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.status, 'verified');
  assert.equal(result.mistakeCase.geometryResult.modelKind, 'cube');
  assert.equal(result.mistakeCase.visualization.interactive, true);
});

test('根式或分数尺寸已经给出时不得误报为学生漏拍', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '正四棱锥 P-ABCD 中，底面边长为 2√3，高为 3/2，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。'
    })
  });
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.equal(result.status, 'model_unsupported');
  assert.equal(result.supplementPanel.informationComplete, true);
  assert.deepEqual(result.supplementPanel.missingItems, []);
  assert.equal(result.supplementPanel.facts.baseExpression, '2√3');
  assert.equal(result.supplementPanel.facts.heightExpression, '3/2');
});

test('三阶迁移首次作答会创建真实错题记录并为几何题生成同源模型', async t => {
  const base = await withServer(t);
  const transferId = 'transfer-case-near-1';
  const question = '正四棱锥 P-ABCD 的底面边长为 4，高为 2，E 是 PC 的中点。求直线 BE 与平面 PAC 所成角的正弦值。';
  const response = await fetch(`${base}/v1/transfer-items`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      id: transferId,
      parentCaseId: 'parent-case',
      transferLevel: 'near',
      question,
      studentAnswer: '先建立坐标系，再求方向向量和法向量。',
      subject: '数学·几何',
      unit: '立体几何',
      knowledgePoints: ['线面角'],
      microSkills: ['方向向量与法向量夹角转换'],
      errorCauses: ['余角关系与 sin/cos 判断不稳定']
    })
  });

  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.mistakeCase.id, transferId);
  assert.equal(result.mistakeCase.origin, 'transfer_training');
  assert.equal(result.mistakeCase.parentCaseId, 'parent-case');
  assert.equal(result.mistakeCase.subject, '数学');
  assert.equal(result.mistakeCase.unit, '空间几何');
  assert.equal(result.mistakeCase.geometryResult.solverStatus, 'verified');

  const cases = await (await fetch(`${base}/v1/mistake-cases`)).json();
  assert.ok(cases.some(item => item.id === transferId));
});

test('空间向量迁移题也会生成可交互的确定性空间模型', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/transfer-items`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      id: 'transfer-vector-variant',
      parentCaseId: 'parent-case',
      transferLevel: 'variant',
      question: '已知直线 l 的方向向量为 (1,2,2)，平面 α 的法向量为 (0,1,0)。求直线 l 与平面 α 所成角的正弦值。',
      studentAnswer: '待开始作答',
      subject: '数学',
      unit: '空间几何',
      knowledgePoints: ['线面角']
    })
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.mistakeCase.geometryResult.solverStatus, 'verified');
  assert.equal(result.mistakeCase.geometryResult.scene.grid.valueSource, 'canonicalCoordinates');
  assert.ok(result.mistakeCase.geometryResult.scene.elements.some(item => item.type === 'plane'));
});

test('线段式尺寸（AB=4、PO=3）视为已给出完整题目，直接进入求解队列', async t => {
  const base = await withServer(t);
  const questionText = '正四棱锥 P-ABCD 中，AB=4，PO=3（O 为底面中心），E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。';
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText, studentAnswer: '我不会建系'})
  });

  assert.equal(response.status, 202);
  const ingestion = await response.json();
  assert.equal(ingestion.workflowStatus, 'queued');
  assert.equal(ingestion.templateId, 'regular-quad-pyramid-be-pac');
  assert.equal(ingestion.internalReview.status, 'passed');
  assert.deepEqual(ingestion.parameters, {
    baseEdge: {op: 'integer', value: 4},
    height: {op: 'integer', value: 3}
  });
});

test('正方体纯角度问题不需要棱长，不误报缺失建模条件', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '在正方体 ABCD-A1B1C1D1 中，求直线 AC1 与平面 ABCD 所成角的正弦值。'
    })
  });
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.equal(result.status, 'model_unsupported');
  assert.equal(result.supplementPanel.informationComplete, true);
  assert.deepEqual(result.supplementPanel.missingItems, []);
  assert.match(result.guidance, /不是漏拍或缺条件/);
});

test('正方体选择题给出棱长后生成可旋转的已验证基础模型', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '正方形ABCD-a 1 B 1 C 1 D1的正方体棱长为一。动点E在线段A1 C1上，F、M分别是AB、CD的中点，则下列结论中正确的是。A. FM平行于A1C1 B. BM垂直于平面CC1EF C. 存在点E使平面BEF平行于平面CC1D1D D. 三棱锥B-CEF的体积为定值'
    })
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.mistakeCase.geometryResult.solverStatus, 'verified');
  assert.equal(result.mistakeCase.geometryResult.scene.elements.some(item => item.type === 'segment'), true);
  assert.equal(Object.keys(result.mistakeCase.geometryResult.canonicalCoordinates).length, 8);
});

test('DeepSeek 不可用时两垂直正方形题仍由本地开放曲面构造器生成 3D',async t=>{
  const base=await withServer(t),questionText='已知正方形ABCD和正方形a def的边长均为6，且它们所在的平面互相垂直，O是BE的中点，向量FM=1/2向量MA，则线段OM的长为多少';
  const response=await fetch(`${base}/v1/ingestions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'text',questionText})});
  assert.equal(response.status,201);
  const payload=await response.json();
  assert.equal(payload.status,'verified');
  assert.equal(payload.mistakeCase.geometryResult.modelKind,'surface_complex');
  assert.ok(Math.abs(payload.queryResults['segment-length-OM'].value-Math.sqrt(19))<1e-9);
  assert.equal(payload.mistakeCase.visualization.interactive,true);
  assert.ok(payload.mistakeCase.geometryResult.scene.elements.some(item=>item.id==='construction-F-M'));
});

test('圆柱半径和高已经充分时直接验证建模，不再误报缺顶点对应关系', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '圆柱的底面半径为 3，高为 5，求体积和表面积。'
    })
  });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.status, 'verified');
  assert.equal(result.mistakeCase.problemSpec.body.type, 'right_cylinder');
  assert.equal(result.mistakeCase.geometryResult.solverStatus, 'verified');
  assert.ok(result.mistakeCase.geometryResult.scene.elements.some(item => item.type === 'cylinder'));
});

test('已给出的尺寸通过“底边为 4”表述时不误报为缺失', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '正四棱锥 P-ABCD 中，底边为 4，高为 3，E 是 PC 的中点，求 BE 与平面 PAC 所成角的正弦值。'
    })
  });
  const ingestion = await response.json();
  assert.equal(response.status, 202);
  assert.equal(ingestion.workflowStatus, 'queued');
  assert.equal(ingestion.internalReview.status, 'passed');
  assert.deepEqual(ingestion.parameters, {
    baseEdge: {op: 'integer', value: 4},
    height: {op: 'integer', value: 3}
  });
});

test('棱长均相等的正四棱锥 S-ABCD 求 AE 与 BS 所成角余弦：完整题直接建模', async t => {
  const base = await withServer(t);
  const questionText = '在模长均相等的正四棱锥S-ABCD中：E是sC的中点。求AE与bs所成角的余弦值为';
  const ingestionResponse = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText})
  });
  const ingestion = await ingestionResponse.json();
  assert.equal(ingestionResponse.status, 202);
  assert.equal(ingestion.templateId, 'regular-quad-pyramid-all-equal-cos');
  assert.equal(ingestion.workflowStatus, 'queued');
  assert.equal(ingestion.internalReview.status, 'passed');
  assert.equal(ingestion.parameters.apex, 'S');
  assert.deepEqual(ingestion.confirmedRelationIds, ['r-mid', 'r-eq']);

  const workflow = await waitFor(async () => {
    const response = await fetch(`${base}/v1/workflows/geometry/${ingestion.workflowId}`);
    const value = await response.json();
    return value.workflowStatus === 'completed' ? value : null;
  });
  assert.equal(workflow.solverStatus, 'verified');
  assert.equal(workflow.result.answer.displayPlain, '√5/10');
  assert.equal(workflow.mistakeCase.question, questionText);
  assert.equal(workflow.mistakeCase.verificationStatus, 'verified');
  assert.equal(workflow.mistakeCase.correctAnswer, '√5/10');
  assert.equal(workflow.mistakeCase.problemSpec.query.type, 'segment_angle_cosine');
  assert.equal(workflow.mistakeCase.geometryResult.scene.elements.some(item => item.type === 'segment'), true);
});

test('其他顶点字母的完整题目只如实提示能力边界，不再误报缺所求', async t => {
  const base = await withServer(t);
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      source: 'text',
      questionText: '在正四棱锥S-ABCD中，求AE与BS所成角的余弦值。'
    })
  });
  const result = await response.json();
  assert.equal(response.status, 202);
  assert.equal(result.status, 'model_unsupported');
  assert.equal(result.supplementPanel.informationComplete, true);
  assert.deepEqual(result.supplementPanel.missingItems, []);
  assert.match(result.guidance, /不是漏拍或缺条件/);
});

test('投影与二面角条件完整的三棱锥会生成经过验证的三维模型', async t => {
  const base = await withServer(t);
  const questionText = 'T6)如图，在三棱锥A-BCD中，点A在平面BCD的射影为O，BO⊥CD，AD⊥BC，BCD=60°。二面角A-BC-D，A-CD-B的大小分别为60°，45°，且BC=2+√3. H6 (1)证明AB⊥CD；(2)求AD与平面BCD所成角的正弦值；(3)求三棱锥A-BCD的体积。';
  const response = await fetch(`${base}/v1/ingestions`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({source: 'text', questionText})
  });
  const ingestion = await response.json();

  assert.equal(response.status, 201);
  assert.equal(ingestion.status, 'verified');
  assert.equal(ingestion.mistakeCase.verificationStatus, 'verified');
  assert.equal(ingestion.mistakeCase.problemSpec.schemaVersion, 'geometry-ir/v3.0');
  assert.equal(ingestion.mistakeCase.problemSpec.entities.some(item => item.type === 'triangular_pyramid'), true);
  assert.equal(ingestion.mistakeCase.geometryResult.solverStatus, 'verified');
  assert.equal(ingestion.mistakeCase.correctAnswer, '(1) AB⊥CD；(2) sin = √5/5；(3) V = √3 + 15/8');
  assert.equal(ingestion.mistakeCase.geometryResult.scene.frameEdges.length, 6);
  assert.deepEqual(ingestion.mistakeCase.problemSpec.subproblems.map(item => item.id), ['q1', 'q2', 'q3']);
  assert.equal(ingestion.mistakeCase.geometryResult.scene.subproblemViews, undefined);
  assert.equal(ingestion.mistakeCase.geometryResult.scene.elements.some(item => item.role === 'subproblem-auxiliary'), false);
  assert.deepEqual(Object.keys(ingestion.mistakeCase.geometryResult.canonicalCoordinates).sort(), ['A','B','C','D','O']);
  assert.deepEqual(ingestion.mistakeCase.geometryResult.verification.checks, [
    'PROJECTION_PERPENDICULAR_BASE',
    'BO_PERPENDICULAR_CD',
    'AD_PERPENDICULAR_BC',
    'BASE_ANGLE_BCD',
    'DIHEDRAL_BC',
    'DIHEDRAL_CD',
    'BC_LENGTH',
    'QUERY_CROSSCHECK'
  ]);
});

test('网页服务同时提供本地 KaTeX 静态资源', async t => {
  const base = await withServer(t);
  for (const file of ['katex.min.js', 'auto-render.min.js', 'katex.min.css']) {
    const response = await fetch(`${base}/vendor/katex/${file}`);
    assert.equal(response.status, 200, `${file} should be served`);
    assert.ok(Number(response.headers.get('content-length') || (await response.arrayBuffer()).byteLength) > 100);
  }
});
