import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chord, findCards } = require('../../implementation/textbook-library.js');
test('common chord: authored example and transfer exercise', () => {
  for (const [distance, length] of [[6, 8], [8, 6]]) {
    const result = chord(5, distance);
    assert.equal(result.relation, 'intersect');
    assert.equal(result.length, length);
    const x = distance / 2, y = length / 2;
    assert.equal(x*x+y*y, 25);
    assert.equal((x-distance)**2+y*y, 25);
  }
});
test('a radical axis does not imply a two-point common chord', () => {
  assert.deepEqual(chord(5,12), {relation:'separate',length:null});
  assert.deepEqual(chord(5,10), {relation:'tangent',length:0});
  assert.deepEqual(chord(5,0), {relation:'coincident',length:null});
  assert.throws(() => chord(-5,6), RangeError);
});
test('topic and keyword filters compose, including empty results', () => {
  assert.equal(findCards('直线与圆','方程相减')[0].id, 'common-chord');
  assert.equal(findCards('立体几何','公共弦').length, 0);
  assert.equal(findCards('全部主题','  公共弦  ').length, 3);
  assert.equal(findCards('全部主题','不存在的考法').length, 0);
});
