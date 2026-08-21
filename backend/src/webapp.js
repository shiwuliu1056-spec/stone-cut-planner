'use strict';

/**
 * webapp.js — 前端页面集成（内嵌 Next.js）
 *
 * 目标：让后端服务器在处理 /api/* 之外，同时负责渲染 frontend/ 的 Next.js 页面，
 * 实现「单进程、单端口、一个命令启动」。本模块不修改任何前端源码，
 * 仅在运行时从 frontend/ 目录解析并加载其已安装的 next 依赖。
 *
 * - 开发模式 (dev=true)：Next 即时编译，无需预先 build，改动前端源码自动生效。
 * - 生产模式 (dev=false)：需先执行 `npm --prefix frontend run build` 生成 .next 产物。
 */

const path = require('path');

// 前端项目根目录（与 backend/ 同级）
const FRONTEND_DIR = path.resolve(__dirname, '..', '..', 'frontend');

/**
 * 创建一个用于处理「非 API」请求的 Next.js 请求处理器。
 *
 * @param {{dev?: boolean}} options
 *   dev: 是否以开发模式启动 Next（默认根据 NODE_ENV 判断）。
 * @returns {{ready: Promise<void>, handle: (req, res) => Promise<void>, dev: boolean}}
 */
function createWebHandler({ dev = process.env.NODE_ENV !== 'production' } = {}) {
  // 从 frontend 目录解析 next，避免要求后端自身安装一份 next。
  // next 内部依赖（react 等）会由 Node 从 frontend/node_modules 正确解析。
  let nextFactory;
  try {
    const nextPath = require.resolve('next', { paths: [FRONTEND_DIR] });
    nextFactory = require(nextPath);
  } catch (err) {
    const error = new Error(
      `无法从 ${FRONTEND_DIR} 加载 next，请先在 frontend/ 执行依赖安装。原始错误：${err.message}`,
    );
    error.cause = err;
    throw error;
  }

  const app = nextFactory({ dev, dir: FRONTEND_DIR });
  const nativeHandle = app.getRequestHandler();
  const ready = app.prepare();

  // 不传入自定义 parsedUrl：让 Next 依据 req.url 自行用 url.parse 解析，
  // 避免传入 WHATWG URL 对象（其 query 为 URLSearchParams）导致 Next
  // 反复规范化 URL 而产生 308 重定向环。
  async function handle(req, res) {
    await ready;
    return nativeHandle(req, res);
  }

  return { ready, handle, dev };
}

module.exports = { createWebHandler, FRONTEND_DIR };
