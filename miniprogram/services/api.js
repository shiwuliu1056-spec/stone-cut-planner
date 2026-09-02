function getBaseUrl() {
  const app = getApp();
  return String((app && app.globalData && app.globalData.apiBaseUrl) || '').replace(/\/$/, '');
}

function getAppConfig() {
  const app = getApp();
  return (app && app.globalData) || {};
}

function shouldUseCloudContainer() {
  const config = getAppConfig();
  return Boolean(config.useCloudContainer && config.cloudEnvId && config.cloudServiceName && wx.cloud && wx.cloud.callContainer);
}

function callCloudContainer(path, options = {}) {
  const config = getAppConfig();
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: config.cloudEnvId },
      path,
      method: options.method || 'GET',
      data: options.data,
      header: { 'content-type': 'application/json', 'X-WX-SERVICE': config.cloudServiceName, ...(options.header || {}) },
      timeout: options.timeout || 30000,
      dataType: options.dataType || 'json',
      success(res) {
        const data = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(data.error || `云托管请求失败（${res.statusCode}）`));
      },
      fail(error) { reject(new Error(error.errMsg || '云托管请求失败')); },
    });
  });
}

function requestJson(path, options = {}) {
  if (shouldUseCloudContainer()) return callCloudContainer(path, options);
  const baseUrl = getBaseUrl();
  if (!baseUrl || baseUrl.includes('你的-api-域名')) {
    return Promise.reject(new Error('请先在 app.js 配置 API 地址'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: { 'content-type': 'application/json', ...(options.header || {}) },
      timeout: options.timeout || 30000,
      success(res) {
        const data = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(data.error || `请求失败（${res.statusCode}）`));
      },
      fail(error) { reject(new Error(error.errMsg || '网络请求失败')); },
    });
  });
}

function requestBinary(path, data, options = {}) {
  if (shouldUseCloudContainer()) {
    return callCloudContainer(path, { ...options, data, dataType: 'text', header: { 'content-type': 'application/octet-stream', ...(options.header || {}) } });
  }
  const baseUrl = getBaseUrl();
  if (!baseUrl || baseUrl.includes('你的-api-域名')) {
    return Promise.reject(new Error('请先在 app.js 配置 API 地址'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method: options.method || 'POST',
      data,
      header: { 'content-type': 'application/octet-stream', ...(options.header || {}) },
      dataType: 'text',
      responseType: 'text',
      timeout: options.timeout || 30000,
      success(res) {
        let body = {};
        try {
          body = typeof res.data === 'string' ? JSON.parse(res.data || '{}') : (res.data || {});
        } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(body.error || `请求失败（${res.statusCode}）`));
      },
      fail(error) { reject(new Error(error.errMsg || '网络请求失败')); },
    });
  });
}

function readLocalFile(filePath, encoding) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      ...(encoding ? { encoding } : {}),
      success: (res) => resolve(res.data),
      fail: (error) => reject(new Error(error.errMsg || '读取文件失败')),
    });
  });
}

function uploadCloudFile(filePath, prefix = 'uploads', onProgress) {
  const config = getAppConfig();
  if (!config.cloudEnvId || !wx.cloud || !wx.cloud.uploadFile) return Promise.reject(new Error('云存储能力不可用'));
  const extension = String(filePath.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase();
  const cloudPath = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  return new Promise((resolve, reject) => {
    const task = wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: resolve,
      fail: (error) => reject(new Error(error.errMsg || '文件上传失败')),
    });
    if (task && typeof task.onProgressUpdate === 'function') {
      task.onProgressUpdate((event) => onProgress?.(Number(event.progress) || 0));
    }
  });
}

function getCloudTempUrl(fileID) {
  if (!fileID || !wx.cloud || !wx.cloud.getTempFileURL) return Promise.reject(new Error('云文件地址不可用'));
  return new Promise((resolve, reject) => wx.cloud.getTempFileURL({
    fileList: [fileID],
    success: (res) => {
      const url = res.fileList && res.fileList[0] && res.fileList[0].tempFileURL;
      if (url) resolve(url); else reject(new Error('无法获取云文件地址'));
    },
    fail: (error) => reject(new Error(error.errMsg || '无法获取云文件地址')),
  }));
}

function deleteCloudFile(fileID) {
  if (!fileID || !wx.cloud || !wx.cloud.deleteFile) return Promise.resolve();
  return new Promise((resolve) => wx.cloud.deleteFile({ fileList: [fileID], complete: resolve }));
}

function uploadFile(path, filePath, name = 'file', formData = {}) {
  const baseUrl = getBaseUrl();
  if (!baseUrl || baseUrl.includes('你的-api-域名')) {
    return Promise.reject(new Error('请先在 app.js 配置 API 地址'));
  }
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}${path}`, filePath, name, formData,
      success(res) {
        let data = {};
        try { data = JSON.parse(res.data || '{}'); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(data.error || `上传失败（${res.statusCode}）`));
      },
      fail(error) { reject(new Error(error.errMsg || '文件上传失败')); },
    });
  });
}

module.exports = { deleteCloudFile, getBaseUrl, getCloudTempUrl, readLocalFile, requestBinary, requestJson, uploadCloudFile, uploadFile };
