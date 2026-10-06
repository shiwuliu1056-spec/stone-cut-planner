import {mkdir,readFile,readdir,writeFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {hostname} from 'node:os';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER_FILE='.owner.json';
export function processIsAlive(pid){
  try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
export async function ensureOwnedWorkspace(workRoot){
  await mkdir(workRoot,{recursive:true});
  await writeFile(join(workRoot,OWNER_FILE),JSON.stringify({version:1,pid:process.pid,host:hostname()}),{mode:0o600});
}
export async function cleanupAbandonedWorkspaces(serviceRoot,{exclude,ttl,now=Date.now(),isAlive=processIsAlive}={}){
  const entries=await readdir(serviceRoot,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const removed=[];
  for(const entry of entries){
    if(!entry.isDirectory()||!UUID.test(entry.name))continue;
    const target=join(serviceRoot,entry.name);if(target===exclude)continue;
    try{
      const info=await stat(target);if(info.mtimeMs+ttl>=now)continue;
      // 未标记、异地主机或无法确认的目录均保留，不能只凭目录年龄推断进程退出。
      const owner=JSON.parse(await readFile(join(target,OWNER_FILE),'utf8'));
      if(owner.version!==1||owner.host!==hostname()||!Number.isInteger(owner.pid)||owner.pid<=0)continue;
      if(await isAlive(owner.pid))continue;
      // 删除前再次确认，避免清理扫描与目录更新发生竞态。
      const latest=await stat(target),latestOwner=JSON.parse(await readFile(join(target,OWNER_FILE),'utf8'));
      if(latest.mtimeMs!==info.mtimeMs||latestOwner.pid!==owner.pid||latestOwner.host!==owner.host||await isAlive(owner.pid))continue;
      await rm(target,{recursive:true,force:true});removed.push(entry.name);
    }catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)continue;throw error;}
  }
  return removed;
}
