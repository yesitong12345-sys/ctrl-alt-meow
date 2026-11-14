import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),q=lib.getMathLesson('cube-union-volume');
const volume=b=>['x','y','z'].reduce((n,k)=>n*(b[k][1]-b[k][0]),1);
const common=(a,b)=>['x','y','z'].reduce((n,k)=>n*Math.max(0,Math.min(a[k][1],b[k][1])-Math.max(a[k][0],b[k][0])),1);
// Independently count unit cells by checking their centers against the two regions.
function cells(a,b){let n=0,both=0;for(let x=-1;x<10;x++)for(let y=-1;y<10;y++)for(let z=-1;z<10;z++){const inside=c=>['x','y','z'].every((k,i)=>c[k][0]<[x+.5,y+.5,z+.5][i]&&[x+.5,y+.5,z+.5][i]<c[k][1]),u=inside(a),v=inside(b);if(u||v)n++;if(u&&v)both++;}return {union:n,intersection:both};}
test('original question, first thought, five full steps and single-condition exercises are complete',()=>{
 assert.equal(q.steps.length,5);assert.equal(q.kind,'原创课内题');assert(!q.sourceKey);assert(q.intro.includes('第一步'));assert(q.intro.includes('不是让两个实体木块互相穿透'));
 for(const s of q.steps){assert(q.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.hint&&s.result&&s.point&&s.work.length>=3);}
 assert(q.steps[0].work[0].includes('设J=K₁∩K₂'));assert(q.steps[1].work.join('').includes('Lx=4−2=2'));assert(q.steps[2].work.join('').includes('Lz=4−0=4'));assert(q.steps[3].work.join('').includes('64+64−24=104'));
});
test('independent cell counting verifies main answer, x-shift transfer and face contact',()=>{
 const [a,b]=q.boxes;assert.equal(volume(a),64);assert.equal(volume(b),64);assert.deepEqual(cells(a,b),{union:104,intersection:24});
 const shifted={...b,x:[3,7]},touching={...b,x:[4,8]};assert.deepEqual(cells(a,shifted),{union:116,intersection:12});assert.deepEqual(cells(a,touching),{union:128,intersection:0});
 assert(q.transfer.answer.includes('116'));assert(q.counter.answer.includes('面积12'));assert(q.counter.answer.includes('公共体积为0'));
 for(const d of [0,1,2,3,4,5])for(const h of [0,2,5]){const other={...b,x:[d,d+4],z:[h,h+4]},count=cells(a,other);assert.equal(count.intersection,common(a,other));assert.equal(count.union,volume(a)+volume(other)-common(a,other));}
});
test('slab decomposition counts each interior once, while touching faces have zero volume',()=>{
 const [a,b]=q.boxes,totals=[0,0,0];for(let x=0;x<6;x++)for(let y=0;y<5;y++)for(let z=0;z<4;z++){const inside=c=>c.x[0]<=x&&x<c.x[1]&&c.y[0]<=y&&y<c.y[1]&&c.z[0]<=z&&z<c.z[1];if(inside(a)||inside(b))totals[Math.floor(x/2)]++;}
 assert.deepEqual(totals,[32,40,32]);assert.equal(totals.reduce((n,v)=>n+v),104);
 // Same point on x=4 belongs to both closed regions but their overlap is a face.
 const p=[4,2,2],touch={...b,x:[4,8]};for(const region of [a,touch])assert(['x','y','z'].every((k,i)=>region[k][0]<=p[i]&&p[i]<=region[k][1]));assert.equal(common(a,touch),0);
});
test('original and early drawings reveal no later volume or space-intersection conclusion',()=>{
 for(const svg of [lib.mathFigure(q),lib.mathFigure(q,{stage:0},true),lib.mathFigure(q,q.steps[0].visual)]){assert(!svg.includes('J：'));assert(!svg.includes('104'));assert(!svg.includes('32 + 40'));assert(!svg.includes('stroke="#075D49"'));}
 const plan=lib.mathFigure(q,q.steps[1].visual);assert(plan.includes('2 × 3'));assert(!plan.includes('2×3×4'));const space=lib.mathFigure(q,q.steps[2].visual);assert(space.includes('J：2×3×4'));
 for(const s of q.steps){const svg=lib.mathFigure(q,s.visual);assert(!/undefined|NaN|Infinity/.test(svg));assert(svg.includes('aria-label='));for(const m of svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"/g)){assert(+m[1]>0&&+m[1]<440);assert(+m[2]>0&&+m[2]<335);}}
 assert(!lib.mathDetail('math-'+q.id).includes('data-diagram-unavailable'));
});
test('S01 mapping is usable while source frequency and existing subjects remain correct',()=>{
 assert(lib.mathNodes.find(n=>n.id==='S01').lessons.includes(q.id));for(const r of q.related)assert(lib.getMathLesson(r.id));
 const html=lib.mathResources();assert.equal([...html.matchAll(/data-exam-source-key=/g)].length,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert(html.includes('44道原创课内题'));assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);
});
test('space projection hides exactly the three edges at the far lower vertex',()=>{
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const view=cross([44,18,0],[-5,-13,-28]).map(v=>-v);assert(view[0]>0&&view[1]<0&&view[2]>0);
 const project=([x,y,z])=>[40+44*x+18*y,285-5*x-13*y-28*z];
 for(const [stage,boxes] of [[0,q.boxes],[3,[...q.boxes,{x:[2,4],y:[1,4],z:[0,4]}]]]){
  const svg=lib.mathFigure(q,{stage}),actual=[...svg.matchAll(/<path d="([^"]+)"[^>]*stroke-dasharray="6 5"/g)].map(m=>m[1]);
  const expected=boxes.flatMap(b=>{const keys=['x','y','z'],far=keys.map((k,i)=>b[k][view[i]>0?0:1]);return keys.map((k,i)=>{const near=[...far];near[i]=b[k][view[i]>0?1:0];const a=project(far),z=project(near);return [a,z];});});
  assert.equal(actual.length,expected.length);
  for(const [a,b] of expected)assert(actual.includes(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`)||actual.includes(`M${b[0]} ${b[1]}L${a[0]} ${a[1]}`));
 }
});
