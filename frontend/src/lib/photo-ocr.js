import { requestJson } from './api';

const OCR_ROOT = '/ocr';

function normalizeText(value) {
  return String(value || '')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[ｘＸ×✕✖]/g, 'x')
    .replace(/[＝﹦]/g, '=')
    .replace(/[－﹣–—]/g, '-')
    .replace(/[，、]/g, ',');
}

function parseNumber(value) {
  return Number(String(value).replace(',', '.'));
}

function convertDimension(value, unit) {
  const number = parseNumber(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(unit === 'cm' ? number * 10 : number);
}

/**
 * 解析“长度 x 宽度 = 数量”形式的 OCR 文本。
 * 单位由用户显式选择，避免依赖小数点猜测单位。
 */
export function parsePhotoParts(text, unit = 'mm') {
  const normalized = normalizeText(text);
  const linePattern = /([A-Za-z\u4e00-\u9fff][A-Za-z0-9_-]*)?\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:=|:|至)\s*(\d+(?:[.,]\d+)?)/g;
  const simplePattern = /([A-Za-z\u4e00-\u9fff][A-Za-z0-9_-]*)?\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)/g;
  const parts = [];
  const lines = normalized.split(/\r?\n/);

  lines.forEach((line) => {
    let match;
    while ((match = linePattern.exec(line)) !== null) {
      const w = convertDimension(match[2], unit);
      const h = convertDimension(match[3], unit);
      const qty = parseNumber(match[4]);
      if (!w || !h || !Number.isInteger(qty) || qty <= 0) continue;
      parts.push({
        id: match[1] || '',
        w,
        h,
        qty,
        source: line.trim(),
      });
    }
    linePattern.lastIndex = 0;
    if (!/\s[=:至]\s*/.test(line)) {
      while ((match = simplePattern.exec(line)) !== null) {
        const w = convertDimension(match[2], unit);
        const h = convertDimension(match[3], unit);
        const qty = parseNumber(match[4]);
        if (w && h && Number.isInteger(qty) && qty > 0) {
          parts.push({ id: match[1] || '', w, h, qty, source: line.trim() });
        }
      }
    }
    simplePattern.lastIndex = 0;
  });

  // 某些 OCR 会把整张纸识别成一行，换行解析失败时再对全文扫描。
  if (parts.length === 0) {
    let match;
    while ((match = linePattern.exec(normalized)) !== null) {
      const w = convertDimension(match[2], unit);
      const h = convertDimension(match[3], unit);
      const qty = parseNumber(match[4]);
      if (w && h && Number.isInteger(qty) && qty > 0) {
        parts.push({ id: match[1] || '', w, h, qty, source: match[0] });
      }
    }
  }
  return parts;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取图片'));
    image.src = URL.createObjectURL(file);
  });
}

async function preprocessImage(file) {
  const image = await loadImage(file);
  const maxWidth = 2400;
  const ratio = Math.min(1, maxWidth / image.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.min(255, Math.max(0,
      0.299 * pixels.data[i] + 0.587 * pixels.data[i + 1] + 0.114 * pixels.data[i + 2]));
    const contrast = Math.min(255, Math.max(0, (gray - 128) * 1.35 + 128));
    pixels.data[i] = contrast;
    pixels.data[i + 1] = contrast;
    pixels.data[i + 2] = contrast;
  }
  ctx.putImageData(pixels, 0, 0);
  URL.revokeObjectURL(image.src);
  return canvas;
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('无法读取图片文件'));
    reader.readAsDataURL(file);
  });
}

export async function recognizePhoto(file, { unit = 'mm', onProgress } = {}) {
  onProgress?.(0.08);
  const image = await fileToDataUrl(file);
  const result = await requestJson('/api/ocr/photo', {
    method: 'POST',
    body: JSON.stringify({ image, unit }),
  });
  onProgress?.(1);
  return result;
}

export async function recognizePhotoLocal(file, { unit = 'mm', onProgress } = {}) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: `${OCR_ROOT}/worker.min.js`,
    corePath: `${OCR_ROOT}/core`,
    langPath: `${OCR_ROOT}/lang`,
    logger: (message) => {
      if (message && typeof message.progress === 'number') onProgress?.(message.progress);
    },
  });
  try {
    const image = await preprocessImage(file);
    const result = await worker.recognize(image, {
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZxX*=:-.,',
    });
    return { text: result.data.text, parts: parsePhotoParts(result.data.text, unit) };
  } finally {
    await worker.terminate();
  }
}
