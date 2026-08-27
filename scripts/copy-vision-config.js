#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = process.env.VISION_ENV_FILE
  || path.join(os.homedir(), '.config', 'agent-vision-toolkit', 'env');
const target = path.join(root, 'vision-config.json');
const config = {};

if (!fs.existsSync(source)) {
  throw new Error(`找不到 Agent Vision Toolkit 配置：${source}`);
}
fs.readFileSync(source, 'utf8').split(/\r?\n/).forEach((line) => {
  const match = line.match(/^\s*(VISION_BASE_URL|VISION_API_KEY|VISION_MODEL)\s*=\s*(.*?)\s*$/);
  if (!match) return;
  const key = { VISION_BASE_URL: 'baseUrl', VISION_API_KEY: 'apiKey', VISION_MODEL: 'model' }[match[1]];
  config[key] = match[2].replace(/^['"]|['"]$/g, '');
});

if (!config.baseUrl || !config.apiKey || !config.model) {
  throw new Error('Agent Vision Toolkit 配置缺少 VISION_BASE_URL、VISION_API_KEY 或 VISION_MODEL');
}
fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
process.stdout.write('已复制 Agent Vision Toolkit 配置到本项目（Key 未回显）。\n');
