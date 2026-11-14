import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../../implementation/plane-geometry-core.js';
import {compilePlaneGeometry,matchesPlaneGeometry} from '../workflows/plane-geometry.mjs';
const input=(coefficients=[1,0,-3])=>({schemaVersion:'plane-ir/v1',circle:{id:'circle-c',center:[0,0],radius:5},line:{id:'line-l',coefficients}});

test('竖直直线与圆确定性求出两交点及弦长，不依赖斜率形式',()=>{
  const result=core.compile(input());
  assert.equal(result.status,'verified');
  assert.equal(result.solution.relation,'secant');
  assert.deepEqual(result.scene.elements.filter(e=>e.role==='intersection').map(e=>e.position),[[3,-4],[3,4]]);
  assert.equal(result.solution.chordLength,8);
});

test('相切只有一交点，相离无交点，近切但不可靠的数据交回核对',()=>{
  const tangent=core.compile(input([1,0,-5]));
  assert.equal(tangent.status,'verified');assert.equal(tangent.solution.relation,'tangent');
  assert.equal(tangent.solution.intersectionIds.length,1);assert.equal(tangent.solution.chordLength,0);
  const separate=core.compile(input([1,0,-6]));
  assert.equal(separate.solution.relation,'separate');assert.deepEqual(separate.solution.intersectionIds,[]);
  for(const x of [5-1e-11,5+1e-11])assert.equal(core.compile(input([1,0,-x])).status,'needs_review');
});

test('非法参数、重名实体和非有限数不能输出验证模型',()=>{
  const bads=[{...input(),schemaVersion:'old'},input([0,0,1]),input([Infinity,1,0]),input(['1',0,-3])];
  for(const radius of [0,-1,NaN,Infinity,'5'])bads.push({...input(),circle:{...input().circle,radius}});
  bads.push({...input(),circle:{...input().circle,center:[0,NaN]}},
    {...input(),line:{...input().line,id:'circle-c'}}, {...input(),line:{...input().line,id:'point-i-1'}},
    {...input(),circle:{...input().circle,id:'<script>'}});
  for(const bad of bads){const result=core.compile(bad);assert.equal(result.status,'invalid',JSON.stringify(bad));assert.equal(result.scene,undefined);}
});

test('比例或符号等价的方程保持实体及交点次序，水平线同样可用',()=>{
  const expected=core.compile(input([1,2,-3]));
  for(const k of [-2,1e-300,1e300]){
    const actual=core.compile(input([k,2*k,-3*k]));
    assert.equal(actual.status,'verified');assert.deepEqual(actual.scene,expected.scene);
  }
  const horizontal=core.compile(input([0,1,-3]));
  assert.deepEqual(horizontal.scene.elements.filter(e=>e.role==='intersection').map(e=>e.position),[[4,3],[-4,3]]);
  assert.equal(core.compile(input([1,0,-6])).solution.chordLength,null);
});

test('二维SVG仅按有效ID高亮，结果文字服从完成及答案门禁',()=>{
  const model=core.compile(input());
  const locked=core.render(model,{entityIds:['line-l'],completed:true,answerUnlocked:false});
  assert.equal(locked.mode,'highlight');assert.equal(locked.highlighted,1);
  assert.ok(locked.svg.includes('data-entity-id="line-l"'));
  assert.ok(!locked.svg.includes('弦长'));
  assert.ok(core.render(model,{completed:true,answerUnlocked:true}).svg.includes('弦长：8'));
  assert.ok(!core.render(model,{completed:false,answerUnlocked:true}).svg.includes('弦长'));
  assert.ok(!core.render(model,{completed:true,answerUnlocked:'true'}).svg.includes('弦长'));
  const bad=core.render(model,{entityIds:['not-an-entity']});
  assert.equal(bad.mode,'text_only');assert.equal(bad.highlighted,0);
});

test('题目与参数双指纹绑定，未确认不建模，变题或版本失效不复用',()=>{
  const request={question:'圆 x²+y²=25 与直线 x=3 的交点和弦长',subject:'数学',input:input(),confirmed:true};
  assert.equal(compilePlaneGeometry({...request,confirmed:false}).status,'needs_confirmation');
  const model=compilePlaneGeometry(request);assert.equal(model.status,'verified');
  assert.equal(matchesPlaneGeometry(model,request),true);
  assert.equal(matchesPlaneGeometry(JSON.parse(JSON.stringify(model)),request),true);
  for(const changed of [{...request,question:request.question.replace('x=3','x=4')},
    {...request,input:input([1,0,-4])},{...request,subject:'物理'}])assert.equal(matchesPlaneGeometry(model,changed),false);
  assert.equal(matchesPlaneGeometry({...model,version:'future'},request),false);
  assert.equal(matchesPlaneGeometry({...model,canonicalInput:input([1,0,-4])},request),false);
});

test('非整数法向量归一化后重新读取不因浮点末位变化丢失自身绑定',()=>{
  for(let i=1;i<=100;i++){
    const request={question:'非整数参数',confirmed:true,input:input([i/7,1+i/11,.3])};
    const model=compilePlaneGeometry(request);assert.equal(model.status,'verified');
    assert.equal(matchesPlaneGeometry(model,request),true);
    assert.equal(matchesPlaneGeometry(JSON.parse(JSON.stringify(model)),{question:request.question}),true);
  }
});

test('平移圆与斜线保持独立可复算弦长，编译不改原始参数',()=>{
  for(const angle of [0,.3,1.7,3.2])for(const radius of [.001,5,10000]){
    const [cx,cy]=[2,-1],a=Math.cos(angle),b=Math.sin(angle);
    const ir={...input([a,b,-a*cx-b*cy-.6*radius]),circle:{id:'circle-c',center:[cx,cy],radius}};
    const before=JSON.stringify(ir),result=core.compile(ir);
    assert.equal(result.status,'verified',result.reason);
    assert.ok(Math.abs(result.solution.chordLength-1.6*radius)<1e-8*Math.max(1,radius));
    assert.equal(JSON.stringify(ir),before);
    assert.ok(result.verification.residual<=result.verification.tolerance);
  }
});

test('保存的SVG、场景或答案不能冒充当前计算结果或执行代码',()=>{
  const model=core.compile(input());
  model.solution.chordLength=999;
  model.scene.elements.push({id:'evil',type:'svg',label:'<script>alert(1)</script>'});
  const view=core.render(model,{completed:true,answerUnlocked:true});
  assert.ok(view.svg.includes('弦长：8'));assert.ok(!view.svg.includes('<script>'));assert.ok(!view.svg.includes('999'));
  assert.equal(core.render({...model,version:'old'}).mode,'text_only');
});
