App({
  globalData: {
    cloudEnvId: 'cloud1-d7gxlhtv344e94d8e',
    cloudServiceName: 'stone-cut-planner-api',
    // 云托管服务部署完成后改为 true；本地开发仍使用 apiBaseUrl。
    useCloudContainer: true,
    // 开发者工具本机预览地址；真机/上线前替换为 HTTPS 合法域名。
    apiBaseUrl: 'http://127.0.0.1:3000',
    draftStorageKey: 'stone-planner-miniprogram-draft-v1',
  },

  onLaunch() {
    if (this.globalData.cloudEnvId && wx.cloud) {
      wx.cloud.init({ env: this.globalData.cloudEnvId, traceUser: true });
    }
  },
});
