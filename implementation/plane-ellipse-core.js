/* Deterministic, explicit-parameter ellipse + line SVG. No DOM/network/AI. */
(function(root){
  'use strict';
  const VERSION='plane-ellipse/v1';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const validId=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)&&!['point-i-1','point-i-2'].includes(id);
  const fail=reason=>({status:'invalid',reason});
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function compile(input){
    try{
      if(input?.schemaVersion!=='plane-ellipse/v1')return fail('UNSUPPORTED_ELLIPSE_SCHEMA');
      const ellipse=input.ellipse,line=input.line;
      if(!validId(ellipse?.id)||!validId(line?.id)||ellipse.id===line.id)return fail('INVALID_ENTITY_ID');
      const a=ellipse.semiMajor,b=ellipse.semiMinor;
      if(!finite(a)||!finite(b)||a<=b||b<=1e-4||a>1e6)return fail('INVALID_ELLIPSE');
      if(!Array.isArray(line?.coefficients)||line.coefficients.length!==3||!line.coefficients.every(finite))return fail('INVALID_LINE');
      let [normalA,normalB,c]=line.coefficients,largest=Math.max(Math.abs(normalA),Math.abs(normalB));
      if(!largest)return fail('DEGENERATE_LINE');
      normalA/=largest;normalB/=largest;c/=largest;const norm=Math.hypot(normalA,normalB);
      normalA/=norm;normalB/=norm;c/=norm;
      if(!finite(c)||Math.abs(c)>1e6)return fail('LINE_OUT_OF_SUPPORTED_RANGE');
      if(normalA<0||normalA===0&&normalB<0){normalA=-normalA;normalB=-normalB;c=-c;}
      const foot=[-normalA*c,-normalB*c],direction=[normalB,-normalA];
      const qa=direction[0]**2/a**2+direction[1]**2/b**2;
      const qb=2*(foot[0]*direction[0]/a**2+foot[1]*direction[1]/b**2);
      const qc=foot[0]**2/a**2+foot[1]**2/b**2-1,disc=qb**2-4*qa*qc;
      const tolerance=1e-10*Math.max(1,qb**2,Math.abs(4*qa*qc));
      if(Math.abs(disc)<=tolerance&&disc!==0)return {status:'needs_review',reason:'NEAR_TANGENCY'};
      const relation=disc<0?'separate':disc===0?'tangent':'secant';
      const ts=relation==='separate'?[]:relation==='tangent'?[-qb/(2*qa)]:[(-qb-Math.sqrt(disc))/(2*qa),(-qb+Math.sqrt(disc))/(2*qa)].sort((x,y)=>x-y);
      const positions=ts.map(t=>[foot[0]+direction[0]*t,foot[1]+direction[1]*t]);
      const residual=Math.max(0,...positions.map(([x,y])=>Math.abs(x*x/a**2+y*y/b**2-1)));
      if(!finite(residual)||residual>1e-8)return {status:'needs_review',reason:'NUMERIC_RESIDUAL_TOO_LARGE'};
      const canonicalInput={schemaVersion:'plane-ellipse/v1',ellipse:{id:ellipse.id,semiMajor:a,semiMinor:b},line:{id:line.id,coefficients:[normalA,normalB,c]}};
      const elements=[{...canonicalInput.ellipse,type:'ellipse',role:'given'},{...canonicalInput.line,type:'line',role:'given'},...positions.map((position,i)=>({id:'point-i-'+(i+1),type:'point',role:'intersection',position}))];
      return {status:'verified',version:VERSION,canonicalInput,scene:{schemaVersion:'plane-ellipse-scene/v1',elements},verification:{method:'bounded-floating-line-ellipse/v1',residual,tolerance:1e-8},solution:{relation,intersectionIds:positions.map((_,i)=>'point-i-'+(i+1))}};
    }catch(error){return fail(String(error?.message||error));}
  }
  function render(model,options={}){
    const no=reason=>({mode:'text_only',highlighted:0,reason,svg:''});
    if(model?.status!=='verified'||model.version!==VERSION)return no('模型尚未通过当前椭圆校验。');
    const data=compile(model.canonicalInput);if(data.status!=='verified')return no('参数已变化或接近数值边界，请核对。');
    const ids=new Set(data.scene.elements.map(e=>e.id)),wanted=options.entityIds??[];
    if(!Array.isArray(wanted)||wanted.length>12||wanted.some(id=>!ids.has(id)))return no('提示对象不存在，保留文字提示。');
    const active=new Set(wanted),ellipse=data.canonicalInput.ellipse,[normalA,normalB,c]=data.canonicalInput.line.coefficients;
    const zoom=finite(options.zoom)?Math.max(.5,Math.min(4,options.zoom)):1,span=ellipse.semiMajor*1.3/zoom,scale=170/span;
    const point=([x,y])=>[320+x*scale,220-y*scale],style=id=>`data-entity-id="${esc(id)}" opacity="${active.size&&!active.has(id)?.18:1}" stroke="${active.has(id)?'#c47b1b':'#315a67'}"`;
    const foot=[-normalA*c,-normalB*c],length=span*4,p=point([foot[0]+normalB*length,foot[1]-normalA*length]),q=point([foot[0]-normalB*length,foot[1]+normalA*length]);
    let drawing='';for(let i=-5;i<=5;i++){const d=i*34/zoom;drawing+=`<path d="M ${320+d} 30 V 410 M 100 ${220+d} H 540" stroke="#e3e9ed" stroke-width="1"/>`;}
    drawing+=`<ellipse ${style(ellipse.id)} cx="320" cy="220" rx="${ellipse.semiMajor*scale}" ry="${ellipse.semiMinor*scale}" fill="none" stroke-width="3"/><line ${style(data.canonicalInput.line.id)} x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke-width="2.5"/>`;
    for(const item of data.scene.elements.filter(e=>e.type==='point')){const [x,y]=point(item.position),label=item.id==='point-i-1'?'I₁':'I₂';drawing+=`<g ${style(item.id)}><circle cx="${x}" cy="${y}" r="4" fill="#315a67"/><text x="${x+9}" y="${y-9}" stroke="white" stroke-width="3" paint-order="stroke" fill="#183b55">${label}</text></g>`;}
    const unlocked=options.completed===true&&options.answerUnlocked===true,result=unlocked?`<text data-conic-result="true" x="30" y="445" fill="#183b55">${data.solution.relation==='secant'?'相交 · 2个交点':data.solution.relation==='tangent'?'相切 · 1个交点':'相离 · 无交点'}</text>`:'';
    return {mode:active.size?'highlight':'none',highlighted:active.size,reason:'',svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 470" role="img" aria-label="显式参数椭圆与直线二维模型" style="display:block;width:100%;max-height:520px;font:24px sans-serif"><rect width="640" height="470" fill="#fbfaf6"/><svg x="100" y="30" width="440" height="380" viewBox="100 30 440 380" overflow="hidden">${drawing}</svg>${result}</svg>`};
  }
  const api={VERSION,compile,render};root.__eduPlaneEllipse=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
