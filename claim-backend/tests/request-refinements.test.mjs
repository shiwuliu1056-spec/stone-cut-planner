import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),storage=new Map();let toast,definition,modal;
global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),env:{USER_DATA_PATH:'/test'},getFileSystemManager:()=>({accessSync(){},unlinkSync(){},rmdirSync(){}}),showToast:value=>{toast=value;},showActionSheet:value=>value.success({tapIndex:0}),showModal:value=>{modal=value;}};
const draft=require('../../miniprogram/shared/claim/draft.js'),api=require('../../miniprogram/packages/claim/shared/api.js');
global.Component=value=>{definition=value;};require('../../miniprogram/packages/claim/components/claim-form/index.js');
const {humanHint}=require('../../miniprogram/packages/claim/shared/human-hints.js');
test('new, reset and sample default to no interest claim; additions show success',()=>{
  for(const sample of [false,true]){draft.reset(sample);assert.equal(draft.get().state.claimInterest,false);assert.equal(draft.get().state.interestTerms,'');}
  const form={reload(){}};definition.methods.addIdentity.call(form);assert.equal(toast.title,'添加成功');assert.equal(draft.get().state.identityMaterials.length,2);
  definition.methods.addEvidence.call(form);assert.equal(toast.title,'添加成功');assert.equal(draft.get().state.evidence.length,2);
  definition.methods.addDefendant.call(form);assert.equal(draft.get().state.defendantMaterials.length,2);
});
test('legacy defendant files migrate to named groups without losing local files',()=>{
  const current=draft.get();delete current.state.defendantMaterials;current.files=[{id:'old',group:'defendant',name:'old.png',size:2,localPath:'/test/old.png'}];
  const migrated=draft.get();assert.equal(migrated.files[0].localPath,'/test/old.png');assert.equal(migrated.files[0].materialId,migrated.state.defendantMaterials[0].id);
  assert.ok(migrated.state.defendantMaterials[0].name);draft.updateRow('defendantMaterials',migrated.state.defendantMaterials[0].id,'name','工商查询');
  assert.equal(draft.manifest()[0].materialId,migrated.state.defendantMaterials[0].id);
});
test('hints contain content titles and one-click optimization is only applied after confirmation',async()=>{
  assert.ok(!/claimInterest|interestTerms/.test(humanHint('claimInterest为否但interestTerms有内容')));
  draft.reset(true);draft.setField('demandHistory','我多次催款，对方一直没有支付。');
  const before=draft.get().state.demandHistory;
  const form=Object.assign({alive:true,properties:{canOptimize:true,optimizationIssue:{field:'demandHistory'}},data:{optimizeBusy:false},setData(value){Object.assign(this.data,value);},reload(){},error(error){throw error;}},{});
  api.call=async()=>({changes:[{field:'demandHistory',before,after:'我已多次催款，但对方至今没有支付。'}]});
  await definition.methods.optimize.call(form);assert.equal(draft.get().state.demandHistory,before);assert.ok(modal.content.includes('优化后'));
  modal.success({confirm:true});assert.equal(draft.get().state.demandHistory,'我已多次催款，但对方至今没有支付。');assert.equal(toast.title,'优化已应用');
  await definition.methods.optimize.call(form);draft.setField('demandHistory','用户自行修改');modal.success({confirm:true});assert.equal(draft.get().state.demandHistory,'用户自行修改','确认时案件已经变化则不能覆盖');
});
test('package download does not trigger sharing',async()=>{
  let page,shared=false,downloaded=false;global.Page=value=>{page=value;};require('../../miniprogram/packages/claim/pages/result/index.js');
  global.wx.showLoading=()=>{};global.wx.hideLoading=()=>{};global.wx.shareFileMessage=()=>{shared=true;};
  await page.downloadPackage.call({getFile:async output=>{assert.equal(output.id,'package');downloaded=true;},error(error){throw error;}});
  assert.equal(downloaded,true);assert.equal(shared,false);assert.equal(toast.title,'已下载到本机');
});
