import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js'),l=lib.getMathLesson('parabola-focus-directrix'),near=(a,b)=>assert(Math.abs(a-b)<1e-9),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
test('complete parabola lesson defines the parameter, perpendicular foot, special chord and alternate convention',()=>{
 assert(l.kind.includes('原创'));assert(!l.sourceKey);assert.equal(l.steps.length,7);for(const s of l.steps){assert(l.conditions.join('').includes(s.evidence),s.evidence);assert(s.why&&s.work.length&&s.result&&s.point);}
 assert(l.steps[0].work.join('').includes('2p=8'));assert(l.steps[3].work.join('').includes('定义H为P到准线l的垂足'));assert(l.steps[4].work.join('').includes('并不是所有焦弦都长8'));assert(l.steps[5].work.join('').includes('p=2a'));
 assert(lib.mathNodes.find(n=>n.id==='A08').lessons.includes(l.id));assert(lib.knowledgeFor('math-'+l.id).some(g=>g.id==='A08'));assert(!lib.mathDetail('math-'+l.id).includes('data-diagram-unavailable'));
});
test('independent focus-directrix distances, left-opening transfer and oblique focal chord reject parameter/chord shortcuts',()=>{
 const coefficient=8,p=coefficient/2,a=coefficient/4;near(p,4);near(a,2);near(p,2*a);
 const P=[36/coefficient,6],F=[p/2,0],H=[-p/2,6];near(P[0],4.5);near(dist(P,F),6.5);near(dist(P,F),dist(P,H));near(dist([p/2,4],[p/2,-4]),8);
 for(const pp of [1,4,6])for(const y of [-6,-1,0,2,8]){const x=y*y/(2*pp);near(dist([x,y],[pp/2,0]),x+pp/2);near(dist([-x,y],[-pp/2,0]),x+pp/2);}
 const x1=6-4*Math.sqrt(2),x2=6+4*Math.sqrt(2),A=[x1,x1-2],B=[x2,x2-2];near(A[1]**2,8*A[0]);near(B[1]**2,8*B[0]);assert(x1<2&&x2>2);near(dist(A,B),16);assert(dist(A,B)!==2*p);
});
test('actual graph has equal coordinate scale, correct perpendicular equal lengths, and delayed focus/foot/chord objects',()=>{
 const original=lib.mathFigure(l,{stage:0},true);assert(!original.includes('F(2,0)'));assert(!original.includes('>H</text>'));assert(!original.includes('A(2,4)'));
 const first=lib.mathFigure(l,{stage:1});assert(!first.includes('F(2,0)'));assert(!first.includes('焦点(2,0)'));assert(!first.includes('OF=p/2=2'));
 const fourth=lib.mathFigure(l,{stage:4}),pts=[...fourth.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.5"/g)].map(m=>[+m[1],+m[2]]),[O,P,F,H]=pts;near(dist(O,F)/20,2);near(dist(P,F)/20,6.5);near(dist(P,F),dist(P,H));near(H[0],90);near(H[1],P[1]);
 const curve=fourth.match(/<path d="([^"]+)" fill="none" stroke="#2358B8" stroke-width="2.5"/);assert(curve);for(const [,xx,yy]of curve[1].matchAll(/[ML]([\d.]+) ([\d.]+)/g)){const x=(+xx-130)/20,y=(170-+yy)/20;near(y*y,8*x);}
 assert(!fourth.includes('A(2,4)'));const fifth=lib.mathFigure(l,{stage:5});assert(fifth.includes('A(2,4)'));assert(fifth.includes('B(2,−4)'));assert(!fifth.includes('>H</text>'));
 for(const s of l.steps)assert(!/NaN|undefined/.test(lib.mathFigure(l,s.visual)));
 assert.equal(lib.findCards('全部主题','','数学').length,75);assert.equal(lib.findCards('全部主题','','化学').length,10);assert.equal(lib.findRecentReviews().length,13);assert.equal((lib.mathResources().match(/data-exam-source-key=/g)||[]).length,13);
});
