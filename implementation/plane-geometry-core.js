/* Explicit-parameter 2D math and SVG. Pure, deterministic, no DOM/network/AI. */
(function(root){
  'use strict';
  const VERSION='plane-line-circle/v1';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(n=>finite(n)&&Math.abs(n)<=1e6);
  const reserved=new Set(['point-foot','point-i-1','point-i-2','segment-chord']);
  const validId=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)&&!reserved.has(id);
  function compile(input){
    try{
      if(input?.schemaVersion!=='plane-ir/v1')throw new Error('UNSUPPORTED_PLANE_SCHEMA');
      const {circle,line}=input;
      if(!validId(circle?.id)||!validId(line?.id)||circle.id===line.id)throw new Error('INVALID_ENTITY_ID');
      if(!point(circle.center)||!finite(circle.radius)||circle.radius<1e-4||circle.radius>1e6)throw new Error('INVALID_CIRCLE');
      if(!Array.isArray(line.coefficients)||line.coefficients.length!==3||!line.coefficients.every(finite))throw new Error('INVALID_LINE');
      const [cx,cy]=circle.center,r=circle.radius;
      let [a,b,c]=line.coefficients;
      const largest=Math.max(Math.abs(a),Math.abs(b));
      if(!largest)throw new Error('DEGENERATE_LINE');
      a/=largest;b/=largest;c/=largest;
      const magnitude=Math.hypot(a,b);a/=magnitude;b/=magnitude;c/=magnitude;
      if(!finite(c)||Math.abs(c)>1e6)throw new Error('LINE_OUT_OF_SUPPORTED_RANGE');
      if(a<0||a===0&&b<0){a=-a;b=-b;c=-c;}
      const signed=a*cx+b*cy+c,d=Math.abs(signed),foot=[cx-a*signed,cy-b*signed];
      if(d!==r&&Math.abs(d-r)<=1e-10*Math.max(1,r,d))return {status:'needs_review',reason:'NEAR_TANGENCY'};
      const h=d<r?Math.sqrt((r-d)*(r+d)):0;
      const relation=d<r?'secant':d===r?'tangent':'separate';
      const positions=relation==='separate'?[]:h===0?[foot]:[[foot[0]+b*h,foot[1]-a*h],[foot[0]-b*h,foot[1]+a*h]];
      const residual=Math.max(0,...positions.map(([x,y])=>Math.max(Math.abs(a*x+b*y+c)/Math.max(1,r),Math.abs(Math.hypot(x-cx,y-cy)-r)/Math.max(1,r))));
      if(!finite(residual)||residual>1e-8)return {status:'needs_review',reason:'NUMERIC_RESIDUAL_TOO_LARGE'};
      const canonicalInput={schemaVersion:'plane-ir/v1',circle:{id:circle.id,center:[cx,cy],radius:r},line:{id:line.id,coefficients:[a,b,c]}};
      const elements=[{...canonicalInput.circle,type:'circle',role:'given'},{...canonicalInput.line,type:'line',role:'given'},
        {id:'point-foot',type:'point',role:'foot',position:foot},
        ...positions.map((position,i)=>({id:'point-i-'+(i+1),type:'point',role:'intersection',position}))];
      if(positions.length===2)elements.push({id:'segment-chord',type:'segment',role:'chord',points:['point-i-1','point-i-2']});
      return {status:'verified',version:VERSION,canonicalInput,scene:{schemaVersion:'plane-scene/v1',elements},
        verification:{method:'bounded-floating-line-circle/v1',residual,tolerance:1e-8},
        solution:{relation,intersectionIds:positions.map((_,i)=>'point-i-'+(i+1)),chordLength:relation==='separate'?null:2*h}};
    }catch(error){return {status:'invalid',reason:String(error.message||error)};}
  }
  function render(model,options={}){
    const fail=reason=>({mode:'text_only',highlighted:0,reason,svg:''});
    if(model?.version!==VERSION||model?.status!=='verified')return fail('模型尚未通过当前二维校验。');
    // Recompute from the small, typed input; never execute/trust saved SVG,
    // provider markup or a client-supplied verified solution.
    const verified=compile(model.canonicalInput);
    if(verified.status!=='verified')return fail('参数已变化或接近数值边界，请核对。');
    const elements=verified.scene.elements,ids=new Set(elements.map(e=>e.id)),requested=options.entityIds??[];
    const unknown=!Array.isArray(requested)||requested.length>12||requested.some(id=>!ids.has(id));
    const active=new Set(unknown?[]:requested),mode=unknown?'text_only':active.size?'highlight':'none';
    const circle=verified.canonicalInput.circle,line=verified.canonicalInput.line,[cx,cy]=circle.center,r=circle.radius;
    const zoom=finite(options.zoom)?Math.max(.5,Math.min(4,options.zoom)):1;
    const d=Math.abs(line.coefficients[0]*cx+line.coefficients[1]*cy+line.coefficients[2]);
    const span=Math.max(r*1.35,d*1.1)/zoom,scale=170/span;
    const project=([x,y])=>[320+(x-cx)*scale,220-(y-cy)*scale];
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const num=n=>String(Number(n.toFixed(6)));
    const style=id=>`data-entity-id="${esc(id)}" opacity="${active.size&&!active.has(id)?.18:1}" stroke="${active.has(id)?'#c47b1b':'#315a67'}"`;
    const points=new Map(elements.filter(e=>e.type==='point').map(e=>[e.id,e.position]));
    let drawing='';
    for(let i=-5;i<=5;i++){
      const delta=i*34/zoom;
      drawing+=`<path d="M ${320+delta} 30 V 410 M 100 ${220+delta} H 540" stroke="#e3e9ed" stroke-width="1"/>`;
    }
    const [ox,oy]=project([0,0]);
    if(ox>=100&&ox<=540)drawing+=`<path d="M ${ox} 30 V 410" stroke="#8195a5"/><text x="${ox+8}" y="45">y</text>`;
    if(oy>=30&&oy<=410)drawing+=`<path d="M 100 ${oy} H 540" stroke="#8195a5"/><text x="525" y="${oy-8}">x</text>`;
    for(const e of elements){
      if(e.type==='circle'){
        const [x,y]=project(e.center);drawing+=`<circle ${style(e.id)} cx="${x}" cy="${y}" r="${e.radius*scale}" fill="none" stroke-width="3"/>`;
      }else if(e.type==='line'){
        const [a,b]=e.coefficients,foot=points.get('point-foot'),length=span*5;
        const p=project([foot[0]+b*length,foot[1]-a*length]),q=project([foot[0]-b*length,foot[1]+a*length]);
        drawing+=`<line ${style(e.id)} x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke-width="2.5"/>`;
      }else if(e.type==='segment'){
        const p=project(points.get(e.points[0])),q=project(points.get(e.points[1]));
        drawing+=`<line ${style(e.id)} x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke-width="5"/>`;
      }else{
        if(e.role==='foot'&&!active.has(e.id)&&elements.some(other=>other.role==='intersection'&&Math.hypot(other.position[0]-e.position[0],other.position[1]-e.position[1])<1e-8))continue;
        const [x,y]=project(e.position),label=e.role==='foot'?'H':e.id==='point-i-1'?'I₁':'I₂';
        drawing+=`<g ${style(e.id)}><circle cx="${x}" cy="${y}" r="4" fill="#315a67"/><text x="${x+9}" y="${y-9}" stroke="white" stroke-width="3" paint-order="stroke" fill="#183b55">${label}</text></g>`;
      }
    }
    const unlocked=options.completed===true&&options.answerUnlocked===true;
    const result=unlocked?`<text data-plane-result="true" x="30" y="445" fill="#183b55">${verified.solution.relation==='secant'?'相交 · 弦长：'+num(verified.solution.chordLength):verified.solution.relation==='tangent'?'相切 · 1个交点':'相离 · 无交点'}</text>`:'';
    return {mode,highlighted:active.size,reason:unknown?'提示对象不存在，保留文字提示。':'',
      svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 470" role="img" aria-label="显式参数直线与圆二维模型" style="display:block;width:100%;max-height:520px;font:24px sans-serif"><rect width="640" height="470" fill="#fbfaf6"/><svg x="100" y="30" width="440" height="380" viewBox="100 30 440 380" overflow="hidden">${drawing}</svg>${result}</svg>`};
  }
  const api={VERSION,compile,render};root.__eduPlaneGeometry=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
