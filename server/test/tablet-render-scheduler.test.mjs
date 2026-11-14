import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('按需渲染空闲停止、连续运动限频、暂停恢复和销毁清理',async()=>{
  let next=0,time=0,draws=0,moving=false;const queue=new Map();
  const context={console,window:null,document:{hidden:false},navigator:{maxTouchPoints:1},requestAnimationFrame:fn=>{queue.set(++next,fn);return next;},cancelAnimationFrame:id=>queue.delete(id)};context.window=context;context.globalThis=context;
  vm.runInNewContext(await readFile(new URL('../../implementation/tablet-geometry-runtime.js',import.meta.url),'utf8'),context);
  context.__eduAuthSessionToken='pending';assert.equal(context.__eduTabletGeometry.allowed({user_id:'a'}),false);
  context.__eduSessionUserId='a';assert.equal(context.__eduTabletGeometry.allowed({user_id:'a'}),true);assert.equal(context.__eduTabletGeometry.allowed({user_id:'b'}),false);
  context.__eduSchoolAuthRequired=true;context.__eduSessionUserId='';assert.equal(context.__eduTabletGeometry.allowed({user_id:'local-student'}),false);
  const scheduler=context.__eduTabletGeometry.createScheduler({draw:()=>draws++,needsMotion:()=>moving});
  const tick=()=>{time+=17;const callbacks=[...queue.values()];queue.clear();callbacks.forEach(fn=>fn(time));};
  scheduler.invalidate();for(let i=0;i<20;i++)tick();assert.equal(draws,1);assert.equal(queue.size,0);
  moving=true;scheduler.invalidate();for(let i=0;i<60;i++)tick();assert.ok(draws>=25&&draws<=32);
  scheduler.pause(true);const before=draws;for(let i=0;i<10;i++)tick();assert.equal(draws,before);
  moving=false;scheduler.pause(false);tick();tick();assert.ok(draws>before);
  scheduler.dispose();assert.equal(queue.size,0);scheduler.invalidate();tick();assert.equal(queue.size,0);
});
