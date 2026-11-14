import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';

const freePort = () => new Promise(resolve => {const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});});

test('public entry without demo password still requires student authentication for personal data', async () => {
  const unit=await readFile(new URL('../../deployment/tencent-demo/educompanion.service',import.meta.url),'utf8');
  const start=unit.split(/\r?\n/).find(line=>line.startsWith('ExecStart='));
  assert(start.startsWith('ExecStart=/usr/bin/env '));
  const overrides=Object.fromEntries(start.split(' ').slice(1,-2).map(item=>{const i=item.indexOf('=');assert(i>0);return [item.slice(0,i),item.slice(i+1)];}));
  assert.deepEqual(overrides,{DEMO_DEPLOYMENT:'0',DEMO_ACCESS_PASSWORD:'',AUTH_REQUIRED:'1'});
  const temp=await mkdtemp(path.join(os.tmpdir(),'edu-no-demo-gate-'));
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PORT_PROBE_LIMIT:'1',AUTH_REQUIRED:'1',
      DATA_FILE:path.join(temp,'data.json'),MODEL_CONFIG_FILE:path.join(temp,'absent.json'),
      DEEPSEEK_API_KEY:'',DEMO_DEPLOYMENT:'1',DEMO_ACCESS_PASSWORD:'legacy-demo-password',DEMO_SESSION_SECRET:'legacy-session-secret',...overrides},stdio:'ignore',windowsHide:true});
  try {
    let ready=false;
    for(let i=0;i<100;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,50));}
    assert.equal(ready,true);
    assert.doesNotMatch(await (await fetch(base)).text(),/演示访问密码/);
    assert.equal((await fetch(base+'/three.module.js')).status,200);
    assert.equal((await fetch(base+'/v1/mistake-cases')).status,401);
    const register=await fetch(base+'/v1/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginName:'public-entry-test',displayName:'测试',password:'TestPassword2026'})});
    assert.equal(register.status,201);
    const account=await register.json();
    const cases=await fetch(base+'/v1/mistake-cases',{headers:{authorization:`Bearer ${account.sessionToken}`}});
    assert.equal(cases.status,200);
    assert.deepEqual(await cases.json(),[]);
  } finally {child.kill();await new Promise(done=>child.exitCode!==null?done():child.once('exit',done));await rm(temp,{recursive:true,force:true});}
});

test('server accepts a four-digit demo PIN only with the opt-in environment flag', async () => {
  const temp=await mkdtemp(path.join(os.tmpdir(),'edu-short-pin-'));
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PORT_PROBE_LIMIT:'1',AUTH_REQUIRED:'1',
      DATA_FILE:path.join(temp,'data.json'),DEEPSEEK_API_KEY:'',DEMO_ACCESS_PASSWORD:'2468',
      DEMO_ALLOW_SHORT_PIN:'1',DEMO_SESSION_SECRET:'test-only-session-secret'},stdio:'ignore',windowsHide:true});
  try {
    let ready=false;
    for(let i=0;i<80;i++) {try {const page=await fetch(base);if(page.status===200){ready=true;break;}}catch{}await new Promise(done=>setTimeout(done,50));}
    assert.equal(ready,true,'isolated server started');
    const access=await fetch(base+'/demo-access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'2468'})});
    assert.equal(access.status,200);
    assert.match(access.headers.get('set-cookie')||'',/HttpOnly/);
  } finally {child.kill();await rm(temp,{recursive:true,force:true});}
});

test('remote browser never loads shared local mistake cache and reloads after account switch', async () => {
  const html=await readFile(path.resolve(import.meta.dirname,'../../implementation/index.html'),'utf8');
  const account=await readFile(path.resolve(import.meta.dirname,'../../implementation/account-settings.js'),'utf8');
  assert.match(html,/REMOTE_SERVER_PAGE&&key===KEY\)return null/);
  assert.match(html,/REMOTE_SERVER_PAGE&&key===KEY\)return;/);
  assert.match(html,/window\.__eduAccountChanged=async function\(userId\)/);
  assert.match(account,/setSession\(result\);[\s\S]*location\.reload\(\);return;/);
  assert.match(account,/await app\.request\(ENDPOINTS\.logout[\s\S]*setSession\(null\);[\s\S]*if\(remotePage\)\{location\.reload\(\);return\}/);
});

test('server demo gate protects API; account and wrong question survive restart without leaking to another student', async () => {
  const temp=await mkdtemp(path.join(os.tmpdir(),'edu-deploy-'));
  const port=await freePort(),base=`http://127.0.0.1:${port}`,dataFile=path.join(temp,'data.json');
  const start=()=>spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),PORT_PROBE_LIMIT:'1',AUTH_REQUIRED:'1',DATA_FILE:dataFile,DEEPSEEK_API_KEY:'',DEMO_ACCESS_PASSWORD:'a-private-generated-deployment-secret',DEMO_SESSION_SECRET:'another-private-generated-session-secret'},stdio:'ignore',windowsHide:true});
  const ready=async()=>{for(let i=0;i<80;i++){try{const result=await fetch(base);if(result.ok)return;}catch{}await new Promise(done=>setTimeout(done,50));}throw new Error('SERVER_NOT_READY');};
  let child=start();
  try {
    await ready();
    const page=await fetch(base);assert.match(await page.text(),/演示访问密码/);
    assert.equal((await fetch(base+'/v1/mistake-cases')).status,401);
    assert.equal((await fetch(base+'/three.module.js')).status,401);
    const access=await fetch(base+'/demo-access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'a-private-generated-deployment-secret'})});
    assert.equal(access.status,200);
    const cookie=access.headers.get('set-cookie').split(';')[0];
    const register=await fetch(base+'/v1/auth/register',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({loginName:'demo-student',displayName:'演示',password:'DemoPassword!2026'})});
    assert.equal(register.status,201);
    const account=await register.json();
    const studentCookie=register.headers.get('set-cookie');
    assert.match(studentCookie||'', /edu_student_session=[^;]+;[^\r\n]*HttpOnly;[^\r\n]*SameSite=Strict/);
    assert.equal((await fetch(base+'/v1/mistake-cases',{headers:{cookie,authorization:`Bearer ${account.sessionToken}`}})).status,200);
    const ingestion=await fetch(base+'/v1/ingestions',{method:'POST',headers:{cookie,authorization:`Bearer ${account.sessionToken}`,'content-type':'application/json'},body:JSON.stringify({source:'text',questionText:'一个圆柱的底面半径为3，高为4，求体积。',studentAnswer:'我想先确定公式。'})});
    assert.equal(ingestion.status,201);
    const caseId=(await ingestion.json()).mistakeCase.id;
    assert.ok((await readFile(dataFile,'utf8')).includes('demo-student'));
    assert.ok((await readFile(dataFile,'utf8')).includes(caseId));
    child.kill();await new Promise(done=>child.once('exit',done));
    child=start();await ready();
    const newAccess=await fetch(base+'/demo-access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'a-private-generated-deployment-secret'})});
    const newCookie=newAccess.headers.get('set-cookie').split(';')[0];
    const restoredWithCookie=await fetch(base+'/v1/auth/me',{headers:{cookie:`${newCookie}; ${studentCookie.split(';')[0]}`}});
    assert.equal(restoredWithCookie.status,200);
    assert.equal((await restoredWithCookie.json()).user.id,account.user.id);
    const cookieHeaders={cookie:`${newCookie}; ${studentCookie.split(';')[0]}`};
    const cookieCases=await fetch(base+'/v1/mistake-cases',{headers:cookieHeaders});
    assert.equal(cookieCases.status,200);
    assert.ok((await cookieCases.json()).some(item=>item.id===caseId));
    const crossOriginWrite=await fetch(base+'/v1/auth/logout',{method:'POST',headers:{...cookieHeaders,origin:'http://untrusted.example'}});
    assert.equal(crossOriginWrite.status,403);
    const me=await fetch(base+'/v1/auth/me',{headers:{cookie:newCookie,authorization:`Bearer ${account.sessionToken}`}});
    assert.equal(me.status,200);
    const restored=await fetch(base+'/v1/mistake-cases',{headers:{cookie:newCookie,authorization:`Bearer ${account.sessionToken}`}});
    assert.equal(restored.status,200);
    assert.ok((await restored.json()).some(item=>item.id===caseId));
    const other=await fetch(base+'/v1/auth/register',{method:'POST',headers:{cookie:newCookie,'content-type':'application/json'},body:JSON.stringify({loginName:'other-test-student',displayName:'另一账号',password:'DemoPassword!2026'})});
    assert.equal(other.status,201);
    const otherToken=(await other.json()).sessionToken;
    const otherCases=await fetch(base+'/v1/mistake-cases',{headers:{cookie:newCookie,authorization:`Bearer ${otherToken}`}});
    assert.equal(otherCases.status,200);
    assert.deepEqual(await otherCases.json(),[]);
    const otherCookie=other.headers.get('set-cookie').split(';')[0];
    const otherByCookie=await fetch(base+'/v1/mistake-cases',{headers:{cookie:`${newCookie}; ${otherCookie}`}});
    assert.deepEqual(await otherByCookie.json(),[]);
    const loginAgain=await fetch(base+'/v1/auth/login',{method:'POST',headers:{cookie:newCookie,'content-type':'application/json'},body:JSON.stringify({loginName:'demo-student',password:'DemoPassword!2026'})});
    assert.equal(loginAgain.status,200);
    const firstCookieAgain=loginAgain.headers.get('set-cookie').split(';')[0];
    const firstCasesAgain=await fetch(base+'/v1/mistake-cases',{headers:{cookie:`${newCookie}; ${firstCookieAgain}`}});
    assert.ok((await firstCasesAgain.json()).some(item=>item.id===caseId));
    const logout=await fetch(base+'/v1/auth/logout',{method:'POST',headers:{...cookieHeaders,origin:base}});
    assert.equal(logout.status,204);
    assert.match(logout.headers.get('set-cookie')||'', /edu_student_session=;[^\r\n]*Max-Age=0/);
    assert.equal((await fetch(base+'/v1/auth/me',{headers:cookieHeaders})).status,401);
  } finally {child.kill();await rm(temp,{recursive:true,force:true});}
});

test('corrupt external data stops startup without replacing the damaged file', async () => {
  const temp=await mkdtemp(path.join(os.tmpdir(),'edu-corrupt-test-'));
  const dataFile=path.join(temp,'data.json');
  await writeFile(dataFile,'{damaged');
  try {
    const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,DATA_FILE:dataFile,PORT:String(await freePort()),PORT_PROBE_LIMIT:'1',DEEPSEEK_API_KEY:''},stdio:'ignore',windowsHide:true});
    const code=await new Promise(resolve=>child.once('exit',resolve));
    assert.notEqual(code,0);
    assert.equal(await readFile(dataFile,'utf8'),'{damaged');
  } finally {await rm(temp,{recursive:true,force:true});}
});
