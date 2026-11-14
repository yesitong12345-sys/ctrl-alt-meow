import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {backup} from '../../deployment/tencent-demo/backup.mjs';
import {restore} from '../../deployment/tencent-demo/restore.mjs';

test('backup validates JSON, copies uploads, and retains 14 dated copies', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'edu-backup-test-'));
  const dataFile=path.join(root,'data.json'), uploadDir=path.join(root,'uploads'), backups=path.join(root,'backups');
  await mkdir(uploadDir);
  await writeFile(dataFile,JSON.stringify({users:[],cases:[]}));
  await writeFile(path.join(uploadDir,'sample.png'),'fake-test-image');
  for(let day=1;day<=15;day++) await backup({root:backups,dataFile,uploadDir,now:new Date(Date.UTC(2026,0,day))});
  const entries=await readdir(backups);
  assert.equal(entries.length,14);
  assert.equal(await readFile(path.join(backups,entries.at(-1),'uploads','sample.png'),'utf8'),'fake-test-image');
  await writeFile(dataFile,'not-json');
  await assert.rejects(backup({root:backups,dataFile,uploadDir}),SyntaxError);
  assert.equal((await readdir(backups)).length,14);
  await assert.rejects(restore({backupId:entries.at(-1),root,backups,serviceActive:()=>true}),/STOP_SERVICE_BEFORE_RESTORE/);
  const result=await restore({backupId:entries.at(-1),root,backups});
  assert.equal(await readFile(result.preserved,'utf8'),'not-json');
  assert.deepEqual(JSON.parse(await readFile(dataFile,'utf8')),{users:[],cases:[]});
});
