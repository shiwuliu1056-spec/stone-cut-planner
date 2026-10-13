const navigation = require('../../../../shared/tool-navigation');
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
      navigation.returnToClaim();
    },
  },
});
