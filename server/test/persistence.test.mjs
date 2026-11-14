import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createJsonPersistence, createPostgresPersistence} from '../workflows/persistence.mjs';

test('JSON persistence exposes an atomic load/save interface', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edu-persistence-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const filePath = path.join(directory, 'data.json');
  const store = createJsonPersistence({
    filePath,
    defaultValue: () => ({users:[], cases:[]}),
    normalize: value => ({users:Array.isArray(value.users)?value.users:[], cases:Array.isArray(value.cases)?value.cases:[]})
  });
  assert.deepEqual(await store.load(), {users:[], cases:[]});
  await Promise.all([
    store.save({users:[{id:'student-a'}],cases:[]}),
    store.save({users:[{id:'student-a'}],cases:[{id:'case-1'}]})
  ]);
  assert.deepEqual(await store.load(), {users:[{id:'student-a'}],cases:[{id:'case-1'}]});
  assert.equal((await readFile(filePath,'utf8')).includes('student-a'), true);
});

test('JSON persistence retries a later save after a transient filesystem failure', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'edu-persistence-retry-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const parent = path.join(directory, 'data');
  const store = createJsonPersistence({filePath:path.join(parent, 'data.json'), defaultValue:() => ({cases:[]})});
  await assert.rejects(store.save({cases:[{id:'first'}]}), {code:'ENOENT'});
  await mkdir(parent);
  await store.save({cases:[{id:'second'}]});
  assert.deepEqual(await store.load(), {cases:[{id:'second'}]});
});

test('PostgreSQL persistence implements the same contract without embedding credentials', async () => {
  let stored=null;
  const statements=[];
  const query=async(sql,params=[])=>{
    statements.push({sql,params});
    if(/^SELECT/.test(sql))return {rows:stored?[{payload:stored}]:[]};
    if(/^INSERT/.test(sql)){stored=JSON.parse(params[1]);return {rowCount:1};}
    return {rowCount:0};
  };
  const store=createPostgresPersistence({query,defaultValue:()=>({users:[],cases:[]}),normalize:value=>({...value,users:value.users||[],cases:value.cases||[]})});
  assert.equal(store.kind,'postgres');
  assert.deepEqual(await store.load(),{users:[],cases:[]});
  await store.save({users:[{id:'student-a'}],cases:[{id:'case-a'}]});
  assert.deepEqual(await store.load(),{users:[{id:'student-a'}],cases:[{id:'case-a'}]});
  assert.ok(statements.some(item=>item.sql.includes('CREATE TABLE IF NOT EXISTS edu_app_state')));
  assert.ok(statements.some(item=>item.sql.includes('ON CONFLICT')));
  assert.equal(JSON.stringify(statements).includes('sk-'),false);
});
