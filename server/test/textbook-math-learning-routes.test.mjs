import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const lib=createRequire(import.meta.url)('../../implementation/textbook-library.js');
const html=lib.mathDirectory();
const routes=[...html.matchAll(/<section data-math-learning-route="([^"]+)">([\s\S]*?)<\/section>/g)];
test('four curated routes contain only real complete lessons and honest prerequisite boundaries',()=>{
 assert.equal(routes.length,4);
 for(const [,id,body] of routes){
  const ids=[...body.matchAll(/data-open-method="math-([^"]+)"/g)].map(m=>m[1]);
  assert(ids.length>=3,id);assert.equal(new Set(ids).size,ids.length);
  for(const lessonId of ids){const q=lib.getMathLesson(lessonId);assert(q&&q.steps.length&&q.transfer&&q.counter,lessonId);for(const p of q.prerequisites)assert(body.includes(p));}
 }
 assert(html.includes('不是完整课程'));assert(html.includes('学校教材版本与进度仍待核对'));
 assert(html.includes('尚未覆盖向量运算的完整练习与所有性质'));
});
test('non-vector routes do not require coordinate or vector computation in the worked steps',()=>{
 for(const [,id,body] of routes.filter(r=>r[1].startsWith('geometry-'))){
  for(const match of body.matchAll(/data-open-method="math-([^"]+)"/g)){
   const q=lib.getMathLesson(match[1]);
   assert(!q.prerequisites.some(p=>/向量|坐标运算|数量积/.test(p)),id+':'+q.id);
   const required=q.steps.filter(s=>!s.optional).flatMap(s=>s.work).filter(w=>/数量积|法向量|建立空间直角坐标系/.test(w));
   assert.equal(required.length,0,id+':'+q.id+' requires vectors in the main solution');
   if(q.steps.some(s=>s.optional)){assert(q.optionalPrerequisites.length);assert(lib.mathDetail('math-'+q.id).includes('data-math-optional'));assert(body.includes('可略过'));}
  }
 }
 const vector=routes.find(r=>r[1]==='vector-preparation')[2];
 assert.equal([...vector.matchAll(/data-open-method="math-([^"]+)"/g)].length,12);
 assert(vector.indexOf('math-vector-coordinates-basic')<vector.indexOf('math-prism-orthogonal-axes'));
 assert(vector.indexOf('math-prism-orthogonal-axes')<vector.indexOf('math-cube-angle'));
 assert(vector.indexOf('math-cube-angle')<vector.indexOf('math-plane-normal-distance'));
});
