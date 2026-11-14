import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

test('network UI groups subjects and places related math knowledge points together when graph API is unavailable', async () => {
  const source = await readFile(path.resolve(import.meta.dirname, '../../implementation/study-insights.js'), 'utf8');
  let feature;
  const document = {
    head:{appendChild(){}}, createElement(){return {style:{}};}, addEventListener(){}, querySelector(){return null;}
  };
  const window = {localStorage:{getItem(){return null;},setItem(){}},__registerStudyInsights(value){feature=value;}};
  /* 页面里 setInterval/clearInterval 是全局的；vm 沙箱里要显式提供，
     否则"提示卡生成计时"那条路径会 ReferenceError。 */
  vm.runInNewContext(source, {document, window, setInterval, clearInterval, setTimeout, clearTimeout});
  assert.ok(feature);
  const points=['立体几何空间关系识别','多面体求角与证明','二面角定义及求法','点到平面的距离公式',
    '线面角的向量计算','法向量与平面方程','空间位置关系判定','直线与平面垂直',
    '棱锥体积与距离','平面截面分析','空间角转化方法','点线面距离关系'];
  const summary = {
    totals:{knowledgePoints:points.length,errors:points.length,dueCards:0}, heatmap:points.map((knowledgePoint,index)=>
      ({subject:'数学',knowledgePoint,caseIds:['shared-question'],errorCount:1,priority:1,index})),
    drilldown:[], topToday:[], errorCauses:[], radar:{}, bySubject:[]
  };
  const root = {innerHTML:'',elements:new Map(),querySelectorAll(selector){
    const attr = selector === '[data-kg-node]' ? 'data-kg-node' : selector === '[data-kg-edge]' ? 'data-kg-edge' : selector === '[data-kg-subject]' ? 'data-kg-subject' : null;
    if (!attr) return [];
    const key = 'kg' + attr.slice('data-kg-'.length).replace(/(^|-)([a-z])/g,(_,dash,letter)=>letter.toUpperCase());
    return [...this.innerHTML.matchAll(new RegExp(attr + '="([^"]+)"', 'g'))].map(([,value])=>{
      const cacheKey=selector+':'+value;
      if(!this.elements.has(cacheKey))this.elements.set(cacheKey,{dataset:{[key]:value}});
      return this.elements.get(cacheKey);
    });
  },querySelector(){return null;}};
  const app = {
    state:{tab:'clusters'}, esc(value){return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));},
    request(url, options) {
      if (url === '/v1/study/summary') return Promise.resolve(summary);
      if (url.startsWith('/v1/study/review-queue')) return Promise.resolve({items:[],stats:{due:0,pinned:0},subjects:[]});
      if (url === '/v1/study/knowledge-graph') return Promise.reject(new Error('404'));
      if (url === '/v1/study/knowledge-graph/relation-tip') {
        const body = JSON.parse((options && options.body) || '{}');
        return Promise.resolve({source:'ai', relationType:body.relationType, relationLabel:'依赖', color:'yellow',
          headline:'这两个知识点是依赖关系', body:'先补先修的那个。', tip:'先写法向量再算二面角。',
          pitfall:'跳过先修直接套公式。', question:'先修那一步会了吗？', relatedCases:[{id:'shared-question',question:'一道题'}]});
      }
      return Promise.resolve({});
    },
    render(){feature.renderStudy(root);}
  };
  feature.activate(app);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.doesNotMatch(root.innerHTML, /data-kg-subject=/, '知识网络跟随顶部「先选要复习的科目」，不再自带学科标签页');
  assert.match(source, /resize:vertical/, 'graph viewport can be resized by dragging its bottom edge');
  assert.match(source, /width:100%;height:auto;max-width:100%/, 'graph SVG scales to the available screen width');
  assert.match(source, /window\.innerWidth/, 'graph layout uses the current viewport width');
  assert.equal((root.innerHTML.match(/data-kg-node=/g) || []).length, points.length);
  assert.match(root.innerHTML, /kg-edge-related/);
  assert.match(root.innerHTML, /立体几何/);
  assert.match(root.innerHTML, /二面角/);
  assert.match(root.innerHTML, /点到平面的距离/);
  assert.doesNotMatch(root.innerHTML, /kg-exam-label/, 'exam frequency labels stay out of the way until the student selects a node or edge');
  const relatedEdge = root.querySelectorAll('[data-kg-edge]').find(edge=>edge.dataset.kgEdge.startsWith('heat-related-'));
  assert.ok(relatedEdge, 'fallback graph provides curriculum relationship edges');
  const relatedNodeId = 'heat-' + relatedEdge.dataset.kgEdge.split('-').slice(-2)[0];
  const relatedNode = root.querySelectorAll('[data-kg-node]').find(node=>node.dataset.kgNode===relatedNodeId);
  relatedNode.onclick();
  assert.match(root.innerHTML, /kg-edge-active/, 'selecting a node highlights its connected edges');
  /* 三类关系的图例必须在，颜色是学生唯一的分辨依据 */
  assert.match(root.innerHTML, /依赖：B 没掌握/, '依赖关系要有黄色图例');
  assert.match(root.innerHTML, /易混淆：这两个老搞混/, '易混淆要有红色图例');
  assert.match(root.innerHTML, /常结合：考试经常一起出现/, '常结合要有绿色图例');
  assert.match(root.innerHTML, /线越粗 = 一起考得越多/, '要说明线粗细的含义');
  /* 点一条线：给出这两个知识点怎么一起用的提示卡 */
  const edgeToClick = root.querySelectorAll('[data-kg-edge]').find(edge=>edge.dataset.kgEdge===relatedEdge.dataset.kgEdge);
  edgeToClick.onclick();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(root.innerHTML, /data-kg-tip/, '点线后应出现提示卡区块');
  assert.match(root.innerHTML, /这两个知识点是依赖关系/, '点线要展示 AI 衔接提示卡');
  assert.match(root.innerHTML, /先写法向量再算二面角/, '提示卡要给出可照做的技巧');
  assert.match(root.innerHTML, /data-kg-tip-import/, '提示卡要能一键导入知识闯关');
  assert.match(root.innerHTML, /data-kg-tip-cases/, '提示卡要能跳到相关错题');
  assert.match(root.innerHTML, /AI 按这两个知识点生成的提示/, 'AI 生成成功时不能说成是"没有密钥的兜底"');
  assert.doesNotMatch(root.innerHTML, /当前没有可用的模型密钥/, '密钥是配好的，不许谎报原因');
  const labels=[...root.innerHTML.matchAll(/<g class="kg-node[^\"]*" data-kg-node="[^\"]+"[^>]*>(.*?)<\/g>/g)]
    .map(([,markup])=>{
      const match=markup.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(.*?)<\/text>/);
      assert.ok(match,'every network node must render its label');
      return {x:Number(match[1]),y:Number(match[2]),width:[...match[3]].length*12};
    });
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    if(Math.abs(labels[i].y-labels[j].y)<16){
      assert.ok(Math.abs(labels[i].x-labels[j].x)>=(labels[i].width+labels[j].width)/2+8,
        'knowledge-point labels must not overlap: ' + JSON.stringify([labels[i],labels[j]]));
    }
  }
});
