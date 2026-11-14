import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('vector-projection-sign'),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),sub=(a,b)=>a.map((x,i)=>x-b[i]),norm=a=>Math.hypot(...a),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
const projection=(u,v)=>{const d=dot(v,v);if(!d)throw Error('zero direction');return v.map(x=>x*dot(u,v)/d)};
test('full projection problem connects definitions, orthogonality equation, reversal and legal zero result',()=>{
 assert.equal(l.steps.length,6);assert(l.kind.includes('典型方法'));assert(!l.sourceKey);
 for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.work.length&&s.result&&s.point);}
 assert(l.steps[0].work.join('').includes('定义p=向量OH，q=向量HA'));assert(l.steps[1].work.join('').includes('−4−9t=0'));assert(l.steps[2].work.join('').includes('t=−4/9，α=−4/3，|p|=4/3'));assert(l.steps[5].work.join('').includes('u=0'));
 const html=lib.mathDetail('math-'+l.id);assert(!html.includes('data-diagram-unavailable'));assert(!html.includes('standard-2020-vector-projection'));for(const id of ['S09','S10'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(l.id));
 for(const id of ['plane-normal-distance','space-point-line-distance'])assert(lib.getMathLesson(id).related.some(r=>r.id===l.id));
});
test('independent orthogonal decomposition covers sign, direction reversal, transfer and zero restrictions',()=>{
 const v=[1,2,2],u=[-2,1,-2],p=projection(u,v),q=sub(u,p);
 [-4/9,-8/9,-8/9].forEach((x,i)=>near(p[i],x));[-14/9,17/9,-10/9].forEach((x,i)=>near(q[i],x));
 near(dot(q,v),0);near(norm(p),4/3);near(dot(u,v)/norm(v),-4/3);near(norm(q),Math.sqrt(65)/3);
 const reverse=projection(u,v.map(x=>-x));reverse.forEach((x,i)=>near(x,p[i]));near(dot(u,v.map(x=>-x))/norm(v),4/3);
 const transfer=projection(u.map(x=>-x),v);transfer.forEach((x,i)=>near(x,-p[i]));near(norm(transfer),norm(p));
 for(const a of [[0,0,0],[2,-1,0],[1,2,2],[-2,4,1],[4,-3,2]]){const b=projection(a,v),r=sub(a,b);near(dot(r,v),0);near(dot(b,r),0);near(norm(a)**2,norm(b)**2+norm(r)**2);}
 assert.deepEqual(projection([2,-1,0],v),[0,0,0]);assert.throws(()=>projection(u,[0,0,0]),/zero direction/);
});
test('SVG is a true OAB plane section with orthogonal foot and no premature H; source frequencies stay unchanged',()=>{
 const original=lib.mathFigure(l,{stage:0},true);assert(!original.includes('>H</text>'));assert(!original.includes('>p</text>'));assert(!original.includes('>q</text>'));
 const figure=lib.mathFigure(l,{stage:4});const points=[...figure.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[+m[1],+m[2]]),[O,A,B,H]=points;
 near(norm(sub(O,B)),180);near(norm(sub(O,A)),180);near(norm(sub(O,H))/60,4/3);near(norm(sub(H,A))/60,Math.sqrt(65)/3);near(dot(sub(H,A),sub(B,O)),0);
 assert(figure.includes('>q</text>'));assert(!lib.mathFigure(l,{stage:2}).includes('>q</text>'));assert(lib.mathFigure(l,{stage:5}).includes('α′=4/3'));
 for(const s of l.steps)assert(!/NaN|undefined/.test(lib.mathFigure(l,s.visual)));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
