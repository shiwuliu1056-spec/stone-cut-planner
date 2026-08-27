#!/usr/bin/env node
'use strict';

/**
 * Win8 绿色版入口。
 *
 * 运行时只依赖 Node 14、backend 的 Excel/Word 依赖和 frontend/out 静态文件，
 * 不 require Next.js，因此可以沿用旧版 node.exe + server.js 的启动逻辑。
 */

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.STONE_WIN8_PACKAGE = '1';
const { createServer } = require('./server');
const { createStaticWebHandler } = require('./src/static-webapp');

const APP_ROOT = path.resolve(__dirname, '..');
const STATIC_ROOT = path.join(APP_ROOT, 'frontend', 'out');

function openBrowser(url) {
  if (process.env.STONE_NO_OPEN === '1') return;

  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter(Boolean);
    const candidates = [];
    roots.forEach((root) => {
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    });
    const executable = candidates.find((candidate) => {
      try { return fs.existsSync(candidate); } catch (_) { return false; }
    });
    if (executable) {
      childProcess.spawn(executable, [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    childProcess.spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    childProcess.spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) {
    // 无图形浏览器时仍保持服务运行，用户可以手动打开控制台打印的 URL。
  }
}

if (!fs.existsSync(path.join(STATIC_ROOT, 'index.html'))) {
  process.stderr.write('Win8 兼容版缺少 frontend/out/index.html，请先运行 npm run build:win8。\n');
  process.exitCode = 1;
} else {
  const webHandler = createStaticWebHandler({ root: STATIC_ROOT });
  const server = createServer({ webHandler: webHandler.handle });
  const requestedPort = Number(process.env.PORT);
  const port = Number.isFinite(requestedPort) && requestedPort > 0 ? requestedPort : 0;

  server.on('error', (error) => {
    process.stderr.write(`启动失败：${error.message}\n`);
    process.exitCode = 1;
  });

  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/`;
    process.stdout.write(`石材下料工具 Win8 兼容版已启动：${url}\n`);
    process.stdout.write('（请保持此窗口开启，按 Ctrl+C 退出）\n');
    openBrowser(url);
  });
}
