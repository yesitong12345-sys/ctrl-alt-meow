(function(){
  'use strict';

  var SESSION_KEY='educompanion.student.session';
  var PENDING_UPLOAD_KEY='educompanion.pending.upload';
  var remotePage=/^https?:$/.test(location.protocol)&&!['127.0.0.1','localhost','::1'].includes(location.hostname);
  var ENDPOINTS={register:'/v1/auth/register',login:'/v1/auth/login',logout:'/v1/auth/logout'};
  var app=null;
  // Keep an in-memory draft so a render during submit/error cannot erase the form.
  // In particular, never put the password in localStorage/sessionStorage.
  var ui={user:null,message:'',busy:false,passwordVisible:false,authRequired:remotePage,formDraft:{loginName:'',displayName:'',className:'',password:''}};
  var authEpoch=0;

  function sessionToken(){try{return sessionStorage.getItem(SESSION_KEY)||''}catch{return''}}
  function setSession(result){
    var token=result&&result.sessionToken||'';
    try{if(token&&!remotePage)sessionStorage.setItem(SESSION_KEY,token);else sessionStorage.removeItem(SESSION_KEY)}catch{}
    window.__eduAuthSessionToken=remotePage?'':token;
    ui.user=result&&result.user||null;
    const previousOwner=window.__eduSessionUserId;
    window.__eduSessionUserId=String(ui.user?.id||'');
    if(previousOwner!==window.__eduSessionUserId&&typeof CustomEvent==='function')window.dispatchEvent?.(new CustomEvent('edu-account-session-changed',{detail:{userId:window.__eduSessionUserId}}));
  }
  function rememberPendingUpload(){
    var pending={
      geometryTextQuestion:String(app.state.geometryTextQuestion||''),
      geometryTextAnswer:String(app.state.geometryTextAnswer||''),
      questionText:String(app.state.wqIntake?.questionText||''),
      mode:app.state.wqIntake?.mode==='image'?'image':'text',
      ownerId:String(window.__eduCurrentOwner||'')
    };
    try{sessionStorage.setItem(PENDING_UPLOAD_KEY,JSON.stringify(pending))}catch{}
  }
  function restorePendingUpload(userId){
    var pending;
    try{pending=JSON.parse(sessionStorage.getItem(PENDING_UPLOAD_KEY)||'null')}catch{}
    if(!pending||!userId)return;
    if(pending.ownerId&&pending.ownerId!==String(userId)){
      try{sessionStorage.removeItem(PENDING_UPLOAD_KEY)}catch{}
      return;
    }
    app.state.geometryTextQuestion=String(pending.geometryTextQuestion||'');
    app.state.geometryTextAnswer=String(pending.geometryTextAnswer||'');
    app.state.wqIntake=app.state.wqIntake||{};
    app.state.wqIntake.questionText=String(pending.questionText||'');
    app.state.wqIntake.mode=pending.mode==='image'?'image':'text';
    try{sessionStorage.removeItem(PENDING_UPLOAD_KEY)}catch{}
  }
  async function requireLogin(){
    authEpoch++;
    rememberPendingUpload();
    setSession(null);
    ui.authRequired=true;
    ui.message='登录已过期或尚未登录。题目文字已保留，登录后请重新提交；图片需重新选择。';
    app.state.tab='account-settings';
    await window.__eduAccountChanged?.(null);
    app.render();
  }
  async function refresh(){
    var epoch=authEpoch;
    window.__eduAuthSessionToken=sessionToken();
    try{
      var health=await app.request('/health');
      if(epoch!==authEpoch)return;
      ui.authRequired=health&&health.authRequired===true;
      window.__eduSchoolAuthRequired=ui.authRequired;
      if(ui.authRequired||window.__eduAuthSessionToken){
        var me;
        try{me=await app.request('/v1/auth/me')}
        catch(error){
          if(!remotePage||!window.__eduAuthSessionToken||error?.code!=='AUTHENTICATION_REQUIRED')throw error;
          // A stale pre-cookie bearer must not hide a still-valid HttpOnly cookie.
          window.__eduAuthSessionToken='';
          try{sessionStorage.removeItem(SESSION_KEY)}catch{}
          me=await app.request('/v1/auth/me');
        }
        if(epoch!==authEpoch)return;
        setSession({user:me.user,sessionToken:remotePage?'':sessionToken()});
        restorePendingUpload(ui.user?.id);
      }
      if(!ui.authRequired&&!ui.user&&app.state.tab==='account-settings')app.state.tab='home';
    }catch(error){
      ui.user=null;
      if(error?.code==='AUTHENTICATION_REQUIRED')setSession(null);
      else ui.message='暂时无法恢复登录，请检查学习服务后刷新；服务器里的已提交记录不会因此删除。';
    }finally{
      document.documentElement?.classList?.remove('auth-pending');
    }
    if(ui.authRequired&&!ui.user&&app.state.tab!=='account-settings')app.state.tab='account-settings';
    if(ui.authRequired)await window.__eduAccountChanged?.(ui.user?.id||null);
    app.render();
  }
  async function submit(root,mode){
    var loginName=String(root.querySelector('[data-account-login]').value||'').trim();
    var displayName=String(root.querySelector('[data-account-display]').value||'').trim();
    var password=String(root.querySelector('[data-account-password]').value||'');
    var className=String((root.querySelector('[data-account-class]')||{}).value||'').trim();
    ui.formDraft={loginName:loginName,displayName:displayName,className:className,password:password};
    ui.busy=true;ui.message=mode==='register'?'正在建立你的独立学习档案…':'正在登录…';app.render();
    try{
      var result=await app.request(ENDPOINTS[mode],{method:'POST',body:JSON.stringify({loginName:loginName,displayName:displayName,password:password,className:className})});
      authEpoch++;
      setSession(result);
      ui.formDraft={loginName:'',displayName:'',className:'',password:''};
      ui.passwordVisible=false;
      if(location.protocol.startsWith('http')&&!['127.0.0.1','localhost','::1'].includes(location.hostname)){location.reload();return;}
      restorePendingUpload(result.user?.id);
      await window.__eduAccountChanged?.(result.user?.id||null);ui.message='登录成功。你的错题、陪练、计划和知识卡将与其他学生隔离。';
      app.state.tab='home';
    }catch(error){
      var code=String(error&&error.message||'');
      ui.message=code==='LOGIN_NAME_TAKEN'?'这个账号已被注册过，直接登录或换一个。':code==='INVALID_CREDENTIALS'?'账号或密码不正确。':code==='PASSWORD_TOO_SHORT'?'密码至少需要 6 个字符。':code==='INVALID_LOGIN_NAME'?'新账号请填 6～32 位的姓名拼音、字母或数字，也可使用点、横线、下划线。':code==='AUTHENTICATION_REQUIRED'?'请先登录再操作。':'暂时无法登录：'+code;
    }finally{ui.busy=false;app.render()}
  }

  /* ---------------- 个人页：资料保存 + AI 服务配置 ---------------- */
  /** 读一次服务端模型配置状态（/health 里的 deepSeek* 字段。注意没有 /v1 前缀） */
  async function loadAiStatus(shouldRender){
    if(ui.ai&&!shouldRender)return;
    try{
      var health=await app.request('/health');
      ui.ai={configured:Boolean(health.deepSeekConfigured),model:health.deepSeekModel||'',endpoint:''};
    }catch(error){
      ui.ai={configured:false,model:'',endpoint:'',error:String(error&&error.message||'')};
    }
    if(shouldRender)app.render();
  }

  async function saveProfile(root){
    var name=String((root.querySelector('[data-profile-name]')||{}).value||'').trim();
    var className=String((root.querySelector('[data-profile-class]')||{}).value||'').trim();
    var subjects=String((root.querySelector('[data-profile-subjects]')||{}).value||'').trim();
    ui.busy=true;ui.message='正在保存资料…';app.render();
    try{
      var result=await app.request('/v1/auth/profile',{method:'PATCH',body:JSON.stringify({displayName:name,className:className,subjects:subjects})});
      if(result&&result.user)ui.user=result.user;
      ui.message='资料已保存。';
    }catch(error){
      ui.message='资料保存失败：'+String(error&&error.message||'');
    }
    ui.busy=false;app.render();
  }

  async function saveApiKey(root){
    var key=String((root.querySelector('[data-ai-key]')||{}).value||'').trim();
    if(!key){ui.message='请先填入 DeepSeek API Key。';return app.render()}
    ui.busy=true;ui.message='正在校验并保存…';app.render();
    try{
      var result=await app.request('/v1/admin/deepseek-config',{method:'POST',body:JSON.stringify({apiKey:key})});
      ui.ai={configured:Boolean(result&&result.configured),model:(result&&result.model)||'',endpoint:(result&&result.endpoint)||''};
      ui.message='已切换：模型 '+String((result&&result.model)||'')+' 立即生效。';
    }catch(error){
      var code=String(error&&error.message||'');
      ui.message=code==='INVALID_DEEPSEEK_API_KEY'?'这个 Key 格式不对（应以 sk- 开头，至少 16 位）。'
        :code==='LOCAL_CONFIGURATION_ONLY'?'只能在运行服务的这台电脑上改配置。'
        :code==='SERVER_MODEL_CONFIGURATION_REQUIRED'?'服务器已托管模型配置，页面里不能改。'
        :'保存失败：'+code;
    }
    ui.busy=false;app.render();
  }

  function feature(){return{
    activate:function(context){
      app=context;
      window.__eduAuthSessionToken=sessionToken();
      window.__eduRequireLogin=requireLogin;
      if(remotePage)app.state.tab='account-settings';
      var tabs=document.querySelector('.tabs');
      if(tabs&&!tabs.querySelector('[data-tab="account-settings"]')){
        var button=document.createElement('button');
        button.setAttribute('data-tab','account-settings');
        button.innerHTML='👤<span>我的</span>';
        button.onclick=function(){app.state.tab='account-settings';app.render()};
        tabs.appendChild(button);
      }
      refresh();
    },
    requiresLogin:function(){return ui.authRequired&&!ui.user},
    decorateHome:function(root){
      root.insertAdjacentHTML('afterbegin','<section class="panel"><div class="head"><div><span class="pill '+(ui.user?'good':'warn')+'">'+(ui.user?'个人档案已连接':'尚未登录')+'</span><h2>'+(ui.user?'你好，'+app.esc(ui.user.displayName):'学生账号')+'</h2><p class="muted">已提交的错题、陪练记录和知识卡保存在服务器；未提交的输入不算保存。</p></div><button data-open-account>'+(ui.user?'管理账号':'登录 / 注册')+'</button></div></section>');
      root.querySelector('[data-open-account]').onclick=function(){app.state.tab='account-settings';app.render()};
    },
    renderSettings:function(root){
      root.className='work';
      if(ui.user){
        var subjectText=Array.isArray(ui.user.subjects)?ui.user.subjects.join('、'):'';
        var ai=ui.ai||{};
        root.innerHTML='<section class="panel"><div class="head"><div><span class="pill good">已登录</span><h2>个人页</h2><p class="muted">账号：'+app.esc(ui.user.loginName)+' · 错题、陪练、计划和知识卡只属于你</p></div><button data-account-back>返回首页</button></div>'
          +'<div class="diagnosis"><b>我的资料</b><div class="exact-fields">'
          +'<label>姓名<input data-profile-name value="'+app.esc(ui.user.displayName||'')+'" placeholder="例如：小林"></label>'
          +'<label>班级<input data-profile-class value="'+app.esc(ui.user.className||'')+'" placeholder="例如：高一(8)班"></label>'
          +'</div><label>选科<input data-profile-subjects value="'+app.esc(subjectText)+'" placeholder="例如：物理、化学、生物"></label>'
          +'<div class="row"><button class="primary" data-profile-save '+(ui.busy?'disabled':'')+'>保存资料</button></div></div>'
          +'<div class="diagnosis"><b>AI 服务</b>'
          +'<p class="muted">当前：'+(ai.configured?('已配置 · 模型 '+app.esc(ai.model||'')):'未配置 —— AI 识题与陪练暂时不可用，本地确定性建模仍可用')+'</p>'
          +(ui.authRequired?'<p class="muted">学校多人模式由服务器管理员统一配置模型密钥，学生账号无需填写。</p>':'<label>DeepSeek API Key<input data-ai-key type="password" autocomplete="off" placeholder="sk-..."></label><div class="row"><button class="primary" data-ai-save '+(ui.busy?'disabled':'')+'>保存并切换</button><button data-ai-refresh>刷新状态</button></div><p class="muted">Key 只保存在这台服务器上，不会写进你的账号资料。</p>')+'</div>'
          +'<button data-account-logout>退出登录</button>'
          +'<button data-account-logout-all>退出所有设备</button><p class="muted">登录约 30 天有效；最多保留 10 个设备会话。共用设备用完请退出。</p>'
          +(ui.message?'<p class="geometry-alert">'+app.esc(ui.message)+'</p>':'')+'</section>';
        root.querySelector('[data-account-back]').onclick=function(){app.state.tab='home';app.render()};
        async function logout(allDevices){
          if(allDevices&&!window.confirm('退出此账号的所有设备？其他同学的账号不受影响。'))return;
          ui.busy=true;
          try{await app.request(ENDPOINTS.logout,{method:'POST',body:JSON.stringify({allDevices:allDevices===true})})}
          catch{ui.busy=false;ui.message='服务器未确认退出。共用设备上请勿交给下一位同学，请联网后重试。';app.render();return}
          authEpoch++;setSession(null);
          try{sessionStorage.removeItem(PENDING_UPLOAD_KEY)}catch{}
          if(remotePage){location.reload();return}
          await window.__eduAccountChanged?.(null);
          ui.busy=false;ui.message='已退出，服务器学习记录仍会保留；本页已清除上一账号数据。';app.render();
        }
        root.querySelector('[data-account-logout]').onclick=function(){void logout(false)};
        root.querySelector('[data-account-logout-all]').onclick=function(){void logout(true)};
        root.querySelector('[data-profile-save]').onclick=function(){void saveProfile(root)};
        var aiSave=root.querySelector('[data-ai-save]');if(aiSave)aiSave.onclick=function(){void saveApiKey(root)};
        var aiRefresh=root.querySelector('[data-ai-refresh]');if(aiRefresh)aiRefresh.onclick=function(){ui.ai=null;void loadAiStatus(true)};
        void loadAiStatus(false);
        return;
      }
      var draft=ui.formDraft||{};
      root.innerHTML='<section class="panel"><div class="head"><div><span class="pill warn">个人学习档案</span><h2>先登录，再开始学习</h2><p class="muted">首次注册后可直接使用；同一浏览器下次打开会自动恢复登录。每人的错题独立保存在服务器。</p></div>'+(ui.authRequired?'':'<button data-account-back>稍后再说</button>')+'</div><label>账号名称（新注册至少 6 位，可填姓名拼音）<input data-account-login autocomplete="username" value="'+app.esc(draft.loginName||'')+'" placeholder="例如：zhangsan"></label><label>姓名<input data-account-display autocomplete="name" value="'+app.esc(draft.displayName||'')+'" placeholder="例如：小林"></label><label>班级（注册时填）<input data-account-class autocomplete="off" value="'+app.esc(draft.className||'')+'" placeholder="例如：高一(8)班"></label><div class="account-password-field"><label for="account-password">密码</label><div class="account-password-row"><input data-account-password type="password" id="account-password" autocomplete="current-password" value="'+app.esc(draft.password||'')+'" placeholder="至少 6 个字符"><button type="button" data-account-toggle-password aria-controls="account-password" aria-pressed="'+(ui.passwordVisible?'true':'false')+'">'+(ui.passwordVisible?'隐藏':'显示')+'</button></div></div><div class="row"><button class="primary" data-account-login-button '+(ui.busy?'disabled':'')+'>登录</button><button data-account-register '+(ui.busy?'disabled':'')+'>首次注册</button></div><p class="muted">在自己的设备上可保持登录约 30 天；共用平板用完请点「退出登录」。当前 HTTP 演示站只用测试账号和非真实学生数据。</p>'+(ui.message?'<p class="geometry-alert" role="status" aria-live="polite">'+app.esc(ui.message)+'</p>':'')+'</section>';
      var back=root.querySelector('[data-account-back]');if(back)back.onclick=function(){app.state.tab='home';app.render()};
      root.querySelector('[data-account-login]').addEventListener('input',function(event){ui.formDraft.loginName=event.target.value});
      root.querySelector('[data-account-display]').addEventListener('input',function(event){ui.formDraft.displayName=event.target.value});
      root.querySelector('[data-account-class]').addEventListener('input',function(event){ui.formDraft.className=event.target.value});
      var passwordInput=root.querySelector('[data-account-password]');
      if(ui.passwordVisible)passwordInput.type='text';
      passwordInput.addEventListener('input',function(event){ui.formDraft.password=event.target.value});
      root.querySelector('[data-account-toggle-password]').onclick=function(){
        ui.passwordVisible=!ui.passwordVisible;
        passwordInput.type=ui.passwordVisible?'text':'password';
        this.textContent=ui.passwordVisible?'隐藏':'显示';
        this.setAttribute('aria-pressed',String(ui.passwordVisible));
      };
      root.querySelector('[data-account-login-button]').onclick=function(){submit(root,'login')};
      root.querySelector('[data-account-register]').onclick=function(){submit(root,'register')};
    }
  }}

  if(window.__registerAccountSettings)window.__registerAccountSettings(feature());
}());
