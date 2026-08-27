'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function requestJson(hostname, path, body, apiKey, authMode = 'gemini') {
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (authMode === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  else headers['x-goog-api-key'] = apiKey;

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname,
      path,
      method: 'POST',
      headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data;
        try { data = JSON.parse(text); } catch (_) { data = null; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = data?.error?.message || `Gemini 返回 HTTP ${response.statusCode}`;
          const error = new Error(message);
          error.statusCode = response.statusCode === 429 ? 503 : 502;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    request.on('error', (error) => {
      const wrapped = new Error(`无法连接视觉识别服务：${error.message}`);
      wrapped.statusCode = 502;
      reject(wrapped);
    });
    request.setTimeout(60000, () => {
      const error = new Error('视觉识别请求超时');
      error.statusCode = 504;
      request.destroy(error);
    });
    request.write(body);
    request.end();
  });
}

function requestVisionApi(baseUrl, body, apiKey) {
  let target;
  try { target = new URL(`${baseUrl.replace(/\/$/, '')}/chat/completions`); } catch (_) {
    const error = new Error('VISION_BASE_URL 配置无效');
    error.statusCode = 503;
    throw error;
  }
  return requestJson(target.hostname, `${target.pathname}${target.search}`, body, apiKey, 'bearer');
}

function requestLayoutParsing(baseUrl, body, apiKey) {
  let target;
  try { target = new URL(`${baseUrl.replace(/\/$/, '')}/layout_parsing`); } catch (_) {
    const error = new Error('VISION_BASE_URL 配置无效');
    error.statusCode = 503;
    throw error;
  }
  return requestJson(target.hostname, `${target.pathname}${target.search}`, body, apiKey, 'bearer');
}

function readVisionConfig() {
  let fileConfig = {};
  const configPath = path.resolve(__dirname, '..', '..', 'vision-config.json');
  try { fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_) { /* 允许只使用环境变量 */ }
  if (!fileConfig.baseUrl || !fileConfig.apiKey || !fileConfig.model) {
    const envPath = process.env.VISION_ENV_FILE
      || path.join(os.homedir(), '.config', 'agent-vision-toolkit', 'env');
    try {
      fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*(VISION_BASE_URL|VISION_API_KEY|VISION_MODEL)\s*=\s*(.*?)\s*$/);
        if (match && !process.env[match[1]]) fileConfig[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      });
    } catch (_) { /* 配置文件不存在时由下方错误提示说明 */ }
  }
  return {
    baseUrl: String(process.env.VISION_BASE_URL || fileConfig.baseUrl || '').trim(),
    apiKey: String(process.env.VISION_API_KEY || fileConfig.apiKey || '').trim(),
    model: String(process.env.VISION_MODEL || fileConfig.model || '').trim(),
  };
}

function parseImageDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:jpeg|jpg|png|webp|heic|heif));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) {
    const error = new Error('图片格式不支持，请使用 JPG、PNG 或 WebP');
    error.statusCode = 400;
    throw error;
  }
  const image = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!image.length || image.length > MAX_IMAGE_BYTES) {
    const error = new Error('图片过大，请压缩到 15 MB 以内');
    error.statusCode = 413;
    throw error;
  }
  return { mimeType: match[1].toLowerCase(), data: image.toString('base64') };
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = Math.min(...[raw.indexOf('['), raw.indexOf('{')].filter((n) => n >= 0));
  const candidate = start >= 0 ? raw.slice(start) : raw;
  try { return JSON.parse(candidate); } catch (_) {
    const arrayEnd = candidate.lastIndexOf(']');
    if (arrayEnd >= 0) return JSON.parse(candidate.slice(0, arrayEnd + 1));
    const objectEnd = candidate.lastIndexOf('}');
    if (objectEnd >= 0) return JSON.parse(candidate.slice(0, objectEnd + 1));
    throw new Error('视觉模型没有返回合法的识别结果');
  }
}

function toMillimeters(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(unit === 'cm' ? number * 10 : number);
}

function parseTranscribedParts(text, unit) {
  const normalized = String(text || '')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[ｘＸ×✕✖]/g, 'x')
    .replace(/\\times/g, 'x')
    .replace(/(?<=\d)\s*[+]\s*(?=\d)/g, 'x')
    .replace(/(?<=\d)[ \t]+(?=\d)/g, '')
    .replace(/(?<=\d)\s*\.\s*(?=\d)/g, '.')
    .replace(/[＝﹦]/g, '=')
    .replace(/[－﹣–—]/g, '-')
    .replace(/[，、]/g, ',');
  // 手写修改痕迹可能呈现为“180×35-8=4”：优先取最终等号后的数量，
  // 仅在没有等号时才把短横线后的数字视为数量。
  const finalQuantityPattern = /([A-Za-z\u4e00-\u9fff][A-Za-z0-9_-]*)?\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:=|:|至)\s*(\d+(?:[.,]\d+)?)/g;
  const simplePattern = /([A-Za-z\u4e00-\u9fff][A-Za-z0-9_-]*)?\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/g;
  const parts = [];
  normalized.split(/\r?\n/).forEach((line) => {
    let match;
    while ((match = finalQuantityPattern.exec(line)) !== null) {
      const w = toMillimeters(String(match[2]).replace(',', '.'), unit);
      const h = toMillimeters(String(match[3]).replace(',', '.'), unit);
      const qty = Number(String(match[4]).replace(',', '.'));
      if (w && h && Number.isInteger(qty) && qty > 0) {
        parts.push({ id: String(match[1] || '').trim(), w, h, qty });
      }
    }
    finalQuantityPattern.lastIndex = 0;
    if (!/\s[=:至]\s*/.test(line)) {
      while ((match = simplePattern.exec(line)) !== null) {
        const w = toMillimeters(String(match[2]).replace(',', '.'), unit);
        const h = toMillimeters(String(match[3]).replace(',', '.'), unit);
        const qty = Number(String(match[4]).replace(',', '.'));
        if (w && h && Number.isInteger(qty) && qty > 0) {
          parts.push({ id: String(match[1] || '').trim(), w, h, qty });
        }
      }
    }
    simplePattern.lastIndex = 0;
  });
  return parts;
}

function normalizeParts(payload, unit) {
  const rows = Array.isArray(payload) ? payload : payload && (payload.parts || payload.items || payload.rows);
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const w = toMillimeters(row.w ?? row.width ?? row.length, unit);
    const h = toMillimeters(row.h ?? row.height ?? row.width, unit);
    const qty = Number(row.qty ?? row.quantity ?? row.count);
    if (!w || !h || !Number.isInteger(qty) || qty <= 0) return null;
    return { id: String(row.id || row.code || '').trim(), w, h, qty };
  }).filter(Boolean);
}

async function recognizePhoto({ image, unit = 'mm' }) {
  const vision = readVisionConfig();
  if (vision.baseUrl && vision.apiKey && vision.model) {
    return recognizeWithVisionToolkit({ image, unit, ...vision });
  }
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('未配置视觉识别服务，请设置 VISION_BASE_URL、VISION_API_KEY、VISION_MODEL（Agent Vision Toolkit）或 GEMINI_API_KEY');
    error.statusCode = 503;
    throw error;
  }
  const safeUnit = unit === 'cm' ? 'cm' : 'mm';
  const imageData = parseImageDataUrl(image);
  const model = String(process.env.GEMINI_OCR_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const prompt = [
    '请识别这张照片中的小料尺寸记录。照片可能是手写、倾斜或有横线背景。',
    '每条记录通常是“长度 × 宽度 = 数量”，也可能使用 x、*、-、: 作为分隔符。',
    `用户选择的尺寸单位是 ${safeUnit}，请按这个单位读取长度和宽度，不要自行猜测单位。`,
    '只返回 JSON，不要 Markdown，不要解释。格式为：{"text":"识别到的原文","parts":[{"id":"","w":0,"h":0,"qty":0}]}。',
    '无法确认的行不要猜，直接省略；qty 必须是正整数。',
  ].join('\n');
  const requestBody = JSON.stringify({
    contents: [{ parts: [
      { text: prompt },
      { inlineData: { mimeType: imageData.mimeType, data: imageData.data } },
    ] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  const response = await requestJson(
    'generativelanguage.googleapis.com',
    `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    requestBody,
    apiKey,
  );
  const text = response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  const parsed = extractJson(text);
  return { text, parts: normalizeParts(parsed, safeUnit), model };
}

async function recognizeWithVisionToolkit({ image, unit, baseUrl, apiKey, model }) {
  const ocrBody = JSON.stringify({ model: 'glm-ocr', file: image });
  const ocrResponse = await requestLayoutParsing(baseUrl, ocrBody, apiKey);
  const layoutResultText = layoutText(ocrResponse);
  const ocrParts = parseTranscribedParts(layoutResultText, unit);
  if (ocrParts.length > 0) {
    return { text: layoutResultText, parts: ocrParts, model: 'glm-ocr', provider: 'agent-vision-toolkit' };
  }

  // 布局接口未返回可解析行时，保留通用视觉接口作为兜底。
  const prompt = [
    'Transcribe every piece of visible text in this image verbatim (titles, body text, labels, watermarks, etc.), line by line, without omitting any characters.',
    'Do not rewrite, summarize, or translate the text, and do not add any preamble, explanation, or extra content.',
    'Additional requirements: preserve every repeated size row exactly as written; do not merge rows or infer missing digits.',
    'The quantity is the original integer written after the final equals sign. Never calculate length multiplied by width, and never multiply or divide quantity for unit conversion. Example: 130×5=36 means w=130, h=5, qty=36.',
  ].join('\n');
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: image } },
    ] }],
  });
  const response = await requestVisionApi(baseUrl, body, apiKey);
  const message = response?.choices?.[0]?.message?.content;
  const text = Array.isArray(message)
    ? message.map((part) => part.text || '').join('')
    : String(message || '');
  return { text, parts: parseTranscribedParts(text, unit), model, provider: 'agent-vision-toolkit' };
}

function layoutText(response) {
  const blocks = (response?.layout_details || []).flatMap((page) => page || [])
    .filter((item) => item && typeof item.content === 'string')
    .sort((a, b) => {
      const ay = Number(a.bbox_2d?.[1]) || 0;
      const by = Number(b.bbox_2d?.[1]) || 0;
      const ax = Number(a.bbox_2d?.[0]) || 0;
      const bx = Number(b.bbox_2d?.[0]) || 0;
      return ay - by || ax - bx;
    });
  return blocks.map((item) => String(item.content)
    .replace(/\$\$/g, '')
    .replace(/\\begin\{array\}\{[^}]*\}/g, '')
    .replace(/\\end\{array\}/g, '')
    .replace(/\\\\/g, '\n')
    .replace(/[{}]/g, '')
    .trim()).filter(Boolean).join('\n');
}

module.exports = { recognizePhoto, parseImageDataUrl, normalizeParts, parseTranscribedParts };
