#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PACKAGE_ZIP = path.join(DIST, '九江宝松石材下料工具_Win8兼容版.zip');
const RELEASE_ZIP = path.join(DIST, 'stone-planner-win8.zip');
const MANIFEST = path.join(ROOT, 'update-manifest.json');

function run(command, args) {
  const result = childProcess.spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 执行失败`);
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }

function setVersion(filePath, version) {
  const value = readJson(filePath);
  value.version = version;
  writeJson(filePath, value);
}

function updateLockVersion(filePath, version) {
  if (!fs.existsSync(filePath)) return;
  const lock = readJson(filePath);
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  writeJson(filePath, lock);
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function repositoryName() {
  const remote = childProcess.execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const match = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) throw new Error('origin 不是 GitHub 仓库，无法自动创建 Release');
  return match[1];
}

async function main() {
  const version = String(process.argv[2] || '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('请传入版本号，例如：npm run release:win8 -- 1.1.0');
  }

  const current = readJson(path.join(ROOT, 'package.json')).version;
  const manifest = fs.existsSync(MANIFEST) ? readJson(MANIFEST) : { version: '0.0.0' };
  if (version === current || version === manifest.version) {
    throw new Error(`版本 ${version} 已存在，请使用更高的新版本号`);
  }

  setVersion(path.join(ROOT, 'package.json'), version);
  setVersion(path.join(ROOT, 'backend', 'package.json'), version);
  updateLockVersion(path.join(ROOT, 'package-lock.json'), version);
  updateLockVersion(path.join(ROOT, 'backend', 'package-lock.json'), version);

  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:win8']);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'package:win8']);
  fs.copyFileSync(PACKAGE_ZIP, RELEASE_ZIP);
  const checksum = await sha256(RELEASE_ZIP);
  const repo = repositoryName();
  writeJson(MANIFEST, {
    version,
    url: `https://github.com/${repo}/releases/download/v${version}/stone-planner-win8.zip`,
    sha256: checksum,
    notes: `Win8 绿色版 ${version}`,
  });

  run('git', ['add', 'package.json', 'package-lock.json', 'backend/package.json', 'backend/package-lock.json', 'update-manifest.json']);
  run('git', ['commit', '-m', `release: win8 v${version}`]);
  run('git', ['push', 'origin', 'main']);
  run('gh', ['release', 'create', `v${version}`, RELEASE_ZIP, '--title', `Win8 绿色版 v${version}`, '--notes', `Win8 绿色版 ${version}`]);
  process.stdout.write(`Win8 版本 ${version} 已发布。\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
