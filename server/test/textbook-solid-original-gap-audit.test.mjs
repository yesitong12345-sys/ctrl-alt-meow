import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('independent scalar triple product excludes coplanarity for all legal interior ratios',()=>{
 const p=lib.getMathLesson('tetra-coplanarity').mesh.points;for(const a of [.2,.5,.8])for(const b of [.2,.5,.8]){const M=p.A.map((x,i)=>x+a*(p.B[i]-x)),N=p.C.map((x,i)=>x+b*(p.D[i]-x));assert(Math.abs(dot(sub(p.C,p.A),cross(sub(N,p.A),sub(M,p.C))))>1e-9);}near(dot(sub(p.C,p.A),cross(sub(p.N,p.A),sub(p.A,p.C))),0);
 const cone=Math.sqrt(25-9);near(cone,4);near(Math.PI*9*cone/3,12*Math.PI);near(Math.PI*3*5,15*Math.PI);
 const h=3,area=z=>(6-4*z/h)**2;near(h*(area(0)+4*area(h/2)+area(h))/6,52);near(Math.hypot(h,2),Math.sqrt(13));near(Math.hypot(h,Math.sqrt(8)),Math.sqrt(17));near(32+40+32,104);
});
test('remaining mesh auxiliary occlusion is local and yields actual dashed paths',()=>{
 for(const id of ['tetra-coplanarity','frustum-height-bridge']){const q=lib.getMathLesson(id),m=q.mesh,pr=m.projection,p=v=>pr.origin.map((x,i)=>x+pr.x[i]*v[0]+pr.y[i]*v[1]+pr.z[i]*v[2]);for(const key of m.occluded){const [a,b]=key.split('-'),d='d="M'+p(m.points[a]).join(' ')+'L'+p(m.points[b]).join(' ')+'"',rev='d="M'+p(m.points[b]).join(' ')+'L'+p(m.points[a]).join(' ')+'"';let seen=0;for(const step of q.steps.filter(s=>s.visual))for(const [path] of lib.mathFigure(q,step.visual).matchAll(/<path[^>]+>/g))if(path.includes(d)||path.includes(rev)){seen++;assert(path.includes('stroke-dasharray'));}assert(seen>0,key);}}
 assert.deepEqual(lib.getMathLesson('tetra-coplanarity').mesh.hidden,['B-C']);assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
