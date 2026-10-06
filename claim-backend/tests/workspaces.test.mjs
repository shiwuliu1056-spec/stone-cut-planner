import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,utimes,stat,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ensureOwnedWorkspace,cleanupAbandonedWorkspaces,processIsAlive} from '../workspaces.mjs';
test('cleanup preserves live workspaces even after TTL and only removes expired dead owners',async t=>{
  const root=await mkdtemp(join(tmpdir(),'claim-workspace-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const old=new Date(Date.now()-3600000),now=Date.now();
  async function fixture(owner,expired=true){
    const path=join(root,randomUUID());await mkdir(path);
    if(owner)await writeFile(join(path,'.owner.json'),JSON.stringify(owner));
    await writeFile(join(path,'retained.txt'),'test');if(expired)await utimes(path,old,old);
    return path;
  }
  const live=await fixture({version:1,pid:process.pid,host:hostname()});
  const dead=await fixture({version:1,pid:99999999,host:hostname()});
  const recent=await fixture({version:1,pid:99999999,host:hostname()},false);
  const legacy=await fixture(null);
  const foreign=await fixture({version:1,pid:99999999,host:'another-host'});
  const malformed=await fixture({version:1,pid:0,host:hostname()});
  assert.equal(processIsAlive(process.pid),true);
  const removed=await cleanupAbandonedWorkspaces(root,{ttl:1800000,now,isAlive:pid=>pid===process.pid});
  assert.equal(removed.length,1);await assert.rejects(stat(dead),{code:'ENOENT'});
  for(const path of [live,recent,legacy,foreign,malformed])assert.equal(await readFile(join(path,'retained.txt'),'utf8'),'test');
  await cleanupAbandonedWorkspaces(root,{exclude:live,ttl:0,now:Date.now()+1,isAlive:()=>false});
  assert.ok(await stat(live),'排除本进程自己的工作目录');
});
test('task preparation restores an externally missing directory and its owner protection',async t=>{
  const root=await mkdtemp(join(tmpdir(),'claim-workspace-recovery-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,randomUUID());await ensureOwnedWorkspace(path);await rm(path,{recursive:true});
  await ensureOwnedWorkspace(path);const task=join(path,randomUUID());await mkdir(task);
  const owner=JSON.parse(await readFile(join(path,'.owner.json'),'utf8'));
  assert.equal(owner.pid,process.pid);assert.equal(owner.host,hostname());assert.ok(await stat(task));
});
