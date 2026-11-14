import test from 'node:test';
import assert from 'node:assert/strict';

import {applyGeometryRepairPatch, createAnalyticGeometryFallback, createDeepSeekGeometryCompilerAdapter, createDeepSeekGeometryReviewAdapter, createDeepSeekGeometrySemanticReviewAdapter, createTrustedGeometryPipeline, normalizeGeometryInput, runGeometryEvidenceGate, validateGeometryCandidate, validateGeometryRepairResponse} from '../workflows/geometry-trusted-pipeline.mjs';

test('证据覆盖必须引用对应类型，模型不能自行降级题目事实或使用软约束冒充验证',()=>{
  const normalized=normalizeGeometryInput({questionText:'AB=4。'});
  const candidate={provider:'deepseek',sourceCoverage:[{clauseId:'clause-1',status:'explicit_fact',refs:['A']}],geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[{id:'f',name:'AB',value:4,evidenceRefs:['e'],hard:false,modelingRelevant:false}],derivedFacts:[],constraints:[{id:'c',kind:'distance',points:['A','B'],value:4,hard:false,factRefs:['f']}],queries:[],evidence:[{id:'e',kind:'text',quote:'AB=4'}]},candidateCoordinates:{A:[0,0,0],B:[4,0,0]}};
  const gate=runGeometryEvidenceGate(normalized,candidate);
  assert.ok(gate.issues.some(issue=>issue.code==='SOURCE_COVERAGE_REF_TYPE_MISMATCH'));
  assert.ok(gate.issues.some(issue=>issue.code==='HARD_FACT_NOT_VALIDATED'&&issue.path==='f'));
  candidate.sourceCoverage[0].refs=['f'];
  candidate.geometryIR.constraints[0].hard=true;
  assert.equal(runGeometryEvidenceGate(normalized,candidate).pass,true);
});

test('未经确定性证明的派生事实不能进入硬约束，也不能触发坐标求解兜底', async()=>{
  let fallbackCalls=0;
  const candidate={
    geometryIR:{
      schemaVersion:'geometry-ir/v4',
      entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],
      explicitFacts:[{id:'f-ab',kind:'quantity',name:'AB',value:4,evidenceRefs:['ev-ab']}],
      derivedFacts:[{id:'d-half',kind:'quantity',name:'halfAB',value:3,dependencies:['f-ab'],expression:'AB/2'}],
      constraints:[
        {id:'c-ab',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f-ab']},
        {id:'c-half',kind:'positive',value:3,hard:true,factRefs:['d-half']}
      ],
      queries:[],
      evidence:[{id:'ev-ab',kind:'text',quote:'AB=4'}]
    },
    candidateCoordinates:{A:[0,0,0],B:[4,0,0]},
    modelingParameters:{halfAB:3},
    confidence:{overall:.98,ocr:.98}
  };
  const pipeline=createTrustedGeometryPipeline({
    modelAdapter:async()=>candidate,
    fallbackSolver:async()=>{fallbackCalls+=1;return candidate;}
  });

  const result=await pipeline.run({questionText:'AB=4。'});

  assert.equal(result.status,'ir_invalid');
  assert.equal(fallbackCalls,0);
  assert.ok(result.gate.issues.some(issue=>issue.code==='DERIVED_FACT_VALUE_MISMATCH'&&issue.path==='d-half'));
});

test('根式与分数 exact AST 可参与派生事实验证，不会被当成缺失数值',()=>{
  const normalized=normalizeGeometryInput({questionText:'AB=√2。'});
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[{id:'f-edge',kind:'quantity',name:'edge',value:{op:'sqrt',value:2},evidenceRefs:['ev']}],derivedFacts:[{id:'d-half',kind:'quantity',name:'halfEdge',value:{op:'mul',values:[{op:'sqrt',value:2},{op:'rational',p:1,q:2}]},dependencies:['f-edge'],expression:'edge/2'}],constraints:[{id:'c-edge',kind:'distance',points:['A','B'],value:Math.sqrt(2),hard:true,factRefs:['f-edge']},{id:'c-half',kind:'positive',value:1,hard:true,factRefs:['d-half']}],queries:[],evidence:[{id:'ev',kind:'text',quote:'AB=√2'}]},candidateCoordinates:{A:[0,0,0],B:[Math.sqrt(2),0,0]}};

  const gate=runGeometryEvidenceGate(normalized,candidate);

  assert.equal(gate.pass,true);
  assert.equal(gate.issues.some(issue=>issue.code.startsWith('DERIVED_FACT_')),false);
});

test('模型网络失败保留可诊断类别且不泄露 API Key', async()=>{
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'secret-key',fetchImpl:async()=>{const error=new Error('connect EACCES');error.code='EACCES';throw error;}});
  await assert.rejects(
    ()=>adapter({normalized:normalizeGeometryInput({questionText:'测试题'}),questionText:'测试题'}),
    error=>error.code==='PROVIDER_NETWORK_ERROR'&&error.provider==='deepseek'&&!String(error.message).includes('secret-key')
  );
});

test('响应正文读取中断保留网络类别，不误报模型 JSON 格式错误',async()=>{
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',maxAttempts:1,fetchImpl:async()=>({ok:true,status:200,json:async()=>{const error=new TypeError('terminated');error.cause={code:'ECONNRESET'};throw error;}})});
  await assert.rejects(()=>adapter({normalized:normalizeGeometryInput({questionText:'测试题'})}),error=>error.code==='PROVIDER_NETWORK_ERROR');
});

test('模型返回 HTTP 200 但内容非法时标记为响应错误',async()=>{
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'secret-key',fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>{throw new SyntaxError('invalid json')}})});
  await assert.rejects(()=>adapter({normalized:normalizeGeometryInput({questionText:'测试题'}),questionText:'测试题'}),error=>error.code==='PROVIDER_RESPONSE_ERROR'&&error.provider==='deepseek');
});

test('单次超时不会吃光共享预算，后续尝试仍能成功',async()=>{
  let calls=0;
  const candidate={schemaVersion:'geometry-compile-response/v1',geometryIR:{schemaVersion:'geometry-ir/v4',entities:[],explicitFacts:[],derivedFacts:[],constraints:[],queries:[],evidence:[]},sourceCoverage:[],candidateCoordinates:{},unresolvedItems:[]};
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',timeoutMs:1200,maxAttempts:2,retryDelayMs:0,fetchImpl:async(_url,options)=>{
    calls+=1;
    if(calls===1)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(candidate)}}]})};
  }});

  const result=await adapter({normalized:normalizeGeometryInput({questionText:'建立模型。'}),questionText:'建立模型。'});

  assert.equal(calls,2);
  assert.equal(result.schemaVersion,'geometry-compile-response/v1');
});

test('完整几何 JSON 的首次请求可使用大部分时限，不再被平均切成过短窗口',async()=>{
  let calls=0;
  const candidate={schemaVersion:'geometry-compile-response/v1',geometryIR:{schemaVersion:'geometry-ir/v4',entities:[],explicitFacts:[],derivedFacts:[],constraints:[],queries:[],evidence:[]},sourceCoverage:[],candidateCoordinates:{},unresolvedItems:[]};
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',timeoutMs:1000,maxAttempts:2,retryDelayMs:0,fetchImpl:async(_url,options)=>{
    calls+=1;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>resolve({ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(candidate)}}]})}),700);
      options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},{once:true});
    });
  }});

  const result=await adapter({normalized:normalizeGeometryInput({questionText:'建立模型。'}),questionText:'建立模型。'});

  assert.equal(calls,1);
  assert.equal(result.schemaVersion,'geometry-compile-response/v1');
});

test('Validator 接受 DeepSeek 常用的线段与平面实体 ID，不强迫模型重复展开点数组',()=>{
  const entities=[
    ...['A','B','C','A1','C1','D','E'].map(id=>({id,kind:'point'})),
    {id:'AB',kind:'segment',points:['A','B']},{id:'AC',kind:'segment',points:['A','C']},{id:'BC',kind:'segment',points:['B','C']},
    {id:'AC1',kind:'segment',points:['A','C1']},{id:'CC1',kind:'segment',points:['C','C1']},{id:'DE',kind:'segment',points:['D','E']},
    {id:'plane-ABC',kind:'plane',points:['A','B','C']},{id:'plane-ACC1A1',kind:'plane',points:['A','C','C1','A1']}
  ];
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities,explicitFacts:[],derivedFacts:[],constraints:[
    {id:'c-angle',kind:'angle',entity:'angle-ACB',points:['A','C','B'],value:90,hard:true},
    {id:'c-equal',kind:'equal_length',segments:['AC','BC'],hard:true},
    {id:'c-mid-D',kind:'midpoint',point:'D',segment:'AB',hard:true},
    {id:'c-mid-E',kind:'midpoint',point:'E',segment:'AC1',hard:true},
    {id:'c-length',kind:'length',entity:'CC1',value:2,hard:true},
    {id:'c-angle-plane',kind:'line_plane_angle',line:'DE',plane:'plane-ACC1A1',value:45,hard:true},
    {id:'c-perp',kind:'perpendicular',entity:'CC1',plane:'plane-ABC',hard:true}
  ],queries:[],evidence:[]},candidateCoordinates:{A:[2,0,0],B:[0,2,0],C:[0,0,0],A1:[2,0,2],C1:[0,0,2],D:[1,1,0],E:[1,0,1]}};

  const report=validateGeometryCandidate(candidate);

  assert.equal(report.pass,true,JSON.stringify(report.failedConstraints));
});

test('Evidence Gate 允许 line/plane 字段引用已声明实体，解释性派生步骤不被误当硬事实',()=>{
  const normalized=normalizeGeometryInput({questionText:'建立模型。'});
  const candidate={provider:'deepseek',sourceCoverage:[{clauseId:'clause-1',status:'context',refs:[]}],geometryIR:{schemaVersion:'geometry-ir/v4',entities:[
    {id:'A',kind:'point'},{id:'B',kind:'point'},{id:'C',kind:'point'},{id:'D',kind:'point'},
    {id:'AB',kind:'segment',points:['A','B']},{id:'plane-BCD',kind:'plane',points:['B','C','D']}
  ],explicitFacts:[],derivedFacts:[{id:'step-explanation',kind:'vector',dependencies:[],expression:'教学解释'}],constraints:[{id:'c',kind:'parallel',line:'AB',plane:'plane-BCD',hard:false}],queries:[],evidence:[]},candidateCoordinates:{A:[0,0,1],B:[1,0,1],C:[0,0,0],D:[0,1,0]}};

  const gate=runGeometryEvidenceGate(normalized,candidate);

  assert.equal(gate.issues.some(item=>item.code==='DANGLING_GEOMETRY_REFERENCE'),false);
  assert.equal(gate.issues.some(item=>item.code==='HARD_FACT_NOT_VALIDATED'),false);
});

test('证明目标使用 seg_ 与 plane_ 实体 ID 时仍与原题关系对应，不误报关系缺失',()=>{
  const normalized=normalizeGeometryInput({questionText:'直三棱柱 ABC-A₁B₁C₁。证 DE∥平面 BCC₁B₁。'});
  const candidate={sourceCoverage:[
    {clauseId:'clause-1',status:'context',refs:[]},
    {clauseId:'clause-2',status:'query',refs:['query-proof']}
  ],geometryIR:{schemaVersion:'geometry-ir/v4',entities:[
    ...['B','C','B1','C1','D','E'].map(id=>({id,kind:'point'})),
    {id:'seg_DE',kind:'segment',points:['D','E']},
    {id:'plane_BCC1B1',kind:'plane',points:['B','C','C1','B1']}
  ],explicitFacts:[],derivedFacts:[],constraints:[],queries:[
    {id:'query-proof',kind:'proof',target:'DE∥平面BCC1B1',line:'seg_DE',plane:'plane_BCC1B1'}
  ],evidence:[]},candidateCoordinates:{B:[0,1,0],C:[0,0,0],B1:[0,1,1],C1:[0,0,1],D:[1,1,0],E:[1,0,1]}};

  const gate=runGeometryEvidenceGate(normalized,candidate);

  assert.equal(gate.issues.some(item=>item.code==='SOURCE_RELATION_MISSING'||item.code==='SOURCE_QUERY_RELATION_MISSING'),false,JSON.stringify(gate.issues));
});

test('角实体与绑定硬约束的中文派生量交给 Validator 回代，不被证据门误拒',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知 ∠ACB=90°，求点 D 到平面 ABC 的距离。'});
  const candidate={sourceCoverage:[
    {clauseId:'clause-1',status:'explicit_fact',refs:['fact-angle']},
    {clauseId:'clause-2',status:'query',refs:['query-distance']}
  ],geometryIR:{schemaVersion:'geometry-ir/v4',entities:[
    ...['A','B','C','D'].map(id=>({id,kind:'point'})),
    {id:'angle_ACB',kind:'angle',points:['A','C','B']},
    {id:'plane_ABC',kind:'plane',points:['A','B','C']}
  ],explicitFacts:[{id:'fact-angle',evidenceRefs:['ev-angle']}],derivedFacts:[
    {id:'derived-distance',kind:'quantity',value:1,dependencies:['fact-angle'],expression:'由坐标回代可得距离为1'}
  ],constraints:[
    {id:'c-angle',kind:'angle',entity:'angle_ACB',points:['A','C','B'],degrees:90,hard:true,factRefs:['fact-angle']},
    {id:'c-distance',kind:'point_plane_distance',point:'D',planePoints:['A','B','C'],value:1,hard:true,factRefs:['derived-distance']}
  ],queries:[{id:'query-distance',kind:'distance',target:'D到平面ABC的距离'}],evidence:[{id:'ev-angle',kind:'text',quote:'∠ACB=90°'}]},candidateCoordinates:{A:[1,0,0],B:[0,1,0],C:[0,0,0],D:[0,0,1]}};

  const gate=runGeometryEvidenceGate(normalized,candidate);
  const validation=validateGeometryCandidate(candidate);

  assert.equal(gate.issues.some(item=>item.code==='CAPABILITY_NOT_REGISTERED'||item.code==='DERIVED_FACT_UNPROVEN'),false,JSON.stringify(gate.issues));
  assert.equal(validation.pass,true,JSON.stringify(validation.failedConstraints));
});

test('模型把证明文字暂存为 fact 时按 query 语义审计，嵌套 target 仍能对应原题关系',()=>{
  const normalized=normalizeGeometryInput({questionText:'直三棱柱 ABC-A₁B₁C₁。证 DE∥平面 BCC₁B₁。'});
  const candidate={provider:'deepseek',sourceCoverage:[
    {clauseId:'clause-1',status:'context',refs:[]},
    {clauseId:'clause-2',status:'query',refs:['ef-proof','df-proof']}
  ],geometryIR:{schemaVersion:'geometry-ir/v4',entities:[
    ...['B','C','B1','C1','D','E'].map(id=>({id,kind:'point'})),
    {id:'seg_DE',kind:'segment',points:['D','E']},{id:'plane_BCC1B1',kind:'plane',points:['B','C','C1','B1']}
  ],explicitFacts:[{id:'ef-proof',statement:'待证明 DE 平行平面',evidenceRefs:['ev-proof']}],derivedFacts:[{id:'df-proof',dependencies:['ef-proof'],expression:'由中位线关系可证'}],constraints:[
    {id:'c-proof',kind:'parallel',operands:['seg_DE','plane_BCC1B1'],hard:true,factRefs:['ef-proof','df-proof']}
  ],queries:[{id:'q-proof',kind:'proof',target:{relation:'parallel',operands:['seg_DE','plane_BCC1B1']},facts:['ef-proof','df-proof']}],evidence:[{id:'ev-proof',kind:'text',quote:'证 DE∥平面 BCC1B1'}]},candidateCoordinates:{B:[0,1,0],C:[0,0,0],B1:[0,1,1],C1:[0,0,1],D:[1,1,0],E:[1,0,1]}};

  const gate=runGeometryEvidenceGate(normalized,candidate);
  const validation=validateGeometryCandidate(candidate);

  assert.equal(gate.pass,true,JSON.stringify(gate.issues));
  assert.equal(validation.pass,true,JSON.stringify(validation.failedConstraints));
});

test('不可重试的 HTTP 400 不进入后台网络重试队列',async()=>{
  let calls=0;
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',maxAttempts:3,retryDelayMs:0,fetchImpl:async()=>{calls+=1;return{ok:false,status:400,headers:{get:()=>null}};}});
  const pipeline=createTrustedGeometryPipeline({modelAdapter:adapter});

  const result=await pipeline.run({questionText:'建立模型。'});

  assert.equal(calls,1);
  assert.equal(result.status,'ir_invalid');
  assert.equal(result.retryable,false);
});

test('模型响应合同错误与网络不可用使用不同最终状态',async()=>{
  const invalidPipeline=createTrustedGeometryPipeline({modelAdapter:async()=>{throw Object.assign(new Error('invalid'),{code:'PROVIDER_RESPONSE_ERROR'});}});
  const offlinePipeline=createTrustedGeometryPipeline({modelAdapter:async()=>{throw Object.assign(new Error('offline'),{code:'PROVIDER_NETWORK_ERROR'});}});

  const invalid=await invalidPipeline.run({questionText:'建立模型。'}),offline=await offlinePipeline.run({questionText:'建立模型。'});

  assert.equal(invalid.status,'ir_invalid');
  assert.equal(offline.status,'provider_unavailable');
});

test('DeepSeek 网络瞬断与非法 JSON 会在限定次数内自动重试并保留错误分类',async()=>{
  let calls=0;
  const candidate={schemaVersion:'geometry-compile-response/v1',geometryIR:{schemaVersion:'geometry-ir/v4',entities:[],explicitFacts:[],derivedFacts:[],constraints:[],queries:[],evidence:[]},solutionOutline:[],finalAnswer:null,modelingParameters:{},coordinateSystem:{dimension:3},candidateCoordinates:{},suggestedConstructions:[],visualFocus:[],highlightEntities:[],annotations:[],constructionDisplayPlan:[],subproblemVisualization:[],visibilitySequence:[],unresolvedItems:[],confidence:{overall:.9,ocr:.9},sourceCoverage:[]};
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'secret-key',maxAttempts:3,retryDelayMs:0,fetchImpl:async()=>{
    calls+=1;
    if(calls===1){const error=new Error('temporary reset');error.code='ECONNRESET';throw error;}
    if(calls===2)return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:'not-json'}}]})};
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(candidate)}}]})};
  }});

  const result=await adapter({normalized:normalizeGeometryInput({questionText:'建立空间模型'}),questionText:'建立空间模型'});

  assert.equal(calls,3);
  assert.equal(result.provider,'deepseek');
});

test('DeepSeek 漏掉全文覆盖字段时自动重试而不是把残缺 IR 交给渲染器',async()=>{
  let calls=0;
  const base={schemaVersion:'geometry-compile-response/v1',geometryIR:{schemaVersion:'geometry-ir/v4',entities:[],explicitFacts:[],derivedFacts:[],constraints:[],queries:[],evidence:[]},solutionOutline:[],finalAnswer:null,modelingParameters:{},coordinateSystem:{dimension:3},candidateCoordinates:{},suggestedConstructions:[],visualFocus:[],highlightEntities:[],annotations:[],constructionDisplayPlan:[],subproblemVisualization:[],visibilitySequence:[],unresolvedItems:[],confidence:{overall:.9,ocr:.9}};
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'secret-key',maxAttempts:2,retryDelayMs:0,fetchImpl:async()=>{
    calls+=1;const result=calls===1?base:{...base,sourceCoverage:[{clauseId:'clause-1',status:'context',refs:[]}]};
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(result)}}]})};
  }});

  const result=await adapter({normalized:normalizeGeometryInput({questionText:'建立空间模型。'}),questionText:'建立空间模型。'});

  assert.equal(calls,2);
  assert.equal(result.sourceCoverage[0].clauseId,'clause-1');
});

test('DeepSeek 首次编译只需返回数学契约，不因缺少教学展示字段而失败',async()=>{
  let calls=0;
  const minimal={
    schemaVersion:'geometry-compile-response/v1',
    geometryIR:{schemaVersion:'geometry-ir/v4',entities:[],explicitFacts:[],derivedFacts:[],constraints:[],queries:[],evidence:[]},
    sourceCoverage:[{clauseId:'clause-1',status:'context',refs:[]}],
    candidateCoordinates:{},
    unresolvedItems:[]
  };
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',maxAttempts:1,fetchImpl:async()=>{
    calls+=1;
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(minimal)}}]})};
  }});

  const result=await adapter({normalized:normalizeGeometryInput({questionText:'建立空间模型。'}),questionText:'建立空间模型。'});

  assert.equal(calls,1);
  assert.deepEqual(result.suggestedConstructions,[]);
  assert.deepEqual(result.annotations,[]);
  assert.equal(result.coordinateSystem.dimension,3);
});

test('风险复核必须返回可审计报告，缺失时在共享预算内自动重试',async()=>{
  let calls=0;
  const base={schemaVersion:'geometry-repair-response/v1',patch:[]};
  const adapter=createDeepSeekGeometryReviewAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',maxAttempts:2,retryDelayMs:0,fetchImpl:async()=>{
    calls+=1;
    const result=calls===1?base:{...base,semanticReviewReport:{status:'corrected',reviewedIssueCodes:['INVALID_SCHEMA_VERSION'],reviewedRiskCodes:[],retainedFactIds:[],correctedFields:['candidateCoordinates'],evidenceDecision:'逐项复核原文后修正候选坐标'}};
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(result)}}]})};
  }});
  const normalized=normalizeGeometryInput({questionText:'建立空间模型。'});

  const result=await adapter({input:{questionText:'建立空间模型。'},normalized,candidate:{},gate:{issues:[{code:'INVALID_SCHEMA_VERSION'}],risks:[]},validation:{failedConstraints:[],checks:[]}});

  assert.equal(calls,2);
  assert.equal(result.semanticReviewReport.status,'corrected');
});

test('风险复核的内部追踪元数据不能污染严格 JSON Patch 合同',async()=>{
  const report={status:'corrected',reviewedIssueCodes:['COORDINATE_INVALID'],reviewedRiskCodes:[],retainedFactIds:['f1'],correctedFields:['candidateCoordinates.B'],evidenceDecision:'保留题意，只修正候选坐标'};
  const adapter=createDeepSeekGeometryReviewAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',maxAttempts:1,fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify({schemaVersion:'geometry-repair-response/v1',semanticReviewReport:report,patch:[]})}}]})})});
  const normalized=normalizeGeometryInput({questionText:'AB=2。'});

  const result=await adapter({input:{questionText:'AB=2。'},normalized,candidate:{},gate:{issues:[],risks:[]},validation:{failedConstraints:[],checks:[]}});

  assert.deepEqual(Object.keys(result).sort(),['patch','schemaVersion','semanticReviewReport']);
});

test('DeepSeek 给出 3D 坐标时必须同时给出每个小问的教学视图计划，否则自动重试',async()=>{
  let calls=0;
  const base={schemaVersion:'geometry-compile-response/v1',geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[],derivedFacts:[],constraints:[],queries:[{id:'q1',kind:'distance',target:'AB'}],evidence:[]},sourceCoverage:[{clauseId:'clause-1',status:'context',refs:[]}],solutionOutline:['由两点坐标计算 AB。'],finalAnswer:{displayPlain:'AB=2',latex:'AB=2'},candidateCoordinates:{A:[0,0,0],B:[2,0,0]},unresolvedItems:[]};
  const complete={...base,coordinateSystem:{dimension:3,handedness:'right',zUp:true,canonical:true},visualFocus:['AB'],highlightEntities:['A','B'],annotations:[],constructionDisplayPlan:[],subproblemVisualization:[{id:'q1-view',queryId:'q1',label:'求 AB',highlightEntities:['A','B'],annotationIds:[]}],visibilitySequence:[{id:'base',layers:['base'],visible:true},{id:'focus-q1',layers:['focus'],visible:true}]};
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'test-only',maxAttempts:2,retryDelayMs:0,fetchImpl:async()=>{
    calls+=1;const response=calls===1?base:complete;
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(response)}}]})};
  }});

  const result=await adapter({normalized:normalizeGeometryInput({questionText:'求 AB 的长度。'}),questionText:'求 AB 的长度。'});

  assert.equal(calls,2);
  assert.equal(result.subproblemVisualization[0].queryId,'q1');
});

test('风险复核只能用受限 JSON Patch 修坐标，不能改写题意或证据',()=>{
  const report={status:'corrected',reviewedIssueCodes:['COORDINATE_INVALID'],reviewedRiskCodes:[],retainedFactIds:['f1'],correctedFields:['candidateCoordinates.B'],evidenceDecision:'原题事实保持不变，只修正候选坐标'};
  const candidate={geometryIR:{explicitFacts:[{id:'f1',value:2}]},candidateCoordinates:{A:[0,0,0],B:[1,0,0]}};
  const repaired=applyGeometryRepairPatch(candidate,{schemaVersion:'geometry-repair-response/v1',semanticReviewReport:report,patch:[{op:'replace',path:'/candidateCoordinates/B',value:[2,0,0]}]});
  assert.deepEqual(repaired.candidateCoordinates.B,[2,0,0]);
  assert.equal(repaired.geometryIR.explicitFacts[0].value,2);
  const forbidden={schemaVersion:'geometry-repair-response/v1',semanticReviewReport:report,patch:[{op:'replace',path:'/geometryIR/explicitFacts/0/value',value:9}]};
  assert.equal(validateGeometryRepairResponse(forbidden).pass,false);
  assert.throws(()=>applyGeometryRepairPatch(candidate,forbidden),/GEOMETRY_REPAIR_RESPONSE_INVALID/);
});

test('语义遗漏使用完整重编译修正 IR，不能误走坐标 Patch',async()=>{
  let semanticCalls=0,coordinateCalls=0;
  const initial={
    geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'},{id:'C',kind:'point'},{id:'D',kind:'point'}],explicitFacts:[{id:'f-ab',kind:'quantity',name:'AB',value:2,evidenceRefs:['ev-ab']}],derivedFacts:[],constraints:[{id:'c-ab',kind:'distance',points:['A','B'],value:2,hard:true,factRefs:['f-ab']}],queries:[],evidence:[{id:'ev-ab',kind:'text',quote:'AB=2'}]},
    candidateCoordinates:{A:[0,0,0],B:[2,0,0],C:[0,0,0],D:[0,1,0]},confidence:{overall:.95,ocr:.95}
  };
  const corrected={...structuredClone(initial),
    geometryIR:{...structuredClone(initial.geometryIR),explicitFacts:[...initial.geometryIR.explicitFacts,{id:'f-perp',kind:'relation',name:'AB perpendicular CD',evidenceRefs:['ev-perp']}],constraints:[...initial.geometryIR.constraints,{id:'c-perp',kind:'perpendicular',vectors:[['A','B'],['C','D']],hard:true,factRefs:['f-perp']}],evidence:[...initial.geometryIR.evidence,{id:'ev-perp',kind:'text',quote:'AB⊥CD'}]},
  };
  const pipeline=createTrustedGeometryPipeline({
    modelAdapter:async()=>initial,
    semanticReviewAdapter:async context=>{semanticCalls+=1;return {...corrected,semanticReviewReport:{status:'corrected',reviewedIssueCodes:context.gate.issues.map(item=>item.code),reviewedRiskCodes:context.gate.risks.map(item=>item.code),retainedFactIds:['f-ab','f-perp'],correctedFields:['geometryIR.explicitFacts','geometryIR.constraints','geometryIR.evidence'],evidenceDecision:'依据原题 AB⊥CD 补回垂直事实与硬约束'}};},
    reviewAdapter:async()=>{coordinateCalls+=1;throw new Error('坐标本身正确，不应触发坐标修复');}
  });

  const result=await pipeline.compileGeometryProblem({questionText:'已知 AB=2，AB⊥CD，建立空间模型。'});

  assert.equal(result.status,'verified_unique',JSON.stringify(result.gate));
  assert.equal(result.executionPath,'deepseek_recompiled');
  assert.equal(semanticCalls,1);
  assert.equal(coordinateCalls,0);
  assert.ok(result.geometryIR.constraints.some(item=>item.id==='c-perp'));
});

test('图片题缺少整图审计清单时自动重试，不能把单一区域识别当完整题目',async()=>{
  let calls=0;
  const base={schemaVersion:'geometry-compile-response/v1',geometryIR:{schemaVersion:'geometry-ir/v4',entities:[],explicitFacts:[],derivedFacts:[],constraints:[],queries:[],evidence:[]},sourceCoverage:[{clauseId:'clause-1',status:'context',refs:[]}],solutionOutline:[],finalAnswer:null,modelingParameters:{},coordinateSystem:{dimension:3},candidateCoordinates:{},suggestedConstructions:[],visualFocus:[],highlightEntities:[],annotations:[],constructionDisplayPlan:[],subproblemVisualization:[],visibilitySequence:[],unresolvedItems:[],confidence:{overall:.9,ocr:.9}};
  const adapter=createDeepSeekGeometryCompilerAdapter({endpoint:'https://api.deepseek.example/chat',apiKey:'secret-key',maxAttempts:2,retryDelayMs:0,fetchImpl:async()=>{
    calls+=1;
    const result=calls===1?base:{...base,imageAudit:{imageHash:'placeholder',pageCompleteness:'complete',coverageRegions:[],unreadableRegions:[],diagramMarks:[]}};
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{message:{content:JSON.stringify(result)}}]})};
  }});
  const result=await adapter({normalized:normalizeGeometryInput({questionText:'读取整题',imageData:'data:image/png;base64,dGVzdA=='}),questionText:'读取整题',imageData:'data:image/png;base64,dGVzdA=='});
  assert.equal(calls,2);
  assert.ok(result.imageAudit);
});

test('Normalize 保留精确数学表达并统一 OCR 点名与选择题查询', () => {
  const normalized = normalizeGeometryInput({
    questionText: '正方体 A 1B 1C 1D1 中，棱长为 $\\sqrt{3}/2$。\nA. A 1B ∥ CD\nB. A_1D_1 ⟂ 平面 ABCD（多选）'
  });

  assert.equal(normalized.originalInput.includes('$\\sqrt{3}/2$'), true);
  assert.equal(normalized.normalizedInput.includes('A1B1C1D1'), true);
  assert.equal(normalized.normalizedInput.includes('sqrt(3)/2'), true);
  assert.equal(normalized.questionType, 'multiple_choice');
  assert.deepEqual(normalized.optionQueries.map(item => item.optionId), ['A', 'B']);
  assert.ok(normalized.positionMap.length > 0);
});

test('全文关系清单会发现被模型漏掉的第二个垂直目标',()=>{
  const normalized=normalizeGeometryInput({questionText:'正四面体 OABC 中，E，F 分别是 AB，OC 的中点，求证 EF 垂直 AB，且 EF⊥OC。'});
  assert.deepEqual(normalized.relationMentions.filter(item=>item.kind==='perpendicular').map(item=>item.operands),[['EF','AB'],['EF','OC']]);
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:[...['O','A','B','C','E','F'].map(id=>({id,kind:'point'}))],explicitFacts:[],derivedFacts:[],constraints:[],queries:[{id:'q-first',kind:'vector_relation',first:['E','F'],second:['A','B'],expectation:{perpendicular:true}}],evidence:[]},candidateCoordinates:{O:[0,0,0],A:[1,0,0],B:[0,1,0],C:[0,0,1],E:[.5,.5,0],F:[0,0,.5]},confidence:{overall:.95,ocr:.95}};

  const gate=runGeometryEvidenceGate(normalized,candidate);

  assert.equal(gate.pass,false);
  assert.ok(gate.issues.some(item=>item.code==='SOURCE_RELATION_MISSING'&&item.relation==='perpendicular'&&item.operands.join('|')==='EF|OC'));
});

test('DeepSeek 候选坐标通过证据门和全部约束后直接生成 verified SceneSpec', async () => {
  let fallbackCalls = 0;
  let modelCalls = 0;
  let reviewCalls = 0;
  const pipeline = createTrustedGeometryPipeline({
    modelAdapter: async () => {
      modelCalls += 1;
      return ({
      geometryIR: {
        schemaVersion: 'geometry-ir/v4',
        entities: [
          {id: 'sphere1', kind: 'sphere', center: 'O'},
          {id: 'section1', kind: 'circle', center: 'H'},
          ...['O', 'H', 'A', 'R'].map(id => ({id, kind: 'point'}))
        ],
        explicitFacts: [
          {id: 'f-diameter', kind: 'quantity', name: 'sectionDiameter', value: 6, evidenceRefs: ['ev-diameter']},
          {id: 'f-distance', kind: 'quantity', name: 'planeDistance', value: 4, evidenceRefs: ['ev-distance']}
        ],
        derivedFacts: [
          {id: 'd-section-radius', kind: 'quantity', name: 'sectionRadius', value: 3, dependencies: ['f-diameter'], expression: 'sectionDiameter/2'},
          {id: 'd-sphere-radius', kind: 'quantity', name: 'sphereRadius', value: 5, dependencies: ['d-section-radius', 'f-distance'], expression: 'sqrt(sectionRadius^2+planeDistance^2)'}
        ],
        constraints: [
          {id: 'c-oh', kind: 'distance', points: ['O', 'H'], value: 4, hard: true, factRefs: ['f-distance']},
          {id: 'c-sphere', kind: 'sphere', entity: 'sphere1', center: 'O', radius: 5, hard: true, factRefs: ['d-sphere-radius']},
          {id: 'c-section', kind: 'section_circle', sphere: 'sphere1', center: 'H', radius: 3, centerDistance: 4, hard: true, factRefs: ['f-diameter', 'd-section-radius', 'f-distance']}
        ],
        queries: [{id: 'q1', kind: 'compute', target: 'sphereVolume'}],
        evidence: [
          {id: 'ev-diameter', kind: 'text', quote: '直径是6'},
          {id: 'ev-distance', kind: 'text', quote: '距离是4'}
        ]
      },
      modelingParameters: {bodyType: 'sphere', radius: 5, sectionRadius: 3, planeDistance: 4},
      coordinateSystem: {dimension: 3, handedness: 'right', zUp: true, canonical: true},
      candidateCoordinates: {O: [0, 0, 0], H: [0, 0, 4], A: [3, 0, 4], R: [5, 0, 0]},
      suggestedConstructions: [{id: 'aux-oh', kind: 'segment', points: ['O', 'H'], dependsOn: ['c-oh']}],
      confidence: {overall: 0.96, ocr: 0.96}
    });
    },
    reviewAdapter: async () => {
      reviewCalls += 1;
      throw new Error('review should not be called for a low-risk verified candidate');
    },
    fallbackSolver: async () => {
      fallbackCalls += 1;
      throw new Error('fallback should not be called');
    }
  });

  const result = await pipeline.run({questionText: '平面截一球得到直径是6的圆面，球心到这个平面的距离是4，求球体积。'});

  assert.equal(result.status, 'verified_unique');
  assert.equal(result.executionPath, 'deepseek_direct');
  assert.equal(fallbackCalls, 0);
  assert.equal(result.validation.pass, true);
  assert.ok(result.validation.checks.every(check => check.pass));
  assert.equal(result.sceneSpec.grid.unit, 1);
  assert.ok(result.sceneSpec.elements.some(item => item.type === 'sphere'));
  assert.ok(result.sceneSpec.elements.some(item => item.type === 'section-circle'));
  const cached = await pipeline.run({questionText: '平面截一球得到直径是6的圆面，球心到这个平面的距离是4，求球体积。'});
  assert.equal(cached.cacheHit, true);
  assert.equal(modelCalls, 1);
  assert.equal(reviewCalls, 0);
});

test('候选模型未通过硬约束时仍保留可交互 AI 参考 SceneSpec，但绝不伪装成 verified', async () => {
  const candidate = {
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [{id:'A',kind:'point'}, {id:'B',kind:'point'}, {id:'AB',kind:'segment',points:['A','B']}],
      explicitFacts: [{id:'f-ab',kind:'quantity',name:'AB',value:4,evidenceRefs:['ev-ab']}],
      derivedFacts: [],
      constraints: [{id:'c-ab',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f-ab']}],
      queries: [{id:'q-ab',kind:'compute',target:'AB'}],
      evidence: [{id:'ev-ab',kind:'text',quote:'AB=4'}]
    },
    candidateCoordinates: {A:[0,0,0],B:[3,0,0]},
    confidence:{overall:.95,ocr:.95}
  };
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate});
  const result=await pipeline.run({questionText:'AB=4。'});

  assert.equal(result.status,'ai_reference');
  assert.equal(result.result.solverStatus,'reference');
  assert.equal(result.validation.pass,false);
  assert.equal(result.sceneSpec.representation.kind,'ai_reference');
  assert.ok(result.sceneSpec.elements.some(item=>item.type==='segment'));
});

test('坐标复核返回非法 Patch 时保留首轮参考模型，不清空已有 IR 与场景',async()=>{
  const candidate={
    geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'},{id:'AB',kind:'segment',points:['A','B']}],explicitFacts:[{id:'f-ab',kind:'quantity',name:'AB',value:4,evidenceRefs:['ev-ab']}],derivedFacts:[],constraints:[{id:'c-ab',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f-ab']}],queries:[{id:'q-ab',kind:'compute',target:'AB'}],evidence:[{id:'ev-ab',kind:'text',quote:'AB=4'}]},
    candidateCoordinates:{A:[0,0,0],B:[3,0,0]},confidence:{overall:.95,ocr:.95}
  };
  const invalidRepair={schemaVersion:'geometry-repair-response/v1',provider:'internal-metadata-must-not-enter-contract',patch:[]};
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate,reviewAdapter:async()=>invalidRepair});

  const result=await pipeline.run({questionText:'AB=4。'});

  assert.equal(result.status,'ai_reference');
  assert.deepEqual(result.geometryIR.entities.map(item=>item.id),['A','B','AB']);
  assert.ok(result.sceneSpec.elements.some(item=>item.type==='segment'));
  assert.ok(result.attempts.some(item=>item.stage==='coordinate_review'&&item.category==='PROVIDER_RESPONSE_ERROR'));
});

test('语义重编译失败时保留首轮 IR、坐标与安全参考场景',async()=>{
  const candidate={
    geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'},{id:'AB',kind:'segment',points:['A','B']}],explicitFacts:[{id:'f-ab',kind:'quantity',name:'AB',value:4,evidenceRefs:['ev-ab']}],derivedFacts:[],constraints:[{id:'c-ab',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f-ab']}],queries:[{id:'q-ab',kind:'compute',target:'AB'}],evidence:[{id:'ev-ab',kind:'text',quote:'AB=4'}]},
    sourceCoverage:[{clauseId:'clause-1',status:'context',refs:[]}],candidateCoordinates:{A:[0,0,0],B:[4,0,0]},unresolvedItems:['证据覆盖待复核'],confidence:{overall:.95,ocr:.95}
  };
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate,semanticReviewAdapter:async()=>{throw Object.assign(new Error('bad semantic response'),{code:'PROVIDER_RESPONSE_ERROR'});}});

  const result=await pipeline.run({questionText:'AB=4。'});

  assert.equal(result.status,'ai_reference');
  assert.equal(result.sourceFailureStatus,'underdetermined_for_query');
  assert.deepEqual(result.candidateCoordinates.B,[4,0,0]);
  assert.ok(result.sceneSpec.elements.some(item=>item.type==='segment'));
});

test('verified 缓存按学校与学生隔离，不能跨账号复用私人原题结果',async()=>{
  let calls=0;
  const makeCandidate=()=>({
    geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[{id:'f',kind:'quantity',name:'AB',value:4,evidenceRefs:['e']}],derivedFacts:[],constraints:[{id:'c',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f']}],queries:[],evidence:[{id:'e',kind:'text',quote:'AB=4'}]},
    candidateCoordinates:{A:[0,0,0],B:[4,0,0]},confidence:{overall:.98,ocr:.98}
  });
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>{calls+=1;return makeCandidate();}});

  await pipeline.run({schoolId:'school-1',studentId:'student-a',questionText:'AB=4。'});
  await pipeline.run({schoolId:'school-1',studentId:'student-a',questionText:'AB=4。'});
  await pipeline.run({schoolId:'school-1',studentId:'student-b',questionText:'AB=4。'});

  assert.equal(calls,2);
});

test('同一学生的并发相同题目共享一次编译，不重复消耗模型调用',async()=>{
  let calls=0;
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[{id:'f',kind:'quantity',name:'AB',value:4,evidenceRefs:['e']}],derivedFacts:[],constraints:[{id:'c',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f']}],queries:[],evidence:[{id:'e',kind:'text',quote:'AB=4'}]},candidateCoordinates:{A:[0,0,0],B:[4,0,0]},confidence:{overall:.98,ocr:.98}};
  const pipeline=createTrustedGeometryPipeline({modelVersion:'test-model',modelAdapter:async()=>{calls+=1;await new Promise(resolve=>setTimeout(resolve,20));return candidate;}});

  const [first,second]=await Promise.all([pipeline.run({studentId:'s1',questionText:'AB=4。'}),pipeline.run({studentId:'s1',questionText:'AB=4。'})]);

  assert.equal(calls,1);
  assert.equal(first.status,'verified_unique');
  assert.equal(second.status,'verified_unique');
});

test('代表模型缺少自由度证明时安全降级，不把任意坐标包装成 verified',async()=>{
  const candidate={
    geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[],derivedFacts:[],constraints:[{id:'c-positive',kind:'positive',value:1,hard:true,factRefs:[]}],queries:[],evidence:[]},
    modelingParameters:{identifiability:'representative'},candidateCoordinates:{A:[0,0,0],B:[7,0,0]},confidence:{overall:.98,ocr:.98}
  };
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate});

  const result=await pipeline.run({questionText:'建立一个满足条件的代表模型。'});

  assert.equal(result.status,'underdetermined_for_query');
  assert.equal(result.geometryStatus,'failed');
  assert.equal(result.sceneSpec,undefined);
});

test('纯关系证明题可用已验证拓扑生成不改变关系的规范代表模型',async()=>{
  const faces=[['A','B','C'],['A','B','D'],['A','C','D'],['B','C','D']];
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:[...['A','B','C','D'].map(id=>({id,kind:'point'})),{id:'solid',kind:'tetrahedron',vertices:['A','B','C','D'],faces}],explicitFacts:[],derivedFacts:[],constraints:[{id:'c-topology',kind:'polyhedron',entity:'solid',hard:true}],queries:[{id:'q',kind:'construct',target:'solid'}],evidence:[]},modelingParameters:{identifiability:'representative'},coordinateSystem:{dimension:3,canonical:true},candidateCoordinates:{A:[0,0,0],B:[1,0,0],C:[0,1,0],D:[0,0,1]},confidence:{overall:.98,ocr:.98}};
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate});

  const result=await pipeline.run({questionText:'建立一个满足这些空间关系的四面体代表模型。'});

  assert.equal(result.status,'verified_representative');
  assert.ok(result.sceneSpec.elements.some(item=>item.type==='polyhedron-face'));
});

test('无几何符号的图片经独立复核确认后可以通过，不会永久卡在空标记风险',async()=>{
  let reviews=0;
  const makeCandidate=(normalized,marksPresence)=>({
    geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[{id:'f',kind:'quantity',name:'AB',value:4,evidenceRefs:['ev']}],derivedFacts:[],constraints:[{id:'c',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f']}],queries:[],evidence:[{id:'ev',kind:'image',imageHash:normalized.imageHash,region:[.1,.1,.7,.5],quote:'题干给出AB=4，图中无关系符号',confidence:.98}]},
    candidateCoordinates:{A:[0,0,0],B:[4,0,0]},confidence:{overall:.98,ocr:.98},suggestedConstructions:[],
    imageAudit:{imageHash:normalized.imageHash,pageCompleteness:'complete',coverageRegions:[{id:'text',kind:'text',region:[.1,.1,.7,.5],evidenceRefs:['ev']},{id:'diagram',kind:'diagram',region:[.1,.1,.7,.5],evidenceRefs:['ev']}],unreadableRegions:[],diagramMarks:[],marksPresence},
    ...(marksPresence==='none_confirmed'?{semanticReviewReport:{status:'approved',reviewedIssueCodes:[],reviewedRiskCodes:['IMAGE_DIAGRAM_MARKS_EMPTY'],retainedFactIds:['f'],correctedFields:['imageAudit.marksPresence'],evidenceDecision:'独立复核确认原图没有关系符号'}}:{})
  });
  const pipeline=createTrustedGeometryPipeline({
    modelAdapter:async({normalized})=>makeCandidate(normalized,'uncertain'),
    semanticReviewAdapter:async({normalized})=>{reviews++;return makeCandidate(normalized,'none_confirmed');}
  });
  const result=await pipeline.run({questionText:'建立模型',imageData:'data:image/png;base64,bm8tbWFya3M='});
  assert.equal(reviews,1);
  assert.equal(result.status,'verified_unique');
});

test('首次模型不能靠自带 semanticReviewReport 冒充独立图片复核',()=>{
  const normalized=normalizeGeometryInput({questionText:'建立模型',imageData:'data:image/png;base64,c2VsZi1yZXZpZXc='});
  const candidate={provider:'deepseek',schemaVersion:'geometry-compile-response/v1',geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'}],explicitFacts:[{id:'f',kind:'quantity',name:'AB',value:4,evidenceRefs:['ev']}],derivedFacts:[],constraints:[{id:'c',kind:'distance',points:['A','B'],value:4,hard:true,factRefs:['f']}],queries:[],evidence:[{id:'ev',kind:'image',imageHash:normalized.imageHash,region:[.1,.1,.7,.5],quote:'AB=4',confidence:.98}]},sourceCoverage:[{clauseId:'clause-1',status:'context',refs:[]}],candidateCoordinates:{A:[0,0,0],B:[4,0,0]},unresolvedItems:[],confidence:{overall:.98,ocr:.98},imageAudit:{imageHash:normalized.imageHash,pageCompleteness:'complete',coverageRegions:[{id:'text',kind:'text',region:[.1,.1,.7,.5],evidenceRefs:['ev']},{id:'diagram',kind:'diagram',region:[.1,.1,.7,.5],evidenceRefs:['ev']}],unreadableRegions:[],diagramMarks:[],marksPresence:'none_confirmed'},semanticReviewReport:{status:'approved',reviewedIssueCodes:[],reviewedRiskCodes:['IMAGE_DIAGRAM_MARKS_EMPTY'],retainedFactIds:['f'],correctedFields:[],evidenceDecision:'自称已审查'}};

  const gate=runGeometryEvidenceGate(normalized,candidate);

  assert.ok(gate.risks.some(risk=>risk.code==='IMAGE_DIAGRAM_MARKS_EMPTY'));
});

test('候选坐标不满足硬约束时才触发第二次 DeepSeek，并只用修正后的坐标', async () => {
  let reviewCalls = 0;
  let fallbackCalls = 0;
  const baseCandidate = {
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [{id: 'A', kind: 'point'}, {id: 'B', kind: 'point'}, {id: 'AB', kind: 'segment', points: ['A', 'B']}],
      explicitFacts: [{id: 'f-ab', kind: 'quantity', name: 'AB', value: 3, evidenceRefs: ['ev-ab']}],
      derivedFacts: [],
      constraints: [{id: 'c-ab', kind: 'distance', points: ['A', 'B'], value: 3, hard: true, factRefs: ['f-ab']}],
      queries: [{id: 'q1', kind: 'prove', target: 'AB'}],
      evidence: [{id: 'ev-ab', kind: 'text', quote: 'AB=3'}]
    },
    modelingParameters: {identifiability: 'representative'},
    coordinateSystem: {dimension: 3, handedness: 'right', canonical: true},
    candidateCoordinates: {A: [0, 0, 0], B: [5, 0, 0]},
    suggestedConstructions: [],
    confidence: {overall: 0.95, ocr: 0.95}
  };
  const pipeline = createTrustedGeometryPipeline({
    modelAdapter: async () => baseCandidate,
    reviewAdapter: async context => {
      reviewCalls += 1;
      assert.deepEqual(context.validation.failedConstraints, ['c-ab']);
      return {...structuredClone(baseCandidate), candidateCoordinates: {A: [0, 0, 0], B: [3, 0, 0]}};
    },
    fallbackSolver: async () => {
      fallbackCalls += 1;
      return null;
    }
  });

  const result = await pipeline.run({questionText: '已知 AB=3，建立一个空间坐标模型。'});

  assert.equal(result.status, 'verified_representative');
  assert.equal(result.executionPath, 'deepseek_repaired');
  assert.equal(reviewCalls, 1);
  assert.equal(fallbackCalls, 0);
  assert.deepEqual(result.finalCoordinates.B, [3, 0, 0]);
});

test('复核后仍失败时才进入兜底 Solver，并再次经过同一个 Validator', async () => {
  let solverCalls = 0;
  const candidate = {
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [{id: 'A', kind: 'point'}, {id: 'B', kind: 'point'}],
      explicitFacts: [{id: 'f-ab', kind: 'quantity', name: 'AB', value: 4, evidenceRefs: ['ev-ab']}],
      derivedFacts: [],
      constraints: [{id: 'c-ab', kind: 'distance', points: ['A', 'B'], value: 4, hard: true, factRefs: ['f-ab']}],
      queries: [{id: 'q1', kind: 'compute', target: 'AB'}],
      evidence: [{id: 'ev-ab', kind: 'text', quote: 'AB=4'}]
    },
    modelingParameters: {},
    coordinateSystem: {dimension: 3, handedness: 'right', canonical: true},
    candidateCoordinates: {A: [0, 0, 0], B: [9, 0, 0]},
    suggestedConstructions: [],
    confidence: {overall: 0.9, ocr: 0.9}
  };
  const pipeline = createTrustedGeometryPipeline({
    modelAdapter: async () => candidate,
    reviewAdapter: async () => candidate,
    fallbackSolver: async context => {
      solverCalls += 1;
      assert.equal(context.validation.pass, false);
      return {...structuredClone(candidate), candidateCoordinates: {A: [0, 0, 0], B: [4, 0, 0]}};
    }
  });

  const result = await pipeline.run({questionText: '已知 AB=4，建立空间模型。'});

  assert.equal(result.status, 'verified_unique');
  assert.equal(result.executionPath, 'fallback_solver');
  assert.equal(solverCalls, 1);
  assert.equal(result.validation.pass, true);
});

test('一般棱锥条件不足以固定形状时返回欠定，不把任意代表坐标当正式模型', async () => {
  const question = '三棱锥 A-BCD 中，AB⊥BC，AB=3，BC=4，M 为 CD 中点，求建立空间模型。';
  const evidence = [
    ['ev-perp', 'AB⊥BC'], ['ev-ab', 'AB=3'], ['ev-bc', 'BC=4'], ['ev-mid', 'M 为 CD 中点']
  ].map(([id, quote]) => ({id, kind: 'text', quote}));
  const candidate = {
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [
        ...['A', 'B', 'C', 'D', 'M'].map(id => ({id, kind: 'point'})),
        ...[['AB', 'A', 'B'], ['BC', 'B', 'C'], ['CD', 'C', 'D'], ['AM', 'A', 'M']].map(([id, a, b]) => ({id, kind: 'segment', points: [a, b]})),
        {id: 'solid1', kind: 'pyramid', baseVertices: ['B', 'C', 'D'], apex: 'A'}
      ],
      explicitFacts: [
        {id: 'f-perp', kind: 'relation', evidenceRefs: ['ev-perp']},
        {id: 'f-ab', kind: 'quantity', value: 3, evidenceRefs: ['ev-ab']},
        {id: 'f-bc', kind: 'quantity', value: 4, evidenceRefs: ['ev-bc']},
        {id: 'f-mid', kind: 'relation', evidenceRefs: ['ev-mid']}
      ],
      derivedFacts: [],
      constraints: [
        {id: 'c-perp', kind: 'perpendicular', vectors: [['A', 'B'], ['B', 'C']], hard: true, factRefs: ['f-perp']},
        {id: 'c-ab', kind: 'distance', points: ['A', 'B'], value: 3, hard: true, factRefs: ['f-ab']},
        {id: 'c-bc', kind: 'distance', points: ['B', 'C'], value: 4, hard: true, factRefs: ['f-bc']},
        {id: 'c-mid', kind: 'midpoint', point: 'M', endpoints: ['C', 'D'], hard: true, factRefs: ['f-mid']},
        {id: 'c-plane', kind: 'point_on_plane', point: 'M', planePoints: ['B', 'C', 'D'], hard: true}
      ],
      queries: [{id: 'q1', kind: 'construct', target: 'solid1'}],
      evidence
    },
    modelingParameters: {identifiability: 'representative'},
    coordinateSystem: {dimension: 3, handedness: 'right', canonical: true},
    candidateCoordinates: {A: [0, 0, 3], B: [0, 0, 0], C: [4, 0, 0], D: [0, 4, 0], M: [2, 2, 0]},
    suggestedConstructions: [{id: 'aux-am', kind: 'segment', points: ['A', 'M'], dependsOn: ['c-mid']}],
    confidence: {overall: 0.94, ocr: 0.94}
  };
  const pipeline = createTrustedGeometryPipeline({modelAdapter: async () => candidate});

  const result = await pipeline.run({questionText: question});

  assert.equal(result.status, 'underdetermined_for_query');
  assert.equal(result.validation.checks.length, 5);
  assert.ok(result.validation.checks.every(check => check.pass));
  assert.equal(result.sceneSpec,undefined);
});

test('圆柱候选坐标同时验证半径、高和主轴，并生成专属 Three.js 实体', async () => {
  const candidate = {
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [{id: 'O', kind: 'point'}, {id: 'O1', kind: 'point'}, {id: 'A', kind: 'point'}, {id: 'cylinder1', kind: 'right_cylinder', baseCenter: 'O', topCenter: 'O1'}],
      explicitFacts: [
        {id: 'f-radius', kind: 'quantity', name: 'radius', value: 3, evidenceRefs: ['ev-radius']},
        {id: 'f-height', kind: 'quantity', name: 'height', value: 4, evidenceRefs: ['ev-height']}
      ],
      derivedFacts: [],
      constraints: [{id: 'c-cylinder', kind: 'right_cylinder', entity: 'cylinder1', baseCenter: 'O', topCenter: 'O1', radiusPoint: 'A', radius: 3, height: 4, hard: true, factRefs: ['f-radius', 'f-height']}],
      queries: [{id: 'q1', kind: 'compute', target: 'volume'}],
      evidence: [{id: 'ev-radius', kind: 'text', quote: '半径为3'}, {id: 'ev-height', kind: 'text', quote: '高为4'}]
    },
    modelingParameters: {radius: 3, height: 4},
    coordinateSystem: {dimension: 3, handedness: 'right', canonical: true},
    candidateCoordinates: {O: [0, 0, 0], O1: [0, 0, 4], A: [3, 0, 0]},
    suggestedConstructions: [],
    confidence: {overall: 0.96, ocr: 0.96}
  };
  const pipeline = createTrustedGeometryPipeline({modelAdapter: async () => candidate});
  const result = await pipeline.run({questionText: '圆柱底面半径为3，高为4，求体积。'});
  assert.equal(result.status, 'verified_unique');
  assert.ok(result.sceneSpec.elements.some(item => item.type === 'cylinder'));
});

test('圆柱别名与代表姿态通过同一约束后仍生成主体 SceneSpec',async()=>{
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'O',kind:'point'},{id:'O1',kind:'point'},{id:'A',kind:'point'},{id:'body',kind:'cylinder',baseCenter:'O',topCenter:'O1'}],explicitFacts:[{id:'f-r',kind:'quantity',name:'radius',value:2,evidenceRefs:['e-r']},{id:'f-h',kind:'quantity',name:'height',value:5,evidenceRefs:['e-h']}],derivedFacts:[],constraints:[{id:'c-body',kind:'cylinder',entity:'body',baseCenter:'O',topCenter:'O1',radiusPoint:'A',radius:2,height:5,hard:true,factRefs:['f-r','f-h']}],queries:[{id:'q',kind:'construct',target:'body'}],evidence:[{id:'e-r',kind:'text',quote:'半径为2'},{id:'e-h',kind:'text',quote:'高为5'}]},modelingParameters:{radius:2,height:5,identifiability:'representative'},coordinateSystem:{dimension:3,canonical:true},candidateCoordinates:{O:[0,0,0],O1:[0,0,5],A:[2,0,0]},confidence:{overall:.98,ocr:.98}};
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate});

  const result=await pipeline.run({questionText:'圆柱半径为2，高为5，建立模型。'});

  assert.equal(result.status,'verified_representative');
  assert.ok(result.sceneSpec.elements.some(item=>item.id==='body'&&item.type==='cylinder'));
});

test('每条硬事实必须绑定到实际验证约束，不能用无关约束绕过题意', () => {
  const normalized = normalizeGeometryInput({questionText: '已知 AB=6，建立空间模型。'});
  const candidate = {
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [{id: 'A', kind: 'point'}, {id: 'B', kind: 'point'}],
      explicitFacts: [{id: 'f-ab', kind: 'quantity', name: 'AB', value: 6, evidenceRefs: ['ev-ab']}],
      derivedFacts: [],
      constraints: [{id: 'c-unrelated', kind: 'positive', value: 1, hard: true, factRefs: []}],
      queries: [{id: 'q1', kind: 'construct', target: 'AB'}],
      evidence: [{id: 'ev-ab', kind: 'text', quote: 'AB=6'}]
    },
    modelingParameters: {},
    candidateCoordinates: {A: [0, 0, 0], B: [1, 0, 0]},
    confidence: {overall: 0.95, ocr: 0.95}
  };

  const gate = runGeometryEvidenceGate(normalized, candidate);

  assert.equal(gate.pass, false);
  assert.ok(gate.issues.some(item => item.code === 'HARD_FACT_NOT_VALIDATED' && item.path === 'f-ab'));
});

test('Evidence Gate 在 Validator 前拒绝不存在的点线面与辅助构造引用',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知 AB=3，作 AC。'});
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:[{id:'A',kind:'point'},{id:'B',kind:'point'},{id:'AC',kind:'segment',points:['A','C']}],explicitFacts:[{id:'f-ab',kind:'quantity',value:3,evidenceRefs:['ev-ab']}],derivedFacts:[],constraints:[{id:'c-ab',kind:'distance',points:['A','B'],value:3,hard:true,factRefs:['f-ab']}],queries:[],evidence:[{id:'ev-ab',kind:'text',quote:'AB=3'}]},candidateCoordinates:{A:[0,0,0],B:[3,0,0]},suggestedConstructions:[{id:'aux',kind:'segment',points:['A','D'],dependsOn:['missing-constraint']}],confidence:{overall:.95,ocr:.95}};

  const gate=runGeometryEvidenceGate(normalized,candidate);

  assert.equal(gate.pass,false);
  assert.ok(gate.issues.some(item=>item.code==='DANGLING_GEOMETRY_REFERENCE'&&item.ref==='C'));
  assert.ok(gate.issues.some(item=>item.code==='DANGLING_CONSTRUCTION_DEPENDENCY'&&item.ref==='missing-constraint'));
});

test('内置解析构造器会在模型坐标失败后修复标准圆柱并重新验算', async () => {
  const candidate = {
    geometryIR: {
      schemaVersion: 'geometry-ir/v4',
      entities: [{id: 'O', kind: 'point'}, {id: 'O1', kind: 'point'}, {id: 'A', kind: 'point'}, {id: 'solid', kind: 'right_cylinder', baseCenter: 'O', topCenter: 'O1'}],
      explicitFacts: [{id: 'f-r', kind: 'quantity', value: 3, evidenceRefs: ['ev-r']}, {id: 'f-h', kind: 'quantity', value: 4, evidenceRefs: ['ev-h']}],
      derivedFacts: [],
      constraints: [{id: 'c-solid', kind: 'right_cylinder', entity: 'solid', baseCenter: 'O', topCenter: 'O1', radiusPoint: 'A', radius: 3, height: 4, hard: true, factRefs: ['f-r', 'f-h']}],
      queries: [{id: 'q', kind: 'construct', target: 'solid'}],
      evidence: [{id: 'ev-r', kind: 'text', quote: '半径为3'}, {id: 'ev-h', kind: 'text', quote: '高为4'}]
    },
    modelingParameters: {radius: 3, height: 4},
    candidateCoordinates: {O: [0, 0, 0], O1: [0, 0, 9], A: [8, 0, 0]},
    suggestedConstructions: [{id: 'unverified', kind: 'segment', points: ['O', 'A'], dependsOn: ['missing-constraint']}],
    confidence: {overall: 0.95, ocr: 0.95}
  };
  const pipeline = createTrustedGeometryPipeline({
    modelAdapter: async () => candidate,
    reviewAdapter: async () => ({...candidate,semanticReviewReport:{status:'approved',reviewedIssueCodes:['DANGLING_CONSTRUCTION_DEPENDENCY'],reviewedRiskCodes:[],retainedFactIds:['f-r','f-h'],correctedFields:[],evidenceDecision:'题干证据有效，悬空的可选辅助构造交由本地构造器删除'}}),
    fallbackSolver: createAnalyticGeometryFallback()
  });

  const result = await pipeline.run({questionText: '圆柱半径为3，高为4。'});

  assert.equal(result.executionPath, 'fallback_solver');
  assert.deepEqual(result.finalCoordinates.O1, [0, 0, 4]);
  assert.equal(result.sceneSpec.elements.some(item => item.id === 'unverified'), false);
});

test('DeepSeek 的通用多面体 IR 会验证拓扑、空间角距离与六边形截面后再渲染', async () => {
  const coordinates = {
    A:[0,0,0],B:[2,0,0],C:[2,2,0],D:[0,2,0],A1:[0,0,2],B1:[2,0,2],C1:[2,2,2],D1:[0,2,2],
    S1:[2,1,0],S2:[1,2,0],S3:[0,2,1],S4:[0,1,2],S5:[1,0,2],S6:[2,0,1]
  };
  const faces = [['A','B','C','D'],['A1','D1','C1','B1'],['A','A1','B1','B'],['B','B1','C1','C'],['C','C1','D1','D'],['D','D1','A1','A']];
  const candidate = {
    geometryIR: {
      schemaVersion:'geometry-ir/v4',
      entities:[
        ...Object.keys(coordinates).map(id=>({id,kind:'point'})),
        {id:'cube1',kind:'cube',faces},
        {id:'section1',kind:'section_polygon',points:['S1','S2','S3','S4','S5','S6'],normal:[1,1,1]}
      ],
      explicitFacts:[{id:'f-edge',kind:'quantity',name:'edge',value:2,evidenceRefs:['ev-edge']}],derivedFacts:[],evidence:[{id:'ev-edge',kind:'text',quote:'棱长为2'}],
      constraints:[
        {id:'c-edge',kind:'distance',points:['A','B'],value:2,hard:true,factRefs:['f-edge']},
        {id:'c-solid',kind:'polyhedron',entity:'cube1',hard:true},
        {id:'c-angle',kind:'line_plane_angle',line:['A','C1'],plane:['A','B','D'],measure:'sine',value:1/Math.sqrt(3),hard:true},
        {id:'c-distance',kind:'point_plane_distance',point:'C1',planePoints:['A','B','D'],value:2,hard:true},
        {id:'c-section',kind:'polyhedron_section',solid:'cube1',normal:[1,1,1],offset:3,points:['S1','S2','S3','S4','S5','S6'],vertexCount:6,hard:true}
      ],
      queries:[{id:'q1',kind:'polyhedron_section',target:'section1'}]
    },
    modelingParameters:{identifiability:'representative'},
    coordinateSystem:{dimension:3,handedness:'right',canonical:true},
    candidateCoordinates:coordinates,suggestedConstructions:[],confidence:{overall:.98,ocr:.98}
  };
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate});
  const result=await pipeline.run({questionText:'在棱长为2的正方体中，用平面 x+y+z=3 截该正方体，并研究体对角线与底面的夹角及点 C1 到底面的距离。'});
  assert.equal(result.status,'verified_representative');
  assert.equal(result.validation.pass,true);
  assert.ok(result.sceneSpec.elements.some(item=>item.type==='polyhedron-face'));
  assert.ok(result.sceneSpec.elements.some(item=>item.type==='section-polygon'));
  assert.equal(result.sceneSpec.frameEdges.length,12);
});

test('DeepSeek 正方体坐标失败时解析构造器按能力参数重建，Solver 只作兜底',async()=>{
  const ids=['A','B','C','D','A1','B1','C1','D1'],faces=[['A','B','C','D'],['A1','D1','C1','B1'],['A','A1','B1','B'],['B','B1','C1','C'],['C','C1','D1','D'],['D','D1','A1','A']];
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:[...ids.map(id=>({id,kind:'point'})),{id:'cube1',kind:'cube',faces}],explicitFacts:[{id:'f-edge',kind:'quantity',name:'edge',value:3,evidenceRefs:['ev-edge']}],derivedFacts:[],constraints:[{id:'c-edge',kind:'distance',points:['A','B'],value:3,hard:true,factRefs:['f-edge']},{id:'c-solid',kind:'polyhedron',entity:'cube1',hard:true}],queries:[{id:'q',kind:'construct',target:'cube1'}],evidence:[{id:'ev-edge',kind:'text',quote:'棱长为3'}]},modelingParameters:{edge:3},candidateCoordinates:Object.fromEntries(ids.map(id=>[id,[0,0,0]])),coordinateSystem:{dimension:3,handedness:'right',canonical:true},suggestedConstructions:[],confidence:{overall:.98,ocr:.98}};
  const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>candidate,reviewAdapter:async()=>candidate,fallbackSolver:createAnalyticGeometryFallback()});
  const result=await pipeline.run({questionText:'正方体的棱长为3，建立空间模型。'});
  assert.equal(result.status,'verified_unique');
  assert.equal(result.executionPath,'fallback_solver');
  assert.deepEqual(result.finalCoordinates.C1,[3,3,3]);
});

test('DeepSeek 直通模式不运行后置审查并把坐标、辅助线、高亮面和 XYZ 返回原场景',async()=>{
  let semanticReviewCalls=0,coordinateReviewCalls=0,fallbackCalls=0;
  const candidate={
    schemaVersion:'geometry-compile-response/v1',
    geometryIR:{
      schemaVersion:'geometry-ir/v4',
      entities:[
        ...['A','B','C','A1','B1','C1','D','E'].map(id=>({id,kind:'point'})),
        {id:'DE',kind:'segment',points:['D','E']},
        {id:'plane:BCC1B1',kind:'plane',points:['B','C','C1','B1']},
        {id:'prism',kind:'prism',baseVertices:['A','B','C'],topVertices:['A1','B1','C1'],faces:[['A','B','C'],['A1','C1','B1'],['A','A1','B1','B'],['B','B1','C1','C'],['C','C1','A1','A']]}
      ],
      explicitFacts:[],derivedFacts:[],evidence:[],
      constraints:[{id:'wrapped-parallel',entity:'DE',constraint:{kind:'parallel',operands:['DE','plane:BCC1B1']},hard:true,factRefs:[]}],
      queries:[{id:'q1',kind:'proof',target:{kind:'parallel',line:'DE',plane:'plane:BCC1B1'}}]
    },
    sourceCoverage:[],
    candidateCoordinates:{A:[2,0,0],B:[0,2,0],C:[0,0,0],A1:[2,0,2],B1:[0,2,2],C1:[0,0,2],D:[1,1,0],E:[1,0,1]},
    unresolvedItems:[],
    suggestedConstructions:[{id:'aux-DE',kind:'segment',points:['D','E'],constraintRefs:['wrapped-parallel']}],
    annotations:[{id:'plane-label',kind:'planeLabel',entityRefs:['plane:BCC1B1'],points:['B','C','C1'],constraintRefs:['wrapped-parallel'],label:'平面 BCC₁B₁'}],
    subproblemVisualization:[],
    confidence:{overall:.95,ocr:.95}
  };
  const pipeline=createTrustedGeometryPipeline({
    directModelOutput:true,
    modelAdapter:async()=>candidate,
    semanticReviewAdapter:async()=>{semanticReviewCalls+=1;return candidate;},
    reviewAdapter:async()=>{coordinateReviewCalls+=1;return candidate;},
    fallbackSolver:async()=>{fallbackCalls+=1;return candidate;}
  });
  const result=await pipeline.run({questionText:'在直三棱柱中，D、E 为中点，证明 DE 平行平面 BCC₁B₁。'});
  assert.equal(result.status,'ai_reference');
  assert.equal(result.executionPath,'deepseek_direct_unreviewed');
  assert.equal(result.reviewMode,'disabled_by_product_decision');
  assert.equal(semanticReviewCalls,0);
  assert.equal(coordinateReviewCalls,0);
  assert.equal(fallbackCalls,0);
  assert.ok(result.sceneSpec.elements.some(item=>item.id==='axes'&&item.type==='axes'));
  assert.ok(result.sceneSpec.elements.some(item=>item.id==='plane:BCC1B1'&&item.type==='plane'));
  assert.ok(result.sceneSpec.elements.some(item=>item.id==='aux-DE'&&item.role==='ai-construction'));
  assert.ok(result.sceneSpec.pedagogy.subproblemViews.some(item=>item.highlightEntities.includes('plane:BCC1B1')));
  assert.ok(result.sceneSpec.pedagogy.emphasis.lines.some(item=>item.entityRefs.includes('DE')));
  assert.ok(result.sceneSpec.pedagogy.emphasis.faces.some(item=>item.entityRefs.includes('plane:BCC1B1')));
  assert.ok(result.sceneSpec.pedagogy.annotations.some(item=>item.label==='平面 BCC₁B₁'&&item.unverified===true));
});
