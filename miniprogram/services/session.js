// 三个工具共用同一套临时登录态；AppSecret只存在于服务器。
const sessions = new Map();
const pending = new Map();
function isDevtools() {
  try { return wx.getDeviceInfo().platform === 'devtools'; } catch (_) {}
  try { return wx.getSystemInfoSync().platform === 'devtools'; } catch (_) { return false; }
}
function invalidate(base) { sessions.delete(base); }
async function token(base) {
  const current = sessions.get(base);
  if (current && current.expiresAt > Date.now() + 10000) return current.token;
  if (!pending.has(base)) pending.set(base, (async () => {
    let data;
    if (isDevtools() && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base)) {
      let id = wx.getStorageSync('toolbox-dev-id');
      if (!id) { id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2); wx.setStorageSync('toolbox-dev-id', id); }
      data = { devId: id };
    } else {
      const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject })); data = { code: login.code };
    }
    const session = await new Promise((resolve, reject) => wx.request({
      url: base.replace(/\/$/, '') + '/api/session', method: 'POST', data, timeout: 20000,
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.token && res.data.expiresAt) resolve(res.data);
        else reject(Object.assign(new Error((res.data && res.data.error) || '微信身份验证失败，请重试'), { statusCode: res.statusCode }));
      }, fail(error) { reject(new Error(error.errMsg || '微信身份验证连接失败')); },
    }));
    sessions.set(base, session); return session.token;
  })().finally(() => pending.delete(base)));
  return pending.get(base);
}
module.exports = { token, invalidate };
