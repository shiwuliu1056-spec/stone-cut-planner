'use strict';

/**
 * workbook-export-word.test.js
 * 测试 backend/src/workbook.js 的 exportWord / buildWordDocument 函数（Word 导出）。
 *
 * 不依赖 solver：测试中自行构造符合 shared/API.md "自动排版计算" 响应结构的
 * 最小合法 result 对象，以及符合 "导出 Word 排版图" 约定的 images 数据。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { exportWord, buildWordDocument } = require('../src/workbook');

// 1×1 像素透明 PNG（合法 PNG 签名 + IHDR，可用于图片校验测试）
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/XP8s8gAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

function makeResult(slabCount = 1) {
  const slabs = [];
  for (let i = 1; i <= slabCount; i += 1) {
    slabs.push({
      id: '甲',
      index: i,
      w: 2700,
      h: 1800,
      placements: [
        { id: 'A', instance: `A-${i}`, x: 0, y: 0, w: 1400, h: 600 },
      ],
      cuts: [],
      allOffcuts: [
        { id: 'R01', x: 1400, y: 0, w: 1300, h: 1800 },
        { id: 'R02', x: 0, y: 600, w: 1400, h: 1200 },
      ],
    });
  }
  return {
    plans: {
      A: {
        stats: { slabCount, offcutCount: 2 * slabCount, offcutArea: (2340000 + 1680000) * slabCount },
        slabs,
      },
    },
  };
}

function makeImages(count = 1) {
  return { A: Array.from({ length: count }, () => TINY_PNG_DATA_URL) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 正常导出：生成的文件是有效的 DOCX（ZIP 容器 + 关键内部文件）
// ─────────────────────────────────────────────────────────────────────────────

test('exportWord 生成的 Buffer 是可被解析的有效 .docx 文件', async () => {
  const buffer = await exportWord({ result: makeResult(1), images: makeImages(1) });

  assert.ok(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array);
  assert.ok(buffer.byteLength > 1000, 'docx 文件体积应明显大于 0');

  // docx 本质是 zip 容器；能被 JSZip 加载即说明文件结构合法
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('[Content_Types].xml'), '应包含 [Content_Types].xml');
  assert.ok(zip.file('word/document.xml'), '应包含 word/document.xml');
});

test('文档中包含母板编号与尺寸等关键内容', async () => {
  const buffer = await exportWord({ result: makeResult(2), images: makeImages(2) });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');

  assert.match(xml, /2700/);
  assert.match(xml, /1800/);
  // 圆圈序号 ①② 用于区分不同母板
  assert.match(xml, /①/);
  assert.match(xml, /②/);
});

test('文档中嵌入了图片媒体文件', async () => {
  const buffer = await exportWord({ result: makeResult(1), images: makeImages(1) });
  const zip = await JSZip.loadAsync(buffer);
  const mediaFiles = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
  assert.ok(mediaFiles.length >= 1, '应至少嵌入一张图片');
});

test('多块母板时生成对应数量的分节（每节一张图）', async () => {
  const buffer = await exportWord({ result: makeResult(3), images: makeImages(3) });
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  // 相同图片内容会被内部去重为同一个媒体文件，因此按分节数（sectPr）而非
  // media 文件数量来判断：3 块母板应生成 3 个分节属性（含末尾的整体 sectPr）。
  const sectionCount = (xml.match(/<w:sectPr/g) || []).length;
  assert.equal(sectionCount, 3);
  const drawingCount = (xml.match(/<w:drawing>/g) || []).length;
  assert.equal(drawingCount, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// 异常路径：缺少排版结果
// ─────────────────────────────────────────────────────────────────────────────

test('缺少 result 字段时抛出"缺少排版结果"', async () => {
  await assert.rejects(
    () => buildWordDocument({ images: makeImages(1) }),
    (err) => {
      assert.match(err.message, /缺少排版结果/);
      return true;
    },
  );
});

test('result.plans.A 缺失时抛出"缺少排版结果"', async () => {
  await assert.rejects(
    () => buildWordDocument({ result: { plans: {} }, images: makeImages(1) }),
    (err) => {
      assert.match(err.message, /缺少排版结果/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 异常路径：缺少图片 / 图片数量不符
// ─────────────────────────────────────────────────────────────────────────────

test('images 字段完全缺失时抛出"缺少图片"', async () => {
  await assert.rejects(
    () => buildWordDocument({ result: makeResult(1) }),
    (err) => {
      assert.match(err.message, /缺少图片/);
      return true;
    },
  );
});

test('images.A 为空数组时抛出"缺少图片"', async () => {
  await assert.rejects(
    () => buildWordDocument({ result: makeResult(1), images: { A: [] } }),
    (err) => {
      assert.match(err.message, /缺少图片/);
      return true;
    },
  );
});

test('images.A 数量少于母板数量时抛出"图片数量不符"', async () => {
  await assert.rejects(
    () => buildWordDocument({ result: makeResult(2), images: makeImages(1) }),
    (err) => {
      assert.match(err.message, /图片数量不符/);
      return true;
    },
  );
});

test('images.A 数量多于母板数量时抛出"图片数量不符"', async () => {
  await assert.rejects(
    () => buildWordDocument({ result: makeResult(1), images: makeImages(2) }),
    (err) => {
      assert.match(err.message, /图片数量不符/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 异常路径：图片格式错误
// ─────────────────────────────────────────────────────────────────────────────

test('图片不是 data:image/png;base64 前缀时抛出"图片格式错误"', async () => {
  await assert.rejects(
    () => buildWordDocument({
      result: makeResult(1),
      images: { A: ['data:image/jpeg;base64,/9j/4AAQSkZJRg=='] },
    }),
    (err) => {
      assert.match(err.message, /图片格式错误/);
      return true;
    },
  );
});

test('图片 base64 内容不是合法 PNG 签名时抛出"图片格式错误"', async () => {
  const fakeBase64 = Buffer.from('not a real png content').toString('base64');
  await assert.rejects(
    () => buildWordDocument({
      result: makeResult(1),
      images: { A: [`data:image/png;base64,${fakeBase64}`] },
    }),
    (err) => {
      assert.match(err.message, /图片格式错误/);
      return true;
    },
  );
});

test('图片字段不是字符串时抛出"图片格式错误"', async () => {
  await assert.rejects(
    () => buildWordDocument({ result: makeResult(1), images: { A: [12345] } }),
    (err) => {
      assert.match(err.message, /图片格式错误/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 异常路径：排版结果结构非法
// ─────────────────────────────────────────────────────────────────────────────

test('plans.A.slabs 不是数组时抛出"排版结果结构非法"', async () => {
  await assert.rejects(
    () => buildWordDocument({
      result: { plans: { A: { slabs: '不是数组' } } },
      images: makeImages(1),
    }),
    (err) => {
      assert.match(err.message, /排版结果结构非法/);
      return true;
    },
  );
});

test('plans.A.slabs 为空数组时抛出"排版结果结构非法"', async () => {
  await assert.rejects(
    () => buildWordDocument({
      result: { plans: { A: { slabs: [] } } },
      images: makeImages(1),
    }),
    (err) => {
      assert.match(err.message, /排版结果结构非法/);
      return true;
    },
  );
});

test('母板缺少 w/h 时抛出"排版结果结构非法"', async () => {
  await assert.rejects(
    () => buildWordDocument({
      result: { plans: { A: { slabs: [{ id: '甲', index: 1, placements: [] }] } } },
      images: makeImages(1),
    }),
    (err) => {
      assert.match(err.message, /排版结果结构非法/);
      return true;
    },
  );
});

test('母板 placements 字段存在但不是数组时抛出"排版结果结构非法"', async () => {
  await assert.rejects(
    () => buildWordDocument({
      result: { plans: { A: { slabs: [{ id: '甲', index: 1, w: 2700, h: 1800, placements: {} }] } } },
      images: makeImages(1),
    }),
    (err) => {
      assert.match(err.message, /排版结果结构非法/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 兼容两种 result 包裹形式
// ─────────────────────────────────────────────────────────────────────────────

test('payload.result 为 /api/solve 完整响应体 { result: { plans } } 时也可正常导出', async () => {
  const nested = { result: makeResult(1) };
  const buffer = await exportWord({ result: nested, images: makeImages(1) });
  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('word/document.xml'));
});
