import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{resolveTarget}=require('../../miniprogram/packages/claim/shared/focus-target.js');
test('scalar questions and hidden questions resolve to visible controls',()=>{
  const fields=[{key:'totalAmount',required:true},{key:'claimInterest'},{key:'represented'},{key:'contractForm'}];
  assert.equal(resolveTarget('totalAmount',0,fields,{},[],[]).domId,'field-totalAmount');
  assert.equal(resolveTarget('interestTerms',0,fields,{},[],[]).key,'claimInterest');
  assert.equal(resolveTarget('agentPhone',1,fields,{},[],[]).key,'represented');
  assert.equal(resolveTarget('jurisdictionClause',0,fields,{},[],[]).key,'contractForm');
});
test('upload checks locate the incomplete group or a specifically failed file group',()=>{
  const rows=[{id:'a',name:'身份证',count:2},{id:'b',name:'营业执照',count:0}];
  assert.equal(resolveTarget('uploads:plaintiff',1,[],{},rows,[]).rowId,'b');
  assert.equal(resolveTarget('uploads:plaintiff',1,[],{},rows,[],'a').rowId,'a');
  const evidence=[{id:'record',kind:'media',name:'录音',source:'本人',purpose:'催款',fileCount:1.5}];
  assert.equal(resolveTarget('evidence',3,[],{},[],evidence).rowId,'record');
  assert.equal(resolveTarget('',1,[],{},rows,[]).domId,'identity-row-b');
});
