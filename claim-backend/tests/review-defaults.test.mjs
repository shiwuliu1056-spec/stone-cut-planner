import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
global.wx={getStorageSync:()=>null,setStorageSync(){},env:{USER_DATA_PATH:'/test'},getFileSystemManager:()=>({accessSync(){},unlinkSync(){}})};
let definition;global.Component=value=>{definition=value;};
require('../../miniprogram/packages/claim/components/claim-form/index.js');
const draft=require('../../miniprogram/packages/claim/shared/draft.js'),api=require('../../miniprogram/packages/claim/shared/api.js');
function form(){return Object.assign({properties:{step:5},data:structuredClone(definition.data),alive:true,aiRequested:false,collapsedGroups:{},collapsedAiGroups:{},setData(values){Object.assign(this.data,values);}},definition.methods,{error(err){this.lastError=err.message;}});}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('review automatically runs once, reuses unchanged results and defaults all groups to collapsed',async()=>{
  draft.reset(true);let count=0,release;
  api.call=async()=>{count++;return new Promise(resolve=>{release=resolve;});};
  const page=form();page.reload();assert.ok(page.data.issueGroups.length);assert.ok(page.data.issueGroups.every(group=>!group.expanded));
  page.ensureReview();page.ensureReview();assert.equal(count,1);assert.equal(page.data.busy,true);
  release({issues:[{step:3,field:'evidence',title:'证据问题'}]});await tick();
  assert.equal(page.data.busy,false);assert.ok(page.data.aiGroups.every(group=>!group.expanded));
  page.ensureReview();assert.equal(count,1);
  const revisited=form();revisited.reload();revisited.ensureReview();assert.equal(count,1);assert.ok(revisited.data.ai);assert.ok(revisited.data.aiGroups.every(group=>!group.expanded));
  draft.setField('totalAmount',123);revisited.ensureReview();assert.equal(count,2);
  release({issues:[]});await tick();assert.equal(revisited.data.busy,false);
  api.call=async()=>{count++;throw Error('测试连接失败');};
  draft.setField('totalAmount',456);revisited.ensureReview();await tick();revisited.ensureReview();
  assert.equal(count,3,'失败后不能无限自动重试');assert.equal(revisited.lastError,'测试连接失败');
});
test('renamed entry points and title actions keep the requested review layout',async()=>{
  const root='../miniprogram/';
  const wxml=await readFile(root+'packages/claim/components/claim-form/index.wxml','utf8');
  const css=await readFile(root+'packages/claim/components/claim-form/index.wxss','utf8');
  const globalCss=await readFile(root+'packages/claim/claim.wxss','utf8');
  assert.match(wxml,/class="card system-check-card"/);assert.match(css,/system-check-card \.review-group-head\{background:#fcf3e6/);
  assert.match(globalCss,/\.row>button\{[^}]*margin-left:auto;[^}]*margin-right:0/);
  for(const file of ['components/claim-home/index.wxml','packages/claim/pages/review/index.wxml','packages/claim/pages/review/index.json']){
    const source=await readFile(root+file,'utf8');assert.ok(source.includes('检查下载'));assert.ok(!source.includes('AI 核对与下载'));assert.ok(!source.includes('AI核对与下载'));
  }
});
