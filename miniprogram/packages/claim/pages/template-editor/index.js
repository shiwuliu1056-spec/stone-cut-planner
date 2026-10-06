const draft = require('../../shared/draft');
const templates = require('../../shared/plaintiff-templates');
const config = require('../../shared/config');
Page({
  data: { fields: [], groups: [], label: '', saving: false },
  onLoad(query) {
    this.role = query.role === 'defendant' ? 'defendant' : 'plaintiff';
    wx.setNavigationBarTitle({title:templates.titleOf(this.role)+'模板'});
    const saved = query.id ? templates.get(query.id,this.role) : null;
    if (query.id && !saved) { wx.showToast({ title: '模板已删除', icon: 'none' }); wx.navigateBack(); return; }
    const source = saved || templates.sourceFromCase(this.role);
    this.templateId = saved ? saved.id : '';
    this.values = Object.assign({}, source.fields);
    this.materials = JSON.parse(JSON.stringify(source.materials));
    this.files = source.files.map(file => Object.assign({},file,{ sourcePath: file.sourcePath || file.localPath }));
    this.setData({ label: source.label, roleTitle:templates.titleOf(this.role), materialTitle:this.role==='defendant'?'主体及地址线索材料':'身份证明材料' }); this.renderFields(); this.renderGroups();
  },
  renderFields() {
    const fields = draft.schema.steps[this.role === 'defendant' ? 2 : 0].fields.filter(field => field.key.startsWith(this.role) && (!field.condition || (field.condition === this.role + '-natural' ? this.values[this.role+'Type'] === '个人' : this.values[this.role+'Type'] !== '个人'))).map(field => {
      const options = field.options || [], choice = options.findIndex(option => option.value === this.values[field.key]);
      return Object.assign({},field,{ value: this.values[field.key], choice: Math.max(0,choice), options: options.map(option=>option.label), optionValues: options.map(option=>option.value), display: choice >= 0 ? options[choice].label : '请选择', required: field.key === this.role+'Name' });
    });
    this.setData({ fields });
  },
  renderGroups() { this.setData({ groups: this.materials.map((row,index) => Object.assign({},row,{ number: String(index+1).padStart(2,'0'), files: this.files.filter(file=>file.materialId===row.id) })) }); },
  labelInput(e) { this.setData({ label: e.detail.value }); },
  input(e) {
    const key = e.currentTarget.dataset.key, previous = this.values[key]; this.values[key] = e.detail.value;
    if (key === this.role+'Name' && (!this.data.label || this.data.label === previous)) this.setData({ label: e.detail.value });
  },
  select(e) {
    const field = this.data.fields.find(field=>field.key===e.currentTarget.dataset.key), previous = this.values[field.key];
    this.values[field.key] = field.optionValues[+e.detail.value];
    if (field.key === this.role+'Type') {
      this.materials.forEach(row => { if (!row.customized && !this.files.some(file=>file.materialId===row.id) && row.name === (previous === '个人' ? '身份证' : '营业执照')) row.name = this.values[this.role+'Type'] === '个人' ? '身份证' : '营业执照'; });
      this.renderGroups();
    }
    this.renderFields();
  },
  addGroup() { if(this.materials.length>=100)return; this.materials.push({ id:draft.id(),name:this.role==='defendant'?'被告信息材料':this.values[this.role+'Type']==='个人'?'身份证':'营业执照',customized:false });this.renderGroups(); },
  groupName(e) { const row=this.materials.find(row=>row.id===e.currentTarget.dataset.id);if(row){row.name=e.detail.value;row.customized=true;} },
  removeGroup(e) { if(this.materials.length<=1)return;const id=e.currentTarget.dataset.id;this.materials=this.materials.filter(row=>row.id!==id);this.files=this.files.filter(file=>file.materialId!==id);this.renderGroups(); },
  removeFile(e) { this.files=this.files.filter(file=>file.id!==e.currentTarget.dataset.id);this.renderGroups(); },
  chooseFiles(e) {
    const materialId=e.currentTarget.dataset.id;
    const done=files=>{
      const errors=[];let total=this.files.reduce((sum,file)=>sum+file.size,0);
      files.forEach(file=>{
        const name=file.name||'图片-'+draft.id()+'.'+(file.path.split('.').pop().toLowerCase()==='png'?'png':'jpg');
        if(!['jpg','jpeg','png','pdf','docx'].includes(name.split('.').pop().toLowerCase())){errors.push(name+'：请转换成图片、PDF或DOCX');return;}
        if(!file.size||file.size>config.maxFileBytes||total+file.size>config.maxTotalBytes||this.files.length>=100){errors.push(name+'：超过文件大小或数量限制');return;}
        this.files.push({id:draft.id(),materialId,name,size:file.size,sourcePath:file.path});total+=file.size;
      });
      this.renderGroups();if(errors.length)wx.showModal({title:'部分文件未加入',content:errors.join('\n'),showCancel:false});
    };
    const failed=error=>{if(!String(error.errMsg||'').includes('cancel'))this.error(error);};
    wx.showActionSheet({itemList:['从相册选择图片或拍照','从微信聊天选择文件'],success:res=>{
      if(res.tapIndex===0)wx.chooseMedia({count:9,mediaType:['image'],sourceType:['album','camera'],success:result=>done(result.tempFiles.map(file=>({path:file.tempFilePath,size:file.size}))),fail:failed});
      else wx.chooseMessageFile({count:9,type:'file',success:result=>done(result.tempFiles.map(file=>({path:file.path,size:file.size,name:file.name}))),fail:failed});
    }});
  },
  async save() {
    if(this.data.saving)return;this.setData({saving:true});wx.showLoading({title:'保存模板'});
    try{await templates.save({id:this.templateId||undefined,label:this.data.label,fields:this.values,materials:this.materials,files:this.files},this.role);wx.hideLoading();wx.navigateBack({success:()=>wx.showToast({title:'模板已保存'})});}
    catch(error){wx.hideLoading();this.error(error);}finally{this.setData({saving:false});}
  },
  error(error) { wx.showModal({title:'暂未完成',content:error.message||error.errMsg||'请重试',showCancel:false}); },
});
