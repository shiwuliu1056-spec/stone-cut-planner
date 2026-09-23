'use strict';

// 文件用途：加载微信官方 WASM 密钥流生成器，对视频号加密视频的前 128KB 执行流式 XOR 解密。
const https = require('node:https');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { Transform } = require('node:stream');
const zlib = require('node:zlib');

const WASM_BASE_URL = 'https://aladin.wxqcloud.qq.com/aladin/ffmepeg/video-decode/1.2.46/';
const KEYSTREAM_SIZE = 128 * 1024;
const ASSET_MAX_BYTES = 8 * 1024 * 1024;
const KEYSTREAM_CACHE_MAX = 50;
const ASSET_SHA256 = Object.freeze({
  'wasm_video_decode.js': '78faf7621959e30ba05c0acf7182dd14bcbd7dfe45529476649f39b20e5dbea3',
  'wasm_video_decode.wasm': 'dca796bacec37d8522c7983b3945e5d579bd74164e3b21f0ebc773be6dfc8b6e',
});

let modulePromise = null;
const keystreamCache = new Map();

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function downloadAsset(filename) {
  const target = new URL(filename, WASM_BASE_URL);
  return new Promise((resolve, reject) => {
    const request = https.get(target, { headers: { 'User-Agent': 'BaosongToolbox/1.0' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(httpError('视频号解密组件暂时无法加载', 503));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > ASSET_MAX_BYTES) {
          response.destroy();
          reject(httpError('视频号解密组件大小异常', 503));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const compressed = Buffer.concat(chunks);
          const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
          const content = encoding === 'gzip' ? zlib.gunzipSync(compressed)
            : encoding === 'br' ? zlib.brotliDecompressSync(compressed)
              : encoding === 'deflate' ? zlib.inflateSync(compressed) : compressed;
          if (content.length > ASSET_MAX_BYTES) throw new Error('asset too large');
          const digest = crypto.createHash('sha256').update(content).digest('hex');
          if (digest !== ASSET_SHA256[filename]) throw new Error('asset integrity mismatch');
          resolve(content);
        } catch (_) {
          reject(httpError('视频号解密组件格式异常', 503));
        }
      });
      response.on('error', () => reject(httpError('视频号解密组件下载失败', 503)));
    });
    request.setTimeout(30000, () => request.destroy());
    request.on('error', () => reject(httpError('视频号解密组件下载失败', 503)));
  });
}

async function loadWechatModule(options = {}) {
  if (options.module) return options.module;
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const loadAsset = options.loadAsset || downloadAsset;
    const [javascript, wasm] = await Promise.all([
      loadAsset('wasm_video_decode.js'),
      loadAsset('wasm_video_decode.wasm'),
    ]);
    let generated = null;
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const context = {
      ArrayBuffer,
      clearInterval,
      clearTimeout,
      console: { log() {}, warn() {}, error() {} },
      document: { title: '' },
      fetch,
      MAX_HEAP_SIZE: 33554432,
      performance,
      self: { location: { href: `${WASM_BASE_URL}worker.js` } },
      setInterval,
      setTimeout,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      VTS_WASM_URL: 'wasm_video_decode.wasm',
      WebAssembly,
      Module: {
        wasmBinary: new Uint8Array(wasm),
        onAbort: () => readyReject(httpError('视频号解密组件初始化失败', 503)),
        onRuntimeInitialized: () => readyResolve(),
      },
      wasm_isaac_generate(pointer, size) {
        const source = new Uint8Array(context.Module.HEAPU8.buffer, pointer, size);
        generated = Buffer.from(source).reverse();
      },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(Buffer.from(javascript).toString('utf8'), context, { filename: 'wechat-wasm-video-decode.js' });
    await Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(httpError('视频号解密组件加载超时', 503)), 15000)),
    ]);
    return {
      generate(decodeKey) {
        generated = null;
        const decryptor = new context.Module.WxIsaac64(String(decodeKey));
        try { decryptor.generate(KEYSTREAM_SIZE); } finally { decryptor.delete(); }
        if (!generated || generated.length !== KEYSTREAM_SIZE) throw httpError('视频号解密密钥生成失败', 502);
        return generated;
      },
    };
  })().catch((error) => {
    modulePromise = null;
    throw error;
  });
  return modulePromise;
}

async function generateWechatKeystream(decodeKey, options = {}) {
  const key = String(decodeKey || '').trim();
  if (!/^\d{1,30}$/.test(key)) throw httpError('视频号解密密钥无效', 400);
  if (keystreamCache.has(key)) {
    const cached = keystreamCache.get(key);
    keystreamCache.delete(key);
    keystreamCache.set(key, cached);
    return cached;
  }
  const module = await loadWechatModule(options);
  const keystream = module.generate(key);
  keystreamCache.set(key, keystream);
  if (keystreamCache.size > KEYSTREAM_CACHE_MAX) keystreamCache.delete(keystreamCache.keys().next().value);
  return keystream;
}

function createWechatDecryptTransform(keystream, initialOffset = 0) {
  if (!Buffer.isBuffer(keystream) || keystream.length < KEYSTREAM_SIZE) {
    throw httpError('视频号解密密钥流无效', 500);
  }
  let offset = Math.max(0, Number(initialOffset) || 0);
  return new Transform({
    transform(chunk, encoding, callback) {
      const output = Buffer.from(chunk);
      const end = Math.min(output.length, Math.max(0, KEYSTREAM_SIZE - offset));
      for (let index = 0; index < end; index += 1) output[index] ^= keystream[offset + index];
      offset += output.length;
      callback(null, output);
    },
  });
}

module.exports = {
  KEYSTREAM_SIZE,
  createWechatDecryptTransform,
  generateWechatKeystream,
  loadWechatModule,
};
