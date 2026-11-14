import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {setSharingRole} from '../../deployment/tencent-demo/manage-sharing-role.mjs';
test('管理员离线授予教师有审计；服务运行时拒绝覆盖数据',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'edu-role-command-')), dataFile=path.join(temp,'data.json');
  const server=net.createServer();
  try{
    await writeFile(dataFile,JSON.stringify({users:[{id:'student',role:'student'}],cases:[{id:'keep'}]}));
    await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
    await assert.rejects(setSharingRole({dataFile,userId:'student',role:'teacher',actor:'operator',reason:'已确认任课教师',port}),/STOP_LEARNING_SERVICE_FIRST/);
    await new Promise(r=>server.close(r));
    await setSharingRole({dataFile,userId:'student',role:'teacher',actor:'operator',reason:'已确认任课教师',port});
    const data=JSON.parse(await readFile(dataFile,'utf8'));
    assert.equal(data.users[0].role,'teacher'); assert.equal(data.sharingRoleAudit[0].previousRole,'student'); assert.equal(data.cases[0].id,'keep');
  }finally{if(server.listening)await new Promise(r=>server.close(r));assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));await rm(temp,{recursive:true,force:true});}
});
