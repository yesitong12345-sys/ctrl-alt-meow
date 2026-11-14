import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const template = new URL('../third_party/edulab/skills/edu-analytic-geometry/template/board.html', import.meta.url);
const lessons = ['ellipse_dot_range','ellipse_chord_range','ellipse_area_max','ellipse_slopeprod_const','parabola_dot_const','hyperbola_ecc_range'];
const sources = [template, ...lessons.map(id => new URL(`../../implementation/skills/analytic/${id}.html`, import.meta.url))];

async function geometryAt(file) {
  const html = await readFile(file, 'utf8');
  // Execute the actual self-contained geometry engine shipped to the browser,
  // rather than a test implementation of the formulas.
  const start = html.indexOf('    function conicImplicit(cn)');
  const end = html.indexOf('    const conicDefs =', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(`const EPS=1e-9; const toRad=deg=>deg*Math.PI/180;\n${html.slice(start,end)}\nglobalThis.intersect=intersectLineConic;`, context);
  return (line, conic) => JSON.parse(JSON.stringify(context.intersect(line, conic)));
}

test('相切只有一个交点，不把同一切点复制成两个端点', async () => {
  for (const file of sources) {
    const intersect = await geometryAt(file);
    assert.deepEqual(intersect({p0:[1,0],dir:[0,1]}, {kind:'circle',r:1}), [[1,0]], file.pathname);
    assert.deepEqual(intersect({p0:[0,1],dir:[1,0]}, {kind:'ellipse',a:2,b:1}), [[0,1]], file.pathname);
  }
});

test('近切但相离仍无交点，方向向量缩放不改变真实交点', async () => {
  for (const file of sources) {
    const intersect = await geometryAt(file), circle={kind:'circle',r:1};
    assert.deepEqual(intersect({p0:[0,1+1e-9],dir:[1,0]},circle),[],file.pathname);
    for(const length of [1e-8,1,1e8]) {
      const points=intersect({p0:[0,0],dir:[0,length]},circle);
      assert.equal(points.length,2);
      assert.ok(Math.abs(points[0][1]+1)<1e-10);
      assert.ok(Math.abs(points[1][1]-1)<1e-10);
    }
  }
});

test('拒绝退化参数和零方向，双曲线及抛物线的线性退化不捏造第二个点', async () => {
  for(const file of sources) {
    const intersect=await geometryAt(file),line={p0:[0,0],dir:[1,0]};
    for(const conic of [{kind:'circle',r:0},{kind:'circle',r:-1},{kind:'ellipse',a:2,b:0},{kind:'hyperbola',a:2,b:-1},{kind:'parabola',p:0},{kind:'unknown'}]) {
      assert.deepEqual(intersect(line,conic),[],JSON.stringify(conic));
    }
    assert.deepEqual(intersect({p0:[0,0],dir:[0,0]},{kind:'circle',r:1}),[]);
    assert.deepEqual(intersect({p0:[0,0],dir:[1,Infinity]},{kind:'circle',r:1}),[]);
    assert.deepEqual(intersect(line,{kind:'hyperbola',a:2,b:1}),[[-2,0],[2,0]]);
    assert.deepEqual(intersect(line,{kind:'parabola',p:2}),[[0,0]]);
    const one=intersect({p0:[0,1],dir:[1,.5]},{kind:'hyperbola',a:2,b:1});
    assert.equal(one.length,1);
    assert.ok(Math.abs(one[0][0]*one[0][0]/4-one[0][1]*one[0][1]-1)<1e-9);
  }
});
