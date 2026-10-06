const draft = require('./draft');
const config = require('./config');
const extensions = ['jpg','jpeg','png','pdf','docx'];
function roleOf(role) { return role === 'defendant' ? 'defendant' : 'plaintiff'; }
function titleOf(role) { return roleOf(role) === 'defendant' ? '被告' : '原告'; }
function fieldsOf(role) { return Object.keys(draft.schema.defaults).filter(key=>key.startsWith(roleOf(role))); }
function keyOf(role) { return 'jiujiang-claim-' + roleOf(role) + '-templates-v1'; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function list(role) { const saved=wx.getStorageSync(keyOf(role));return saved&&saved.version===1&&Array.isArray(saved.items)?clone(saved.items):[]; }
function write(items,role) { wx.setStorageSync(keyOf(role),{version:1,items}); }
function get(id,role) { return list(role).find(item=>item.id===id); }
function sourceFromCase(role) {
  role=roleOf(role);const current=draft.get(),data={};fieldsOf(role).forEach(key=>{data[key]=current.state[key];});
  const materials=clone(role==='plaintiff'?current.state.identityMaterials:current.state.defendantMaterials).map(item=>role==='defendant'?{...item,name:item.name||'被告主体及地址线索'}:item);
  return {label:data[role+'Name']||'',fields:data,materials,files:current.files.filter(file=>file.group===role).map(file=>({id:file.id,name:file.name,size:file.size,materialId:file.materialId||materials[0].id,sourcePath:file.localPath}))};
}
function validate(input,role) {
  if(!input.fields||!String(input.fields[role+'Name']||'').trim())throw new Error('请填写'+titleOf(role)+'姓名或主体名称');
  if(!['个人','个体工商户','公司'].includes(input.fields[role+'Type']))throw new Error('请选择主体类型');
  if(!input.materials.length||input.materials.length>100||input.materials.some(item=>!String(item.name||'').trim()))throw new Error('每组材料都需要填写名称');
  let total=0;if(input.files.length>100)throw new Error('文件最多100个');
  input.files.forEach(file=>{
    if(!extensions.includes(file.name.split('.').pop().toLowerCase()))throw new Error('材料仅支持图片、PDF和DOCX');
    if(!Number.isInteger(file.size)||file.size<=0||file.size>config.maxFileBytes)throw new Error('每个文件不能超过20MB');
    if(!input.materials.some(item=>item.id===file.materialId))throw new Error('文件所属材料组不存在');
    total+=file.size;
  });
  if(total>config.maxTotalBytes)throw new Error('模板文件总大小不能超过100MB');
}
function copy(source,target) { return new Promise((resolve,reject)=>wx.getFileSystemManager().copyFile({srcPath:source,destPath:target,success:resolve,fail:reject})); }
function cleanup(directory,files) {
  const fs=wx.getFileSystemManager();
  (files||[]).forEach(file=>{if(file.localPath&&file.localPath.startsWith(directory+'/'))try{fs.unlinkSync(file.localPath);}catch(_){}});
  if(directory&&directory.startsWith(wx.env.USER_DATA_PATH+'/claim-'))try{fs.rmdirSync(directory);}catch(_){}
}
async function save(input,role) {
  role=roleOf(role);validate(input,role);const items=list(role),existing=input.id?items.find(item=>item.id===input.id):null;
  if(input.id&&!existing)throw new Error('模板已删除，请重新新增');
  if(!existing&&items.length>=20)throw new Error('每个分区最多保存20个模板');
  const templateId=existing?existing.id:draft.id(),directory=wx.env.USER_DATA_PATH+'/claim-template-'+role+'-'+templateId+'-'+draft.id(),copied=[];
  try{
    wx.getFileSystemManager().mkdirSync(directory,true);
    for(const file of input.files){
      const fileId=draft.id(),localPath=directory+'/'+fileId+'.'+file.name.split('.').pop().toLowerCase();
      copied.push({id:fileId,materialId:file.materialId,name:file.name,size:file.size,localPath});
      await copy(file.sourcePath||file.localPath,localPath);
    }
    const data={};fieldsOf(role).forEach(key=>{data[key]=String(input.fields[key]===undefined?draft.schema.defaults[key]:input.fields[key]);});
    const template={id:templateId,role,label:String(input.label||data[role+'Name']).trim()||data[role+'Name'],fields:data,materials:clone(input.materials),files:copied,directory};
    if(existing)items.splice(items.findIndex(item=>item.id===existing.id),1,template);else items.push(template);
    write(items,role);if(existing)cleanup(existing.directory,existing.files);return clone(template);
  }catch(_){cleanup(directory,copied);throw new Error('模板保存失败，请检查文件和本机存储空间');}
}
async function apply(templateId,role) {
  role=roleOf(role);const template=get(templateId,role);if(!template)throw new Error('模板不存在');
  const remaining=draft.get().files.filter(file=>file.group!==role);
  if(remaining.length+template.files.length>100||remaining.concat(template.files).reduce((sum,file)=>sum+file.size,0)>config.maxTotalBytes)throw new Error('当前案件文件过多，请先整理后再使用模板');
  const directory=wx.env.USER_DATA_PATH+'/claim-case-'+role+'-'+draft.id(),ids={},materials=template.materials.map(item=>{const id=draft.id();ids[item.id]=id;return {id,name:item.name,customized:true};}),copied=[];
  try{
    wx.getFileSystemManager().mkdirSync(directory,true);
    for(const file of template.files){
      const fileId=draft.id(),localPath=directory+'/'+fileId+'.'+file.name.split('.').pop().toLowerCase();
      copied.push({id:fileId,group:role,materialId:ids[file.materialId],name:file.name,size:file.size,localPath});
      await copy(file.localPath,localPath);
    }
  }catch(_){cleanup(directory,copied);throw new Error('模板文件无法读取，请编辑模板重新选择文件');}
  if(role==='plaintiff')draft.replacePlaintiff(template.fields,materials,copied);else draft.replaceDefendant(template.fields,copied,materials);
}
function remove(templateId,role) { const items=list(role),template=items.find(item=>item.id===templateId);if(!template)return;write(items.filter(item=>item.id!==templateId),role);cleanup(template.directory,template.files); }
module.exports={list,get,sourceFromCase,save,apply,remove,titleOf};
