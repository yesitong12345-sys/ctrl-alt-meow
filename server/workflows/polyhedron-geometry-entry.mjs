import {normalizeGeometryLanguage} from './geometry-language-normalizer.mjs';

const normalize=value=>normalizeGeometryLanguage(String(value||'').replace(/\\[()]/g,''),{preservePunctuation:true}).text;

const numberPattern = '(\\d+(?:\\.\\d+)?)';
const scalarPattern = '(?:\\d+(?:\\.\\d+)?|√\\s*\\d+(?:\\.\\d+)?|sqrt\\s*\\(\\s*\\d+(?:\\.\\d+)?\\s*\\)|\\\\sqrt\\s*\\{\\s*\\d+(?:\\.\\d+)?\\s*\\})';
const points = value => String(value || '').toUpperCase().match(/[A-Z](?:\d+)?/g) || [];
const addPoint=(first,second)=>first.map((value,index)=>value+second[index]);
const scalarValue = value => {
  const text=String(value||'').replace(/\s+/g,'');
  const radical=text.match(/^(?:√|\\sqrt\{|sqrt\()(\d+(?:\.\d+)?)[})]?$/);
  return radical?Math.sqrt(Number(radical[1])):Number(text);
};
const scalarLabel=value=>{
  const numeric=Number(value);
  const nearest=Math.round(numeric);
  if(Math.abs(numeric-nearest)<1e-9)return String(nearest);
  const squared=numeric*numeric,integer=Math.round(squared);
  if(integer>0&&Math.abs(squared-integer)<1e-9)return `√${integer}`;
  return String(Number(numeric.toFixed(6)));
};
const metricFacts = text => {
  const facts=new Map(),source=String(text||'').replace(/等于/g,'=').replace(/\\sqrt\s*\{\s*([^}]+)\s*\}/g,'√$1');
  const segment='[A-Z]\\d?[A-Z]\\d?';
  for(const match of source.matchAll(new RegExp(`(?<![A-Z0-9])((?:${segment}\\s*=\\s*)+)(${scalarPattern})`,'gi'))){
    const value=scalarValue(match[2]);
    if(Number.isFinite(value)) for(const label of match[1].match(new RegExp(segment,'gi'))||[]) facts.set(label.toUpperCase(),value);
  }
  for(const match of source.matchAll(new RegExp(`(?<![A-Z0-9])(${segment})\\s*=\\s*(${scalarPattern})`,'gi'))){
    const value=scalarValue(match[2]);if(Number.isFinite(value)&&!facts.has(match[1].toUpperCase()))facts.set(match[1].toUpperCase(),value);
  }
  return facts;
};
const namedNumber = (text, labels) => {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*(?:为|是|=)?\\s*${numberPattern}`, 'i'));
    if (match) return Number(match[1]);
  }
  return NaN;
};

function commonQueries(text, solid) {
  const queries = [];
  /* “M、N 分别是 AB、CD 的中点”经语音转写后常成为
     “MN分别是ABCD的中点”。分别关系提供了唯一的顺序配对。 */
  const pairedMidpoints=text.match(/([A-Z]\d?)([A-Z]\d?)\s*分别(?:为|是)\s*([A-Z]\d?)([A-Z]\d?)\s*(?:[、,，]|与|和)?\s*([A-Z]\d?)([A-Z]\d?)\s*(?:的)?中点/i);
  if(pairedMidpoints){
    queries.push(
      {id:`midpoint-${pairedMidpoints[1].toUpperCase()}`,kind:'point_on_segment',pointId:pairedMidpoints[1].toUpperCase(),segment:[pairedMidpoints[3].toUpperCase(),pairedMidpoints[4].toUpperCase()],parameter:0.5},
      {id:`midpoint-${pairedMidpoints[2].toUpperCase()}`,kind:'point_on_segment',pointId:pairedMidpoints[2].toUpperCase(),segment:[pairedMidpoints[5].toUpperCase(),pairedMidpoints[6].toUpperCase()],parameter:0.5}
    );
  }
  const midpoint=text.match(/([A-Z]\d?)\s*(?:为|是)\s*([A-Z]\d?)([A-Z]\d?)\s*(?:的)?中点/i);
  if(midpoint&&!queries.some(query=>query.pointId===midpoint[1].toUpperCase()))queries.push({id:`midpoint-${midpoint[1].toUpperCase()}`,kind:'point_on_segment',pointId:midpoint[1].toUpperCase(),segment:[midpoint[2].toUpperCase(),midpoint[3].toUpperCase()],parameter:0.5});
  const vectorAngle=text.match(/(?:向量\s*)?([A-Z]\d?[A-Z]\d?)\s*(?:与|和)\s*(?:向量\s*)?([A-Z]\d?[A-Z]\d?)[^。；]{0,24}夹角[^。；]{0,16}(?:余弦|cos)/i);
  if(vectorAngle){const first=points(vectorAngle[1]),second=points(vectorAngle[2]);if(first.length===2&&second.length===2)queries.push({id:'vector-angle',kind:'vector_relation',first,second});}
  const relationMentions=normalizeGeometryLanguage(text,{preservePunctuation:true}).relationMentions;
  for(const relation of relationMentions){
    const first=points(relation.operands[0]),second=points(relation.operands[1]);
    if(first.length!==2||second.length!==2)continue;
    const expectation=relation.kind==='parallel'?{parallel:true}:{perpendicular:true};
    const duplicate=queries.some(query=>query.kind==='vector_relation'&&query.expectation?.[relation.kind]&&query.first.join('')===first.join('')&&query.second.join('')===second.join(''));
    if(!duplicate)queries.push({id:queries.some(query=>query.id==='vector-relation')?`vector-relation-${queries.filter(query=>query.kind==='vector_relation').length+1}`:'vector-relation',kind:'vector_relation',first,second,expectation,sourceRole:relation.role});
  }
  const linePlane = text.match(/直线\s*([A-Z]\d?[A-Z]\d?)\s*与\s*平面\s*([A-Z]\d?[A-Z]\d?[A-Z]\d?[A-Z]?\d?)/i);
  if (linePlane) {
    const line = points(linePlane[1]), plane = points(linePlane[2]);
    if (line.length === 2 && plane.length >= 3) queries.push({id:'line-plane-angle',kind:'line_plane_angle',line,plane:plane.slice(0,3)});
  }
  const pointPlane = text.match(/点\s*([A-Z]\d?)\s*到\s*平面\s*([A-Z]\d?[A-Z]\d?[A-Z]\d?[A-Z]?\d?)/i);
  if (pointPlane) {
    const plane = points(pointPlane[2]);
    if (plane.length >= 3) queries.push({id:'point-plane-distance',kind:'point_plane_distance',point:pointPlane[1],plane:plane.slice(0,3)});
  }
  const segmentLength = text.match(/求\s*(?:侧棱|线段|棱)?\s*([A-Z]\d?)([A-Z]\d?)\s*(?:的)?长度/i);
  if (segmentLength) queries.push({id:'segment-length',kind:'segment_length',points:[segmentLength[1].toUpperCase(),segmentLength[2].toUpperCase()]});
  const sectionDistance = text.match(new RegExp(`距(?:离)?底面\\s*${numberPattern}[^。；]{0,28}(?:平行于底面|平行底面|截面)|(?:平行于底面|平行底面)[^。；]{0,28}距(?:离)?底面\\s*${numberPattern}`));
  if (sectionDistance) {
    const height = Number(sectionDistance[1] || sectionDistance[2]);
    if (height >= 0) queries.push({id:'section',kind:'polyhedron_section',plane:{normal:[0,0,1],offset:height}});
  }
  return queries;
}

export function parseStandardPolyhedronText(questionText = '') {
  const text = normalize(questionText);
  if (!text) return null;

  const compact=text.replace(/\s+/g,'');
  const perpendicularSquares=compact.match(/正方形([A-Z]{4}).*?正方形([A-Z]{4}).*?(?:平面)?(?:互相)?(?:垂直|⊥)/i);
  if(perpendicularSquares){
    const first=[...perpendicularSquares[1].toUpperCase()],second=[...perpendicularSquares[2].toUpperCase()],shared=first.filter(id=>second.includes(id));
    const side=namedNumber(text,['边长均','边长']);
    const adjacent=(cycle,a,b)=>cycle.some((id,index)=>id===a&&cycle[(index+1)%cycle.length]===b);
    if(!(side>0))return {status:'needs_more_context',missing:['两个正方形的边长']};
    if(shared.length!==2||(!adjacent(first,shared[0],shared[1])&&!adjacent(first,shared[1],shared[0]))||(!adjacent(second,shared[0],shared[1])&&!adjacent(second,shared[1],shared[0])))return {status:'needs_more_context',missing:['两个正方形的公共边顶点对应关系']};
    const coordinates={
      [first[0]]:[0,0,0],[first[1]]:[0,side,0],[first[2]]:[side,side,0],[first[3]]:[side,0,0]
    };
    let index=second.findIndex((id,position)=>shared.includes(id)&&shared.includes(second[(position+1)%4]));
    const p=second[index],q=second[(index+1)%4],r=second[(index+2)%4],t=second[(index+3)%4];
    coordinates[r]=addPoint(coordinates[q],[0,0,side]);coordinates[t]=addPoint(coordinates[p],[0,0,side]);
    const queries=commonQueries(text,{kind:'surface_complex'});
    const affine=text.match(/(?:向量\s*)?([A-Z]\d?)([A-Z]\d?)\s*=\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:向量\s*)?([A-Z]\d?)([A-Z]\d?)/i);
    if(affine){
      const factor=Number(affine[3])/Number(affine[4]);
      if(Number.isFinite(factor)&&factor>0&&affine[2].toUpperCase()===affine[5].toUpperCase())queries.push({id:`affine-point-${affine[2].toUpperCase()}`,kind:'affine_point',pointId:affine[2].toUpperCase(),first:[affine[1].toUpperCase(),affine[2].toUpperCase()],second:[affine[5].toUpperCase(),affine[6].toUpperCase()],factor});
    }
    const lengthQuery=text.match(/线段\s*([A-Z]\d?)([A-Z]\d?)\s*(?:的)?长/i)||text.match(/求\s*([A-Z]\d?)([A-Z]\d?)\s*(?:的)?长/i);
    if(lengthQuery)queries.push({id:`segment-length-${lengthQuery[1].toUpperCase()}${lengthQuery[2].toUpperCase()}`,kind:'segment_length',points:[lengthQuery[1].toUpperCase(),lengthQuery[2].toUpperCase()]});
    const boundary=[...new Set([...first.map((id,i)=>[id,first[(i+1)%4]]),...second.map((id,i)=>[id,second[(i+1)%4]])].map(edge=>edge.join('')))];
    const constraints=boundary.map((edge,index)=>({id:`square-edge-${index+1}`,kind:'length',points:[edge[0],edge[1]],value:side,hard:true}));
    constraints.push({id:'square-planes-perpendicular',kind:'plane_perpendicular',firstPlane:first.slice(0,3),secondPlane:second.slice(0,3),hard:true});
    const dimensions=boundary.map((edge,index)=>({id:`given-edge-${index+1}`,points:[edge[0],edge[1]],label:`${edge} = ${scalarLabel(side)}`,valueSource:'explicitFacts.squareSide'}));
    return {questionText:text,labels:['空间平面垂直','向量共线与定比分点','空间距离'],problemIR:{schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'surface_complex',coordinates,faces:[first,second]},constraints,queries,dimensions}};
  }

  const parallelepipedTopology=compact.match(/ABCD-A(\d+)B\1C\1D\1/i);
  if (/平行六面体/.test(text) && parallelepipedTopology) {
    const topIndex=parallelepipedTopology[1],topA=`A${topIndex}`,topB=`B${topIndex}`,topC=`C${topIndex}`,topD=`D${topIndex}`;
    const facts=metricFacts(text),ab=facts.get('AB'),ad=facts.get('AD'),aa1=facts.get(`AA${topIndex}`);
    const angleValue=name=>{const match=text.match(new RegExp(`(?:∠|角)\\s*${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*°?`,'i'));return match?Number(match[1]):NaN;};
    const gamma=angleValue('DAB'),beta=angleValue(`BAA${topIndex}`),alpha=angleValue(`DAA${topIndex}`);
    const supplied=[ab,ad,aa1,gamma,beta,alpha];
    if(!supplied.every(Number.isFinite)||![ab,ad,aa1].every(value=>value>0))return {status:'needs_more_context',missing:['AB、AD、AA1 的长度','∠DAB、∠BAA1、∠DAA1'].filter((_,index)=>index===0?![ab,ad,aa1].every(value=>value>0):![gamma,beta,alpha].every(Number.isFinite))};
    if(![gamma,beta,alpha].every(value=>value>0&&value<180))return {status:'contradictory',missing:[]};
    const rad=value=>value*Math.PI/180,cosGamma=Math.cos(rad(gamma)),sinGamma=Math.sin(rad(gamma));
    if(Math.abs(sinGamma)<=1e-10)return {status:'contradictory',missing:[]};
    const u=[ab,0,0],v=[ad*cosGamma,ad*sinGamma,0],wx=aa1*Math.cos(rad(beta));
    const wy=(ad*aa1*Math.cos(rad(alpha))-v[0]*wx)/v[1],wzSquared=aa1*aa1-wx*wx-wy*wy;
    if(wzSquared<=1e-10)return {status:'contradictory',missing:[]};
    const w=[wx,wy,Math.sqrt(wzSquared)];
    const solid={kind:'parallelepiped',origin:[0,0,0],edgeVectors:[u,v,w],baseNames:['A','B','C','D'],topNames:[topA,topB,topC,topD]};
    const dimensions=[
      {id:'given-AB',points:['A','B'],label:`AB = ${scalarLabel(ab)}`,valueSource:'explicitFacts.AB'},
      {id:'given-AD',points:['A','D'],label:`AD = ${scalarLabel(ad)}`,valueSource:'explicitFacts.AD'},
      {id:`given-AA${topIndex}`,points:['A',topA],label:`AA${topIndex} = ${scalarLabel(aa1)}`,valueSource:`explicitFacts.AA${topIndex}`}
    ];
    const constraints=[
      {id:'given-length-AB',kind:'length',points:['A','B'],value:ab,hard:true},
      {id:'given-length-AD',kind:'length',points:['A','D'],value:ad,hard:true},
      {id:`given-length-AA${topIndex}`,kind:'length',points:['A',topA],value:aa1,hard:true},
      {id:'given-angle-DAB',kind:'angle',rays:[['A','D'],['A','B']],degrees:gamma,hard:true},
      {id:`given-angle-BAA${topIndex}`,kind:'angle',rays:[['A','B'],['A',topA]],degrees:beta,hard:true},
      {id:`given-angle-DAA${topIndex}`,kind:'angle',rays:[['A','D'],['A',topA]],degrees:alpha,hard:true}
    ];
    return {questionText:text,labels:['平行六面体','空间向量与垂直证明'],problemIR:{schemaVersion:'geometry-ir/polyhedron-v1',solid,constraints,queries:commonQueries(text,solid),dimensions}};
  }

  if (/长方体/.test(text)) {
    const dimensions = text.match(new RegExp(`长[、,，]?宽[、,，]?高分别(?:为|是)?\\s*${numberPattern}[、,，]?\\s*${numberPattern}[、,，]?\\s*${numberPattern}`));
    const length = dimensions ? Number(dimensions[1]) : namedNumber(text,['长']), width = dimensions ? Number(dimensions[2]) : namedNumber(text,['宽']), height = dimensions ? Number(dimensions[3]) : namedNumber(text,['高']);
    if (![length,width,height].every(value=>value>0)) return {status:'needs_more_context',missing:['长方体的长、宽、高']};
    const solid={kind:'cuboid',length,width,height};
    return {questionText:text,labels:['长方体','空间角与距离'],problemIR:{schemaVersion:'geometry-ir/polyhedron-v1',solid,queries:commonQueries(text,solid)}};
  }

  const tetrahedronTopology=text.match(/正四面体\s*([A-Z])\s*([A-Z])\s*([A-Z])\s*([A-Z])/i);
  if (tetrahedronTopology) {
    /* 纯角度问题与整体尺度无关；题目未给棱长时使用单位正四面体，
       不属于补造数学条件，而是选择一个相似代表模型。 */
    const edge=namedNumber(text,['棱长','边长']);
    const side=edge>0?edge:1,sqrt3=Math.sqrt(3),sqrt23=Math.sqrt(2/3),names=tetrahedronTopology.slice(1,5).map(name=>name.toUpperCase());
    if(new Set(names).size!==4)return {status:'contradictory',missing:[]};
    const [first,second,third,fourth]=names;
    const solid={kind:'pyramid',base:{[first]:[0,0,0],[second]:[side,0,0],[third]:[side/2,side*sqrt3/2,0]},apex:{[fourth]:[side/2,side*sqrt3/6,side*sqrt23]}};
    return {questionText:text,labels:['正四面体','空间向量夹角'],problemIR:{schemaVersion:'geometry-ir/polyhedron-v1',solid,queries:commonQueries(text,solid)}};
  }

  if (/直三棱柱/.test(text) && /ABC-A1B1C1/i.test(text.replace(/\s/g,''))) {
    const facts=metricFacts(text),ab=facts.get('AB')??namedNumber(text,['AB']),ac=facts.get('AC')??namedNumber(text,['AC']),height=facts.get('AA1')??namedNumber(text,['侧棱AA1','AA1','高']),bc=facts.get('BC')??namedNumber(text,['BC']);
    const rightAtA=/(?:以\s*A\s*为直角|∠\s*A\s*=\s*90|AB\s*[⊥⟂]\s*AC)/.test(text)||(ab>0&&ac>0&&bc>0&&Math.abs(ab*ab+ac*ac-bc*bc)<=1e-8*Math.max(1,bc*bc));
    if (![ab,ac,height].every(value=>value>0) || !rightAtA) return {status:'needs_more_context',missing:['底面直角三角形的两条直角边 AB、AC','侧棱 AA1']};
    const solid={kind:'prism',base:{A:[0,0,0],B:[ab,0,0],C:[0,ac,0]},translation:[0,0,height],topNames:['A1','B1','C1']},queries=commonQueries(text,solid);
    const dimensions=[
      {id:'given-AB',points:['A','B'],label:`AB = ${scalarLabel(ab)}`,valueSource:'explicitFacts.AB'},
      {id:'given-AC',points:['A','C'],label:`AC = ${scalarLabel(ac)}`,valueSource:'explicitFacts.AC'},
      {id:'given-AA1',points:['A','A1'],label:`AA₁ = ${scalarLabel(height)}`,valueSource:'explicitFacts.AA1'}
    ];
    if(bc>0)dimensions.push({id:'given-BC',points:['B','C'],label:`BC = ${scalarLabel(bc)}`,valueSource:'explicitFacts.BC'});
    if(queries.some(query=>query.kind==='point_on_segment'&&query.pointId==='E'&&query.segment.join('')==='BC')){
      const ae=Math.hypot(ab/2,ac/2);
      dimensions.push({id:'derived-AE',points:['A','E'],label:`AE = ${scalarLabel(ae)}`,valueSource:'derivedFacts.midpointE'});
    }
    return {questionText:text,labels:['直三棱柱','空间角与距离'],problemIR:{schemaVersion:'geometry-ir/polyhedron-v1',solid,queries,dimensions}};
  }

  if (/正四棱锥/.test(text) && /P-ABCD/i.test(text.replace(/\s/g,''))) {
    if (/E[^。；]{0,16}PC[^。；]{0,12}中点/i.test(text)&&/BE[^。；]{0,20}平面\s*PAC/i.test(text)) return null;
    const facts=metricFacts(text);
    const edge=namedNumber(text,['底面边长','底边长','边长']),height=facts.get('PO')??namedNumber(text,['棱锥高','高']);
    if (!(edge>0&&height>0)) return {status:'needs_more_context',missing:[!(edge>0)&&'底面边长',!(height>0)&&'棱锥高'].filter(Boolean)};
    const half=edge/2,solid={kind:'pyramid',base:{A:[-half,-half,0],B:[half,-half,0],C:[half,half,0],D:[-half,half,0]},apex:{P:[0,0,height]}};
    return {questionText:text,labels:['正四棱锥','空间角与距离'],problemIR:{schemaVersion:'geometry-ir/polyhedron-v1',solid,queries:commonQueries(text,solid)}};
  }
  return null;
}
