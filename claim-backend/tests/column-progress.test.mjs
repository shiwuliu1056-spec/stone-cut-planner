import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),storage=new Map(),readable=new Set();
global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),env:{USER_DATA_PATH:'/test'},getFileSystemManager:()=>({accessSync(path){if(!readable.has(path))throw Error('missing');},unlinkSync(){},rmdirSync(){}})};
const draft=require('../../miniprogram/shared/claim/draft.js');
test('five column percentages reflect fields, files and conditional obligations',()=>{
  draft.reset(true);let progress=draft.columnProgress();assert.equal(progress.length,5);assert.equal(progress[0],100);assert.equal(progress[2],100);assert.equal(progress[4],100);assert.ok(progress[1]<100);assert.ok(progress[3]<100);
  const current=draft.get(),material=current.state.identityMaterials[0],evidence=current.state.evidence[0];
  readable.add('/test/id.png');readable.add('/test/chat.png');current.files.push({id:'id',group:'plaintiff',materialId:material.id,name:'id.png',size:1,localPath:'/test/id.png'},{id:'chat',group:'evidence',evidenceId:evidence.id,name:'chat.png',size:1,localPath:'/test/chat.png'});
  assert.deepEqual(draft.columnProgress(),[100,100,100,100,100]);
  readable.delete('/test/id.png');assert.ok(draft.columnProgress()[1]<100,'失效文件不能计为完成');
  draft.setField('includeRefundAccount',true);assert.ok(draft.columnProgress()[4]<100,'勾选账户后需补齐账户字段');
  draft.setField('represented','yes');assert.ok(draft.columnProgress()[1]<100,'委托代理时需补齐代理信息和附件');
  draft.addRow('evidence','media');assert.ok(draft.columnProgress()[3]<100,'新增空白影音证据使进度下降');
});
