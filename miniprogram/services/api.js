// 文件用途：统一封装后端 HTTP 请求、本地文件读取、后端预热与自动重试。
// 已完全脱离云开发：不使用 wx.cloud —— 既不用 callContainer（改走自建 HTTPS 域名），
// 也不用云存储（导入表格改传二进制、拍照识别改传 base64，两条链路后端都已支持）。

/** 请求失败后重试前的等待，按重试次数递增（1.2s、2.4s…）。 */
const RETRY_DELAY_MS = 1200;

/**
 * 内联上传图片的体积上限。
 *
 * 图片走 base64 塞进 JSON 后会膨胀约 1/3，超过 wx.request 的请求体上限会被平台
 * 直接拒绝且提示难以理解。这里提前拦住，让调用方给出可操作的提示。
 */
const MAX_INLINE_IMAGE_BYTES = 6 * 1024 * 1024;

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

/** 判断当前后端地址是否指向本机（仅开发者工具会走到）。 */
function isLocalBackend(baseUrl) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(baseUrl || "");
}

function networkRequestError(source) {
  const message = String((source && source.errMsg) || "").trim();
  // 只有确实指向本机后端时才提示启动本地服务；线上域名失败时这样提示会误导。
  if (/^request:fail\b/i.test(message) && isLocalBackend(getBaseUrl())) {
    return new Error(
      `本地后端连接失败，请先启动项目后端并确认 ${getBaseUrl() || "127.0.0.1:3100"} 可访问`,
    );
  }
  return new Error(message || "网络请求失败");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把响应体解析成对象：文本按 JSON 解析，解析失败返回空对象。 */
function parseBody(data) {
  if (typeof data !== "string") return data || {};
  try {
    return JSON.parse(data || "{}");
  } catch {
    return {};
  }
}

function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const baseUrl = getBaseUrl();
    if (!baseUrl || baseUrl.includes("你的-api-域名")) {
      reject(new Error("请先在 app.js 配置后端地址"));
      return;
    }
    wx.request({
      url: `${baseUrl}${options.path}`,
      method: options.method,
      data: options.data,
      header: options.header,
      dataType: options.dataType,
      responseType: options.responseType,
      timeout: options.timeout,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const body = parseBody(res.data);
        const error = new Error(
          body.error || `请求失败（${res.statusCode}）`,
        );
        error.statusCode = res.statusCode;
        reject(error);
      },
      fail(source) {
        const error = networkRequestError(source);
        error.isNetworkError = true;
        reject(error);
      },
    });
  });
}

/** 只重试网络层失败与 502/503/504：4xx 是业务结论，重试没有意义。 */
function isRetriable(error) {
  if (error && error.isNetworkError) return true;
  const status = Number(error && error.statusCode);
  return status === 502 || status === 503 || status === 504;
}

async function requestWithRetry(options) {
  const { retries: rawRetries, ...requestOptions } = options;
  const retries = Number.isInteger(rawRetries)
    ? Math.max(0, rawRetries)
    : 1;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await httpRequest(requestOptions);
    } catch (error) {
      if (attempt >= retries || !isRetriable(error)) throw error;
      await wait(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

function requestJson(path, options = {}) {
  return requestWithRetry({
    path,
    method: options.method || "GET",
    data: options.data,
    header: { "content-type": "application/json", ...(options.header || {}) },
    dataType: options.dataType || "json",
    timeout: options.timeout || 30000,
    retries: options.retries,
  });
}

function requestBinary(path, data, options = {}) {
  return requestWithRetry({
    path,
    method: options.method || "POST",
    data,
    header: {
      "content-type": "application/octet-stream",
      ...(options.header || {}),
    },
    dataType: "text",
    responseType: "text",
    timeout: options.timeout || 60000,
    retries: options.retries,
  }).then(parseBody);
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

/**
 * 把本地图片读成可直接提交的 data URL，并做体积保护。
 *
 * 图片走 base64 塞进 JSON 会膨胀约 1/3，超过 wx.request 的请求体上限会被平台直接
 * 拒绝且提示难以理解。这里按 base64 实际长度反推原始字节数，提前给出可操作提示。
 */
function readLocalImageAsDataUrl(filePath, mime) {
  return readLocalFile(filePath, "base64").then((base64) => {
    const bytes = Math.floor((String(base64).length * 3) / 4);
    if (bytes > MAX_INLINE_IMAGE_BYTES) {
      return Promise.reject(
        new Error(
          `照片过大（${(bytes / 1048576).toFixed(1)}MB），请压缩或重新拍摄后再试`,
        ),
      );
    }
    return `data:${mime};base64,${base64}`;
  });
}

// 预热只负责在后台提前叫醒后端：每次启动/回前台各触发一次，
// 不缓存结果、不阻塞真实请求。并发去重只用于避免同时发出多个健康检查。
let warmPromise = null;

function ensureBackendReady() {
  const config = getAppConfig();
  if (!config || !config.apiBaseUrl) return Promise.resolve(true);
  if (warmPromise) return warmPromise;
  warmPromise = requestWithRetry({
    path: "/api/health",
    method: "GET",
    header: { "content-type": "application/json" },
    dataType: "json",
    timeout: 35000,
    retries: 1,
  })
    .then((result) => Boolean(result && result.ok))
    .finally(() => {
      warmPromise = null;
    });
  return warmPromise;
}

module.exports = {
  MAX_INLINE_IMAGE_BYTES,
  ensureBackendReady,
  getBaseUrl,
  readLocalFile,
  readLocalImageAsDataUrl,
  requestBinary,
  requestJson,
};
