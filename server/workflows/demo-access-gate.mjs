import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

const cookieName = 'edu_demo_access';
const loginPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>演示访问</title><style>body{font:16px system-ui;background:#f7f6f2;display:grid;place-items:center;min-height:100vh;margin:0;color:#263041}main{background:white;border:1px solid #ddd;border-radius:20px;padding:32px;width:min(360px,85vw)}h1{font-size:1.5rem}input,button{box-sizing:border-box;padding:13px;border-radius:10px;font:inherit;min-height:48px}.password-row{display:flex;gap:8px}.password-row input{width:100%;min-width:0;border:1px solid #a8b6cc}.password-row button{flex:none;min-width:72px;background:#eef4ff;color:#234b9e;border:1px solid #8ca9df}form>button{width:100%;margin-top:14px;background:#3264dd;color:white;border:0}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #3264dd;outline-offset:2px}small{color:#526078;line-height:1.5;display:block;margin-top:10px}#message{min-height:1.5em;color:#8b2332}</style></head><body><main><h1>演示访问密码</h1><p>此页面仅供受邀演示，勿上传真实学生资料。</p><form id="gate"><div class="password-row"><input type="password" id="demo-password" name="password" required autocomplete="off" aria-label="演示访问密码"><button type="button" data-demo-password-toggle aria-controls="demo-password" aria-pressed="false">显示</button></div><button type="submit">进入登录页</button></form><p id="message" role="alert"></p><small>华为设备无法粘贴时，可先点“显示”再试；注意别让旁人看到密码。</small><small>这是临时 HTTP 演示，正式使用须启用备案域名与 HTTPS。</small></main><script>const input=document.getElementById('demo-password');const toggle=document.querySelector('[data-demo-password-toggle]');toggle.addEventListener('click',()=>{const visible=input.type==='password';input.type=visible?'text':'password';toggle.textContent=visible?'隐藏':'显示';toggle.setAttribute('aria-pressed',String(visible));});document.getElementById('gate').addEventListener('submit',async event=>{event.preventDefault();const message=document.getElementById('message');message.textContent='';try{const response=await fetch('/demo-access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:input.value})});if(response.ok)location.replace('/');else message.textContent=response.status===429?'尝试过多，请稍后再试。':'密码不正确，请核对后重试；输入已保留。';}catch{message.textContent='网络暂时不可用，请重试；输入已保留。';}});</script></body></html>`;

export function createDemoAccessGate({password, allowShortPin = false, sessionSecret = randomBytes(32).toString('hex'), maxAttempts = 5, windowMs = 15 * 60_000, sessionMs = 12 * 60 * 60_000} = {}) {
  const minimumLength = allowShortPin ? 4 : 12;
  if (!password || password.length < minimumLength) throw new Error('DEMO_ACCESS_PASSWORD_TOO_SHORT');
  const attempts = new Map();
  const sign = value => createHmac('sha256', sessionSecret).update(value).digest('hex');
  const validCookie = req => {
    const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='));
    if (!raw) return false;
    const [expires, signature] = raw.slice(cookieName.length + 1).split('.');
    if (!/^\d+$/.test(expires) || !/^[a-f0-9]{64}$/.test(signature || '') || Number(expires) <= Date.now()) return false;
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(expires), 'hex'));
  };
  const write = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(status, {'content-type':type, 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...extra});
    res.end(body);
  };
  return {
    async handle(req, res, input = {}) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'POST' && pathname === '/demo-access') {
        const ip = req.socket.remoteAddress || 'unknown';
        const previous = attempts.get(ip);
        const entry = previous && Date.now() - previous.started < windowMs ? previous : {started:Date.now(), count:0};
        if (entry.count >= maxAttempts) { write(res,429,JSON.stringify({error:'TOO_MANY_ATTEMPTS'})); return true; }
        const candidate = String(input.password || '');
        const left = Buffer.from(candidate), right = Buffer.from(password);
        if (left.length !== right.length || !timingSafeEqual(left, right)) {
          entry.count++;
          attempts.set(ip,entry);
          write(res,entry.count >= maxAttempts ? 429 : 401,JSON.stringify({error:'INVALID_DEMO_PASSWORD'}));
          return true;
        }
        attempts.delete(ip);
        const expires = String(Date.now() + sessionMs);
        write(res,200,JSON.stringify({ok:true}),undefined,{'set-cookie':`${cookieName}=${expires}.${sign(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(sessionMs/1000)}`});
        return true;
      }
      if (validCookie(req)) return false;
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) write(res,200,loginPage,'text/html; charset=utf-8');
      else write(res,401,JSON.stringify({error:'DEMO_ACCESS_REQUIRED'}));
      return true;
    }
  };
}
