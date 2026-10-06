const draft = require('../../shared/draft');
const api = require('../../shared/api');
const templates = require('../../shared/templates');
const generation = require('../../shared/generation');
Page({
  data: { result: null, busy: false, message: '', stale: false, pageTitle:'本案资料', failed:false },
  onLoad(query) { this.active = true; this.caseId=draft.get().caseId; this.refresh(); if (query.generate === '1') this.generate(); else if (this.data.result && ['queued','generating'].includes(this.data.result.status)) this.poll(); },
  onShow() { this.active = true; this.refresh(); },
  onUnload() { this.active = false; clearTimeout(this.timer); },
  refresh() {
    const current = draft.get(); const result = current.result ? Object.assign({}, current.result) : null;
    if (result) result.outputs = (result.outputs || []).map(output => {
      const key = output.name.includes('起诉状') ? 'complaint' : output.name.includes('当事人') ? 'identity' : output.name.includes('被告') ? 'defendant' : output.name.includes('证据目录') ? 'evidence' : output.name.includes('送达') ? 'service' : output.name.includes('收款') ? 'refund' : null;
      return Object.assign({},output,{ template: templates[key] || { badge: '材料整理', name: '上传原件合并' } });
    });
    this.setData({ result, stale: !!current.result && generation.stale(current.result,current) });
  },
  async generate() {
    if(this.data.busy)return;this.setData({busy:true,failed:false,message:'正在准备资料包…'});
    try{
      const task=await generation.generate({isActive:()=>this.active,onMessage:message=>{if(this.active)this.setData({message});}});
      if(!task)return;
      this.refresh();this.poll();
    }catch(error){if(this.active){this.setData({message:error.message,busy:false,failed:true});this.refresh();}}
  },
  async poll() {
    if (!this.active || !draft.get().result || draft.get().caseId!==this.caseId) return;
    try {
      const current = draft.get(), taskId = current.result.id;
      const task = await api.call('/tasks/' + taskId);
      if (!this.active || draft.get().caseId!==this.caseId || !current.result || current.result.id !== taskId) return;
      Object.assign(current.result, task); draft.persist(false); this.refresh();
      if (task.status === 'ready') { this.setData({ message: '', busy: false, failed:false }); return; }
      if (task.status === 'failed') { this.setData({ message: task.error, busy: false, failed:true }); return; }
      this.setData({ message: task.status === 'queued' ? '正在排队…' : '正在排版和计算页码…', busy: true });
      this.timer = setTimeout(() => this.poll(), 1500);
    } catch (error) { if(this.active)this.setData({ message: error.message, busy: false, failed:true }); }
  },
  async getFile(output) {
    this.refresh(); if (this.data.stale) throw new Error('内容已修改或任务已过期，请重新生成');
    const result = draft.get().result; if(!result.localFiles)result.localFiles={}; let localPath = result.localFiles[output.id];
    if (localPath) { try { wx.getFileSystemManager().accessSync(localPath); return localPath; } catch (_) {} }
    localPath = await api.download(result.id, output); result.localFiles[output.id] = localPath; draft.persist(false); return localPath;
  },
  async open(e) {
    try { wx.showLoading({ title: '下载中' }); const output = this.data.result.outputs[e.currentTarget.dataset.index]; const filePath = await this.getFile(output); wx.hideLoading(); wx.openDocument({ filePath, fileType: 'docx', showMenu: true, fail: err => this.error(err) }); }
    catch (error) { wx.hideLoading(); this.error(error); }
  },
  async downloadPackage() {
    try{wx.showLoading({title:'下载中'});await this.getFile({id:'package',name:'起诉资料包.zip'});wx.hideLoading();wx.showToast({title:'已下载到本机',icon:'success'});}
    catch(error){wx.hideLoading();this.error(error);}
  },
  async share(e) {
    try {
      wx.showLoading({ title: '下载中' });
      const output = e.currentTarget.dataset.package ? { id: 'package', name: '起诉资料包.zip' } : this.data.result.outputs[e.currentTarget.dataset.index];
      const filePath = await this.getFile(output); wx.hideLoading();
      if (typeof wx.shareFileMessage !== 'function') { wx.showModal({ title: '文件已保存', content: '当前微信版本不支持直接转发，请升级微信；Word也可通过文档查看器转发。', showCancel: false }); return; }
      wx.shareFileMessage({ filePath, fileName: output.name, fail: err => { if (!String(err.errMsg).includes('cancel')) this.error(err); } });
    } catch (error) { wx.hideLoading(); this.error(error); }
  },
  async deleteTask() {
    wx.showModal({ title: '删除服务器上的临时资料？', content: '填写内容仍保留在本机。', success: async res => { if (!res.confirm) return; try { await api.call('/tasks/' + draft.get().result.id,'DELETE'); draft.get().result = null; draft.persist(false); this.refresh(); this.setData({ message: '临时任务已删除' }); } catch (error) { this.error(error); } } });
  },
  error(error) { wx.showModal({ title: '暂未完成', content: error.message || error.errMsg || '请重试', showCancel: false }); },
});
