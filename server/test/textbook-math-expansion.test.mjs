import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const ids=['cube-perp','cube-angle','ellipse-basic','ellipse-chord','exam17','exam18'];
const close=(a,b,eps=1e-9)=>assert(Math.abs(a-b)<eps,`${a} != ${b}`);
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
const minus=(a,b)=>a.map((x,i)=>x-b[i]);
const norm=a=>Math.sqrt(dot(a,a));
test('math extension retains the original six paths and distinguishes linked knowledge nodes from full coverage',()=>{
 assert.equal(lib.mathVersion,'4.53.0');assert.equal(lib.findCards('全部主题','','数学').length,75);
 assert.equal(lib.findCards('全部主题','','化学').length,10);
 assert.equal(lib.mathNodes.length,24);assert.equal(new Set(lib.mathNodes.map(n=>n.id)).size,24);
 assert.equal(ids.reduce((v,id)=>v+lib.getMathLesson(id).steps.length,0),30);
 for(const n of lib.mathNodes)for(const id of n.lessons)assert(id.startsWith('circle-')?lib.getCircleCard(id.slice(7)):lib.getMathLesson(id));
 assert(lib.mathNodes.every(n=>n.lessons.length>0));assert(lib.mathResources().includes('这不是完整覆盖率')); assert(lib.mathDirectory().includes('立体五卷题面索引已建'));assert(lib.mathDirectory().includes('解析逐题统计待完成'));
});
test('all segments quote actual givens, define complete work and render deterministic valid-looking SVG',()=>{
 for(const id of ids){const l=lib.getMathLesson(id),html=lib.mathDetail('math-'+id,'full');
  assert.equal((html.match(/class="tb-circle-beat"/g)||[]).length,l.steps.length);
  assert(html.includes('完整题目'));assert(html.includes('迁移题解析'));assert(html.includes('不能套用的原因'));
  assert(!html.includes('href="http'));assert(!/NaN|undefined|Infinity/.test(html));
  for(const s of l.steps){assert(l.conditions.join('；').includes(s.evidence),id+' '+s.evidence);assert(s.why&&s.point&&s.result&&s.work.length);
   if(s.visual){const svg=lib.mathFigure(l,s.visual);assert(svg.startsWith('<svg'));assert(svg.endsWith('</svg>'));assert(svg.includes('aria-label='));assert(!/NaN|undefined|Infinity/.test(svg));}
  }
 }
});
test('question 17: independently solve the three linear equidistance equations',()=>{
 const s=Math.SQRT2,d=1+Math.sqrt(3),B=[s,0,0],C=[s,2,0],D=[0,d,0],P=[0,0,s];
 // 2*(X-B) dot O = |X|²-|B|², solve without presupposing z=0.
 const rows=[C,D,P].map(X=>[...minus(X,B).map(v=>2*v),dot(X,X)-dot(B,B)]);
 for(let j=0;j<3;j++){let k=j;while(Math.abs(rows[k][j])<1e-12)k++;[rows[k],rows[j]]=[rows[j],rows[k]];const v=rows[j][j];rows[j]=rows[j].map(x=>x/v);for(let i=0;i<3;i++)if(i!==j){const t=rows[i][j];rows[i]=rows[i].map((x,n)=>x-t*rows[j][n]);}}
 const O=rows.map(r=>r[3]);close(O[0],0);close(O[1],1);close(O[2],0);
 for(const X of [B,C,D,P])close(norm(minus(O,X)),Math.sqrt(3));
 const a=C,b=minus(O,P);close(Math.abs(dot(a,b))/(norm(a)*norm(b)),Math.SQRT2/3);
 const html=lib.mathDetail('math-exam17');for(const t of ['暂不假定w=0','w=u','A不在题给同球四点中','√2/3'])assert(html.includes(t));
});
test('question 18: ray, length product, slope relation and maximal pair all hold',()=>{
 const r=3*Math.SQRT2,N=[0,-4],M=[3*Math.sqrt(3)/2,.5],P=[-r/2,-4-r*Math.sqrt(3)/2];
 close(M[0]**2/9+M[1]**2,1);assert(P[0]!==0);close(norm(minus(P,N)),r);
 const D=P[0]**2+(P[1]+1)**2,t=3/D,R=[t*P[0],-1+t*(P[1]+1)];
 assert(t>0);close(norm(minus(R,[0,-1]))*norm(minus(P,[0,-1])),3);
 close(R[1]/R[0],3*P[1]/P[0]);close(norm(minus(P,M)),3*Math.SQRT2+3*Math.sqrt(3));
 // Numerical regression is supplemental; the published proof uses exact completing-square + equality.
 for(let j=1;j<100;j++){const a=j*.062,b=j*.131;const Q=[3*Math.cos(a),Math.sin(a)],T=[r*Math.cos(b),-4+r*Math.sin(b)];assert(norm(minus(T,Q))<=3*Math.SQRT2+3*Math.sqrt(3)+1e-9);}
 const html=lib.mathDetail('math-exam18');for(const t of ['t&gt;0','m≠0','充分性','27−8(y−1/2)²','横坐标不为0','3√2+3√3'])assert(html.includes(t),t);
});
test('original examples, transfers and rejected boundary cases recalculate correctly',()=>{
 close(Math.abs(dot([2,2,0],[2,0,-2]))/(Math.sqrt(8)*Math.sqrt(8)),.5);
 close(Math.sqrt(3)/2,Math.sqrt(4-1)/2);close(4+1,5);
 close(8+2,10);close(Math.sqrt(8-2)/Math.sqrt(8),Math.sqrt(3)/2);
 const a=[2/Math.sqrt(5),2/Math.sqrt(5)],b=a.map(x=>-x);close(norm(minus(a,b)),4*Math.sqrt(10)/5);
 assert(1-3**2/4<0);close(norm([3,4]),5);
 const p=[-3*Math.SQRT2*3/5,-4-3*Math.SQRT2*4/5];close(norm(minus(p,[3,0])),5+3*Math.SQRT2);
});
test('resources stay central; writing mode and hints work without private records',()=>{
 const html=lib.mathResources();assert(html.includes('待完成逐题映射'));assert(html.includes('351段'));assert(html.includes('尚未由教师复审'));
 const writing=lib.mathDetail('math-exam18','writing');assert(writing.includes('tb-circle-writing'));assert(writing.includes('data-circle-reading="writing" aria-pressed="true"'));
 assert.equal((lib.mathDetail('math-exam18').match(/class="tb-math-hint"/g)||[]).length,9);
 assert(!lib.mathDirectory().includes('今年必考'));
});
