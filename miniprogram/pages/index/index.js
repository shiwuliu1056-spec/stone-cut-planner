const { defaultProject, loadProject, projectSummary, saveProject } = require('../../utils/project');
const { deleteCloudFile, getCloudTempUrl, readLocalFile, requestBinary, requestJson, uploadCloudFile } = require('../../services/api');

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

Page({
  data: {
    project: defaultProject(),
    summary: { totalCount: 0, totalArea: '0.000' },
    slabLimits: ['不限', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    fastPresetLabels: ['节省材料（90%）', '平衡（80%）', '优先快切（70%）'],
    importing: false,
    ocrBusy: false,
    solving: false,
    busy: false,
    progressTask: '',
    progress: 0,
  },

  onLoad() {
    this.pageDestroyed = false;
    this.syncProject(loadProject());
  },

  onShow() { this.syncProject(loadProject()); },

  onUnload() {
    this.pageDestroyed = true;
    this.clearProgress();
  },

  isBusy() { return Boolean(this.busyLock); },

  lockBusy() {
    if (this.busyLock) return false;
    this.busyLock = true;
    if (!this.pageDestroyed) this.setData({ busy: true });
    return true;
  },

  unlockBusy() {
    this.busyLock = false;
    if (!this.pageDestroyed) this.setData({ busy: false });
  },

  beginProgress(task) {
    this.clearProgress();
    const token = String((this.progressSequence || 0) + 1);
    this.progressSequence = Number(token);
    this.progressToken = token;
    this.progressPhase = 'upload';
    this.setData({ progressTask: task, progress: 1 });
    this.progressTimer = setInterval(() => {
      if (this.pageDestroyed || token !== this.progressToken || this.progressPhase !== 'request') return;
      const current = Number(this.data.progress) || 1;
      if (current >= 94) return;
      const next = Math.min(94, current + (current < 40 ? 4 : 2));
      this.setData({ progress: next });
    }, 360);
    return token;
  },

  updateUploadProgress(token, value) {
    if (this.pageDestroyed || token !== this.progressToken) return;
    const current = Number(this.data.progress) || 0;
    const mapped = Math.max(5, Math.min(45, 5 + Math.round(Number(value || 0) * 0.4)));
    if (mapped > current) this.setData({ progress: mapped });
  },

  beginRequestProgress(token, baseline = 45) {
    if (this.pageDestroyed || token !== this.progressToken) return;
    this.progressPhase = 'request';
    const current = Number(this.data.progress) || 0;
    this.setData({ progress: Math.max(current, baseline) });
  },

  clearProgress(token) {
    if (token && token !== this.progressToken) return;
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
    this.progressToken = '';
    this.progressPhase = '';
    if (!this.pageDestroyed && this.data.progressTask) this.setData({ progressTask: '', progress: 0 });
  },

  async completeProgress(token) {
    if (this.pageDestroyed || token !== this.progressToken) return false;
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
    if (!this.data.progressTask) return false;
    await new Promise((resolve) => this.setData({ progress: 100 }, () => setTimeout(resolve, 420)));
    if (this.pageDestroyed || token !== this.progressToken) return false;
    this.clearProgress(token);
    return true;
  },

  syncProject(project) { this.setData({ project, summary: projectSummary(project) }); },

  persist(project) { this.syncProject(saveProject(project)); },

  updateSlab(event) {
    const { index, field } = event.currentTarget.dataset;
    const slabs = this.data.project.slabs.map((item, i) => (
      i === Number(index) ? { ...item, [field]: numberValue(event.detail.value) } : item
    ));
    this.persist({ ...this.data.project, slabs });
  },

  updateSlabLimit(event) {
    const index = Number(event.currentTarget.dataset.index);
    const selected = Number(event.detail.value);
    const slabs = this.data.project.slabs.map((item, i) => (
      i === index ? { ...item, limit: selected === 0 ? null : selected } : item
    ));
    this.persist({ ...this.data.project, slabs });
  },

  addSlab() {
    this.persist({ ...this.data.project, slabs: [
      ...this.data.project.slabs, { id: '', w: 2400, h: 1600, limit: null },
    ] });
  },

  removeSlab(event) {
    if (this.data.project.slabs.length <= 1) {
      wx.showToast({ title: '至少保留一张大板', icon: 'none' });
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    this.persist({ ...this.data.project, slabs: this.data.project.slabs.filter((_, i) => i !== index) });
  },

  updatePart(event) {
    const { index, field } = event.currentTarget.dataset;
    const parts = this.data.project.parts.map((item, i) => (
      i === Number(index) ? { ...item, [field]: numberValue(event.detail.value) } : item
    ));
    this.persist({ ...this.data.project, parts });
  },

  addPart() {
    this.persist({ ...this.data.project, parts: [
      ...this.data.project.parts, { id: '', w: 0, h: 0, qty: 1, rotatable: true },
    ] });
  },

  removePart(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.persist({ ...this.data.project, parts: this.data.project.parts.filter((_, i) => i !== index) });
  },

  setAlgorithm(event) {
    this.persist({ ...this.data.project, algorithm: event.currentTarget.dataset.algorithm });
  },

  setFastPreset(event) {
    const values = ['material', 'balanced', 'speed'];
    this.persist({ ...this.data.project, fastPreset: values[Number(event.detail.value)] || 'balanced' });
  },

  resetDefault() {
    wx.showModal({
      title: '恢复默认数据？', content: '当前录入内容会被替换。', confirmColor: '#173e38',
      success: (res) => { if (res.confirm) this.persist(defaultProject()); },
    });
  },

  resetPartsDefault() {
    wx.showModal({
      title: '恢复小料默认？',
      content: '当前小料清单会被替换，大板设置不会改变。',
      confirmColor: '#173e38',
      success: (res) => {
        if (!res.confirm) return;
        const defaults = defaultProject();
        this.persist({ ...this.data.project, parts: defaults.parts });
      },
    });
  },

  chooseExcel() {
    if (this.isBusy() || !this.lockBusy()) return;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) { this.unlockBusy(); return; }
        this.setData({ importing: true });
        const progressToken = this.beginProgress('import');
        let cloudFileID = '';
        try {
          let result;
          if (getApp().globalData.useCloudContainer) {
            const uploaded = await uploadCloudFile(file.path, 'imports', (value) => this.updateUploadProgress(progressToken, value));
            cloudFileID = uploaded.fileID;
            const url = await getCloudTempUrl(cloudFileID);
            this.beginRequestProgress(progressToken);
            result = await requestJson('/api/import-url', { method: 'POST', data: { url } });
          } else {
            const buffer = await readLocalFile(file.path);
            this.beginRequestProgress(progressToken, 18);
            result = await requestBinary('/api/import', buffer);
          }
          if (!Array.isArray(result.parts) || !result.parts.length) throw new Error('表格中没有有效的小料');
          this.persist({ ...this.data.project, parts: result.parts });
          if (!await this.completeProgress(progressToken)) return;
          wx.showToast({ title: `已导入 ${result.parts.length} 种规格`, icon: 'success' });
        } catch (error) {
          this.clearProgress(progressToken);
          if (!this.pageDestroyed) wx.showModal({ title: '导入失败', content: error.message || '无法读取表格', showCancel: false });
        } finally {
          await deleteCloudFile(cloudFileID);
          if (!this.pageDestroyed) this.setData({ importing: false });
          this.unlockBusy();
        }
      },
      fail: (error) => {
        this.unlockBusy();
        if (error && error.errMsg && !error.errMsg.includes('cancel')) {
          wx.showToast({ title: '请在真机选择 .xlsx 文件', icon: 'none' });
        }
      },
    });
  },

  choosePhoto() {
    if (this.isBusy() || !this.lockBusy()) return;
    wx.showActionSheet({
      itemList: ['毫米（mm）', '厘米（cm）'],
      success: (choice) => this.choosePhotoWithUnit(choice.tapIndex === 1 ? 'cm' : 'mm'),
      fail: () => this.unlockBusy(),
    });
  },

  choosePhotoWithUnit(unit) {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) { this.unlockBusy(); return; }
        this.setData({ ocrBusy: true });
        const progressToken = this.beginProgress('ocr');
        let cloudFileID = '';
        try {
          let imagePath = file.tempFilePath;
          try {
            const compressed = await new Promise((resolve, reject) => wx.compressImage({
              src: imagePath, quality: 85,
              success: resolve, fail: reject,
            }));
            imagePath = compressed.tempFilePath || imagePath;
          } catch (_) { /* 部分开发者工具不支持压缩，继续使用原图 */ }
          let result;
          if (getApp().globalData.useCloudContainer) {
            const uploaded = await uploadCloudFile(imagePath, 'ocr', (value) => this.updateUploadProgress(progressToken, value));
            cloudFileID = uploaded.fileID;
            const url = await getCloudTempUrl(cloudFileID);
            this.beginRequestProgress(progressToken);
            result = await requestJson('/api/ocr/photo-url', { method: 'POST', data: { url, unit }, timeout: 60000 });
          } else {
            const imageInfo = await new Promise((resolve, reject) => wx.getImageInfo({ src: imagePath, success: resolve, fail: reject }));
            const type = String(imageInfo.type || imagePath.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpeg').toLowerCase();
            const mime = type === 'jpg' ? 'jpeg' : type;
            const base64 = await readLocalFile(imagePath, 'base64');
            const image = `data:image/${mime};base64,${base64}`;
            this.beginRequestProgress(progressToken, 18);
            result = await requestJson('/api/ocr/photo', { method: 'POST', data: { image, unit }, timeout: 60000 });
          }
          if (!Array.isArray(result.parts) || !result.parts.length) throw new Error('没有识别出有效尺寸，请换一张清晰照片');
          const app = getApp();
          app.globalData.ocrDraft = { imagePath, text: result.text || '', unit, parts: result.parts };
          if (!await this.completeProgress(progressToken)) return;
          wx.navigateTo({ url: '/pages/ocr-review/ocr-review' });
        } catch (error) {
          this.clearProgress(progressToken);
          if (!this.pageDestroyed) wx.showModal({ title: '识别失败', content: error.message || '请稍后重试', showCancel: false });
        } finally {
          await deleteCloudFile(cloudFileID);
          if (!this.pageDestroyed) this.setData({ ocrBusy: false });
          this.unlockBusy();
        }
      },
      fail: (error) => {
        this.unlockBusy();
        if (error && error.errMsg && !error.errMsg.includes('cancel')) {
          wx.showToast({ title: '请在真机使用相机或相册', icon: 'none' });
        }
      },
    });
  },

  async handleSolve() {
    if (this.isBusy() || !this.lockBusy()) return;
    const { slabs, parts, algorithm, fastPreset } = this.data.project;
    const invalidSlab = slabs.find((item) => !Number.isInteger(item.w) || item.w <= 0 || !Number.isInteger(item.h) || item.h <= 0);
    const invalidPart = parts.find((item) => !Number.isInteger(item.w) || item.w <= 0 || !Number.isInteger(item.h) || item.h <= 0 || !Number.isInteger(item.qty) || item.qty <= 0);
    if (invalidSlab) {
      this.unlockBusy();
      wx.showToast({ title: '请填写正确的大板尺寸', icon: 'none' });
      return;
    }
    if (invalidPart) {
      this.unlockBusy();
      wx.showToast({ title: '请填写正确的小料尺寸和数量', icon: 'none' });
      return;
    }
    if (!parts.length) {
      this.unlockBusy();
      wx.showToast({ title: '请至少添加一条小料', icon: 'none' });
      return;
    }
    this.setData({ solving: true });
    const progressToken = this.beginProgress(algorithm === 'fast' ? 'fast' : 'standard');
    this.beginRequestProgress(progressToken, 18);
    try {
      const response = await requestJson('/api/solve', {
        method: 'POST',
        data: { settings: { algorithm, fastPreset, slabs }, parts },
        timeout: 60000,
      });
      if (!response.result || !response.result.plans || !response.result.plans.A) throw new Error('排版服务返回结果为空');
      getApp().globalData.latestResult = response.result;
      if (!await this.completeProgress(progressToken)) return;
      wx.navigateTo({ url: '/pages/result/result' });
    } catch (error) {
      this.clearProgress(progressToken);
      if (!this.pageDestroyed) wx.showModal({ title: '排版失败', content: error.message || '请检查网络后重试', showCancel: false });
    } finally {
      if (!this.pageDestroyed) this.setData({ solving: false });
      this.unlockBusy();
    }
  },

  noop() {},
});
