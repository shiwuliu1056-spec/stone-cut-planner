import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),links=require('../../miniprogram/packages/claim/shared/issue-links.js');
test('encoded or already decoded Chinese links show readable hints and retain return context',()=>{
  const hint='请核对送货单和证据来源，利率为20%。',url=links.issueUrl({step:3,field:'uploads:evidence',advice:hint,targetRowId:'evidence-1'});
  const raw=Object.fromEntries(url.split('?')[1].split('&').map(pair=>pair.split('=')));
  assert.deepEqual(links.readTarget(raw),{field:'uploads:evidence',hint,row:'evidence-1',fromReview:true,shouldFocus:true});
  assert.equal(links.readTarget({hint,field:'evidence'}).hint,hint);
  assert.equal(links.decodeParam(encodeURIComponent(encodeURIComponent(hint))),hint);
  assert.equal(links.decodeParam('不完整%E8%'), '不完整%E8%');
  assert.equal(links.readTarget({}).fromReview,false);
});
test('return uses original review page when available; otherwise opens review directly',()=>{
  let definition,call;global.Component=value=>{definition=value;};global.wx={navigateBack:args=>{call={type:'back',args};},redirectTo:args=>{call={type:'redirect',args};}};
  require('../../miniprogram/packages/claim/components/claim-form/index.js');
  global.getCurrentPages=()=>[{route:'pages/index/index'},{route:'packages/claim/pages/review/index'},{route:'packages/claim/pages/evidence/index'}];
  definition.methods.backToReview();assert.equal(call.type,'back');assert.equal(call.args.delta,1);
  global.getCurrentPages=()=>[{route:'pages/index/index'},{route:'packages/claim/pages/evidence/index'}];
  definition.methods.backToReview();assert.equal(call.type,'redirect');assert.equal(call.args.url,'/packages/claim/pages/review/index');
});
