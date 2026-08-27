'use strict';

/**
 * static-webapp.js — Win8 绿色版静态文件处理器
 *
 * 这个模块只使用 Node 14 已支持的原生 API。前端由现代 Node 在构建阶段
 * 输出到 frontend/out，Win8 运行时不需要加载 Next.js。
 */

const fs = require('fs');
const path = require('path');

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return null;
  }
}

function resolveFile(root, pathname) {
  const decoded = safeDecode(pathname);
  if (decoded === null || decoded.indexOf('\0') !== -1) return null;

  const relative = decoded.replace(/^\/+/, '');
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, relative);
  if (candidate !== rootPath && candidate.indexOf(`${rootPath}${path.sep}`) !== 0) {
    return null;
  }
  return candidate;
}

function contentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function sendNotFound(res) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('页面不存在');
}

function createStaticWebHandler({ root }) {
  const staticRoot = path.resolve(root);

  async function handle(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    const requested = resolveFile(staticRoot, url.pathname);
    if (!requested) {
      sendNotFound(res);
      return;
    }

    let filePath = requested;
    const isAssetRequest = /\.[^/]+$/.test(url.pathname) || url.pathname.indexOf('/_next/') === 0;
    let stat;
    try {
      stat = fs.statSync(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch (_) {
      // Next 的客户端路由没有对应目录时回退到首页；静态资源缺失则返回 404。
      if (isAssetRequest) {
        sendNotFound(res);
        return;
      }
      filePath = path.join(staticRoot, 'index.html');
    }

    try {
      stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        sendNotFound(res);
        return;
      }
      const body = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType(filePath),
        'Content-Length': body.length,
        'Cache-Control': filePath.indexOf(`${path.sep}_next${path.sep}`) !== -1
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(body);
    } catch (_) {
      sendNotFound(res);
    }
  }

  return { ready: Promise.resolve(), handle, root: staticRoot };
}

module.exports = { createStaticWebHandler };
