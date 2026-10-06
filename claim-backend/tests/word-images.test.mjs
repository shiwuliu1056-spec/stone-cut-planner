import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import JSZip from 'jszip';
import {createClaimServer} from '../server.mjs';
import {createWord,renderWordPdf} from '../word.mjs';
const require=createRequire(import.meta.url),schema=require('../../miniprogram/shared/claim/schema.js');
test('Word image layout splits long screenshots, normalizes phone-photo orientation and uses unique inline anchors',{timeout:180000},async()=>{
  const app=await createClaimServer({port:0,devAuth:true}),engine=await app.renderer.engine();
  try{
    const fixtures=await engine.page.evaluate(()=>{
      const long=document.createElement('canvas');long.width=800;long.height=5000;const ctx=long.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,800,5000);ctx.fillStyle='#173e38';ctx.font='30px sans-serif';
      for(let y=60;y<5000;y+=150){ctx.fillText('测试聊天记录 货物已送达 请支付货款',30,y);}
      const photo=document.createElement('canvas');photo.width=900;photo.height=600;const one=photo.getContext('2d');one.fillStyle='#eef3ef';one.fillRect(0,0,900,600);one.fillStyle='#173e38';one.font='60px sans-serif';one.fillText('虚构送货照片',40,180);one.fillRect(0,0,80,600);
      return {long:long.toDataURL('image/png').split(',')[1],photo:photo.toDataURL('image/jpeg').split(',')[1]};
    });
    const jpeg=Buffer.from(fixtures.photo,'base64'),exif=Buffer.from([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const rotated=Buffer.concat([jpeg.subarray(0,2),exif,jpeg.subarray(2)]).toString('base64');
    const state=structuredClone(schema.sample);state.evidence=[{...state.evidence[0],id:'long',name:'聊天长图'},{...state.evidence[0],id:'photo',name:'送货照片'}];
    const spec=await engine.page.evaluate(async({state,files})=>{window.claimEngine.set(state,files);return (await buildWordModel()).find(item=>item.name.includes('证据'));},{state,files:[{id:'long-file',group:'evidence',evidenceId:'long',name:'original-long.png',base64:fixtures.long},{id:'rotated-file',group:'evidence',evidenceId:'photo',name:'original-photo.jpg',base64:rotated}]});
    assert.ok(spec.groups[0].pages.length>=4,'长截图不能缩成一条细图');assert.equal(spec.groups[0].count,1);
    assert.equal(spec.groups[1].pages.length,1);const picture=spec.groups[1].pages[0][0];assert.equal(picture.width,600);assert.equal(picture.height,900);assert.equal(Buffer.from(picture.base64,'base64').includes(Buffer.from('Exif')),false,'输出图片应已去除依赖EXIF的方向');
    const bytes=await createWord(spec),archive=await JSZip.loadAsync(bytes),xml=await archive.file('word/document.xml').async('string');
    assert.ok(!xml.includes('<wp:anchor'));assert.ok(xml.includes('<wp:inline'));assert.ok(xml.includes('<w:pageBreakBefore'));
    const ids=Array.from(xml.matchAll(/<w:bookmarkStart[^>]+w:id="(\d+)"/g),match=>match[1]);assert.equal(new Set(ids).size,ids.length,'书签编号不得重复');
    assert.ok(!xml.includes('original-long')&&!xml.includes('original-photo'),'文档不展示原文件名');
    const folder=resolve('../test-output/word-stress');await mkdir(folder,{recursive:true});const path=resolve(folder,'多图排版检查.docx');await writeFile(path,bytes);await renderWordPdf(path,resolve(folder,'layout'));
  }finally{await engine.context.close();await app.close();}
});
