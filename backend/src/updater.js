'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const childProcess = require('child_process');

// 发布新版本时，把服务器上的 update-manifest.json 地址填进这里；
// 也可以在应用同目录放一个 update-config.json（内容 {"url":"https://..."}），
// 改更新地址时不用重新打包。推荐用 update-config.json。
const DEFAULT_UPDATE_URL = '';

let APP_VERSION = '1.0.0';
try { APP_VERSION = require('../package.json').version; } catch (_) { /* ignore */ }

const state = {
  phase: 'idle',      // idle | checking | downloading | applying | error | done
  percent: 0,
  error: '',
};

function isPackaged() {
  return Boolean(process.pkg || process.env.STONE_WIN8_PACKAGE === '1');
}

function appDir() {
  if (process.pkg || process.env.STONE_WIN8_PACKAGE === '1') return path.resolve(__dirname, '..', '..');
  return path.join(__dirname, '..');
}

function resolveConfigPath() {
  return path.join(appDir(), 'update-config.json');
}

function resolveUpdateUrl() {
  const fromEnv = (process.env.STONE_UPDATER_URL || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const config = JSON.parse(fs.readFileSync(resolveConfigPath(), 'utf8'));
    if (config && typeof config.url === 'string' && config.url.trim()) return config.url.trim();
  } catch (_) { /* 没有配置文件就使用内置地址 */ }
  return DEFAULT_UPDATE_URL.trim();
}

function compareVersions(a, b) {
  const parse = (value) => String(value).split('.').map((part) => {
    const n = parseInt(part, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  const left = parse(a), right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] || 0, r = right[i] || 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

function requestText(url, { timeoutMs = 15000, redirectsLeft = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { reject(new Error('更新地址无效')); return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error('更新地址仅支持 http/https')); return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(requestText(next, { timeoutMs, redirectsLeft: redirectsLeft - 1 }));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`服务器返回 ${status}`)); return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
      res.setTimeout(timeoutMs, () => req.destroy(new Error('连接超时')));
    });
    req.on('error', (error) => reject(new Error(`无法连接更新服务器：${error.message}`)));
    req.setTimeout(timeoutMs, () => req.destroy(new Error('连接超时')));
  });
}

async function requestJson(url, options) {
  const text = await requestText(url, options);
  try { return JSON.parse(text); } catch (_) { throw new Error('更新清单不是有效的 JSON'); }
}

function sanitizeSha256(value) {
  return String(value || '').trim().toLowerCase();
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function downloadToFile(url, destPath, onProgress, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (_) { reject(new Error('下载地址无效')); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const hash = crypto.createHash('sha256');
    const req = client.get(parsed, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(downloadToFile(next, destPath, onProgress, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`下载失败：服务器返回 ${status}`)); return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let received = 0;
      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        hash.update(chunk);
        out.write(chunk);
        if (total && onProgress) onProgress(Math.min(100, Math.round((received / total) * 100)));
      });
      res.on('end', () => {
        out.end(() => resolve(hash.digest('hex')));
      });
      res.on('error', (error) => { out.destroy(); fs.unlink(destPath, () => {}); reject(error); });
      out.on('error', (error) => { res.destroy(); reject(error); });
      req.setTimeout(60000, () => req.destroy(new Error('下载超时，请检查网络')));
    });
    req.on('error', (error) => { fs.unlink(destPath, () => {}); reject(new Error(`下载失败：${error.message}`)); });
  });
}

async function checkForUpdate() {
  const url = resolveUpdateUrl();
  const base = { configured: Boolean(url), supported: isPackaged(), currentVersion: APP_VERSION, update: null };
  if (!url) return { ...base, error: '未配置更新地址' };
  state.phase = 'checking';
  try {
    const manifest = await requestJson(url);
    if (!manifest || typeof manifest.version !== 'string' || typeof manifest.url !== 'string') {
      return { ...base, error: '更新清单格式不正确' };
    }
    const available = compareVersions(manifest.version, APP_VERSION) > 0;
    return {
      ...base,
      update: available
        ? {
          version: manifest.version,
          url: manifest.url,
          sha256: sanitizeSha256(manifest.sha256),
          notes: manifest.notes || '',
        }
        : null,
    };
  } catch (error) {
    return { ...base, error: error.message };
  } finally {
    state.phase = 'idle';
  }
}

async function startApply(onApplied) {
  if (!isPackaged()) throw new Error('当前为开发模式，不支持在线更新');
  const url = resolveUpdateUrl();
  if (!url) throw new Error('未配置更新地址');

  const manifest = await requestJson(url);
  if (!manifest || typeof manifest.version !== 'string' || typeof manifest.url !== 'string') {
    throw new Error('更新清单格式不正确');
  }
  if (compareVersions(manifest.version, APP_VERSION) <= 0) throw new Error('当前已是最新版本');

  state.phase = 'downloading';
  state.percent = 0;
  state.error = '';

  const extension = process.env.STONE_WIN8_PACKAGE === '1' ? 'zip' : 'exe';
  const tmpUpdate = path.join(os.tmpdir(), `stone-planner-update-${manifest.version}-${process.pid}.${extension}`);
  try {
    const actualSha256 = await downloadToFile(manifest.url, tmpUpdate, (percent) => { state.percent = percent; });
    const expectedSha256 = sanitizeSha256(manifest.sha256);
    if (expectedSha256 && actualSha256 !== expectedSha256) {
      fs.unlink(tmpUpdate, () => {});
      throw new Error('下载文件校验失败，已取消更新');
    }
  } catch (error) {
    state.phase = 'error';
    state.error = error.message;
    throw error;
  }

  state.phase = 'applying';
  state.percent = 100;
  if (process.env.STONE_WIN8_PACKAGE === '1') {
    const helper = path.join(appDir(), 'backend', 'update-helper.js');
    const worker = childProcess.spawn(process.execPath, [helper, '--apply-zip', tmpUpdate, appDir()], {
      cwd: appDir(), detached: true, stdio: 'ignore',
    });
    worker.unref();
  }
  setTimeout(() => {
    try { onApplied && onApplied(); } catch (_) { /* ignore */ }
  }, 800);
}

function progress() {
  return {
    configured: Boolean(resolveUpdateUrl()),
    supported: isPackaged(),
    currentVersion: APP_VERSION,
    phase: state.phase,
    percent: state.percent,
    error: state.error,
  };
}

function cleanupOnStartup() {
  if (!isPackaged()) return;
  const oldExe = `${process.execPath}.old`;
  try { if (fs.existsSync(oldExe)) fs.unlinkSync(oldExe); } catch (_) { /* ignore */ }
}

module.exports = {
  APP_VERSION,
  isPackaged,
  resolveUpdateUrl,
  compareVersions,
  checkForUpdate,
  startApply,
  progress,
  cleanupOnStartup,
  _internals: { requestText, requestJson, downloadToFile, sha256File },
};
