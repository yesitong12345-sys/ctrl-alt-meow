import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('椭圆面板只走显式参数接口和本地渲染，不会触发AI或提前展示结果',async()=>{
  const panel=await readFile(new URL('../../implementation/ellipse-model-panel.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../../implementation/index.html',import.meta.url),'utf8');
  assert.match(html,/plane-ellipse-core\.js/);assert.match(html,/ellipse-model-panel\.js/);
  assert.match(panel,/\/ellipse-model/);assert.match(panel,/confirmed:true/);assert.match(panel,/window\.__eduPlaneEllipse\?\.render/);
  assert.match(panel,/不会从题干猜参数或调用 AI/);assert.match(panel,/计算结论仍受原有答案解锁规则控制/);
  assert.doesNotMatch(panel,/rebuild-steps|deepseek|fetch\([^)]*ai/i);
});
