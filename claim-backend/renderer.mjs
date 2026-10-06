import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import {createWord,renderWordPdfBatch,patchPageCaches} from './word.mjs';
export const FORMAT_VERSION='word-v1';

export class ClaimRenderer {
  constructor(engineRoot, origin, secret) {
    this.engineRoot = engineRoot; this.origin = origin; this.secret = secret;
    this.browser = null; this.ready = false;
  }
  async start() {
    this.browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
      args: process.env.NODE_ENV === 'production' ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    const css = await readFile(join(this.engineRoot, 'styles.css'), 'utf8');
    this.css = css.slice(css.indexOf('.pdf-document {'), css.indexOf('@media', css.indexOf('.pdf-document {')));
    this.ready = true;
  }
  async context() {
    const context = await this.browser.newContext({ viewport: { width: 1000, height: 1000 }, timezoneId: 'Asia/Shanghai' });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(this.origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      return route.abort();
    });
    return context;
  }
  async print(body) {
    const context = await this.context();
    try {
      const page = await context.newPage();
      await page.setContent(`<html><head><meta charset="utf-8"><style>${this.css}\nhtml,body{margin:0;padding:0;background:white}.pdf-document{width:178mm;min-height:0}p{orphans:2;widows:2}thead{display:table-header-group}.pdf-document .filled{border:0}</style></head><body><article class="pdf-document">${body}</article></body></html>`);
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {}))); });
      return await page.pdf({ format: 'A4', margin: { top: '25mm', bottom: '25mm', left: '16mm', right: '16mm' }, printBackground: true });
    } finally { await context.close(); }
  }
  async engine() {
    const context = await this.context();
    const page = await context.newPage();
    await page.exposeFunction('claimPrint', async body => (await this.print(body)).toString('base64'));
    await page.goto(`${this.origin}/engine/${this.secret}/index.html`);
    await page.waitForFunction(() => !!window.claimEngine);
    await page.addScriptTag({content:await readFile(join(this.engineRoot,'..','word-plans.js'),'utf8')});
    return { context, page };
  }
  async inspect(state, files = []) {
    const { context, page } = await this.engine();
    try { return await page.evaluate(({ state, files }) => { window.claimEngine.set(state, files); return window.claimEngine.inspect(); }, { state, files }); }
    finally { await context.close(); }
  }
  async generate(task) {
    const profiling=process.env.CLAIM_PROFILE_GENERATION==='1',totalStarted=performance.now();
    const profile=(phase,details={})=>{if(profiling)console.info('Claim generation profile',JSON.stringify({phase,...details}));};
    const { context, page } = await this.engine();
    const watchdog = setTimeout(() => context.close().catch(() => {}), 5 * 60 * 1000);
    const zip = new JSZip();
    const outputs = [];
    try {
      await page.exposeFunction('claimOutput', async (name, base64) => {
        const bytes = Buffer.from(base64, 'base64');
        zip.file(name, bytes);
      });
      const files = await Promise.all(task.files.map(async file => ({ ...file, base64: (await readFile(file.path)).toString('base64'), path: undefined })));
      const prepareStarted=performance.now();
      const specs=await page.evaluate(async({state,files})=>{window.claimEngine.set(state,files);return buildWordModel();},{state:task.state,files});
      profile('prepare',{ms:Math.round(performance.now()-prepareStarted),files:files.length,documents:specs.length});
      const inspectLayout=async(spec,pdf)=>{
          const layout=await page.evaluate(async base64=>{
            const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),lib=await pdfJsPromise,doc=await lib.getDocument({data:bytes}).promise,headings=[];
            try{
              async function collect(items){
                for(const item of items||[]){
                  let dest=item.dest;if(typeof dest==='string')dest=await doc.getDestination(dest);
                  if(Array.isArray(dest)&&dest[0])headings.push({title:item.title.normalize('NFKC').replace(/\s/g,''),page:(typeof dest[0]==='number'?dest[0]:await doc.getPageIndex(dest[0]))+1});
                  await collect(item.items);
                }
              }
              await collect(await doc.getOutline());return {pageCount:doc.numPages,headings};
            }finally{await doc.destroy();}
          },pdf.toString('base64'));
          const measured={},starts=spec.groups.map(group=>{const title=(group.label+' '+group.number+'：'+group.name).normalize('NFKC').replace(/\s/g,'');return (layout.headings.find(item=>item.title===title)||{}).page||0;});
          let valid=starts.every(start=>start>0);
          spec.groups.forEach((group,g)=>{const end=g+1<starts.length?starts[g+1]-1:layout.pageCount;if(end-starts[g]+1!==group.pages.length)valid=false;group.pages.forEach((_images,p)=>{measured['g'+(g+1)+'p'+(p+1)]=starts[g]+p;});});
          return {...layout,starts,pageMap:measured,valid};
      };
      const work=specs.map((spec,index)=>({spec,index,id:'word-'+(index+1),filename:join(task.dir,'word-'+(index+1)+'.docx'),scale:1,layoutRuns:0,started:performance.now()}));
      let completed=0;
      const finish=async(item,bytes,layout)=>{
        item.finalBytes=bytes;item.finalLayout=layout;
        await writeFile(item.filename,bytes);
        await writeFile(join(task.dir,item.id+'.layout.json'),JSON.stringify(layout));
        task.progress=Math.min(90,20+(++completed)*10);
        profile('document',{index:item.index+1,ms:Math.round(performance.now()-item.started),layoutRuns:item.layoutRuns,pages:layout.pageCount});
      };
      const renderBatch=async(items,phase,attempt)=>{
        if(!items.length)return [];
        const started=performance.now();
        const pdfs=await renderWordPdfBatch(items.map(item=>item.filename),join(task.dir,'layout-'+phase+'-'+attempt));
        profile('layout-batch',{phase,attempt,documents:items.length,ms:Math.round(performance.now()-started)});
        items.forEach(item=>item.layoutRuns++);
        return pdfs;
      };
      const saveDebug=async(item,phase,layout)=>writeFile(join(task.dir,item.id+'.layout-debug.json'),JSON.stringify({phase,pageCount:layout.pageCount,starts:layout.starts,planned:item.spec.groups.map(group=>group.pages.length),headings:layout.headings}));
      for(let attempt=0;attempt<5;attempt++){
        const pending=work.filter(item=>!item.finalBytes);
        if(!pending.length)break;
        const created=await Promise.allSettled(pending.map(async item=>{
          item.draftBytes=await createWord(item.spec,{imageScale:item.scale});
          await writeFile(item.filename,item.draftBytes);
        }));
        const createFailure=created.find(result=>result.status==='rejected');
        if(createFailure)throw createFailure.reason;
        const draftPdfs=await renderBatch(pending,'draft',attempt);
        for(let index=0;index<pending.length;index++){
          const item=pending[index],draft=await inspectLayout(item.spec,draftPdfs[index]);
          if(!draft.valid){await saveDebug(item,'draft',draft);item.scale*=0.9;continue;}
          if(!item.spec.groups.length){await finish(item,item.draftBytes,{pageCount:draft.pageCount,pageMap:{},groups:[]});continue;}
          // LibreOffice recalculates PAGEREF from bookmarks during this render; patching cached field text
          // makes Word/WPS show the measured values immediately without another identical layout pass.
          const patched=await patchPageCaches(item.draftBytes,draft.pageMap);
          await finish(item,patched,{pageCount:draft.pageCount,pageMap:draft.pageMap,groups:item.spec.groups.map((group,g)=>({name:group.name,pages:group.pages.length,start:draft.starts[g]}))});
        }
      }
      if(work.some(item=>!item.finalBytes))throw Error('Word页码校验未通过，请拆分过长材料组后重试');
      work.forEach(item=>{
        const bytes=item.finalBytes;
        zip.file('01_最终Word/'+item.spec.name,bytes);
        outputs[item.index]={id:item.id,name:item.spec.name,size:bytes.length,extension:'docx',pageCount:item.finalLayout.pageCount};
      });
      const packageStarted=performance.now();
      await page.evaluate(async()=>{const files=await fileSet({originalsOnly:true});for(const [name,data] of files){const bytes=typeof data==='string'?new TextEncoder().encode(data):data;await window.claimOutput(name,wordBase64(bytes));}});
      await writeFile(join(task.dir, 'package.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
      profile('package',{ms:Math.round(performance.now()-packageStarted),totalMs:Math.round(performance.now()-totalStarted)});
      return outputs;
    } finally { clearTimeout(watchdog); await context.close(); }
  }
  async close() { this.ready=false; if (this.browser) await this.browser.close(); }
}

export const engineBridge = `
htmlToPdfBytes = async function(title, body) {
  const base64 = await window.claimPrint(stripPreviewMarks(body));
  return Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
};
window.claimEngine = {
  set(input, files) {
    state = { ...structuredClone(defaultState), ...input };
    uploads = { plaintiff: [], agent: [], defendant: [], evidence: [] };
    for (const item of files) {
      const bytes = item.base64 ? Uint8Array.from(atob(item.base64), ch => ch.charCodeAt(0)) : new Uint8Array();
      uploads[item.group].push({ ...item, file: new File([bytes], item.name), size: item.size || bytes.length });
    }
  },
  inspect() {
    const review = buildAiReviewPayload();
    const fieldSteps = { identityMaterials: [1], evidence: [3], jurisdictionBases: [0] };
    const fieldLabels={identityMaterials:'身份证明材料',defendantMaterials:'被告线索材料',evidence:'证据目录',jurisdictionBases:'案件为什么由这个法院受理'};
    document.querySelectorAll('[data-step-panel]').forEach(panel => panel.querySelectorAll('[data-field]').forEach(el => {
      const key = el.dataset.field, step = Number(panel.dataset.stepPanel);
      if (!fieldSteps[key]) fieldSteps[key] = [];
      if (!fieldSteps[key].includes(step)) fieldSteps[key].push(step);
      const label=el.closest('label');const title=label&&(label.querySelector('b')||label.querySelector('span'));if(title)fieldLabels[key]=title.textContent.replace(/必填/g,'').trim();
    }));
    review.fieldSteps = fieldSteps;
    review.fieldLabels=fieldLabels;
    return { issues: collectReviewIssues(), completion: completion(), review, templates: TEMPLATE_SOURCES };
  },
  async generate() {
    const files = await fileSet();
    for (const [name, data] of files) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      await window.claimOutput(name, btoa(binary));
    }
  }
};
`;
