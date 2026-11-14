/* Shared pure-data contract: browser and backend use identical entity matching.
   No network, provider code, scoring mutation or arbitrary action execution. */
(function(root){
  'use strict';
  const clean=value=>String(value??'').normalize('NFC').replace(/[₀₁₂₃₄₅₆₇₈₉]/g,c=>String('₀₁₂₃₄₅₆₇₈₉'.indexOf(c))).replace(/_?\{(\d+)\}/g,'$1').replace(/^(平面|线段|直线|点)/,'').replace(/\s+/g,'');
  const questionKey=value=>String(value??'').normalize('NFC').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();
  const types=new Set(['point','segment','plane','polyhedron-face','section-triangle','section-rectangle','section-polygon']);
  function catalogFor(record){
    if(record?.geometryResult?.solverStatus!=='verified'||record.verificationStatus==='ai_reference')return [];
    return (record.geometryResult.scene?.elements||[]).filter(e=>e.id&&types.has(e.type)).slice(0,160).map(e=>({id:String(e.id),type:e.type,point:e.point||'',points:Array.isArray(e.points)?e.points.map(String):[]}));
  }
  function geometryKey(record){
    // Deterministic change detector, not an authorization/security hash.
    const source=JSON.stringify([record?.geometryResult?.canonicalCoordinates||{},catalogFor(record)]);
    let a=2166136261,b=5381;for(let i=0;i<source.length;i++){a=Math.imul(a^source.charCodeAt(i),16777619);b=Math.imul(b,33)^source.charCodeAt(i);}
    return (a>>>0).toString(16)+':'+(b>>>0).toString(16)+':'+source.length;
  }
  const bindingFor=record=>({version:1,question:questionKey(record.question),subject:String(record.subject||''),modelVersion:String(record.geometryCompilation?.versionKey||''),geometryKey:geometryKey(record)});
  function bindingMatches(binding,record){return Boolean(binding)&&JSON.stringify(binding)===JSON.stringify(bindingFor(record));}
  function resolveVisual(raw,catalog,hint=''){
    const textOnly=reason=>({mode:'text_only',entityIds:[],hint:String(raw?.hint||hint||'').slice(0,120),reason:String(reason||'这一步使用文字提示。').slice(0,160)});
    if(raw?.mode==='text_only')return textOnly(raw.reason);
    if(!catalog.length)return textOnly('当前没有可引用的已校验模型。');
    const modern=Array.isArray(raw?.entityIds),wanted=modern?raw.entityIds:raw?.entities||raw?.highlight||[];
    if(!Array.isArray(wanted)||!wanted.length)return textOnly('这一步没有可明确对应的已有对象。');
    const ids=[];
    for(const name of wanted.slice(0,12)){
      const exact=catalog.filter(e=>e.id===name);
      const matched=exact.length?exact:modern?[]:catalog.filter(e=>{
        const aliases=[e.point,e.points.join(''),e.points.slice().reverse().join('')].filter(Boolean);
        return aliases.some(alias=>clean(alias)===clean(name));
      });
      if(matched.length!==1)return textOnly('提示对象不存在或对应不唯一，保留文字提示。');
      if(!ids.includes(matched[0].id))ids.push(matched[0].id);
    }
    return {mode:'highlight',entityIds:ids,hint:String(raw?.hint||hint||'').slice(0,120),reason:'',
      // Result labels remain data; the renderer separately enforces completion/answer gates.
      labels:Array.isArray(raw?.labels)?raw.labels.slice(0,6):[]};
  }
  function bindRubric(rubric,record){
    const catalog=catalogFor(record),steps=(rubric.steps||[]).map(step=>({...step,visual:resolveVisual(step.visual,catalog,step.hint)}));
    return {...rubric,visualBinding:bindingFor(record),steps,parts:(rubric.parts||[]).map(part=>({...part,visual:resolveVisual(part.visual||(steps.find(s=>(part.steps||[]).includes(s.id)))?.visual,catalog,part.hint)}))};
  }
  function modelLabel(item,answerUnlocked=false){
    // Legacy labels mix object names and computed answers. Do not parse numbers
    // out of names (A1 is an entity); conservatively display only topology.
    if(answerUnlocked===true)return String(item?.label||'');
    return item?.point?String(item.point):Array.isArray(item?.points)?item.points.map(String).join('–'):'';
  }
  const api={catalogFor,resolveVisual,bindRubric,bindingFor,bindingMatches,modelLabel};
  root.__eduStepVisualContract=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
