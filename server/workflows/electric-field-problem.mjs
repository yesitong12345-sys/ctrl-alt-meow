/*
 * A deliberately small boundary between a natural-language physics problem and
 * the interactive electric-field bench.  The bench accepts only relative,
 * declarative parameters; it never receives executable model output.
 */
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const numberAfter=(text,pattern)=>{
  const match=text.match(pattern);
  return match?Number(match[1]):null;
};
const has=(text,...words)=>words.some(word=>text.includes(word));
const compact=(value,limit=240)=>String(value??'').trim().slice(0,limit);

function inferDirection(text){
  if(has(text,'从右向左','向左','右到左','右向左'))return -1;
  if(has(text,'左正右负','左板带正电','左极板带正电'))return 1;
  if(has(text,'右正左负','右板带正电','右极板带正电'))return -1;
  return 1;
}

function pointsBench(text){
  const opposite=has(text,'异种','+Q','正电','负电','−Q','-Q');
  const distance=numberAfter(text,/(?:相距|距离|间距)\s*(\d+(?:\.\d+)?)/);
  const separation=clamp((distance||2)/2,0.65,1.8);
  return {
    mode:'points',charges:opposite?[{x:-separation,y:0,q:1},{x:separation,y:0,q:-1}]:[{x:-separation,y:0,q:1},{x:separation,y:0,q:1}],
    showLines:true,showPotential:true,showForce:true,showMotion:has(text,'运动','速度','进入','轨迹'),
    testQ:has(text,'负试探','负电粒子')?-1:1,testX:0,testY:-1.15,vx:.45
  };
}

export function compileElectricFieldProblem(question){
  const text=String(question||'').replace(/\s+/g,' ').trim();
  if(!text)return {status:'needs_more_context',notice:'请先提供可辨认的电场题干。',spec:{version:'electric-problem-spec/v1'}};
  const isPotentialGraph=has(text,'电势','V-x','V（x）','V(x)')&&has(text,'图','曲线','坐标');
  const isFieldGraph=has(text,'场强','E-x','E（x）','E(x)')&&has(text,'图','曲线','坐标');
  if(isPotentialGraph||isFieldGraph){
    const graphKind=isPotentialGraph?'potential_position':'field_position';
    const result={
      status:'needs_curve_confirmation',
      notice:'已识别为 '+(isPotentialGraph?'电势—位置':'场强—位置')+' 图。刻度或关键点未确认时，只能作为趋势示意，不能用于精确读数或自动求导。',
      spec:{version:'electric-problem-spec/v1',input:text,source:{kind:'graph_only'},graph:{kind:graphKind,confidence:'candidate',axisScaleConfirmed:false,samples:[]},query:has(text,'方向')?'field_direction':'graph_relation'},
      bench:{mode:'uniform',profileV:null,profileE:null,showLines:false,showPotential:false,showForce:true,showMotion:false},
      confirmation:['确认横轴、纵轴分别表示什么','补充坐标刻度、单位和关键点','确认曲线是否为题图原线而非手绘草图'],
      motionPrinciple:buildElectricMotionPrinciple(text)
    };
    result.guidanceSteps=normalizeGuidanceSteps([],8,buildElectricGuidanceSteps(result));
    return result;
  }
  const kind=has(text,'平行板','两平行金属板','极板','匀强电场')?'parallel_plates'
    :has(text,'圆环','环形')?'charged_ring'
      :has(text,'球壳','空心球')?'spherical_shell'
        :has(text,'实心球','均匀带电球')?'solid_sphere':'point_charges';
  let bench;
  if(kind==='parallel_plates'){
    const voltage=numberAfter(text,/(?:U|电压)\s*[=为]?\s*(\d+(?:\.\d+)?)/i);
    const distance=numberAfter(text,/(?:d|间距|相距)\s*[=为]?\s*(\d+(?:\.\d+)?)/i);
    const relative=voltage&&distance?clamp(voltage/distance/25,.25,2):1;
    bench={mode:'uniform',field:inferDirection(text)*relative,showLines:true,showPotential:true,showForce:true,
      showMotion:has(text,'粒子','电子','质子','初速度','轨迹','运动'),testQ:has(text,'电子','负电粒子')?-1:1,
      specificCharge:1,vx:.45,testX:0,testY:-1.15};
  }else if(kind==='charged_ring')bench={mode:'ring',q:has(text,'负电')?-1:1,radius:1.05,showLines:true,showPotential:true,showForce:true,showMotion:false};
  else if(kind==='spherical_shell')bench={mode:'shell',q:has(text,'负电')?-1:1,radius:1.05,showLines:true,showPotential:true,showForce:true,showMotion:false};
  else if(kind==='solid_sphere')bench={mode:'solid',q:has(text,'负电')?-1:1,radius:1.05,showLines:true,showPotential:true,showForce:true,showMotion:false};
  else bench=pointsBench(text);
  // “粒子从左向右进入” describes velocity, not necessarily the field.
  // Keep direction as a confirmation item unless the plate polarity is explicit.
  const needsDirection=kind==='parallel_plates'&&!has(text,'左正右负','右正左负','左板带正电','右板带正电');
  const result={
    status:'ready_for_confirmation',
    notice:'已生成可交互的规范代表模型。数值先按相对比例显示；核对后可在面板继续微调。',
    spec:{version:'electric-problem-spec/v1',input:text,source:{kind},knowns:{voltage:numberAfter(text,/(?:U|电压)\s*[=为]?\s*(\d+(?:\.\d+)?)/i),distance:numberAfter(text,/(?:d|间距|相距)\s*[=为]?\s*(\d+(?:\.\d+)?)/i)},graph:null,query:has(text,'轨迹','运动')?'particle_motion':has(text,'电势')?'potential':'field'},
    bench,confirmation:needsDirection?['确认两板的正负极与电场方向']:[],motionPrinciple:buildElectricMotionPrinciple(text)
  };
  result.guidanceSteps=normalizeGuidanceSteps([],8,buildElectricGuidanceSteps(result));
  return result;
}

export function buildElectricMotionPrinciple(question){
  const text=String(question||'');
  const charge=text.includes('电子')||text.includes('负电')?'负电荷':'正电荷';
  const direction=text.includes('左正右负')||text.includes('左板带正电')?'向右'
    :text.includes('右正左负')||text.includes('右板带正电')?'向左':'由正电荷指向负电荷';
  const relation=`电场方向 ${direction}；电场力满足 F = qE，加速度满足 a = qE/m。${charge}的受力方向${charge==='负电荷'?'与电场方向相反':'与电场方向相同'}。`;
  const motion=has(text,'垂直进入','垂直射入','速度垂直','初速度垂直')
    ?'若初速度垂直于匀强电场，沿初速度方向做匀速运动、沿电场力方向做匀加速运动，轨迹为抛物线。'
    :has(text,'沿电场方向','顺着电场','逆着电场')
      ?'若初速度沿电场方向，粒子沿直线运动；顺着受力方向加速，反着受力方向减速。'
      :'轨迹由初速度与电场力的夹角决定；题干未明确夹角时，应先核对方向，再判断直线或曲线运动。';
  return {summary:relation+' '+motion,chargeSign:charge==='负电荷'?-1:1,fieldDirection:direction,formula:['F = qE','a = qE/m'],motion};
}

/* —— 结构化步骤表：给「本题电场实验台」做分步高亮 ——
   每步固定 output：{id,title,detail,key,targets[],action{op,target,...}}。
   target 只能取实验台上真实存在的控件名，客户端据此点亮并滚动到该控件。 */
const GUIDANCE_TARGETS=new Set(['scene','mode','charge','radius','testq','lines','point-sources','source-charge','curves','analyze','save','complete','edit','play','reset-dipole','reset-position','panel']);
const GUIDANCE_OPS=new Set(['highlight','focus','set-mode','set-charge','set-radius','set-testq','set-lines','move-test','toggle-motion','reset-dipole','reset-position']);
function guidanceStep(raw){
  if(!raw||typeof raw!=='object')return null;
  const title=compact(raw.title,60);
  if(!title)return null;
  const targets=(Array.isArray(raw.targets)?raw.targets:[raw.target]).map(item=>compact(item,24)).filter(item=>GUIDANCE_TARGETS.has(item));
  const action=raw.action&&typeof raw.action==='object'&&GUIDANCE_OPS.has(raw.action.op)?raw.action:null;
  const number=value=>Number.isFinite(Number(value))?Number(value):undefined;
  return {id:compact(raw.id,32)||'',title,detail:compact(raw.detail,170),key:compact(raw.key,130),
    targets:[...new Set(targets.length?targets:['scene'])],
    action:action?{op:action.op,target:GUIDANCE_TARGETS.has(action.target)?action.target:undefined,value:number(action.value),text:compact(action.text,32),
      x:number(action.x),y:number(action.y),charge:compact(action.charge,8),show:typeof action.show==='boolean'?action.show:undefined}:null};
}
export function normalizeGuidanceSteps(input,limit=8,fallback=[]){
  const list=(Array.isArray(input)?input:[]).map(guidanceStep).filter(Boolean).slice(0,limit);
  if(list.length)return list.map((step,index)=>({...step,id:step.id||('step-'+(index+1))}));
  return (Array.isArray(fallback)?fallback:[]).map(guidanceStep).filter(Boolean).slice(0,limit).map((step,index)=>({...step,id:step.id||('step-'+(index+1))}));
}
/* 本地确定性兜底：没有视觉识别时，也能给出「每步 + 关键点 + 该动哪个控件」 */
export function buildElectricGuidanceSteps(result={}){
  const bench=result.bench||{},spec=result.spec||{},graph=spec.graph||null,query=String(spec.query||'');
  const mode=bench.mode||'points',charge=Number.isFinite(Number(bench.q))?Number(bench.q):(Number.isFinite(Number(bench.field))?Number(bench.field):1);
  const testNegative=Number(bench.testQ)<0;
  const steps=[];
  const modeName={uniform:'匀强电场/平行板',points:'点电荷与叠加',ring:'带电圆环轴线',shell:'带电球壳',solid:'均匀带电实心球'}[mode]||'匀强电场/平行板';
  steps.push({id:'model',title:'先选对模型：'+modeName,detail:'按题干选对场源模型；模型选错时后面所有的场线、曲线和运动都会跟着错。',
    key:'先判断电场来自「平行板」「点电荷」「带电圆环」还是「带电球/球壳」。',targets:['mode'],action:{op:'set-mode',target:'mode',text:mode}});
  if(graph&&String(graph.kind||'').includes('potential'))steps.push({id:'graph-axis',title:'核对该图是电势 V 随位置 x 的图',detail:'横轴是位置 x，纵轴是电势 V；确认刻度、单位与关键点之后再动曲线。',
    key:'V(x) 图的斜率大小对应场强 |E|，斜率正负对应场强方向；刻度没确认前只能当趋势示意。',targets:['curves','analyze'],action:{op:'highlight',target:'curves'}});
  else if(graph&&String(graph.kind||'').includes('field'))steps.push({id:'graph-axis',title:'核对该图是场强 E 随位置 x 的图',detail:'横轴是位置 x，纵轴是场强 E；注意方向的正负号。',
    key:'E(x) 图与 x 轴围成的面积对应两点间的电势差。',targets:['curves','analyze'],action:{op:'highlight',target:'curves'}});
  if(mode==='points'){
    steps.push({id:'dipole',title:'把两个场源摆成电偶极',detail:'一个正电荷、一个负电荷左右对称摆放，先把标准电偶极子摆出来再改参数。',
      key:'异种电荷等量对称 = 电偶极子；同种电荷则场线相互排斥。',targets:['point-sources','scene'],action:{op:'reset-dipole',target:'reset-dipole'}});
    steps.push({id:'charge-size',title:'调整场源电荷量 q',detail:'拖动点电荷的电荷量滑杆，观察场线疏密和场强大小如何变化。',
      key:'场强 E ∝ q；电荷量翻倍，同一位置的场强也翻倍。',targets:['point-sources','source-charge'],action:{op:'set-charge',target:'charge',value:charge}});
    steps.push({id:'drag-source',title:'拖动场源，看场线与电势怎么重建',detail:'直接拖动画面里的正、负电荷，观察场线实时重画。',
      key:'场线由正电荷出发、终止于负电荷；电荷位置一变，整幅场的几何就变了。',targets:['scene'],action:{op:'highlight',target:'scene'}});
  }else if(mode==='uniform'){
    steps.push({id:'field-size',title:'设定场源电荷/场强参数',detail:'用场源电荷滑杆给出匀强场的大小与方向，正负号决定方向。',
      key:'E = U/d；场强方向由正极板指向负极板，与试探电荷电性无关。',targets:['charge'],action:{op:'set-charge',target:'charge',value:charge}});
    steps.push({id:'lines',title:'勾选「显示场线」看匀强场',detail:'匀强场的场线是等间距平行直线，这是判断「匀强」最直接的图像特征。',
      key:'场线等间距且平行 ⇔ 各处场强大小方向都相同。',targets:['lines'],action:{op:'set-lines',target:'lines',show:true}});
  }else{
    steps.push({id:'radius',title:'先定半径 R，再看球/环的场分布',detail:'半径决定「内」「外」的分界；先固定 R，再比较内外场强的差别。',
      key:'球壳内部 E = 0；实心球内部 E 随 r 线性增大，外部都按 1/r² 减小。',targets:['radius'],action:{op:'set-radius',target:'radius',value:Number(bench.radius)||1.05}});
    steps.push({id:'lines',title:'勾选「显示场线」比较内外',detail:'观察场线在边界处的变化，体会高斯定理给出的分段结论。',
      key:'场线的密度直接反映场强大小。',targets:['lines'],action:{op:'set-lines',target:'lines',show:true}});
  }
  steps.push({id:'test-charge',title:'选定试探电荷的电性',detail:'正试探电荷受力与 E 同向，负试探电荷受力与 E 反向。',
    key:'受力方向 F = q₀E：电性的正负只改方向，不改大小。',targets:['testq'],action:{op:'set-testq',target:'testq',charge:testNegative?'−':'+'}});
  steps.push({id:'place-test',title:'把试探电荷放到要研究的点',detail:'拖动黄色试探电荷到题目关心的位置，读出该点的 E、V 和受力。',
    key:'要比较两点，就分别把试探电荷放过去读两次，再作差。',targets:['scene','panel'],action:{op:'highlight',target:'scene'}});
  if(query==='particle_motion'||bench.showMotion){
    steps.push({id:'motion',title:'播放理论运动并对照 x(t)',detail:'点「播放理论运动」，让试探电荷沿理论轨迹运动，再用 x(t) 图核对每一时刻的位置。',
      key:'类平抛：沿初速度方向匀速、沿电场力方向匀加速，轨迹为抛物线。',targets:['play','curves'],action:{op:'toggle-motion',target:'play',show:true}});
    steps.push({id:'restart',title:'回到初始位置再复算一次',detail:'用「回到初始位置」把试探电荷放回出发点，重放一次确认结论可复现。',
      key:'能重复复现的结论才算掌握；每次对照 x(t) 和 V(x) 一起看。',targets:['reset-position','play'],action:{op:'reset-position',target:'reset-position'}});
  }else{
    steps.push({id:'confirm',title:'核对结论并确认调制',detail:'确认模型、电荷与曲线都符合题意后，点「确定完成调制」把本题模型锁定保存。',
      key:'确认前先自查：模型选对没有、方向对不对、刻度确认没有。',targets:['complete','save'],action:{op:'highlight',target:'complete'}});
  }
  return normalizeGuidanceSteps(steps,8);
}

export function createDeepSeekElectricFieldGraphAdapter(config={}){
  return async ({question='',imageData=''})=>{
    if(!config.endpoint||!config.apiKey)throw Object.assign(new Error('DEEPSEEK_ELECTRIC_VISION_NOT_CONFIGURED'),{code:'DEEPSEEK_ELECTRIC_VISION_NOT_CONFIGURED'});
    const prompt=`分析这张高中物理题图，只关注电场示意图或电场相关坐标图。识别横轴、纵轴及（若图中存在）深度轴/第三坐标轴的物理量、符号、单位、范围、刻度和正方向；概括曲线分段走势、与坐标轴交点、极值和关键点。若刻度或点位看不清，写 null 并降低 confidence，不要猜数值。判断图是 V-x 电势图、E-x 场强图、带电粒子轨迹图、三维场分布还是其他。若为三维坐标系，描述图上 x/y/z 轴在图面中的大致指向；仅识别图片明确可见的方向，不依据透视猜物理方向。同时把这题整理成给学生看的分步解题表 guidanceSteps：每步都要有 标题（title）、这一步要做什么（detail）、关键点/易错点（key）、要高亮的控件（targets 数组）、可选动作（action）。targets 只能从这个集合里选：scene（电场图）、mode（模型下拉框）、charge（场源电荷滑杆）、radius（半径滑杆）、testq（试探电荷电性）、lines（显示场线）、point-sources（点电荷列表）、source-charge（某个点电荷的电荷量滑杆）、curves（电势/场强曲线）、analyze（AI分析按钮）、save（保存按钮）、complete（确定完成调制）、play（播放理论运动）、reset-dipole（恢复电偶极）、reset-position（回到初始位置）。action.op 只能取 highlight|focus|set-mode|set-charge|set-radius|set-testq|set-lines|move-test|toggle-motion|reset-dipole|reset-position；set-mode 时把模型名写进 action.text（uniform|points|ring|shell|solid）；set-charge/set-radius 把数值写进 action.value；set-testq 把正负写进 action.charge。按 JSON 输出：{"detected":true,"graphType":"potential_position|field_position|particle_trajectory|field_surface_3d|other","horizontalAxis":{"label":"","symbol":"","unit":"","min":null,"max":null,"scaleConfirmed":false},"verticalAxis":{"label":"","symbol":"","unit":"","min":null,"max":null,"scaleConfirmed":false},"depthAxis":{"label":"","symbol":"","unit":"","min":null,"max":null,"scaleConfirmed":false},"axisOrientation":{"xDirection":"","yDirection":"","zDirection":"","originVisible":false},"segments":[{"fromX":null,"toX":null,"trend":"increasing|decreasing|constant|unknown","fromY":null,"toY":null}],"keyPoints":[{"x":null,"y":null,"label":""}],"guidanceSteps":[{"id":"step-1","title":"","detail":"","key":"","targets":["scene"],"action":{"op":"highlight","target":"scene","value":null,"text":"","charge":""}}],"summary":"中文走势概述","confidence":0.0,"uncertainItems":["需学生核对的内容"]}。guidanceSteps 给 4 到 8 步，必须按解题真实顺序排列。用户补充题干：${compact(question,4000)}`;
    const content=[{type:'text',text:prompt},{type:'image_url',image_url:{url:imageData,detail:'high'}}];
    let failure;
    for(let attempt=0;attempt<3;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.timeoutMs||45000);
      try{
        const response=await (config.fetchImpl||fetch)(config.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.apiKey}`},signal:controller.signal,
          body:JSON.stringify({model:config.visionModel||'deepseek-flash',messages:[{role:'user',content}],temperature:0,response_format:{type:'json_object'}})});
        if(!response.ok){const error=Object.assign(new Error(`DEEPSEEK_ELECTRIC_VISION_HTTP_${response.status}`),{code:`DEEPSEEK_ELECTRIC_VISION_HTTP_${response.status}`});if(response.status<500&&response.status!==429)throw error;failure=error;}
        else{
          const body=await response.json(),raw=body?.choices?.[0]?.message?.content,parsed=typeof raw==='string'?JSON.parse(raw.replace(/^```json\s*|\s*```$/g,'')):raw;
          if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('DEEPSEEK_ELECTRIC_VISION_INVALID_JSON');
          const axis=value=>({label:compact(value?.label,80),symbol:compact(value?.symbol,24),unit:compact(value?.unit,32),min:Number.isFinite(value?.min)?value.min:null,max:Number.isFinite(value?.max)?value.max:null,scaleConfirmed:value?.scaleConfirmed===true&&Number.isFinite(value?.min)&&Number.isFinite(value?.max)&&value.max>value.min});
          return {detected:parsed.detected===true,graphType:['potential_position','field_position','particle_trajectory','field_surface_3d','other'].includes(parsed.graphType)?parsed.graphType:'other',
            horizontalAxis:axis(parsed.horizontalAxis),verticalAxis:axis(parsed.verticalAxis),depthAxis:axis(parsed.depthAxis),
            axisOrientation:{xDirection:compact(parsed.axisOrientation?.xDirection,80),yDirection:compact(parsed.axisOrientation?.yDirection,80),zDirection:compact(parsed.axisOrientation?.zDirection,80),originVisible:parsed.axisOrientation?.originVisible===true},
            segments:(Array.isArray(parsed.segments)?parsed.segments:[]).slice(0,16).map(item=>({fromX:Number.isFinite(item.fromX)?item.fromX:null,toX:Number.isFinite(item.toX)?item.toX:null,fromY:Number.isFinite(item.fromY)?item.fromY:null,toY:Number.isFinite(item.toY)?item.toY:null,trend:['increasing','decreasing','constant'].includes(item.trend)?item.trend:'unknown'})),
            keyPoints:(Array.isArray(parsed.keyPoints)?parsed.keyPoints:[]).slice(0,24).map(item=>({x:Number.isFinite(item.x)?item.x:null,y:Number.isFinite(item.y)?item.y:null,label:compact(item.label,40)})),
            summary:compact(parsed.summary,600),confidence:clamp(Number(parsed.confidence)||0,0,1),uncertainItems:(Array.isArray(parsed.uncertainItems)?parsed.uncertainItems:[]).map(item=>compact(item,120)).filter(Boolean).slice(0,12),
            guidanceSteps:normalizeGuidanceSteps(parsed.guidanceSteps,8)};
        }
      }catch(error){failure=error?.name==='AbortError'?Object.assign(new Error('DEEPSEEK_ELECTRIC_VISION_TIMEOUT'),{code:'DEEPSEEK_ELECTRIC_VISION_TIMEOUT'}):error;if(/HTTP_(401|402|403)/.test(failure?.code||''))throw failure;}
      finally{clearTimeout(timer)}
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
    throw failure||new Error('DEEPSEEK_ELECTRIC_VISION_FAILED');
  };
}
