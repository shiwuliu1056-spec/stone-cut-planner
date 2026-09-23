#!/usr/bin/env node

/**
 * server.js — 宝松工具箱小程序后端 HTTP 服务（唯一入口）
 *
 * 按 shared/API.md 实现接口：/api/import、/api/import-url、/api/ocr/*、
 * /api/solve、/api/solve/tasks、/api/video/*、/api/export、/api/export-word。
 * 排版算法委托 src/solver.js，导入导出委托 src/workbook.js。
 *
 * 直接运行本文件即启动服务：本地默认 127.0.0.1:3100，容器内由 HOST/PORT 覆盖。
 */

const http = require("http");
// exceljs/docx 体积大、加载慢，且只有导入/导出接口用到；
// 延迟到首次请求再加载，缩短容器冷启动（排版/视频/OCR 请求完全不触发）。
let workbookService = null;
function getWorkbook() {
  if (!workbookService) workbookService = require("./src/workbook");
  return workbookService;
}
const { solve } = require("./src/solver");
const { recognizePhoto } = require("./src/gemini-ocr");
const { downloadHttps, imageMimeFromBuffer } = require("./src/remote");
const { SolveTaskManager } = require("./src/solve-tasks");
const tikHubVideoService = require("./src/tikhub");
const transcriptServiceDefault = require("./src/transcript");

// ── 请求体大小限制（字节） ────────────────────────────────────────────────
const LIMITS = {
  import: 25 * 1024 * 1024, // Excel 文件
  solve: 5 * 1024 * 1024, // 仅 JSON 参数，无图片
  export: 60 * 1024 * 1024, // 含排版渲染图 Base64，体积较大
  exportWord: 60 * 1024 * 1024,
  photoOcr: 22 * 1024 * 1024,
  videoLink: 16 * 1024,
  remoteTimeoutMs: Math.max(
    5000,
    Number(process.env.REMOTE_DOWNLOAD_TIMEOUT_MS) || 60000,
  ),
};
const MINI_PROGRAM_APP_ID =
  process.env.MINIPROGRAM_APP_ID || "wxe4560e02e4b75800";
const VIDEO_RATE_LIMIT = 6;
const VIDEO_RATE_WINDOW_MS = 60 * 1000;

// ── CORS ──────────────────────────────────────────────────────────────────
function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

// ── 读取请求体，超过 limit 时中断并抛出 413 错误 ────────────────────────────
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    // 超限后不立即销毁连接：仅停止收集数据、继续排空流，
    // 以便后续能正常写出 413 响应（销毁 socket 会导致客户端收到 ECONNRESET 而非响应体）。
    req.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        const error = new Error("请求体过大");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => {
      if (!rejected) reject(error);
    });
  });
}

/** 读取请求体并解析为 JSON；解析失败抛出 400 错误。 */
async function readJsonBody(req, limit) {
  const buffer = await readBody(req, limit);
  const text = buffer.toString("utf8").trim();
  if (!text) {
    const error = new Error("请求体不能为空");
    error.statusCode = 400;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("请求体不是合法的 JSON");
    error.statusCode = 400;
    throw error;
  }
}

// ── 响应辅助函数 ──────────────────────────────────────────────────────────
function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendFile(res, status, buffer, contentType, filename) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buffer.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "no-store",
  });
  res.end(buffer);
}

// ── /api/solve 参数结构校验（不做业务计算，仅做非法参数检查） ─────────────
function validateSolveRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "请求体必须是 JSON 对象";
  }
  if (
    !body.settings ||
    typeof body.settings !== "object" ||
    Array.isArray(body.settings)
  ) {
    return "缺少或非法的 settings 字段";
  }
  if (!Array.isArray(body.settings.slabs)) {
    return "缺少或非法的 settings.slabs 字段（应为数组）";
  }
  if (!Array.isArray(body.parts)) {
    return "缺少或非法的 parts 字段（应为数组）";
  }
  return null;
}

// ── 各接口处理函数 ────────────────────────────────────────────────────────

async function handleImport(req, res) {
  const buffer = await readBody(req, LIMITS.import);
  const parts = await getWorkbook().importParts(buffer);
  sendJson(res, 200, { parts });
}

async function handleImportUrl(req, res) {
  const body = await readJsonBody(req, LIMITS.solve);
  if (!body || typeof body.url !== "string") {
    sendError(res, 400, "缺少文件地址");
    return;
  }
  const remote = await downloadHttps(
    body.url,
    LIMITS.import,
    LIMITS.remoteTimeoutMs,
  );
  const parts = await getWorkbook().importParts(remote.buffer);
  sendJson(res, 200, { parts });
}

async function handlePhotoOcr(req, res) {
  const body = await readJsonBody(req, LIMITS.photoOcr);
  if (!body || typeof body.image !== "string") {
    sendError(res, 400, "缺少图片内容");
    return;
  }
  const result = await recognizePhoto({ image: body.image, unit: body.unit });
  sendJson(res, 200, result);
}

async function handlePhotoOcrUrl(req, res) {
  const body = await readJsonBody(req, LIMITS.solve);
  if (!body || typeof body.url !== "string") {
    sendError(res, 400, "缺少图片地址");
    return;
  }
  const remote = await downloadHttps(
    body.url,
    LIMITS.photoOcr,
    LIMITS.remoteTimeoutMs,
  );
  const mime = imageMimeFromBuffer(remote.buffer);
  if (!mime) {
    sendError(res, 400, "远程文件不是支持的图片格式");
    return;
  }
  const image = `data:${mime};base64,${remote.buffer.toString("base64")}`;
  const result = await recognizePhoto({ image, unit: body.unit });
  sendJson(res, 200, result);
}

async function handleSolve(req, res) {
  const body = await readJsonBody(req, LIMITS.solve);
  const invalidReason = validateSolveRequest(body);
  if (invalidReason) {
    sendError(res, 400, invalidReason);
    return;
  }
  try {
    const result = solve({ settings: body.settings, parts: body.parts });
    sendJson(res, 200, { result });
  } catch (err) {
    sendError(res, 400, err.message || String(err));
  }
}

async function handleSolveSubmit(req, res, solveTasks) {
  const body = await readJsonBody(req, LIMITS.solve);
  const invalidReason = validateSolveRequest(body);
  if (invalidReason) {
    sendError(res, 400, invalidReason);
    return;
  }
  const key = req.headers["idempotency-key"] || body.idempotencyKey || "";
  const { task, reused } = solveTasks.submit(
    { settings: body.settings, parts: body.parts },
    key,
  );
  sendJson(res, reused ? 200 : 202, {
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    createdAt: task.createdAt,
    expiresAt: task.expiresAt,
    reused,
  });
}

function handleSolveStatus(_req, res, solveTasks, taskId) {
  const task = solveTasks.get(taskId);
  if (!task) {
    sendError(res, 404, "排版任务不存在或已过期");
    return;
  }
  const response = {
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    expiresAt: task.expiresAt,
  };
  if (task.status === "succeeded") response.result = task.result;
  if (task.status === "failed") response.error = task.error;
  sendJson(res, 200, response);
}

function handleHealth(_req, res) {
  sendJson(res, 200, { ok: true });
}

function isLoopbackRequest(req) {
  const address = String(
    (req.socket && req.socket.remoteAddress) || "",
  ).toLowerCase();
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address.startsWith("::ffff:127.")
  );
}

function verifyMiniProgramCaller(req, allowLocalVideoRequests) {
  if (allowLocalVideoRequests && isLoopbackRequest(req)) return "local-dev";
  const appId = String(req.headers["x-wx-appid"] || "").trim();
  const openId = String(req.headers["x-wx-openid"] || "").trim();
  if (appId !== MINI_PROGRAM_APP_ID || !openId)
    throw Object.assign(new Error("仅允许从宝松工具箱小程序使用此功能"), {
      statusCode: 403,
    });
  return openId;
}

function claimVideoQuota(rateLimits, openId) {
  const now = Date.now();
  const recent = (rateLimits.get(openId) || []).filter(
    (time) => now - time < VIDEO_RATE_WINDOW_MS,
  );
  if (recent.length >= VIDEO_RATE_LIMIT)
    throw Object.assign(new Error("解析过于频繁，请一分钟后再试"), {
      statusCode: 429,
    });
  recent.push(now);
  rateLimits.set(openId, recent);
  if (rateLimits.size > 1000) {
    for (const [key, times] of rateLimits)
      if (!times.some((time) => now - time < VIDEO_RATE_WINDOW_MS))
        rateLimits.delete(key);
  }
}

async function handleVideoWatermark(
  req,
  res,
  videoService,
  rateLimits,
  allowLocalVideoRequests,
) {
  const openId = verifyMiniProgramCaller(req, allowLocalVideoRequests);
  claimVideoQuota(rateLimits, openId);
  const body = await readJsonBody(req, LIMITS.videoLink);
  const parsed = await videoService.parseVideo(
    body && body.url,
    body && body.platform,
  );
  const token = videoService.createDownloadToken({
    videoUrl: parsed.videoUrl,
    platform: parsed.platform,
    decodeKey: parsed.decodeKey,
  });
  sendJson(res, 200, {
    durationMs: parsed.durationMs,
    downloadPath: `/api/video/download.mp4?token=${encodeURIComponent(token)}`,
    mediaToken: token,
    platform: parsed.platform,
    platformLabel: parsed.platformLabel,
  });
}

async function handleVideoTranscriptStart(
  req,
  res,
  videoService,
  transcriptService,
  rateLimits,
  allowLocalVideoRequests,
) {
  const openId = verifyMiniProgramCaller(req, allowLocalVideoRequests);
  claimVideoQuota(rateLimits, openId);
  const body = await readJsonBody(req, LIMITS.videoLink);
  const requestedPlatform = String((body && body.platform) || "").trim();
  let parsed;
  let mediaToken = String((body && body.mediaToken) || "").trim();
  if (mediaToken) {
    const descriptor = videoService.verifyDownloadToken(mediaToken);
    if (
      !descriptor ||
      typeof descriptor !== "object" ||
      !descriptor.url ||
      !descriptor.platform ||
      descriptor.platform !== requestedPlatform
    ) {
      throw Object.assign(
        new Error("视频解析令牌与当前平台不匹配，请重新解析视频"),
        { statusCode: 403 },
      );
    }
    parsed = {
      videoUrl: descriptor.url,
      platform: descriptor.platform,
      decodeKey: descriptor.decodeKey,
    };
  } else {
    parsed = await videoService.parseVideo(body && body.url, requestedPlatform);
    mediaToken = videoService.createDownloadToken({
      videoUrl: parsed.videoUrl,
      platform: parsed.platform,
      decodeKey: parsed.decodeKey,
    });
  }
  let taskId;
  if (parsed.platform === "wechat_channels") {
    taskId = await transcriptService.createWechatTranscriptTask(
      {
        url: parsed.videoUrl,
        platform: parsed.platform,
        decodeKey: parsed.decodeKey,
      },
      videoService.downloadVideoToFile,
    );
  } else if (parsed.platform === "xiaohongshu") {
    taskId = await transcriptService.createXiaohongshuTranscriptTask(
      {
        url: parsed.videoUrl,
        platform: parsed.platform,
      },
      videoService.downloadVideoToFile,
    );
  } else {
    taskId = await transcriptService.createTranscriptTask(parsed.videoUrl);
  }
  sendJson(res, 202, {
    status: "pending",
    mediaToken,
    transcriptToken: transcriptService.createTranscriptToken(taskId),
  });
}

async function handleVideoTranscriptStatus(
  req,
  res,
  transcriptService,
  token,
  allowLocalVideoRequests,
) {
  verifyMiniProgramCaller(req, allowLocalVideoRequests);
  const taskId = transcriptService.verifyTranscriptToken(token);
  sendJson(res, 200, await transcriptService.getTranscriptTask(taskId));
}

async function handleVideoDownload(req, res, videoService, token) {
  const descriptor = videoService.verifyDownloadToken(token);
  await videoService.streamVideo(descriptor, res, { range: req.headers.range });
}

async function handleExport(req, res) {
  const body = await readJsonBody(req, LIMITS.export);
  const buffer = Buffer.from(await getWorkbook().exportWorkbook(body));
  const filename = `石材下料方案_${new Date().toISOString().slice(0, 10)}.xlsx`;
  sendFile(
    res,
    200,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename,
  );
}

async function handleExportWord(req, res) {
  const body = await readJsonBody(req, LIMITS.exportWord);
  const buffer = Buffer.from(await getWorkbook().exportWord(body));
  const filename = `石材下料排版图_${new Date().toISOString().slice(0, 10)}.docx`;
  sendFile(
    res,
    200,
    buffer,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    filename,
  );
}

// ── 路由表：method + pathname -> handler ────────────────────────────────
function buildRoutes(
  solveTasks,
  videoService,
  transcriptService,
  videoRateLimits,
  allowLocalVideoRequests,
) {
  return [
    { method: "GET", path: "/api/health", handler: handleHealth },
    { method: "POST", path: "/api/import", handler: handleImport },
    { method: "POST", path: "/api/import-url", handler: handleImportUrl },
    { method: "POST", path: "/api/ocr/photo", handler: handlePhotoOcr },
    { method: "POST", path: "/api/ocr/photo-url", handler: handlePhotoOcrUrl },
    { method: "POST", path: "/api/solve", handler: handleSolve },
    {
      method: "POST",
      path: "/api/solve/tasks",
      handler: (req, res) => handleSolveSubmit(req, res, solveTasks),
    },
    {
      method: "POST",
      path: "/api/video/watermark",
      handler: (req, res) =>
        handleVideoWatermark(
          req,
          res,
          videoService,
          videoRateLimits,
          allowLocalVideoRequests,
        ),
    },
    {
      method: "POST",
      path: "/api/video/transcript",
      handler: (req, res) =>
        handleVideoTranscriptStart(
          req,
          res,
          videoService,
          transcriptService,
          videoRateLimits,
          allowLocalVideoRequests,
        ),
    },
    { method: "POST", path: "/api/export", handler: handleExport },
    { method: "POST", path: "/api/export-word", handler: handleExportWord },
  ];
}

/**
 * 创建 HTTP 服务实例。
 *
 * @param {{solveTaskOptions?: object, videoService?: object, transcriptService?: object,
 *   allowLocalVideoRequests?: boolean}} options
 *   测试环境可注入 solveTaskOptions 与替身服务实现。
 * @returns {http.Server}
 */
function createServer({
  solveTaskOptions = {},
  videoService = tikHubVideoService,
  transcriptService = transcriptServiceDefault,
  allowLocalVideoRequests = process.env.NODE_ENV !== "production",
} = {}) {
  const solveTasks = new SolveTaskManager(solveTaskOptions);
  const videoRateLimits = new Map();
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, "http://127.0.0.1");
    } catch {
      applyCors(res);
      sendError(res, 400, "请求地址无效");
      return;
    }

    applyCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/solve\/tasks\/([^/]+)$/);
    if (req.method === "GET" && taskMatch) {
      handleSolveStatus(req, res, solveTasks, decodeURIComponent(taskMatch[1]));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/video/download.mp4") {
      try {
        await handleVideoDownload(
          req,
          res,
          videoService,
          url.searchParams.get("token"),
        );
      } catch (error) {
        if (res.headersSent) res.destroy();
        else
          sendError(
            res,
            Number.isInteger(error && error.statusCode)
              ? error.statusCode
              : 502,
            (error && error.message) || "视频下载失败",
          );
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/video/transcript") {
      try {
        await handleVideoTranscriptStatus(
          req,
          res,
          transcriptService,
          url.searchParams.get("token"),
          allowLocalVideoRequests,
        );
      } catch (error) {
        const hasFriendlyMessage = /[\u4e00-\u9fff]/.test(
          String((error && error.message) || ""),
        );
        if (Number.isInteger(error && error.statusCode) && hasFriendlyMessage) {
          sendError(res, error.statusCode, error.message);
        } else {
          process.stderr.write(
            `[unhandled] ${req.method} ${url.pathname}: ${(error && error.stack) || String(error)}\n`,
          );
          sendError(res, 502, "视频语音转写失败，请稍后重试");
        }
      }
      return;
    }
    const routes = buildRoutes(
      solveTasks,
      videoService,
      transcriptService,
      videoRateLimits,
      allowLocalVideoRequests,
    );
    const route = routes.find(
      (r) => r.method === req.method && r.path === url.pathname,
    );

    if (!route) {
      sendError(res, 404, "接口不存在");
      return;
    }

    try {
      await route.handler(req, res);
    } catch (error) {
      if (res.headersSent) {
        // 响应已开始发送（如文件流写到一半），无法再改写状态码，直接结束连接。
        res.destroy();
        return;
      }
      // 带 statusCode 的错误是各业务模块主动抛出的、已写好中文文案的预期错误，可安全返回；
      // 未预期异常（无 statusCode）可能携带技术细节（英文 message / 堆栈），只记录日志，向客户端返回通用提示。
      const hasFriendlyMessage = /[\u4e00-\u9fff]/.test(
        String((error && error.message) || ""),
      );
      if (Number.isInteger(error && error.statusCode) && hasFriendlyMessage) {
        sendError(res, error.statusCode, error.message);
      } else {
        process.stderr.write(
          `[unhandled] ${req.method} ${url.pathname}: ${(error && error.stack) || String(error)}\n`,
        );
        sendError(res, 500, "服务暂时不可用，请稍后重试");
      }
    }
  });
  server.solveTasks = solveTasks;
  server.on("close", () => solveTasks.close());
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3100;
  const host = process.env.HOST || "127.0.0.1";

  server.listen(port, host, () => {
    const address = server.address();
    const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    process.stdout.write(
      `石材下料 API 已启动：http://${displayHost}:${address.port}/\n`,
    );
  });

  server.on("error", (error) => {
    if (error && error.code === "EADDRINUSE") {
      process.stderr.write(
        `启动失败：端口 ${port} 已被占用，可用 PORT 环境变量指定其他端口。\n`,
      );
    } else {
      process.stderr.write(`启动失败：${error.message}\n`);
    }
    process.exitCode = 1;
  });
}
