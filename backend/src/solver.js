'use strict';

/**
 * solver.js — 石材下料自动排版算法（真实几何搜索实现）
 *
 * 严格按 shared/API.md 的 /api/solve 契约实现矩形排版，纯计算、无 IO。
 * 导出：solve({ settings, parts }) -> { plans: { A: { stats, slabs } } }
 *
 * 最终排版规则（本文件逐条真实实现，对应函数见括号）：
 *   R1  每张母板严格按单件面积从大到小处理规格。            —— specOrder()/solve()
 *   R2  当前规格还能放时不提前放下一规格。                  —— solve() 内 feasibleCount + 逐规格循环
 *   R3  换规格前，只重新排列当前（最后放入）规格组。          —— solve()：frozen 只含更大规格
 *   R4  比当前规格更大的成品坐标保持不变。                    —— solve()：frozen 冻结不参与搜索
 *   R5  当前规格尝试多种位置和独立旋转组合。                  —— searchLayout()（DFS + 每实例独立 dir）
 *   R6  每个候选布局计算空块连通区域数量。                    —— countEmptyRegions()
 *   R7  空块不连续的候选被连续候选淘汰。                      —— cmpMetrics()：regions 升序优先
 *   R8  空块边数按真实轮廓共线合并后线段数计算。              —— countContourEdges()
 *   R9  空块连续时优先轮廓边数最少的布局。                    —— cmpMetrics()：edges 升序
 *   R10 边数相同时优先同方向相邻，再优先同规格集中。          —— cmpMetrics()：sameDir/adj 降序
 *   R11 当前母板结束后，新母板从剩余最大规格开始。            —— solve() 外层 while + specOrder()
 *   R12 相同输入重复运行结果完全一致。                        —— 全程确定性排序 + layoutKey 决胜
 *
 * 说明：刀片宽度固定按 4mm 计入相邻成品之间的损耗；sampleSide / stripSide /
 *       minOffcut / overcut / iterations 等旧字段仍被忽略。
 *       所有未使用区域统一登记为空块（offcut），不区分“可保留/小余料”。
 */

const NAMED_IDS = [
  '甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸',
  '子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥',
];

const EPS = 1e-9;

// 确定性搜索预算：单次 solve 内所有布局搜索展开的状态总数上限。
// 超过后布局搜索停止扩展并使用已找到的最优完整布局（贪心兜底保证仍有解）。
const MAX_SEARCH_STATES = 200000;
const KERF_MM = 4;
const FAST_MOVE_CLEARANCE_MM = 100;

function area(r) { return r.w * r.h; }

// ─────────────────────────────────────────────────────────────────────────────
// maxrects 自由矩形：用于生成候选放置位置（左上角贴靠）
// ─────────────────────────────────────────────────────────────────────────────

function rectsOverlap(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS
      && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

function containsRect(a, b) { // a 完全包含 b
  return a.x <= b.x + EPS && a.y <= b.y + EPS
      && a.x + a.w >= b.x + b.w - EPS && a.y + a.h >= b.y + b.h - EPS;
}

function splitFree(free, used) {
  if (!rectsOverlap(free, used)) return [free];
  const res = [];
  if (used.x > free.x + EPS) res.push({ x: free.x, y: free.y, w: used.x - free.x, h: free.h });
  if (used.x + used.w < free.x + free.w - EPS) {
    res.push({ x: used.x + used.w, y: free.y, w: free.x + free.w - (used.x + used.w), h: free.h });
  }
  if (used.y > free.y + EPS) res.push({ x: free.x, y: free.y, w: free.w, h: used.y - free.y });
  if (used.y + used.h < free.y + free.h - EPS) {
    res.push({ x: free.x, y: used.y + used.h, w: free.w, h: free.y + free.h - (used.y + used.h) });
  }
  return res;
}

function pruneContained(list) {
  const uniq = [];
  for (const r of list) {
    if (r.w <= EPS || r.h <= EPS) continue;
    if (!uniq.some((u) => Math.abs(u.x - r.x) < EPS && Math.abs(u.y - r.y) < EPS
      && Math.abs(u.w - r.w) < EPS && Math.abs(u.h - r.h) < EPS)) uniq.push(r);
  }
  const out = [];
  for (let i = 0; i < uniq.length; i += 1) {
    let contained = false;
    for (let j = 0; j < uniq.length; j += 1) {
      if (i !== j && containsRect(uniq[j], uniq[i])) { contained = true; break; }
    }
    if (!contained) out.push(uniq[i]);
  }
  return out;
}

function reservedRect(W, H, placement) {
  return {
    ...placement,
    w: placement.w + (placement.x + placement.w < W - EPS ? KERF_MM : 0),
    h: placement.h + (placement.y + placement.h < H - EPS ? KERF_MM : 0),
  };
}

function buildFreeRects(W, H, placements) {
  let free = [{ x: 0, y: 0, w: W, h: H }];
  for (const p of placements) {
    const reserved = reservedRect(W, H, p);
    const next = [];
    for (const f of free) {
      if (rectsOverlap(f, reserved)) next.push(...splitFree(f, reserved));
      else next.push(f);
    }
    free = pruneContained(next);
  }
  return free;
}

/** 两个成品在投影相交时，必须至少留出固定刀口间隙。 */
function kerfConflict(a, b) {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX > EPS && overlapY > EPS) return true;
  if (overlapY > EPS) {
    const separated = a.x + a.w + KERF_MM <= b.x + EPS
      || b.x + b.w + KERF_MM <= a.x + EPS;
    if (!separated) return true;
  }
  if (overlapX > EPS) {
    const separated = a.y + a.h + KERF_MM <= b.y + EPS
      || b.y + b.h + KERF_MM <= a.y + EPS;
    if (!separated) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 坐标压缩网格：真实连通区域数（R6）与真实轮廓边数（R8）
// ─────────────────────────────────────────────────────────────────────────────

function buildGrid(W, H, placements, extraRects = []) {
  const xs = new Set([0, W]);
  const ys = new Set([0, H]);
  for (const p of [...placements, ...extraRects]) {
    xs.add(p.x); xs.add(p.x + p.w); ys.add(p.y); ys.add(p.y + p.h);
  }
  const xa = [...xs].sort((a, b) => a - b);
  const ya = [...ys].sort((a, b) => a - b);
  const nx = xa.length - 1;
  const ny = ya.length - 1;
  const occ = Array.from({ length: nx }, () => new Array(ny).fill(false));
  for (const p of [...placements, ...extraRects]) {
    for (let i = 0; i < nx; i += 1) {
      if (xa[i] >= p.x - EPS && xa[i + 1] <= p.x + p.w + EPS) {
        for (let j = 0; j < ny; j += 1) {
          if (ya[j] >= p.y - EPS && ya[j + 1] <= p.y + p.h + EPS) occ[i][j] = true;
        }
      }
    }
  }
  return { xa, ya, nx, ny, occ };
}

function occupiedArea(g) {
  let total = 0;
  for (let i = 0; i < g.nx; i += 1) {
    for (let j = 0; j < g.ny; j += 1) {
      if (g.occ[i][j]) total += (g.xa[i + 1] - g.xa[i]) * (g.ya[j + 1] - g.ya[j]);
    }
  }
  return total;
}

/** 根据相邻成品之间的 4mm 刀片宽度生成不可回收的刀片损耗区域。 */
function deriveKerfRects(placements) {
  const rects = [];
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i], b = placements[j];
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX > EPS) {
        if (Math.abs(a.y + a.h + KERF_MM - b.y) < EPS) {
          rects.push({ x: Math.max(a.x, b.x), y: a.y + a.h, w: overlapX, h: KERF_MM });
        } else if (Math.abs(b.y + b.h + KERF_MM - a.y) < EPS) {
          rects.push({ x: Math.max(a.x, b.x), y: b.y + b.h, w: overlapX, h: KERF_MM });
        }
      }
      if (overlapY > EPS) {
        if (Math.abs(a.x + a.w + KERF_MM - b.x) < EPS) {
          rects.push({ x: a.x + a.w, y: Math.max(a.y, b.y), w: KERF_MM, h: overlapY });
        } else if (Math.abs(b.x + b.w + KERF_MM - a.x) < EPS) {
          rects.push({ x: b.x + b.w, y: Math.max(a.y, b.y), w: KERF_MM, h: overlapY });
        }
      }
    }
  }

  // 两条互相垂直的刀路在拐角处也会相交。若只登记每条刀路与成品
  // 边缘之间的长条，会在四块成品的交叉点留下一个 4×4 的小空格，
  // 随后被 freeOffcutRects 误认为是余料。对四种对角相邻关系补上
  // 这个不可回收的刀片宽度方块。
  const seenCorners = new Set();
  const addCorner = (x, y) => {
    const key = `${x},${y}`;
    if (seenCorners.has(key)) return;
    seenCorners.add(key);
    rects.push({ x, y, w: KERF_MM, h: KERF_MM });
  };
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i], b = placements[j];
      const aRight = Math.abs(a.x + a.w + KERF_MM - b.x) < EPS;
      const bRight = Math.abs(b.x + b.w + KERF_MM - a.x) < EPS;
      const aBelow = Math.abs(a.y + a.h + KERF_MM - b.y) < EPS;
      const bBelow = Math.abs(b.y + b.h + KERF_MM - a.y) < EPS;
      if (aRight && aBelow) addCorner(a.x + a.w, a.y + a.h);
      if (aRight && bBelow) addCorner(a.x + a.w, b.y + b.h);
      if (bRight && aBelow) addCorner(b.x + b.w, a.y + a.h);
      if (bRight && bBelow) addCorner(b.x + b.w, b.y + b.h);
    }
  }

  // 当一块成品同时贴着横向和纵向刀路时，刀路可能被另一块成品的
  // 边界分成两段。此时两条 4mm 长条只在端点相遇，同样会留下
  // 4×4 小空格（例如三列两行成品旁边再接一块竖料）。补齐所有
  // 横向/纵向刀路端点的相交方块，避免任何刀粉区域漏进余料。
  const horizontalStrips = rects.filter((r) => r.h === KERF_MM && r.w > KERF_MM + EPS);
  const verticalStrips = rects.filter((r) => r.w === KERF_MM && r.h > KERF_MM + EPS);
  for (const h of horizontalStrips) {
    for (const v of verticalStrips) {
      const touchX = Math.abs(v.x - (h.x + h.w)) < EPS || Math.abs((v.x + KERF_MM) - h.x) < EPS;
      const touchY = Math.abs(h.y - (v.y + v.h)) < EPS || Math.abs((h.y + KERF_MM) - v.y) < EPS;
      if (touchX && touchY) addCorner(v.x, h.y);
    }
  }
  return rects;
}

/** R6：空块连通区域数量（自由单元 4-邻接连通分量数）。 */
function countEmptyRegions(g) {
  const { nx, ny, occ } = g;
  const seen = Array.from({ length: nx }, () => new Array(ny).fill(false));
  let count = 0;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      if (occ[i][j] || seen[i][j]) continue;
      count += 1;
      const stack = [[i, j]];
      seen[i][j] = true;
      while (stack.length) {
        const [ci, cj] = stack.pop();
        const nb = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
        for (const [ni, nj] of nb) {
          if (ni >= 0 && ni < nx && nj >= 0 && nj < ny && !occ[ni][nj] && !seen[ni][nj]) {
            seen[ni][nj] = true;
            stack.push([ni, nj]);
          }
        }
      }
    }
  }
  return count;
}

/**
 * R8：空块真实轮廓边数（共线合并后线段数）。
 * 直角多边形边数 == 顶点数；在每个网格点统计其周围 4 个单元的自由/占用奇偶性：
 *   - 奇数个自由（1 或 3）→ 该点是一个直角顶点，+1；
 *   - 对角两个自由（棋盘状）→ 两个顶点，+2。
 * 求和即为整个空块轮廓（含外环与孔洞）共线合并后的总边数。
 */
function countContourEdges(g) {
  const { nx, ny, occ } = g;
  const free = (i, j) => (i >= 0 && i < nx && j >= 0 && j < ny ? !occ[i][j] : false);
  let corners = 0;
  for (let i = 0; i <= nx; i += 1) {
    for (let j = 0; j <= ny; j += 1) {
      const tl = free(i - 1, j - 1);
      const tr = free(i, j - 1);
      const bl = free(i - 1, j);
      const br = free(i, j);
      const c = (tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0);
      if (c === 1 || c === 3) corners += 1;
      else if (c === 2 && ((tl && br && !tr && !bl) || (tr && bl && !tl && !br))) corners += 2;
    }
  }
  return corners;
}

/** 把自由单元合并为一组互不相交、面积精确覆盖的空块矩形（用于 offcut 登记）。 */
function freeOffcutRects(g) {
  const { xa, ya, nx, ny, occ } = g;
  const used = Array.from({ length: nx }, () => new Array(ny).fill(false));
  const rects = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (occ[i][j] || used[i][j]) continue;
      let i2 = i;
      while (i2 + 1 < nx && !occ[i2 + 1][j] && !used[i2 + 1][j]) i2 += 1;
      let j2 = j;
      let can = true;
      while (can && j2 + 1 < ny) {
        for (let k = i; k <= i2; k += 1) {
          if (occ[k][j2 + 1] || used[k][j2 + 1]) { can = false; break; }
        }
        if (can) j2 += 1;
      }
      for (let a = i; a <= i2; a += 1) for (let b = j; b <= j2; b += 1) used[a][b] = true;
      rects.push({ x: xa[i], y: ya[j], w: xa[i2 + 1] - xa[i], h: ya[j2 + 1] - ya[j] });
    }
  }
  return rects;
}

/** 4mm 窄条是刀片切掉的不可回收粉末，不作为余料返回。 */
function splitRecoverableOffcuts(rects) {
  const recoverable = [];
  let bladeWasteArea = 0;
  for (const rect of rects) {
    if (Math.abs(rect.w - KERF_MM) < EPS || Math.abs(rect.h - KERF_MM) < EPS) {
      bladeWasteArea += area(rect);
    } else {
      recoverable.push(rect);
    }
  }
  return { recoverable, bladeWasteArea };
}

// ─────────────────────────────────────────────────────────────────────────────
// 候选放置位置（R5：多位置 + 独立旋转）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 为一个尺寸为 (w,h) 的实例，在当前 placements 之上枚举候选放置。
 * 位置来自 maxrects 自由矩形的左上角贴靠；rotatable 时额外给出旋转朝向。
 * 返回 [{ x, y, w, h, dir }]，dir: 0 原向 / 1 旋转。已按确定性顺序排序。
 */
function candidatePositions(W, H, placements, pw, ph, rotatable) {
  const free = buildFreeRects(W, H, placements);
  const orients = [{ w: pw, h: ph, dir: 0 }];
  if (rotatable && pw !== ph) orients.push({ w: ph, h: pw, dir: 1 });
  const out = [];
  const seen = new Set();
  for (const f of free) {
    for (const o of orients) {
      let w = o.w;
      let h = o.h;
      let shortageAxis = '';
      if (w > f.w + EPS && w - f.w <= KERF_MM + EPS && Math.abs(f.x + f.w - W) < EPS) {
        w = f.w;
        shortageAxis = 'w';
      }
      if (h > f.h + EPS && h - f.h <= KERF_MM + EPS && Math.abs(f.y + f.h - H) < EPS) {
        if (shortageAxis) continue;
        h = f.h;
        shortageAxis = 'h';
      }
      if (w > f.w + EPS || h > f.h + EPS) continue;
      const cand = {
        x: f.x, y: f.y, w, h, dir: o.dir,
        ...(shortageAxis ? { requestedW: o.w, requestedH: o.h, shortage: KERF_MM, shortageAxis, terminal: true } : {}),
      };
      // 不与已放置矩形重叠（自由矩形保证，但旋转朝向需再确认）
      if (placements.some((p) => kerfConflict(cand, p))) continue;
      const key = `${cand.x},${cand.y},${cand.w},${cand.h},${cand.dir}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cand);
    }
  }
  // 确定性顺序：y 升 -> x 升 -> dir 升（左上优先）
  out.sort((a, b) => a.y - b.y || a.x - b.x || a.dir - b.dir);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 布局度量与比较（R6–R10）
// ─────────────────────────────────────────────────────────────────────────────

/** 同方向相邻对数：dir 相同且边缘相接的 placement 对数（R10 同方向相邻）。 */
function countSameDirAdjacency(placements) {
  let n = 0;
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if (a.dir !== b.dir) continue;
      const shareV = (Math.abs(a.x + a.w + KERF_MM - b.x) < EPS || Math.abs(b.x + b.w + KERF_MM - a.x) < EPS)
        && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
      const shareH = (Math.abs(a.y + a.h + KERF_MM - b.y) < EPS || Math.abs(b.y + b.h + KERF_MM - a.y) < EPS)
        && a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS;
      if (shareV || shareH) n += 1;
    }
  }
  return n;
}

/** 同规格相邻对数：同 id 且边缘相接（R10 同规格集中）。 */
function countSameSpecAdjacency(placements) {
  let n = 0;
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if (a.id !== b.id) continue;
      const shareV = (Math.abs(a.x + a.w + KERF_MM - b.x) < EPS || Math.abs(b.x + b.w + KERF_MM - a.x) < EPS)
        && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
      const shareH = (Math.abs(a.y + a.h + KERF_MM - b.y) < EPS || Math.abs(b.y + b.h + KERF_MM - a.y) < EPS)
        && a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS;
      if (shareV || shareH) n += 1;
    }
  }
  return n;
}

/** 计算一个完整布局（当前板全部 placements）的评价指标。 */
function layoutMetrics(W, H, placements) {
  const g = buildGrid(W, H, placements, deriveKerfRects(placements));
  return {
    regions: countEmptyRegions(g),          // R6/R7
    edges: countContourEdges(g),            // R8/R9
    sameDir: countSameDirAdjacency(placements),  // R10a
    sameSpec: countSameSpecAdjacency(placements), // R10b
  };
}

/**
 * 布局比较（越小越优）。严格实现规则优先级：
 *   R7 空块连通区域数少者优先（regions 升序）；
 *   R9 空块连续（regions 最少）前提下轮廓边数少者优先（edges 升序）；
 *   R10 边数相同优先同方向相邻多（sameDir 降序），再同规格集中多（sameSpec 降序）。
 * 返回负数表示 a 优于 b。
 */
function cmpMetrics(a, b) {
  if (a.regions !== b.regions) return a.regions - b.regions;
  if (a.edges !== b.edges) return a.edges - b.edges;
  if (a.sameDir !== b.sameDir) return b.sameDir - a.sameDir;
  if (a.sameSpec !== b.sameSpec) return b.sameSpec - a.sameSpec;
  return 0;
}

/** 布局坐标签名（R12 决胜：指标全等时用坐标字典序保证确定性）。 */
function layoutKey(placements) {
  return placements
    .map((p) => `${p.instance}:${p.x},${p.y},${p.w},${p.h},${p.dir}`)
    .sort()
    .join('|');
}

// ─────────────────────────────────────────────────────────────────────────────
// 单规格组布局搜索（R3/R4/R5）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 在 frozen（更大规格，坐标冻结 —— R4）之上，把 group 中的 count 个同规格实例
 * 全部放入母板 (W,H)。枚举每个实例的多个候选位置与独立旋转（R5），DFS 搜索，
 * 用 layoutMetrics/cmpMetrics 选出最优完整布局（R6–R10）。
 *
 * @returns {null | { placements, metrics }}  无法全部放入返回 null。
 */
function searchGroupLayout(W, H, frozen, group, budget) {
  const spec = group.spec;
  const rotatable = !!spec.rotatable;
  let best = null;
  let bestKey = null;

  function dfs(depth, current) {
    const maxStates = budget.maxStates || MAX_SEARCH_STATES;
    if (budget.states > maxStates) return;
    if (depth === group.instances.length) {
      const all = [...frozen, ...current];
      const metrics = layoutMetrics(W, H, all);
      const key = layoutKey(current);
      if (best === null || cmpMetrics(metrics, best.metrics) < 0
        || (cmpMetrics(metrics, best.metrics) === 0 && key < bestKey)) {
        best = { placements: current.slice(), metrics };
        bestKey = key;
      }
      return;
    }
    budget.states += 1;
    const placedSoFar = [...frozen, ...current];
    const cands = candidatePositions(W, H, placedSoFar, spec.w, spec.h, rotatable);
    if (cands.length === 0) return;
    // 若已找到完整布局，限制每层分支数以控预算（确定性：取左上优先的前若干个）。
    const branch = best === null ? cands : cands.slice(0, Math.max(4, Math.ceil(cands.length / 2)));
    for (const c of branch) {
      current.push({
        id: spec.id, instance: group.instances[depth], x: c.x, y: c.y, w: c.w, h: c.h, dir: c.dir, ...c,
      });
      dfs(depth + 1, current);
      current.pop();
      if (budget.states > maxStates && best !== null) break;
    }
  }

  dfs(0, []);
  return best;
}

/**
 * 贪心放入尽可能多的同规格实例（用于判定“当前规格还能放几件”—— R2，
 * 以及母板容量切分）。返回成功放入的 placement 数组（左上优先，确定性）。
 */
function greedyPlaceGroup(W, H, frozen, spec, instances) {
  const rotatable = !!spec.rotatable;
  const placed = [];
  for (const inst of instances) {
    const base = [...frozen, ...placed];
    const cands = candidatePositions(W, H, base, spec.w, spec.h, rotatable);
    if (cands.length === 0) break;
    const c = cands[0];
    placed.push({ id: spec.id, instance: inst, x: c.x, y: c.y, w: c.w, h: c.h, dir: c.dir, ...c });
  }
  return placed;
}

// ─────────────────────────────────────────────────────────────────────────────
// 输入校验（limit 与母板尺寸均须为正整数）
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DIM = 100000000; // 尺寸/数量安全上限

function isPosInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_DIM;
}

/** 母板 limit：null / 空字符串 / undefined 视为不限；否则必须为正整数。 */
function slabLimit(s) {
  const v = s.limit;
  if (v == null || v === '') return Infinity;
  return v; // 已在 validateInput 中确保为正整数
}

/** 业务输入校验，返回错误信息或 null。 */
function validateInput(settings, parts) {
  if (!settings || typeof settings !== 'object') return 'settings 必须是对象';
  if (!Array.isArray(settings.slabs) || settings.slabs.length === 0) {
    return 'settings.slabs 必须是非空数组';
  }
  const seenSlabId = new Set();
  for (const s of settings.slabs) {
    if (!s || typeof s !== 'object') return 'slabs 元素必须是对象';
    if (!isPosInt(s.w) || !isPosInt(s.h)) {
      return `母板 ${s.id != null ? s.id : '(未命名)'} 的宽高必须为正整数毫米`;
    }
    // limit：仅允许 null / 空字符串 / undefined（不限）或正整数
    const lv = s.limit;
    if (!(lv == null || lv === '')) {
      if (!isPosInt(lv)) {
        return `母板 ${s.id != null ? s.id : '(未命名)'} 的 limit 必须为正整数或留空表示不限`;
      }
    }
    // 自定义编号唯一性：非空 id 不得重复
    const raw = s.id;
    if (raw != null && String(raw).trim() !== '') {
      const key = String(raw);
      if (seenSlabId.has(key)) return `母板编号重复：${key}`;
      seenSlabId.add(key);
    }
  }
  if (!Array.isArray(parts) || parts.length === 0) {
    return 'parts 必须是非空数组';
  }
  const seen = new Set();
  for (const p of parts) {
    if (!p || typeof p !== 'object') return 'parts 元素必须是对象';
    if (typeof p.id !== 'string' || !p.id.trim()) return 'parts 元素缺少合法的 id';
    if (!isPosInt(p.w) || !isPosInt(p.h)) {
      return `零件 ${p.id} 的宽高必须为正整数毫米`;
    }
    if (!isPosInt(p.qty)) {
      return `零件 ${p.id} 的 qty 必须为正整数`;
    }
    if (seen.has(p.id)) return `零件 id 重复：${p.id}`;
    seen.add(p.id);
  }
  return null;
}

/** 判断矩形（含可选旋转）能否放入某个母板。 */
function fitsInSlab(slab, pw, ph, rotatable) {
  if (pw <= slab.w + EPS && ph <= slab.h + EPS) return true;
  if (rotatable && ph <= slab.w + EPS && pw <= slab.h + EPS) return true;
  return false;
}

/**
 * R1/R11：规格按单件面积从大到小排序；面积相同用尺寸与 id 决胜（确定性）。
 * 返回规格对象数组（保留原始 part 引用与剩余数量）。
 */
function specOrder(parts) {
  return [...parts].sort((a, b) => {
    const av = a.w * a.h;
    const bv = b.w * b.h;
    if (bv !== av) return bv - av;
    if (b.w !== a.w) return b.w - a.w;
    if (b.h !== a.h) return b.h - a.h;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 由 placements 生成可视化切割线：每个放置矩形与母板内部相邻处的右/下边。 */
function buildCuts(W, H, placements) {
  const cuts = [];
  const seen = new Set();
  const push = (x1, y1, x2, y2) => {
    const key = `${x1},${y1},${x2},${y2}`;
    if (!seen.has(key)) { seen.add(key); cuts.push({ x1, y1, x2, y2 }); }
  };
  for (const p of placements) {
    const right = p.x + p.w;
    const bottom = p.y + p.h;
    if (right < W - EPS) push(right, p.y, right, bottom);   // 竖切
    if (bottom < H - EPS) push(p.x, bottom, right, bottom); // 横切
  }
  return cuts;
}

/**
 * 母板编号解析器：自定义 id 原样返回；缺失 id 时生成全局唯一编号，
 * 优先使用未被占用的 NAMED_IDS，用尽后回退为 "板N" 且持续避让已用集合，
 * 绝不循环复用。
 */
function makeSlabNamer(slabs) {
  const used = new Set();
  for (const s of slabs) {
    const raw = s && s.id;
    if (raw != null && String(raw).trim() !== '') used.add(String(raw));
  }
  let namedIdx = 0;
  let seq = 0;
  return function next() {
    while (namedIdx < NAMED_IDS.length) {
      const cand = NAMED_IDS[namedIdx];
      namedIdx += 1;
      if (!used.has(cand)) { used.add(cand); return cand; }
    }
    // NAMED_IDS 用尽：用 "板N" 且避让所有已用编号
    for (;;) {
      seq += 1;
      const cand = `板${seq}`;
      if (!used.has(cand)) { used.add(cand); return cand; }
    }
  };
}

/**
 * 入口：solve({ settings, parts }) -> { plans: { A: { stats, slabs } } }。
 * 无法放下全部成品或输入非法时抛出带 code 的 Error（调用方转 4xx）。
 */
function solveStandard({ settings, parts }) {
  const invalid = validateInput(settings, parts);
  if (invalid) {
    const err = new Error(invalid);
    err.code = 'INVALID_SOLVE_INPUT';
    throw err;
  }

  const slabTypes = settings.slabs;

  // 预检：任一成品（考虑旋转）必须能被至少一种母板容纳。
  for (const p of parts) {
    if (!slabTypes.some((s) => fitsInSlab(s, p.w, p.h, !!p.rotatable))) {
      const err = new Error(`零件 ${p.id}（${p.w}x${p.h}）超出了所有可用母板尺寸，无法排版`);
      err.code = 'PART_TOO_LARGE';
      throw err;
    }
  }

  // 剩余数量（按 part.id）。
  const remaining = new Map(parts.map((p) => [p.id, p.qty]));
  const partById = new Map(parts.map((p) => [p.id, p]));
  const instanceCounter = new Map(parts.map((p) => [p.id, 0]));
  const nextInstance = (id) => {
    const n = (instanceCounter.get(id) || 0) + 1;
    instanceCounter.set(id, n);
    return `${id}-${n}`;
  };

  const usage = new Map(slabTypes.map((s) => [s, 0]));
  const namer = makeSlabNamer(slabTypes);
  const totalPieces = parts.reduce((sum, item) => sum + item.qty, 0);
  // 大批量标准排版仍沿用同一确定性搜索，但降低搜索预算，避免移动端请求长时间阻塞。
  // 小批量保持原有预算和结果质量。
  const budget = { states: 0, maxStates: totalPieces > 40 ? 20000 : MAX_SEARCH_STATES };

  const planSlabs = [];
  const stats = { slabCount: 0, offcutCount: 0, offcutArea: 0, kerfWasteArea: 0 };
  let serial = 0;

  const totalRemaining = () => [...remaining.values()].reduce((a, b) => a + b, 0);

  while (totalRemaining() > 0) {
    // R11：以“当前剩余最大规格”为准挑选一张能容纳它的母板类型。
    const order = specOrder(parts.filter((p) => remaining.get(p.id) > 0));
    const topSpec = order[0];

    // P1：按输入顺序，选第一个“仍有配额且能容纳当前最大规格”的母板类型。
    let chosen = null;
    for (const s of slabTypes) {
      if (usage.get(s) >= slabLimit(s)) continue;
      if (fitsInSlab(s, topSpec.w, topSpec.h, !!topSpec.rotatable)) { chosen = s; break; }
    }
    // 若没有类型能容纳当前最大规格，但仍有配额的类型存在，说明该规格无法在
    // 任何剩余可用板上放下（预检已排除“所有类型都装不下”的情况，这里是 limit
    // 把能装的类型耗尽）。回退到“任意有配额的类型”以放置其它更小规格。
    if (!chosen) {
      for (const s of slabTypes) {
        if (usage.get(s) < slabLimit(s)) { chosen = s; break; }
      }
    }
    if (!chosen) {
      const err = new Error(
        `母板数量（所有类型 limit 合计）不足以放下全部成品，尚余 ${totalRemaining()} 件无法入板`,
      );
      err.code = 'NOT_ENOUGH_SLABS';
      throw err;
    }

    usage.set(chosen, usage.get(chosen) + 1);
    serial += 1;
    // 自定义编号原样返回；缺失编号才生成全局唯一兜底编号。
    const rawId = chosen && chosen.id;
    const hasId = rawId != null && String(rawId).trim() !== '';
    const slabId = hasId ? String(rawId) : namer();
    const { w: W, h: H } = chosen;

    // 本张母板内逐规格放置。frozen 为已锁定的更大规格 placements（R4）。
    let frozen = [];
    const specSeq = specOrder(parts.filter((p) => remaining.get(p.id) > 0));
    for (const spec of specSeq) {
      const want = remaining.get(spec.id);
      if (want <= 0) continue;
      // R2：先贪心确定本规格在当前 frozen 之上最多能放几件。
      const probeInstances = Array.from({ length: want }, (_, k) => `probe-${k}`);
      const greedy = greedyPlaceGroup(W, H, frozen, spec, probeInstances);
      const canPlace = greedy.length;
      if (canPlace === 0) continue; // 本规格一件都放不下，尝试更小规格
      // 为将要放置的实例分配真实编号。
      const instances = Array.from({ length: canPlace }, () => nextInstance(spec.id));
      // R3/R5：只对“当前规格组”做多位置+独立旋转搜索，frozen 冻结不动（R4）。
      const group = { spec, instances };
      const found = searchGroupLayout(W, H, frozen, group, budget);
      const placedGroup = found ? found.placements : greedy.map((gp, i) => ({
        id: spec.id, instance: instances[i], x: gp.x, y: gp.y, w: gp.w, h: gp.h, dir: gp.dir, ...gp,
      }));
      frozen = [...frozen, ...placedGroup];
      remaining.set(spec.id, want - placedGroup.length);
    }

    if (frozen.length === 0) {
      // 兜底：当前板一件都放不下（理论上 P1 选板已避免），避免死循环。
      usage.set(chosen, usage.get(chosen));
      const err = new Error(`单张母板 ${slabId} 无法容纳任何剩余成品`);
      err.code = 'SINGLE_SLAB_TOO_SMALL';
      throw err;
    }

    const placements = frozen.map(({ id, instance, x, y, w, h, requestedW, requestedH, shortage, shortageAxis, terminal }) => ({
      id, instance, x, y, w, h,
      ...(terminal ? { requestedW, requestedH, shortage, shortageAxis, terminal: true } : {}),
    }));
    const kerfRects = deriveKerfRects(placements);
    const g = buildGrid(W, H, placements, kerfRects);
    const offcutSplit = splitRecoverableOffcuts(freeOffcutRects(g));
    const allOffcuts = offcutSplit.recoverable.map((r, i) => ({
      id: `R${String(i + 1).padStart(2, '0')}`, x: r.x, y: r.y, w: r.w, h: r.h,
    }));
    const offcutArea = allOffcuts.reduce((sum, o) => sum + o.w * o.h, 0);
    const placedArea = placements.reduce((sum, p) => sum + p.w * p.h, 0);
    const kerfWasteArea = occupiedArea(g) - placedArea + offcutSplit.bladeWasteArea;

    planSlabs.push({
      id: slabId,
      index: serial,
      w: W,
      h: H,
      placements,
      cuts: buildCuts(W, H, frozen),
      allOffcuts,
      kerfWasteArea,
    });
    stats.slabCount += 1;
    stats.offcutCount += allOffcuts.length;
    stats.offcutArea += offcutArea;
    stats.kerfWasteArea += kerfWasteArea;
  }

  return { plans: { A: { stats, slabs: planSlabs } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 快切算法：严格矩形块切（guillotine packing）
// ─────────────────────────────────────────────────────────────────────────────

const FAST_PRESETS = Object.freeze({
  material: { label: '节省材料', utilizationTarget: 0.90 },
  balanced: { label: '平衡', utilizationTarget: 0.80 },
  speed: { label: '优先快切', utilizationTarget: 0.70 },
});

function fastPresetConfig(value) {
  return FAST_PRESETS[value] || FAST_PRESETS.balanced;
}

function fastDimensionKey(item) {
  const w = Math.max(Number(item.w) || 0, Number(item.h) || 0);
  const h = Math.min(Number(item.w) || 0, Number(item.h) || 0);
  return `${w}×${h}`;
}

function touchesSameSize(region, item, placements) {
  const key = fastDimensionKey(item);
  return placements.some((p) => {
    if (fastDimensionKey(p) !== key) return false;
    const overlapX = Math.min(region.x + region.w, p.x + p.w) - Math.max(region.x, p.x);
    const overlapY = Math.min(region.y + region.h, p.y + p.h) - Math.max(region.y, p.y);
    const nearX = Math.abs(region.x + region.w + KERF_MM - p.x) < EPS
      || Math.abs(p.x + p.w + KERF_MM - region.x) < EPS;
    const nearY = Math.abs(region.y + region.h + KERF_MM - p.y) < EPS
      || Math.abs(p.y + p.h + KERF_MM - region.y) < EPS;
    return (nearX && overlapY > EPS) || (nearY && overlapX > EPS);
  });
}

function isUsableRemainder(value) {
  return value <= EPS || value >= KERF_MM - EPS;
}

/**
 * 把一个待加工件放在当前矩形块左上角，并枚举两种合法的贯穿切顺序：
 * 先竖后横，或先横后竖。每个返回的子块仍是完整矩形，子块之间保留 4mm
 * 刀片宽度；因此后续递归不会产生局部交叉刀路。
 */
function splitFastRegion(region, item, firstAxis) {
  const right = region.w - item.w;
  const bottom = region.h - item.h;
  if (right < -EPS || bottom < -EPS || !isUsableRemainder(right) || !isUsableRemainder(bottom)) return null;
  const placement = { id: item.id, instance: item.instance, x: region.x, y: region.y, w: item.w, h: item.h };
  const cuts = [];
  const regions = [];
  if (firstAxis === 'V') {
    if (right > EPS) {
      cuts.push({ x1: region.x + item.w, y1: region.y, x2: region.x + item.w, y2: region.y + region.h });
      regions.push({ x: region.x + item.w + KERF_MM, y: region.y, w: right - KERF_MM, h: region.h });
    }
    if (bottom > EPS) {
      cuts.push({ x1: region.x, y1: region.y + item.h, x2: region.x + item.w, y2: region.y + item.h });
      regions.push({ x: region.x, y: region.y + item.h + KERF_MM, w: item.w, h: bottom - KERF_MM });
    }
  } else {
    if (bottom > EPS) {
      cuts.push({ x1: region.x, y1: region.y + item.h, x2: region.x + region.w, y2: region.y + item.h });
      regions.push({ x: region.x, y: region.y + item.h + KERF_MM, w: region.w, h: bottom - KERF_MM });
    }
    if (right > EPS) {
      cuts.push({ x1: region.x + item.w, y1: region.y, x2: region.x + item.w, y2: region.y + item.h });
      regions.push({ x: region.x + item.w + KERF_MM, y: region.y, w: right - KERF_MM, h: item.h });
    }
  }
  const usableRegions = regions.filter((r) => r.w > EPS && r.h > EPS);
  const moveCount = usableRegions.length > 1 ? 1 : 0;
  const movedArea = moveCount ? Math.min(...usableRegions.map(area)) : 0;
  return { placement, cuts, regions: usableRegions, moveCount, movedArea };
}

/** 将空腔边界向相邻成品外侧让出 4mm，得到可安全继续切割的矩形。 */
function kerfSafePocketRegion(rect, placements) {
  const safe = { ...rect };
  const maxX = rect.x + rect.w;
  const maxY = rect.y + rect.h;
  for (const p of placements) {
    const overlapX = Math.min(maxX, p.x + p.w) - Math.max(rect.x, p.x);
    const overlapY = Math.min(maxY, p.y + p.h) - Math.max(rect.y, p.y);
    if (overlapX > EPS && p.y + p.h <= safe.y + EPS) {
      const nextY = p.y + p.h + KERF_MM;
      if (nextY > safe.y && nextY < maxY + EPS) { safe.y = nextY; safe.h = maxY - nextY; }
    } else if (overlapX > EPS && p.y >= safe.y + safe.h - EPS) {
      const nextBottom = p.y - KERF_MM;
      if (nextBottom < safe.y + safe.h && nextBottom > rect.y - EPS) safe.h = nextBottom - safe.y;
    }
    if (overlapY > EPS && p.x + p.w <= safe.x + EPS) {
      const nextX = p.x + p.w + KERF_MM;
      if (nextX > safe.x && nextX < maxX + EPS) { safe.x = nextX; safe.w = maxX - nextX; }
    } else if (overlapY > EPS && p.x >= safe.x + safe.w - EPS) {
      const nextRight = p.x - KERF_MM;
      if (nextRight < safe.x + safe.w && nextRight > rect.x - EPS) safe.w = nextRight - safe.x;
    }
  }
  return safe.w > EPS && safe.h > EPS ? safe : null;
}

/** 末端块允许沿当前方向吸收最多 4mm 刀片损耗，且只缩短一个尺寸。 */
function terminalVariants(region, item) {
  const variants = [];
  const orientations = item.rotatable && item.w !== item.h
    ? [{ w: item.w, h: item.h }, { w: item.h, h: item.w }]
    : [{ w: item.w, h: item.h }];
  for (const orientation of orientations) {
    let w = orientation.w, h = orientation.h;
    let shortageAxis = '';
    if (w > region.w + EPS && w - region.w <= KERF_MM + EPS) { w = region.w; shortageAxis = 'w'; }
    if (h > region.h + EPS && h - region.h <= KERF_MM + EPS) {
      if (shortageAxis) continue;
      h = region.h; shortageAxis = 'h';
    }
    if (w <= region.w + EPS && h <= region.h + EPS) {
      variants.push({ ...item, w, h, requestedW: orientation.w, requestedH: orientation.h, shortageAxis, shortage: shortageAxis ? KERF_MM : 0 });
    }
  }
  return variants;
}

function mergeFastCuts(cuts) {
  const groups = new Map();
  for (const cut of cuts) {
    const vertical = Math.abs(cut.x1 - cut.x2) < EPS;
    const axis = vertical ? 'V' : 'H';
    const start = vertical ? Math.min(cut.y1, cut.y2) : Math.min(cut.x1, cut.x2);
    const end = vertical ? Math.max(cut.y1, cut.y2) : Math.max(cut.x1, cut.x2);
    const fixed = vertical ? cut.x1 : cut.y1;
    const key = `${axis}:${fixed}:${start}:${end}`;
    if (!groups.has(key)) groups.set(key, {
      x1: cut.x1, y1: cut.y1, x2: cut.x2, y2: cut.y2,
      axis, length: end - start,
    });
  }
  return [...groups.values()].sort((a, b) => (
    a.axis.localeCompare(b.axis) || a.y1 - b.y1 || a.x1 - b.x1 || a.x2 - b.x2 || a.y2 - b.y2
  ));
}

function fastItemOrders(items) {
  const stable = items.map((item, index) => ({ ...item, _order: index }));
  const groups = new Map();
  for (const item of stable) {
    const key = fastDimensionKey(item);
    if (!groups.has(key)) groups.set(key, { key, items: [], first: item._order, area: area(item), max: Math.max(item.w, item.h), min: Math.min(item.w, item.h) });
    groups.get(key).items.push(item);
  }
  const flatten = (compareGroups) => [...groups.values()]
    .sort((a, b) => compareGroups(a, b) || a.first - b.first)
    .flatMap((group) => group.items.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-CN') || a._order - b._order));
  return [
    flatten((a, b) => b.area - a.area),
    flatten((a, b) => b.max - a.max || b.min - a.min),
    flatten((a, b) => b.min - a.min || b.area - a.area),
    flatten(() => 0),
  ];
}

function compareFastCandidates(a, b, target) {
  const aTarget = a.utilization + EPS >= target;
  const bTarget = b.utilization + EPS >= target;
  if (a.placedCount !== b.placedCount) return b.placedCount - a.placedCount;
  if (aTarget !== bTarget) return aTarget ? -1 : 1;
  if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount;
  if (a.cutCount !== b.cutCount) return a.cutCount - b.cutCount;
  if (Math.abs(a.movedArea - b.movedArea) > EPS) return a.movedArea - b.movedArea;
  if (Math.abs(a.utilization - b.utilization) > EPS) return b.utilization - a.utilization;
  return a.key.localeCompare(b.key);
}

function compareFastScore(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (typeof a[i] === 'string' || typeof b[i] === 'string') return String(a[i]).localeCompare(String(b[i]));
    return a[i] - b[i];
  }
  return 0;
}

/** 单个母板上的确定性快切贪心搜索，尝试多个规格顺序后选成本最低者。 */
function searchFastSlab(W, H, items, target) {
  let best = null;
  for (const order of fastItemOrders(items)) {
    const regions = [{ x: 0, y: 0, w: W, h: H }];
    const placements = [];
    const cuts = [];
    const tree = [];
    let moveCount = 0;
    let movedArea = 0;
    for (const item of order) {
      const candidates = [];
      for (let ri = 0; ri < regions.length; ri += 1) {
        const region = regions[ri];
        for (const orientedItem of terminalVariants(region, item)) {
          if (orientedItem.shortageAxis
            && !((orientedItem.shortageAxis === 'w' && Math.abs(region.x + region.w - W) < EPS)
              || (orientedItem.shortageAxis === 'h' && Math.abs(region.y + region.h - H) < EPS))) continue;
          for (const axis of ['V', 'H']) {
            const split = splitFastRegion(region, orientedItem, axis);
            if (!split) continue;
            if (orientedItem.shortageAxis) {
              split.placement.requestedW = orientedItem.requestedW;
              split.placement.requestedH = orientedItem.requestedH;
              split.placement.shortage = orientedItem.shortage;
              split.placement.shortageAxis = orientedItem.shortageAxis;
              split.placement.terminal = true;
            }
            const remainingArea = split.regions.reduce((sum, r) => sum + area(r), 0);
            const sameGroup = touchesSameSize(region, orientedItem, placements) ? 0 : 1;
            candidates.push({ ri, split, score: [sameGroup, split.moveCount, split.cuts.length, remainingArea, ri, axis] });
          }
        }
      }
      if (!candidates.length) continue;
      candidates.sort((a, b) => compareFastScore(a.score, b.score));
      const chosen = candidates[0];
      tree.push({
        type: 'split',
        axis: chosen.score[5],
        region: { ...regions[chosen.ri] },
        item: { id: chosen.split.placement.id, instance: chosen.split.placement.instance },
        children: chosen.split.regions.map((r) => ({ ...r })),
      });
      regions.splice(chosen.ri, 1, ...chosen.split.regions);
      placements.push(chosen.split.placement);
      cuts.push(...chosen.split.cuts);
      moveCount += chosen.split.moveCount;
      movedArea += chosen.split.movedArea;
      regions.sort((a, b) => area(b) - area(a) || a.y - b.y || a.x - b.x);
    }

    // 严格分块完成后再检查一次真实空腔。分离块允许被挪开，因此某些由
    // 不同分块边界围成的完整矩形空位（例如 504×800）仍然可以继续下料；
    // 这类回填按一次让位搬动计入，但不会把原有成品重新排版。
    const placedInstances = new Set(placements.map((p) => p.instance));
    let pending = order.filter((item) => !placedInstances.has(item.instance));
    while (pending.length) {
      const grid = buildGrid(W, H, placements, deriveKerfRects(placements));
      const pockets = freeOffcutRects(grid);
      const pocketCandidates = [];
      for (let pi = 0; pi < pockets.length; pi += 1) {
        const safePocket = kerfSafePocketRegion(pockets[pi], placements);
        if (!safePocket) continue;
        for (const item of pending) {
          for (const orientedItem of terminalVariants(safePocket, item)) {
            for (const axis of ['V', 'H']) {
              const split = splitFastRegion(safePocket, orientedItem, axis);
              if (!split) continue;
              // 空腔的边界可能来自已完成成品，而不是已登记的刀路；
              // 新成品仍必须与所有既有成品保持完整 4mm 刀片间隔。
              if (placements.some((p) => kerfConflict(split.placement, p))) continue;
              if (orientedItem.shortageAxis) {
                split.placement.requestedW = orientedItem.requestedW;
                split.placement.requestedH = orientedItem.requestedH;
                split.placement.shortage = orientedItem.shortage;
                split.placement.shortageAxis = orientedItem.shortageAxis;
                split.placement.terminal = true;
              }
              pocketCandidates.push({
                pi, item, split,
                score: [touchesSameSize(safePocket, orientedItem, placements) ? 0 : 1, split.cuts.length, orientedItem.shortageAxis ? 1 : 0, -area(orientedItem), pi, axis],
              });
            }
          }
        }
      }
      if (!pocketCandidates.length) break;
      pocketCandidates.sort((a, b) => compareFastScore(a.score, b.score)
        || String(a.item.instance).localeCompare(String(b.item.instance)));
      const chosen = pocketCandidates[0];
      tree.push({
        type: 'pocket-fill',
        axis: chosen.score[5],
        region: { ...kerfSafePocketRegion(pockets[chosen.pi], placements) },
        item: { id: chosen.item.id, instance: chosen.item.instance },
        children: chosen.split.regions.map((r) => ({ ...r })),
      });
      placements.push(chosen.split.placement);
      cuts.push(...chosen.split.cuts);
      // 空腔回填需要先把邻接块挪开，即使该空腔本身只剩一条切线。
      moveCount += Math.max(1, chosen.split.moveCount);
      movedArea += Math.max(area(chosen.split.placement), chosen.split.movedArea);
      placedInstances.add(chosen.item.instance);
      pending = pending.filter((item) => item.instance !== chosen.item.instance);
    }
    const mergedCuts = mergeFastCuts(cuts);
    const placedArea = placements.reduce((sum, p) => sum + area(p), 0);
    const candidate = {
      placements,
      cuts: mergedCuts,
      tree,
      placedCount: placements.length,
      moveCount,
      cutCount: mergedCuts.length,
      movedArea,
      utilization: placedArea / (W * H),
      key: placements.map((p) => `${p.id}:${p.x},${p.y},${p.w},${p.h}`).join('|'),
    };
    if (!best || compareFastCandidates(candidate, best, target) < 0) best = candidate;
  }
  return best;
}

function solveFast({ settings, parts }) {
  const invalid = validateInput(settings, parts);
  if (invalid) {
    const err = new Error(invalid);
    err.code = 'INVALID_SOLVE_INPUT';
    throw err;
  }
  const presetName = FAST_PRESETS[settings.fastPreset] ? settings.fastPreset : 'balanced';
  const preset = fastPresetConfig(presetName);
  const remaining = new Map(parts.map((p) => [p.id, p.qty]));
  const instanceCounter = new Map(parts.map((p) => [p.id, 0]));
  const usage = new Map(settings.slabs.map((s) => [s, 0]));
  const namer = makeSlabNamer(settings.slabs);
  const slabs = [];
  const stats = {
    slabCount: 0, offcutCount: 0, offcutArea: 0, kerfWasteArea: 0,
    fastCut: {
      preset: presetName,
      utilizationTarget: preset.utilizationTarget,
      moveClearance: FAST_MOVE_CLEARANCE_MM,
      moveCount: 0,
      cutCount: 0,
      terminalShortages: 0,
    },
  };
  let serial = 0;
  const totalRemaining = () => [...remaining.values()].reduce((sum, n) => sum + n, 0);
  while (totalRemaining() > 0) {
    const ordered = specOrder(parts.filter((p) => remaining.get(p.id) > 0));
    const top = ordered[0];
    let chosenSlab = null;
    for (const slab of settings.slabs) {
      if (usage.get(slab) >= slabLimit(slab)) continue;
      if (fitsInSlab(slab, top.w, top.h, !!top.rotatable)) { chosenSlab = slab; break; }
    }
    if (!chosenSlab) {
      const err = new Error(`母板数量不足，快切算法尚余 ${totalRemaining()} 件成品无法排入`);
      err.code = 'NOT_ENOUGH_SLABS';
      throw err;
    }
    const items = [];
    for (const part of parts) {
      const count = remaining.get(part.id) || 0;
      for (let i = 0; i < count; i += 1) {
        items.push({ ...part, instance: `${part.id}-${(instanceCounter.get(part.id) || 0) + i + 1}` });
      }
    }
    const candidate = searchFastSlab(chosenSlab.w, chosenSlab.h, items, preset.utilizationTarget);
    if (!candidate || candidate.placements.length === 0) {
      const err = new Error(`单张母板 ${chosenSlab.id || '(未命名)'} 无法容纳任何剩余成品`);
      err.code = 'SINGLE_SLAB_TOO_SMALL';
      throw err;
    }
    usage.set(chosenSlab, usage.get(chosenSlab) + 1);
    serial += 1;
    const counts = new Map();
    for (const placement of candidate.placements) counts.set(placement.id, (counts.get(placement.id) || 0) + 1);
    for (const [id, count] of counts) {
      remaining.set(id, remaining.get(id) - count);
      instanceCounter.set(id, (instanceCounter.get(id) || 0) + count);
    }
    const placements = candidate.placements.map(({ id, instance, x, y, w, h, requestedW, requestedH, shortage, shortageAxis, terminal }) => ({
      id, instance, x, y, w, h,
      ...(terminal ? { requestedW, requestedH, shortage, shortageAxis, terminal: true } : {}),
    }));
    const kerfRects = deriveKerfRects(placements);
    const grid = buildGrid(chosenSlab.w, chosenSlab.h, placements, kerfRects);
    const offcutSplit = splitRecoverableOffcuts(freeOffcutRects(grid));
    const allOffcuts = offcutSplit.recoverable.map((r, i) => ({
      id: `R${String(i + 1).padStart(2, '0')}`, x: r.x, y: r.y, w: r.w, h: r.h,
    }));
    const placedArea = placements.reduce((sum, p) => sum + area(p), 0);
    const offcutArea = allOffcuts.reduce((sum, o) => sum + area(o), 0);
    const kerfWasteArea = occupiedArea(grid) - placedArea + offcutSplit.bladeWasteArea;
    const rawId = chosenSlab.id;
    const slabId = rawId != null && String(rawId).trim() ? String(rawId) : namer();
    const operations = candidate.cuts.map((cut, i) => ({ ...cut, order: i + 1 }));
    const terminalShortages = placements.filter((placement) => placement.terminal && placement.shortage).length;
    const warningParts = [];
    if (candidate.utilization + EPS < preset.utilizationTarget) {
      warningParts.push(`该母板利用率 ${(candidate.utilization * 100).toFixed(1)}% 低于${preset.label}档位目标`);
    }
    if (terminalShortages) warningParts.push(`末端块按实际尺寸切割，共 ${terminalShortages} 件少 4mm`);
    const fastCut = {
      preset: presetName,
      utilizationTarget: preset.utilizationTarget,
      utilization: candidate.utilization,
      moveClearance: FAST_MOVE_CLEARANCE_MM,
      moveCount: candidate.moveCount,
      cutCount: candidate.cutCount,
      movedArea: candidate.movedArea,
      terminalShortages,
      operations,
      tree: candidate.tree,
      warning: warningParts.join('；'),
    };
    slabs.push({
      id: slabId, index: serial, w: chosenSlab.w, h: chosenSlab.h,
      placements, cuts: candidate.cuts, allOffcuts, kerfWasteArea, fastCut,
    });
    stats.slabCount += 1;
    stats.offcutCount += allOffcuts.length;
    stats.offcutArea += offcutArea;
    stats.kerfWasteArea += kerfWasteArea;
    stats.fastCut.moveCount += candidate.moveCount;
    stats.fastCut.cutCount += candidate.cutCount;
    stats.fastCut.terminalShortages += terminalShortages;
  }
  const warnings = slabs.filter((s) => s.fastCut.warning).map((s) => s.fastCut.warning);
  if (warnings.length) stats.fastCut.warning = warnings.join('；');
  return { plans: { A: { stats, slabs } } };
}

function solve(input) {
  return input && input.settings && input.settings.algorithm === 'fast'
    ? solveFast(input)
    : solveStandard(input);
}

module.exports = {
  solve,
  // 供测试直接验证几何度量（真实连通区域数 / 真实轮廓边数）。
  _internal: {
    buildGrid, countEmptyRegions, countContourEdges, freeOffcutRects, splitRecoverableOffcuts,
    candidatePositions, layoutMetrics, cmpMetrics, specOrder, validateInput,
    splitFastRegion, mergeFastCuts, searchFastSlab, solveFast,
  },
};
