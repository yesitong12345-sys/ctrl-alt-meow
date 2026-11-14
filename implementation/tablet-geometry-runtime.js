/* Render scheduling/lifecycle only; no AI, storage or student grading. */
(function(root){
  'use strict';
  let active=null;
  const isTouch=()=>Boolean(root.matchMedia?.('(pointer: coarse)').matches||root.navigator?.maxTouchPoints>0);
  function createScheduler({draw,needsMotion=()=>false}){
    let frame=0,paused=false,disposed=false,last=-Infinity,drawCount=0;
    function tick(time){frame=0;if(paused||disposed)return;if(time-last<1000/30){frame=root.requestAnimationFrame(tick);return;}last=time;draw(time);drawCount++;if(needsMotion())invalidate();}
    function invalidate(){if(!paused&&!disposed&&!frame)frame=root.requestAnimationFrame(tick);}
    return {invalidate,pause(value){paused=value;if(paused){root.cancelAnimationFrame(frame);frame=0;}else invalidate();},dispose(){disposed=true;root.cancelAnimationFrame(frame);frame=0;},get drawCount(){return drawCount;}};
  }
  function fallback(container,result,message){
    if(!container?.isConnected)return;
    container.replaceChildren();
    const text=document.createElement('p');text.textContent=message;text.style.cssText='padding:18px;color:#142847';text.setAttribute('role','status');
    const button=document.createElement('button');button.type='button';button.textContent='重新打开模型';button.style.cssText='min-height:44px;margin:12px';
    button.onclick=()=>{const id=container.dataset.caseThree,record=root.__eduStepVisualRecord?.(id);if(id&&!record){text.textContent='题目或账号已变化，请重新进入本题。';return;}delete container.dataset.geometryPaused;root.__mountDeterministicThree?.(container,record?.geometryResult||result);};
    container.append(text,button);container.dataset.geometryPaused='true';
  }
  function claim(container){
    container.dataset.touchModel=String(isTouch());if(isTouch())document.documentElement.dataset.touchModels='true';
    if(active&&active!==container){const previous=active;const result=previous.__geometryResult;previous.__geometryController?.dispose();root.__eduClearStepOnModel?.();fallback(previous,result,'为节省平板资源，已暂停这个模型。点击可重新打开。');}
    active=container;delete container.dataset.geometryPaused;
  }
  function release(container){if(active===container)active=null;}
  function allowed(record){
    const owner=record?.user_id||record?.studentId;
    if(!owner)return true;
    if(owner==='local-student'&&root.__eduSchoolAuthRequired!==true)return true;
    if(!('__eduSessionUserId' in root))return !root.__eduAuthSessionToken;
    return Boolean(root.__eduSessionUserId)&&owner===root.__eduSessionUserId;
  }
  root.addEventListener?.('edu-account-session-changed',()=>{root.__eduClearStepOnModel?.();if(active){const previous=active;previous.__geometryController?.dispose();fallback(previous,previous.__geometryResult,'账号已切换，请从当前账号重新打开题目。');}});
  function observe(container,canvas,controller,scheduler,result){
    let inView=true,closed=false;
    const visibility=()=>scheduler.pause(Boolean(document.hidden)||!inView);
    const invalidate=()=>scheduler.invalidate();
    const events=['pointerdown','pointermove','pointerup','wheel','click','input','change'];
    events.forEach(name=>container.addEventListener(name,invalidate,{passive:true}));
    document.addEventListener('visibilitychange',visibility);
    const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting!==false;visibility();}):null;
    intersection?.observe(container);
    const mutation=typeof MutationObserver==='function'?new MutationObserver(()=>{if(!container.isConnected)controller.dispose();}):null;
    mutation?.observe(document.body,{childList:true,subtree:true});
    const lost=event=>{event.preventDefault();controller.dispose();fallback(container,result,'图形显示已中断，题目和文字提示仍保留。可手动重新打开模型。');};
    canvas.addEventListener('webglcontextlost',lost);
    visibility();invalidate();
    return ()=>{if(closed)return;closed=true;events.forEach(name=>container.removeEventListener(name,invalidate));document.removeEventListener('visibilitychange',visibility);intersection?.disconnect();mutation?.disconnect();canvas.removeEventListener('webglcontextlost',lost);scheduler.dispose();release(container);};
  }
  root.__eduTabletGeometry={isTouch,createScheduler,claim,release,fallback,observe,allowed};
})(globalThis);
