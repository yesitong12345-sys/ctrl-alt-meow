import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),ids=['exam2021-12','exam2023-12'];
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),norm=v=>Math.sqrt(dot(v,v)),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const A=[.5,Math.sqrt(3)/2,0],B=[0,0,0],C=[1,0,0],A1=[.5,Math.sqrt(3)/2,1],B1=[0,0,1];
test('two final exam paths retain complete four-choice statements, 13 segments and central sources',()=>{
 assert.equal(ids.reduce((n,id)=>n+lib.getMathLesson(id).steps.length,0),13);
 for(const id of ids){const l=lib.getMathLesson(id),html=lib.mathDetail('math-'+id);assert.equal(l.conditions.length,5);for(const s of l.steps){assert(l.conditions.join('；').includes(s.evidence),s.evidence);assert(s.why&&s.point&&s.work.length&&s.result);}for(const r of l.related)assert(lib.getMathLesson(r.id));assert(!html.includes('href="http'));assert(!/undefined|NaN|Infinity/.test(html));assert(html.includes('原题未附图'));}
 const q=lib.getMathLesson(ids[0]);assert(q.conditions[0].includes('λ∈[0，1]'));assert(q.conditions[0].includes('μ∈[0，1]'));assert(q.conditions[1].includes('△AB₁P'));assert(q.conditions[4].includes('A₁B⊥平面AB₁P'));
});
test('2021 A perimeter changes at two legal positions, B determinant volume stays fixed for all lambda',()=>{
 const perimeter=mu=>norm(sub(A,B1))+norm(sub(A,[1,0,mu]))+norm(sub(B1,[1,0,mu]));close(perimeter(0),1+2*Math.sqrt(2));close(perimeter(.5),Math.sqrt(2)+Math.sqrt(5));assert(perimeter(0)>perimeter(.5));
 for(let i=0;i<=100;i++){const P=[i/100,0,1],volume=Math.abs(dot(sub(A1,B),cross(sub(C,B),sub(P,B))))/6;close(volume,Math.sqrt(3)/12);}
});
test('2021 C has both endpoints, D only the CC1 midpoint; changing mu to 1 leaves a degenerate candidate',()=>{
 for(const mu of [0,1]){const P=[.5,0,mu];close(dot(sub(P,A1),sub(P,B)),0);assert(norm(sub(P,A1))>0&&norm(P)>0);}
 for(let i=1;i<100;i++){const mu=i/100;assert(dot(sub([.5,0,mu],A1),[.5,0,mu])<0);}
 const w=sub(B,A1);close(dot(w,sub(B1,A)),0);
 for(let i=0;i<=100;i++){const lambda=i/100,P=[lambda,0,.5];close(dot(w,sub(P,B1)),(1-lambda)/2);assert(norm(cross(sub(B1,A),sub(P,B1)))>0);}
 close(dot(w,sub([1,0,.5],B1)),0);assert.equal(norm(cross(sub(B1,A),sub(B1,B1))),0);
 for(let i=0;i<=100;i++){const mu=i/100,P=[1,0,mu];close(dot(sub(P,A1),P),(mu-.5)**2+.25);}
 assert(lib.getMathLesson(ids[0]).steps.at(-1).result.includes('B、D'));
});
test('2023 sphere and all six tetrahedron edges fit, while the long cylinder violates maximum pair distance',()=>{
 assert(.99/2<.5);const t=1.4/Math.sqrt(2),v=[[-1,-1,-1],[1,1,-1],[1,-1,1],[-1,1,1]].map(p=>p.map(c=>c*t/2));
 for(const p of v)for(const c of p)assert(Math.abs(c)<.5);for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)close(norm(sub(v[i],v[j])),1.4);
 assert(1.8>Math.sqrt(3));assert(2>Math.sqrt(3));assert(2*Math.PI*.001**2<1);
});
test('2023 tilted cylinder support bounds and sampled full solids agree, including changed height',()=>{
 const n=[1,1,1].map(x=>x/Math.sqrt(3)),u=[1,-1,0].map(x=>x/Math.sqrt(2)),v=[1,1,-2].map(x=>x/Math.sqrt(6));close(dot(n,u),0);close(dot(n,v),0);close(dot(u,v),0);
 for(const h of [.01,.02]){const width=1.2*Math.sqrt(2/3)+h/Math.sqrt(3);assert(width<1);for(const a of [-h/2,0,h/2])for(const radius of [0,.3,.6])for(let j=0;j<360;j++){const angle=j*Math.PI/180,p=n.map((x,i)=>a*x+radius*(u[i]*Math.cos(angle)+v[i]*Math.sin(angle)));for(const c of p)assert(Math.abs(c)<.5);}
 for(let i=0;i<3;i++){const e=[0,0,0];e[i]=1;const perp=sub(e,n.map(x=>x*n[i])),len=norm(perp),boundary=n.map((x,k)=>h*x/2+.6*perp[k]/len);close(boundary[i]*2,width);}}
 assert(Math.sqrt(2/3)<.82);assert(1/Math.sqrt(3)<.6);assert(lib.getMathLesson(ids[1]).steps.at(-1).result.includes('A、B、D'));
});
test('diagrams show both C candidates without generic P, and all container stages are finite and scoped',()=>{
 const q=lib.getMathLesson(ids[0]),svg=lib.mathFigure(q,q.steps[3].visual);assert(svg.includes('>E</text>')&&svg.includes('>F</text>'));assert(!svg.includes('>P</text>'));assert(!lib.mathFigure(q,q.steps[0].visual).includes('>E</text>'));
 for(const id of ids){const l=lib.getMathLesson(id);for(const s of l.steps)if(s.visual){const image=lib.mathFigure(l,s.visual);assert(image.startsWith('<svg'));assert(!/undefined|NaN|Infinity/.test(image));}}
 const fit=lib.getMathLesson(ids[1]);assert(!lib.mathFigure(fit,{stage:0}).includes('1.4'));assert(!lib.mathFigure(fit,{stage:1}).includes('薄圆柱'));assert(lib.mathFigure(fit,{stage:4}).includes('轴沿(1,1,1)'));assert(lib.mathFigure(fit,{stage:5}).includes('三轴宽度均小于1'));
});
test('all 13 solid source records now have complete links without claiming complete curriculum coverage',()=>{
 assert(lib.mathResources().includes('本样本已全部提供完整讲解，仍不代表各子方法全部覆盖'));assert(!lib.mathResources().includes('其余只有题面索引，不提供空白解答入口'));
 const html=lib.mathResources(),keys=[...html.matchAll(/data-exam-source-key="([^"]+)"/g)].map(x=>x[1]);assert.equal(keys.length,13);assert.equal(new Set(keys).size,13);assert(html.includes('13/13道已录入完整解答'));assert(html.includes('351段'));assert(html.includes('这不是完整覆盖率'));assert(html.includes('尚未由教师复审'));assert.equal(lib.mathVersion,'4.53.0');assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);for(const id of ids)assert(html.includes('data-math-next="math-'+id+'"'));
});
