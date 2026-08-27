#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const assets = childProcess.spawnSync(process.execPath, [require('path').join(__dirname, 'prepare-ocr-assets.js')], {
  stdio: 'inherit',
});
if (assets.status !== 0) process.exitCode = assets.status === null ? 1 : assets.status;
if (process.exitCode) process.exit(process.exitCode);

const result = childProcess.spawnSync(npm, ['--prefix', 'frontend', 'run', 'build'], {
  env: { ...process.env, NEXT_WIN8_BUILD: '1' },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
process.exitCode = result.status === null ? 1 : result.status;
