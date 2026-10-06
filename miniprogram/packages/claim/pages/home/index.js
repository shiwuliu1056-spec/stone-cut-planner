// 兼容旧入口：实际案件总览已移到主页面常驻组件，不再创建第二份总览。
Page({
  onLoad() {
    const pages = getCurrentPages();
    const index = pages.findIndex(page => page.route === 'pages/index/index');
    if (index >= 0) {
      pages[index].switchTool({ currentTarget: { dataset: { tool: 'claim' } } }, false);
      wx.navigateBack({ delta: pages.length - 1 - index });
    } else {
      wx.reLaunch({ url: '/pages/index/index?tool=claim' });
    }
  },
});
