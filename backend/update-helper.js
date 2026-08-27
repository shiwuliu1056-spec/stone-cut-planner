#!/usr/bin/env node
'use strict';

/** Win8 ZIP 更新辅助进程：等待主服务退出后覆盖文件并重新启动。 */
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(source).forEach((entry) => copyRecursive(path.join(source, entry), path.join(target, entry)));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

async function applyZip(zipPath, targetDir) {
  const staging = path.join(targetDir, `.update-staging-${process.pid}`);
  fs.mkdirSync(staging, { recursive: true });
  await (await unzipper.Open.file(zipPath)).extract({ path: staging });
  const entries = fs.readdirSync(staging);
  const sourceDir = entries.length === 1 && fs.statSync(path.join(staging, entries[0])).isDirectory()
    ? path.join(staging, entries[0])
    : staging;
  copyRecursive(sourceDir, targetDir);
  try { fs.unlinkSync(zipPath); } catch (_) { /* ignore */ }
  try { fs.rmSync(staging, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  const nodeExe = path.join(targetDir, 'node.exe');
  const server = path.join(targetDir, 'server.js');
  childProcess.spawn(nodeExe, [server], { cwd: targetDir, detached: true, stdio: 'ignore' }).unref();
}

if (process.argv[2] !== '--apply-zip' || !process.argv[3] || !process.argv[4]) {
  process.exitCode = 2;
} else {
  setTimeout(() => applyZip(path.resolve(process.argv[3]), path.resolve(process.argv[4])).catch(() => { process.exitCode = 1; }), 1200);
}
