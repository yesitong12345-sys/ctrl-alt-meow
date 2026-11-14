import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('independent arc equations, cross-section integration and common lateral-area relation agree',()=>{
 const r=Math.SQRT2;for(const [angle,l] of [[Math.PI,2*r],[2*Math.PI/3,3*r]])near(angle*l,2*Math.PI*r);
 for(const [side,height,volume] of [[Math.SQRT2,Math.sqrt(6)/2,7*Math.sqrt(6)/6],[Math.sqrt(3),Math.sqrt(10)/2,7*Math.sqrt(10)/6]]){near(side*side,.5+height*height);const area=z=>(2-z/height)**2;near(height*(area(0)+4*area(height/2)+area(height))/6,volume);}
 for(const h of [Math.sqrt(3),2]){const radius=Math.sqrt(3)*h,l=Math.hypot(radius,h);near(l,2*h);near(2*Math.PI*radius*h,Math.PI*radius*l);near(Math.PI*radius*radius*h/3,Math.PI*h**3);}
 assert.notEqual(Math.hypot(1,1),2);
});
test('frustum internal heights and bottom projections stay dashed while the upper-plane radius stays solid',()=>{
 const q=lib.getMathLesson('exam2023-14'),m=q.mesh,pr=m.projection,project=v=>pr.origin.map((x,i)=>x+pr.x[i]*v[0]+pr.y[i]*v[1]+pr.z[i]*v[2]);
 for(const key of m.occluded){const [a,b]=key.split('-'),d='d="M'+project(m.points[a]).join(' ')+'L'+project(m.points[b]).join(' ')+'"',rev='d="M'+project(m.points[b]).join(' ')+'L'+project(m.points[a]).join(' ')+'"';let seen=0;for(const step of q.steps.filter(s=>s.visual))for(const [path] of lib.mathFigure(q,step.visual).matchAll(/<path[^>]+>/g))if(path.includes(d)||path.includes(rev)){seen++;assert(path.includes('stroke-dasharray'));}assert(seen>0,key);}
 const upper='d="M'+project(m.points['O₁']).join(' ')+'L'+project(m.points['A₁']).join(' ')+'"';assert([...lib.mathFigure(q,q.steps[1].visual).matchAll(/<path[^>]+>/g)].some(([p])=>p.includes(upper)&&!p.includes('stroke-dasharray')));
 const c=lib.getMathLesson('exam2024-5');assert(lib.mathFigure(c,c.steps[2].visual).includes('结构示意不按比例'));assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
