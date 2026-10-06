// 案件总览的交互留在主包；具体填写、检查和下载仍按需打开分包。
const draft = require('./draft');

module.exports = {
  data: {
    completion: 0,
    percentages: [0, 0, 0, 0, 0],
    steps: ['起诉状', '当事人身份证明', '被告线索（辅助）', '证据目录', '送达确认和收款账户'],
  },
  methods: {
    refresh(force) {
      const current = draft.get();
      if (!force && this.progressCaseId === current.caseId && this.progressRevision === current.revision) return;
      const progress = draft.progressSummary();
      this.progressCaseId = current.caseId;
      this.progressRevision = current.revision;
      if (this.data.completion === progress.completion && this.data.percentages.join(',') === progress.columns.join(',')) return;
      this.setData({ completion: progress.completion, percentages: progress.columns });
    },
    open(event) {
      const step = Number(event.currentTarget.dataset.step);
      if (Number.isInteger(step) && step >= 0 && step < 5) wx.navigateTo({ url: draft.pagePath(step) });
    },
    continueCase() { wx.navigateTo({ url: draft.pagePath(0) }); },
    review() { wx.navigateTo({ url: draft.pagePath(5) }); },
    manage() { wx.navigateTo({ url: '/packages/claim/pages/settings/index' }); },
    useSample() { this.caseAction('sample'); },
    clearCase() { this.caseAction('clear'); },
    caseAction(type) {
      wx.showModal({
        title: type === 'sample' ? '使用示例资料？' : '清空案件资料？',
        content: type === 'sample' ? '当前案件会替换为虚构示例，已保存的原告和被告模板会保留。' : '只清空当前案件，已保存的原告和被告模板会保留。',
        success: res => {
          if (!res.confirm) return;
          draft.reset(type === 'sample');
          this.refresh();
          wx.showToast({ title: type === 'sample' ? '已填入示例' : '已清空案件' });
        },
      });
    },
  },
};
