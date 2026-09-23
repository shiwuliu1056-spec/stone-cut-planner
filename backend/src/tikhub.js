'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWechatDecryptTransform, generateWechatKeystream } = require('./wechat-decrypt');
const { isPrivateAddress } = require('./remote');

const DEFAULT_API_ORIGIN = 'https://api.tikhub.dev';
const TIKHUB_API_HOSTS = new Set(['api.tikhub.dev', 'api.tikhub.io']);
const API_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const DOWNLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;

const PLATFORM_CONFIG = Object.freeze({
  wechat_channels: {
    label: '视频号',
    path: '/api/v1/wechat_channels/v2/fetch_video_detail',
  },
  douyin: {
    label: '抖音',
    hosts: ['douyin.com'],
    path: '/api/v1/douyin/app/v3/fetch_one_video_by_share_url',
    parameter: 'share_url',
  },
  xiaohongshu: {
    label: '小红书',
    hosts: ['xiaohongshu.com', 'xhslink.com', 'xhslink.cn'],
    path: '/api/v1/xiaohongshu/app_v2/get_video_note_detail',
    parameter: 'share_text',
  },
  tiktok: {
    label: 'TikTok',
    hosts: ['tiktok.com'],
    path: '/api/v1/tiktok/app/v3/fetch_one_video_by_share_url',
    parameter: 'share_url',
  },
});

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizePlatform(value) {
  const platform = String(value || '').trim().toLowerCase();
  if (!PLATFORM_CONFIG[platform]) throw httpError('请先选择正确的视频平台', 400);
  return platform;
}

function hostMatches(host, allowed) {
  return allowed.some((value) => host === value || host.endsWith(`.${value}`));
}

function configuredTikHubOrigin() {
  const value = String(process.env.TIKHUB_API_ORIGIN || DEFAULT_API_ORIGIN).trim();
  let target;
  try { target = new URL(value); } catch (_) { throw httpError('TikHub 服务地址配置无效', 503); }
  const host = target.hostname.toLowerCase().replace(/\.$/, '');
  if (target.protocol !== 'https:' || target.username || target.password || !TIKHUB_API_HOSTS.has(host)) {
    throw httpError('TikHub 服务地址必须使用官方 HTTPS 域名', 503);
  }
  return `${target.protocol}//${target.host}`;
}

function extractShareUrl(input, platform) {
  const match = String(input || '').match(/https?:\/\/[^\s]+/i);
  if (!match) throw httpError(`请粘贴有效的${PLATFORM_CONFIG[platform].label}分享链接`, 400);
  const raw = match[0].replace(/[，。；;！!）》)\]}>]+$/u, '');
  let target;
  try { target = new URL(raw); } catch (_) { throw httpError('视频分享链接格式无效', 400); }
  const host = target.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || raw.length > 2048) {
    throw httpError('视频分享链接格式无效', 400);
  }
  if (!hostMatches(host, PLATFORM_CONFIG[platform].hosts)) {
    throw httpError(`当前选择的是${PLATFORM_CONFIG[platform].label}，请粘贴对应平台的链接`, 400);
  }
  return target.toString();
}

function extractWechatIdentifier(input) {
  const value = String(input || '').trim();
  if (!value || value.length > 2048) throw httpError('请输入视频号分享链接、视频 ID 或 exportId', 400);
  const validateIdentifier = (name, identifier) => {
    const candidate = String(identifier || '').trim();
    if (name === 'id' && !/^\d{1,30}$/.test(candidate)) {
      throw httpError('视频号视频 ID 必须是纯数字', 400);
    }
    if (name === 'exportId' && (!candidate.startsWith('export/') || candidate.length > 2048 || /\s/.test(candidate))) {
      throw httpError('视频号 exportId 必须以 export/ 开头', 400);
    }
    return { name, value: candidate };
  };
  const urlMatch = value.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) {
    try {
      const raw = urlMatch[0].replace(/[，。；;！!）》)\]}>]+$/u, '');
      const target = new URL(raw);
      const host = target.hostname.toLowerCase().replace(/\.$/, '');
      if (target.protocol !== 'https:' || target.username || target.password || target.port) {
        throw httpError('视频号分享链接格式无效', 400);
      }
      const shortLink = target.pathname.match(/^\/sph\/[A-Za-z0-9_-]{4,512}\/?$/);
      if (hostMatches(host, ['weixin.qq.com']) && shortLink) return { name: 'shareUrl', value: target.toString() };
      if (!hostMatches(host, ['channels.weixin.qq.com'])) {
        throw httpError('当前选择的是视频号，请粘贴对应平台的链接', 400);
      }
      const exportId = target.searchParams.get('exportId') || target.searchParams.get('exportid');
      const id = target.searchParams.get('id');
      if (exportId) return validateIdentifier('exportId', exportId);
      if (id) return validateIdentifier('id', id);
      throw httpError('请粘贴 weixin.qq.com/sph/ 视频号分享链接', 400);
    } catch (error) {
      if (error && error.statusCode) throw error;
      throw httpError('视频号分享链接格式无效', 400);
    }
  }
  const named = value.match(/^(exportId|id)\s*[:=]\s*(\S+)$/i);
  if (named) return validateIdentifier(named[1].toLowerCase() === 'id' ? 'id' : 'exportId', named[2]);
  return validateIdentifier(/^\d+$/.test(value) ? 'id' : 'exportId', value);
}

function buildTikHubRequest(input, selectedPlatform) {
  const platform = normalizePlatform(selectedPlatform);
  const config = PLATFORM_CONFIG[platform];
  const endpoint = new URL(config.path, configuredTikHubOrigin());
  let requestOptions;
  if (platform === 'wechat_channels') {
    const identifier = extractWechatIdentifier(input);
    const parameter = identifier.name === 'shareUrl' ? 'share_url'
      : identifier.name === 'exportId' ? 'export_id' : 'object_id';
    requestOptions = { method: 'POST', body: { raw: false, [parameter]: identifier.value } };
  } else {
    endpoint.searchParams.set(config.parameter, extractShareUrl(input, platform));
  }
  return { endpoint, platform, platformLabel: config.label, requestOptions };
}

function requestTikHubJson(target, apiKey, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? Buffer.from(JSON.stringify(options.body)) : null;
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'BaosongToolbox/1.0',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = body.length;
    }
    const request = https.request(target, {
      method: options.method || 'GET',
      headers: {
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      response.on('data', (chunk) => {
        if (tooLarge) return;
        size += chunk.length;
        if (size > API_MAX_BYTES) {
          tooLarge = true;
          response.destroy();
          reject(httpError('视频解析服务返回内容过大', 502));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (tooLarge) return;
        if (response.statusCode === 400 || response.statusCode === 422) {
          reject(httpError('视频分享链接参数无效', 400));
          return;
        }
        if (response.statusCode === 401 || response.statusCode === 403) {
          reject(httpError('视频解析服务授权失败', 503));
          return;
        }
        if (response.statusCode === 402) {
          reject(httpError('视频解析服务余额不足', 503));
          return;
        }
        if (response.statusCode === 429) {
          reject(httpError('视频解析请求过于频繁，请稍后重试', 429));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(httpError('视频解析服务暂时不可用', 502));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (_) {
          reject(httpError('视频解析服务返回格式异常', 502));
        }
      });
      response.on('error', () => {
        if (!tooLarge) reject(httpError('视频解析服务连接失败', 502));
      });
    });
    request.setTimeout(60000, () => request.destroy());
    request.on('error', () => reject(httpError('视频解析服务连接失败', 502)));
    request.end(body || undefined);
  });
}

function firstMediaUrl(candidate, allowHttp = false) {
  const list = typeof candidate === 'string' ? [candidate]
    : Array.isArray(candidate) ? candidate
      : candidate && typeof candidate === 'object' ? [
        ...(Array.isArray(candidate.url_list) ? candidate.url_list : []),
        ...(Array.isArray(candidate.urlList) ? candidate.urlList : []),
        ...(Array.isArray(candidate.UrlList) ? candidate.UrlList : []),
        candidate.url, candidate.master_url, candidate.masterUrl,
        candidate.playback_url, candidate.video_url, candidate.videoUrl,
      ] : [];
  for (const value of list) {
    try {
      const target = new URL(String(value || ''));
      if (target.protocol === 'https:' || allowHttp && target.protocol === 'http:') return target.toString();
    } catch (_) { /* 继续尝试下一个地址 */ }
  }
  return '';
}

function shortVideoDetail(data) {
  const roots = [data, data && data.data, data && data.data && data.data.data];
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    const detail = root.aweme_detail
      || (Array.isArray(root.aweme_details) && root.aweme_details[0])
      || (Array.isArray(root.aweme_list) && root.aweme_list[0]);
    if (detail) return detail;
  }
  return data;
}

function xiaohongshuNoteType(data) {
  const nested = data && data.data;
  const roots = [
    data && data.note, data && data.note_info,
    nested && nested.note, nested && nested.note_info,
    nested, data,
  ];
  for (const root of roots) {
    const value = String(root && (root.type || root.note_type) || '').toLowerCase();
    if (value === 'video' || value === 'normal') return value;
  }
  return '';
}

function videoResponseShape(response, platform) {
  const data = response && response.data;
  const detail = platform === 'douyin' || platform === 'tiktok' ? shortVideoDetail(data) : null;
  const mediaFields = [];
  const seen = new Set();
  function visit(value, path, depth) {
    if (depth > 12 || mediaFields.length >= 30 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (!/(video|play|download|stream|master)/i.test(path)) return;
      const kind = /^https:\/\//i.test(value) ? 'https-url'
        : /^http:\/\//i.test(value) ? 'http-url' : 'other-string';
      mediaFields.push({ path, kind });
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 4).forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue;
      visit(child, `${path}.${key}`, depth + 1);
      if (mediaFields.length >= 30) break;
    }
  }
  visit(data, 'data', 0);
  return {
    platform,
    apiCode: Number(response && response.code) || 0,
    hasNestedData: Boolean(data && data.data && typeof data.data === 'object'),
    hasShortVideoDetail: Boolean(detail && detail !== data),
    shortVideoType: detail && detail.aweme_type !== undefined
      && Number.isInteger(Number(detail.aweme_type)) ? Number(detail.aweme_type) : null,
    hasShortVideoField: Boolean(detail && detail.video),
    xiaohongshuNoteType: xiaohongshuNoteType(data),
    mediaFields,
  };
}

function responseData(response) {
  const code = Number(response && response.code);
  if (code === 401 || code === 403) throw httpError('视频解析服务授权失败', 503);
  if (code === 402) throw httpError('视频解析服务余额不足', 503);
  if (code === 429) throw httpError('视频解析请求过于频繁，请稍后重试', 429);
  if (code === 400 || code === 422) throw httpError('视频分享链接参数无效', 400);
  if (code >= 500 || !response) throw httpError('视频解析服务暂时不可用', 502);
  if (code !== 200 || !response.data) throw httpError('未能解析该视频，请检查链接后重试', 400);
  return response.data;
}

function shortVideoUnavailableReason(data) {
  const detail = shortVideoDetail(data);
  const filters = [
    ...(Array.isArray(data && data.filter_list) ? data.filter_list : []),
    ...(Array.isArray(detail && detail.filter_list) ? detail.filter_list : []),
  ];
  const reason = Number(filters[0] && filters[0].reason);
  if (reason === 5 || reason === 10) return '该作品是私密或部分可见内容，无法解析';
  if (reason === 8) return '该作品已删除、不可用或受地区限制';
  if (data && data.filter_detail || detail && detail.filter_detail) return '该作品已删除、不可用或访问受限';
  return '';
}

function normalizeShortVideo(data) {
  const unavailable = shortVideoUnavailableReason(data);
  if (unavailable) throw httpError(unavailable, 400);
  const detail = shortVideoDetail(data);
  const video = detail && detail.video;
  const hasImages = detail && ((Array.isArray(detail.image_infos) && detail.image_infos.length > 0)
    || (Array.isArray(detail.images) && detail.images.length > 0));
  if (Number(detail && detail.aweme_type) === 68 || (!video && hasImages)) {
    throw httpError('该作品被上游标记为图文，没有可下载的视频或语音', 400);
  }
  if (!video) throw httpError('上游返回的作品数据没有视频媒体字段', 502);
  const bitrate = Array.isArray(video.bit_rate) ? [...video.bit_rate].sort((a, b) => Number(b.bit_rate || 0) - Number(a.bit_rate || 0)) : [];
  const candidates = [
    video.download_no_watermark_addr, video.downloadNoWatermarkAddr,
    video.play_addr_h264, video.playAddrH264,
    video.play_addr, video.playAddr,
    ...bitrate.map((item) => item && (item.play_addr || item.playAddr)),
    video.play_addr_265, video.playAddr265,
  ];
  const videoUrl = candidates.map((candidate) => firstMediaUrl(candidate)).find(Boolean) || '';
  if (!videoUrl) throw httpError('上游返回的视频数据没有可用的 HTTPS 视频地址', 502);
  return {
    durationMs: Math.max(0, Number(video.duration) || 0),
    videoUrl,
  };
}

function collectVideoUrls(root) {
  const found = [];
  const seen = new Set();
  function visit(value, path, parent, depth) {
    if (depth > 12 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const url = firstMediaUrl(value, true);
      if (!url) return;
      const normalized = path.toLowerCase();
      if (/(avatar|thumbnail|cover|poster|image|photo|music|audio|subtitle|caption|share_info)/.test(normalized)) return;
      if (!/(video|play|download|stream|master_url|origin_video)/.test(normalized)) return;
      const score = (/(origin|original|master_url|download)/.test(normalized) ? 1e12 : 0)
        + (Number(parent && parent.height) || 0) * 1e6
        + (Number(parent && parent.width) || 0) * 1e3
        + (Number(parent && (parent.bitrate || parent.bit_rate)) || 0);
      found.push({ score, url });
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, parent, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`, value, depth + 1);
  }
  visit(root, 'data', null, 0);
  return found.sort((a, b) => b.score - a.score);
}

function findDurationMs(root) {
  const seen = new Set();
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 10) return 0;
    seen.add(value);
    for (const key of ['duration_ms', 'duration_millis', 'video_duration', 'duration']) {
      const number = Number(value[key]);
      if (Number.isFinite(number) && number > 0) {
        return /_ms$|millis/i.test(key) || number >= 1000 ? Math.round(number) : Math.round(number * 1000);
      }
    }
    for (const child of Object.values(value)) {
      const result = visit(child, depth + 1);
      if (result) return result;
    }
    return 0;
  }
  return visit(root, 0);
}

function normalizeXiaohongshu(data) {
  const candidates = collectVideoUrls(data);
  if (!candidates.length && xiaohongshuNoteType(data) === 'normal') {
    throw httpError('该笔记被上游标记为图文，没有可下载的视频或语音', 400);
  }
  if (!candidates.length) throw httpError('上游返回的笔记数据未识别到视频地址', 502);
  return { durationMs: findDurationMs(data), videoUrl: candidates[0].url };
}

function findWechatMedia(root, seen = new Set(), depth = 0) {
  if (!root || typeof root !== 'object' || seen.has(root) || depth > 10) return null;
  seen.add(root);
  if (!Array.isArray(root) && root.url && (root.decode_key || root.decodeKey)) return root;
  const values = Array.isArray(root) ? root : Object.values(root);
  for (const value of values) {
    const found = findWechatMedia(value, seen, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeWechatChannels(data) {
  const media = findWechatMedia(data);
  if (!media) throw httpError('该视频号作品没有可用的视频地址', 400);
  const baseUrl = String(media.url || '');
  const token = String(media.url_token || media.urlToken || '');
  const candidate = String(media.full_url || media.fullUrl || `${baseUrl}${token}`);
  let videoUrl = '';
  try {
    const target = new URL(candidate);
    if (target.protocol === 'http:') target.protocol = 'https:';
    if (target.protocol === 'https:') videoUrl = target.toString();
  } catch (_) { /* 统一返回用户可读错误 */ }
  if (!videoUrl) throw httpError('该视频号作品的下载地址无效', 400);
  const duration = Math.max(0, Number(media.duration_ms || media.duration) || 0);
  return {
    decodeKey: String(media.decode_key || media.decodeKey),
    durationMs: duration > 0 && duration < 1000 ? Math.round(duration * 1000) : Math.round(duration),
    videoUrl,
  };
}

function normalizeTikHubResponse(response, platform = 'douyin') {
  const data = responseData(response);
  if (platform === 'douyin' || platform === 'tiktok') return normalizeShortVideo(data);
  if (platform === 'xiaohongshu') return normalizeXiaohongshu(data);
  if (platform === 'wechat_channels') return normalizeWechatChannels(data);
  throw httpError('当前平台暂不支持', 400);
}

async function parseVideo(input, platformValue, options = {}) {
  const platform = normalizePlatform(platformValue);
  const { endpoint, platformLabel, requestOptions } = buildTikHubRequest(input, platform);
  const apiKey = String(options.apiKey || process.env.TIKHUB_API_KEY || '').trim();
  if (!apiKey) throw httpError('视频解析服务尚未配置', 503);
  const response = await (options.requestJson || requestTikHubJson)(endpoint, apiKey, requestOptions);
  try {
    return { ...normalizeTikHubResponse(response, platform), platform, platformLabel };
  } catch (error) {
    if (process.env.VIDEO_PARSE_DIAGNOSTICS === '1') {
      process.stderr.write(`[TikHub media shape] ${JSON.stringify(videoResponseShape(response, platform))}\n`);
    }
    throw error;
  }
}

function signingSecret(secret) {
  const value = String(secret || process.env.TIKHUB_API_KEY || '').trim();
  if (!value) throw httpError('视频下载服务尚未配置', 503);
  return value;
}

function createDownloadToken(video, options = {}) {
  const now = Number(options.now || Date.now());
  const key = crypto.createHash('sha256').update(signingSecret(options.secret)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const descriptor = typeof video === 'string' ? { url: video } : {
    url: String(video && (video.url || video.videoUrl) || ''),
    platform: String(video && video.platform || ''),
    decodeKey: String(video && video.decodeKey || ''),
  };
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ ...descriptor, expiresAt: now + DOWNLOAD_TOKEN_TTL_MS }), 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
}

function verifyDownloadToken(token, options = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((item) => !item)) throw httpError('视频下载链接无效', 403);
  let parsed;
  try {
    const [ivValue, encryptedValue, tagValue] = parts;
    const key = crypto.createHash('sha256').update(signingSecret(options.secret)).digest();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]);
    parsed = JSON.parse(decrypted.toString('utf8'));
  } catch (_) {
    throw httpError('视频下载链接无效', 403);
  }
  const now = Number(options.now || Date.now());
  if (!parsed.url || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now || parsed.expiresAt > now + DOWNLOAD_TOKEN_TTL_MS + 60000) {
    throw httpError('视频下载链接已过期，请重新解析', 403);
  }
  if (parsed.decodeKey || parsed.platform) {
    return { url: String(parsed.url), platform: String(parsed.platform || ''), decodeKey: String(parsed.decodeKey || '') };
  }
  return String(parsed.url);
}

async function validatePublicVideoUrl(value, platform = '') {
  let target;
  try { target = new URL(String(value || '')); } catch (_) { throw httpError('视频地址无效', 400); }
  const allowHttp = platform === 'xiaohongshu';
  if ((target.protocol !== 'https:' && !(allowHttp && target.protocol === 'http:'))
    || target.username || target.password || target.port) throw httpError('视频地址无效', 400);
  const addresses = await dns.lookup(target.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw httpError('视频地址不安全', 400);
  return target;
}

function videoRequestClient(target) {
  return target.protocol === 'http:' ? http : https;
}

function createVideoSizeLimitTransform() {
  let received = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > VIDEO_MAX_BYTES) {
        callback(httpError('视频文件过大，暂不支持文案解析', 413));
        return;
      }
      callback(null, chunk);
    },
  });
}

async function openVideoResponse(descriptor, options = {}, redirectsLeft = 4) {
  const target = await validatePublicVideoUrl(descriptor.url, descriptor.platform);
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Mozilla/5.0 BaosongToolbox/1.0', 'Accept-Encoding': 'identity' };
    if (descriptor.platform === 'wechat_channels') headers.Referer = 'https://channels.weixin.qq.com/';
    const request = videoRequestClient(target).get(target, { headers }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(httpError('视频下载重定向过多', 502));
          return;
        }
        const next = new URL(response.headers.location, target).toString();
        openVideoResponse({ ...descriptor, url: next }, options, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(httpError('视频文件暂时无法下载', 502));
        return;
      }
      const declaredSize = Number(response.headers['content-length']) || 0;
      if (declaredSize > VIDEO_MAX_BYTES) {
        response.resume();
        reject(httpError('视频文件过大，暂不支持文案解析', 413));
        return;
      }
      resolve(response);
    });
    request.setTimeout(Number(options.timeoutMs) || 120000, () => request.destroy());
    request.on('error', () => reject(httpError('视频文件下载失败', 502)));
  });
}

async function downloadVideoToFile(value, destination, options = {}) {
  const descriptor = typeof value === 'string' ? { url: value, platform: '', decodeKey: '' } : {
    url: String(value && (value.url || value.videoUrl) || ''),
    platform: String(value && value.platform || ''),
    decodeKey: String(value && value.decodeKey || ''),
  };
  const keystream = descriptor.decodeKey ? await generateWechatKeystream(descriptor.decodeKey) : null;
  const response = await openVideoResponse(descriptor, options);
  const streams = [response];
  if (keystream) streams.push(createWechatDecryptTransform(keystream));
  streams.push(createVideoSizeLimitTransform(), fs.createWriteStream(destination, { flags: 'wx' }));
  try {
    await pipeline(...streams);
  } catch (error) {
    if (error && error.statusCode) throw error;
    throw httpError('视频文件下载失败', 502);
  }
}

async function streamVideo(value, res, options = {}, redirectsLeft = 4) {
  const descriptor = typeof value === 'string' ? { url: value, platform: '', decodeKey: '' } : {
    url: String(value && value.url || ''),
    platform: String(value && value.platform || ''),
    decodeKey: String(value && value.decodeKey || ''),
  };
  const target = await validatePublicVideoUrl(descriptor.url, descriptor.platform);
  const keystream = descriptor.decodeKey ? await generateWechatKeystream(descriptor.decodeKey) : null;
  return new Promise((resolve, reject) => {
    const requestHeaders = { 'User-Agent': 'Mozilla/5.0 BaosongToolbox/1.0', 'Accept-Encoding': 'identity' };
    if (descriptor.platform === 'wechat_channels') requestHeaders.Referer = 'https://channels.weixin.qq.com/';
    if (typeof options.range === 'string' && /^bytes=\d*-\d*$/.test(options.range)) requestHeaders.Range = options.range;
    const request = videoRequestClient(target).get(target, { headers: requestHeaders }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) { reject(httpError('视频下载重定向过多', 502)); return; }
        const next = new URL(response.headers.location, target).toString();
        streamVideo({ ...descriptor, url: next }, res, options, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        response.resume();
        reject(httpError('视频文件暂时无法下载', 502));
        return;
      }
      const declaredSize = Number(response.headers['content-length']) || 0;
      const contentRange = String(response.headers['content-range'] || '');
      const totalMatch = contentRange.match(/\/(\d+)$/);
      const totalSize = totalMatch ? Number(totalMatch[1]) : declaredSize;
      if (totalSize > VIDEO_MAX_BYTES) {
        response.resume();
        reject(httpError('视频文件过大，暂不支持保存', 413));
        return;
      }
      const headers = {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'inline; filename="baosong-video.mp4"',
        'Cache-Control': 'private, no-store',
      };
      if (declaredSize) headers['Content-Length'] = declaredSize;
      if (contentRange) headers['Content-Range'] = contentRange;
      if (response.headers['accept-ranges']) headers['Accept-Ranges'] = response.headers['accept-ranges'];
      res.writeHead(response.statusCode, headers);
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > VIDEO_MAX_BYTES) {
          response.destroy();
          res.destroy();
        }
      });
      response.on('error', () => res.destroy());
      response.on('end', resolve);
      if (keystream) {
        const rangeStart = Number((contentRange.match(/^bytes (\d+)-/i) || [])[1] || 0);
        response.pipe(createWechatDecryptTransform(keystream, rangeStart)).pipe(res);
      } else {
        response.pipe(res);
      }
    });
    request.setTimeout(30000, () => request.destroy());
    request.on('error', () => reject(httpError('视频文件下载失败', 502)));
  });
}

module.exports = {
  buildTikHubRequest,
  createDownloadToken,
  downloadVideoToFile,
  extractShareUrl,
  extractWechatIdentifier,
  normalizeTikHubResponse,
  parseVideo,
  streamVideo,
  validatePublicVideoUrl,
  videoResponseShape,
  verifyDownloadToken,
};
