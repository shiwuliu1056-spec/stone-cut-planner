#!/usr/bin/env node
'use strict';

// CloudBase 云托管 API 入口：只承载小程序所需的 /api/*，不加载 Next.js 前端。
const { createServer } = require('./server');

const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || '0.0.0.0';
const server = createServer();

server.listen(port, host, () => {
  process.stdout.write(`石材下料 API 已启动：${host}:${port}\n`);
});

server.on('error', (error) => {
  process.stderr.write(`API 启动失败：${error.message}\n`);
  process.exitCode = 1;
});
