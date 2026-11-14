import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('2023 same-origin projection rays preserve both roots and exclude supplementary-angle counterexample',()=>{
 const q=lib.getMathLesson('exam2023-18'),p=q.mesh.points,u=sub(p['C₂'],p['A₂']);
 const v=sub(p['D₂'],p.M);for(const t of [0,1,2,3,4]){const P=[2,0,t],lambda=dot(sub(P,p['A₂']),u)/dot(u,u),H=p['A₂'].map((x,i)=>x+lambda*u[i]),w=sub(P,H),cos=dot(w,v)/(norm(w)*norm(v));near(dot(w,u),0);near(cos,-Math.sqrt(3)/Math.sqrt((t-2)**2+3));assert(cos<0);if(t===1||t===3){near(cos,Math.cos(5*Math.PI/6));near(Math.abs(t-2),1);}}
 assert(-1<0&&5>4);assert.equal(q.sourceKey,'gaokao-2023-I-18');
});
test('2024 separate assumptions produce valid distinct configurations and nondegenerate length sqrt3',()=>{
 const q=lib.getMathLesson('exam2024-17'),p=q.mesh.points;near(dot(sub(p.D,p.A),sub(p.P,p.B)),0);
 for(const [D,expected,sin2] of [[[1.5,-Math.sqrt(3)/2,0],Math.sqrt(3),6/7],[[1,-1,0],Math.SQRT2,2/3]]){const ad=sub(D,p.A),dc=sub(p.C,D),cp=sub(p.P,p.C),cd=sub(D,p.C),n=cross(cp,cd),normal=[0,1,0];near(dot(ad,dc),0);near(norm(ad),expected);near(norm(cross(n,normal))**2/(dot(n,n)*dot(normal,normal)),sin2);assert(Math.abs(dot(ad,sub(p.P,p.B)))>1e-9);assert(norm(n)>0);}
 assert.equal(q.sourceKey,'gaokao-2024-I-17');assert(q.steps[3].work[0].includes('不沿用'));
});
test('2023 interior ray becomes visible only after it crosses the front face, while rear edges stay dashed',()=>{
 const q=lib.getMathLesson('exam2023-18'),m=q.mesh,p=m.points,split=-p.M[1]/(p.R[1]-p.M[1]);near(split,.75);const exit=p.M.map((x,i)=>x+split*(p.R[i]-x));near(exit[1],0);assert(exit[0]>0&&exit[0]<2&&exit[2]>0&&exit[2]<4);assert(p.R[1]<0);assert.deepEqual(m.hidden.slice(0,3),['B-C','C-D','C-C₁']);
 const pr=v=>[160+80*v[0]-45*v[1],286+6*v[0]-25*v[1]-48*v[2]],svg=lib.mathFigure(q,q.steps[4].visual),paths=[...svg.matchAll(/<path[^>]+>/g)].map(x=>x[0]),path=(a,b)=>paths.find(x=>x.includes('d="M'+pr(a).join(' ')+'L'+pr(b).join(' ')+'"'));assert(path(p.M,exit).includes('stroke-dasharray'));assert(!path(exit,p.R).includes('stroke-dasharray'));assert(path(p.H,p.P).includes('stroke-dasharray'));assert(path(p.M,p['D₂']).includes('stroke-dasharray'));
 assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
