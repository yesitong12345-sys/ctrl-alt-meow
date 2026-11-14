const FULL_WIDTH_DIGITS='０１２３４５６７８９';
const SUBSCRIPT_DIGITS='₀₁₂₃₄₅₆₇₈₉';

function mappedReplace(state,pattern,replacement){
  const source=state.text,nextText=[],nextMap=[];let cursor=0;pattern.lastIndex=0;
  for(let match=pattern.exec(source);match;match=pattern.exec(source)){
    nextText.push(source.slice(cursor,match.index));nextMap.push(...state.map.slice(cursor,match.index));
    const value=typeof replacement==='function'?replacement(...match,match.index,source):replacement;
    nextText.push(value);nextMap.push(...Array.from({length:value.length},()=>state.map[match.index]??match.index));
    cursor=match.index+match[0].length;if(!pattern.global)break;if(match[0]==='')pattern.lastIndex+=1;
  }
  nextText.push(source.slice(cursor));nextMap.push(...state.map.slice(cursor));
  return{text:nextText.join(''),map:nextMap};
}

const segment=value=>String(value||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
export function geometrySourceRole(text,index){
  const prefix=text.slice(0,index);
  const optionStart=prefix.lastIndexOf('\n');
  if(/^\s*[A-D][.、:：]/.test(prefix.slice(optionStart+1)))return 'query';
  const markers=[...prefix.matchAll(/已知|其中|又知|若|设|求证|证明|(?<!验)证|判断|是否|求|计算/g)];
  const latest=markers.at(-1)?.[0];
  return latest&&/^(求证|证明|证|判断|是否|求|计算)$/.test(latest)?'query':'given';
}

function extractMidpointMentions(text){
  const result=[],ranges=[];
  const paired=/([A-Z]\d*)\s*([A-Z]\d*)\s*分别(?:为|是)\s*([A-Z]\d*)([A-Z]\d*)\s*(?:[、,，]|与|和)?\s*([A-Z]\d*)([A-Z]\d*)\s*的?中点/g;
  for(const match of text.matchAll(paired)){
    ranges.push([match.index,match.index+match[0].length]);
    for(const [point,endpoints] of [[match[1],[match[3],match[4]]],[match[2],[match[5],match[6]]]])result.push({point,endpoints,role:geometrySourceRole(text,match.index),normalizedRange:ranges.at(-1)});
  }
  for(const match of text.matchAll(/([A-Z]\d*)\s*(?:为|是)\s*([A-Z]\d*)([A-Z]\d*)\s*的?中点/g)){
    if(ranges.some(([start,end])=>match.index>=start&&match.index<end))continue;
    result.push({point:match[1],endpoints:[match[2],match[3]],role:geometrySourceRole(text,match.index),normalizedRange:[match.index,match.index+match[0].length]});
  }
  return result;
}

function extractQuantityMentions(text){
  const mentions=[];
  const angleChain=/((?:(?:∠|角)?\s*(?:[A-Z]\d*){3}\s*=\s*){2,})((?:sqrt\([^)]*\)|√\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?))\s*(°|度)?/gi;
  for(const match of text.matchAll(angleChain)){
    const expression=match[2].replace(/\s+/g,'');
    for(const subject of match[1].toUpperCase().match(/(?:[A-Z]\d*){3}/g)||[])mentions.push({kind:'angle',subject,expression,unit:match[3]||null,role:geometrySourceRole(text,match.index),normalizedRange:[match.index,match.index+match[0].length]});
  }
  // Preserve a whole arithmetic RHS: never truncate 2+sqrt(3) to 2.
  const pattern=/(?<![A-Za-z0-9:：])((?:(?:[A-Z]\d*){2,3}\s*=\s*)+)([0-9√+\-*/().\s^]+|sqrt\([^)]*\))/g;
  for(const match of text.matchAll(pattern)){
    const start=match.index+match[1].length;
    const tail=text.slice(start).match(/^[0-9√+\-*/().\s^]*(?:sqrt\([^)]*\)[0-9√+\-*/().\s^]*)*/)?.[0]||'';
    const expression=tail.trim().replace(/[.。]+$/,'');
    if(!expression||/[A-Za-z]/.test(text[start+tail.length]||''))continue;
    for(const label of match[1].match(/(?:[A-Z]\d*){2,3}/g)||[]){
      mentions.push({kind:label.match(/[A-Z]/g).length===3?'angle':'length',subject:label,expression,role:geometrySourceRole(text,match.index),normalizedRange:[match.index,start+tail.length]});
    }
  }
  const expressionPattern='(?:sqrt\\([^)]*\\)|√\\s*\\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?(?:\\s*[+\\-*/^]\\s*(?:sqrt\\([^)]*\\)|√\\s*\\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?))*)';
  const natural=new RegExp(`(?<![:：A-Z0-9])(?:(∠|角)\\s*)?((?:[A-Z]\\d*){2,3})\\s*(?:的?长度|长)?\\s*(?:为|是|=)\\s*(${expressionPattern})\\s*(cm|mm|m|厘米|毫米|米|°|度)?`,'gi');
  for(const match of text.matchAll(natural)){
    const letters=match[2].match(/[A-Z]/gi)||[],isAngle=Boolean(match[1])||letters.length===3||/°|度/.test(match[4]||'');
    mentions.push({kind:isAngle?'angle':'length',subject:match[2].toUpperCase(),expression:match[3].replace(/\s+/g,''),unit:match[4]||null,role:geometrySourceRole(text,match.index),normalizedRange:[match.index,match.index+match[0].length]});
  }
  const seen=new Set();
  return mentions.filter(item=>{const key=[item.kind,item.subject,item.expression,item.role].join('|');if(seen.has(key))return false;seen.add(key);return true;});
}

const PARAMETER_NAMES=Object.freeze([
  {name:'planeDistance',labels:['球心到截平面的距离','球心到截面所在平面的距离','球心到平面的距离','截平面到球心的距离']},
  {name:'sectionDiameter',labels:['截面圆直径','截面直径']},
  {name:'sectionRadius',labels:['截面圆半径','截面半径']},
  {name:'radius',labels:['圆柱底面半径','圆锥底面半径','底面半径','球半径','半径']},
  {name:'height',labels:['圆柱高','圆锥高','棱柱高','棱锥高','高']},
  {name:'slant',labels:['母线长','母线']},
  {name:'edge',labels:['棱长','底面边长','底边长','边长']}
]);

function extractParameterMentions(text){
  const result=[];
  const expression='(sqrt\\([^)]*\\)|√\\s*\\d+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  for(const entry of PARAMETER_NAMES)for(const label of entry.labels){
    const pattern=new RegExp(`${label}\\s*(?:为|是|=)\\s*${expression}\\s*(cm|mm|m|厘米|毫米|米)?`,'gi');
    for(const match of text.matchAll(pattern))result.push({kind:'parameter',name:entry.name,label,expression:match[1].replace(/\s+/g,''),unit:match[2]||null,role:geometrySourceRole(text,match.index),normalizedRange:[match.index,match.index+match[0].length]});
  }
  return result.filter((item,index,list)=>!list.slice(0,index).some(other=>other.name===item.name&&other.normalizedRange[0]<=item.normalizedRange[0]&&other.normalizedRange[1]>=item.normalizedRange[1]));
}

function extractRatioMentions(text){
  const result=[];
  const pattern=/((?:[A-Z]\d*){2})\s*[:：]\s*((?:[A-Z]\d*){2})\s*(?:=|为|是)\s*(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)/gi;
  for(const match of text.matchAll(pattern))result.push({kind:'ratio',first:match[1].toUpperCase(),second:match[2].toUpperCase(),firstValue:Number(match[3]),secondValue:Number(match[4]),role:geometrySourceRole(text,match.index),normalizedRange:[match.index,match.index+match[0].length]});
  return result;
}

function extractStructuralMentions(text){
  const result=[],projectionRanges=[];
  const push=(kind,match,data={})=>result.push({kind,...data,quote:match[0],role:geometrySourceRole(text,match.index),normalizedRange:[match.index,match.index+match[0].length]});
  for(const match of text.matchAll(/([A-Z]\d*)\s*(?:为|是)\s*([A-Z]\d*)\s*在\s*平面\s*((?:[A-Z]\d*){3,})\s*上(?:的)?(?:投影|垂足)/gi)){
    projectionRanges.push([match.index,match.index+match[0].length]);
    push('projection',match,{foot:match[1].toUpperCase(),point:match[2].toUpperCase(),plane:(match[3].toUpperCase().match(/[A-Z]\d*/g)||[])});
  }
  for(const match of text.matchAll(/([A-Z]\d*)\s*在\s*(?:直线|线段)\s*((?:[A-Z]\d*){2})\s*上/gi))push('point_on_line',match,{point:match[1].toUpperCase(),line:(match[2].toUpperCase().match(/[A-Z]\d*/g)||[])});
  for(const match of text.matchAll(/([A-Z]\d*)\s*在\s*平面\s*((?:[A-Z]\d*){3,})\s*(?:内|上)/gi)){
    if(projectionRanges.some(([start,end])=>match.index>=start&&match.index<end))continue;
    push('point_on_plane',match,{point:match[1].toUpperCase(),plane:(match[2].toUpperCase().match(/[A-Z]\d*/g)||[])});
  }
  for(const match of text.matchAll(/((?:[A-Z]\d*\s*[,、，]\s*){2,}[A-Z]\d*)\s*共面/gi))push('coplanar',match,{points:(match[1].toUpperCase().match(/[A-Z]\d*/g)||[])});
  const segment='(?:[A-Z]\\d*){2}';
  for(const match of text.matchAll(new RegExp(`(?<![A-Z0-9])(${segment}(?:\\s*=\\s*${segment})+)(?!\\s*=\\s*(?:\\d|√|sqrt))`,'gi'))){
    const segments=match[1].toUpperCase().match(new RegExp(segment,'g'))||[];
    if(segments.length>=2)push('equal_length',match,{segments:segments.map(item=>item.match(/[A-Z]\d*/g)||[])});
  }
  for(const match of text.matchAll(/(?:直线\s*)?((?:[A-Z]\d*){2})\s*与\s*(圆|球)\s*([A-Z]\d*)\s*相切(?:于\s*([A-Z]\d*))?/gi))push('tangent',match,{line:(match[1].toUpperCase().match(/[A-Z]\d*/g)||[]),bodyKind:match[2]==='球'?'sphere':'circle',center:match[3].toUpperCase(),touchPoint:match[4]?.toUpperCase()||null});
  for(const match of text.matchAll(/((?:[A-Z]\d*){2})\s*与\s*((?:[A-Z]\d*){2})\s*交于\s*([A-Z]\d*)/gi))push('intersection',match,{first:(match[1].toUpperCase().match(/[A-Z]\d*/g)||[]),second:(match[2].toUpperCase().match(/[A-Z]\d*/g)||[]),point:match[3].toUpperCase()});
  const quadrilateralKinds={正方形:'square',矩形:'rectangle',菱形:'rhombus',平行四边形:'parallelogram',梯形:'trapezoid'};
  for(const match of text.matchAll(/((?:[A-Z]\d*){4})\s*(?:为|是)\s*(正方形|矩形|菱形|平行四边形|梯形)/gi))push('quadrilateral_type',match,{points:(match[1].toUpperCase().match(/[A-Z]\d*/g)||[]),shape:quadrilateralKinds[match[2]]});
  return result;
}
function relationOperand(value){
  const raw=String(value||'').replace(/\s+/g,'');
  if(raw.startsWith('平面'))return`plane:${raw.slice(2)}`;
  if(raw.startsWith('直线'))return`line:${raw.slice(2)}`;
  return raw.toUpperCase();
}
const relationMention=(kind,match)=>({
  id:`source-${kind}-${match.index}`,
  kind,
  operands:[relationOperand(match[1]),relationOperand(match[2])],
  quote:match[0],
  normalizedRange:[match.index,match.index+match[0].length]
});

export const GEOMETRY_RELATION_LEXICON=Object.freeze({
  perpendicular:{symbol:'⊥',aliases:['⊥','⟂','\\perp','垂直','垂直于']},
  parallel:{symbol:'∥',aliases:['∥','//','\\parallel','平行','平行于']}
});

function extractRelationMentions(text){
  const mentions=[];
  const operand='(?:平面\\s*(?:(?:[A-Z]\\d*){3,}|[α-ωΑ-Ω])|直线\\s*[a-z]|(?:[A-Z]\\d*){2})';
  const patterns={
    perpendicular:new RegExp(`(${operand})\\s*⊥\\s*(${operand})`,'gi'),
    parallel:new RegExp(`(${operand})\\s*(?:∥|平行)\\s*(${operand})`,'gi')
  };
  for(const[kind,pattern]of Object.entries(patterns))for(const match of text.matchAll(pattern))mentions.push(relationMention(kind,match));
  return mentions.sort((a,b)=>a.normalizedRange[0]-b.normalizedRange[0]).map(item=>({...item,role:geometrySourceRole(text,item.normalizedRange[0])}));
}

function extractQueryMentions(text){
  const result=[];
  const definitions=[
    ['volume',/(?:求|计算)[^。；;\n]{0,40}?体积/g],
    ['surface_area',/(?:求|计算)[^。；;\n]{0,40}?表面积/g],
    ['distance',/(?:求|计算)[^。；;\n]{0,40}?距离/g],
    ['angle',/(?:求|计算)[^。；;\n]{0,40}?(?:夹角|线面角|二面角|余弦值|正弦值|正切值)/g],
    ['proof',/(?:求证|证明|证(?=\s*[A-Z]))[^。；;\n]*/g],
    ['radius',/(?:求|计算)[^。；;\n]{0,40}?半径/g],
    ['diameter',/(?:求|计算)[^。；;\n]{0,40}?直径/g],
    ['area',/(?:求|计算)[^。；;\n]{0,40}?(?<!表)面积/g],
    ['boolean',/(?:判断|验证)[^。；;\n]{0,40}?(?:是否|能否|成立|共面|平行|垂直)/g],
    ['coordinate',/(?:求|计算)[^。；;\n]{0,40}?坐标/g],
    ['equation',/(?:求|写出|确定)[^。；;\n]{0,40}?方程/g],
    ['locus',/(?:求|确定)[^。；;\n]{0,40}?轨迹/g],
    ['extremum',/(?:求|确定)[^。；;\n]{0,40}?(?:最值|最大值|最小值)/g]
  ];
  const queryTarget=(kind,quote)=>{
    const value=String(quote||'').toUpperCase().replace(/\s+/g,'');
    const namedSolid=value.match(/(棱锥|四面体|棱柱|三棱柱|直棱柱|正方体|长方体)([A-Z]\d*(?:-[A-Z]\d*(?:[A-Z]\d*)+|(?:[A-Z]\d*){2,}))/i);
    if(namedSolid){
      const kinds={棱锥:'pyramid',四面体:'tetrahedron',棱柱:'prism',三棱柱:'prism',直棱柱:'prism',正方体:'cube',长方体:'cuboid'};
      return{target:namedSolid[2],targetEntityKind:kinds[namedSolid[1]]};
    }
    if(['radius','diameter','surface_area','area','volume'].includes(kind)){
      const centered=value.match(/(球|圆柱|圆锥|圆)([A-Z]\d*)/i);
      if(centered){const kinds={球:'sphere',圆柱:'cylinder',圆锥:'cone',圆:'circle'};return{target:centered[2],targetEntityKind:kinds[centered[1]]};}
    }
    return null;
  };
  for(const[kind,pattern]of definitions)for(const match of text.matchAll(pattern)){
    const target=queryTarget(kind,match[0])||{};
    result.push({id:`query-source-${kind}-${match.index}`,kind,quote:match[0],...target,normalizedRange:[match.index,match.index+match[0].length]});
  }
  return result.sort((a,b)=>a.normalizedRange[0]-b.normalizedRange[0]);
}

export function normalizeGeometryLanguage(value,options={}){
  const original=String(value||'');
  let state={text:original,map:Array.from(original,(_,index)=>index)};
  state=mappedReplace(state,/[０-９]/g,digit=>String(FULL_WIDTH_DIGITS.indexOf(digit)));
  state=mappedReplace(state,/[₀-₉]/g,digit=>String(SUBSCRIPT_DIGITS.indexOf(digit)));
  state=mappedReplace(state,/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,(_,numerator,denominator)=>`(${numerator})/(${denominator})`);
  state=mappedReplace(state,/\\sqrt\s*\{([^{}]+)\}/g,(_,radicand)=>`sqrt(${radicand})`);
  state=mappedReplace(state,/[$￥]/g,'');
  state=mappedReplace(state,/([A-Z])\s*(?:下标|小标)\s*(\d+)/gi,(_,point,suffix)=>`${point}${suffix}`);
  state=mappedReplace(state,/([A-Z])\s*_?\s*\{?\s*([0-9])\s*\}?/g,(_,point,suffix)=>`${point}${suffix}`);
  state=mappedReplace(state,/(AD\s*=\s*\d+(?:\.\d+)?)\s*A\s*[、,，]\s*A(\d)\s*=/gi,(_,prefix,suffix)=>`${prefix},AA${suffix}=`);
  state=mappedReplace(state,/([A-Z]\d?)\s*到\s*([A-Z]\d?)\s*(?=分别)/gi,(_,a,b)=>`${a}${b}`);
  for(const[word,digits]of [['一百二十','120'],['九十','90'],['六十','60'],['四十五','45']])state=mappedReplace(state,new RegExp(`${word}(?=\\s*度)`,'g'),digits);
  state=mappedReplace(state,/等于/g,'=');
  state=mappedReplace(state,/[‐‑‒–—−]/g,'-');
  if(!options.preservePunctuation){
    state=mappedReplace(state,/[，]/g,',');state=mappedReplace(state,/[；]/g,';');state=mappedReplace(state,/[：]/g,':');
    state=mappedReplace(state,/[（]/g,'(');state=mappedReplace(state,/[）]/g,')');
  }
  /* 只在明确的两端点关系上下文中消除语音标点/空格，普通中文逗号仍保留。 */
  state=mappedReplace(state,/([A-Z]\d?)\s*[,，、]\s*([A-Z]\d?)(?=\s*(?:与|和|分别|⊥|⟂|垂直|∥|平行|夹角|向量|直线))/gi,(_,a,b)=>`${a}${b}`);
  state=mappedReplace(state,/([A-Z]\d?)\s+([A-Z]\d?)(?=\s*(?:与|和|分别|⊥|⟂|垂直|∥|平行|夹角|向量|直线|$))/gi,(_,a,b)=>`${a}${b}`);
  state=mappedReplace(state,/\\perp|⟂|垂直(?!平分|投影|方向|高度)于?/gi,'⊥');
  /* “平行六面体”是实体名；只有关系词“平行于”在此处规范化。 */
  state=mappedReplace(state,/\\parallel|(?<!:)\/\/|平行于/gi,'∥');
  state=mappedReplace(state,/[ \t]+/g,' ');state=mappedReplace(state,/ *\n */g,'\n');
  const leading=state.text.length-state.text.trimStart().length,text=state.text.trim(),map=state.map.slice(leading,leading+text.length);
  let clauseCursor=0;
  const clauses=text.split(/(?<=[。.!?！？;；])|[,，](?=\s*(?:求|证明|且|又|其中|若|则))/).map(item=>{
    const clause=item.trim(),start=text.indexOf(clause,clauseCursor);
    if(start>=0)clauseCursor=start+clause.length;
    return clause?{text:clause,normalizedRange:[Math.max(0,start),Math.max(0,start)+clause.length]}:null;
  }).filter(Boolean).map((clause,index)=>({id:`clause-${index+1}`,...clause}));
  const relationMentions=extractRelationMentions(text),quantityMentions=extractQuantityMentions(text),midpointMentions=extractMidpointMentions(text),parameterMentions=extractParameterMentions(text),ratioMentions=extractRatioMentions(text),structuralMentions=extractStructuralMentions(text),queryMentions=extractQueryMentions(text);
  const conditionAtoms=[...quantityMentions,...parameterMentions,...ratioMentions,...relationMentions,...midpointMentions,...structuralMentions].map((item,index)=>({id:`condition-${index+1}`,...item}));
  return{text,map,clauses,relationMentions,quantityMentions,midpointMentions,parameterMentions,ratioMentions,structuralMentions,queryMentions,conditionAtoms};
}
