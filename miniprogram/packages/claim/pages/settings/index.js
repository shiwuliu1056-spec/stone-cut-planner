const draft=require('../../shared/draft');
const templates=require('../../shared/plaintiff-templates');
Page({
  onShow(){this.reload();},
  reload(){this.setData({sections:['plaintiff','defendant'].map(role=>({role,title:templates.titleOf(role)+'模板',hint:role==='plaintiff'?'原告信息及身份证明材料':'被告信息及主体、地址线索',items:templates.list(role).map(item=>({id:item.id,role,label:item.label,name:item.fields[role+'Name'],type:item.fields[role+'Type'],count:item.files.length}))}))});},
  add(e){wx.navigateTo({url:'/packages/claim/pages/template-editor/index?role='+e.currentTarget.dataset.role});},
  edit(e){const d=e.currentTarget.dataset;wx.navigateTo({url:'/packages/claim/pages/template-editor/index?role='+d.role+'&id='+encodeURIComponent(d.id)});},
  use(e){
    const d=e.currentTarget.dataset,template=templates.get(d.id,d.role);if(!template)return;
    const title=templates.titleOf(d.role);
    const run=async()=>{wx.showLoading({title:'填入'+title+'资料'});try{await templates.apply(d.id,d.role);wx.hideLoading();wx.navigateBack({success:()=>wx.showToast({title:'已填入'+title+'资料'})});}catch(error){wx.hideLoading();this.error(error);}};
    const current=draft.get();
    if(current.state[d.role+'Name']&&(current.state[d.role+'Name']!==template.fields[d.role+'Name']||current.state[d.role+'Type']!==template.fields[d.role+'Type']||current.files.some(file=>file.group===d.role)))wx.showModal({title:'使用这个'+title+'模板？',content:'将替换'+title+'信息和对应材料，其余案件资料会保留。',success:res=>{if(res.confirm)run();}});else run();
  },
  remove(e){const d=e.currentTarget.dataset;wx.showModal({title:'删除这个模板？',content:'当前案件中已使用的资料会保留。',success:res=>{if(res.confirm){templates.remove(d.id,d.role);this.reload();}}});},
  error(error){wx.showModal({title:'暂未完成',content:error.message||'请重试',showCancel:false});}
});
