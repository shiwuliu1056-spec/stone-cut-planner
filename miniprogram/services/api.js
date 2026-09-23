// 文件用途：统一封装 CloudBase、HTTP、文件上传下载、云服务预热与自动重试。
function getBaseUrl() {
  const app = getApp();
  return String(
    (app && app.globalData && app.globalData.apiBaseUrl) || "",
  ).replace(/\/$/, "");
}

function getAppConfig() {
  const app = getApp();
  return (app && app.globalData) || {};
}

function networkRequestError(source) {
  const message = String((source && source.errMsg) || "").trim();
  const config = getAppConfig();
  if (
    !config.useCloudContainer &&
    config.localBackendInDevtools &&
    /^request:fail\b/i.test(message)
  ) {
    const baseUrl = getBaseUrl();
    return new Error(
      `本地后端连接失败，请先启动项目后端并确认 ${baseUrl || "127.0.0.1:3100"} 可访问`,
    );
  }
  return new Error(message || "网络请求失败");
}

const CLOUD_RETRY_DELAY_MS = 1200;
let cloudWarmPromise = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldUseCloudContainer() {
  const config = getAppConfig();
  return Boolean(
    config.useCloudContainer &&
      config.cloudEnvId &&
      config.cloudServiceName &&
      wx.cloud &&
      wx.cloud.callContainer,
  );
}

function invokeCloudContainer(path, options = {}) {
  const config = getAppConfig();
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: config.cloudEnvId },
      path,
      method: options.method || "GET",
      data: options.data,
      header: {
        "content-type": "application/json",
        "X-WX-SERVICE": config.cloudServiceName,
        ...(options.header || {}),
      },
      timeout: options.timeout || 30000,
      dataType: options.dataType || "json",
      success(res) {
        const data = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          const error = new Error(
            data.error || `云托管请求失败（${res.statusCode}）`,
          );
          error.statusCode = res.statusCode;
          reject(error);
        }
      },
      fail(source) {
        const error = new Error(source.errMsg || "云托管请求失败");
        error.code = source.errCode || source.code;
        reject(error);
      },
    });
  });
}

function isTransientCloudError(error) {
  const message = String((error && error.message) || "").toLowerCase();
  const code = String((error && error.code) || "");
  const status = Number(error && error.statusCode);
  return (
    code === "102002" ||
    code === "-601001" ||
    code === "-601008" ||
    message.includes("102002") ||
    message.includes("system error") ||
    message.includes("timeout") ||
    message.includes("超时") ||
    message.includes("network") ||
    message.includes("连接失败") ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function invokeCloudContainerWithRetry(path, options = {}) {
  const retries = Number.isInteger(options.retries)
    ? Math.max(0, options.retries)
    : 1;
  let attempt = 0;
  while (true) {
    try {
      return await invokeCloudContainer(path, options);
    } catch (error) {
      if (attempt >= retries || !isTransientCloudError(error)) throw error;
      attempt += 1;
      await wait(CLOUD_RETRY_DELAY_MS * attempt);
    }
  }
}

// 预热只负责在后台提前拉起云托管容器：每次启动/回前台各触发一次，
// 不缓存结果、不阻塞真实请求。冷启动等待由首个真实请求自己承担，
// 并发去重只用于避免同时发出多个健康检查。
function ensureCloudReady() {
  if (!shouldUseCloudContainer()) return Promise.resolve(true);
  if (cloudWarmPromise) return cloudWarmPromise;
  cloudWarmPromise = invokeCloudContainerWithRetry("/api/health", {
    timeout: 35000,
    retries: 1,
  })
    .then((result) => Boolean(result && result.ok))
    .finally(() => {
      cloudWarmPromise = null;
    });
  return cloudWarmPromise;
}

function requestJson(path, options = {}) {
  if (shouldUseCloudContainer())
    return invokeCloudContainerWithRetry(path, options);
  const baseUrl = getBaseUrl();
  if (!baseUrl || baseUrl.includes("你的-api-域名")) {
    return Promise.reject(new Error("请先在 app.js 配置 API 地址"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: { "content-type": "application/json", ...(options.header || {}) },
      timeout: options.timeout || 30000,
      success(res) {
        const data = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(data.error || `请求失败（${res.statusCode}）`));
      },
      fail(error) {
        reject(networkRequestError(error));
      },
    });
  });
}

function requestBinary(path, data, options = {}) {
  if (shouldUseCloudContainer()) {
    return invokeCloudContainerWithRetry(path, {
      ...options,
      data,
      dataType: "text",
      header: {
        "content-type": "application/octet-stream",
        ...(options.header || {}),
      },
    });
  }
  const baseUrl = getBaseUrl();
  if (!baseUrl || baseUrl.includes("你的-api-域名")) {
    return Promise.reject(new Error("请先在 app.js 配置 API 地址"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method: options.method || "POST",
      data,
      header: {
        "content-type": "application/octet-stream",
        ...(options.header || {}),
      },
      dataType: "text",
      responseType: "text",
      timeout: options.timeout || 30000,
      success(res) {
        let body = {};
        try {
          body =
            typeof res.data === "string"
              ? JSON.parse(res.data || "{}")
              : res.data || {};
        } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(body.error || `请求失败（${res.statusCode}）`));
      },
      fail(error) {
        reject(networkRequestError(error));
      },
    });
  });
}

function readLocalFile(filePath, encoding) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      ...(encoding ? { encoding } : {}),
      success: (res) => resolve(res.data),
      fail: (error) => reject(new Error(error.errMsg || "读取文件失败")),
    });
  });
}

function uploadCloudFile(filePath, prefix = "uploads", onProgress) {
  const config = getAppConfig();
  if (!config.cloudEnvId || !wx.cloud || !wx.cloud.uploadFile)
    return Promise.reject(new Error("云存储能力不可用"));
  const extension = String(
    filePath.match(/\.([a-z0-9]+)$/i)?.[1] || "bin",
  ).toLowerCase();
  const cloudPath = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  return new Promise((resolve, reject) => {
    const task = wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: (error) => reject(new Error(error.errMsg || "文件上传失败")),
    });
    if (task && typeof task.onProgressUpdate === "function") {
      task.onProgressUpdate((event) =>
        onProgress?.(Number(event.progress) || 0),
      );
    }
  });
}

function getCloudTempUrl(fileID) {
  if (!fileID || !wx.cloud || !wx.cloud.getTempFileURL)
    return Promise.reject(new Error("云文件地址不可用"));
  return new Promise((resolve, reject) =>
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        const url =
          res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
        if (url) resolve(url);
        else reject(new Error("无法获取云文件地址"));
      },
      fail: (error) => reject(new Error(error.errMsg || "无法获取云文件地址")),
    }),
  );
}

function deleteCloudFile(fileID) {
  if (!fileID || !wx.cloud || !wx.cloud.deleteFile) return Promise.resolve();
  return new Promise((resolve) =>
    wx.cloud.deleteFile({ fileList: [fileID], complete: resolve }),
  );
}

module.exports = {
  deleteCloudFile,
  ensureCloudReady,
  getBaseUrl,
  getCloudTempUrl,
  readLocalFile,
  requestBinary,
  requestJson,
  uploadCloudFile,
};
