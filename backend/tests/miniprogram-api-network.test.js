"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadApi(config, requestResult) {
  const source = fs.readFileSync(
    path.join(__dirname, "../../miniprogram/services/api.js"),
    "utf8",
  );
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
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
      useCloudContainer: false,
      apiBaseUrl: "http://127.0.0.1:3100",
    },
    ({ fail }) => fail({ errMsg: "request:fail" }),
  );
  await assert.rejects(
    api.requestJson("/api/video/watermark", { method: "POST" }),
    /本地后端连接失败.*127\.0\.0\.1:3100/,
  );
});

test("HTTP 响应错误保留后端业务提示，不改写 TikHub 解析结果", async () => {
  const api = loadApi(
    {
      localBackendInDevtools: true,
      useCloudContainer: false,
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
