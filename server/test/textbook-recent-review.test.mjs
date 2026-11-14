import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
test('近期13卡每段都有对应关系图、条件依据和可访问的文字替代',()=>{
  for(const card of lib.findRecentReviews()){
    const html=lib.recentReviewDetail('review-'+card.id);
    assert.equal((html.match(/data-review-figure=/g)||[]).length,3,card.id+'缺分步关系图');
    assert.equal((html.match(/class="tb-circle-evidence"/g)||[]).length,3,card.id+'缺条件依据');
    assert.equal((html.match(/用文字读这张图/g)||[]).length,3,card.id+'缺图文替代');
    assert(!/NaN|Infinity|undefined/.test(html));
  }
});
test('近期复习13项先于原有路线，筛选搜索独立于真题计频和学科库',()=>{
  const rows=lib.findRecentReviews();assert.equal(rows.length,13);
  assert.equal(rows[0].id,'chord-distance');assert.equal(rows[1].id,'tangent');
  assert.equal(lib.findRecentReviews('立体几何').length,1);
  assert(lib.findRecentReviews('全部主题','垂直 法向').some(c=>c.id==='vector-normal'));
  assert.equal(lib.findRecentReviews('全部主题','不存在xyz').length,0);
  const html=lib.mathDirectory();assert(html.indexOf('tb-recent-review')<html.indexOf('tb-math-learning-routes'));
  assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
  assert.equal([...lib.mathResources().matchAll(/data-exam-source-key=/g)].length,13);
});
test('全部复习卡有完整推理、易错、迁移与辨析，不虚构残缺原题',()=>{
  for(const card of lib.findRecentReviews()){
    assert.equal(card.steps.length,3);assert(card.question&&card.trigger&&card.trap);
    for(const step of card.steps)assert(step.length===4&&step.every(Boolean));
    assert(card.transfer.every(Boolean)&&card.counter.every(Boolean));
    const html=lib.recentReviewDetail('review-'+card.id);
    for(const text of ['data-method-title','关键书写','查看迁移解析','查看辨析','不写入个人学习记录'])assert(html.includes(text));
    assert(!/undefined|NaN/.test(html));
  }
  assert(lib.findRecentReviews().find(c=>c.id==='vector-normal').trap.includes('暂不补造原图'));
  assert(lib.recentReviewDetail('review-chord-distance').includes('r&gt;4相交'));
  assert(lib.recentReviewDetail('review-vector-normal').includes('同批笔记里的其他题'));
});
test('弦长、目标配方和线性式最值独立复算',()=>{
  const d=Math.abs(1-1-2)/Math.sqrt(2);assert(Math.abs(2*Math.sqrt(6-d*d)-4)<1e-12);
  for(const k of [0,-4/3])assert(Math.abs((2*k+1)**2/(k*k+1)-1)<1e-12);
  assert.equal((5-2)**2+4,13);assert.equal((5+2)**2+4,53);
  for(let i=0;i<360;i++){const t=i*Math.PI/180,x=3+2*Math.cos(t),y=3+2*Math.sin(t);assert(x+y>=6-2*Math.SQRT2-1e-12&&x+y<=6+2*Math.SQRT2+1e-12);}
});
test('反射、根轴与法向量条件独立校核',()=>{
  const reflect=([x,y])=>{const t=(3*x-y+3)/10;return [x-6*t,y+2*t];};
  assert.deepEqual(reflect([4,5]),[-2,7]);
  for(const p of [[2,0],[0,-2]]){const [x,y]=reflect(p);assert(Math.abs(y+7*x+22)<1e-12);}
  const h=9/Math.sqrt(34),half=Math.sqrt(9-h*h);assert(Math.abs(2*half-30/Math.sqrt(34))<1e-12);
  // h is the first centre's distance to 5x−3y−4=0. Intersections lie in both circles.
  const foot=[2-5*9/34,-1+3*9/34];
  for(const sign of [-1,1]){const x=foot[0]+sign*3/Math.sqrt(34)*half,y=foot[1]+sign*5/Math.sqrt(34)*half;assert(Math.abs(x*x+y*y-4*x+2*y-4)<1e-10);assert(Math.abs(x*x+y*y+6*x-4*y-12)<1e-10);}
  for(const a of [-1,1])assert.equal(-1+a*a,0);
  assert.equal((3*(-4)+2*3+6),0);assert.equal((2*(-4)+5*3-7),0);
});
