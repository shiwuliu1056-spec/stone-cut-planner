// 文件用途：配置小程序全局参数，开发者工具走本机后端，真机和正式版走 CloudBase。
const { ensureCloudReady } = require("./services/api");

App({
  globalData: {
    cloudEnvId: "cloud1-d7gxlhtv344e94d8e",
    cloudServiceName: "stone-cut-planner-api",
    localBackendInDevtools: true,
    // 真机使用云托管；开发者工具在 onLaunch 中自动切换到本地后端。
    useCloudContainer: true,
    // 开发者工具本机预览地址；真机/上线前替换为 HTTPS 合法域名。
    apiBaseUrl: "http://127.0.0.1:3100",
    publicApiBaseUrl:
      "https://stone-cut-planner-api-305487-11-1477936117.sh.run.tcloudbase.com",
  },

  onLaunch() {
    if (this.globalData.localBackendInDevtools && this.isDevtools()) {
      this.globalData.useCloudContainer = false;
      this.globalData.publicApiBaseUrl = this.globalData.apiBaseUrl;
    }
    if (
      this.globalData.useCloudContainer &&
      this.globalData.cloudEnvId &&
      wx.cloud
    ) {
      wx.cloud.init({ env: this.globalData.cloudEnvId, traceUser: true });
    }
    this.warmUpCloud();
  },

  // 只按运行平台判断是否处于开发者工具：模拟器为 devtools，真机为 ios/android。
  // 不能用 envVersion——真机调试与预览同样返回 develop，会把真机误判成模拟器。
  isDevtools() {
    try {
      if (
        typeof wx.getDeviceInfo === "function" &&
        wx.getDeviceInfo().platform === "devtools"
      )
        return true;
    } catch {
      /* 继续尝试其他方式 */
    }
    try {
      if (
        typeof wx.getSystemInfoSync === "function" &&
        wx.getSystemInfoSync().platform === "devtools"
      )
        return true;
    } catch {
      /* 兜底：按真机处理，走云托管 */
    }
    return false;
  },

  onShow() {
    this.warmUpCloud();
  },

  warmUpCloud() {
    // 每次启动/回前台都拉起云托管容器；纯后台预热，失败静默，真实请求不依赖它。
    ensureCloudReady().catch(() => {});
  },
});
