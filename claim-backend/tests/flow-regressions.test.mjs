import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),storage=new Map();let pageDefinition,navigations=[];
global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),env:{USER_DATA_PATH:'/test'},getFileSystemManager:()=>({accessSync(){},unlinkSync(){},rmdirSync(){}}),showModal:options=>options.success({confirm:true}),showToast(){},navigateTo:options=>navigations.push(options.url)};
global.Page=definition=>{pageDefinition=definition;};
const draft=require('../../miniprogram/shared/claim/draft.js');
const api=require('../../miniprogram/packages/claim/shared/api.js');
const generation=require('../../miniprogram/packages/claim/shared/generation.js');
function makePage(definition){return Object.assign({},definition,{data:structuredClone(definition.data||{}),setData(values){Object.assign(this.data,values);}});}
test('sample and clear update homepage directly; both template partitions survive',()=>{
  assert.equal(draft,require('../../miniprogram/packages/claim/shared/draft.js'),'首页和表单共享同一个案件实例');
  storage.set('jiujiang-claim-plaintiff-templates-v1',{version:1,items:[{id:'p'}]});storage.set('jiujiang-claim-defendant-templates-v1',{version:1,items:[{id:'d'}]});
  const overview=require('../../miniprogram/shared/claim/home.js');const page=makePage({...overview.methods,data:overview.data});
  draft.reset(false);const original=draft.get().caseId;page.useSample();
  assert.ok(draft.get().state.plaintiffName);assert.notEqual(draft.get().caseId,original);assert.equal(page.data.steps.length,5);assert.equal(navigations.length,0);
  page.clearCase();assert.equal(draft.get().state.plaintiffName,'');assert.equal(navigations.length,0);
  assert.equal(storage.get('jiujiang-claim-plaintiff-templates-v1').items.length,1);assert.equal(storage.get('jiujiang-claim-defendant-templates-v1').items.length,1);
});
test('draft generation creates a task and calls generation endpoint, including expired server tasks',async()=>{
  draft.reset(true);const messages=[],calls=[];let seq=0;
  api.base=()=> 'http://local';api.call=async(path,method)=>{
    calls.push({path,method});
    if(path==='/tasks')return {id:'task-'+(++seq),status:'uploading',uploadedIds:[],expiresAt:Date.now()+10000,progress:0};
    if(path.endsWith('/generate'))return {id:'task-'+seq,status:'queued',progress:10,uploadedIds:[],expiresAt:Date.now()+10000};
    throw Object.assign(new Error('expired'),{status:404});
  };
  const task=await generation.generate({onMessage:message=>messages.push(message)});
  assert.equal(task.status,'queued');assert.ok(calls.some(call=>call.path==='/tasks/task-1/generate'));assert.ok(messages.length>=2);
  await generation.generate();assert.ok(calls.some(call=>call.path==='/tasks/task-2/generate'),'服务器重启后失效任务自动重新创建');
});
test('file uploads use a bounded pool and skip files already on the server',async()=>{
  draft.reset(true);const current=draft.get(),materialId=current.state.identityMaterials[0].id;
  current.files=Array.from({length:5},(_,index)=>({id:'parallel-'+index,group:'plaintiff',materialId,name:'测试'+index+'.png',size:1,localPath:'/test/'+index}));draft.persist(true);
  api.base=()=> 'http://local';let running=0,peak=0;const uploaded=[];
  api.call=async(path)=>path==='/tasks'?{id:'parallel-task',status:'uploading',uploadedIds:['parallel-0'],expiresAt:Date.now()+10000,progress:0}:path.endsWith('/generate')?{id:'parallel-task',status:'queued',progress:10,uploadedIds:[],expiresAt:Date.now()+10000}:null;
  api.upload=async(_task,file)=>{running++;peak=Math.max(peak,running);await new Promise(resolve=>setTimeout(resolve,8));uploaded.push(file.id);running--;};
  const task=await generation.generate();
  assert.equal(task.status,'queued');assert.equal(peak,3);assert.equal(running,0);
  assert.deepEqual(uploaded.sort(),['parallel-1','parallel-2','parallel-3','parallel-4']);
});
test('reset while generating cannot write old generation into a new case',async()=>{
  draft.reset(true);let resolveTask;api.call=()=>new Promise(resolve=>{resolveTask=resolve;});
  const work=generation.generate();draft.reset(false);resolveTask({id:'old-task',status:'uploading',uploadedIds:[],expiresAt:Date.now()+10000});
  await assert.rejects(()=>work,/案件内容已变化/);assert.equal(draft.get().result,null);
});
test('failure before task creation remains visible on generation page',async()=>{
  require('../../miniprogram/packages/claim/pages/result/index.js');const page=makePage(pageDefinition);page.active=true;page.caseId=draft.get().caseId;
  api.call=async()=>{throw new Error('连接失败，请重试');};await page.generate();
  assert.equal(page.data.failed,true);assert.equal(page.data.busy,false);assert.equal(page.data.result,null);assert.match(page.data.message,/连接失败/);
});
test('successful result page shows files without repeated completion headings or a status card',async()=>{
  draft.reset(true);const current=draft.get();
  current.result={id:'success',revision:current.revision,caseId:current.caseId,expiresAt:Date.now()+10000,status:'generating',outputs:[]};
  const page=makePage(pageDefinition);page.active=true;page.caseId=current.caseId;page.setData({busy:true,message:'正在生成…'});
  api.call=async()=>({id:'success',status:'ready',progress:100,outputs:[{id:'pdf-1',name:'01_起诉状.pdf'}]});
  await page.poll();assert.equal(page.data.pageTitle,'本案资料');assert.equal(page.data.busy,false);assert.equal(page.data.failed,false);assert.equal(page.data.message,'');assert.equal(page.data.result.outputs.length,1);
  const source=await readFile('../miniprogram/packages/claim/pages/result/index.wxml','utf8');
  assert.ok(!source.includes('<view class="title">{{pageTitle}}</view>'));
  assert.ok(source.includes('wx:if="{{busy || failed}}"'));assert.ok(source.includes('重新生成资料包'));
});
