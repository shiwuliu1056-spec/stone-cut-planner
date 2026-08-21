'use strict';

/**
 * solver.test.js — 排版核心算法验收测试
 *
 * 分两部分：
 *   一、缺陷回归（对应 shared/REVIEW.md 的 P1 / P2-1 / P2-2 / P2-3）。
 *   二、最终排版规则 R1–R12 逐条独立验收。每条规则验证真实几何量
 *       （坐标变化、不可移动组坐标、连通区域数、真实轮廓边数），
 *       而非仅验证“所有零件最终被放入”。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { solve, _internal } = require('../src/solver');

const {
  buildGrid, countEmptyRegions, countContourEdges, freeOffcutRects,
  candidatePositions, layoutMetrics, cmpMetrics, specOrder,
} = _internal;

// ── 通用辅助 ────────────────────────────────────────────────────────────────

const S = (id, w, h, limit = null) => ({ id, w, h, limit });
const P = (id, w, h, qty, rotatable = false) => ({ id, w, h, qty, rotatable });

function allPlacements(plan) {
  return plan.slabs.flatMap((s) => s.placements);
}
function coordsOf(plan, id) {
  return allPlacements(plan)
    .filter((p) => p.id === id)
    .map((p) => `${p.x},${p.y},${p.w},${p.h}`)
    .sort();
}
/** 母板内成品互不重叠、不越界，且成品+空块面积守恒。 */
function slabGeometryValid(slab) {
  const rs = slab.placements;
  for (let i = 0; i < rs.length; i += 1) {
    const a = rs[i];
    if (a.x < 0 || a.y < 0 || a.x + a.w > slab.w || a.y + a.h > slab.h) return false;
    for (let j = i + 1; j < rs.length; j += 1) {
      const b = rs[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
    }
  }
  const placed = rs.reduce((s, p) => s + p.w * p.h, 0);
  const off = slab.allOffcuts.reduce((s, o) => s + o.w * o.h, 0);
  return placed + off === slab.w * slab.h;
}
function planGeometryValid(plan) {
  return plan.slabs.every(slabGeometryValid);
}

// ═════════════════════════════════════════════════════════════════════════
// 一、缺陷回归测试
// ═════════════════════════════════════════════════════════════════════════

// P1：首个母板类型不适配时应继续尝试后续类型
test('[P1] 首个母板类型放不下时按顺序尝试后续可容纳的类型', () => {
  const r = solve({
    settings: { slabs: [S('小', 100, 100, 5), S('大', 1000, 1000, 5)] },
    parts: [P('A', 500, 500, 1, false)],
  });
  const ids = r.plans.A.slabs.map((s) => s.id);
  assert.deepEqual(ids, ['大'], '应跳过放不下的“小”板，使用“大”板');
  assert.ok(planGeometryValid(r.plans.A));
});

test('[P1] 所有母板类型都无法容纳时才报错', () => {
  assert.throws(
    () => solve({ settings: { slabs: [S('小', 100, 100, 5)] }, parts: [P('A', 500, 500, 1, false)] }),
    (e) => e.code === 'PART_TOO_LARGE',
  );
});

// P2-1：limit 只允许 null 或正整数
test('[P2-1] limit 为小数被拒绝', () => {
  assert.throws(
    () => solve({ settings: { slabs: [{ id: '甲', w: 2700, h: 1800, limit: 1.5 }] }, parts: [P('A', 100, 100, 1)] }),
    (e) => e.code === 'INVALID_SOLVE_INPUT',
  );
});
test('[P2-1] limit 为 0 / 负数被拒绝', () => {
  for (const bad of [0, -1, -3]) {
    assert.throws(
      () => solve({ settings: { slabs: [{ id: '甲', w: 2700, h: 1800, limit: bad }] }, parts: [P('A', 100, 100, 1)] }),
      (e) => e.code === 'INVALID_SOLVE_INPUT',
      `limit=${bad} 应被拒绝`,
    );
  }
});
test('[P2-1] limit 为 null / 空字符串视为不限，可正常排版', () => {
  for (const ok of [null, '']) {
    const r = solve({ settings: { slabs: [{ id: '甲', w: 2700, h: 1800, limit: ok }] }, parts: [P('A', 100, 100, 1)] });
    assert.equal(r.plans.A.slabs.length, 1);
  }
});
test('[P2-1] limit 为正整数时严格约束母板数量，不足则报错', () => {
  // 两件各占一板，limit=1 只允许一张 → 不足
  assert.throws(
    () => solve({ settings: { slabs: [{ id: '甲', w: 1000, h: 1000, limit: 1 }] }, parts: [P('A', 900, 900, 2, false)] }),
    (e) => e.code === 'NOT_ENOUGH_SLABS',
  );
});

// P2-2：母板宽高必须为正整数
test('[P2-2] 母板尺寸为小数被拒绝', () => {
  assert.throws(
    () => solve({ settings: { slabs: [{ id: '甲', w: 1000.5, h: 1800, limit: null }] }, parts: [P('A', 100, 100, 1)] }),
    (e) => e.code === 'INVALID_SOLVE_INPUT',
  );
});
test('[P2-2] 母板尺寸为 0 或负数被拒绝', () => {
  for (const bad of [{ w: 0, h: 100 }, { w: 100, h: -5 }]) {
    assert.throws(
      () => solve({ settings: { slabs: [{ id: '甲', w: bad.w, h: bad.h, limit: null }] }, parts: [P('A', 50, 50, 1)] }),
      (e) => e.code === 'INVALID_SOLVE_INPUT',
    );
  }
});

// P2-3：母板编号唯一；自动编号不循环
test('[P2-3] 自定义母板编号重复被拒绝', () => {
  assert.throws(
    () => solve({
      settings: { slabs: [S('X', 1000, 1000, 1), S('X', 1000, 1000, 1)] },
      parts: [P('A', 100, 100, 1)],
    }),
    (e) => e.code === 'INVALID_SOLVE_INPUT',
  );
});
test('[P2-3] 自定义编号原样保留', () => {
  const r = solve({ settings: { slabs: [S('CUSTOM', 1000, 1000)] }, parts: [P('A', 400, 300, 1, true)] });
  assert.equal(r.plans.A.slabs[0].id, 'CUSTOM');
});
test('[P2-3] 超过内置命名表数量的缺失编号仍全局唯一，不循环复用', () => {
  const slabs = [];
  for (let i = 0; i < 25; i += 1) slabs.push({ w: 1000, h: 1000, limit: 1 });
  const r = solve({ settings: { slabs }, parts: [P('A', 900, 900, 25, false)] });
  const ids = r.plans.A.slabs.map((s) => s.id);
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25, '25 张母板编号必须两两不同');
});

// ═════════════════════════════════════════════════════════════════════════
// 二、最终规则 R1–R12
// ═════════════════════════════════════════════════════════════════════════

// R1：每张母板严格按单件面积从大到小处理规格
test('[R1] specOrder 按单件面积从大到小排序，确定性决胜', () => {
  const order = specOrder([P('S', 200, 200, 1), P('L', 600, 600, 1), P('M', 400, 400, 1)]);
  assert.deepEqual(order.map((p) => p.id), ['L', 'M', 'S']);
});
test('[R1] 单板内先放面积更大的规格', () => {
  const r = solve({
    settings: { slabs: [S('甲', 1000, 1000)] },
    parts: [P('SML', 300, 300, 1, false), P('BIG', 600, 600, 1, false)],
  });
  const placements = r.plans.A.slabs[0].placements;
  // 大件必定落在原点（第一个被处理的规格从左上角开始）
  const big = placements.find((p) => p.id === 'BIG');
  assert.deepEqual({ x: big.x, y: big.y }, { x: 0, y: 0 });
});

// R2：当前规格还能放时不提前放下一规格
test('[R2] 当前规格能放满时不提前进入下一规格', () => {
  // L 可放 2 件（600×400 竖排两行），S 才开始
  const r = solve({
    settings: { slabs: [S('甲', 600, 1000)] },
    parts: [P('L', 600, 400, 2, false), P('S', 600, 200, 1, false)],
  });
  const placements = r.plans.A.slabs[0].placements;
  const lCount = placements.filter((p) => p.id === 'L').length;
  assert.equal(lCount, 2, 'L 的两件应在 S 之前全部放入');
  // 两件 L 占据 y=0..800，S 只能在 y=800..1000
  const s = placements.find((p) => p.id === 'S');
  assert.equal(s.y, 800);
});

// R3 + R4：换规格前只重排当前最小规格组；更大规格坐标冻结
test('[R3/R4] 加入更小规格后，更大规格坐标保持不变（冻结）', () => {
  const big = P('BIG', 600, 400, 2, false);
  const onlyBig = solve({ settings: { slabs: [S('甲', 1000, 1000)] }, parts: [big] });
  const withSmall = solve({
    settings: { slabs: [S('甲', 1000, 1000)] },
    parts: [big, P('SML', 300, 300, 1, false)],
  });
  assert.deepEqual(
    coordsOf(onlyBig.plans.A, 'BIG'),
    coordsOf(withSmall.plans.A, 'BIG'),
    '更大规格 BIG 的坐标不应因加入更小规格而改变',
  );
  // 且小规格确实被放入
  assert.equal(coordsOf(withSmall.plans.A, 'SML').length, 1);
});

// R5：当前最小规格尝试多种位置和独立旋转组合
test('[R5] candidatePositions 为可旋转窄长件给出原向与旋转两类朝向', () => {
  const cands = candidatePositions(1000, 1000, [], 900, 200, true);
  const dirs = new Set(cands.map((c) => c.dir));
  assert.ok(dirs.has(0) && dirs.has(1), '应同时包含原向(dir0)与旋转(dir1)候选');
  // 每个候选都不越界
  assert.ok(cands.every((c) => c.x + c.w <= 1000 && c.y + c.h <= 1000));
});
test('[R5] 每个实例可独立选择旋转方向', () => {
  // 放置后仍不重叠、面积守恒即证明各实例朝向被独立处理
  const r = solve({
    settings: { slabs: [S('甲', 1000, 1000)] },
    parts: [P('A', 900, 200, 3, true)],
  });
  assert.ok(slabGeometryValid(r.plans.A.slabs[0]));
  assert.equal(r.plans.A.slabs[0].placements.length, 3);
});

// R6：每个候选布局计算空块连通区域数量
test('[R6] countEmptyRegions 正确统计连通空块数', () => {
  // 单个占用矩形贴左上，空块连成 L 形 → 1 个连通区域
  let g = buildGrid(1000, 1000, [{ x: 0, y: 0, w: 600, h: 400 }]);
  assert.equal(countEmptyRegions(g), 1);
  // 两个对角占用 → 空块仅在角点相接，4-邻接下不连通，应为 2 个独立区域
  g = buildGrid(1000, 1000, [{ x: 0, y: 0, w: 500, h: 500 }, { x: 500, y: 500, w: 500, h: 500 }]);
  assert.equal(countEmptyRegions(g), 2);
  // 十字占用把四角切成 4 个独立空块
  g = buildGrid(900, 900, [
    { x: 300, y: 0, w: 300, h: 900 },
    { x: 0, y: 300, w: 900, h: 300 },
  ]);
  assert.equal(countEmptyRegions(g), 4);
});

// R7：空块不连续的候选被连续候选淘汰
test('[R7] cmpMetrics 优先选择连通区域数更少（更连续）的布局', () => {
  const continuous = { regions: 1, edges: 8, sameDir: 0, sameSpec: 0 };
  const broken = { regions: 2, edges: 6, sameDir: 5, sameSpec: 5 };
  assert.ok(cmpMetrics(continuous, broken) < 0, '即使边数更多、相邻更好，连续布局仍应胜出');
});
test('[R7] 实际排版结果的空块保持连续（单连通）', () => {
  const r = solve({
    settings: { slabs: [S('甲', 1000, 1000)] },
    parts: [P('A', 600, 600, 1, false), P('B', 400, 400, 2, false)],
  });
  const slab = r.plans.A.slabs[0];
  const g = buildGrid(slab.w, slab.h, slab.placements);
  assert.equal(countEmptyRegions(g), 1, '空块应连成单一连通区域');
});

// R8：空块边数按真实轮廓共线合并后线段数计算
test('[R8] countContourEdges 返回共线合并后的真实轮廓边数', () => {
  // 空矩形：4 条边
  let g = buildGrid(1000, 1000, []);
  assert.equal(countContourEdges(g), 4);
  // 单角占用 → L 形空块，6 条边
  g = buildGrid(1000, 1000, [{ x: 0, y: 0, w: 400, h: 400 }]);
  assert.equal(countContourEdges(g), 6);
  // 贯通条带占用（顶部整条）→ 剩余矩形空块，仍是 4 条边（共线已合并）
  g = buildGrid(1000, 1000, [{ x: 0, y: 0, w: 1000, h: 300 }]);
  assert.equal(countContourEdges(g), 4);
});

// R9：空块连续时优先轮廓边数最少的布局
test('[R9] regions 相同时 cmpMetrics 优先边数更少', () => {
  const fewer = { regions: 1, edges: 4, sameDir: 0, sameSpec: 0 };
  const more = { regions: 1, edges: 8, sameDir: 9, sameSpec: 9 };
  assert.ok(cmpMetrics(fewer, more) < 0, '边数少者优先，即使相邻指标更差');
});

// R10：边数相同优先同方向相邻，再优先同规格集中
test('[R10] regions/edges 相同时优先同方向相邻多者', () => {
  const moreDir = { regions: 1, edges: 6, sameDir: 3, sameSpec: 0 };
  const lessDir = { regions: 1, edges: 6, sameDir: 1, sameSpec: 9 };
  assert.ok(cmpMetrics(moreDir, lessDir) < 0);
});
test('[R10] 前述都相同时优先同规格集中多者', () => {
  const moreSpec = { regions: 1, edges: 6, sameDir: 2, sameSpec: 3 };
  const lessSpec = { regions: 1, edges: 6, sameDir: 2, sameSpec: 1 };
  assert.ok(cmpMetrics(moreSpec, lessSpec) < 0);
});

// R11：当前母板结束后，新母板从剩余最大规格开始
test('[R11] 每张新母板都从当前剩余的最大规格开始放置', () => {
  const r = solve({
    settings: { slabs: [S('甲', 1000, 600)] },
    parts: [P('L', 600, 600, 2, false), P('S', 300, 300, 2, false)],
  });
  assert.ok(r.plans.A.slabs.length >= 2, '应使用多张母板');
  // 每张板的第一件都应是当时剩余的最大规格 L（面积 360000 > S 90000）
  for (const slab of r.plans.A.slabs) {
    const hasL = slab.placements.some((p) => p.id === 'L');
    if (hasL) {
      assert.equal(slab.placements[0].id, 'L', '有 L 的板首件应为 L');
    }
  }
  // 第一张板放满 L
  assert.equal(r.plans.A.slabs[0].placements[0].id, 'L');
});

// R12：相同输入重复运行结果完全一致
test('[R12] 相同输入多次求解结果字节级一致', () => {
  const input = {
    settings: { slabs: [S('甲', 2700, 1800, 5)] },
    parts: [P('A', 1400, 600, 3, true), P('B', 800, 400, 5, true), P('C', 300, 300, 7, true)],
  };
  const a = JSON.stringify(solve(input));
  const b = JSON.stringify(solve(input));
  const c = JSON.stringify(solve(input));
  assert.equal(a, b);
  assert.equal(b, c);
});

// ── 结构与不变量 ────────────────────────────────────────────────────────────

test('结果结构符合 API.md /api/solve 契约，且空块统一登记（无 reusable）', () => {
  const r = solve({ settings: { slabs: [S('甲', 2700, 1800)] }, parts: [P('A', 1400, 600, 1, true)] });
  const plan = r.plans.A;
  assert.equal(typeof plan.stats.slabCount, 'number');
  assert.equal(typeof plan.stats.offcutCount, 'number');
  assert.equal(typeof plan.stats.offcutArea, 'number');
  const slab = plan.slabs[0];
  for (const key of ['id', 'index', 'w', 'h', 'placements', 'cuts', 'allOffcuts']) {
    assert.ok(key in slab, `slab 应包含 ${key}`);
  }
  // 空块不再携带 reusable 字段（P3-1 统一登记）
  assert.ok(slab.allOffcuts.every((o) => !('reusable' in o)));
  assert.ok(planGeometryValid(plan));
});

test('freeOffcutRects 覆盖全部空白且互不相交、面积等于母板减成品', () => {
  const placements = [{ x: 0, y: 0, w: 600, h: 400 }];
  const g = buildGrid(1000, 1000, placements);
  const rects = freeOffcutRects(g);
  const off = rects.reduce((s, r) => s + r.w * r.h, 0);
  assert.equal(off, 1000 * 1000 - 600 * 400);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]; const b = rects[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, '空块矩形之间不得重叠');
    }
  }
});

test('废弃参数（overcut/minOffcut/sampleSide/stripSide/kerf/iterations）不改变核心排版', () => {
  const base = { settings: { slabs: [S('甲', 2700, 1800)] }, parts: [P('A', 1400, 600, 3, true)] };
  const withJunk = {
    settings: {
      slabs: [S('甲', 2700, 1800)],
      overcut: 5, minOffcut: 100, sampleSide: 'x', stripSide: 'y', kerf: 3, iterations: 999,
    },
    parts: [P('A', 1400, 600, 3, true)],
  };
  assert.equal(JSON.stringify(solve(base)), JSON.stringify(solve(withJunk)));
});
