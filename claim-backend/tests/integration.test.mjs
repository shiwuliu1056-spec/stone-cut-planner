import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, utimes, stat, rm, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { createClaimServer, validateManifest } from '../server.mjs';
import {renderWordPdf} from '../word.mjs';
import {cleanupAbandonedWorkspaces} from '../workspaces.mjs';
const require = createRequire(import.meta.url);
const schema = require('../../miniprogram/packages/claim/shared/schema.js');

test('reject unsupported formats, wrong group linkage and repeated IDs', () => {
  const state = structuredClone(schema.sample);
  assert.throws(() => validateManifest(state, [{ id: 'a', group: 'evidence', name: '文件.doc', size: 4, evidenceId: state.evidence[0].id }]));
  assert.throws(() => validateManifest(state, [{ id: 'a', group: 'plaintiff', name: '文件.png', size: 4, materialId: 'unknown' }]));
  assert.throws(() => validateManifest({ ...state, evidence: [state.evidence[0], state.evidence[0]] }, []));
  for(const malformed of [{...state,identityMaterials:[null]},{...state,evidence:[null]},{...state,defendantMaterials:[null]}])assert.throws(()=>validateManifest(malformed,[]),error=>error.status===400);
  assert.throws(()=>validateManifest(state,[null]),error=>error.status===400);
});

test('developer identity cannot be exposed on a public service bind', async () => {
  await assert.rejects(createClaimServer({host:'0.0.0.0',port:0,devAuth:true}),/开发身份仅限本机非生产环境/);
});

test('real rendering, grouped attachments, archive, retry and task ownership', { timeout: 180000 }, async () => {
  const app = await createClaimServer({ port: 0, devAuth: true });
  try {
    const malformedSession=await fetch(app.origin+'/api/claim/session',{method:'POST',headers:{'content-type':'application/json'},body:'null'});
    assert.equal(malformedSession.status,400,'空请求对象应明确拒绝，而不是服务出错');
    const request = async (path, method, data, token) => {
      const res = await fetch(app.origin + '/api/claim' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
      return { status: res.status, data: await res.json() };
    };
    const token = (await request('/session','POST',{ devId: 'integration' })).data.token;
    const outsider = (await request('/session','POST',{ devId: 'outsider' })).data.token;
    const state = structuredClone(schema.sample);
    state.plaintiffType = '个人'; state.plaintiffName = '张三'; state.plaintiffGender = '男'; state.plaintiffId = '360400199001010000';
    state.identityMaterials = [{ id: 'identity-card', name: '身份证' }, { id: 'license', name: '其他身份证明' }];
    state.defendantMaterials=[{id:'def-registry',name:'工商登记信息'},{id:'def-address',name:'经营地址照片'}];
    state.evidence = [
      { ...state.evidence[0], id: 'chat', name: '聊天记录' },
      { id: 'audio', kind: 'media', name: '催款录音', source: '原告录制', purpose: '证明催款及欠款', mediaType: '录音', fileCount: 2 },
      { ...state.evidence[0], id: 'delivery', name: '送货材料' }
    ];
    state.includeRefundAccount = true; state.refundAccountName = '张三'; state.refundBankName = '测试银行'; state.refundBankAccount = '123456789'; state.refundPhone = state.plaintiffPhone;
    const context = await app.renderer.context(); const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 560 });
    await page.setContent('<html><body style="margin:20px;background:#eff4ee;color:#173e38;font:36px sans-serif"><h1>测试身份证 · 正面</h1><p>张三 · 虚构测试材料</p></body></html>');
    const image1 = await page.screenshot({ type: 'png' });
    await page.setContent('<html><body style="margin:20px;background:#f8f0e4;color:#173e38;font:36px sans-serif"><h1>测试身份证 · 反面</h1><p>虚构测试材料</p></body></html>');
    const image2 = await page.screenshot({ type: 'png' });
    await page.setViewportSize({ width: 500, height: 1100 });
    await page.setContent('<html><body style="font:30px sans-serif"><h1>微信聊天记录</h1>' + '<p>已收货，货款稍后支付。</p>'.repeat(12) + '</body></html>');
    const chat = await page.screenshot({ type: 'png' }); await context.close();
    const engine = await app.renderer.engine();
    let xlsx, webp;
    try {
      const generated = await engine.page.evaluate(() => {
        const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['货物','数量'],['日用品',10]]),'明细');
        const canvas=document.createElement('canvas'); canvas.width=600; canvas.height=350; const ctx=canvas.getContext('2d'); ctx.fillStyle='#eef3ef'; ctx.fillRect(0,0,600,350); ctx.fillStyle='#173e38'; ctx.font='38px sans-serif'; ctx.fillText('测试WebP材料',40,100);
        return { xlsx: XLSX.write(workbook,{type:'base64',bookType:'xlsx'}), webp: canvas.toDataURL('image/webp').split(',')[1] };
      });
      xlsx=Buffer.from(generated.xlsx,'base64'); webp=Buffer.from(generated.webp,'base64');
      const csvHtml=await engine.page.evaluate(async()=>spreadsheetToHtml(new File([new TextEncoder().encode('货物,数量,金额\n日用品,10,58000')],'明细.csv')));
      assert.ok(csvHtml.includes('货物')&&csvHtml.includes('日用品'),'无BOM的UTF-8 CSV不能出现中文乱码');
      for (const [type, expected] of [['个人','当事人（签名、按手印）'],['个体工商户','经营者（签名）'],['公司','负责人（签名）']]) {
        const html = await engine.page.evaluate(({ state, type }) => { window.claimEngine.set({ ...state, plaintiffType: type }, []); return identityCoverDoc(); }, { state, type });
        assert.ok(html.includes(expected),type + '签署文字');
        if(type !== '个人') assert.ok(!html.includes('按手印'));
        const signatures=await engine.page.evaluate(({state,type})=>{
          window.claimEngine.set({...state,plaintiffType:type},[]);
          const docs=documents(),parse=body=>new DOMParser().parseFromString(body,'text/html');
          const evidence=parse(docs.evidence);
          const service=parse(docs.service);
          return {date:todayCn(),signed:[docs.complaint,identityCoverDoc(),docs.defendant,docs.service,docs.refund].map(body=>({body,lastDate:Array.from(parse(body).querySelectorAll('.signature p')).pop().textContent})),court:evidence.querySelector('.evidence-court-signing').textContent,party:evidence.querySelector('.evidence-party-signing').textContent,serviceHeading:service.body.firstElementChild?.textContent,serviceCourt:service.querySelector('p.party-line')?.textContent,tablesLeft:[docs.defendant,docs.service,docs.refund].map(body=>{const tables=Array.from(parse(body).querySelectorAll('table.doc-table'));return tables.length>0&&tables.every(table=>table.classList.contains('left-aligned-table'));})};
        },{state,type});
        signatures.signed.forEach(item=>assert.equal(item.lastDate,'日期：'+signatures.date,type+' 日期标签'));
        assert.ok(!signatures.court.includes(signatures.date),'审判人员日期必须留空');assert.ok(signatures.court.includes('日期：'));
        assert.ok(signatures.party.includes('提交日期：'),'提交人日期独立放在本人签署区');assert.ok(!signatures.party.includes(signatures.date),'实际提交日期不能被生成日期冒充');
        assert.ok(signatures.signed[2].body.includes('defendant-cover-signature'));
        if(type==='个人')assert.ok(signatures.signed[2].body.includes('提交人（签名、按手印）'));
        if(type!=='个人'){
          ['当事人','提交人','受送达人','当事人'].forEach((role,index)=>assert.ok(signatures.signed[index+1].body.includes(role+'（盖章）'),type+' '+role+' 签署称谓'));
          assert.ok(signatures.party.includes('提交人（盖章）'),type+' 证据目录签署称谓');
          assert.ok(!signatures.signed.some(item=>item.body.includes('字号（盖章）')||item.body.includes('单位（公章）')));
          assert.ok(signatures.signed[2].body.includes(type==='个体工商户'?'经营者（签名）':'负责人（签名）'));
        }
        signatures.tablesLeft.forEach((valid,index)=>assert.ok(valid,type+' 第'+[3,5,6][index]+'栏目表格左对齐'));
        assert.equal(signatures.serviceHeading,'送达地址确认书','送达文书先显示大标题');
        assert.ok(signatures.serviceCourt.startsWith('提交法院：'),'法院名称应列在正文而非标题之前');
      }
      const large = await engine.page.evaluate(async ({ state, image }) => {
        state.identityMaterials = Array.from({ length: 30 }, (_x,i) => ({ id: 'material-' + i, name: '身份证明材料第' + (i+1) + '组：' + '登记信息核对'.repeat(6) }));
        const files = state.identityMaterials.map((m,i) => ({ id: 'image-' + i, group: 'plaintiff', materialId: m.id, name: 'hidden-original.png', base64: image }));
        window.claimEngine.set(state, files);
        const originalPrint = htmlToPdfBytes; let lastHtml;
        htmlToPdfBytes = async function(title,html) { lastHtml = html; return originalPrint(title,html); };
        try {
          const bytes = await identityMaterialPdf();
          const doc = await PDFLib.PDFDocument.load(bytes);
          const table = new DOMParser().parseFromString(lastHtml,'text/html').querySelector('table');
          return { pageCount: doc.getPageCount(), firstRange: table.rows[1].cells[3].textContent, lastRange: table.rows[30].cells[3].textContent };
        } finally { htmlToPdfBytes = originalPrint; }
      }, { state: structuredClone(state), image: image1.toString('base64') });
      const directoryPages = large.pageCount - 30;
      assert.ok(directoryPages > 1,'材料目录应跨页');
      assert.equal(large.firstRange,String(directoryPages + 1),'目录跨页后首组页码稳定');
      assert.equal(large.lastRange,String(large.pageCount),'最后一组页码正确');
    } finally { await engine.context.close(); }
    const word = new JSZip();
    word.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    word.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    word.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>测试Word说明：货物已经交付。</w:t></w:r></w:p></w:body></w:document>');
    const docx=await word.generateAsync({type:'nodebuffer'});
    const attachment = await app.renderer.print('<h2>测试送货单</h2><p>货物已由被告收取。</p>');
    const sourceFiles = [
      {id:'registry-front',group:'defendant',materialId:'def-registry',name:'hidden-original-registry.png',bytes:image1},
      {id:'registry-back',group:'defendant',materialId:'def-registry',name:'hidden-original-registry.png',bytes:image2},
      {id:'address',group:'defendant',materialId:'def-address',name:'hidden-original-address.png',bytes:chat},
      { id: 'front', group: 'plaintiff', materialId: 'identity-card', name: '同名.png', bytes: image1 },
      { id: 'back', group: 'plaintiff', materialId: 'identity-card', name: '同名.png', bytes: image2 },
      { id: 'third', group: 'plaintiff', materialId: 'license', name: '文件.pdf', bytes: attachment },
      ...Array.from({ length: 4 }, (_, i) => ({ id: 'chat-' + i, group: 'evidence', evidenceId: 'chat', name: '聊天.png', bytes: chat })),
      { id: 'delivery-file', group: 'evidence', evidenceId: 'delivery', name: '送货.pdf', bytes: attachment },
      { id: 'text-file', group: 'evidence', evidenceId: 'delivery', name: '说明.txt', bytes: Buffer.from('货物说明：本组文字材料') },
      { id: 'table-file', group: 'evidence', evidenceId: 'delivery', name: '明细.csv', bytes: Buffer.from('名称,数量,金额\n货物,10,58000') },
      { id: 'word-file', group: 'evidence', evidenceId: 'delivery', name: '说明.docx', bytes: docx },
      { id: 'xlsx-file', group: 'evidence', evidenceId: 'delivery', name: '明细.xlsx', bytes: xlsx },
      { id: 'webp-file', group: 'evidence', evidenceId: 'delivery', name: '截图.webp', bytes: webp }
    ];
    const files = sourceFiles.map(({ bytes, ...metadata }) => ({ ...metadata, size: bytes.length }));
    const checks = await request('/check','POST',{ state, files },token);
    assert.equal(checks.status,200); assert.equal(checks.data.issues.filter(x => x.level === 'danger').length,0);
    assert.ok(!JSON.stringify(checks.data.review).includes('同名.png'));
    assert.ok(!JSON.stringify(checks.data.review).includes('hidden-original'));
    assert.ok(checks.data.review.fieldLabels.interestTerms.includes('计算方式'));
    const defendantEngine=await app.renderer.engine();
    try{
      const detail=await defendantEngine.page.evaluate(async({state,files})=>{
        window.claimEngine.set(state,files);let cover,headers=[];
        const print=htmlToPdfBytes,header=evidenceHeaderImage;
        htmlToPdfBytes=async(title,body)=>{cover=body;return print(title,body);};
        evidenceHeaderImage=async(output,details)=>{headers.push(details);return header(output,details);};
        try{const bytes=await defendantMaterialPdf();return {cover,headers,pages:(await PDFLib.PDFDocument.load(bytes)).getPageCount()};}
        finally{htmlToPdfBytes=print;evidenceHeaderImage=header;}
      },{state,files:sourceFiles.filter(file=>file.group==='defendant').map(({bytes,...metadata})=>({...metadata,base64:bytes.toString('base64')}))});
      assert.equal(detail.pages,3);assert.equal(detail.headers.length,2);
      assert.deepEqual(detail.headers.map(item=>[item.label,item.name,item.startPage,item.endPage]),[['材料编号','工商登记信息',2,2],['材料编号','经营地址照片',3,3]]);
      assert.ok(!detail.cover.includes('hidden-original'));assert.ok(detail.cover.includes('工商登记信息')&&detail.cover.includes('经营地址照片'));
    }finally{await defendantEngine.context.close();}
    // 模拟旧故障：外部清理已删除当前进程目录，创建任务应能自愈。
    const probe=await request('/tasks','POST',{state,files:[]},token);assert.equal(probe.status,201);
    const workspace=dirname(app.tasks.get(probe.data.id).dir);
    await request('/tasks/'+probe.data.id,'DELETE',null,token);await rm(workspace,{recursive:true});
    const created = await request('/tasks','POST',{ state, files },token); assert.equal(created.status,201); const id = created.data.id;
    const old=new Date(Date.now()-3600000);await utimes(workspace,old,old);
    await cleanupAbandonedWorkspaces(dirname(workspace),{ttl:1800000});
    assert.ok(await stat(app.tasks.get(id).dir),'其他测试/服务清理不得删除运行中的任务目录');
    assert.equal((await request('/tasks/' + id,'GET',null,outsider)).status,404);
    assert.equal((await request('/tasks/' + id + '/generate','POST',{},token)).status,409);
    for (const file of sourceFiles) {
      const form = new FormData(); form.append('file',new Blob([file.bytes]),file.name);
      const res = await fetch(app.origin + '/api/claim/tasks/' + id + '/files/' + file.id, { method:'POST',headers:{authorization:'Bearer ' + token},body:form });
      assert.equal(res.status,200,await res.text());
    }
    assert.equal((await request('/tasks/' + id,'GET',null,token)).data.uploadedIds.length,files.length);
    assert.equal((await request('/tasks/' + id + '/generate','POST',{},token)).status,202);
    let task;
    for (let i=0;i<120;i++) { task=(await request('/tasks/' + id,'GET',null,token)).data; if (['ready','failed'].includes(task.status)) break; await new Promise(r => setTimeout(r,500)); }
    if(task.status==='failed')await cp(app.tasks.get(id).dir,resolve('../test-output/word-failure'),{recursive:true});
    assert.equal(task.status,'ready',task.error); assert.equal(task.outputs.length,6);
    const outputRoot = resolve('../test-output'); await mkdir(outputRoot,{recursive:true});
    const download = async outputId => Buffer.from(await (await fetch(app.origin + '/api/claim/tasks/' + id + '/download/' + outputId,{headers:{authorization:'Bearer ' + token}})).arrayBuffer());
    const zip = await JSZip.loadAsync(await download('package'));
    assert.deepEqual([...new Set(Object.keys(zip.files).map(x=>x.split('/')[0]))].sort(),['01_最终Word','02_Word内原始文件','03_需另行上传的影音证据']);
    assert.ok(zip.file('02_Word内原始文件/02_当事人身份证明/01_身份证/身份证1.png'));
    assert.ok(zip.file('02_Word内原始文件/02_当事人身份证明/01_身份证/身份证2.png'));
    assert.ok(zip.file('01_最终Word/03_被告线索辅助表.docx'));assert.ok(!Object.keys(zip.files).some(name=>name.startsWith('01_最终Word/')&&name.endsWith('.pdf')));
    assert.ok(zip.file('02_Word内原始文件/03_被告线索辅助材料/01_工商登记信息/工商登记信息1.png'));
    assert.ok(zip.file('02_Word内原始文件/03_被告线索辅助材料/01_工商登记信息/工商登记信息2.png'));
    const list = await zip.file('03_需另行上传的影音证据/影音证据另行上传清单.txt').async('string'); assert.ok(list.includes('编号：2') && list.includes('催款录音'));
    for (const output of task.outputs) {
      const bytes = await download(output.id); assert.deepEqual(bytes,await zip.file('01_最终Word/' + output.name).async('nodebuffer'));
      const saved=resolve(outputRoot,output.name);await writeFile(saved,bytes);
      assert.ok(output.name.endsWith('.docx'));assert.equal(output.extension,'docx');assert.ok(output.pageCount>=1);
      const finalPdf=await PDFDocument.load(await renderWordPdf(saved,resolve(outputRoot,'final-layout-check',output.id)));
      assert.equal(output.pageCount,finalPdf.getPageCount(),'页数必须从最终可下载的Word实测，不能沿用修改页码前的数值');
      const word=await JSZip.loadAsync(bytes),xml=await word.file('word/document.xml').async('string');
      assert.ok(xml.includes('<w:t'),'正文应当是可编辑文字');assert.ok(!xml.includes('<wp:anchor'),'图片不得使用浮动定位');
      assert.ok(xml.includes('w:before="454"'),'签署区应与前文留出8毫米间距');
      assert.ok(xml.includes('w:after="180"'),'正文段落之间应留有间距');
      assert.ok(xml.includes('w:val="44"'),'文书大标题应大于正文');
      if(!output.name.includes('送达地址'))assert.ok(xml.includes('w:val="32"'),'小标题应大于正文');
      const allTables=xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g)||[];
      for(const table of allTables){
        const sizes=Array.from(table.matchAll(/<w:sz w:val="(\d+)"\s*\/>/g),match=>Number(match[1]));
        assert.ok(sizes.length>0,'表格应有明确字号');
        assert.ok(sizes.every(size=>size===21),'所有文书表格，包括自动页码，应统一为10.5磅');
      }
      if(output.name.includes('证据')){
        const signingTable=allTables.at(-1);
        assert.ok(signingTable.includes('w:after="180"')&&signingTable.includes('w:line="360"'),'证据目录签署区应与起诉状使用同样行距');
      }
      if(/^(03_|05_|06_)/.test(output.name)){
        assert.ok(allTables.length>0,'第3、5、6栏目应有表格');
        allTables.forEach(table=>assert.ok(!table.includes('<w:jc w:val="center"'),'表格全部左对齐'));
      }
      if (output.name.includes('当事人')) assert.equal(output.pageCount,3,'身份证正反面同页，下一组独占页');
      if(output.name.includes('被告线索'))assert.equal(output.pageCount,3,'被告线索按材料组独占附件页');
      if (output.name.includes('证据')){
        const layout=JSON.parse(await readFile(resolve(app.tasks.get(id).dir,output.id+'.layout.json'),'utf8'));
        assert.deepEqual(layout.groups.map(group=>group.pages),[4,6],'聊天4页，各转换文件独占一页');
        assert.equal(layout.groups[1].start,layout.groups[0].start+4,'下一组必须从新页开始');
        assert.equal(output.pageCount,layout.groups[0].start-1+10,'目录分页后实际页码保持整数且准确');
      }
    }
    assert.equal((await request('/tasks/' + id,'DELETE',null,token)).status,200);
    assert.equal((await request('/tasks/' + id,'GET',null,token)).status,404);
  } finally { await app.close(); }
});
