import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), storage=new Map(), files=new Map();
const fs={
  mkdirSync(){},rmdirSync(){},
  accessSync(path){if(!files.has(path))throw Error('missing');},
  unlinkSync(path){files.delete(path);},
  copyFile({srcPath,destPath,success,fail}){if(!files.has(srcPath))return fail(new Error('missing'));files.set(destPath,files.get(srcPath));success({});}
};
global.wx={getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,structuredClone(value)),env:{USER_DATA_PATH:'/local-test'},getFileSystemManager:()=>fs};
const draft=require('../../miniprogram/packages/claim/shared/draft.js');
const templates=require('../../miniprogram/packages/claim/shared/plaintiff-templates.js');
test('multiple plaintiff templates survive reset; files are independent and cases stay intact',async()=>{
  draft.reset(false);draft.setField('plaintiffName','原告甲');draft.setField('plaintiffPhone','13800000000');
  const group=draft.get().state.identityMaterials[0];files.set('/local-test/selected.png','image');
  draft.get().files.push({id:'source',group:'plaintiff',materialId:group.id,name:'身份证.png',size:5,localPath:'/local-test/selected.png'});
  const first=await templates.save(templates.sourceFromCase());
  assert.notEqual(first.files[0].localPath,'/local-test/selected.png');
  draft.reset(false);assert.ok(files.has(first.files[0].localPath),'清空案件保留模板原件');
  draft.setField('plaintiffName','原告乙');const second=await templates.save(templates.sourceFromCase());
  assert.equal(templates.list().length,2);
  draft.setField('defendantName','被告公司');draft.setField('goods','本案货物');draft.setField('totalAmount','12345');draft.addRow('evidence','media');
  await templates.apply(first.id);
  assert.equal(draft.get().state.plaintiffName,'原告甲');assert.equal(draft.get().state.serviceRecipient,'原告甲');
  assert.equal(draft.get().state.defendantName,'被告公司');assert.equal(draft.get().state.goods,'本案货物');assert.equal(draft.get().state.totalAmount,'12345');assert.equal(draft.get().state.evidence.length,2);
  const caseFile=draft.get().files.find(file=>file.group==='plaintiff');assert.notEqual(caseFile.localPath,first.files[0].localPath);assert.equal(caseFile.materialId,draft.get().state.identityMaterials[0].id);
  templates.remove(first.id);assert.ok(files.has(caseFile.localPath),'删除模板不删除已用于案件的副本');assert.equal(templates.list().length,1);
  draft.reset(true);assert.equal(templates.list()[0].id,second.id,'使用示例也保留模板');
  const input=templates.get(second.id);input.fields.plaintiffName='原告乙（修改）';input.label='更新模板';
  const updated=await templates.save(input);assert.equal(updated.id,second.id);assert.equal(templates.list().length,1);
  await templates.apply(updated.id);draft.setField('plaintiffName','本案临时修改');assert.equal(templates.get(updated.id).fields.plaintiffName,'原告乙（修改）');
});
test('missing template file fails without replacing current plaintiff or case files',async()=>{
  const template=templates.get(templates.list()[0].id);
  files.set('/local-test/temporary.png','new image');template.files=[{id:'new',materialId:template.materials[0].id,name:'材料.png',size:9,sourcePath:'/local-test/temporary.png'}];
  const saved=await templates.save(template);files.delete(saved.files[0].localPath);
  const before=structuredClone(draft.get());await assert.rejects(()=>templates.apply(saved.id),/无法读取/);
  assert.deepEqual(draft.get(),before,'失败前不能清空旧原告或附件');
});
test('defendant templates stay separate and never alter plaintiff identity materials',async()=>{
  draft.setField('defendantName','被告模板公司');draft.setField('defendantPhone','13900000000');
  files.set('/local-test/defendant.pdf','pdf');draft.get().files.push({id:'def-file',group:'defendant',name:'工商线索.pdf',size:3,localPath:'/local-test/defendant.pdf'});
  const originalIdentity=structuredClone(draft.get().state.identityMaterials),originalPlaintiff=draft.get().state.plaintiffName;
  const template=await templates.save(templates.sourceFromCase('defendant'),'defendant');
  assert.equal(templates.list('defendant').length,1);assert.ok(templates.list().length>=1);
  draft.setField('defendantName','临时被告');await templates.apply(template.id,'defendant');
  assert.equal(draft.get().state.defendantName,'被告模板公司');assert.equal(draft.get().state.plaintiffName,originalPlaintiff);assert.deepEqual(draft.get().state.identityMaterials,originalIdentity);
  assert.equal(draft.get().files.filter(file=>file.group==='defendant').length,1);
  draft.reset(false);assert.equal(templates.list('defendant').length,1);
});
