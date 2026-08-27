#!/usr/bin/env node
'use strict';

/*
 * 组装 Win8 绿色包。node.exe、BAT 和图标均从外部复制，脚本不会重写它们。
 * 用法示例：
 *   WIN8_NODE=/path/to/node.exe \
 *   WIN8_BAT=/path/to/启动工具_最新版.bat \
 *   WIN8_ICON=/path/to/app.ico \
 *   npm run package:win8
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'dist', 'win8');

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(source).forEach((entry) => {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function copyIfPresent(source, target, missing) {
  if (!source || !fs.existsSync(source)) {
    missing.push(source || target);
    return;
  }
  copyRecursive(source, target);
}

function resetDestination() {
  if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });
}

if (!fs.existsSync(path.join(ROOT, 'frontend', 'out', 'index.html'))) {
  throw new Error('缺少 frontend/out/index.html，请先运行 npm run build:win8');
}

resetDestination();
copyRecursive(path.join(ROOT, 'server.js'), path.join(DEST, 'server.js'));
copyRecursive(path.join(ROOT, 'backend', 'server.js'), path.join(DEST, 'backend', 'server.js'));
copyRecursive(path.join(ROOT, 'backend', 'legacy-server.js'), path.join(DEST, 'backend', 'legacy-server.js'));
copyRecursive(path.join(ROOT, 'backend', 'update-helper.js'), path.join(DEST, 'backend', 'update-helper.js'));
copyRecursive(path.join(ROOT, 'backend', 'src'), path.join(DEST, 'backend', 'src'));
copyRecursive(path.join(ROOT, 'backend', 'node_modules'), path.join(DEST, 'backend', 'node_modules'));
copyRecursive(path.join(ROOT, 'frontend', 'out'), path.join(DEST, 'frontend', 'out'));
if (fs.existsSync(path.join(ROOT, 'vision-config.json'))) {
  copyRecursive(path.join(ROOT, 'vision-config.json'), path.join(DEST, 'vision-config.json'));
}

const assetDir = process.env.WIN8_ASSETS_DIR || '';
const missing = [];
copyIfPresent(
  process.env.WIN8_NODE || path.join(assetDir, 'node.exe'),
  path.join(DEST, 'node.exe'),
  missing,
);
copyIfPresent(
  process.env.WIN8_BAT || path.join(assetDir, '启动工具_最新版.bat'),
  path.join(DEST, '启动工具_最新版.bat'),
  missing,
);
copyIfPresent(
  process.env.WIN8_ICON || path.join(assetDir, 'app.ico'),
  path.join(DEST, 'app.ico'),
  missing,
);

process.stdout.write(`Win8 兼容包已生成：${DEST}\n`);
if (missing.length) {
  process.stdout.write('以下外部文件未复制（不会被脚本生成或修改）：\n');
  missing.forEach((item) => process.stdout.write(`- ${item}\n`));
  process.stdout.write('请从旧版绿色包提供这些文件后再交给 Win8 测试机。\n');
}
