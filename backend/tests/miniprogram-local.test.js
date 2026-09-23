const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMiniProgramApp(platform, envVersion = "develop") {
  const source = fs.readFileSync(
    path.join(__dirname, "../../miniprogram/app.js"),
    "utf8",
  );
  let app;
  let cloudInitCalls = 0;
  const context = {
    App: (definition) => {
      app = definition;
    },
    require: () => ({ ensureCloudReady: () => Promise.resolve(true) }),
    wx: {
      getDeviceInfo: () => ({ platform }),
      getSystemInfoSync: () => ({ platform }),
      getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
      cloud: {
        init: () => {
          cloudInitCalls += 1;
        },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: "miniprogram/app.js" });
  app.onLaunch();
  return { app, cloudInitCalls };
}

test("微信开发者工具启动时默认使用本地后端和本地视频下载地址", () => {
  const { app, cloudInitCalls } = loadMiniProgramApp("devtools");
  assert.equal(app.globalData.localBackendInDevtools, true);
  assert.equal(app.globalData.useCloudContainer, false);
  assert.equal(app.globalData.apiBaseUrl, "http://127.0.0.1:3100");
  assert.equal(app.globalData.publicApiBaseUrl, app.globalData.apiBaseUrl);
  assert.equal(cloudInitCalls, 0);
});

test("真机启动保留现有 CloudBase 配置，不由本次改造部署云端", () => {
  const { app, cloudInitCalls } = loadMiniProgramApp("ios");
  assert.equal(app.globalData.useCloudContainer, true);
  assert.equal(cloudInitCalls, 1);
});

// 回归：真机扫码调试与预览同样是 envVersion=develop，不能据此判定为开发者工具。
// 否则真机会拿到 http://127.0.0.1:3100，而该地址在手机上指向手机自身，必然请求失败。
for (const [platform, envVersion] of [
  ["ios", "develop"],
  ["android", "develop"],
  ["ios", "trial"],
]) {
  test(`真机调试/预览（${platform}, envVersion=${envVersion}）仍走云托管`, () => {
    const { app, cloudInitCalls } = loadMiniProgramApp(platform, envVersion);
    assert.equal(app.globalData.useCloudContainer, true);
    assert.equal(
      app.globalData.publicApiBaseUrl,
      "https://stone-cut-planner-api-305487-11-1477936117.sh.run.tcloudbase.com",
    );
    assert.equal(cloudInitCalls, 1);
  });
}
