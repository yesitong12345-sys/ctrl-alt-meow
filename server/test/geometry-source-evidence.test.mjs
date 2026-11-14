import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGeometryInput,runGeometryEvidenceGate,createTrustedGeometryPipeline,validateGeometryCandidate} from '../workflows/geometry-trusted-pipeline.mjs';
import {parseStandardPolyhedronText} from '../workflows/polyhedron-geometry-entry.mjs';
import {compilePolyhedronGeometryIR} from '../workflows/polyhedron-geometry-engine.mjs';

function fixture(value=4){
  return {geometryIR:{schemaVersion:'geometry-ir/v4',entities:['A','B','C','D'].map(id=>({id,kind:'point'})),explicitFacts:[{id:'f',name:'AB',kind:'quantity',value,evidenceRefs:['e']}],derivedFacts:[],constraints:[{id:'c',kind:'distance',points:['A','B'],value,hard:true,factRefs:['f']}],queries:[],evidence:[{id:'e',kind:'text',quote:'AB=4'}]},candidateCoordinates:{A:[0,0,0],B:[value,0,0],C:[0,1,0],D:[1,1,0]}};
}

test('原文 AB=4 不能用引用相同原文但数值为5的自洽模型通过',()=>{
  const result=runGeometryEvidenceGate(normalizeGeometryInput({questionText:'已知AB=4。'}),fixture(5));
  assert.equal(result.pass,false);
  assert.ok(result.issues.some(issue=>issue.code==='SOURCE_QUANTITY_MISMATCH'));
});

test('同一句第二条已知长度不可漏录，等式链逐项保留',()=>{
  for(const text of ['已知AB=4，CD=2。','已知AB=CD=4。']){
    const gate=runGeometryEvidenceGate(normalizeGeometryInput({questionText:text}),fixture());
    assert.equal(gate.pass,false);
    assert.ok(gate.issues.some(issue=>issue.code==='SOURCE_QUANTITY_MISSING'));
  }
});

test('待求及选择题选项中的等式不是已知条件',()=>{
  const candidate=fixture();
  candidate.geometryIR.queries=[{id:'q',optionId:'A',kind:'boolean_option'}];
  for(const text of ['已知AB=4，判断是否CD=2。','已知AB=4。\nA. CD=2']){
    assert.equal(runGeometryEvidenceGate(normalizeGeometryInput({questionText:text}),candidate).pass,true);
  }
});

test('已知垂直不能仅作为待证明问题通过证据门',()=>{
  const candidate=fixture();
  candidate.geometryIR.queries=[{id:'q',kind:'vector_relation',first:['A','B'],second:['C','D'],expectation:{perpendicular:true}}];
  const gate=runGeometryEvidenceGate(normalizeGeometryInput({questionText:'已知AB=4，AB垂直CD。'}),candidate);
  assert.ok(gate.issues.some(issue=>issue.code==='SOURCE_GIVEN_RELATION_NOT_CONSTRAINED'));
});

test('本地构造器不能将矛盾已知平行关系当成问题而继续 verified',()=>{
  const parsed=parseStandardPolyhedronText('正四面体OABC中，棱长为1，已知OA平行BC，求证AB垂直OC。');
  const result=compilePolyhedronGeometryIR(parsed.problemIR);
  assert.equal(result.status,'validation_failed');
});

test('数学复合术语不被垂直符号替换破坏',()=>{
  assert.ok(normalizeGeometryInput({questionText:'作AB的垂直平分线，并求垂直投影。'}).normalizedInput.includes('垂直平分线'));
});

test('中点条件必须逐项进入硬约束，不能漏掉第二个或把端点配错',()=>{
  const normalized=normalizeGeometryInput({questionText:'AB=4，E、F分别是AB、CD的中点。'});
  const candidate=fixture();
  candidate.geometryIR.entities.push({id:'E',kind:'point'},{id:'F',kind:'point'});
  candidate.candidateCoordinates.E=[2,0,0];candidate.candidateCoordinates.F=[.5,1,0];
  candidate.geometryIR.constraints.push({id:'mid-e',kind:'midpoint',point:'E',endpoints:['A','B'],hard:true});
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_MIDPOINT_MISSING'&&item.point==='F'));
  candidate.geometryIR.constraints.push({id:'mid-f',kind:'midpoint',point:'F',endpoints:['C','D'],hard:true});
  assert.equal(runGeometryEvidenceGate(normalized,candidate).pass,true);
  candidate.geometryIR.constraints[2].endpoints=['A','C'];
  assert.equal(runGeometryEvidenceGate(normalized,candidate).pass,false);
});

test('管线只对合法 IR 做坐标兜底；提供商失败交由外层本地解析器，语义错误不得掩盖',async()=>{
  for(const firstThrows of [true,false]){
    let fallbackCalls=0;
    const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>{if(firstThrows)throw Object.assign(new Error('private detail'),{code:'PROVIDER_TIMEOUT'});return fixture(5);},semanticReviewAdapter:async()=>{throw Object.assign(new Error('private detail'),{code:'PROVIDER_NETWORK_ERROR'});},fallbackSolver:async()=>{fallbackCalls++;return fixture();}});
    const result=await pipeline.run({questionText:'AB=4。'});
    assert.equal(fallbackCalls,0);
    if(firstThrows)assert.equal(result.status,'provider_unavailable');
    else assert.equal(result.status,'evidence_failed');
    assert.ok(result.attempts.some(item=>item.category?.startsWith('PROVIDER_')));
    assert.ok(!JSON.stringify(result.attempts).includes('private detail'));
  }
});

test('DeepSeek 计费、鉴权和限流错误不能再统一误报为网络失败',async()=>{
  for(const [httpStatus,expected] of [[402,'provider_billing_required'],[401,'provider_auth_failed'],[429,'provider_rate_limited']]){
    const pipeline=createTrustedGeometryPipeline({modelAdapter:async()=>{throw Object.assign(new Error('provider rejected'),{code:'PROVIDER_HTTP_ERROR',httpStatus,retryable:false})}});
    const result=await pipeline.run({questionText:`建立模型 ${httpStatus}`});
    assert.equal(result.status,expected);
    assert.equal(result.httpStatus,httpStatus);
  }
});

test('图片证据必须绑定本次图片、有效区域和可读内容，低置信度触发复核',()=>{
  const candidate=fixture();
  candidate.geometryIR.evidence=[{id:'e',kind:'image',region:[0,0,.5,.5],quote:'AB=4',confidence:.95}];
  const textOnly=normalizeGeometryInput({questionText:'建立模型'});
  assert.ok(runGeometryEvidenceGate(textOnly,candidate).issues.some(item=>item.code==='IMAGE_SOURCE_MISSING'));
  const imageInput=normalizeGeometryInput({questionText:'建立模型',imageData:'data:image/png;base64,dGVzdA=='});
  candidate.geometryIR.evidence[0].imageHash=imageInput.imageHash;
  assert.ok(runGeometryEvidenceGate(imageInput,candidate).issues.some(item=>item.code==='IMAGE_AUDIT_MISSING'));
  candidate.imageAudit={imageHash:imageInput.imageHash,pageCompleteness:'complete',coverageRegions:[{id:'region-1',region:[0,0,.5,.5],kind:'diagram',evidenceRefs:['e']}],unreadableRegions:[],diagramMarks:[]};
  assert.equal(runGeometryEvidenceGate(imageInput,candidate).pass,true);
  candidate.geometryIR.evidence[0].region=[.8,0,.5,.5];
  assert.ok(runGeometryEvidenceGate(imageInput,candidate).issues.some(item=>item.code==='INVALID_IMAGE_REGION'));
  candidate.geometryIR.evidence[0].region=[0,0,.5,.5];
  candidate.geometryIR.evidence[0].confidence=.4;
  assert.equal(runGeometryEvidenceGate(imageInput,candidate).reviewRequired,true);
  candidate.geometryIR.evidence[0].imageHash='another-upload';
  assert.ok(runGeometryEvidenceGate(imageInput,candidate).issues.some(item=>item.code==='IMAGE_SOURCE_MISMATCH'));
});

test('复杂文字中的比例与自然语言参数分别成为条件原子，漏一项就不能通过',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知球半径为5 cm，且AB:BC=2:3，求球的体积。'});
  assert.ok(normalized.conditionAtoms.some(item=>item.kind==='parameter'&&item.name==='radius'&&item.expression==='5'&&item.unit==='cm'));
  assert.ok(normalized.conditionAtoms.some(item=>item.kind==='ratio'&&item.first==='AB'&&item.second==='BC'));
  const candidate=fixture();
  const gate=runGeometryEvidenceGate(normalized,candidate);
  assert.ok(gate.issues.some(item=>item.code==='SOURCE_PARAMETER_MISSING'&&item.name==='radius'));
  assert.ok(gate.issues.some(item=>item.code==='SOURCE_RATIO_MISSING'));
});

test('完整保留的自然语言参数与线段比例可进入确定性 Validator',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知AB=4，球半径为5 cm，且AB:BC=2:3，求球的体积。'});
  const candidate=fixture();
  candidate.geometryIR.queries.push({id:'q-volume',kind:'volume'});
  candidate.geometryIR.entities.push({id:'sphere-1',kind:'sphere',center:'A'});
  candidate.geometryIR.evidence.push({id:'e-radius',kind:'text',quote:'球半径为5 cm'},{id:'e-ratio',kind:'text',quote:'AB:BC=2:3'});
  candidate.geometryIR.explicitFacts.push(
    {id:'f-radius',name:'radius',kind:'quantity',value:5,unit:'cm',evidenceRefs:['e-radius']},
    {id:'f-ratio',name:'AB:BC',kind:'ratio',value:2/3,evidenceRefs:['e-ratio']}
  );
  candidate.geometryIR.constraints.push(
    {id:'c-radius',kind:'positive',name:'radius',value:5,unit:'cm',hard:true,factRefs:['f-radius']},
    {id:'c-ratio',kind:'ratio',first:['A','B'],second:['B','C'],value:2/3,hard:true,factRefs:['f-ratio']}
  );
  candidate.candidateCoordinates.C=[10,0,0];
  candidate.modelingParameters={radius:5};
  assert.equal(runGeometryEvidenceGate(normalized,candidate).pass,true);
  assert.equal(validateGeometryCandidate(candidate).pass,true);
});

test('图片整图审计必须覆盖每条图片证据，不能只框一处就声称读取完整',()=>{
  const normalized=normalizeGeometryInput({questionText:'读取整题',imageData:'data:image/png;base64,aW1hZ2U='});
  const candidate=fixture();
  candidate.geometryIR.evidence=[
    {id:'e',kind:'image',imageHash:normalized.imageHash,region:[0,.1,.4,.2],quote:'AB=4',confidence:.98},
    {id:'e-diagram',kind:'image',imageHash:normalized.imageHash,region:[.45,.1,.45,.6],quote:'图中 AB 垂直 CD',confidence:.92}
  ];
  candidate.geometryIR.explicitFacts[0].evidenceRefs=['e'];
  candidate.imageAudit={imageHash:normalized.imageHash,pageCompleteness:'complete',coverageRegions:[{id:'text',region:[0,.1,.4,.2],kind:'text',evidenceRefs:['e']}],unreadableRegions:[],diagramMarks:[]};
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='IMAGE_EVIDENCE_NOT_AUDITED'&&item.ref==='e-diagram'));
  candidate.imageAudit.coverageRegions.push({id:'diagram',region:[.45,.1,.45,.6],kind:'diagram',evidenceRefs:['e-diagram']});
  candidate.imageAudit.diagramMarks=[{id:'mark-perpendicular',kind:'perpendicular',evidenceRefs:['e-diagram']}];
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='IMAGE_DIAGRAM_MARK_NOT_MODELED'));
  candidate.imageAudit.diagramMarks=[];
  assert.equal(runGeometryEvidenceGate(normalized,candidate).pass,true);
});

test('复杂题的点线面、投影、共面、纯等长与相切关系都形成独立条件原子',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知H为P在平面ABC上的投影，D在直线AB上，A、B、C、E共面，AB=CD，直线ET与球O相切于T。'});
  for(const kind of ['projection','point_on_line','coplanar','equal_length','tangent'])assert.ok(normalized.conditionAtoms.some(item=>item.kind===kind),kind);
  const gate=runGeometryEvidenceGate(normalized,fixture());
  for(const kind of ['projection','point_on_line','coplanar','equal_length','tangent'])assert.ok(gate.issues.some(item=>item.code==='SOURCE_STRUCTURAL_RELATION_MISSING'&&item.kind===kind),kind);
});

test('真实试卷常见的希腊字母平面、四点平面、交点、菱形与截面直径不会漏成空条件',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知平面α∥平面β，直线l⊥平面α，PA⊥平面ABCD，AC与BD交于O，ABCD为菱形，截面圆直径为6 cm。'});
  const atoms=normalized.conditionAtoms;
  assert.ok(atoms.some(item=>item.kind==='parallel'&&item.operands.includes('plane:α')&&item.operands.includes('plane:β')));
  assert.ok(atoms.some(item=>item.kind==='perpendicular'&&item.operands.includes('line:l')&&item.operands.includes('plane:α')));
  assert.ok(atoms.some(item=>item.kind==='perpendicular'&&item.operands.includes('PA')&&item.operands.includes('plane:ABCD')));
  assert.ok(atoms.some(item=>item.kind==='intersection'&&item.point==='O'));
  assert.ok(atoms.some(item=>item.kind==='quadrilateral_type'&&item.shape==='rhombus'));
  assert.ok(atoms.some(item=>item.kind==='parameter'&&item.name==='sectionDiameter'&&item.expression==='6'&&item.unit==='cm'));
});

test('角度等式链中的每个角都是独立条件原子',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知∠APB=∠BPC=∠CPA=60°，求三棱锥体积。'});
  const angles=normalized.quantityMentions.filter(item=>item.kind==='angle'&&item.role==='given');
  assert.deepEqual(new Set(angles.map(item=>item.subject)),new Set(['APB','BPC','CPA']));
});

test('所求目标必须与 query 语义一致，不能用错误类型 query 冒充覆盖',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知AB=4，求四面体ABCD的体积。'});
  const candidate=fixture();
  candidate.geometryIR.queries=[{id:'q-wrong',kind:'surface_area'}];
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_MISMATCH'));
  candidate.geometryIR.queries=[{id:'q-volume',kind:'volume'}];
  assert.ok(!runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_MISMATCH'));
});

test('同类多小问不能只保留第一个 query',()=>{
  const normalized=normalizeGeometryInput({questionText:'(1)求棱锥P-ABC的体积；(2)求四面体P-BCD的体积。'});
  const candidate=fixture();
  candidate.geometryIR.queries=[{id:'q-volume-1',kind:'volume'}];
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_COUNT_MISMATCH'&&item.expected==='volume'));
  candidate.geometryIR.queries.push({id:'q-volume-2',kind:'volume'});
  assert.ok(!runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_COUNT_MISMATCH'));
});

test('同类多小问必须分别指向原题中的具体对象，不能复制同一个 query 冒充完整',()=>{
  const normalized=normalizeGeometryInput({questionText:'(1)求棱锥P-ABC的体积；(2)求四面体P-BCD的体积。'});
  assert.deepEqual(normalized.queryMentions.map(item=>item.target),['P-ABC','P-BCD']);
  const candidate=fixture();
  candidate.geometryIR.entities.push(
    {id:'solid-pabc',kind:'pyramid',aliases:['P-ABC']},
    {id:'solid-pbcd',kind:'tetrahedron',aliases:['P-BCD']}
  );
  candidate.geometryIR.queries=[
    {id:'q-volume-1',kind:'volume',target:'solid-pabc'},
    {id:'q-volume-2',kind:'volume',target:'solid-pabc'}
  ];
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_TARGET_MISMATCH'&&item.expectedTarget==='P-BCD'));
  candidate.geometryIR.queries[1].target='solid-pbcd';
  assert.ok(!runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_TARGET_MISMATCH'));
});

test('query 目标保留实体类型与命名分隔，球 O 不能被同名圆 O 冒充',()=>{
  const normalized=normalizeGeometryInput({questionText:'求球O的体积。'});
  assert.equal(normalized.queryMentions[0].targetEntityKind,'sphere');
  const candidate=fixture();
  candidate.geometryIR.entities.push({id:'circle-o',kind:'circle',aliases:['O']});
  candidate.geometryIR.queries=[{id:'q',kind:'volume',target:'circle-o'}];
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_TARGET_MISMATCH'));
});

test('query 可直接引用无别名实体 ID，不会被目标完整性检查误拒',()=>{
  const normalized=normalizeGeometryInput({questionText:'求棱锥P-ABC的体积。'});
  const candidate=fixture();
  candidate.geometryIR.entities.push({id:'P-ABC',kind:'pyramid'});
  candidate.geometryIR.queries=[{id:'q',kind:'volume',target:'P-ABC'}];
  assert.ok(!runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_TARGET_MISMATCH'));
});

test('证明、判断、半径、截面面积、坐标方程、轨迹最值与正切角都进入 query 完整性清单',()=>{
  const normalized=normalizeGeometryInput({questionText:'(1)求证AB∥平面α；(2)求球半径；(3)求截面圆面积；(4)判断四点是否共面；(5)求点P坐标；(6)求轨迹方程；(7)求最小值；(8)求二面角的正切值。'});
  for(const kind of ['proof','radius','area','boolean','coordinate','equation','locus','extremum','angle'])assert.ok(normalized.queryMentions.some(item=>item.kind===kind),kind);
});

test('交点与菱形约束拥有确定性 Validator，不会只通过证据门后卡死',()=>{
  const candidate={geometryIR:{schemaVersion:'geometry-ir/v4',entities:['A','B','C','D','O'].map(id=>({id,kind:'point'})),explicitFacts:[],derivedFacts:[],constraints:[
    {id:'intersection',kind:'intersection',first:['A','C'],second:['B','D'],point:'O',hard:true},
    {id:'rhombus',kind:'quadrilateral_type',points:['A','B','C','D'],shape:'rhombus',hard:true}
  ],queries:[],evidence:[]},candidateCoordinates:{A:[-1,0,0],B:[0,1,0],C:[1,0,0],D:[0,-1,0],O:[0,0,0]}};
  assert.equal(validateGeometryCandidate(candidate).pass,true);
  candidate.candidateCoordinates.D=[0,-2,0];
  assert.equal(validateGeometryCandidate(candidate).pass,false);
});

test('含明确条件或所求的语义分句不能被模型降级成 context 逃过核验',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知AB=4，求体积。'});
  const candidate=fixture();
  candidate.provider='deepseek';
  candidate.sourceCoverage=normalized.semanticClauses.map(item=>({clauseId:item.id,status:'context',refs:[]}));
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_SEMANTIC_CLAUSE_DOWNGRADED'));
});

test('待证明关系必须留在 query，不能伪装成题目已知硬约束形成循环论证',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知AB=4，求证AB∥CD。'});
  const candidate=fixture();
  candidate.geometryIR.entities.push({id:'C',kind:'point'},{id:'D',kind:'point'});
  candidate.geometryIR.evidence.push({id:'e-proof',kind:'text',quote:'AB∥CD'});
  candidate.geometryIR.explicitFacts.push({id:'f-proof',kind:'parallel',evidenceRefs:['e-proof']});
  candidate.geometryIR.constraints.push({id:'c-proof',kind:'parallel',vectors:[['A','B'],['C','D']],hard:true,factRefs:['f-proof']});
  candidate.geometryIR.queries.push({id:'q-proof',kind:'proof',relation:{kind:'parallel',operands:[['A','B'],['C','D']]}});
  const gate=runGeometryEvidenceGate(normalized,candidate);
  assert.ok(gate.issues.some(item=>item.code==='QUERY_RELATION_ASSERTED_AS_GIVEN'));
});

test('求半径与求直径是不同 query，不能互相冒充',()=>{
  const normalized=normalizeGeometryInput({questionText:'求球的半径。'});
  const candidate=fixture();
  candidate.geometryIR.queries=[{id:'q',kind:'diameter'}];
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_QUERY_MISMATCH'));
});

test('重合直线不算唯一交点，平行四边形不冒充严格梯形',()=>{
  const intersection={geometryIR:{schemaVersion:'geometry-ir/v4',entities:['A','B','C','D','O'].map(id=>({id,kind:'point'})),explicitFacts:[],derivedFacts:[],constraints:[{id:'i',kind:'intersection',first:['A','B'],second:['C','D'],point:'O',hard:true}],queries:[],evidence:[]},candidateCoordinates:{A:[0,0,0],B:[2,0,0],C:[-1,0,0],D:[3,0,0],O:[1,0,0]}};
  assert.equal(validateGeometryCandidate(intersection).pass,false);
  const trapezoid={geometryIR:{schemaVersion:'geometry-ir/v4',entities:['A','B','C','D'].map(id=>({id,kind:'point'})),explicitFacts:[],derivedFacts:[],constraints:[{id:'t',kind:'quadrilateral_type',shape:'trapezoid',points:['A','B','C','D'],hard:true}],queries:[],evidence:[]},candidateCoordinates:{A:[0,0,0],B:[2,0,0],C:[2,1,0],D:[0,1,0]}};
  assert.equal(validateGeometryCandidate(trapezoid).pass,false);
});

test('原题单位与 IR 单位不一致时不能通过',()=>{
  const normalized=normalizeGeometryInput({questionText:'已知AB=4 cm。'});
  const candidate=fixture();
  candidate.geometryIR.explicitFacts[0].unit='m';
  candidate.geometryIR.constraints[0].unit='m';
  assert.ok(runGeometryEvidenceGate(normalized,candidate).issues.some(item=>item.code==='SOURCE_UNIT_MISMATCH'));
  candidate.geometryIR.explicitFacts[0].unit='cm';
  candidate.geometryIR.constraints[0].unit='cm';
  assert.equal(runGeometryEvidenceGate(normalized,candidate).pass,true);
});

test('图片覆盖框必须引用真实证据并覆盖对应证据区域，图形无标记明细必须触发复核',()=>{
  const normalized=normalizeGeometryInput({questionText:'读取整题',imageData:'data:image/png;base64,aW1hZ2U='});
  const candidate=fixture();
  candidate.geometryIR.evidence=[{id:'e',kind:'image',imageHash:normalized.imageHash,region:[.1,.1,.3,.2],quote:'AB=4',confidence:.98}];
  candidate.geometryIR.explicitFacts[0].evidenceRefs=['e'];
  candidate.imageAudit={imageHash:normalized.imageHash,pageCompleteness:'complete',coverageRegions:[{id:'diagram',region:[.7,.7,.2,.2],kind:'diagram',evidenceRefs:['missing','e']}],unreadableRegions:[],diagramMarks:[]};
  const result=runGeometryEvidenceGate(normalized,candidate);
  assert.ok(result.issues.some(item=>item.code==='IMAGE_COVERAGE_DANGLING_EVIDENCE'));
  assert.ok(result.issues.some(item=>item.code==='IMAGE_EVIDENCE_REGION_NOT_COVERED'));
  assert.ok(result.risks.some(item=>item.code==='IMAGE_DIAGRAM_MARKS_EMPTY'));
});
