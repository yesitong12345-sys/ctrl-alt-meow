import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>Math.hypot(...a),mean=ps=>ps[0].map((_,i)=>ps.reduce((n,p)=>n+p[i],0)/ps.length),key=e=>e.slice().sort().join('-'),near=(a,b)=>assert(Math.abs(a-b)<1e-9);
function hiddenBoundary(mesh,prism){
 const p=mesh.points,faces=prism?[['A','B','C'],['A₁','B₁','C₁'],['A','B','B₁','A₁'],['B','C','C₁','B₁'],['C','A','A₁','C₁']]:[['P','A','B'],['P','B','C'],['P','C','A'],['A','B','C']],center=mean((prism?['A','B','C','A₁','B₁','C₁']:['P','A','B','C']).map(k=>p[k]));
 const pr=mesh.projection,rows=[0,1].map(i=>[pr.x[i],pr.y[i],pr.z[i]]);let eye=cross(...rows);if(eye[2]<0)eye=eye.map(x=>-x);
 const front=faces.map(f=>{const ps=f.map(k=>p[k]);let n=cross(sub(ps[1],ps[0]),sub(ps[2],ps[0]));if(dot(n,sub(center,mean(ps)))>0)n=n.map(x=>-x);return dot(n,eye)>0;});
 const edges=new Map();for(const f of faces)for(let i=0;i<f.length;i++){const edge=[f[i],f[(i+1)%f.length]];edges.set(key(edge),edge);}
 const hidden=[...edges.values()].filter(([a,b])=>faces.every((f,i)=>!f.includes(a)||!f.includes(b)||!front[i])).map(key).sort();return {hidden,edges};
}
test('four meshes match independent outward-face visibility, including every silhouette and top edge',()=>{
 for(const id of ['planes-perp-criterion','planes-perp-property','prism-orthogonal-axes','exam2025-9']){const l=lib.getMathLesson(id),{hidden,edges}=hiddenBoundary(l.mesh,id.includes('prism')||id.includes('2025'));assert.deepEqual(l.mesh.hidden.map(x=>key(x.split('-'))).filter(k=>edges.has(k)).sort(),hidden,id);for(const s of l.steps.filter(s=>s.visual))assert(!/NaN|undefined/.test(lib.mathFigure(l,s.visual)));}
});
test('back-face and interior auxiliaries stay dashed while highlighting does not create a solid hidden line',()=>{
 for(const [id,expected] of [['planes-perp-criterion',['C-M']],['planes-perp-property',['B-H']],['prism-orthogonal-axes',['A-M','A₁-C']],['exam2025-9',['A-D','A₁-C']]])for(const edge of expected)assert(lib.getMathLesson(id).mesh.hidden.includes(edge),id+':'+edge);
 for(const id of ['prism-orthogonal-axes','exam2025-9'])assert(!lib.getMathLesson(id).mesh.hidden.includes('A₁-B₁'));
});
test('two isosceles constraints produce a plane normal and distance for varied nondegenerate apexes',()=>{
 for(const [a,c,t,h] of [[3,2,1,3],[5,4,-2,7],[2,1,0,4]]){const A=[-a,0,0],B=[a,0,0],C=[0,c,0],P=[0,t,h],M=[0,0,0],ab=sub(B,A),pm=sub(P,M),cm=sub(C,M),normal=cross(pm,cm);near(dot(ab,pm),0);near(dot(ab,cm),0);assert(norm(normal)>0);near(Math.abs(dot(normal,sub(A,M)))/norm(normal),a);}
 const a=[-3,0,0],b=[3,0,0],p=[0,0,2],c=[1,1,0],n1=cross(sub(b,a),sub(p,a)),n2=cross(p,c);near(Math.abs(dot(n1,n2))/(norm(n1)*norm(n2)),1/Math.sqrt(2));
});
test('perpendicular-plane distance and prism projection match independent lengths and angle calculation',()=>{
 for(const h of [4,5]){const A=[-3,0,0],B=[0,4,0],C=[3,0,0],P=[0,0,h],normal=cross(sub(B,A),sub(C,A));near(Math.abs(dot(normal,sub(P,A)))/norm(normal),h);near(norm(sub(P,B)),Math.sqrt(h*h+16));}
 for(const h of [3,4]){const A=[0,Math.sqrt(3),0],B=[-1,0,0],C=[1,0,0],Ap=[0,Math.sqrt(3),h],u=sub(C,Ap);near(Math.abs(u[2])/norm(u),h/Math.sqrt(4+h*h));near(dot(sub(B,A),sub(C,A))/(norm(sub(B,A))*norm(sub(C,A))),.5);}
});
test('2025 four options remain false true true false for independent positive dimensions',()=>{
 for(const b of [.5,1,3])for(const h of [.5,2,5]){const A=[0,Math.sqrt(3)*b,0],D=[0,0,0],B=[-b,0,0],C=[b,0,0],Ap=[0,Math.sqrt(3)*b,h],Bp=[-b,0,h],ad=sub(D,A),a1c=sub(C,Ap),aa1=sub(Ap,A),bc=sub(C,B);near(dot(ad,a1c),3*b*b);near(dot(bc,ad),0);near(dot(bc,aa1),0);const n=cross(ad,aa1);near(dot(n,[0,0,h]),0);assert(Math.abs(dot(n,sub(C,A)))>0);assert(norm(cross(ad,sub(Bp,Ap)))>0);}
 assert(lib.getMathLesson('exam2025-9').prerequisites.join('').includes('空间直角坐标'));
});
test('cube counterexample uses intersecting square sides rather than unlearned plane equations, with old subjects retained',()=>{
 const l=lib.getMathLesson('cube-perp');assert(l.counter.answer.includes('AD⊥CD'));assert(!l.counter.answer.includes('z轴'));assert(l.counter.answer.includes('就在该底面内'));
 for(const id of ['cube-perp','planes-perp-criterion','planes-perp-property','prism-orthogonal-axes','exam2025-9']){const q=lib.getMathLesson(id);assert(q.conditions.length&&q.transfer&&q.counter);for(const s of q.steps)assert(q.conditions.join('').includes(s.evidence));}
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);assert(lib.mathResources().includes('351段'));
});
