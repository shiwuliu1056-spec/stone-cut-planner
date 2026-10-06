/* Runs only inside the isolated document renderer, not in the mini-program UI. */
function wordBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
async function wordPdfImages(bytes){
  const pdfjs=await pdfJsPromise,doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise,images=[];
  if(doc.numPages>300)throw Error('单份材料超过300页，请拆分后再添加');
  try{for(let index=1;index<=doc.numPages;index++){
    const page=await doc.getPage(index),viewport=page.getViewport({scale:2.4}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
    images.push({base64:canvas.toDataURL('image/png').split(',')[1],type:'png',width:canvas.width,height:canvas.height,sourceKind:'document'});page.cleanup();
  }}finally{await doc.destroy();}return images;
}
async function wordPhotoImages(entry,allowSplit=true){
  if(entry.format==='png'&&(!allowSplit||entry.height/entry.width<=2.6))return [{base64:wordBase64(entry.bytes),type:'png',width:entry.width,height:entry.height,sourceKind:'image'}];
  const image=await new Promise((resolve,reject)=>{const one=new Image();one.onload=()=>resolve(one);one.onerror=reject;one.src=URL.createObjectURL(new Blob([entry.bytes]));}),result=[];
  const width=image.naturalWidth,height=image.naturalHeight,long=allowSplit&&height/width>2.6,target=Math.floor(width*1.15);let top=0;
  while(top<height){
    let bottom=long?Math.min(height,top+target):height;
    if(long&&bottom<height){
      const radius=Math.min(100,Math.floor(target*.1)),bandTop=Math.max(top+100,bottom-radius),bandBottom=Math.min(height,bottom+radius),sample=document.createElement('canvas');sample.width=Math.min(width,1000);sample.height=bandBottom-bandTop;
      const context=sample.getContext('2d');context.drawImage(image,0,bandTop,width,sample.height,0,0,sample.width,sample.height);const data=context.getImageData(0,0,sample.width,sample.height).data;let best=Infinity,bestRow=bottom-bandTop;
      for(let y=0;y<sample.height;y++){let sum=0,count=0;const base=(y*sample.width+Math.floor(sample.width*.15))*4;
        for(let x=Math.floor(sample.width*.15);x<sample.width*.85;x+=8){const at=(y*sample.width+x)*4;sum+=Math.abs(data[at]-data[base])+Math.abs(data[at+1]-data[base+1])+Math.abs(data[at+2]-data[base+2]);count++;}
        const score=sum/Math.max(count,1)+Math.abs(y-(bottom-bandTop))*.05;if(score<best){best=score;bestRow=y;}
      }
      if(best<20)bottom=bandTop+bestRow;
    }
    const scale=Math.min(1,2600/Math.max(width,bottom-top)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round((bottom-top)*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,top,width,bottom-top,0,0,canvas.width,canvas.height);
    const type=entry.format==='jpg'?'jpg':'png';result.push({base64:canvas.toDataURL(type==='jpg'?'image/jpeg':'image/png',.96).split(',')[1],type,width:canvas.width,height:canvas.height,sourceKind:long?'long-image':'image'});top=bottom;
  }
  URL.revokeObjectURL(image.src);return result;
}
async function wordGroup(item,number,files,label='材料编号',forcePairs=false){
  const prepared=await prepareEvidenceGroup(files),operations=forcePairs?identityOperations(prepared,true):evidenceOperations(prepared),pages=[];
  for(const operation of operations){
    if(operation.kind==='images'){
      if(operation.entries.length===2)pages.push((await Promise.all(operation.entries.map(entry=>wordPhotoImages(entry,!forcePairs)))).flat());
      else for(const image of await wordPhotoImages(operation.entries[0],!forcePairs))pages.push([image]);
    }
    else for(const image of await wordPdfImages(operation.entry.bytes))pages.push([image]);
  }
  const packed=[];
  for(const page of pages){const last=packed[packed.length-1];if(last&&last.length===1&&page.length===1&&last[0].sourceKind==='image'&&page[0].sourceKind==='image'&&last[0].height/last[0].width<=1.35&&page[0].height/page[0].width<=1.35)last.push(page[0]);else packed.push(page);}
  return {id:item.id,name:item.name||'未填写材料名称',number,label,types:evidenceFileTypes(files),count:files.length,pages:packed};
}
function wordPageTokens(groups,group){
  const index=groups.findIndex(item=>item.id===group.id);
  return group.pages.map((_page,pageIndex)=>`{{PAGE:g${index+1}p${pageIndex+1}}}`).join('-');
}
function wordDirectory(body,selector,rows,groups,pageColumn){
  const doc=new DOMParser().parseFromString(body,'text/html'),table=doc.querySelector(selector);
  if(table)rows.forEach((row,index)=>{const group=groups.find(item=>item.id===row.id),cell=table.rows[index+1]?.cells[pageColumn];if(cell)cell.textContent=group?wordPageTokens(groups,group):'—';});
  return doc.body.innerHTML;
}
async function buildWordModel(){
  const identityGroups=[],defendantGroups=[],evidenceGroups=[];
  for(let i=0;i<state.identityMaterials.length;i++){const item=state.identityMaterials[i],files=identityFilesFor(item.id);if(files.length)identityGroups.push(await wordGroup(item,i+1,files,'材料编号',String(item.name).includes('身份证')));}
  for(const group of defendantMaterialGroups())defendantGroups.push(await wordGroup(group.item,group.number,group.files,'材料编号',String(group.item.name).includes('身份证')));
  for(let i=0;i<state.evidence.length;i++){const item=state.evidence[i],files=evidenceFilesFor(item.id);if(item.kind!=='media'&&files.length)evidenceGroups.push(await wordGroup(item,i+1,files,'证据编号'));}
  const docs=documents(),model=[
    {name:'01_起诉状.docx',title:'民事起诉状',html:stripPreviewMarks(docs.complaint),groups:[]},
    {name:'02_当事人身份证明.docx',title:'当事人身份证明',html:stripPreviewMarks(wordDirectory(identityCoverDoc(),'.identity-directory-table',state.identityMaterials,identityGroups,3)),groups:identityGroups},
    {name:'03_被告线索辅助表.docx',title:docLabels.defendant,html:stripPreviewMarks(wordDirectory(defendantDoc(),'.doc-table:nth-of-type(2)',defendantMaterialGroups().map(group=>group.item),defendantGroups,4)),groups:defendantGroups},
    {name:'04_证据目录及证据材料.docx',title:docLabels.evidence,html:stripPreviewMarks(wordDirectory(evidenceDoc(),'.evidence-document-table',state.evidence.filter(item=>item.kind!=='media'),evidenceGroups,4)),groups:evidenceGroups},
    {name:'05_送达地址确认书.docx',title:docLabels.service,html:stripPreviewMarks(docs.service),groups:[]}
  ];
  if(state.includeRefundAccount)model.push({name:'06_收款账户确认书.docx',title:docLabels.refund,html:stripPreviewMarks(docs.refund),groups:[]});
  if(state.represented==='yes'&&uploads.agent.length){const groups=[await wordGroup({id:'agent',name:'委托代理材料'},1,uploads.agent)];model.splice(3,0,{name:'03A_委托代理人委托手续和身份材料.docx',title:'委托代理材料',html:'<h2>委托代理材料</h2>',groups});}
  return model;
}
