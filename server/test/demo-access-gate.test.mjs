import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDemoAccessGate} from '../workflows/demo-access-gate.mjs';

function response() {
  return {headers: {}, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; }};
}

test('demo gate protects page and API, then accepts a session cookie', async () => {
  const gate = createDemoAccessGate({password: 'a-private-generated-deployment-secret'});
  const blocked = response();
  assert.equal(await gate.handle({method:'GET',url:'/',headers:{},socket:{remoteAddress:'127.0.0.1'}}, blocked), true);
  assert.equal(blocked.status, 200);
  assert.match(blocked.body, /演示访问密码/);
  const api = response();
  assert.equal(await gate.handle({method:'GET',url:'/v1/mistake-cases',headers:{},socket:{remoteAddress:'127.0.0.1'}}, api), true);
  assert.equal(api.status, 401);
  const login = response();
  assert.equal(await gate.handle({method:'POST',url:'/demo-access',headers:{},socket:{remoteAddress:'127.0.0.1'}}, login, {password:'a-private-generated-deployment-secret'}), true);
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  const allowed = response();
  assert.equal(await gate.handle({method:'GET',url:'/v1/mistake-cases',headers:{cookie:login.headers['set-cookie'].split(';')[0]},socket:{remoteAddress:'127.0.0.1'}}, allowed), false);
});

test('demo gate rate limits repeated wrong passwords', async () => {
  const gate = createDemoAccessGate({password:'a-private-generated-deployment-secret', maxAttempts:2});
  for (const expected of [401,429,429]) {
    const result=response();
    await gate.handle({method:'POST',url:'/demo-access',headers:{},socket:{remoteAddress:'192.0.2.4'}},result,{password:'wrong'});
    assert.equal(result.status,expected);
  }
});

test('demo gate accepts a shorter invited-demo password and supports visible retry', async () => {
  assert.throws(() => createDemoAccessGate({password:'elevenChars'}), /DEMO_ACCESS_PASSWORD_TOO_SHORT/);
  const gate = createDemoAccessGate({password:'a1b2c3d4e5f6'});
  const blocked = response();
  await gate.handle({method:'GET',url:'/',headers:{},socket:{remoteAddress:'127.0.0.1'}}, blocked);
  assert.match(blocked.body, /type="password"[^>]*id="demo-password"|id="demo-password"[^>]*type="password"/);
  assert.match(blocked.body, /data-demo-password-toggle/);
  assert.match(blocked.body, /aria-pressed/);
  assert.doesNotMatch(blocked.body, /form\.password\.value\s*=\s*''/);
  const handlers = {};
  const input = {type:'password',value:'typed-on-tablet'};
  const toggle = {textContent:'显示',setAttribute(name,value){this[name]=value;},addEventListener(name,handler){handlers[name]=handler;}};
  const form = {addEventListener(name,handler){handlers[name]=handler;}};
  const message = {textContent:''};
  const script = blocked.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  vm.runInNewContext(script, {
    document:{getElementById(id){return {'demo-password':input,gate:form,message}[id];},querySelector(){return toggle;}},
    fetch:async()=>({ok:false,status:401}),
    location:{replace(){throw new Error('unexpected redirect');}}
  });
  handlers.click();
  assert.equal(input.type,'text');
  assert.equal(toggle['aria-pressed'],'true');
  await handlers.submit({preventDefault(){}});
  assert.equal(input.value,'typed-on-tablet');
  assert.match(message.textContent,/输入已保留/);
});

test('four-digit demo PIN needs an explicit temporary opt-in', async () => {
  assert.throws(() => createDemoAccessGate({password:'2468'}), /DEMO_ACCESS_PASSWORD_TOO_SHORT/);
  assert.throws(() => createDemoAccessGate({password:'123',allowShortPin:true}), /DEMO_ACCESS_PASSWORD_TOO_SHORT/);
  const gate = createDemoAccessGate({password:'2468',allowShortPin:true});
  const login = response();
  await gate.handle({method:'POST',url:'/demo-access',headers:{},socket:{remoteAddress:'127.0.0.1'}}, login, {password:'2468'});
  assert.equal(login.status,200);
  assert.match(login.headers['set-cookie'],/HttpOnly/);
});
