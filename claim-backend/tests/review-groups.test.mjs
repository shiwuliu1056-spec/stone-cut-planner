import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {groupIssues,groupAiIssues}=require('../../miniprogram/packages/claim/shared/review-groups.js');
const schema=require('../../miniprogram/shared/claim/schema.js');
test('group issues by column without losing original click targets',()=>{
  const issues=[{step:3,title:'证据问题一',field:'evidence'},{step:0,title:'金额问题',field:'totalAmount'},{step:3,title:'证据问题二',field:'evidence'},{step:1,title:'身份文件问题',field:'identityMaterials'}];
  const groups=groupIssues(issues,schema.steps);
  assert.deepEqual(groups.map(group=>group.step),[0,1,3]);
  assert.equal(groups[2].title,'证据目录');assert.equal(groups[2].items.length,2);
  groups.forEach(group=>group.items.forEach(item=>assert.deepEqual(issues[item.sourceIndex],issues.find(issue=>issue.title===item.title))));
  assert.deepEqual(groups[2].items.map(item=>item.sourceIndex),[0,2]);assert.deepEqual(groupIssues([],schema.steps),[]);
});
test('AI groups are broad, omit empty groups and retain source targets with continuous displayed numbering',()=>{
  const issues=[{step:3,field:'evidence',title:'送货证据不足'},{step:0,field:'totalAmount',title:'金额计算有误'},{step:0,field:'plaintiffName',title:'原告主体需核对'},{step:0,field:'totalAmount',title:'前后金额不一致'},{step:0,field:'deliveryDate',title:'交易时间需核对'}];
  const groups=groupAiIssues(issues);
  assert.deepEqual(groups.map(group=>group.title),['当事人与受理','诉求与金额','事实与证据','表述与一致性']);
  const items=groups.flatMap(group=>group.items);
  assert.deepEqual(items.map(item=>item.displayNumber),[1,2,3,4,5]);
  assert.deepEqual(items.map(item=>item.sourceIndex),[2,1,0,4,3]);
  items.forEach(item=>assert.equal(item.field,issues[item.sourceIndex].field));
  assert.equal(issues[0].displayNumber,undefined,'不得修改已保存的AI结果');
  assert.equal(groupAiIssues([issues[0]])[0].title,'事实与证据');
  assert.deepEqual(groupAiIssues([]),[]);
});
