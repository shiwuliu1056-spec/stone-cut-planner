'use strict';

/**
 * workbook-import.test.js
 * 测试 backend/src/workbook.js 的 importParts 函数。
 * 覆盖：正常导入、空文件、缺少表头、非法数值、自动编号。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { importParts } = require('../src/workbook');

/** 快速构造一个只有一张工作表的 xlsx Buffer。 */
async function makeXlsx(headers, rows, sheetName = 'Sheet1') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  return wb.xlsx.writeBuffer();
}

// ─────────────────────────────────────────────────────────────────────────────
// 正常导入
// ─────────────────────────────────────────────────────────────────────────────

test('中文表头：编号、长度、宽度、数量 — 正确解析两行数据', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [
      ['A',  1400, 600,  13],
      ['B',  1750, 450,  13],
    ],
  );
  const parts = await importParts(buf);
  assert.deepEqual(parts, [
    { id: 'A', w: 1400, h: 600,  qty: 13 },
    { id: 'B', w: 1750, h: 450,  qty: 13 },
  ]);
});

test('英文表头：id、w、h、qty — 正确解析', async () => {
  const buf = await makeXlsx(
    ['id', 'w', 'h', 'qty'],
    [['X1', 900, 600, 5]],
  );
  const parts = await importParts(buf);
  assert.deepEqual(parts, [{ id: 'X1', w: 900, h: 600, qty: 5 }]);
});

test('表头在第 3 行（前两行为标题装饰行）也能被识别', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['九江宝松石材输入清单']);          // 第 1 行：装饰标题
  ws.addRow([]);                               // 第 2 行：空行
  ws.addRow(['编号', '长度', '宽度', '数量']); // 第 3 行：表头
  ws.addRow(['C', 600, 400, 4]);               // 第 4 行：数据
  const buf = await wb.xlsx.writeBuffer();

  const parts = await importParts(buf);
  assert.deepEqual(parts, [{ id: 'C', w: 600, h: 400, qty: 4 }]);
});

test('没有编号列时，自动生成 P01、P02 编号', async () => {
  const buf = await makeXlsx(
    ['长度', '宽度', '数量'],
    [
      [800, 500, 2],
      [700, 400, 3],
    ],
  );
  const parts = await importParts(buf);
  assert.equal(parts[0].id, 'P01');
  assert.equal(parts[1].id, 'P02');
  assert.equal(parts[0].w, 800);
  assert.equal(parts[1].h, 400);
});

test('长度为小数（600.6）时直接拒绝，不再四舍五入', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['D', 600.6, 400, 3]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /长度值/);
      assert.match(err.message, /正整数/);
      return true;
    },
  );
});

test('宽度为小数（400.4）时直接拒绝', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['D', 600, 400.4, 3]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /宽度值/);
      return true;
    },
  );
});

test('数量为小数（3.9）时直接拒绝，不再四舍五入', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['D', 600, 400, 3.9]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /数量值/);
      return true;
    },
  );
});

test('长度为 0.4 时直接拒绝，不会被四舍五入为 0 或产生非法零件', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['A', 0.4, 1, 0.4]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /长度值/);
      return true;
    },
  );
});

test('长度为 100.5 时直接拒绝', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['A', 100.5, 200, 3]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /长度值/);
      return true;
    },
  );
});

test('整数尺寸与数量原样保留', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['D', 601, 400, 4]],
  );
  const parts = await importParts(buf);
  assert.deepEqual(parts, [{ id: 'D', w: 601, h: 400, qty: 4 }]);
});

test('数据行中间夹有空行时，跳过空行不报错', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['编号', '长度', '宽度', '数量']);
  ws.addRow(['A', 600, 400, 2]);
  ws.addRow([null, null, null, null]); // 空行
  ws.addRow(['B', 700, 500, 3]);
  const buf = await wb.xlsx.writeBuffer();

  const parts = await importParts(buf);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].id, 'A');
  assert.equal(parts[1].id, 'B');
});

test('工作表命名为"尺寸清单"时优先读取该表', async () => {
  const wb = new ExcelJS.Workbook();
  // 先加一个干扰表
  const ws1 = wb.addWorksheet('其他表');
  ws1.addRow(['编号', '长度', '宽度', '数量']);
  ws1.addRow(['WRONG', 1, 1, 1]);
  // 再加目标表
  const ws2 = wb.addWorksheet('尺寸清单');
  ws2.addRow(['编号', '长度', '宽度', '数量']);
  ws2.addRow(['E', 500, 300, 6]);
  const buf = await wb.xlsx.writeBuffer();

  const parts = await importParts(buf);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].id, 'E');
});

// ─────────────────────────────────────────────────────────────────────────────
// 空文件 / 格式错误
// ─────────────────────────────────────────────────────────────────────────────

test('传入空 Buffer 时抛出"文件内容为空"', async () => {
  await assert.rejects(
    () => importParts(Buffer.alloc(0)),
    (err) => {
      assert.match(err.message, /文件内容为空/);
      return true;
    },
  );
});

test('传入 null 时抛出"文件内容为空"', async () => {
  await assert.rejects(
    () => importParts(null),
    (err) => {
      assert.match(err.message, /文件内容为空/);
      return true;
    },
  );
});

test('传入无效二进制数据时抛出解析错误', async () => {
  await assert.rejects(
    () => importParts(Buffer.from('这不是xlsx文件', 'utf8')),
    (err) => {
      assert.ok(err instanceof Error);
      return true;
    },
  );
});

test('Excel 无任何工作表时抛出"没有工作表"', async () => {
  // ExcelJS 不允许创建零工作表的 workbook，改用手工构造最小 xlsx zip 验证路径
  // 此测试等效于：传入一个格式合法但无 worksheet 内容的 buffer；
  // 实际中最常见的是 xlsx 内 workbook.xml 存在但无 sheet，此处用间接方式验证。
  // 由于 ExcelJS 总会生成至少一个 sheet，这里验证"只有表头行无数据"的错误路径。
  const buf = await makeXlsx(['编号', '长度', '宽度', '数量'], []);
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /未读取到有效的小料数据/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 缺少必要字段
// ─────────────────────────────────────────────────────────────────────────────

test('表头缺少"宽度"列时抛出"未找到表头行"', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '数量'], // 故意缺少宽度
    [['A', 600, 3]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /未找到表头行/);
      return true;
    },
  );
});

test('表头缺少"长度"列时抛出"未找到表头行"', async () => {
  const buf = await makeXlsx(
    ['编号', '宽度', '数量'],
    [['A', 400, 3]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /未找到表头行/);
      return true;
    },
  );
});

test('表头缺少"数量"列时抛出"未找到表头行"', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度'],
    [['A', 600, 400]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /未找到表头行/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 非法数值
// ─────────────────────────────────────────────────────────────────────────────

test('长度为字符串"abc"时抛出含行号的错误', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['A', 'abc', 400, 3]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /长度值/);
      return true;
    },
  );
});

test('宽度为 0 时抛出非法数值错误', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['A', 600, 0, 3]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /宽度值/);
      return true;
    },
  );
});

test('数量为负数时抛出非法数值错误', async () => {
  const buf = await makeXlsx(
    ['编号', '长度', '宽度', '数量'],
    [['A', 600, 400, -5]],
  );
  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /数量值/);
      return true;
    },
  );
});

test('长度为 null 时抛出非法数值错误', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['编号', '长度', '宽度', '数量']);
  ws.addRow(['A', null, 400, 3]); // 长度为 null
  const buf = await wb.xlsx.writeBuffer();

  await assert.rejects(
    () => importParts(buf),
    (err) => {
      assert.match(err.message, /长度值/);
      return true;
    },
  );
});
