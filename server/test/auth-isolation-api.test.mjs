import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import test from 'node:test';

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const {port} = server.address();
    server.close(() => resolve(port));
  });
});

const waitForHealth = async base => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('server did not become healthy');
};

const jsonRequest = async (url, {token, method = 'GET', body} = {}) => fetch(url, {
  method,
  headers: {
    ...(body ? {'content-type': 'application/json'} : {}),
    ...(token ? {authorization: `Bearer ${token}`} : {})
  },
  ...(body ? {body: JSON.stringify(body)} : {})
});

test('新注册学生从空错题库开始，旧演示题留在原归属而不被删除', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-new-empty-'));
  const dataFile = path.join(tempDir, 'data.json');
  await writeFile(dataFile, JSON.stringify({cases: [{
    id: 'local-demo-case', user_id: 'local-student', studentId: 'local-student',
    subject: '数学', question: '旧本机演示题', knowledgePoints: ['二面角'], createdAt: new Date().toISOString()
  }]}), 'utf8');
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, HOST: '127.0.0.1', PORT: String(port), PORT_PROBE_LIMIT: '1',
      AUTH_REQUIRED: '1', DATA_FILE: dataFile, DEEPSEEK_API_KEY: ''},
    windowsHide: true, stdio: 'ignore'
  });
  try {
    await waitForHealth(base);
    const registered = await jsonRequest(`${base}/v1/auth/register`, {
      method: 'POST', body: {loginName: 'new-student', displayName: '新学生', password: 'Geometry!2026'}
    });
    assert.equal(registered.status, 201);
    const {sessionToken} = await registered.json();
    const cases = await jsonRequest(`${base}/v1/mistake-cases`, {token: sessionToken});
    assert.equal(cases.status, 200);
    assert.deepEqual(await cases.json(), []);
    const saved = JSON.parse(await readFile(dataFile, 'utf8'));
    assert.ok(saved.cases.some(item => item.id === 'local-demo-case' && item.user_id === 'local-student'),
      '只隔离展示，不删除旧账号的数据');
  } finally {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('school auth mode isolates verified mistake cases between students', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-auth-'));
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      AUTH_REQUIRED: '1',
      DATA_FILE: path.join(tempDir, 'data.json'),
      DEEPSEEK_API_KEY: ''
    },
    windowsHide: true,
    stdio: 'ignore'
  });

  try {
    await waitForHealth(base);

    const anonymousCases = await jsonRequest(`${base}/v1/mistake-cases`);
    assert.equal(anonymousCases.status, 401);

    const register = async (loginName, displayName) => {
      const response = await jsonRequest(`${base}/v1/auth/register`, {
        method: 'POST',
        body: {loginName, displayName, password: 'Geometry!2026'}
      });
      assert.equal(response.status, 201);
      return response.json();
    };

    const studentA = await register('student-a', '学生 A');
    const studentB = await register('student-b', '学生 B');
    assert.notEqual(studentA.sessionToken, studentB.sessionToken);
    assert.notEqual(studentA.user.id, studentB.user.id);

    const ingestionResponse = await jsonRequest(`${base}/v1/ingestions`, {
      token: studentA.sessionToken,
      method: 'POST',
      body: {
        source: 'text',
        questionText: '一个圆柱的底面半径为3，高为4，作一个平行于底面的截面，求截面面积。',
        studentAnswer: '我还不确定截面与底面的关系。'
      }
    });
    assert.equal(ingestionResponse.status, 201);
    const ingestion = await ingestionResponse.json();
    assert.equal(ingestion.mistakeCase.studentId, studentA.user.id);
    assert.equal(ingestion.mistakeCase.correctAnswer, '平行底面截面面积 = 9π');
    assert.ok(ingestion.mistakeCase.geometryResult.scene.elements.some(element => element.type === 'section-circle'));

    const casesA = await (await jsonRequest(`${base}/v1/mistake-cases`, {token: studentA.sessionToken})).json();
    const casesB = await (await jsonRequest(`${base}/v1/mistake-cases`, {token: studentB.sessionToken})).json();
    assert.equal(casesA.length, 1);
    assert.equal(casesA[0].id, ingestion.mistakeCase.id);
    assert.equal(casesB.length, 0);

    const me = await jsonRequest(`${base}/v1/auth/me`, {token: studentA.sessionToken});
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, studentA.user.id);
  } finally {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  }
});

test('a student cannot retrieve or tutor another student\'s case by guessing ids', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'educompanion-auth-access-'));
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, PORT: String(port), AUTH_REQUIRED: '1', DATA_FILE: path.join(tempDir, 'data.json'), DEEPSEEK_API_KEY: ''},
    windowsHide: true,
    stdio: 'ignore'
  });

  try {
    await waitForHealth(base);
    const register = async loginName => (await (await jsonRequest(`${base}/v1/auth/register`, {
      method: 'POST', body: {loginName, displayName: loginName, password: 'Geometry!2026'}
    })).json());
    const studentA = await register('private-a');
    const studentB = await register('private-b');
    const intakeResponse = await jsonRequest(`${base}/v1/wrong-questions/preview`, {
      token:studentA.sessionToken,method:'POST',
      body:{source:'text',questionText:'已知 f(x)=x²，求 f(2)。',studentId:studentB.user.id}
    });
    assert.equal(intakeResponse.status,201);
    const intake=(await intakeResponse.json()).draft;
    assert.equal(intake.user_id,studentA.user.id);
    const foreignConfirm=await jsonRequest(`${base}/v1/wrong-questions/drafts/${intake.id}/confirm`,{
      token:studentB.sessionToken,method:'POST',body:{question:'恶意修改'}
    });
    assert.equal(foreignConfirm.status,404);
    const ownConfirm=await jsonRequest(`${base}/v1/wrong-questions/drafts/${intake.id}/confirm`,{
      token:studentA.sessionToken,method:'POST',body:{question:'已知 f(x)=x²，求 f(2)。',subject:'数学'}
    });
    assert.equal(ownConfirm.status,201);
    assert.equal((await ownConfirm.json()).mistakeCase.user_id,studentA.user.id);
    const ingestion = await (await jsonRequest(`${base}/v1/ingestions`, {
      token: studentA.sessionToken,
      method: 'POST',
      body: {source: 'text', questionText: '一个圆柱的底面半径为3，高为4，求它的体积。'}
    })).json();

    const foreignIngestion = await jsonRequest(`${base}/v1/ingestions/${ingestion.id}`, {token: studentB.sessionToken});
    assert.equal(foreignIngestion.status, 404);

    const foreignSupplement = await jsonRequest(`${base}/v1/ingestions/${ingestion.id}/supplements`, {
      token: studentB.sessionToken,
      method: 'POST',
      body: {supplementText: '恶意覆盖'}
    });
    assert.equal(foreignSupplement.status, 404);

    const workflow = await (await jsonRequest(`${base}/v1/workflows/geometry`, {
      token: studentA.sessionToken,
      method: 'POST',
      body: {questionText: '测试个人工作流'}
    })).json();
    const foreignWorkflow = await jsonRequest(`${base}/v1/workflows/geometry/${workflow.id}`, {token: studentB.sessionToken});
    assert.equal(foreignWorkflow.status, 404);

    const foreignTutor = await jsonRequest(`${base}/v1/tutor/sessions`, {
      token: studentB.sessionToken,
      method: 'POST',
      body: {caseId: ingestion.caseId, context: {question: ingestion.mistakeCase.question}}
    });
    assert.equal(foreignTutor.status, 404);

    const ownTutorResponse = await jsonRequest(`${base}/v1/tutor/sessions`, {
      token: studentA.sessionToken,
      method: 'POST',
      body: {
        caseId: ingestion.caseId,
        context: {question: ingestion.mistakeCase.question, knowledgePoints:['圆柱体积']},
        initialStudentMessage: '我先用方向向量与法向量的点积和两个模长，最后得到 sin=2/11√22。'
      }
    });
    assert.ok([200,201].includes(ownTutorResponse.status));
    const ownTutor = await ownTutorResponse.json();
    const generatedCardsResponse = await jsonRequest(`${base}/v1/tutor/sessions/${ownTutor.id}/knowledge-cards`, {
      token: studentA.sessionToken,
      method: 'POST',
      body: {localOnly:true}
    });
    assert.equal(generatedCardsResponse.status, 200);
    const generatedCards = (await generatedCardsResponse.json()).cards;
    assert.ok(generatedCards.length > 0);
    assert.ok(generatedCards.every(card => card.studentId === studentA.user.id));
    assert.ok(generatedCards.every(card => card.user_id === studentA.user.id));
    const cardsForA = await (await jsonRequest(`${base}/v1/knowledge-cards`, {token: studentA.sessionToken})).json();
    const cardsForB = await (await jsonRequest(`${base}/v1/knowledge-cards`, {token: studentB.sessionToken})).json();
    assert.ok(cardsForA.some(card => card.id === generatedCards[0].id));
    assert.equal(cardsForB.length, 0);
    const foreignCardPatch = await jsonRequest(`${base}/v1/knowledge-cards/${generatedCards[0].id}`, {
      token: studentB.sessionToken,
      method: 'PATCH',
      body: {favorite:true}
    });
    assert.equal(foreignCardPatch.status, 404);
    const foreignCardReview = await jsonRequest(`${base}/v1/knowledge-cards/${generatedCards[0].id}/reviews`, {
      token: studentB.sessionToken, method:'POST', body:{studentAnswer:'先找投影'}
    });
    assert.equal(foreignCardReview.status, 404);

    const selfCardResponse = await jsonRequest(`${base}/v1/study/understanding`, {
      token: studentA.sessionToken, method:'POST',
      body:{text:'我现在会先找线面角的投影，再检查角的关系。',knowledgePoint:'线面角',studentId:studentB.user.id}
    });
    assert.equal(selfCardResponse.status, 201);
    const selfCard=(await selfCardResponse.json()).card;
    assert.equal(selfCard.user_id, studentA.user.id);
    assert.equal(selfCard.studentId, studentA.user.id);
    const foreignQueue=await (await jsonRequest(`${base}/v1/study/review-queue`,{token:studentB.sessionToken})).json();
    assert.ok(!foreignQueue.items.some(item=>item.id===selfCard.id));

    const privateNoteResponse = await jsonRequest(`${base}/v1/note-sources`, {
      token: studentA.sessionToken,
      method: 'POST',
      body: {sourceType:'paste', title:'学生 A 的私人笔记', content:'我总是混淆线面角与法向量夹角。'}
    });
    assert.equal(privateNoteResponse.status, 201);
    const privateNote = await privateNoteResponse.json();
    assert.equal(privateNote.studentId, studentA.user.id);
    const foreignNoteCards = await jsonRequest(`${base}/v1/note-sources/${privateNote.id}/knowledge-cards`, {
      token: studentB.sessionToken,
      method: 'POST',
      body: {}
    });
    assert.equal(foreignNoteCards.status, 404);
  } finally {
    child.kill();
    await rm(tempDir, {recursive: true, force: true});
  }
});
