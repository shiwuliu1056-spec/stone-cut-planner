'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeParts, parseImageDataUrl, parseTranscribedParts } = require('../src/gemini-ocr');

test('联网视觉识别结果按 mm 原样规范化', () => {
  assert.deepEqual(normalizeParts({ parts: [{ id: 'A', w: 180, h: 35, qty: 6 }] }, 'mm'), [
    { id: 'A', w: 180, h: 35, qty: 6 },
  ]);
});

test('联网视觉识别结果选择 cm 时自动转换为 mm', () => {
  assert.deepEqual(normalizeParts({ parts: [{ w: 18, h: 3.5, qty: 6 }] }, 'cm'), [
    { id: '', w: 180, h: 35, qty: 6 },
  ]);
});

test('图片 data URL 能被校验并保留 MIME 类型', () => {
  assert.deepEqual(parseImageDataUrl('data:image/jpeg;base64,SGVsbG8='), {
    mimeType: 'image/jpeg',
    data: 'SGVsbG8=',
  });
});

test('GLM-OCR 公式文本会优先读取最终等号后的数量', () => {
  assert.deepEqual(parseTranscribedParts('180 \\times 35 - 8 = 4\n130×5=36', 'mm'), [
    { id: '', w: 180, h: 35, qty: 4 },
    { id: '', w: 130, h: 5, qty: 36 },
  ]);
});
