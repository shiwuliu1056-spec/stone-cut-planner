const draft=require('../../shared/draft');
Page({
  onShow(){
    const current=draft.get(),groups=[];
    const add=(title,files)=>{if(files.length)groups.push({title,files:files.map(file=>({id:file.id,name:file.name,size:Math.ceil(file.size/1024)+' KB'}))});};
    current.state.identityMaterials.forEach((row,index)=>add('当事人身份证明 '+(index+1)+' · '+row.name,current.files.filter(file=>file.materialId===row.id&&file.group==='plaintiff')));
    add('代理材料',current.files.filter(file=>file.group==='agent'));add('被告线索',current.files.filter(file=>file.group==='defendant'));
    current.state.evidence.forEach((row,index)=>{if(row.kind==='document')add('证据 '+(index+1)+' · '+(row.name||'未命名证据'),current.files.filter(file=>file.evidenceId===row.id&&file.group==='evidence'));});
    this.setData({groups,count:current.files.length});
  },
  open(e){const file=draft.get().files.find(item=>item.id===e.currentTarget.dataset.id);if(!file)return;try{wx.getFileSystemManager().accessSync(file.localPath);}catch(_){return this.error('文件已失效，请回对应栏目重新上传');}if(draft.fileType(file.name)==='图片')wx.previewImage({urls:[file.localPath]});else wx.openDocument({filePath:file.localPath,showMenu:true,fail:()=>this.error('当前微信无法预览这种文件，可先转发查看')});},
  share(e){const file=draft.get().files.find(item=>item.id===e.currentTarget.dataset.id);if(!file)return;if(typeof wx.shareFileMessage!=='function')return this.error('当前微信版本不支持直接转发');wx.shareFileMessage({filePath:file.localPath,fileName:file.name,fail:error=>{if(!String(error.errMsg).includes('cancel'))this.error('文件无法转发，请核对文件是否仍存在');}});},
  error(message){wx.showModal({title:'暂未完成',content:message,showCancel:false});}
});
