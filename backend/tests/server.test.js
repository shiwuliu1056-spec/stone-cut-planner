"use strict";

/**
 * server.test.js
 * 测试 backend/server.js 提供的本地 HTTP 服务。
 *
 * 覆盖：正常请求、非法请求、JSON 解析失败、未知路由、CORS、请求过大、
 * /api/solve 尚未实现。每个测试各自创建一个监听随机端口的 server 实例，
 * 测试结束后关闭，避免相互影响或残留进程。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { createServer } = require("../server");
const { SolveTaskManager } = require("../src/solve-tasks");

/** 启动一个新的 server 实例，监听随机端口，返回 { server, baseUrl }。 */
function startServer(options) {
  return new Promise((resolve, reject) => {
    const server = createServer({
      solveTaskOptions: { storageFile: null },
      ...options,
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on("error", reject);
  });
}

/** 关闭 server 实例，返回 Promise。 */
function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * 轮询等待异步排版任务进入终态（succeeded / failed）。
 *
 * solve 跑在 worker 线程里，GitHub Actions runner 的冷启动与单核性能都明显弱于
 * 开发机，所以写死的紧预算会随机超时：CI 上「结果超限…」用例原本用
 * 150×20ms=3s，实测耗时 3052ms 刚好耗尽预算而间歇失败。
 *
 * 这里放宽到 20s，并在超时后把当前状态交给调用方，便于区分「真的卡住」和「只是慢」。
 */
async function waitForTaskState(
  readState,
  { timeoutMs = 20000, intervalMs = 25 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let state = await readState();
  while (!state || !["succeeded", "failed"].includes(state.status)) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    state = await readState();
  }
  return state;
}

/**
 * 轮询等待条件成立，超时返回 false。
 *
 * 用于替代写死的 `setTimeout(n)`：固定睡眠在本地很宽裕，到 CI 上可能就不够，
 * 而轮询一旦条件满足就立即返回，既不拖慢本地也不在 CI 上翻车。
 */
async function waitUntil(predicate, { timeoutMs = 5000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return true;
}

function makeResult(slabCount = 1) {
  const slabs = [];
  for (let i = 1; i <= slabCount; i += 1) {
    slabs.push({
      id: "甲",
      index: i,
      w: 2700,
      h: 1800,
      placements: [
        { id: "A", instance: `A-${i}`, x: 0, y: 0, w: 1400, h: 600 },
      ],
      cuts: [],
      // 几何自洽：成品 1400×600 + 两块空块恰好铺满 2700×1800（P2-4 面积守恒）
      allOffcuts: [
        { id: "R01", x: 1400, y: 0, w: 1300, h: 1800 },
        { id: "R02", x: 0, y: 600, w: 1400, h: 1200 },
      ],
    });
  }
  return {
    plans: {
      A: {
        stats: {
          slabCount,
          offcutCount: 2 * slabCount,
          offcutArea: (2340000 + 1680000) * slabCount,
        },
        slabs,
      },
    },
  };
}

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/XP8s8gAAAABJRU5ErkJggg==";

// ─────────────────────────────────────────────────────────────────────────────
// 正常请求：/api/export、/api/export-word
// ─────────────────────────────────────────────────────────────────────────────

test("POST /api/export 返回有效的 xlsx 文件流", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: makeResult(1), images: {} }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /spreadsheetml/);
    assert.match(res.headers.get("content-disposition"), /attachment/);
    const buffer = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer); // 若不是合法 xlsx 会抛异常
    assert.equal(wb.worksheets.length, 1);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/export-word 返回有效的 docx 文件流", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export-word`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result: makeResult(1),
        images: { A: [TINY_PNG_DATA_URL] },
      }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /wordprocessingml/);
    assert.match(res.headers.get("content-disposition"), /attachment/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.ok(buffer.byteLength > 1000);
    // docx 是 zip 容器，签名为 PK
    assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  } finally {
    await stopServer(server);
  }
});

test("POST /api/import 能正确解析 Excel 并返回 parts", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("尺寸清单");
    ws.addRow(["编号", "长度", "宽度", "数量"]);
    ws.addRow(["A", 1400, 600, 13]);
    const buffer = await wb.xlsx.writeBuffer();

    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.parts, [{ id: "A", w: 1400, h: 600, qty: 13 }]);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/solve 排版计算
// ─────────────────────────────────────────────────────────────────────────────

test("POST /api/solve 合法参数返回 200 且 result.plans.A 结构符合契约", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          slabs: [{ id: "甲", w: 2700, h: 1800, limit: null }],
          overcut: 30,
          minOffcut: 100,
          sampleSide: 200,
          stripSide: 1000,
          kerf: 0,
          iterations: 180,
        },
        parts: [{ id: "A", w: 1400, h: 600, qty: 13, rotatable: true }],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // 契约：{ result: { plans: { A: { stats, slabs } } } }
    assert.ok(data.result, "应返回 result");
    assert.ok(data.result.plans, "result 应含 plans");
    const planA = data.result.plans.A;
    assert.ok(planA, "plans 应含 A");
    // stats 字段
    assert.equal(typeof planA.stats.slabCount, "number");
    assert.equal(typeof planA.stats.offcutCount, "number");
    assert.equal(typeof planA.stats.offcutArea, "number");
    // slabs 及其元素结构
    assert.ok(Array.isArray(planA.slabs));
    assert.ok(planA.slabs.length >= 1);
    const slab = planA.slabs[0];
    assert.ok(Array.isArray(slab.placements));
    assert.ok(Array.isArray(slab.cuts));
    assert.ok(Array.isArray(slab.allOffcuts));
  } finally {
    await stopServer(server);
  }
});

test("POST /api/solve/tasks 异步提交并可查询到完成结果", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const payload = {
      settings: { slabs: [{ id: "甲", w: 1200, h: 500, limit: null }] },
      parts: [{ id: "A", w: 200, h: 100, qty: 5, rotatable: false }],
    };
    const submitted = await fetch(`${baseUrl}/api/solve/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "async-test-1",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(submitted.status, 202);
    const first = await submitted.json();
    assert.match(first.taskId, /^[0-9a-f-]{36}$/);
    assert.ok(["queued", "running"].includes(first.status));
    const state = await waitForTaskState(async () => {
      const response = await fetch(
        `${baseUrl}/api/solve/tasks/${first.taskId}`,
      );
      return response.json();
    });
    assert.equal(
      state.status,
      "succeeded",
      `任务未在预算内完成，当前状态：${state && state.status}`,
    );
    assert.equal(state.progress, 100);
    assert.ok(state.result.plans.A);
  } finally {
    await stopServer(server);
  }
});

test("异步排版使用 Idempotency-Key 重复提交返回同一任务", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const payload = {
      settings: { slabs: [{ id: "甲", w: 1000, h: 500, limit: null }] },
      parts: [{ id: "A", w: 200, h: 100, qty: 1 }],
    };
    const send = () =>
      fetch(`${baseUrl}/api/solve/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "same-task",
        },
        body: JSON.stringify(payload),
      });
    const a = await (await send()).json();
    const bRes = await send();
    const b = await bRes.json();
    assert.equal(bRes.status, 200);
    assert.equal(b.reused, true);
    assert.equal(b.taskId, a.taskId);
  } finally {
    await stopServer(server);
  }
});

test("查询不存在的异步任务返回 404", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve/tasks/not-found`);
    assert.equal(res.status, 404);
  } finally {
    await stopServer(server);
  }
});

test("GET /api/health 返回云托管预热状态", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await stopServer(server);
  }
});

test("视频解析与文案解析按需独立执行且不向客户端暴露上游地址", async () => {
  let parseCalls = 0;
  let transcriptCreateCalls = 0;
  const videoService = {
    async parseVideo(input, platform) {
      assert.equal(input, "复制文案 https://v.douyin.com/demo/");
      assert.equal(platform, "douyin");
      parseCalls += 1;
      return {
        durationMs: 9000,
        videoUrl: "https://video.example/test.mp4",
        platform: "douyin",
        platformLabel: "抖音",
      };
    },
    createDownloadToken(descriptor) {
      assert.equal(descriptor.videoUrl, "https://video.example/test.mp4");
      assert.equal(descriptor.platform, "douyin");
      return "signed-download-token";
    },
    verifyDownloadToken(token) {
      assert.equal(token, "signed-download-token");
      return {
        url: "https://video.example/test.mp4",
        platform: "douyin",
        decodeKey: "",
      };
    },
    async streamVideo(descriptor, res) {
      assert.equal(descriptor.url, "https://video.example/test.mp4");
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(Buffer.from("video-content"));
    },
  };
  const transcriptService = {
    async createTranscriptTask(videoUrl) {
      assert.equal(videoUrl, "https://video.example/test.mp4");
      transcriptCreateCalls += 1;
      return 24680;
    },
    createTranscriptToken(taskId) {
      assert.equal(taskId, 24680);
      return "signed-transcript-token";
    },
    verifyTranscriptToken(token) {
      assert.equal(token, "signed-transcript-token");
      return 24680;
    },
    async getTranscriptTask(taskId) {
      assert.equal(taskId, 24680);
      return {
        status: "succeeded",
        transcript: "这是视频中说出来的文字。",
        audioDurationSec: 9,
      };
    },
  };
  const { server, baseUrl } = await startServer({
    videoService,
    transcriptService,
    allowLocalVideoRequests: false,
  });
  try {
    const parsedResponse = await fetch(`${baseUrl}/api/video/watermark`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WX-APPID": "wxe4560e02e4b75800",
        "X-WX-OPENID": "test-openid",
      },
      body: JSON.stringify({
        platform: "douyin",
        url: "复制文案 https://v.douyin.com/demo/",
      }),
    });
    assert.equal(parsedResponse.status, 200);
    const parsed = await parsedResponse.json();
    assert.deepEqual(parsed, {
      durationMs: 9000,
      downloadPath: "/api/video/download.mp4?token=signed-download-token",
      mediaToken: "signed-download-token",
      platform: "douyin",
      platformLabel: "抖音",
    });
    assert.equal(parseCalls, 1);
    assert.equal(transcriptCreateCalls, 0, "仅解析视频时不得创建语音识别任务");
    assert.equal(JSON.stringify(parsed).includes("video.example"), false);

    const transcriptStartResponse = await fetch(
      `${baseUrl}/api/video/transcript`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WX-APPID": "wxe4560e02e4b75800",
          "X-WX-OPENID": "test-openid",
        },
        body: JSON.stringify({
          platform: "douyin",
          url: "复制文案 https://v.douyin.com/demo/",
          mediaToken: parsed.mediaToken,
        }),
      },
    );
    assert.equal(transcriptStartResponse.status, 202);
    const transcriptStart = await transcriptStartResponse.json();
    assert.deepEqual(transcriptStart, {
      status: "pending",
      mediaToken: "signed-download-token",
      transcriptToken: "signed-transcript-token",
    });
    assert.equal(parseCalls, 1, "有效媒体令牌应跳过第二次 TikHub 解析");
    assert.equal(transcriptCreateCalls, 1, "选择解析文案后才创建语音识别任务");
    assert.equal(
      JSON.stringify(transcriptStart).includes("video.example"),
      false,
    );

    const transcriptResponse = await fetch(
      `${baseUrl}/api/video/transcript?token=${transcriptStart.transcriptToken}`,
      {
        headers: {
          "X-WX-APPID": "wxe4560e02e4b75800",
          "X-WX-OPENID": "test-openid",
        },
      },
    );
    assert.equal(transcriptResponse.status, 200);
    assert.deepEqual(await transcriptResponse.json(), {
      status: "succeeded",
      transcript: "这是视频中说出来的文字。",
      audioDurationSec: 9,
    });

    const forbiddenResponse = await fetch(`${baseUrl}/api/video/watermark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://v.douyin.com/demo/" }),
    });
    assert.equal(forbiddenResponse.status, 403);

    const downloadResponse = await fetch(`${baseUrl}${parsed.downloadPath}`);
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get("content-type"), "video/mp4");
    assert.equal(await downloadResponse.text(), "video-content");
  } finally {
    await stopServer(server);
  }
});

test("视频号文案复用媒体令牌并走解密音频转写流程", async () => {
  let parseCalls = 0;
  let wechatTranscriptCalls = 0;
  const downloadVideoToFile = async () => {};
  const videoService = {
    async parseVideo() {
      parseCalls += 1;
      return {
        durationMs: 12000,
        videoUrl: "https://video.example/wechat.mp4",
        platform: "wechat_channels",
        platformLabel: "视频号",
        decodeKey: "123456",
      };
    },
    createDownloadToken() {
      return "wechat-media-token";
    },
    verifyDownloadToken(token) {
      assert.equal(token, "wechat-media-token");
      return {
        url: "https://video.example/wechat.mp4",
        platform: "wechat_channels",
        decodeKey: "123456",
      };
    },
    downloadVideoToFile,
  };
  const transcriptService = {
    async createWechatTranscriptTask(descriptor, downloader) {
      wechatTranscriptCalls += 1;
      assert.deepEqual(descriptor, {
        url: "https://video.example/wechat.mp4",
        platform: "wechat_channels",
        decodeKey: "123456",
      });
      assert.equal(downloader, downloadVideoToFile);
      return 13579;
    },
    createTranscriptToken(taskId) {
      assert.equal(taskId, 13579);
      return "wechat-transcript-token";
    },
  };
  const { server, baseUrl } = await startServer({
    videoService,
    transcriptService,
    allowLocalVideoRequests: true,
  });
  try {
    const parsedResponse = await fetch(`${baseUrl}/api/video/watermark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "wechat_channels", url: "export-demo" }),
    });
    const parsed = await parsedResponse.json();
    assert.equal(parsedResponse.status, 200);
    assert.equal(parsed.mediaToken, "wechat-media-token");

    const transcriptResponse = await fetch(`${baseUrl}/api/video/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "wechat_channels",
        url: "export-demo",
        mediaToken: parsed.mediaToken,
      }),
    });
    assert.equal(transcriptResponse.status, 202);
    assert.deepEqual(await transcriptResponse.json(), {
      status: "pending",
      mediaToken: "wechat-media-token",
      transcriptToken: "wechat-transcript-token",
    });
    assert.equal(parseCalls, 1);
    assert.equal(wechatTranscriptCalls, 1);
  } finally {
    await stopServer(server);
  }
});

test("小红书文案复用媒体令牌，走本地音频提交且不重复调用 TikHub", async () => {
  let parseCalls = 0;
  let localTranscriptCalls = 0;
  const downloader = async () => {};
  const videoService = {
    async parseVideo() {
      parseCalls += 1;
      return {
        durationMs: 14000,
        videoUrl: "http://media.example/video.mp4",
        platform: "xiaohongshu",
        platformLabel: "小红书",
      };
    },
    createDownloadToken() {
      return "xhs-media-token";
    },
    verifyDownloadToken() {
      return {
        url: "http://media.example/video.mp4",
        platform: "xiaohongshu",
        decodeKey: "",
      };
    },
    downloadVideoToFile: downloader,
  };
  const transcriptService = {
    async createXiaohongshuTranscriptTask(descriptor, downloadVideoToFile) {
      localTranscriptCalls += 1;
      assert.deepEqual(descriptor, {
        url: "http://media.example/video.mp4",
        platform: "xiaohongshu",
      });
      assert.equal(downloadVideoToFile, downloader);
      return 13580;
    },
    createTranscriptToken() {
      return "xhs-transcript-token";
    },
  };
  const { server, baseUrl } = await startServer({
    videoService,
    transcriptService,
    allowLocalVideoRequests: true,
  });
  try {
    const parsed = await (
      await fetch(`${baseUrl}/api/video/watermark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "xiaohongshu",
          url: "https://xhslink.cn/o/demo",
        }),
      })
    ).json();
    const response = await fetch(`${baseUrl}/api/video/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "xiaohongshu",
        url: "https://xhslink.cn/o/demo",
        mediaToken: parsed.mediaToken,
      }),
    });
    assert.equal(response.status, 202);
    assert.equal(
      (await response.json()).transcriptToken,
      "xhs-transcript-token",
    );
    assert.equal(parseCalls, 1);
    assert.equal(localTranscriptCalls, 1);
  } finally {
    await stopServer(server);
  }
});

test("媒体令牌平台不匹配时拒绝复用", async () => {
  const videoService = {
    verifyDownloadToken() {
      return {
        url: "https://video.example/test.mp4",
        platform: "tiktok",
        decodeKey: "",
      };
    },
  };
  const { server, baseUrl } = await startServer({
    videoService,
    allowLocalVideoRequests: true,
  });
  try {
    const response = await fetch(`${baseUrl}/api/video/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "douyin",
        url: "https://v.douyin.com/demo/",
        mediaToken: "wrong-platform",
      }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /平台不匹配/);
  } finally {
    await stopServer(server);
  }
});

test("媒体令牌无效或过期时直接拒绝且不重新调用 TikHub", async () => {
  let parseCalls = 0;
  const videoService = {
    async parseVideo() {
      parseCalls += 1;
      throw new Error("不应重新解析");
    },
    verifyDownloadToken() {
      throw Object.assign(new Error("视频下载链接已过期，请重新解析"), {
        statusCode: 403,
      });
    },
  };
  const { server, baseUrl } = await startServer({
    videoService,
    allowLocalVideoRequests: true,
  });
  try {
    const response = await fetch(`${baseUrl}/api/video/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "douyin",
        url: "https://v.douyin.com/demo/",
        mediaToken: "expired-token",
      }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /过期/);
    assert.equal(parseCalls, 0);
  } finally {
    await stopServer(server);
  }
});

test("本地开发后端允许开发者工具通过回环地址测试视频解析", async () => {
  const videoService = {
    async parseVideo() {
      return {
        durationMs: 1000,
        videoUrl: "https://video.example/test.mp4",
        platform: "douyin",
        platformLabel: "抖音",
      };
    },
    createDownloadToken() {
      return "local-token";
    },
  };
  const transcriptService = {
    async createTranscriptTask() {
      return 1;
    },
    createTranscriptToken() {
      return "local-transcript-token";
    },
  };
  const { server, baseUrl } = await startServer({
    videoService,
    transcriptService,
    allowLocalVideoRequests: true,
  });
  try {
    const response = await fetch(`${baseUrl}/api/video/watermark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: "douyin",
        url: "https://v.douyin.com/demo/",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).downloadPath,
      "/api/video/download.mp4?token=local-token",
    );
  } finally {
    await stopServer(server);
  }
});

test("异步任务队列达到上限返回 429", async () => {
  const { server, baseUrl } = await startServer({
    solveTaskOptions: { storageFile: null, maxWorkers: 1, maxQueue: 0 },
  });
  try {
    const res = await fetch(`${baseUrl}/api/solve/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { slabs: [] }, parts: [] }),
    });
    assert.equal(res.status, 429);
  } finally {
    await stopServer(server);
  }
});

test("任务 TTL 到期会移除任务和幂等索引", async () => {
  const manager = new SolveTaskManager({
    storageFile: null,
    ttlMs: 15,
    maxQueue: 1,
  });
  const payload = { settings: { slabs: [] }, parts: [] };
  const { task } = manager.submit(payload, "ttl-key");
  assert.ok(
    await waitUntil(() => manager.get(task.taskId) === null),
    "TTL 到期后任务应被移除",
  );
  assert.equal(manager.idempotency.has("ttl-key"), false);
  manager.close();
});

test("关闭任务管理器会清理定时器和 worker 状态", () => {
  const manager = new SolveTaskManager({ storageFile: null });
  manager.close();
  assert.equal(manager.closed, true);
  assert.equal(manager.timeouts.size, 0);
  assert.equal(manager.workers.size, 0);
});

test("关闭时旧的异步持久化完成后不会覆盖最终 failed 状态", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "solve-close-race-"));
  const file = path.join(directory, "tasks.json");
  const isAsyncTmp = (target) =>
    typeof target === "string" &&
    target.startsWith(`${file}.`) &&
    target.endsWith(".tmp");
  const manager = new SolveTaskManager({ storageFile: file });
  const now = Date.now();
  manager.tasks.set("close-race-1", {
    taskId: "close-race-1",
    status: "running",
    progress: 10,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 10000,
    inputHash: "close-race-hash",
    idempotencyKey: null,
  });

  let releaseWrite;
  let markWriteStarted;
  let releaseRename;
  let markRenameStarted;
  let markRenameFinished;
  const writeStarted = new Promise((resolve) => {
    markWriteStarted = resolve;
  });
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  const renameStarted = new Promise((resolve) => {
    markRenameStarted = resolve;
  });
  const renameFinished = new Promise((resolve) => {
    markRenameFinished = resolve;
  });
  const renameGate = new Promise((resolve) => {
    releaseRename = resolve;
  });
  const originalWriteFile = fs.promises.writeFile;
  const originalRename = fs.promises.rename;
  let writeBlocked = false;
  let renameBlocked = false;
  fs.promises.writeFile = async (target, data, options) => {
    if (isAsyncTmp(target) && !writeBlocked) {
      writeBlocked = true;
      markWriteStarted();
      await writeGate;
    }
    return originalWriteFile.call(fs.promises, target, data, options);
  };
  fs.promises.rename = async (source, target) => {
    if (isAsyncTmp(source) && !renameBlocked) {
      renameBlocked = true;
      markRenameStarted();
      await renameGate;
    }
    try {
      return await originalRename.call(fs.promises, source, target);
    } finally {
      if (isAsyncTmp(source) && renameBlocked) markRenameFinished();
    }
  };

  try {
    manager.persist();
    await writeStarted;
    manager.close();
    const closedState = JSON.parse(fs.readFileSync(file, "utf8"))[0];
    assert.equal(closedState.status, "failed");
    assert.equal(closedState.progress, 100);
    assert.match(closedState.error, /服务关闭导致排版任务中断/);

    releaseWrite();
    await renameStarted;
    releaseRename();
    await renameFinished;
    // 等待异步持久化链的 finally 完成（包括关闭后的最终同步刷新）。
    await new Promise((resolve) => setImmediate(resolve));
    const stored = JSON.parse(fs.readFileSync(file, "utf8"))[0];
    assert.equal(stored.status, "failed");
    assert.equal(stored.progress, 100);
    assert.match(stored.error, /服务关闭导致排版任务中断/);

    const restored = new SolveTaskManager({ storageFile: file });
    assert.equal(restored.get("close-race-1").status, "failed");
    assert.equal(restored.get("close-race-1").progress, 100);
    assert.match(
      restored.get("close-race-1").error,
      /服务关闭导致排版任务中断/,
    );
    restored.close();
  } finally {
    fs.promises.writeFile = originalWriteFile;
    fs.promises.rename = originalRename;
    if (!writeBlocked) releaseWrite();
    if (!renameBlocked) releaseRename();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("worker 超时会将异步任务标记为失败", async () => {
  const manager = new SolveTaskManager({ storageFile: null, timeoutMs: 20 });
  const { task } = manager.submit({
    __delayMs: 200,
    settings: { slabs: [] },
    parts: [],
  });
  const state = await waitForTaskState(() => manager.get(task.taskId));
  assert.equal(
    state.status,
    "failed",
    `worker 未在预算内超时，当前状态：${state && state.status}`,
  );
  assert.match(state.error, /超时/);
  manager.close();
});

test("持久化恢复会中断 queued/running、恢复幂等索引并跳过过期任务", () => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "solve-task-")),
    "tasks.json",
  );
  const now = Date.now();
  fs.writeFileSync(
    file,
    JSON.stringify([
      {
        taskId: "queued-1",
        status: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 10000,
        inputHash: "a",
        idempotencyKey: "key-1",
      },
      {
        taskId: "running-1",
        status: "running",
        progress: 10,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 10000,
        inputHash: "b",
        idempotencyKey: "key-2",
      },
      {
        taskId: "expired-1",
        status: "succeeded",
        progress: 100,
        expiresAt: now - 1,
        inputHash: "c",
        idempotencyKey: "key-3",
      },
    ]),
  );
  const manager = new SolveTaskManager({ storageFile: file });
  assert.equal(manager.get("queued-1").status, "failed");
  assert.equal(manager.get("running-1").status, "failed");
  assert.equal(manager.get("expired-1"), null);
  assert.equal(manager.idempotency.get("key-1"), "queued-1");
  manager.close();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("结果超限会删除结果字段且持久化文件不包含大结果", async () => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "solve-result-")),
    "tasks.json",
  );
  const manager = new SolveTaskManager({
    storageFile: file,
    maxResultBytes: 1024,
  });
  const { task } = manager.submit({
    settings: {
      algorithm: "standard",
      slabs: [{ id: "甲", w: 1200, h: 500, limit: null }],
    },
    parts: [{ id: "A", w: 200, h: 100, qty: 20 }],
  });
  const state = await waitForTaskState(() => manager.get(task.taskId));
  assert.equal(
    state.status,
    "failed",
    `任务未在预算内结束，当前状态：${state && state.status}`,
  );
  assert.equal(state.result, undefined);
  manager.close();
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stored[0].result, undefined);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("POST /api/solve 参数合法但无法排下全部成品时返回 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // 单块母板但数量上限为 1，成品数量远超可排下的容量
        settings: {
          slabs: [{ id: "甲", w: 2700, h: 1800, limit: 1 }],
          overcut: 30,
          minOffcut: 100,
          sampleSide: 200,
          stripSide: 1000,
          kerf: 0,
          iterations: 180,
        },
        parts: [{ id: "A", w: 1400, h: 600, qty: 50, rotatable: true }],
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(typeof data.error, "string");
    assert.ok(data.error.length > 0);
    assert.equal(data.result, undefined);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/solve 缺少 settings 字段时返回 400 而不是 501", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts: [] }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /settings/);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/solve 携带废弃字段与不携带时核心排版结果一致", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const parts = [{ id: "A", w: 1400, h: 600, qty: 4, rotatable: true }];
    const solveReq = (settings) =>
      fetch(`${baseUrl}/api/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, parts }),
      }).then((r) => r.json());

    const clean = await solveReq({
      slabs: [{ id: "甲", w: 2700, h: 1800, limit: null }],
    });
    const deprecated = await solveReq({
      slabs: [{ id: "甲", w: 2700, h: 1800, limit: null }],
      overcut: 9999,
      minOffcut: 9999,
      sampleSide: 9999,
      stripSide: 9999,
      kerf: 500,
      iterations: 1,
    });
    assert.deepEqual(deprecated.result.plans.A, clean.result.plans.A);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/solve 自定义母板 id 在响应中原样返回", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { slabs: [{ id: "CUSTOM", w: 1000, h: 1000, limit: null }] },
        parts: [{ id: "A", w: 400, h: 300, qty: 1, rotatable: true }],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.result.plans.A.slabs[0].id, "CUSTOM");
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 非法请求 / JSON 解析失败
// ─────────────────────────────────────────────────────────────────────────────

test("POST /api/export 请求体不是合法 JSON 时返回 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ this is not json",
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /JSON/);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/export 请求体为空时返回 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    assert.equal(res.status, 400);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/export 缺少 result 字段时返回 400 且带错误信息", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /缺少计算结果/);
  } finally {
    await stopServer(server);
  }
});

test("POST /api/import 上传空文件时返回 400", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(0),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /空/);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 未知路由
// ─────────────────────────────────────────────────────────────────────────────

test("未知路由返回 404 且带错误信息", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/not-exist`, { method: "GET" });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /不存在/);
  } finally {
    await stopServer(server);
  }
});

test("已知路径但方法不匹配（GET /api/export）返回 404", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, { method: "GET" });
    assert.equal(res.status, 404);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────

test("响应头包含 CORS 允许来源", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/not-exist`, { method: "GET" });
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  } finally {
    await stopServer(server);
  }
});

test("OPTIONS 预检请求返回 204 并带 CORS 头", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-methods"), /POST/);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 请求过大
// ─────────────────────────────────────────────────────────────────────────────

test("POST /api/solve 请求体超过大小限制时返回 413", async () => {
  const { server, baseUrl } = await startServer();
  try {
    // LIMITS.solve = 5MB；构造一个明显超过限制的超大 payload
    const huge = "x".repeat(6 * 1024 * 1024);
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: {}, parts: [], padding: huge }),
    });
    assert.equal(res.status, 413);
    const data = await res.json();
    assert.match(data.error, /过大/);
  } finally {
    await stopServer(server);
  }
});
