import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),norm=a=>Math.hypot(...a),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('independent linear sphere system has unique center, correct four radii and the unsigned line angle',()=>{
 const s=Math.SQRT2,d=1+Math.sqrt(3),P=[0,0,s],B=[s,0,0],C=[s,2,0],D=[0,d,0];
 // Subtract each squared-distance equation from the P equation and row-reduce.
 const rows=[B,C,D].map(Q=>[...sub(Q,P).map(x=>2*x),dot(Q,Q)-dot(P,P)]);
 for(let col=0;col<3;col++){const pivot=rows.findIndex((r,i)=>i>=col&&Math.abs(r[col])>1e-10);assert(pivot>=0);[rows[col],rows[pivot]]=[rows[pivot],rows[col]];const n=rows[col][col];rows[col]=rows[col].map(x=>x/n);for(let j=0;j<3;j++)if(j!==col){const k=rows[j][col];rows[j]=rows[j].map((x,i)=>x-k*rows[col][i]);}}
 const O=rows.map(r=>r[3]);for(let i=0;i<3;i++)near(O[i],[0,1,0][i]);for(const Q of [P,B,C,D])near(norm(sub(O,Q))**2,3);near(norm(O),1);assert.notEqual(norm(O),Math.sqrt(3));
 const ac=C,po=sub(O,P);near(Math.abs(dot(ac,po))/(norm(ac)*norm(po)),Math.SQRT2/3);near(Math.abs(dot(ac,po.map(x=>-x)))/(norm(ac)*norm(po)),Math.SQRT2/3);
});
test('rear-face PO is dashed only after O is defined; question identity and source counts remain',()=>{
 const q=lib.getMathLesson('exam17');for(const step of q.steps.filter(s=>s.visual?.center)){const svg=lib.mathFigure(q,step.visual),path=[...svg.matchAll(/<path[^>]+>/g)].map(x=>x[0]).find(x=>x.includes('d="M149 54L240.5 231"'));assert(path?.includes('stroke-dasharray="6 5"'));}
 for(const step of q.steps.slice(0,5).filter(s=>s.visual))assert(!lib.mathFigure(q,step.visual).includes('>O</text>'));
 assert.equal(q.sourceKey,'gaokao-2025-I-17');assert.equal(q.conditions.length,5);assert(q.trap.includes('A不在'));assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
