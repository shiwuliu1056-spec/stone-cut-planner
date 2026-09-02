const { loadProject, saveProject } = require('../../utils/project');

Page({
  data: { imagePath: '', text: '', unit: 'mm', rows: [], saving: false },

  onLoad() {
    const app = getApp();
    const draft = app.globalData.ocrDraft;
    if (!draft) {
      wx.showModal({ title: '没有识别结果', content: '请返回首页重新拍照。', showCancel: false,
        success: () => wx.navigateBack() });
      return;
    }
    this.setData({ imagePath: draft.imagePath || '', text: draft.text || '', unit: draft.unit || 'mm', rows: (draft.parts || []).map((item, index) => ({
      _key: `ocr-${Date.now()}-${index}`,
      id: item.id || '', w: Number(item.w) || 0, h: Number(item.h) || 0, qty: Number(item.qty) || 0,
    })) });
  },

  updateRow(event) {
    const { index, field } = event.currentTarget.dataset;
    const rows = this.data.rows.map((item, i) => (
      i === Number(index) ? { ...item, [field]: Number(event.detail.value) || 0 } : item
    ));
    this.setData({ rows });
  },

  removeRow(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ rows: this.data.rows.filter((_, i) => i !== index) });
  },

  confirmImport() {
    if (this.data.saving) return;
    const rows = this.data.rows.filter((item) => item.w > 0 && item.h > 0 && Number.isInteger(item.qty) && item.qty > 0);
    if (!rows.length) {
      wx.showToast({ title: '请至少保留一条有效记录', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    const project = loadProject();
    saveProject({ ...project, parts: [...project.parts, ...rows] });
    getApp().globalData.ocrDraft = null;
    wx.showToast({ title: `已加入 ${rows.length} 条`, icon: 'success' });
    setTimeout(() => wx.navigateBack(), 450);
  },
});
