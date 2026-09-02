'use strict';

const https = require('https');
const dns = require('dns').promises;

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase();
  if (value.includes(':')) {
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value.startsWith('::ffff:127.') || value.startsWith('::ffff:10.') || value.startsWith('::ffff:192.168.') || value.startsWith('::ffff:172.');
  }
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isTrustedCloudHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host.endsWith('.tcb.qcloud.la')
    || host.endsWith('.tcloudbaseapp.com')
    || /\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(host);
}

function imageMimeFromBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
    if (buffer.length >= 16 && buffer.subarray(4, 8).toString() === 'ftyp') {
      const brand = buffer.subarray(8, 12).toString();
      if (['heic', 'heix', 'hevc', 'hevx', 'heis', 'hevm', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    }
  }
  return '';
}

function downloadHttps(url, maxBytes, timeoutMs = 60000) {
  let target;
  try { target = new URL(String(url || '')); } catch (_) {
    const error = new Error('文件地址无效'); error.statusCode = 400; return Promise.reject(error);
  }
  if (target.protocol !== 'https:') {
    const error = new Error('只允许使用 HTTPS 文件地址'); error.statusCode = 400; return Promise.reject(error);
  }
  if (target.username || target.password || target.port || !isTrustedCloudHost(target.hostname)) {
    const error = new Error('只允许访问 CloudBase 临时文件地址'); error.statusCode = 400; return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeRequest = null;
    let activeResponse = null;
    const overallTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      activeResponse?.destroy();
      activeRequest?.destroy();
      const error = new Error('远程文件下载超时'); error.statusCode = 504; reject(error);
    }, timeoutMs);
    const finish = (callback) => (value) => {
      if (settled) return;
      settled = true; clearTimeout(overallTimer); callback(value);
    };
    const resolveOverall = finish(resolve);
    const rejectOverall = finish(reject);
    dns.lookup(target.hostname, { all: true }).then((addresses) => {
      if (settled) return Promise.reject(Object.assign(new Error('远程文件下载超时'), { statusCode: 504 }));
      if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw Object.assign(new Error('远程文件地址解析到不安全网络'), { statusCode: 400 });
      return new Promise((resolveRequest, rejectRequest) => {
        const request = https.get(target, (response) => {
      activeResponse = response;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        const error = new Error(`远程文件返回 HTTP ${response.statusCode}`); error.statusCode = 400; rejectRequest(error); return;
      }
      const chunks = []; let size = 0; let rejected = false;
      response.on('data', (chunk) => {
        if (rejected) return;
        size += chunk.length;
        if (size > maxBytes) {
          rejected = true; response.destroy();
          const error = new Error('远程文件过大'); error.statusCode = 413; rejectRequest(error); return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (!rejected) resolveRequest({ buffer: Buffer.concat(chunks), contentType: String(response.headers['content-type'] || '').split(';')[0].toLowerCase() });
      });
      response.on('error', (error) => { if (!rejected) rejectRequest(error); });
    });
    activeRequest = request;
    request.setTimeout(timeoutMs, () => request.destroy(new Error('远程文件下载超时')));
    request.on('error', (error) => { const wrapped = new Error(`远程文件下载失败：${error.message}`); wrapped.statusCode = 502; rejectRequest(wrapped); });
      });
    }).then(resolveOverall).catch(rejectOverall);
  });
}

module.exports = { downloadHttps, imageMimeFromBuffer, isPrivateAddress, isTrustedCloudHost };
