import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('exam2021-14'),near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),dot=(a,b)=>a[0]*b[0]+a[1]*b[1],sub=(a,b)=>a.map((x,i)=>x-b[i]);
test('complete original fill question defines Q, checks slope denominators and both branches before concluding',()=>{
 assert.equal(l.sourceKey,'gaokao-2021-I-14');assert.equal(l.conditions.length,1);assert.equal(l.steps.length,7);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.work.length&&s.point&&s.result);}
 assert(l.steps[2].work[0].includes('定义Q=(q,0)'));assert(l.steps[2].work.join('').includes('如果q=p/2'));assert(l.steps[4].work.join('').includes('|2p|'));assert(l.steps[6].work.join('').includes('k_{OP}=−2'));assert(l.steps[5].result.includes('x=−3/2'));
 for(const id of ['A01','A08'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(l.id));assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id==='A08'));
});
test('independent vector and altitude calculations verify p, directrix, both signs, transfer and missing-condition counterexample',()=>{
 for(const p of [.5,1,2,3,4,7])for(const sign of [-1,1]){
  const O=[0,0],F=[p/2,0],P=[p/2,sign*p],Q=[5*p/2,0];near(P[1]**2,2*p*P[0]);near(P[0],F[0]);near(dot(sub(P,O),sub(Q,P)),0);near(Q[0]-F[0],2*p);assert(P[0]!==0&&Q[0]!==P[0]);
  near(P[1]**2,(F[0]-O[0])*(Q[0]-F[0])); // right-triangle altitude theorem, independent of slope manipulation
 }
 const p=6/2;near(p,3);near(-p/2,-1.5);near(p*p,(p/2)*6);const transfer=8/2;near(transfer,4);near(-transfer/2,-2);
 const O=[0,0],F=[1,0],P=[1,2],Q=[7,0];near(P[1]**2,4*P[0]);near(Q[0]-F[0],6);assert(dot(sub(P,O),sub(Q,P))!==0);
});
test('actual diagrams satisfy given perpendicularity/curve, reveal numerical labels and directrix only after calculation',()=>{
 const pts=svg=>[...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[(+m[1]-70)/36,(170-+m[2])/36]);
 for(let stage=0;stage<=7;stage++){
  const svg=lib.mathFigure(l,{stage},stage===0),[O,F,P,Q]=pts(svg);near(P[1]**2,6*P[0]);near(P[0],F[0]);near(Q[0]-F[0],6);near(dot(sub(P,O),sub(Q,P)),0);assert.equal(P[1]<0,stage===7);assert(!/NaN|undefined/.test(svg));
  assert.equal(svg.includes('>l</text>'),stage>=6);assert.equal(svg.includes('Q(15/2,0)'),stage>=6);if(stage<6){assert(!svg.includes('P(3/2'));assert(!svg.includes('x=−3/2'));}
  const curve=svg.match(/<path d="([^"]+)" fill="none" stroke="#2358B8" stroke-width="2.5"/);assert(curve);for(const [,xx,yy]of curve[1].matchAll(/[ML]([\d.\-]+) ([\d.\-]+)/g)){const x=(+xx-70)/36,y=(170-+yy)/36;near(y*y,6*x);}
 }
 const html=lib.mathResources();assert.equal((html.match(/data-analytic-source-key=/g)||[]).length,12);assert(html.includes('math-exam2021-14'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
