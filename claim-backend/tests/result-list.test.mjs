import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('Word documents share a single panel and icon actions keep labels, source information and correct file targets',async()=>{
  const root='../miniprogram/',source=await readFile(root+'packages/claim/pages/result/index.wxml','utf8');
  assert.equal((source.match(/class="card pdf-list"/g)||[]).length,1);
  assert.ok(!/wx:for="\{\{result.outputs\}\}"[^>]*class="card"/.test(source));
  assert.match(source,/bindtap="open" aria-label="\{\{'查看' \+ item.name\}\}"/);
  assert.match(source,/bindtap="share" aria-label="\{\{'转发' \+ item.name\}\}"/);
  assert.ok(source.includes('{{item.template.name}}'));assert.ok(source.includes('{{item.template.badge}}'));
  for(const icon of ['eye','forward']){const svg=await readFile(root+'packages/claim/assets/'+icon+'.svg','utf8');assert.ok(svg.includes('<svg'));assert.ok(svg.includes('viewBox="0 0 24 24"'));}
});
test('eye and forward handlers still use the clicked Word index',async()=>{
  const opened=[],shared=[];global.wx={showLoading(){},hideLoading(){},openDocument:value=>opened.push(value),shareFileMessage:value=>shared.push(value)};
  let definition;global.Page=value=>{definition=value;};require('../../miniprogram/packages/claim/pages/result/index.js');
  const outputs=Array.from({length:6},(_v,i)=>({id:'word-'+i,name:i+'.docx'}));
  const page={data:{result:{outputs}},getFile:async output=>'/test/'+output.name,error(error){throw error;}};
  await definition.open.call(page,{currentTarget:{dataset:{index:4}}});assert.equal(opened[0].filePath,'/test/4.docx');
  await definition.share.call(page,{currentTarget:{dataset:{index:2}}});assert.equal(shared[0].filePath,'/test/2.docx');assert.equal(shared[0].fileName,'2.docx');
});
