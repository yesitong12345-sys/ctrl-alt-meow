import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('2021 actual same-edge rays recover height and whole-base volume for both stated angles',()=>{
 const r=Math.sqrt(3),B=[-1,0,0],C=[.5,r/2,0],D=[1,0,0],F=[1/3,0,0],H=[0,r/3,0],bc=sub(C,B),hf=sub(F,H);
 near(dot(hf,bc),0);near(norm(hf),2/3);assert(dot(hf,sub(D,H))>0);
 for(const [h,theta,V] of [[1,Math.PI/4,r/6],[r,Math.PI/3,.5]]){const A=[0,0,h],E=[1/3,0,2*h/3],he=sub(E,H);near(dot(he,bc),0);near(dot(he,hf)/(norm(he)*norm(hf)),Math.cos(theta));near(norm(sub(E,D)),2*norm(sub(E,A)));near(Math.abs(dot(sub(A,B),cross(bc,sub(D,B))))/6,V);}
 const q=lib.getMathLesson('exam2021-20');assert(!q.steps.slice(0,2).some(s=>s.work.join('').includes('DE=2EA')));assert.equal(q.sourceKey,'gaokao-2021-I-20');
});
test('2022 distance is independent of second-question assumptions; oriented rays give 120 degrees',()=>{
 for(const [base,height] of [[2,2],[4,1],[1,4]])near((base*height/3)*3/(2*Math.SQRT2),Math.SQRT2);
 const p=lib.getMathLesson('exam2022-19').mesh.points,u=sub(p.D,p.B),ha=sub(p.A,p.H),hc=sub(p.C,p.H);near(dot(ha,u),0);near(dot(hc,u),0);near(dot(ha,hc)/(norm(ha)*norm(hc)),-.5);near(norm(cross(ha,hc))/(norm(ha)*norm(hc)),Math.sqrt(3)/2);
 const n=cross(sub(p.B,p['A₁']),sub(p.C,p['A₁']));near(Math.abs(dot(sub(p.A,p['A₁']),n))/norm(n),Math.SQRT2);near(dot(n,[0,1,0]),0);
 const q=lib.getMathLesson('exam2022-19');assert(q.steps[0].point.includes('不借用第二问'));assert(q.steps[2].work.join('').includes('C=(x,y,0)'));assert.equal(q.sourceKey,'gaokao-2022-I-19');
});
test('interior and hidden-face angle constructions stay dashed in each actual rendered step',()=>{
 for(const id of ['exam2021-20','exam2022-19']){const q=lib.getMathLesson(id),m=q.mesh,pr=m.projection,project=v=>pr.origin.map((x,i)=>x+pr.x[i]*v[0]+pr.y[i]*v[1]+pr.z[i]*v[2]);for(const key of m.occluded){const [a,b]=key.split('-'),d='d="M'+project(m.points[a]).join(' ')+'L'+project(m.points[b]).join(' ')+'"';let seen=0;for(const s of q.steps.filter(s=>s.visual))for(const [path] of lib.mathFigure(q,s.visual).matchAll(/<path[^>]+>/g))if(path.includes(d)){seen++;assert(path.includes('stroke-dasharray="6 5"'));}assert(seen>0,key);}}
 assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
