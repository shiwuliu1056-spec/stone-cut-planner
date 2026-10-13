"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi(config, requestResult, auth = { token: async () => 'test-session', invalidate() {} }) {
  const source = fs.readFileSync(
    path.join(__dirname, "../../miniprogram/services/api.js"),
    "utf8",
  );
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      require: name => { if (name === './session') return auth; throw Error('unexpected module'); },
      getApp: () => ({ globalData: config }),
      wx: { request: requestResult },
      setTimeout,
    },
    { filename: "miniprogram/services/api.js" },
  );
  return module.exports;
}

test("开发者工具本地后端不可达时显示可操作的诊断，不误报为平台解析失败", async () => {
  const api = loadApi(
    {
      localBackendInDevtools: true,
      apiBaseUrl: "http://127.0.0.1:3100",
    },
    ({ fail }) => fail({ errMsg: "request:fail" }),
  );
  await assert.rejects(
    api.requestJson("/api/video/watermark", { method: "POST" }),
    /本地后端连接失败.*127\.0\.0\.1:3100/,
  );
});

test('未配置地址时不发起微信登录；健康检查无需会话', async () => {
  let logins = 0;
  const auth = { token: async () => { logins++; return 'token'; } };
  const missing = loadApi({}, () => assert.fail('不应请求'), auth);
  await assert.rejects(missing.requestJson('/api/solve'), /配置后端地址/);
  const api = loadApi({ apiBaseUrl: 'https://cacci.cn/bstools' }, ({ success, header }) => {
    assert.equal(header.Authorization, undefined); success({ statusCode: 200, data: { ok: true } });
  }, auth);
  await api.requestJson('/api/health'); assert.equal(logins, 0);
});

test('生产接口附带会话，401仅刷新一次且不吞掉业务错误', async () => {
  let requests = 0, invalidations = 0;
  const api = loadApi({ apiBaseUrl: 'https://cacci.cn/bstools' }, ({ success, header, url }) => {
    assert.equal(url, 'https://cacci.cn/bstools/api/solve');
    assert.equal(header.Authorization, 'Bearer test-session');
    success(++requests === 1 ? { statusCode: 401, data: { error: '已过期' } } : { statusCode: 400, data: { error: '参数无效' } });
  }, { token: async () => 'test-session', invalidate() { invalidations++; } });
  await assert.rejects(api.requestJson('/api/solve', { retries: 0 }), /参数无效/);
  assert.equal(requests, 2); assert.equal(invalidations, 1);
});

test("HTTP 响应错误保留后端业务提示，不改写 TikHub 解析结果", async () => {
  const api = loadApi(
    {
      localBackendInDevtools: true,
      apiBaseUrl: "http://127.0.0.1:3100",
    },
    ({ success }) =>
      success({ statusCode: 400, data: { error: "当前链接不是视频作品" } }),
  );
  await assert.rejects(
    api.requestJson("/api/video/watermark", { method: "POST" }),
    /当前链接不是视频作品/,
  );
});
