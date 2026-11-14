import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),ids=['cube-angle','cube-angle-translate','cube-line-plane-angle','tetra-dihedral','exam2022-9'];
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),norm=a=>Math.hypot(...a),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('parallel translation, triangle cosine and unsigned vector cosine agree including reverse directions',()=>{
 for(const [x,y,z,expected] of [[2,2,2,.5],[5,5,5,.5],[2,4,2,1/Math.sqrt(10)]]){const A=[0,0,0],B=[x,0,0],C=[x,y,0],Ap=[0,0,z],Cp=[x,y,z],u=sub(C,A),v=sub(B,Ap);near(norm(cross(u,sub(Cp,Ap))),0);const a=norm(sub(B,Ap)),b=norm(sub(Cp,Ap)),c=norm(sub(Cp,B));near((a*a+b*b-c*c)/(2*a*b),expected);for(const sign of [1,-1])near(Math.abs(dot(u,v.map(x=>sign*x)))/(norm(u)*norm(v)),expected);}
});
test('line-plane sine handles oblique, parallel, contained and perpendicular projection without confusing normals',()=>{
 const n=[0,0,1];for(const [u,expected] of [[[2,2,2],1/Math.sqrt(3)],[[2,0,0],0],[[0,0,2],1]])near(Math.abs(dot(u,n))/norm(u),expected);
 // The same direction has different position relations at z=0 versus z=2.
 near(dot([0,0,0],n),0);assert.notEqual(dot([0,0,2],n),0);const l=lib.getMathLesson('cube-line-plane-angle');assert(l.steps[5].work.join('').includes('包含'));assert(l.steps[6].work.join('').includes('仅为点A'));assert(l.steps[7].optional);
});
test('dihedral cosine from three sides agrees with same-origin perpendicular rays and changes sign on reversal',()=>{
 for(const a of [2,3,5]){const A=[a,0,0],B=[0,a,0],C=[0,0,a],O=[0,0,0],M=[0,a/2,a/2],ma=sub(A,M),mo=sub(O,M),bc=sub(C,B);near(dot(ma,bc),0);near(dot(mo,bc),0);const cosine=dot(ma,mo)/(norm(ma)*norm(mo));near(cosine,1/Math.sqrt(3));near((norm(ma)**2+norm(mo)**2-a*a)/(2*norm(ma)*norm(mo)),cosine);near(dot(ma.map(x=>-x),mo)/(norm(ma)*norm(mo)),-cosine);}
 assert(lib.getMathLesson('tetra-dihedral').steps[4].work.join('').includes('−√3/3'));
});
test('2022 options use separate target objects and the two line-plane angles differ',()=>{
 for(const a of [.5,2,5]){const u=[0,a,a],da1=[0,-a,a],ca1=[-a,-a,a],n=[1,1,0];near(dot(u,da1),0);near(dot(u,ca1),0);near(Math.abs(dot(u,n))/(norm(u)*norm(n)),.5);near(Math.abs(u[2])/norm(u),Math.SQRT1_2);const ac1=[a,a,a];near(Math.abs(dot(ac1,n))/(norm(ac1)*norm(n)),Math.sqrt(2/3));}
});
test('hidden auxiliary segments are dashed without changing independently verified boundary-edge masks',()=>{
 for(const id of ['cube-angle-translate','cube-line-plane-angle','tetra-dihedral','exam2022-9']){const l=lib.getMathLesson(id),m=l.mesh,pr=m.projection||{origin:[205,260],x:[62,-13],y:[-43,-24],z:[0,-75]},project=p=>pr.origin.map((x,i)=>x+pr.x[i]*p[0]+pr.y[i]*p[1]+pr.z[i]*p[2]);
  for(const edge of m.occluded){const [a,b]=edge.split('-');let matches=0;for(const s of l.steps.filter(s=>s.visual)){const svg=lib.mathFigure(l,s.visual),d='M'+project(m.points[a]).join(' ')+'L'+project(m.points[b]).join(' '),reverse='M'+project(m.points[b]).join(' ')+'L'+project(m.points[a]).join(' ');for(const [path] of svg.matchAll(/<path[^>]+>/g))if(path.includes('d="'+d+'"')||path.includes('d="'+reverse+'"')){matches++;assert(path.includes('stroke-dasharray="6 5"'),id+':'+edge);}}assert(matches>0,id+':'+edge);}
 }
 const main=lib.getMathLesson('cube-line-plane-angle');assert(main.steps[0].visual.active.some(([a,b])=>a==='A'&&b==='C′'));assert.deepEqual(lib.getMathLesson('plane-normal-distance').mesh.occluded,['O-H']);assert.deepEqual(lib.getMathLesson('tetra-equal-volume').mesh.occluded,['A-M']);
});
test('all complete questions, optional prerequisites, subjects and source frequencies survive the audit',()=>{
 for(const id of ids){const l=lib.getMathLesson(id);assert(l.conditions.length&&l.transfer&&l.counter);for(const s of l.steps)assert(l.conditions.join('').includes(s.evidence));assert(!lib.mathDetail('math-'+id).includes('data-diagram-unavailable'));}
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);assert(lib.mathResources().includes('351段'));
});
