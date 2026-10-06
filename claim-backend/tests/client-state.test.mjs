import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const storage = new Map();
global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key,value) => storage.set(key,structuredClone(value)), env: { USER_DATA_PATH: '/local-test' }, getFileSystemManager: () => ({ accessSync() {}, unlinkSync() {} }) };
const draft = require('../../miniprogram/packages/claim/shared/draft.js');
test('default groups, synchronized fields, protected edits and continuous group removal', () => {
  draft.reset(false); assert.equal(draft.get().state.identityMaterials.length,1); assert.equal(draft.get().state.evidence.length,1);
  draft.setField('plaintiffName','张三'); assert.equal(draft.get().state.serviceRecipient,'张三');
  draft.setField('plaintiffName','李四'); assert.equal(draft.get().state.serviceRecipient,'李四');
  draft.setField('serviceRecipient','代收人'); draft.setField('plaintiffName','王五'); assert.equal(draft.get().state.serviceRecipient,'代收人');
  draft.setField('plaintiffType','公司'); assert.equal(draft.get().state.identityMaterials[0].name,'营业执照');
  const row = draft.get().state.identityMaterials[0]; draft.updateRow('identityMaterials',row.id,'name','自定义证明'); draft.setField('plaintiffType','个人'); assert.equal(row.name,'自定义证明');
  draft.removeRow('identityMaterials',row.id); assert.equal(draft.get().state.identityMaterials.length,1);
  draft.addRow('evidence','media'); draft.addRow('evidence','document');
  const removed = draft.get().state.evidence[1].id; draft.removeRow('evidence',removed); assert.equal(draft.get().state.evidence.length,2); assert.ok(!draft.get().state.evidence.some(x=>x.id===removed));
  draft.reset(true); assert.equal(draft.get().state.identityMaterials.length,1); assert.equal(draft.get().state.evidence.length,1);
  assert.ok(draft.issues().issues.some(x => x.step === 1));
});
test('all page paths exist and all conditional WXML uses bound expressions', async () => {
  const root = resolve('../miniprogram'); const app = JSON.parse(await readFile(resolve(root,'app.json'),'utf8'));
  const pages = app.pages.concat(app.subpackages.flatMap(pkg=>pkg.pages.map(page=>pkg.root+'/'+page)));
  for (const page of pages) for (const ext of ['js','json','wxml','wxss']) assert.ok(await readFile(resolve(root,page+'.'+ext)),page+'.'+ext);
  async function walk(dir) { for (const e of await readdir(dir,{withFileTypes:true})) { const path=resolve(dir,e.name); if(e.isDirectory())await walk(path); else if(path.endsWith('.wxml'))assert.ok(!/wx:(?:if|elif)="(?!\{\{)/.test(await readFile(path,'utf8')),path); } }
  await walk(root);
});
test('generated client schema and contract remain deterministic and synchronized', async () => {
  const generate=()=>execFileSync(process.execPath,[resolve('scripts/generate-client.mjs')],{encoding:'utf8',maxBuffer:5e6});
  const patch=generate();assert.equal(generate(),patch,'重复生成不应改变示例编号');
  const files=[...patch.matchAll(/\*\*\* Add File: ([^\n]+)\n([\s\S]*?)(?=\*\*\* Add File:|\*\*\* End Patch)/g)];
  assert.equal(files.length,2);
  for(const [,path,body] of files){
    const generated=body.split('\n').filter(line=>line.startsWith('+')).map(line=>line.slice(1)).join('\n');
    assert.equal((await readFile(path,'utf8')).trimEnd(),generated.trimEnd(),path+' 未同步');
  }
});
