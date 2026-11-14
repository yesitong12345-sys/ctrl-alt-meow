import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('ellipse-midpoint-difference'),near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),q=([x,y])=>x*x/4+y*y,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
test('point-difference lesson separates necessary direction, existence, midpoint check and centre multiplicity',()=>{
 assert.equal(l.steps.length,7);assert(!l.sourceKey);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.work.length&&s.result&&s.point);}
 assert(l.steps[0].work.join('').includes('暂不假定横坐标差非零'));assert(l.steps[1].work.join('').includes('没有除以未知坐标差'));assert(l.steps[2].work.join('').includes('与两个端点不同矛盾'));assert(l.steps[3].work.join('').includes('=28>0'));assert(l.steps[4].work.join('').includes('存在且唯一'));assert(l.steps[6].work.join('').includes('0=0'));
 assert(lib.mathNodes.find(n=>n.id==='A10').lessons.includes(l.id));assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id==='E-LINE'));assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('independent metric decomposition verifies endpoints/length, vertical transfer, centre and impossible midpoints',()=>{
 // Q(M+td)=Q(M)+t²Q(d), since the weighted cross term vanishes; solve via a centred chord.
 for(const M of [[.5,.25],[1,0],[0,.5],[-.4,.3]]){
  const d=[-2*M[1],M[0]/2],cross=M[0]*d[0]/4+M[1]*d[1];near(cross,0);assert(q(M)<1);const t=Math.sqrt((1-q(M))/q(d)),A=M.map((x,i)=>x+t*d[i]),B=M.map((x,i)=>x-t*d[i]);
  near(q(A),1);near(q(B),1);near((A[0]+B[0])/2,M[0]);near((A[1]+B[1])/2,M[1]);assert(dist(A,B)>0);
  if(M[0]===.5){near(A[0]+2*A[1],1);near(B[0]+2*B[1],1);near(dist(A,B),Math.sqrt(35)/2);}
  if(M[0]===1){near(A[0],1);near(B[0],1);near(dist(A,B),Math.sqrt(3));}
 }
 const r=Math.sqrt(7),A=[(1+r)/2,(1-r)/4],B=[(1-r)/2,(1+r)/4];near(q(A),1);near(q(B),1);near(dist(A,B),Math.sqrt(35)/2);near((A[0]+B[0])/2,.5);near((A[1]+B[1])/2,.25);near(-.5*(.25/.5),-.25);
 for(const d of [[1,0],[0,1],[1,.5],[1,-.7]]){const t=1/Math.sqrt(q(d)),A=d.map(x=>t*x),B=d.map(x=>-t*x);near(q(A),1);near(q(B),1);near(A[0]+B[0],0);near(A[1]+B[1],0);}near(q([2,0]),1);assert(q([3,0])>1);
});
test('actual SVG delays line/endpoints, preserves equal scale and shows valid centre chords',()=>{
 const circles=svg=>[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[+m[1],+m[2]]),coord=p=>[(p[0]-230)/60,(170-p[1])/60];
 for(let stage=0;stage<=7;stage++){
  const svg=lib.mathFigure(l,{stage},stage===0),pts=circles(svg);assert(svg.includes('rx="120" ry="60"'));assert(!/NaN|undefined/.test(svg));assert.equal(pts.length,stage===7?1:stage>=4?4:2);
  if(stage<3){assert(!svg.includes('stroke="#075D49"'));assert(!svg.includes('>A</text>'));}
  if(stage>=4&&stage<=6){const [A,B]=pts.slice(2).map(coord);near(q(A),1);near(q(B),1);near(A[0]+2*A[1],1);near(B[0]+2*B[1],1);near(dist(A,B),Math.sqrt(35)/2);}
  if(stage===7){assert(!svg.includes('M(1/2,1/4)'));const lines=[...svg.matchAll(/<path d="M([\d.\-]+) ([\d.\-]+)L([\d.\-]+) ([\d.\-]+)" stroke="#075D49"/g)];assert.equal(lines.length,4);for(const m of lines){const A=coord([+m[1],+m[2]]),B=coord([+m[3],+m[4]]);near(q(A),1);near(q(B),1);near(A[0]+B[0],0);near(A[1]+B[1],0);}}
 }
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
});
