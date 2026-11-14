import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('vector-plane-projection'),dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0),add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),scale=(a,k)=>a.map(x=>x*k),norm=a=>Math.hypot(...a),near=(a,b)=>assert(Math.abs(a-b)<1e-9),nearV=(a,b)=>a.forEach((x,i)=>near(x,b[i]));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const foot=(A,M,n)=>sub(A,scale(n,dot(sub(A,M),n)/dot(n,n)));
test('plane projection defines all objects before use and proves membership, orthogonality and the unique minimum',()=>{
 assert.equal(l.steps.length,6);assert(!l.sourceKey);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.point&&s.result&&s.work.length);}
 assert(l.steps[0].work.join('').includes('令p=OH，q=HA'));assert(l.steps[3].work.join('').includes('OH=(2,1,1)=OB+OC'));assert(l.steps[4].work.join('').includes('任取X∈π'));assert(l.steps[4].work.join('').includes('等号当且仅当X=H'));assert(l.steps[5].work.join('').includes('先选面内点M'));
 const route=lib.mathDirectory().match(/data-math-learning-route="vector-preparation"[\s\S]*?<\/section>/)[0];assert(route.indexOf('math-vector-plane-triangle-region')<route.indexOf('math-'+l.id));assert(route.indexOf('math-'+l.id)<route.indexOf('math-prism-orthogonal-axes'));
 assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('independent plane foot calculation distinguishes plane and normal components, translation and the transfer',()=>{
 const O=[0,0,0],B=[1,1,0],C=[1,0,1],A=[3,0,0],n=cross(B,C),H=foot(A,O,n),q=sub(A,H);
 nearV(n,[1,-1,-1]);nearV(H,[2,1,1]);nearV(H,add(B,C));nearV(q,[1,-1,-1]);near(dot(H,n),0);near(dot(H,q),0);near(norm(q),Math.sqrt(3));near(norm(H),Math.sqrt(6));
 for(const k of [-3,-.5,2,7])nearV(foot(A,O,scale(n,k)),H);
 for(const a of [-2,0,.3,1,3])for(const b of [-1,0,1,2]){const X=add(scale(B,a),scale(C,b));near(norm(sub(A,X))**2,norm(q)**2+norm(sub(H,X))**2);assert(norm(sub(A,X))+1e-9>=norm(q));}
 const H2=foot([0,3,0],O,n);nearV(H2,[1,2,-1]);nearV(H2,sub(scale(B,2),C));near(norm(sub([0,3,0],H2)),Math.sqrt(3));
 const M=[1,0,0],translated=foot(A,M,n);nearV(translated,[7/3,2/3,2/3]);near(norm(sub(A,translated)),2*Math.sqrt(3)/3);near(dot(sub(translated,M),n),0);assert(norm(sub(translated,H))>.5);
 nearV(foot([2,1,1],O,n),[2,1,1]);nearV(foot(n,O,n),O);nearV(foot(O,O,n),O);
});
test('diagram adds H and then arbitrary X without pretending screen angles are space angles or adding exam frequency',()=>{
 const original=lib.mathFigure(l,{stage:0},true);assert(!original.includes('>H</text>'));assert(!original.includes('>X</text>'));assert(original.includes('π仅画局部'));
 const first=lib.mathFigure(l,{stage:1}),fifth=lib.mathFigure(l,{stage:5});assert(first.includes('>H</text>'));assert(!first.includes('>X</text>'));assert(fifth.includes('>X</text>'));assert(fifth.includes('不量纸面夹角'));
 for(const s of l.steps)assert(!/NaN|undefined/.test(lib.mathFigure(l,s.visual)));
 for(const id of ['S09','S10','S11'])assert(lib.mathNodes.find(n=>n.id===id).lessons.includes(l.id));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);assert.equal(lib.findRecentReviews().length,13);
});
