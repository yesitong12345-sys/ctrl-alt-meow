import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
test('point-plane distance agrees with scalar triple product over area, and its foot lies in the actual triangle',()=>{
 const q=lib.getMathLesson('plane-normal-distance'),{O,A,B,C,H}=q.mesh.points,n=cross(sub(B,A),sub(C,A));
 near(Math.abs(dot(sub(O,A),n))/norm(n),2/Math.sqrt(3));near(dot(sub(H,A),n),0);near(norm(sub(H,O)),2/Math.sqrt(3));
 for(let i=0;i<3;i++)near(H[i],(A[i]+B[i]+C[i])/3);
 assert(q.steps[3].work[0].includes('n·AX=0'));assert(q.prerequisites.some(x=>x.includes('拓展衔接')));
 const scale=lib.getMathLesson('normal-scale-distance').normalPoints,nn=cross(sub(scale.B,scale.A),sub(scale.C,scale.A));near(Math.abs(dot(sub(scale.O,scale.A),nn))/norm(nn),2);near(dot(sub(scale.H,scale.A),nn),0);
});
test('cross-product point-line distance and constrained endpoints give different distances',()=>{
 const {A,B,P,H}=lib.getMathLesson('space-point-line-distance').distancePoints,u=sub(B,A),v=sub(P,A);
 near(norm(cross(v,u))/norm(u),Math.sqrt(17));near(dot(sub(H,P),u),0);near(norm(sub(P,B)),Math.sqrt(19));
 for(const s of [-3,0,.5,1,1.5,2,4]){const Q=A.map((a,i)=>a+s*u[i]);near(norm(sub(P,Q))**2,17+8*(s-1.5)**2);if(s>=0&&s<=1)assert(norm(sub(P,Q))>=Math.sqrt(19)-1e-9);}
 const d=lib.getMathLesson('parallel-plane-distance').planeDistance;near(dot(d.normal,d.A),6);near(dot(d.normal,d.H),12);near(norm(sub(d.H,d.A)),2);near(dot(d.normal,d.X),6);near(dot(d.normal,d.K),12);near(norm(sub(d.K,d.X)),2);
});
test('new hidden auxiliary segments are dashed without contaminating unrelated shared tetrahedra',()=>{
 for(const [id,edge] of [['plane-normal-distance',['O','H']],['cube-skew-distance',['P','Q']]]){
  const q=lib.getMathLesson(id),project=([x,y,z])=>[205+62*x-43*y,260-13*x-24*y-75*z];
  assert.deepEqual(q.mesh.occluded,[edge.join('-')]);let seen=0;
  for(const step of q.steps.filter(s=>s.visual)){const svg=lib.mathFigure(q,step.visual),d='M'+project(q.mesh.points[edge[0]]).join(' ')+'L'+project(q.mesh.points[edge[1]]).join(' ');for(const [path] of svg.matchAll(/<path[^>]+>/g))if(path.includes('d="'+d+'"')){seen++;assert(path.includes('stroke-dasharray="6 5"'));}}
  assert(seen>0,id);
 }
 assert.deepEqual(lib.getMathLesson('tetra-equal-volume').mesh.occluded,['A-M']);
});
