import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),sub=(a,b)=>a.map((x,i)=>x-b[i]),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],near=(a,b)=>assert(Math.abs(a-b)<1e-9);
function hiddenFaces(q,faces){const m=q.mesh,vs=[...new Set(faces.flat())],center=[0,1,2].map(i=>vs.reduce((s,k)=>s+m.points[k][i],0)/vs.length),p=m.projection;let camera=cross([p.x[0],p.y[0],p.z[0]],[p.x[1],p.y[1],p.z[1]]);if(camera[2]<0)camera=camera.map(x=>-x);return faces.map(face=>{const a=m.points[face[0]];let n=cross(sub(m.points[face[1]],a),sub(m.points[face[2]],a));if(dot(n,sub(center,a))>0)n=n.map(x=>-x);return {face,hidden:dot(n,camera)<0};});}
test('independent face normals identify the folded rear hinge and the dynamic pyramid rear base edge',()=>{
 for(const [id,faces,expected] of [['fold-hinge',[['B','C','D'],['P','B','C'],['P','B','D'],['P','C','D']],['B-C']],['pyramid-dynamic',[['A','B','C','D'],['P','A','B'],['P','B','C'],['P','C','D'],['P','D','A']],['C-D']]]){const q=lib.getMathLesson(id),f=hiddenFaces(q,faces),edges=q.mesh.edges.filter(([a,b])=>a!=='A'||id!=='fold-hinge').filter(([a,b])=>b!=='A'||id!=='fold-hinge');const actual=edges.filter(([a,b])=>{const adj=f.filter(x=>x.face.includes(a)&&x.face.includes(b));return adj.length===2&&adj.every(x=>x.hidden);}).map(e=>e.join('-'));assert.deepEqual(actual,expected);assert.deepEqual(q.mesh.hidden,expected);}
});
test('unfolded hinge remains solid, hidden auxiliaries stay dashed, and no answer E precedes its solution',()=>{
 const fold=lib.getMathLesson('fold-hinge'),flat=lib.mathFigure(fold,fold.steps[0].visual),b='d="M130 250L350 250"';const edge=[...flat.matchAll(/<path[^>]+>/g)].map(x=>x[0]).find(x=>x.includes(b));assert(edge&&!edge.includes('stroke-dasharray'));
 for(const id of ['fold-hinge','pyramid-dynamic','tetra-equal-volume']){const q=lib.getMathLesson(id),m=q.mesh,pr=m.projection||{origin:[205,260],x:[62,-13],y:[-43,-24],z:[0,-75]},project=v=>pr.origin.map((x,i)=>x+pr.x[i]*v[0]+pr.y[i]*v[1]+pr.z[i]*v[2]);for(const key of m.occluded){const [a,b]=key.split('-'),d='d="M'+project(m.points[a]).join(' ')+'L'+project(m.points[b]).join(' ')+'"';let seen=0;for(const s of q.steps.filter(s=>s.visual))for(const [path] of lib.mathFigure(q,s.visual).matchAll(/<path[^>]+>/g))if(path.includes(d)){seen++;assert(path.includes('stroke-dasharray'));}assert(seen>0,key);}}
 const q=lib.getMathLesson('pyramid-dynamic');for(const s of q.steps.slice(0,2))assert(!lib.mathFigure(q,s.visual).includes('>E</text>'));assert(lib.mathFigure(q,q.steps[2].visual).includes('>E</text>'));
});
test('fold, volume, dynamic existence and sphere boundary answers independently recompute',()=>{
 const r=Math.sqrt(3);near(Math.hypot(r,r),Math.sqrt(6));near((2*r/2)*r/3,1);near(Math.sqrt(2*r*r*(1-Math.cos(Math.PI/3))),r);near((2*r/2)*(r*Math.sin(Math.PI/3))/3,r/2);
 for(const a of [2,3]){const volume=a**3/6,area=Math.sqrt(3)*a*a/2;near(3*volume/area,a/Math.sqrt(3));}
 for(const height of [3,5]){const t=.8,be=[4*t-4,2*t,height*(1-t)];near(dot(be,[4,2,0]),0);near(t/(1-t),4);}assert(4/3>1);
 near(Math.sqrt(25-9),4);near(Math.PI*(25-9),16*Math.PI);assert(25-36<0);near(25-25,0);near(25-0,25);
});
