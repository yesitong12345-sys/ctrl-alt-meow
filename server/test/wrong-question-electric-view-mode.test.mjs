import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('确认电场调制后可切换并保存完整面板或仅曲线视图', async () => {
  const source = await readFile(new URL('../../implementation/wrong-question-entry.js', import.meta.url), 'utf8');
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const mount = source.slice(source.indexOf('function mountElectricMini('), source.indexOf('renderLibrary=function(v)'));

  assert.match(mount, /dataset\.efMiniViewSwitch=''/);
  assert.match(mount, /data-ef-mini-view="panel"/);
  assert.match(mount, /data-ef-mini-view="curves"/);
  assert.match(mount, /root\.classList\.toggle\('curves-only'/);
  assert.match(mount, /saveElectricModel\(record,\{\.\.\.model,simulation:sim\}\)/);
  assert.match(mount, /viewSwitch\.hidden=!locked/);
  assert.match(server, /incoming\.displayMode==='curves'\|\|incoming\.displayMode==='panel'/);
});
