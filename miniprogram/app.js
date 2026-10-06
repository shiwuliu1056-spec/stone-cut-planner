// 文件用途：配置小程序全局参数并预热后端。
// 已完全脱离云开发：不再使用 wx.cloud（既不用 callContainer，也不用云存储），
// 所有请求都走自建后端的 HTTPS 域名。
const { ensureBackendReady } = require("./services/api");

App({
  globalData: {
    // 自建后端根地址。必须是 HTTPS，且在小程序后台登记为 request 合法域名，
    // 否则 wx.request 会被平台拦下。
    apiBaseUrl: "https://cacci.cn/bstools",
    // 开发者工具直连本机后端。该地址在手机上指向手机自身，真机不可用，
    // 所以只按运行平台判断，绝不让真机走到这个分支（见 isDevtools 注释）。
    localBackendInDevtools: true,
    localApiBaseUrl: "http://127.0.0.1:3100",
    // 运行期数据：拍照识别草稿与最近一次排版结果，由页面写入、跨页读取。
    ocrDraft: null,
    latestResult: null,
  },

  onLaunch() {
    this.applyRuntimeConfig();
    this.warmUpBackend();
  },

  onShow() {
    this.warmUpBackend();
  },

  // 只按运行平台判断是否处于开发者工具：模拟器为 devtools，真机为 ios/android。
  // 不能用 envVersion——真机调试与预览同样返回 develop，会把真机误判成模拟器，
  // 从而拿到 http://127.0.0.1:3100（在手机上指向手机自身）而必然请求失败。
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
      /* 兜底：按真机处理 */
    }
    return false;
  },

  applyRuntimeConfig() {
    if (this.globalData.localBackendInDevtools && this.isDevtools()) {
      this.globalData.apiBaseUrl = this.globalData.localApiBaseUrl;
    }
  },

  // 纯后台预热：每次启动/回前台各触发一次，失败静默，真实请求不依赖它。
  warmUpBackend() {
    ensureBackendReady().catch(() => {});
  },
});
