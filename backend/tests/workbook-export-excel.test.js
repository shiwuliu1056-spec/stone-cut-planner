'use strict';

/**
 * workbook-export-excel.test.js
 * 测试 backend/src/workbook.js 的 exportWorkbook / buildWorkbook 函数（Excel 导出）。
 *
 * 不依赖 solver：测试中自行构造符合 shared/API.md "自动排版计算" 响应结构的
 * 最小合法 result 对象，覆盖导出内容、表格结构与异常路径。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { exportWorkbook, buildWorkbook } = require('../src/workbook');

/**
 * 构造一个符合 API.md 约定、且几何自洽（面积守恒、互不重叠、不越界）的
 * 最小合法 result.plans.A：
 * - 两块母板（甲、乙）
 * - 甲板：成品 A×2、B×1；空块 R01、R02、R03
 * - 乙板：成品 C×1；空块 R01、R02
 *
 * 契约对齐（P3-1）：空块统一登记，不再携带 `reusable` 分类字段。
 */
function makeResult() {
  return {
    plans: {
      A: {
        stats: { slabCount: 2, offcutCount: 5, offcutArea: 2580000 + 4230000 },
        slabs: [
          {
            id: '甲',
            index: 1,
            w: 2700,
            h: 1800,
            placements: [
              { id: 'A', instance: 'A-1', x: 0, y: 0, w: 1400, h: 600 },
              { id: 'A', instance: 'A-2', x: 0, y: 600, w: 1400, h: 600 },
              { id: 'B', instance: 'B-1', x: 0, y: 1200, w: 1200, h: 500 },
            ],
            cuts: [{ x1: 0, y1: 600, x2: 1400, y2: 600 }],
            allOffcuts: [
              { id: 'R01', x: 1400, y: 0, w: 1300, h: 1800 },
              { id: 'R02', x: 1200, y: 1200, w: 200, h: 500 },
              { id: 'R03', x: 0, y: 1700, w: 1400, h: 100 },
            ],
          },
          {
            id: '乙',
            index: 2,
            w: 2700,
            h: 1800,
            placements: [
              { id: 'C', instance: 'C-1', x: 0, y: 0, w: 900, h: 700 },
            ],
            cuts: [],
            allOffcuts: [
              { id: 'R01', x: 900, y: 0, w: 1800, h: 1800 },
              { id: 'R02', x: 0, y: 700, w: 900, h: 1100 },
            ],
          },
        ],
      },
    },
  };
}

/** 在工作表中查找第一列值等于 label 的行号（用于定位不固定行号的区块标题）。 */
function findRowByFirstCell(ws, label) {
  for (let r = 1; r <= ws.rowCount; r += 1) {
    if (ws.getRow(r).getCell(1).value === label) return r;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 正常导出：生成的文件可被 ExcelJS 重新读取，且关键内容正确
// ─────────────────────────────────────────────────────────────────────────────

test('exportWorkbook 生成的 Buffer 是可被 ExcelJS 正常读取的 .xlsx 文件', async () => {
  const result = makeResult();
  const buffer = await exportWorkbook({ result, images: {} });

  assert.ok(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array);
  assert.ok(buffer.byteLength > 3000, 'xlsx 文件体积应明显大于 0');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer); // 若格式损坏，此处会抛出异常
  assert.equal(wb.worksheets.length, 1);
  assert.equal(wb.worksheets[0].name, '切割方案下料尺寸表');
});

test('标题行与概览统计行使用 API.md 约定的 stats 字段（slabCount/offcutCount/offcutArea）', async () => {
  const result = makeResult();
  const buffer = await exportWorkbook({ result, images: {} });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('切割方案下料尺寸表');

  assert.equal(ws.getCell('A1').value, '切割方案－下料尺寸表');
  assert.equal(ws.getCell('B4').value, 2); // slabCount
  assert.equal(ws.getCell('D4').value, 5); // offcutCount
  assert.ok(Math.abs(ws.getCell('F4').value - (2580000 + 4230000) / 1e6) < 1e-9); // offcutArea(㎡)
});

test('成品下料尺寸表：表头、行数据、按板号合并单元格均正确', async () => {
  const result = makeResult();
  const buffer = await exportWorkbook({ result, images: {} });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('切割方案下料尺寸表');

  assert.deepEqual(
    ws.getRow(8).values.slice(1),
    ['板号', '成品编号', '长度(mm)', '宽度(mm)', '数量', '单件面积(㎡)', '总面积(㎡)'],
  );

  // 甲板(1): A×2, B×1；乙板(2): C×1 —— 按 (板号, 编号) 排序
  assert.equal(ws.getCell('A9').value, 1);
  assert.equal(ws.getCell('B9').value, 'A');
  assert.equal(ws.getCell('C9').value, 1400);
  assert.equal(ws.getCell('D9').value, 600);
  assert.equal(ws.getCell('E9').value, 2);
  assert.ok(Math.abs(ws.getCell('F9').value - 0.84) < 1e-9);
  assert.ok(Math.abs(ws.getCell('G9').value - 1.68) < 1e-9);

  assert.equal(ws.getCell('A10').value, 1);
  assert.equal(ws.getCell('B10').value, 'B');
  assert.equal(ws.getCell('E10').value, 1);

  assert.equal(ws.getCell('A11').value, 2);
  assert.equal(ws.getCell('B11').value, 'C');
  assert.equal(ws.getCell('E11').value, 1);

  // 甲板两行（9、10）应合并 A 列板号
  assert.ok(ws.model.merges.includes('A9:A10'));
  assert.equal(ws.getCell('A10').isMerged, true);
  assert.equal(ws.getCell('A10').master.address, 'A9');

  // 合计行使用 SUM 公式覆盖成品数据区
  const totalRow = 12;
  assert.equal(ws.getCell(`A${totalRow}`).value, '合计');
  assert.equal(ws.getCell(`E${totalRow}`).value.formula, 'SUM(E9:E11)');
  assert.equal(ws.getCell(`G${totalRow}`).value.formula, 'SUM(G9:G11)');
});

test('余料尺寸表：表头、行数据、统一空块状态与按板号合并均正确', async () => {
  const result = makeResult();
  const buffer = await exportWorkbook({ result, images: {} });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('切割方案下料尺寸表');

  const offcutHeaderRow = findRowByFirstCell(ws, '余料尺寸') + 1;
  assert.deepEqual(
    ws.getRow(offcutHeaderRow).values.slice(1),
    ['板号', '余料编号', '长度(mm)', '宽度(mm)', '数量', '单件面积(㎡)', '总面积(㎡)', '余料状态'],
  );

  const first = offcutHeaderRow + 1;
  // 甲板 R01/R02/R03（各不同尺寸），状态统一为“空块”（P3-1：不再区分可保留/小余料）
  assert.equal(ws.getCell(`A${first}`).value, 1);
  assert.equal(ws.getCell(`B${first}`).value, 'R01');
  assert.equal(ws.getCell(`H${first}`).value, '空块');
  assert.equal(ws.getCell(`A${first + 1}`).value, 1);
  assert.equal(ws.getCell(`H${first + 1}`).value, '空块');
  assert.equal(ws.getCell(`A${first + 2}`).value, 1);
  // 乙板 R01/R02
  assert.equal(ws.getCell(`A${first + 3}`).value, 2);
  assert.equal(ws.getCell(`H${first + 3}`).value, '空块');
  assert.equal(ws.getCell(`A${first + 4}`).value, 2);
  assert.equal(ws.getCell(`H${first + 4}`).value, '空块');

  // 甲板三行（first..first+2）合并 A 列板号；乙板两行（first+3、first+4）合并
  assert.ok(ws.model.merges.includes(`A${first}:A${first + 2}`));
  assert.ok(ws.model.merges.includes(`A${first + 3}:A${first + 4}`));
});

test('images 字段存在时不会生成额外工作表（仅输出尺寸表）', async () => {
  const result = makeResult();
  const buffer = await exportWorkbook({
    result,
    images: { A: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/XP8s8gAAAABJRU5ErkJggg=='] },
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepEqual(wb.worksheets.map((ws) => ws.name), ['切割方案下料尺寸表']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 兼容两种 result 包裹形式
// ─────────────────────────────────────────────────────────────────────────────

test('payload.result 直接为 { plans } 时可正常导出', async () => {
  const result = makeResult();
  const buffer = await exportWorkbook({ result });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.equal(wb.getWorksheet('切割方案下料尺寸表').getCell('B4').value, 2);
});

test('payload.result 为 /api/solve 完整响应体 { result: { plans } } 时也可正常导出', async () => {
  const nested = { result: makeResult() };
  const buffer = await exportWorkbook({ result: nested });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.equal(wb.getWorksheet('切割方案下料尺寸表').getCell('B4').value, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// 异常路径
// ─────────────────────────────────────────────────────────────────────────────

test('缺少 result 字段时抛出"缺少计算结果"', async () => {
  await assert.rejects(
    () => buildWorkbook({}),
    (err) => {
      assert.match(err.message, /缺少计算结果/);
      return true;
    },
  );
});

test('result.plans.A 缺失时抛出"缺少计算结果"', async () => {
  await assert.rejects(
    () => buildWorkbook({ result: { plans: {} } }),
    (err) => {
      assert.match(err.message, /缺少计算结果/);
      return true;
    },
  );
});

test('result 为 null 时抛出"缺少计算结果"', async () => {
  await assert.rejects(
    () => buildWorkbook({ result: null }),
    (err) => {
      assert.match(err.message, /缺少计算结果/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 无余料 / 无成品等边界情况下不应抛错
// ─────────────────────────────────────────────────────────────────────────────

test('母板没有任何余料时，余料区为空但仍能正常导出', async () => {
  const result = {
    plans: {
      A: {
        stats: { slabCount: 1, offcutCount: 0, offcutArea: 0 },
        slabs: [
          {
            id: '甲', index: 1, w: 1000, h: 1000,
            placements: [{ id: 'A', instance: 'A-1', x: 0, y: 0, w: 1000, h: 1000 }],
            cuts: [],
            allOffcuts: [],
          },
        ],
      },
    },
  };
  const buffer = await exportWorkbook({ result });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('切割方案下料尺寸表');
  const offcutHeaderRow = findRowByFirstCell(ws, '余料尺寸') + 1;
  // 余料数据区为空：紧邻表头下一行即为合计行
  assert.equal(ws.getCell(`A${offcutHeaderRow + 1}`).value, '合计');
});
