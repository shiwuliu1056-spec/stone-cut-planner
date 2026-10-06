const HOME = 'pages/index/index';
Component({
  properties: { title: String },
  data: { statusHeight: 24, navHeight: 44 },
  lifetimes: {
    attached() {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const capsule = wx.getMenuButtonBoundingClientRect();
      this.setData({ statusHeight: info.statusBarHeight, navHeight: Math.max(44, capsule.height + 2 * (capsule.top - info.statusBarHeight)) });
    },
  },
  methods: {
    home() {
      const pages = getCurrentPages();
      const index = pages.findIndex(page => page.route === HOME);
      const delta = pages.length - 1 - index;
      if (index >= 0) {
        pages[index].switchTool({ currentTarget: { dataset: { tool: 'claim' } } }, false);
        if (delta > 0) wx.navigateBack({ delta });
      } else {
        wx.reLaunch({ url: '/' + HOME + '?tool=claim' });
      }
    },
  },
});
