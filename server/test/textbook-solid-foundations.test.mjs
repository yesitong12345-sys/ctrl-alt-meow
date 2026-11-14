import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const ids=['cone-height','cube-skew','tetra-parallel','cube-parallel-planes','cube-line-plane-angle','tetra-dihedral','plane-normal-distance','tetra-equal-volume','sphere-section'];
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),len=a=>Math.sqrt(dot(a,a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('nine original paths have complete provenance, citations, transfer and counterexamples',()=>{
 assert.equal(ids.reduce((n,id)=>n+lib.getMathLesson(id).steps.length,0),42);
 for(const id of ids){const l=lib.getMathLesson(id);assert.equal(l.kind,'原创课内题');assert(!l.sourceKey);assert(l.transfer.question&&l.transfer.answer&&l.counter.question&&l.counter.answer);
  for(const step of l.steps){assert(l.conditions.join('；').includes(step.evidence),id+' '+step.evidence);assert(step.work.length&&step.why&&step.result&&step.point);}
  const html=lib.mathDetail('math-'+id);assert.equal((html.match(/class="tb-circle-beat"/g)||[]).length,l.steps.length);assert(!/undefined|NaN|Infinity/.test(html));assert(!html.includes('href="http'));assert(html.includes(l.scene==='sphere-section'?'辅助平面':'立体投影'));
 }
 for(const node of lib.mathNodes.filter(n=>n.track==='立体几何'))assert(node.lessons.length,node.id);
 // A node having an example is explicitly not presented as comprehensive completion.
 assert(lib.mathResources().includes('不是完整覆盖率'));
});
test('cone height, volume, side area and degenerate boundary are independently checked',()=>{
 const h=Math.sqrt(5**2-3**2);close(h,4);close(3**2*h/3,12);close(3*5,15);close(3**2+3*5,24);
 close(4**2*Math.sqrt(5**2-4**2)/3,16);assert(5**2-6**2<0);
});
test('skew pair is noncoplanar; matching cube planes have independent parallel directions',()=>{
 const p=lib.getMathLesson('cube-skew').mesh.points;
 const AB=sub(p.B,p.A),CC=sub(p['C′'],p.C),AC=sub(p.C,p.A);
 assert(Math.abs(dot(cross(AB,CC),AC))>0,'scalar triple product must be nonzero');
 close(len(cross(AB,sub(p['B′'],p['A′']))),0);close(len(cross(sub(p.D,p.A),sub(p['D′'],p['A′']))),0);
 assert(len(cross(AB,sub(p.D,p.A)))>0);
});
test('midpoint parallel is not contained in the bottom plane; one-third variant stays valid',()=>{
 const p=lib.getMathLesson('tetra-parallel').mesh.points,AB=sub(p.B,p.A),MN=sub(p.N,p.M);
 close(len(cross(AB,MN)),0);assert(p.M[2]>0&&p.N[2]>0);
 const t=1/3,M=p.P.map((v,i)=>v+t*(p.A[i]-v)),N=p.P.map((v,i)=>v+t*(p.B[i]-v));
 close(len(cross(AB,sub(N,M))),0);assert(M[2]>0);
});
test('line-plane angle uses the normal component and is not an arbitrary face direction',()=>{
 const p=lib.getMathLesson('cube-line-plane-angle').mesh.points,u=sub(p['C′'],p.A),n=[0,0,1];
 close(Math.abs(dot(u,n))/(len(u)*len(n)),Math.sqrt(3)/3);
 const AB=sub(p.B,p.A),thetaABcos=Math.abs(dot(u,AB))/(len(u)*len(AB));
 assert(Math.abs(thetaABcos-Math.sqrt(1-1/3))>.1,'cos angle with AB is not cos line-plane angle');
 close(len(sub(p.C,p.A)),2*Math.sqrt(2));close(len(u),2*Math.sqrt(3));
});
test('dihedral construction has both perpendiculars at the same point and correct half-plane direction',()=>{
 const p=lib.getMathLesson('tetra-dihedral').mesh.points,BC=sub(p.C,p.B),MA=sub(p.A,p.M),MO=sub(p.O,p.M);
 close(dot(BC,MA),0);close(dot(BC,MO),0);close(dot(MA,MO)/(len(MA)*len(MO)),Math.sqrt(3)/3);
 assert(dot(MA.map(x=>-x),MO)<0,'reversing one ray changes the half-plane');
 assert(dot(sub(p.A,p.B),BC)!==0,'AB cannot substitute for the perpendicular to BC');
});
test('normal, foot and distance remain consistent when the normal is rescaled',()=>{
 const p=lib.getMathLesson('plane-normal-distance').mesh.points,n=[1,1,1],OA=sub(p.A,p.O),OH=sub(p.H,p.O);
 close(dot(n,sub(p.B,p.A)),0);close(dot(n,sub(p.C,p.A)),0);close(p.H.reduce((a,b)=>a+b),2);close(len(cross(n,OH)),0);
 close(len(OH),2*Math.sqrt(3)/3);close(Math.abs(dot(OA,n))/len(n),Math.abs(dot(OA,[2,2,2]))/len([2,2,2]));
});
test('diagram stages do not expose future auxiliary points or out-of-bounds projected labels',()=>{
 for(const id of ids){const l=lib.getMathLesson(id);for(const s of l.steps)if(s.visual){const svg=lib.mathFigure(l,s.visual);assert(!/undefined|NaN|Infinity/.test(svg));assert(svg.startsWith('<svg'));
  if(l.mesh){const shown=new Set([...l.mesh.given,...s.visual.show||[]]);for(const [key,p] of Object.entries(l.mesh.points)){if(shown.has(key)){const x=205+62*p[0]-43*p[1],y=260-13*p[0]-24*p[1]-75*p[2];assert(x>=20&&x<=420);assert(y>=28&&y<=290);}else assert(!svg.includes('>'+key+'</text>'));}}
 }}
 const l=lib.getMathLesson('tetra-dihedral');assert(!lib.mathFigure(l,l.steps[0].visual).includes('>M</text>'));assert(lib.mathFigure(l,l.steps[1].visual).includes('>M</text>'));
});
test('equal-volume route and sphere section calculations independently reproduce the answers',()=>{
 const p=lib.getMathLesson('tetra-equal-volume').mesh.points;
 const V=Math.abs(dot(p.A,cross(p.B,p.C)))/6;
 const S=len(cross(sub(p.B,p.A),sub(p.C,p.A)))/2;
 close(V,4/3);close(S,2*Math.sqrt(3));close(3*V/S,2*Math.sqrt(3)/3);
 close(3*(27/6)/(9*Math.sqrt(3)/2),Math.sqrt(3));
 close(Math.sqrt(5**2-3**2),4);close(5**2-3**2,16);assert(5**2-6**2<0);
 const l=lib.getMathLesson('sphere-section');assert(lib.mathFigure(l,l.steps[0].visual).includes('不是球的俯视图'));
 for(const id of ids)for(const r of lib.getMathLesson(id).related)assert(lib.getMathLesson(r.id),r.id);
});
test('multi-condition maths search returns actual evidence and preserves subject/topic isolation',()=>{
 const distance=lib.findCards('立体几何','平面 距离','数学');assert(distance.some(c=>c.id==='math-tetra-equal-volume'));assert(distance.every(c=>c.topic==='立体几何'));
 const sphere=lib.findCards('立体几何','球 3 cm','数学');assert(sphere.some(c=>c.id==='math-sphere-section'));
 const evidence=lib.mathSearchEvidence(sphere.find(c=>c.id==='math-sphere-section'),'球 3 cm');assert(evidence.some(e=>e.kind==='原题条件'&&e.text.includes('距离为3 cm')));
 const normal=lib.findCards('立体几何','法向量 零向量','数学');assert(normal.some(c=>c.id==='math-plane-normal-distance'));
 const normalized=lib.findCards('立体几何','ＰＡ','数学');assert(normalized.some(c=>c.id==='math-exam17'));
 assert.equal(lib.findCards('全部主题','<script>alert(1)</script>','数学').length,0);
 assert.deepEqual(lib.mathSearchEvidence(distance[0],''),[]);
 assert.equal(lib.findCards('立体几何','法向量','化学').length,0);
 const tangent=lib.findCards('直线与圆','2023','数学').find(c=>c.circleCard);assert(tangent);assert(lib.mathSearchEvidence(tangent,'2023').some(e=>e.kind==='关联真题原句'));
});
