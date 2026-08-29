'use strict';

/**
 * workbook.js — Excel 导入与导出、Word 导出
 *
 * 导入：解析 POST /api/import 收到的 Excel 二进制数据，
 * 返回符合 shared/API.md 约定的 parts 数组：
 *   [{ id: string, w: number, h: number, qty: number }, ...]
 *
 * 导出：根据 POST /api/export 收到的 { result, images }，
 * 生成符合 shared/API.md "导出 Excel 尺寸表" 约定的 .xlsx 二进制。
 *
 * Word 导出：根据 POST /api/export-word 收到的 { result, images }，
 * 生成符合 shared/API.md "导出 Word 排版图" 约定的 .docx 二进制。
 */

const ExcelJS = require('exceljs');
const {
  Document, Packer, Paragraph, TextRun, ImageRun,
  AlignmentType, PageOrientation, VerticalAlign,
} = require('docx');

/** 把单元格表头值规范化为小写无空格字符串，方便同义词匹配。 */
function normalizeHeader(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

/**
 * 从 Excel 二进制 buffer 中提取小料清单。
 *
 * @param {Buffer|ArrayBuffer} buffer  Excel 文件二进制数据
 * @returns {Promise<Array<{id:string, w:number, h:number, qty:number}>>}
 * @throws {Error} 文件格式无效、缺少表头、或没有任何有效数据行
 */
async function importParts(buffer) {
  // ── 1. 空文件检查 ─────────────────────────────────────────────────────────
  const byteLen = buffer?.byteLength ?? buffer?.length ?? 0;
  if (!buffer || byteLen === 0) {
    throw new Error('文件内容为空');
  }

  // ── 2. 解析 Excel ─────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('无法解析 Excel 文件，请确认文件格式正确（仅支持 .xlsx / .xls）');
  }

  // ── 3. 工作表检查 ─────────────────────────────────────────────────────────
  const ws = wb.getWorksheet('尺寸清单') || wb.worksheets[0];
  if (!ws) {
    throw new Error('Excel 文件中没有工作表');
  }

  // ── 4. 表头定位（在前 30 行中搜索含 w、h、qty 列的行） ───────────────────
  // 同义词表：key 为内部字段名，value 为允许的列标题变体
  const synonyms = {
    id:  ['编号', 'id', '代号', '名称'],
    w:   ['长度', '长', 'length', 'w'],
    h:   ['宽度', '宽', 'width', 'h'],
    qty: ['数量', '件数', 'qty', 'quantity'],
  };

  let headerRowIndex = null;
  let columns = null;

  for (let r = 1; r <= Math.min(30, ws.rowCount); r += 1) {
    const values = ws.getRow(r).values.slice(1).map(normalizeHeader);
    const mapping = {};
    for (const [key, names] of Object.entries(synonyms)) {
      const normalized = names.map(normalizeHeader);
      const idx = values.findIndex((v) => normalized.includes(v));
      if (idx >= 0) mapping[key] = idx + 1; // 1-based 列索引
    }
    // 必须至少有 w、h、qty 三列才算有效表头
    if (mapping.w && mapping.h && mapping.qty) {
      headerRowIndex = r;
      columns = mapping;
      break;
    }
  }

  if (!headerRowIndex) {
    throw new Error('未找到表头行，请确认文件包含"长度、宽度、数量"列（也接受英文 w/h/qty）');
  }

  // ── 5. 逐行读取，校验并收集数据 ───────────────────────────────────────────
  const parts = [];

  for (let r = headerRowIndex + 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const rawW   = row.getCell(columns.w).value;
    const rawH   = row.getCell(columns.h).value;
    const rawQty = row.getCell(columns.qty).value;

    // 跳过全空行（三个必填列都为 null）
    if (rawW === null && rawH === null && rawQty === null) continue;

    // 数值转换
    const w   = Number(rawW);
    const h   = Number(rawH);
    const qty = Number(rawQty);

    // 逐字段校验：必须是正整数。禁止先接受小数再四舍五入，
    // 0.4、100.5 等非整数直接报错（与 /api/solve 对零件的整数要求保持一致）。
    if (!Number.isInteger(w) || w <= 0) {
      throw new Error(`第 ${r} 行：长度值 "${rawW}" 不是有效的正整数`);
    }
    if (!Number.isInteger(h) || h <= 0) {
      throw new Error(`第 ${r} 行：宽度值 "${rawH}" 不是有效的正整数`);
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`第 ${r} 行：数量值 "${rawQty}" 不是有效的正整数`);
    }

    // 编号：有列则取值，否则自动生成 P01、P02 …
    const rawId = columns.id ? row.getCell(columns.id).value : null;
    const id = String(rawId ?? '').trim() ||
      `P${String(parts.length + 1).padStart(2, '0')}`;

    parts.push({ id, w, h, qty });
  }

  // ── 6. 确保至少有一条有效数据 ─────────────────────────────────────────────
  if (parts.length === 0) {
    throw new Error('未读取到有效的小料数据，请检查数据行是否为空或全部被跳过');
  }

  return parts;
}

// ═════════════════════════════════════════════════════════════════════════
// Excel 导出（尺寸表） — POST /api/export
// ═════════════════════════════════════════════════════════════════════════

const COLORS = {
  navy: '243447', teal: '1F7A6E', blue: 'DDE8F5', gold: 'F3E7C5',
  offcutLight: 'FDE2E1', offcutDark: 'F2B2AE', offcutText: '9A2E2A', offcutSmallText: '6E2522',
  gray: 'EEF1F4', dark: '27313A', white: 'FFFFFF', line: 'CFD6DC',
};

function border(style = 'thin', color = COLORS.line) {
  return {
    top: { style, color: { argb: color } },
    bottom: { style, color: { argb: color } },
    left: { style, color: { argb: color } },
    right: { style, color: { argb: color } },
  };
}

function styleTitle(ws, range, text) {
  ws.mergeCells(range);
  const c = ws.getCell(range.split(':')[0]);
  c.value = text;
  c.font = { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: COLORS.white } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  c.alignment = { vertical: 'middle', horizontal: 'left' };
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.teal } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = border();
  });
  row.height = 24;
}

function styleBody(row) {
  row.eachCell((cell) => {
    cell.font = { name: 'Microsoft YaHei', size: 12, color: { argb: COLORS.dark } };
    cell.border = border('thin', 'E2E7EB');
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
}

function styleSection(row, text, lastColumn) {
  row.values = [text];
  row.getCell(1).font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: COLORS.navy } };
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
  row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  for (let column = 2; column <= lastColumn; column += 1) {
    row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
  }
  row.height = 23;
}

function planName() { return '切割方案'; }
function planSheetName() { return `${planName()}下料尺寸表`; }

/** 汇总某个方案下所有母板的净尺寸，用于概览行展示。 */
function slabSizes(plan) {
  const counts = new Map();
  for (const slab of plan.slabs || []) {
    const key = `${slab.w}×${slab.h}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .map(([size, count]) => `${size} mm${count > 1 ? `（${count}块）` : ''}`)
    .join('、');
}

/** 从形如 "R01" 的余料编号中提取数字，用于排序；非该格式的排到最后。 */
function numberId(value) {
  const match = /^R(\d+)$/i.exec(String(value || ''));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * 根据 API.md 中 plan.stats 的约定字段（slabCount / offcutCount / offcutArea / kerfWasteArea）
 * 生成概览统计；若传入的最小结果对象缺少 stats，则从 slabs 推算兜底，
 * 保证不依赖 solver 也能正常导出。
 */
function planStats(plan) {
  const slabs = plan.slabs || [];
  const stats = plan.stats || {};
  const slabCount = Number.isFinite(stats.slabCount) ? stats.slabCount : slabs.length;
  const offcutCount = Number.isFinite(stats.offcutCount)
    ? stats.offcutCount
    : slabs.reduce((n, s) => n + (s.allOffcuts ? s.allOffcuts.length : 0), 0);
  const offcutArea = Number.isFinite(stats.offcutArea)
    ? stats.offcutArea
    : slabs.reduce((n, s) => n + (s.allOffcuts || []).reduce((a, o) => a + (Number(o.w) * Number(o.h) || 0), 0), 0);
  const kerfWasteArea = Number.isFinite(stats.kerfWasteArea)
    ? stats.kerfWasteArea
    : slabs.reduce((n, s) => n + (Number(s.kerfWasteArea) || 0), 0);
  return { slabCount, offcutCount, offcutArea, kerfWasteArea };
}

/** 按 (板号, 成品编号) 汇总 placements，得到成品下料尺寸表的行数据。 */
function productRows(plan) {
  const grouped = new Map();
  for (const slab of plan.slabs || []) {
    for (const placement of slab.placements || []) {
      const shortage = Number(placement.shortage) || 0;
      const key = `${slab.index}\u0000${placement.id}\u0000${placement.w}\u0000${placement.h}\u0000${shortage}`;
      const current = grouped.get(key) || {
        slab: slab.index,
        id: shortage ? `${placement.id}（末端少${shortage}mm）` : placement.id,
        w: Number(placement.w),
        h: Number(placement.h),
        qty: 0,
      };
      current.qty += 1;
      grouped.set(key, current);
    }
  }
  return [...grouped.values()]
    .sort((a, b) => a.slab - b.slab || String(a.id).localeCompare(String(b.id), 'zh-CN'))
    .map((row) => ({ ...row, unitArea: (row.w * row.h) / 1e6, totalArea: (row.w * row.h * row.qty) / 1e6 }));
}

/**
 * 按 (板号, 尺寸) 汇总 allOffcuts，得到余料尺寸表的行数据。
 * `reusable` 字段已废弃，所有空块统一登记，状态列恒为“空块”。
 */
function offcutRows(plan) {
  const grouped = new Map();
  for (const slab of plan.slabs || []) {
    for (const offcut of slab.allOffcuts || []) {
      const status = '空块';
      const key = `${slab.index}\u0000${offcut.w}\u0000${offcut.h}`;
      const current = grouped.get(key) || {
        slab: slab.index, ids: [], w: offcut.w, h: offcut.h, qty: 0, status,
      };
      current.ids.push(offcut.id);
      current.qty += 1;
      grouped.set(key, current);
    }
  }
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      ids: row.ids.sort((a, b) => numberId(a) - numberId(b)),
      unitArea: (row.w * row.h) / 1e6,
      totalArea: (row.w * row.h * row.qty) / 1e6,
    }))
    .sort((a, b) => a.slab - b.slab || numberId(a.ids[0]) - numberId(b.ids[0]));
}

/** 将 A 列中同一板号的连续行合并，使板号只显示一次。 */
function mergeBoardCells(ws, firstRow, rows) {
  if (!rows.length) return;
  let groupStart = 0;
  for (let index = 1; index <= rows.length; index += 1) {
    const sameBoard = index < rows.length && rows[index].slab === rows[groupStart].slab;
    if (sameBoard) continue;
    const startRow = firstRow + groupStart;
    const endRow = firstRow + index - 1;
    if (endRow > startRow) {
      ws.mergeCells(`A${startRow}:A${endRow}`);
      const boardCell = ws.getCell(`A${startRow}`);
      boardCell.alignment = { vertical: 'middle', horizontal: 'center' };
      for (let row = startRow; row <= endRow; row += 1) ws.getCell(`A${row}`).border = border('thin', 'E2E7EB');
    } else {
      ws.getCell(`A${startRow}`).alignment = { vertical: 'middle', horizontal: 'center' };
    }
    groupStart = index;
  }
}

/** 写入"合计"行，数量列与面积列使用 SUM 公式。 */
function writeTotalRow(ws, rowNumber, firstRow, lastRow, columnCount, areaColumn) {
  const row = ws.getRow(rowNumber);
  row.values = ['合计'];
  const hasRows = lastRow >= firstRow;
  row.getCell(5).value = hasRows ? { formula: `SUM(E${firstRow}:E${lastRow})` } : 0;
  const areaLetter = String.fromCharCode(64 + areaColumn);
  row.getCell(areaColumn).value = hasRows ? { formula: `SUM(${areaLetter}${firstRow}:${areaLetter}${lastRow})` } : 0;
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: COLORS.dark } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gold } };
    cell.border = border();
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  row.getCell(areaColumn).numFmt = '0.000';
  row.height = 23;
}

/** 在给定 workbook 中添加"切割方案下料尺寸表"工作表。 */
function addDimensionsSheet(wb, result) {
  const plan = result.plans.A;
  const stats = planStats(plan);
  const products = productRows(plan);
  const offcuts = offcutRows(plan);

  const ws = wb.addWorksheet(planSheetName(), { views: [{ state: 'frozen', ySplit: 7, showGridLines: false }] });
  ws.columns = [
    { width: 11 }, { width: 18 }, { width: 14 }, { width: 14 },
    { width: 11 }, { width: 15 }, { width: 15 }, { width: 14 },
  ];
  ws.getRow(1).height = 34;
  ws.getRow(2).height = 12;
  styleTitle(ws, 'A1:H2', `${planName()}－下料尺寸表`);

  // 概览统计行（含固定 4mm 刀片损耗面积）
  ws.getCell('A4').value = '母板数量'; ws.getCell('B4').value = stats.slabCount;
  ws.getCell('C4').value = '余料块数'; ws.getCell('D4').value = stats.offcutCount;
  ws.getCell('E4').value = '余料总面积(㎡)'; ws.getCell('F4').value = stats.offcutArea / 1e6;
  ws.getCell('G4').value = '刀片损耗面积(㎡)'; ws.getCell('H4').value = stats.kerfWasteArea / 1e6;
  ws.getCell('A5').value = '母板净尺寸'; ws.getCell('B5').value = slabSizes(plan);
  for (const addr of ['A4', 'C4', 'E4', 'G4', 'A5']) {
    ws.getCell(addr).font = { name: 'Microsoft YaHei', bold: true, color: { argb: COLORS.teal } };
  }
  ws.getCell('F4').numFmt = '0.000';
  ws.getCell('H4').numFmt = '0.000';

  // 成品下料尺寸
  styleSection(ws.getRow(7), '成品下料尺寸', 7);
  ws.getRow(8).values = ['板号', '成品编号', '长度(mm)', '宽度(mm)', '数量', '单件面积(㎡)', '总面积(㎡)'];
  styleHeader(ws.getRow(8));
  const productFirst = 9;
  products.forEach((item, index) => {
    const row = ws.getRow(productFirst + index);
    row.values = [item.slab, item.id, item.w, item.h, item.qty, item.unitArea, item.totalArea];
    styleBody(row);
    row.getCell(6).numFmt = '0.000';
    row.getCell(7).numFmt = '0.000';
    row.height = 22;
  });
  mergeBoardCells(ws, productFirst, products);
  // 无数据时 productLast < productFirst，writeTotalRow 会据此判定 hasRows=false；
  // 合计行紧跟在最后一条数据行之后（无数据时紧跟表头之后）。
  const productLast = productFirst + products.length - 1;
  const productTotal = productFirst + products.length;
  writeTotalRow(ws, productTotal, productFirst, productLast, 7, 7);

  // 余料尺寸
  const offcutSection = productTotal + 3;
  styleSection(ws.getRow(offcutSection), '余料尺寸', 8);
  const offcutHeader = offcutSection + 1;
  ws.getRow(offcutHeader).values = ['板号', '余料编号', '长度(mm)', '宽度(mm)', '数量', '单件面积(㎡)', '总面积(㎡)', '余料状态'];
  styleHeader(ws.getRow(offcutHeader));
  const offcutFirst = offcutHeader + 1;
  offcuts.forEach((item, index) => {
    const row = ws.getRow(offcutFirst + index);
    row.values = [item.slab, item.ids.join('、'), item.w, item.h, item.qty, item.unitArea, item.totalArea, item.status];
    styleBody(row);
    row.getCell(6).numFmt = '0.000';
    row.getCell(7).numFmt = '0.000';
    row.height = 22;
    // 空块统一登记，状态列不区分可保留/小余料，统一使用同一配色。
    row.getCell(8).font = { name: 'Microsoft YaHei', color: { argb: COLORS.offcutText } };
    row.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.offcutLight } };
  });
  mergeBoardCells(ws, offcutFirst, offcuts);
  const offcutLast = offcutFirst + offcuts.length - 1;
  const offcutTotal = offcutFirst + offcuts.length;
  writeTotalRow(ws, offcutTotal, offcutFirst, offcutLast, 8, 7);

  ws.pageSetup = {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    repeatRows: '1:8',
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 },
    printArea: `A1:H${offcutTotal}`,
  };
  ws.headerFooter.oddFooter = `&L${planName()} 下料尺寸表&C第 &P 页 / 共 &N 页`;
}

/**
 * 从导出请求体中取出 /api/solve 的完整 result 对象。
 * 兼容两种可能的包裹形式：
 *   1) payload.result = { plans: { A: {...} } }            —— result 字段本身即为 solve 的 result
 *   2) payload.result = { result: { plans: { A: {...} } } } —— result 字段是 solve 的完整响应体
 */
function resolveResult(payload) {
  const raw = payload && payload.result;
  if (!raw) return null;
  if (raw.plans) return raw;
  if (raw.result && raw.result.plans) return raw.result;
  return null;
}

/**
 * 根据 { result, images } 构建导出用的 ExcelJS Workbook。
 * 仅依赖 shared/API.md 约定的数据结构，不依赖 solver。
 *
 * @param {{result: object, images?: object}} payload
 * @returns {Promise<import('exceljs').Workbook>}
 */
async function buildWorkbook(payload) {
  const result = resolveResult(payload);
  if (!result || !result.plans || !result.plans.A) {
    throw new Error('缺少计算结果');
  }
  // 导出前深度完整性校验：坐标/尺寸/越界/重叠/面积守恒/编号/数量。
  assertValidResultShape(result.plans.A);
  assertExportIntegrity(result.plans.A);

  const wb = new ExcelJS.Workbook();
  wb.creator = '石材下料工具';
  wb.created = new Date();
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  wb.views = [{ x: 0, y: 0, width: 12000, height: 8000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

  addDimensionsSheet(wb, result);
  return wb;
}

/**
 * 生成 POST /api/export 的响应二进制（.xlsx Buffer）。
 *
 * @param {{result: object, images?: object}} payload
 * @returns {Promise<Buffer>}
 */
async function exportWorkbook(payload) {
  const wb = await buildWorkbook(payload);
  return wb.xlsx.writeBuffer();
}

// ═════════════════════════════════════════════════════════════════════════
// Word 导出（排版图） — POST /api/export-word
// ═════════════════════════════════════════════════════════════════════════

const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CIRCLED_NUMBERS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳',
  '㉑', '㉒', '㉓', '㉔', '㉕', '㉖', '㉗', '㉘', '㉙', '㉚',
];
function circledNumber(n) {
  return CIRCLED_NUMBERS[n - 1] || `(${n})`;
}

/** 校验 result.plans.A 的基本结构是否合法（不依赖 solver，只做形状检查）。 */
function assertValidResultShape(plan) {
  if (!Array.isArray(plan.slabs)) {
    throw new Error('排版结果结构非法：plans.A.slabs 应为数组');
  }
  plan.slabs.forEach((slab, i) => {
    if (!slab || typeof slab !== 'object') {
      throw new Error(`排版结果结构非法：第 ${i + 1} 块母板数据无效`);
    }
    if (!Number.isFinite(Number(slab.w)) || !Number.isFinite(Number(slab.h))) {
      throw new Error(`排版结果结构非法：第 ${i + 1} 块母板缺少有效的 w/h`);
    }
    if (slab.placements !== undefined && !Array.isArray(slab.placements)) {
      throw new Error(`排版结果结构非法：第 ${i + 1} 块母板 placements 应为数组`);
    }
  });
}

const IMAX = 1e9;
function isPositiveInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= IMAX;
}
function isNonNegInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= IMAX;
}
function twoRectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 导出前深度完整性校验。在生成 Excel/Word 之前调用，确保不会产出
 * “可以打开但内容残缺/自相矛盾”的文件。逐项校验：
 *   - 母板尺寸、编号、序号；
 *   - placements / allOffcuts 的坐标与尺寸为合法整数、且不越界；
 *   - 每张母板内 placements 互不重叠、offcuts 互不重叠、成品与空块互不重叠；
 *   - 面积守恒：Σplacement + Σoffcut == 母板面积；
 *   - 空块编号在单板内唯一；
 *   - stats（若提供）与实际 slabCount/offcutCount/offcutArea/kerfWasteArea 一致。
 */
function assertExportIntegrity(plan) {
  const slabs = plan.slabs;
  if (!Array.isArray(slabs) || slabs.length === 0) {
    throw new Error('排版结果结构非法：plans.A.slabs 应为非空数组');
  }
  const seenIndex = new Set();
  let totalOffcutArea = 0;
  let totalOffcutCount = 0;
  let totalKerfWasteArea = 0;

  slabs.forEach((slab, si) => {
    const tag = `第 ${si + 1} 块母板`;
    if (!slab || typeof slab !== 'object') throw new Error(`导出校验失败：${tag}数据无效`);
    if (slab.id == null || String(slab.id).trim() === '') {
      throw new Error(`导出校验失败：${tag}缺少母板编号`);
    }
    if (!isPositiveInt(slab.w) || !isPositiveInt(slab.h)) {
      throw new Error(`导出校验失败：${tag}(${slab.id}) 的宽高必须为正整数`);
    }
    if (!isPositiveInt(slab.index)) {
      throw new Error(`导出校验失败：${tag}(${slab.id}) 的 index 必须为正整数`);
    }
    if (seenIndex.has(slab.index)) {
      throw new Error(`导出校验失败：母板 index 重复：${slab.index}`);
    }
    seenIndex.add(slab.index);

    const placements = slab.placements || [];
    const offcuts = slab.allOffcuts || [];
    if (!Array.isArray(placements)) throw new Error(`导出校验失败：${tag} placements 应为数组`);
    if (!Array.isArray(offcuts)) throw new Error(`导出校验失败：${tag} allOffcuts 应为数组`);

    const allRects = [];
    placements.forEach((p, pi) => {
      if (!p || typeof p !== 'object') throw new Error(`导出校验失败：${tag}第 ${pi + 1} 个成品无效`);
      if (typeof p.id !== 'string' || !p.id.trim()) throw new Error(`导出校验失败：${tag}成品缺少 id`);
      if (!isNonNegInt(p.x) || !isNonNegInt(p.y) || !isPositiveInt(p.w) || !isPositiveInt(p.h)) {
        throw new Error(`导出校验失败：${tag}成品 ${p.id} 坐标或尺寸非法`);
      }
      if (p.x + p.w > slab.w || p.y + p.h > slab.h) {
        throw new Error(`导出校验失败：${tag}成品 ${p.id} 越出母板边界`);
      }
      allRects.push({ ...p, kind: '成品', label: p.instance || p.id });
    });

    const seenOffcutId = new Set();
    offcuts.forEach((o, oi) => {
      if (!o || typeof o !== 'object') throw new Error(`导出校验失败：${tag}第 ${oi + 1} 块空块无效`);
      if (o.id == null || String(o.id).trim() === '') throw new Error(`导出校验失败：${tag}空块缺少编号`);
      if (seenOffcutId.has(o.id)) throw new Error(`导出校验失败：${tag}空块编号重复：${o.id}`);
      seenOffcutId.add(o.id);
      if (!isNonNegInt(o.x) || !isNonNegInt(o.y) || !isPositiveInt(o.w) || !isPositiveInt(o.h)) {
        throw new Error(`导出校验失败：${tag}空块 ${o.id} 坐标或尺寸非法`);
      }
      if (o.x + o.w > slab.w || o.y + o.h > slab.h) {
        throw new Error(`导出校验失败：${tag}空块 ${o.id} 越出母板边界`);
      }
      allRects.push({ ...o, kind: '空块', label: o.id });
    });

    // 成品与空块整体互不重叠
    for (let i = 0; i < allRects.length; i += 1) {
      for (let j = i + 1; j < allRects.length; j += 1) {
        if (twoRectsOverlap(allRects[i], allRects[j])) {
          throw new Error(
            `导出校验失败：${tag}区域重叠（${allRects[i].kind}${allRects[i].label} 与 ${allRects[j].kind}${allRects[j].label}）`,
          );
        }
      }
    }

    // 面积守恒
    const placedArea = placements.reduce((s, p) => s + p.w * p.h, 0);
    const offArea = offcuts.reduce((s, o) => s + o.w * o.h, 0);
    const kerfArea = Number(slab.kerfWasteArea) || 0;
    if (!Number.isInteger(kerfArea) || kerfArea < 0) {
      throw new Error(`导出校验失败：${tag}(${slab.id}) 刀片损耗面积非法`);
    }
    if (placedArea + offArea + kerfArea !== slab.w * slab.h) {
      throw new Error(
        `导出校验失败：${tag}(${slab.id}) 面积不守恒（成品${placedArea}+空块${offArea}+刀片损耗${kerfArea}≠母板${slab.w * slab.h}）`,
      );
    }
    totalOffcutArea += offArea;
    totalOffcutCount += offcuts.length;
    totalKerfWasteArea += kerfArea;
  });

  // stats 一致性（若提供）
  const stats = plan.stats;
  if (stats && typeof stats === 'object') {
    if (stats.slabCount != null && stats.slabCount !== slabs.length) {
      throw new Error(`导出校验失败：stats.slabCount(${stats.slabCount}) 与实际母板数(${slabs.length})不一致`);
    }
    if (stats.offcutCount != null && stats.offcutCount !== totalOffcutCount) {
      throw new Error(`导出校验失败：stats.offcutCount(${stats.offcutCount}) 与实际空块数(${totalOffcutCount})不一致`);
    }
    if (stats.offcutArea != null && Math.abs(Number(stats.offcutArea) - totalOffcutArea) > 1e-6) {
      throw new Error(`导出校验失败：stats.offcutArea(${stats.offcutArea}) 与实际空块面积(${totalOffcutArea})不一致`);
    }
    if (stats.kerfWasteArea != null && Math.abs(Number(stats.kerfWasteArea) - totalKerfWasteArea) > 1e-6) {
      throw new Error(`导出校验失败：stats.kerfWasteArea(${stats.kerfWasteArea}) 与实际刀片损耗面积(${totalKerfWasteArea})不一致`);
    }
  }
}

/** 从 PNG buffer 中读取像素宽高（8 字节签名 + 4 字节长度 + "IHDR" + 4 字节宽 + 4 字节高）。 */
function pngPixelSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 将 dataURL 解析为 Buffer，并校验其为合法的 PNG 图片格式。 */
function decodePngDataUrl(dataUrl, label) {
  if (typeof dataUrl !== 'string') {
    throw new Error(`图片格式错误：${label} 应为 data:image/png;base64,... 字符串`);
  }
  const match = PNG_DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    throw new Error(`图片格式错误：${label} 不是有效的 data:image/png;base64 数据`);
  }
  let buffer;
  try {
    buffer = Buffer.from(match[1], 'base64');
  } catch {
    throw new Error(`图片格式错误：${label} 的 base64 数据无法解码`);
  }
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`图片格式错误：${label} 不是有效的 PNG 图片`);
  }
  return buffer;
}

/** 依据图片宽高计算 Word 中 A4 横向页面上的最大适配尺寸（像素）。 */
function wordImageSize(buffer) {
  const { width, height } = pngPixelSize(buffer);
  const maxW = 1080;
  const maxH = 720;
  const fit = Math.min(maxW / width, maxH / height);
  return { width: Math.round(width * fit), height: Math.round(height * fit) };
}

/**
 * 根据 { result, images } 构建导出用的 docx Document。
 * 严格使用 shared/API.md 约定的数据格式：
 *   images: { A: ["data:image/png;base64,...", ...] } — 与 result.plans.A.slabs 一一对应。
 *
 * @param {{result: object, images?: object}} payload
 * @returns {Promise<import('docx').Document>}
 */
async function buildWordDocument(payload) {
  const result = resolveResult(payload);
  if (!result || !result.plans || !result.plans.A) {
    throw new Error('缺少排版结果');
  }
  const plan = result.plans.A;
  assertValidResultShape(plan);

  const slabs = plan.slabs;
  if (slabs.length === 0) {
    throw new Error('排版结果结构非法：plans.A.slabs 不能为空');
  }
  // 导出前深度完整性校验：坐标/尺寸/越界/重叠/面积守恒/编号/数量。
  assertExportIntegrity(plan);

  const images = payload && payload.images;
  const list = images && images.A;
  if (!images || !Array.isArray(list) || list.length === 0) {
    throw new Error('缺少图片');
  }
  if (list.length !== slabs.length) {
    throw new Error(`图片数量不符：排版结果共 ${slabs.length} 块母板，但收到 ${list.length} 张图片`);
  }

  const sections = slabs.map((slab, i) => {
    const buffer = decodePngDataUrl(list[i], `第 ${i + 1} 张图片`);
    return {
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 },
          margin: { top: 100, bottom: 100, left: 150, right: 150 },
        },
        verticalAlign: VerticalAlign.CENTER,
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({
            text: `${circledNumber(slab.index || i + 1)}　${slab.w}×${slab.h}mm`,
            bold: true,
            size: 40,
            font: 'Microsoft YaHei',
          })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: 'png',
            data: buffer,
            transformation: wordImageSize(buffer),
          })],
        }),
      ],
    };
  });

  return new Document({
    creator: '石材下料工具',
    title: '石材下料排版图',
    sections,
  });
}

/**
 * 生成 POST /api/export-word 的响应二进制（.docx Buffer）。
 *
 * @param {{result: object, images?: object}} payload
 * @returns {Promise<Buffer>}
 */
async function exportWord(payload) {
  const doc = await buildWordDocument(payload);
  return Packer.toBuffer(doc);
}

module.exports = {
  importParts, buildWorkbook, exportWorkbook, buildWordDocument, exportWord,
};
