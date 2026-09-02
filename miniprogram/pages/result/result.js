const { drawSlab } = require('../../utils/render');

Page({
  data: { result: null, plan: null, stats: null, productRateText: '0.0%', offcutAreaText: '0.000 ㎡', slabIndex: 0, renderedSlabIndex: -1, canvasReady: false, drawing: false, saving: false },

  onLoad() {
    const result = getApp().globalData.latestResult;
    if (!result || !result.plans || !result.plans.A) {
      wx.showModal({ title: '没有排版结果', content: '请返回首页重新计算。', showCancel: false,
        success: () => wx.navigateBack() });
      return;
    }
    const plan = result.plans.A;
    const slabArea = plan.slabs.reduce((sum, slab) => sum + ((Number(slab.w) || 0) * (Number(slab.h) || 0)), 0);
    const productArea = plan.slabs.reduce((sum, slab) => sum + (slab.placements || []).reduce((subtotal, item) => subtotal + ((Number(item.w) || 0) * (Number(item.h) || 0)), 0), 0);
    const productRate = slabArea > 0 ? (productArea / slabArea) * 100 : 0;
    this.setData({ result, plan, stats: plan.stats, productRateText: `${productRate.toFixed(1)}%`, offcutAreaText: `${((plan.stats.offcutArea || 0) / 1000000).toFixed(3)} ㎡`, slabIndex: 0, renderedSlabIndex: -1 }, () => this.drawCurrent());
  },

  drawCurrent() {
    const slab = this.data.plan && this.data.plan.slabs && this.data.plan.slabs[this.data.slabIndex];
    if (!slab) return;
    const drawToken = (this.drawToken || 0) + 1;
    const slabIndex = this.data.slabIndex;
    this.drawToken = drawToken;
    this.setData({ drawing: true });
    this.createSelectorQuery().select('#slab-canvas').fields({ node: true, size: true }).exec((res) => {
      if (drawToken !== this.drawToken || slabIndex !== this.data.slabIndex) return;
      const target = res && res[0];
      if (!target || !target.node) {
        this.setData({ drawing: false });
        return;
      }
      drawSlab(target.node, slab);
      this.canvas = target.node;
      this.setData({ canvasReady: true, renderedSlabIndex: slabIndex, drawing: false });
    });
  },

  previousSlab() {
    if (this.data.slabIndex <= 0) return;
    this.setData({ slabIndex: this.data.slabIndex - 1, renderedSlabIndex: -1, canvasReady: false, drawing: true }, () => this.drawCurrent());
  },

  nextSlab() {
    const total = this.data.plan.slabs.length;
    if (this.data.slabIndex >= total - 1) return;
    this.setData({ slabIndex: this.data.slabIndex + 1, renderedSlabIndex: -1, canvasReady: false, drawing: true }, () => this.drawCurrent());
  },

  exportCanvas() {
    if (!this.data.canvasReady || this.data.drawing || this.data.renderedSlabIndex !== this.data.slabIndex || !this.canvas) return Promise.reject(new Error('排版图还没有绘制完成'));
    return new Promise((resolve, reject) => wx.canvasToTempFilePath({
      canvas: this.canvas,
      x: 0, y: 0, width: 3000, height: 2121, destWidth: 3000, destHeight: 2121,
      fileType: 'png',
      success: (res) => resolve(res.tempFilePath),
      fail: reject,
    }, this));
  },

  async previewImage() {
    if (this.data.saving || this.data.drawing || !this.data.canvasReady) return;
    this.setData({ saving: true });
    try {
      const filePath = await this.exportCanvas();
      wx.previewImage({ urls: [filePath], current: filePath });
    } catch (_) {
      wx.showToast({ title: '图片生成失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async saveImage() {
    if (this.data.saving || this.data.drawing || !this.data.canvasReady) return;
    this.setData({ saving: true });
    try {
      const filePath = await this.exportCanvas();
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject }));
      wx.showToast({ title: '图片已保存', icon: 'success' });
    } catch (error) {
      if (String(error.errMsg || '').includes('auth deny')) {
        wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册。', confirmColor: '#173e38',
          success: (modal) => { if (modal.confirm) wx.openSetting(); } });
      } else wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
});
