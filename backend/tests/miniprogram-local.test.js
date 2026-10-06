const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PRODUCTION_BASE_URL = "https://cacci.cn/bstools";
const LOCAL_BASE_URL = "http://127.0.0.1:3100";

/**
 * 在沙箱里加载 miniprogram/app.js 并执行 onLaunch。
 *
 * 沙箱故意不提供 wx.cloud：app.js 已经彻底脱离云开发，一旦有人把 wx.cloud 写回来，
 * 这里会直接抛错而不是悄悄通过。
 */
function loadMiniProgramApp(platform, envVersion = "develop") {
  const source = fs.readFileSync(
    path.join(__dirname, "../../miniprogram/app.js"),
    "utf8",
  );
  let app;
  const calls = { warmUp: 0 };
  const context = {
    App: (definition) => {
      app = definition;
    },
    require: () => ({
      ensureBackendReady: () => {
        calls.warmUp += 1;
        return Promise.resolve(true);
      },
    }),
    wx: {
      getDeviceInfo: () => ({ platform }),
      getSystemInfoSync: () => ({ platform }),
      getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    },
  };
  vm.runInNewContext(source, context, { filename: "miniprogram/app.js" });
  app.onLaunch();
  return { app, calls };
}

test("开发者工具启动时指向本机后端，并预热一次", () => {
  const { app, calls } = loadMiniProgramApp("devtools");
  assert.equal(app.globalData.localBackendInDevtools, true);
  assert.equal(app.globalData.apiBaseUrl, LOCAL_BASE_URL);
  assert.equal(calls.warmUp, 1);
});

// 回归：真机扫码调试与预览同样是 envVersion=develop，不能据此判定为开发者工具。
// 否则真机会拿到 http://127.0.0.1:3100，而该地址在手机上指向手机自身，必然请求失败。
for (const [platform, envVersion] of [
  ["ios", "develop"],
  ["android", "develop"],
  ["ios", "trial"],
  ["ios", "release"],
]) {
  test(`真机（${platform}, envVersion=${envVersion}）走线上 HTTPS 域名`, () => {
    const { app, calls } = loadMiniProgramApp(platform, envVersion);
    assert.equal(app.globalData.apiBaseUrl, PRODUCTION_BASE_URL);
    assert.equal(calls.warmUp, 1);
  });
}

test("回到前台时再次预热后端", () => {
  const { app, calls } = loadMiniProgramApp("devtools");
  app.onShow();
  assert.equal(calls.warmUp, 2);
});
