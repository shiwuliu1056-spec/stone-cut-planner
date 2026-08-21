#!/usr/bin/env node
'use strict';

/**
 * server.js — 石材下料工具本地 HTTP 服务
 *
 * 按 shared/API.md 实现接口：/api/import、/api/solve、/api/export、
 * /api/export-word、/api/shutdown 以及 /api/update/*。
 * 排版算法委托 src/solver.js，导入导出委托 src/workbook.js，更新委托 src/updater.js。
 */

const http = require('http');
const { importParts, exportWorkbook, exportWord } = require('./src/workbook');
const { solve } = require('./src/solver');
const { checkForUpdate, startApply, progress: getUpdateProgress } = require('./src/updater');

// ── 请求体大小限制（字节） ────────────────────────────────────────────────
const LIMITS = {
  import: 25 * 1024 * 1024,       // Excel 文件
  solve: 5 * 1024 * 1024,         // 仅 JSON 参数，无图片
  export: 60 * 1024 * 1024,       // 含排版渲染图 Base64，体积较大
  exportWord: 60 * 1024 * 1024,
};

// ── CORS ──────────────────────────────────────────────────────────────────
function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

// ── 读取请求体，超过 limit 时中断并抛出 413 错误 ────────────────────────────
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    // 超限后不立即销毁连接：仅停止收集数据、继续排空流，
    // 以便后续能正常写出 413 响应（销毁 socket 会导致客户端收到 ECONNRESET 而非响应体）。
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        const error = new Error('请求体过大');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!rejected) reject(error);
    });
  });
}

/** 读取请求体并解析为 JSON；解析失败抛出 400 错误。 */
async function readJsonBody(req, limit) {
  const buffer = await readBody(req, limit);
  const text = buffer.toString('utf8').trim();
  if (!text) {
    const error = new Error('请求体不能为空');
    error.statusCode = 400;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('请求体不是合法的 JSON');
    error.statusCode = 400;
    throw error;
  }
}

// ── 响应辅助函数 ──────────────────────────────────────────────────────────
function sendJson(res, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function sendFile(res, status, buffer, contentType, filename) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

// ── /api/solve 参数结构校验（不做业务计算，仅做非法参数检查） ─────────────
function validateSolveRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return '请求体必须是 JSON 对象';
  }
  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
    return '缺少或非法的 settings 字段';
  }
  if (!Array.isArray(body.settings.slabs)) {
    return '缺少或非法的 settings.slabs 字段（应为数组）';
  }
  if (!Array.isArray(body.parts)) {
    return '缺少或非法的 parts 字段（应为数组）';
  }
  return null;
}

// ── 各接口处理函数 ────────────────────────────────────────────────────────

async function handleImport(req, res) {
  const buffer = await readBody(req, LIMITS.import);
  const parts = await importParts(buffer);
  sendJson(res, 200, { parts });
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

async function handleExport(req, res) {
  const body = await readJsonBody(req, LIMITS.export);
  const buffer = Buffer.from(await exportWorkbook(body));
  const filename = `石材下料方案_${new Date().toISOString().slice(0, 10)}.xlsx`;
  sendFile(res, 200, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename);
}

async function handleExportWord(req, res) {
  const body = await readJsonBody(req, LIMITS.exportWord);
  const buffer = Buffer.from(await exportWord(body));
  const filename = `石材下料排版图_${new Date().toISOString().slice(0, 10)}.docx`;
  sendFile(res, 200, buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename);
}

async function handleShutdown(req, res, server, exit) {
  sendJson(res, 200, { message: '服务即将关闭' });
  setTimeout(() => {
    server.close(() => exit());
  }, 50);
}

async function handleUpdateCheck(req, res) {
  const info = await checkForUpdate();
  sendJson(res, 200, info);
}

async function handleUpdateApply(req, res, server, exit) {
  await startApply(() => {
    server.close(() => exit());
  });
  sendJson(res, 200, { message: '更新已开始' });
}

function handleUpdateProgress(req, res) {
  sendJson(res, 200, getUpdateProgress());
}

// ── 路由表：method + pathname -> handler ────────────────────────────────
function buildRoutes(server, exit) {
  return [
    { method: 'POST', path: '/api/import', handler: handleImport },
    { method: 'POST', path: '/api/solve', handler: handleSolve },
    { method: 'POST', path: '/api/export', handler: handleExport },
    { method: 'POST', path: '/api/export-word', handler: handleExportWord },
    { method: 'POST', path: '/api/shutdown', handler: (req, res) => handleShutdown(req, res, server, exit) },
    { method: 'GET',  path: '/api/update/check', handler: handleUpdateCheck },
    { method: 'POST', path: '/api/update/apply', handler: (req, res) => handleUpdateApply(req, res, server, exit) },
    { method: 'GET',  path: '/api/update/progress', handler: handleUpdateProgress },
  ];
}

/**
 * 创建 HTTP 服务实例。
 *
 * @param {{exit?: () => void, webHandler?: (req, res, parsedUrl) => Promise<void>}} options
 *   exit: /api/shutdown 触发关闭后调用的函数，默认调用 process.exit(0)。
 *         测试环境可注入自定义函数以避免真正终止测试进程。
 *   webHandler: 处理「非 /api」请求（前端页面/静态资源）的处理器。
 *         未提供时（如后端单元测试），非 API 路由按 404 处理，行为与集成前一致。
 * @returns {http.Server}
 */
function createServer({ exit = () => process.exit(0), webHandler = null } = {}) {
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      applyCors(res);
      sendError(res, 400, '请求地址无效');
      return;
    }

    // 非 API 请求：交给前端（Next.js）处理。前端与后端同源，无需 CORS 头。
    if (webHandler && !url.pathname.startsWith('/api/')) {
      try {
        await webHandler(req, res, url);
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`页面渲染失败：${(error && error.message) || String(error)}`);
        } else {
          res.destroy();
        }
      }
      return;
    }

    applyCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const routes = buildRoutes(server, exit);
    const route = routes.find((r) => r.method === req.method && r.path === url.pathname);

    if (!route) {
      sendError(res, 404, '接口不存在');
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
      const status = Number.isInteger(error && error.statusCode) ? error.statusCode : 400;
      sendError(res, status, (error && error.message) || String(error));
    }
  });
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  const { createWebHandler } = require('./src/webapp');

  const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
  // Next 会读取 NODE_ENV，需在初始化前设定。
  process.env.NODE_ENV = prod ? 'production' : 'development';

  // 集成前端页面：非 /api 请求交给内嵌 Next.js 渲染，实现单进程单端口。
  let webHandler;
  try {
    webHandler = createWebHandler({ dev: !prod });
  } catch (error) {
    process.stderr.write(`前端集成初始化失败：${error.message}\n`);
    process.exit(1);
  }

  const server = createServer({ webHandler: webHandler.handle });
  const port = Number(process.env.PORT) || 3000;

  webHandler.ready
    .then(() => {
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        const url = `http://127.0.0.1:${address.port}/`;
        process.stdout.write(`石材下料工具已启动：${url}\n`);
        process.stdout.write('（前端与后端已合并为同一服务，按 Ctrl+C 退出）\n');
      });
    })
    .catch((error) => {
      process.stderr.write(`前端准备失败：${error.message}\n`);
      process.exit(1);
    });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      process.stderr.write(`启动失败：端口 ${port} 已被占用，可用 PORT 环境变量指定其他端口。\n`);
    } else {
      process.stderr.write(`启动失败：${error.message}\n`);
    }
    process.exitCode = 1;
  });
}
