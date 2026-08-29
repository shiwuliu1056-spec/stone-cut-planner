'use strict';

/**
 * server.test.js
 * 测试 backend/server.js 提供的本地 HTTP 服务。
 *
 * 覆盖：正常请求、非法请求、JSON 解析失败、未知路由、CORS、请求过大、
 * /api/solve 尚未实现。每个测试各自创建一个监听随机端口的 server 实例，
 * 测试结束后关闭，避免相互影响或残留进程。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createServer } = require('../server');

/** 启动一个新的 server 实例，监听随机端口，返回 { server, baseUrl }。 */
function startServer(options) {
  return new Promise((resolve, reject) => {
    const server = createServer(options);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

/** 关闭 server 实例，返回 Promise。 */
function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function makeResult(slabCount = 1) {
  const slabs = [];
  for (let i = 1; i <= slabCount; i += 1) {
    slabs.push({
      id: '甲', index: i, w: 2700, h: 1800,
      placements: [{ id: 'A', instance: `A-${i}`, x: 0, y: 0, w: 1400, h: 600 }],
      cuts: [],
      // 几何自洽：成品 1400×600 + 两块空块恰好铺满 2700×1800（P2-4 面积守恒）
      allOffcuts: [
        { id: 'R01', x: 1400, y: 0, w: 1300, h: 1800 },
        { id: 'R02', x: 0, y: 600, w: 1400, h: 1200 },
      ],
    });
  }
  return { plans: { A: { stats: { slabCount, offcutCount: 2 * slabCount, offcutArea: (2340000 + 1680000) * slabCount }, slabs } } };
}

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/XP8s8gAAAABJRU5ErkJggg==';

// ─────────────────────────────────────────────────────────────────────────────
// 正常请求：/api/export、/api/export-word
// ─────────────────────────────────────────────────────────────────────────────

test('POST /api/export 返回有效的 xlsx 文件流', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: makeResult(1), images: {} }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const buffer = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer); // 若不是合法 xlsx 会抛异常
    assert.equal(wb.worksheets.length, 1);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/export-word 返回有效的 docx 文件流', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export-word`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: makeResult(1), images: { A: [TINY_PNG_DATA_URL] } }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /wordprocessingml/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.ok(buffer.byteLength > 1000);
    // docx 是 zip 容器，签名为 PK
    assert.equal(buffer.subarray(0, 2).toString('ascii'), 'PK');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/import 能正确解析 Excel 并返回 parts', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('尺寸清单');
    ws.addRow(['编号', '长度', '宽度', '数量']);
    ws.addRow(['A', 1400, 600, 13]);
    const buffer = await wb.xlsx.writeBuffer();

    const res = await fetch(`${baseUrl}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.parts, [{ id: 'A', w: 1400, h: 600, qty: 13 }]);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/solve 排版计算
// ─────────────────────────────────────────────────────────────────────────────

test('POST /api/solve 合法参数返回 200 且 result.plans.A 结构符合契约', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          slabs: [{ id: '甲', w: 2700, h: 1800, limit: null }],
          overcut: 30, minOffcut: 100, sampleSide: 200, stripSide: 1000, kerf: 0, iterations: 180,
        },
        parts: [{ id: 'A', w: 1400, h: 600, qty: 13, rotatable: true }],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    // 契约：{ result: { plans: { A: { stats, slabs } } } }
    assert.ok(data.result, '应返回 result');
    assert.ok(data.result.plans, 'result 应含 plans');
    const planA = data.result.plans.A;
    assert.ok(planA, 'plans 应含 A');
    // stats 字段
    assert.equal(typeof planA.stats.slabCount, 'number');
    assert.equal(typeof planA.stats.offcutCount, 'number');
    assert.equal(typeof planA.stats.offcutArea, 'number');
    // slabs 及其元素结构
    assert.ok(Array.isArray(planA.slabs));
    assert.ok(planA.slabs.length >= 1);
    const slab = planA.slabs[0];
    assert.ok(Array.isArray(slab.placements));
    assert.ok(Array.isArray(slab.cuts));
    assert.ok(Array.isArray(slab.allOffcuts));
  } finally {
    await stopServer(server);
  }
});

test('POST /api/solve algorithm=fast 返回快切统计且不改变标准接口主结构', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          algorithm: 'fast',
          fastPreset: 'speed',
          slabs: [{ id: '甲', w: 1200, h: 200, limit: null }],
        },
        parts: [{ id: 'A', w: 200, h: 100, qty: 5, rotatable: false }],
      }),
    });
    assert.equal(res.status, 200);
    const plan = (await res.json()).result.plans.A;
    assert.equal(plan.stats.fastCut.preset, 'speed');
    assert.equal(plan.slabs[0].fastCut.cutCount, plan.slabs[0].fastCut.operations.length);
    assert.ok(Array.isArray(plan.slabs[0].cuts));
    assert.ok(Array.isArray(plan.slabs[0].allOffcuts));
  } finally {
    await stopServer(server);
  }
});

test('POST /api/solve 参数合法但无法排下全部成品时返回 400', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 单块母板但数量上限为 1，成品数量远超可排下的容量
        settings: {
          slabs: [{ id: '甲', w: 2700, h: 1800, limit: 1 }],
          overcut: 30, minOffcut: 100, sampleSide: 200, stripSide: 1000, kerf: 0, iterations: 180,
        },
        parts: [{ id: 'A', w: 1400, h: 600, qty: 50, rotatable: true }],
      }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(typeof data.error, 'string');
    assert.ok(data.error.length > 0);
    assert.equal(data.result, undefined);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/solve 缺少 settings 字段时返回 400 而不是 501', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [] }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /settings/);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/solve 携带废弃字段与不携带时核心排版结果一致', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const parts = [{ id: 'A', w: 1400, h: 600, qty: 4, rotatable: true }];
    const solveReq = (settings) => fetch(`${baseUrl}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings, parts }),
    }).then((r) => r.json());

    const clean = await solveReq({ slabs: [{ id: '甲', w: 2700, h: 1800, limit: null }] });
    const deprecated = await solveReq({
      slabs: [{ id: '甲', w: 2700, h: 1800, limit: null }],
      overcut: 9999, minOffcut: 9999, sampleSide: 9999, stripSide: 9999, kerf: 500, iterations: 1,
    });
    assert.deepEqual(deprecated.result.plans.A, clean.result.plans.A);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/solve 自定义母板 id 在响应中原样返回', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { slabs: [{ id: 'CUSTOM', w: 1000, h: 1000, limit: null }] },
        parts: [{ id: 'A', w: 400, h: 300, qty: 1, rotatable: true }],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.result.plans.A.slabs[0].id, 'CUSTOM');
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 非法请求 / JSON 解析失败
// ─────────────────────────────────────────────────────────────────────────────

test('POST /api/export 请求体不是合法 JSON 时返回 400', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /JSON/);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/export 请求体为空时返回 400', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    assert.equal(res.status, 400);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/export 缺少 result 字段时返回 400 且带错误信息', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /缺少计算结果/);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/import 上传空文件时返回 400', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc(0),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /空/);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 未知路由
// ─────────────────────────────────────────────────────────────────────────────

test('未知路由返回 404 且带错误信息', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/not-exist`, { method: 'GET' });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.match(data.error, /不存在/);
  } finally {
    await stopServer(server);
  }
});

test('已知路径但方法不匹配（GET /api/export）返回 404', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, { method: 'GET' });
    assert.equal(res.status, 404);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────

test('响应头包含 CORS 允许来源', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/not-exist`, { method: 'GET' });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  } finally {
    await stopServer(server);
  }
});

test('OPTIONS 预检请求返回 204 并带 CORS 头', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/export`, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods'), /POST/);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 请求过大
// ─────────────────────────────────────────────────────────────────────────────

test('POST /api/solve 请求体超过大小限制时返回 413', async () => {
  const { server, baseUrl } = await startServer();
  try {
    // LIMITS.solve = 5MB；构造一个明显超过限制的超大 payload
    const huge = 'x'.repeat(6 * 1024 * 1024);
    const res = await fetch(`${baseUrl}/api/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: {}, parts: [], padding: huge }),
    });
    assert.equal(res.status, 413);
    const data = await res.json();
    assert.match(data.error, /过大/);
  } finally {
    await stopServer(server);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /api/shutdown
// ─────────────────────────────────────────────────────────────────────────────

test('POST /api/shutdown 返回成功响应并触发注入的 exit 回调（不真正退出进程）', async () => {
  let exitCalled = false;
  const { server, baseUrl } = await startServer({
    exit: () => { exitCalled = true; },
  });
  try {
    const res = await fetch(`${baseUrl}/api/shutdown`, { method: 'POST' });
    assert.equal(res.status, 200);
    // 关闭动作是异步延迟触发的，等待足够时间后检查
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(exitCalled, true);
  } finally {
    // shutdown 场景下 server 可能已经在关闭中，忽略重复关闭的错误
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 更新接口
// ─────────────────────────────────────────────────────────────────────────────

test('GET /api/update/check 未配置更新地址时返回 configured:false', async () => {
  const { server, baseUrl } = await startServer();
  try {
    delete process.env.STONE_UPDATER_URL;
    process.env.STONE_UPDATER_DISABLED = '1';
    const res = await fetch(`${baseUrl}/api/update/check`, { method: 'GET' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.configured, false);
    assert.match(data.error, /未配置/);
  } finally {
    delete process.env.STONE_UPDATER_DISABLED;
    await stopServer(server);
  }
});

test('GET /api/update/progress 返回更新进度', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/update/progress`, { method: 'GET' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.phase, 'string');
    assert.equal(typeof data.percent, 'number');
  } finally {
    await stopServer(server);
  }
});
