'use strict';

// 文件用途：调用腾讯云录音文件识别，将视频中的语音转成文字并保护转写任务标识。
const crypto = require('node:crypto');
const fs = require('node:fs').promises;
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ASR_HOST = 'asr.tencentcloudapi.com';
const ASR_VERSION = '2019-06-14';
const TRANSCRIPT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const TRANSCRIPT_MAX_CHARS = 100000;
const LOCAL_AUDIO_MAX_BYTES = 5 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function credentials(options = {}) {
  const secretId = String(options.secretId || process.env.TENCENTCLOUD_SECRET_ID || '').trim();
  const secretKey = String(options.secretKey || process.env.TENCENTCLOUD_SECRET_KEY || '').trim();
  const sessionToken = String(options.sessionToken || process.env.TENCENTCLOUD_SESSION_TOKEN || '').trim();
  if (!secretId || !secretKey) throw httpError('视频语音转写服务尚未配置', 503);
  return { secretId, secretKey, sessionToken };
}

function safeTencentError(payload, fallback) {
  const code = String(payload && payload.Response && payload.Response.Error && payload.Response.Error.Code || '');
  if (/AuthFailure|InvalidCredential|UnauthorizedOperation/i.test(code)) return httpError('视频语音转写服务授权失败', 503);
  if (/FailedOperation.ServiceIsolate|ResourceNotFound/i.test(code)) return httpError('请先在腾讯云开通语音识别服务', 503);
  if (/LimitExceeded|RequestLimitExceeded/i.test(code)) return httpError('视频语音转写请求过于频繁，请稍后重试', 429);
  if (/InvalidParameter|UnsupportedOperation/i.test(code)) return httpError('该视频暂不支持语音转写', 400);
  return httpError(fallback, 502);
}

function requestTencentAsr(action, params, options = {}) {
  const credential = credentials(options);
  const timestamp = Number(options.timestamp || Math.floor(Date.now() / 1000));
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify(params);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${ASR_HOST}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const credentialScope = `${date}/asr/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${credential.secretKey}`, date);
  const secretService = hmac(secretDate, 'asr');
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${credential.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: ASR_HOST,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': ASR_VERSION,
      'X-TC-Region': String(options.region || process.env.TENCENTCLOUD_REGION || 'ap-guangzhou'),
      'Content-Length': Buffer.byteLength(body),
    };
    if (credential.sessionToken) headers['X-TC-Token'] = credential.sessionToken;
    const request = https.request({ hostname: ASR_HOST, method: 'POST', path: '/', headers }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          response.destroy();
          reject(httpError('视频语音转写服务返回内容过大', 502));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {
          reject(httpError('视频语音转写服务返回格式异常', 502));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || payload.Response && payload.Response.Error) {
          reject(safeTencentError(payload, '视频语音转写服务暂时不可用'));
          return;
        }
        resolve(payload.Response || {});
      });
      response.on('error', () => reject(httpError('视频语音转写服务连接失败', 502)));
    });
    request.setTimeout(30000, () => request.destroy());
    request.on('error', () => reject(httpError('视频语音转写服务连接失败', 502)));
    request.end(body);
  });
}

function validateVideoUrl(value) {
  let target;
  try { target = new URL(String(value || '')); } catch (_) { throw httpError('视频地址无效', 400); }
  if (target.protocol !== 'https:' || target.username || target.password) throw httpError('视频地址无效', 400);
  return target.toString();
}

async function createTranscriptTask(videoUrl, options = {}) {
  const response = await (options.requestApi || requestTencentAsr)('CreateRecTask', {
    EngineModelType: String(options.engineModelType || process.env.ASR_ENGINE_MODEL || '16k_zh'),
    ChannelNum: 1,
    ResTextFormat: 2,
    SourceType: 0,
    Url: validateVideoUrl(videoUrl),
    FilterDirty: 0,
    FilterPunc: 0,
    FilterModal: 1,
    ConvertNumMode: 1,
  }, options);
  const taskId = response && response.Data && response.Data.TaskId;
  if (!Number.isSafeInteger(Number(taskId)) || Number(taskId) <= 0) throw httpError('视频语音转写任务创建失败', 502);
  return Number(taskId);
}

async function createTranscriptTaskFromData(audioData, options = {}) {
  const audio = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData || '');
  if (!audio.length) throw httpError('视频中没有可识别的音频', 400);
  if (audio.length > LOCAL_AUDIO_MAX_BYTES) throw httpError('视频语音过长，暂不支持文案解析', 413);
  const response = await (options.requestApi || requestTencentAsr)('CreateRecTask', {
    EngineModelType: String(options.engineModelType || process.env.ASR_ENGINE_MODEL || '16k_zh'),
    ChannelNum: 1,
    ResTextFormat: 2,
    SourceType: 1,
    Data: audio.toString('base64'),
    DataLen: audio.length,
    FilterDirty: 0,
    FilterPunc: 0,
    FilterModal: 1,
    ConvertNumMode: 1,
  }, options);
  const taskId = response && response.Data && response.Data.TaskId;
  if (!Number.isSafeInteger(Number(taskId)) || Number(taskId) <= 0) throw httpError('视频语音转写任务创建失败', 502);
  return Number(taskId);
}

function runFfmpeg(inputPath, outputPath, options = {}) {
  const executable = String(options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg');
  const timeoutMs = Math.max(1000, Number(options.ffmpegTimeoutMs || process.env.FFMPEG_TIMEOUT_MS) || FFMPEG_TIMEOUT_MS);
  const args = [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputPath,
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'libopus', '-b:a', '16k', '-application', 'voip', '-vbr', 'on',
    outputPath,
  ];
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderrBytes = 0;
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; });
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(httpError('视频音频提取超时，请稍后重试', 504));
    }, timeoutMs);
    child.on('error', () => finish(httpError('视频音频提取服务尚未配置', 503)));
    child.on('close', (code) => {
      if (code === 0) finish();
      else finish(httpError(stderrBytes ? '视频中没有可识别的音频' : '视频音频提取失败', 400));
    });
  });
}

async function createLocalAudioTranscriptTask(video, downloadVideoToFile, options = {}) {
  if (typeof downloadVideoToFile !== 'function') throw httpError('视频语音处理服务尚未配置', 503);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'baosong-asr-'));
  const inputPath = path.join(temporaryDirectory, 'video.mp4');
  const outputPath = path.join(temporaryDirectory, 'audio.ogg');
  try {
    await downloadVideoToFile(video, inputPath, { timeoutMs: options.downloadTimeoutMs });
    await (options.runFfmpeg || runFfmpeg)(inputPath, outputPath, options);
    const audio = await fs.readFile(outputPath);
    return await createTranscriptTaskFromData(audio, options);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function createWechatTranscriptTask(descriptor, downloadVideoToFile, options = {}) {
  const video = {
    url: String(descriptor && (descriptor.url || descriptor.videoUrl) || ''),
    platform: String(descriptor && descriptor.platform || ''),
    decodeKey: String(descriptor && descriptor.decodeKey || ''),
  };
  if (video.platform !== 'wechat_channels' || !video.url || !video.decodeKey) {
    throw httpError('视频号解析令牌无效，请重新解析视频', 403);
  }
  return createLocalAudioTranscriptTask(video, downloadVideoToFile, options);
}

async function createXiaohongshuTranscriptTask(descriptor, downloadVideoToFile, options = {}) {
  const video = {
    url: String(descriptor && (descriptor.url || descriptor.videoUrl) || ''),
    platform: String(descriptor && descriptor.platform || ''),
    decodeKey: '',
  };
  if (video.platform !== 'xiaohongshu' || !video.url) {
    throw httpError('小红书解析令牌无效，请重新解析视频', 403);
  }
  return createLocalAudioTranscriptTask(video, downloadVideoToFile, options);
}

function normalizeTranscript(data) {
  const details = Array.isArray(data && data.ResultDetail) ? data.ResultDetail : [];
  const detailText = details.map((item) => String(item && item.FinalSentence || '').trim()).filter(Boolean).join('\n');
  const rawText = detailText || String(data && data.Result || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
  return rawText.trim().slice(0, TRANSCRIPT_MAX_CHARS);
}

async function getTranscriptTask(taskId, options = {}) {
  const numericTaskId = Number(taskId);
  if (!Number.isSafeInteger(numericTaskId) || numericTaskId <= 0) throw httpError('视频语音转写任务无效', 403);
  const response = await (options.requestApi || requestTencentAsr)('DescribeTaskStatus', { TaskId: numericTaskId }, options);
  const data = response && response.Data;
  const status = Number(data && data.Status);
  if (status === 0 || status === 1) return { status: 'pending' };
  if (status === 2) {
    return {
      status: 'succeeded',
      transcript: normalizeTranscript(data),
      audioDurationSec: Math.max(0, Number(data.AudioDuration) || 0),
    };
  }
  if (status === 3) throw httpError('视频语音识别失败，请确认视频中有清晰人声', 502);
  throw httpError('视频语音转写状态异常', 502);
}

function tokenSecret(options = {}) {
  const value = String(options.secret || process.env.TRANSCRIPT_TOKEN_SECRET || process.env.TIKHUB_API_KEY || '').trim();
  if (!value) throw httpError('视频语音转写服务尚未配置', 503);
  return value;
}

function createTranscriptToken(taskId, options = {}) {
  const now = Number(options.now || Date.now());
  const payload = Buffer.from(JSON.stringify({ taskId: Number(taskId), expiresAt: now + TRANSCRIPT_TOKEN_TTL_MS })).toString('base64url');
  const signature = hmac(tokenSecret(options), payload, 'base64url');
  return `${payload}.${signature}`;
}

function verifyTranscriptToken(token, options = {}) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) throw httpError('视频语音转写任务无效', 403);
  const expected = hmac(tokenSecret(options), payload, 'base64url');
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw httpError('视频语音转写任务无效', 403);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) {
    throw httpError('视频语音转写任务无效', 403);
  }
  const now = Number(options.now || Date.now());
  if (!Number.isSafeInteger(Number(parsed.taskId)) || parsed.taskId <= 0 || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) {
    throw httpError('视频语音转写任务已过期，请重新解析', 403);
  }
  return Number(parsed.taskId);
}

module.exports = {
  createTranscriptTask,
  createTranscriptTaskFromData,
  createTranscriptToken,
  createWechatTranscriptTask,
  createXiaohongshuTranscriptTask,
  getTranscriptTask,
  normalizeTranscript,
  requestTencentAsr,
  runFfmpeg,
  verifyTranscriptToken,
};
