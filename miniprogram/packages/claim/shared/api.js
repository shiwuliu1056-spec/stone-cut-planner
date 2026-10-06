const config = require('./config');
const draft = require('./draft');
let session, sessionPromise;
function isDevtools() { try { return wx.getDeviceInfo().platform === 'devtools'; } catch (_) { return false; } }
function info() {
  const mode = config.defaultMode;
  const devtools = isDevtools();
  const actualMode = mode === 'auto' ? (devtools ? 'local' : 'cloud') : mode;
  const localBase = config.localBaseUrl;
  const cloudBase = config.cloudBaseUrl;
  return { mode, actualMode, localBase, cloudBase, devtools, base: actualMode === 'local' ? (devtools ? localBase : '') : cloudBase };
}
function base() { return info().base; }
function request(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const url = base(); if (!url) return reject(new Error('本地模式仅支持微信开发者工具；手机请切换云端模式'));
    wx.request({ url: url.replace(/\/$/,'') + '/api/claim' + path, method: method || 'GET', data: data, timeout: path === '/review' ? 120000 : 65000, header: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, success(res) { if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data); else reject(Object.assign(new Error(res.data.error || '请求失败'), { status: res.statusCode })); }, fail(err) { reject(new Error(err.errMsg || '无法连接服务')); } });
  });
}
async function ensureSession() {
  if (!base()) throw new Error('本地模式仅支持微信开发者工具；手机请切换云端模式');
  if (session && session.base === base() && session.expiresAt > Date.now() + 10000) return session.token;
  if (!sessionPromise) sessionPromise = (async () => {
    let data; const currentBase = base();
    if (info().devtools && info().actualMode === 'local') { let devId = wx.getStorageSync('claim-dev-id'); if (!devId) { devId = draft.id(); wx.setStorageSync('claim-dev-id', devId); } data = { devId }; }
    else { const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject })); data = { code: login.code }; }
    session = await request('/session', 'POST', data); session.base = currentBase; return session.token;
  })().finally(() => { sessionPromise = null; });
  return sessionPromise;
}
async function call(path, method, data) {
  try { return await request(path, method, data, await ensureSession()); }
  catch (error) {
    if(error.status===503&&error.message==='服务正在启动，请稍后再试'){await new Promise(resolve=>setTimeout(resolve,1000));return request(path,method,data,await ensureSession());}
    if (error.status !== 401) throw error; session = null; return request(path, method, data, await ensureSession());
  }
}
async function upload(taskId, file) {
  const token = await ensureSession();
  return new Promise((resolve,reject) => wx.uploadFile({ url: base() + '/api/claim/tasks/' + taskId + '/files/' + file.id, filePath: file.localPath, name: 'file', timeout: 120000, header: { Authorization: 'Bearer ' + token }, success(res) { let data; try { data = JSON.parse(res.data); } catch (_) {} if (res.statusCode === 200) resolve(data); else reject(new Error(data && data.error || '上传失败')); }, fail(err) { reject(new Error(err.errMsg || '上传失败')); } }));
}
async function download(taskId, output) {
  const token = await ensureSession();
  const res = await new Promise((resolve,reject) => wx.downloadFile({ url: base() + '/api/claim/tasks/' + taskId + '/download/' + output.id, header: { Authorization: 'Bearer ' + token }, timeout: 120000, success: resolve, fail: reject }));
  if (res.statusCode !== 200) throw new Error('文件已过期，请重新生成');
  const directory = wx.env.USER_DATA_PATH + '/claim-result-' + taskId;
  try { wx.getFileSystemManager().mkdirSync(directory, true); } catch (_) {}
  const target = directory + '/' + output.name.replace(/[/\\]/g, '_');
  await new Promise((resolve,reject) => wx.getFileSystemManager().copyFile({ srcPath: res.tempFilePath, destPath: target, success: resolve, fail: reject }));
  return target;
}
module.exports = { call, upload, download, base };
