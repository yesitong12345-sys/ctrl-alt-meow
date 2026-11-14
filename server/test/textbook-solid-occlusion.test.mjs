import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const cubeIds=['cube-skew','cube-parallel-planes','cube-line-plane-angle','cube-angle-translate','exam2022-9','cube-skew-distance'],tetraIds=['tetra-dihedral','plane-normal-distance','tetra-equal-volume'];
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],key=(a,b)=>[a,b].sort().join('|');
const projection=m=>m.projection||{origin:[205,260],x:[62,-13],y:[-43,-24],z:[0,-75]};
function camera(m){const p=projection(m);return cross([p.x[0],p.y[0],p.z[0]],[p.x[1],p.y[1],p.z[1]]).map(v=>-v);}
// Independent convex-face oracle: a boundary edge is hidden only when both incident faces face away.
function hiddenByFaces(m,faces){
 const verts=[...new Set(faces.flat())],center=[0,1,2].map(i=>verts.reduce((s,k)=>s+m.points[k][i],0)/verts.length),cam=camera(m),adj=new Map();
 for(const f of faces){let n=cross(sub(m.points[f[1]],m.points[f[0]]),sub(m.points[f[2]],m.points[f[0]]));if(dot(n,sub(center,m.points[f[0]]))>0)n=n.map(v=>-v);const facing=dot(n,cam);assert(Math.abs(facing)>1e-6,'edge-on projection needs separate handling');for(let i=0;i<f.length;i++){const k=key(f[i],f[(i+1)%f.length]);adj.set(k,[...(adj.get(k)||[]),facing>0]);}}
 return new Set([...adj].filter(([,a])=>a.length===2&&a.every(v=>!v)).map(([k])=>k));
}
function cubeFaces(top){const [a,b,c,d]=top;return [['A','B','C','D'],[a,b,c,d],['A','B',b,a],['B','C',c,b],['C','D',d,c],['D','A',a,d]];}
test('six cube meshes use hidden edges implied by their own projection and six faces',()=>{
 for(const id of cubeIds){const m=lib.getMathLesson(id).mesh,top=id==='exam2022-9'?['A₁','B₁','C₁','D₁']:['A′','B′','C′','D′'];assert.deepEqual(new Set(m.hidden.map(s=>key(...s.split('-')))),hiddenByFaces(m,cubeFaces(top)),id);assert(camera(m)[2]>0);}
});
test('three default tetrahedra hide AB while origin edges remain on visible faces',()=>{
 for(const id of tetraIds){const m=lib.getMathLesson(id).mesh,expected=hiddenByFaces(m,[['O','A','B'],['O','A','C'],['O','B','C'],['A','B','C']]);assert.deepEqual(expected,new Set([key('A','B')]));assert.deepEqual(new Set(m.hidden.map(s=>key(...s.split('-')))),expected,id);}
});
test('all corrected boundary paths keep their line style at every stage including green overlays',()=>{
 for(const id of [...cubeIds,...tetraIds]){const l=lib.getMathLesson(id),m=l.mesh,p=projection(m),project=v=>p.origin.map((x,i)=>x+p.x[i]*v[0]+p.y[i]*v[1]+p.z[i]*v[2]);for(const visual of [{stage:0},...l.steps.map(s=>s.visual).filter(Boolean)]){const svg=lib.mathFigure(l,visual),points={...m.points,...visual.points};for(const [a,b] of [...m.edges,...visual.active||[]]){if(!points[a]||!points[b])continue;const d='M'+project(points[a]).join(' ')+'L'+project(points[b]).join(' '),paths=[...svg.matchAll(/<path[^>]+>/g)].map(v=>v[0]).filter(s=>s.includes('d="'+d+'"'));const mask=[...m.hidden,...m.occluded||[]],hidden=mask.includes(a+'-'+b)||mask.includes(b+'-'+a);for(const path of paths)assert.equal(path.includes('stroke-dasharray="6 5"'),hidden,id+' '+a+'-'+b);}}}
});
test('occlusion repair preserves lesson calculations, exam ledger, chemistry and recent review diagrams',()=>{
 assert.equal(lib.mathVersion,'4.53.0');assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);
 for(const c of lib.findRecentReviews())assert.equal((lib.recentReviewDetail('review-'+c.id).match(/data-review-figure=/g)||[]).length,3);
 const directory=lib.mathDirectory();assert(directory.includes('近期优先复习'));assert.equal((directory.match(/data-open-method="review-/g)||[]).length,13);assert(directory.indexOf('tb-recent-review')<directory.indexOf('tb-math-learning-routes'));
 const html=lib.mathResources();assert(html.includes('351段'));assert.equal((html.match(/data-exam-source-key=/g)||[]).length,13);for(const id of [...cubeIds,...tetraIds]){const l=lib.getMathLesson(id);assert(l.steps.every(s=>s.work.length&&s.result&&s.point));assert(!lib.mathDetail('math-'+id).includes('data-diagram-unavailable'));}
});
