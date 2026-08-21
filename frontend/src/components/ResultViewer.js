"use client";

import { useRef, useEffect } from "react";
import { useStore } from "@/store";

// 将颜色生成和绘图逻辑抽取到独立函数中
function colorFor(id) {
  let hash = 0; 
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const palette = ['#b9d7e7', '#c8dcbc', '#e2cfb7', '#c8c6e4', '#e6c0c0', '#b9ddd5', '#d8d2ae', '#c4d0df'];
  return palette[Math.abs(hash) % palette.length];
}

const OFFCUT_COLORS = {
  reusable: { fill: '#fde2e1', stroke: '#c53d36', text: '#9a2e2a' },
  small: { fill: '#f2b2ae', stroke: '#8f2f2a', text: '#6e2522' },
};

function offcutColors(offcut) {
  return offcut.reusable ? OFFCUT_COLORS.reusable : OFFCUT_COLORS.small;
}

function line(ctx, x1, y1, x2, y2) { 
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); 
}

function arrow(ctx, x, y, direction) {
  const d = 18; ctx.beginPath(); ctx.moveTo(x, y); 
  ctx.lineTo(x + (direction === 'L' ? d : direction === 'R' ? -d : -10), y + (direction === 'U' ? d : direction === 'D' ? -d : -10)); 
  ctx.moveTo(x, y); 
  ctx.lineTo(x + (direction === 'L' ? d : direction === 'R' ? -d : 10), y + (direction === 'U' ? d : direction === 'D' ? -d : 10)); 
  ctx.stroke();
}

function mergeCutSegments(cuts) {
  const eps = 1e-6;
  const groups = new Map();
  for (const cut of cuts) {
    if (Math.abs(cut.y1 - cut.y2) < eps) {
      const key = `H:${cut.y1}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([Math.min(cut.x1, cut.x2), Math.max(cut.x1, cut.x2), cut.y1]);
    } else {
      const key = `V:${cut.x1}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([Math.min(cut.y1, cut.y2), Math.max(cut.y1, cut.y2), cut.x1]);
    }
  }
  const merged = [];
  for (const [key, segments] of groups) {
    segments.sort((a, b) => a[0] - b[0]);
    const union = [];
    for (const [lo, hi, fixed] of segments) {
      if (union.length && lo <= union[union.length - 1][1] + eps) union[union.length - 1][1] = Math.max(union[union.length - 1][1], hi);
      else union.push([lo, hi, fixed]);
    }
    for (const [lo, hi, fixed] of union) {
      if (key[0] === 'H') merged.push({ x1: lo, y1: fixed, x2: hi, y2: fixed });
      else merged.push({ x1: fixed, y1: lo, x2: fixed, y2: hi });
    }
  }
  return merged;
}

function drawCutLine(ctx, X, Y, x1, y1, x2, y2, offcuts, placements) {
  const eps = 1e-6;
  const dx = x2 - x1, dy = y2 - y1;
  const intervals = [];
  for (const r of offcuts) {
    let lo = 0, hi = 0;
    if (Math.abs(dy) < eps) { 
      if (y1 <= r.y + eps || y1 >= r.y + r.h - eps) continue;
      if (Math.max(x1, x2) <= r.x + eps || Math.min(x1, x2) >= r.x + r.w - eps) continue;
      const s0 = (r.x - x1) / dx, s1 = (r.x + r.w - x1) / dx;
      lo = Math.min(s0, s1); hi = Math.max(s0, s1);
    } else { 
      if (x1 <= r.x + eps || x1 >= r.x + r.w - eps) continue;
      if (Math.max(y1, y2) <= r.y + eps || Math.min(y1, y2) >= r.y + r.h - eps) continue;
      const s0 = (r.y - y1) / dy, s1 = (r.y + r.h - y1) / dy;
      lo = Math.min(s0, s1); hi = Math.max(s0, s1);
    }
    const c0 = Math.max(0, lo), c1 = Math.min(1, hi);
    if (c1 - c0 > eps) intervals.push([c0, c1]);
  }
  
  const tAt = (value, axis) => (axis === 'x' ? (value - x1) / (dx || eps) : (value - y1) / (dy || eps));
  for (const p of placements) {
    if (Math.abs(dy) < eps) { 
      if (Math.abs(y1 - p.y) < eps || Math.abs(y1 - (p.y + p.h)) < eps) {
        const t0 = Math.min(tAt(p.x, 'x'), tAt(p.x + p.w, 'x'));
        const t1 = Math.max(tAt(p.x, 'x'), tAt(p.x + p.w, 'x'));
        const c0 = Math.max(0, t0), c1 = Math.min(1, t1);
        if (c1 - c0 > eps) intervals.push([c0, c1]);
      }
    } else { 
      if (Math.abs(x1 - p.x) < eps || Math.abs(x1 - (p.x + p.w)) < eps) {
        const t0 = Math.min(tAt(p.y, 'y'), tAt(p.y + p.h, 'y'));
        const t1 = Math.max(tAt(p.y, 'y'), tAt(p.y + p.h, 'y'));
        const c0 = Math.max(0, t0), c1 = Math.min(1, t1);
        if (c1 - c0 > eps) intervals.push([c0, c1]);
      }
    }
  }
  
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of intervals) {
    if (merged.length && iv[0] <= merged[merged.length - 1][1] + eps) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
    else merged.push([...iv]);
  }
  
  const drawSegment = (t0, t1) => {
    line(ctx, X(x1 + dx * t0), Y(y1 + dy * t0), X(x1 + dx * t1), Y(y1 + dy * t1));
  };
  
  let cursor = 0;
  for (const [a, b] of merged) {
    if (a - cursor > eps) drawSegment(cursor, a);
    cursor = Math.max(cursor, b);
  }
  if (1 - cursor > eps) drawSegment(cursor, 1);
}

function renderSlabCanvas(canvas, slab) {
  if (!canvas || !slab) return;
  const offcuts = slab.allOffcuts || slab.reusableOffcuts || [];
  
  const movedIds = new Set();
  for (const cut of slab.cuts || []) {
    for (const p of slab.placements) {
      const left = Math.min(cut.x1, cut.x2), right = Math.max(cut.x1, cut.x2);
      const top = Math.min(cut.y1, cut.y2), bottom = Math.max(cut.y1, cut.y2);
      const through = cut.x1 === cut.x2
        ? (cut.x1 > p.x + 1e-6 && cut.x1 < p.x + p.w - 1e-6 && bottom > p.y + 1e-6 && top < p.y + p.h - 1e-6)
        : (cut.y1 === cut.y2 && cut.y1 > p.y + 1e-6 && cut.y1 < p.y + p.h - 1e-6 && right > p.x + 1e-6 && left < p.x + p.w - 1e-6);
      if (through) movedIds.add(p.instance);
    }
  }

  const TARGET_SLAB_H = 1500;
  const scale = TARGET_SLAB_H / slab.h;
  const slabW = slab.w * scale, slabH = slab.h * scale;
  const padL = 130, gap = 80, padR = 40, titleH = 210, bottomH = 80;
  
  canvas.width = 64; canvas.height = 64;
  let ctx = canvas.getContext('2d');
  ctx.font = '600 26px sans-serif';
  
  const offcutLabel = (r, index) => `${r.id || `R${String(index + 1).padStart(2, '0')}`}  ${Math.round(r.w)}×${Math.round(r.h)}`;
  const sortedOffcuts = offcuts.slice().sort((a, b) => {
    const na = Number(String(a.id || '').replace(/\D/g, '') || 0);
    const nb = Number(String(b.id || '').replace(/\D/g, '') || 0);
    return na - nb || String(a.id || '').localeCompare(String(b.id || ''), 'zh-CN');
  });
  
  let maxLabelWidth = 0;
  for (let i = 0; i < sortedOffcuts.length; i += 1) {
    maxLabelWidth = Math.max(maxLabelWidth, ctx.measureText(offcutLabel(sortedOffcuts[i], i)).width);
  }
  
  ctx.font = '700 38px sans-serif';
  const titleWidth = ctx.measureText('全部余料尺寸（100）块').width;
  const panelW = Math.ceil(titleWidth + 56);
  
  ctx.font = '700 40px sans-serif';
  const mainTitle = `全部余料（${offcuts.length}块）`;
  const mainTitleWidth = ctx.measureText(mainTitle).width;
  const zoomK = Math.min(2.0, (panelW - 56) / mainTitleWidth);
  const panelContentTop = 130;
  const listHeight = Math.max(120, slabH - panelContentTop - 30);
  const rowsPerColumn = Math.max(1, Math.floor(listHeight / (32 * zoomK)));
  const columns = Math.max(1, Math.ceil(sortedOffcuts.length / rowsPerColumn));
  const actualRows = Math.max(1, Math.ceil(sortedOffcuts.length / columns));
  const lineHeight = Math.max(14, Math.min(46 * zoomK, listHeight / actualRows));
  const colW = (panelW - 56) / columns;
  const maxFit = maxLabelWidth > 0 ? Math.min(1, colW / maxLabelWidth) : 1;
  const fontSize = Math.max(14, Math.min(32 * zoomK, 26 * maxFit * zoomK));
  
  const W = Math.ceil(padL + slabW + gap + panelW + padR);
  const H = Math.ceil(titleH + slabH + bottomH);
  
  const CANVAS_W = 3000, CANVAS_H = 2121;
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  
  const fit = Math.min((CANVAS_W - 120) / W, (CANVAS_H - 120) / H);
  const offX = (CANVAS_W - W * fit) / 2, offY = (CANVAS_H - H * fit) / 2;
  ctx.translate(offX, offY); ctx.scale(fit, fit);
  
  const ox = padL, oy = titleH;
  const X = (x) => ox + x * scale, Y = (y) => oy + y * scale;
  ctx.fillStyle = '#edeeee'; ctx.fillRect(ox, oy, slabW, slabH);
  
  const compactOffcuts = [];
  for (const r of offcuts) {
    const x = X(r.x), y = Y(r.y), w = r.w * scale, h = r.h * scale;
    const colors = offcutColors(r);
    ctx.fillStyle = colors.fill; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#9aa4a9'; ctx.lineWidth = 3; ctx.setLineDash([12, 9]);
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    if (w > 150 && h > 80) {
      ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4)); ctx.clip();
      ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const offcutFont = Math.max(20, Math.min(34, w / 4.5, h / 2.5)); ctx.font = `700 ${offcutFont}px sans-serif`;
      ctx.fillText(r.id || '余料', x + w / 2, y + h / 2 - offcutFont * .55);
      ctx.font = `500 ${Math.max(18, offcutFont * .72)}px sans-serif`; ctx.fillText(`${Math.round(r.w)}×${Math.round(r.h)}`, x + w / 2, y + h / 2 + offcutFont * .65); 
      ctx.restore();
    } else compactOffcuts.push({ r, x: x + w / 2, y: y + h / 2 });
  }
  
  for (const p of slab.placements) {
    const x = X(p.x), y = Y(p.y), w = p.w * scale, h = p.h * scale;
    const moved = movedIds.has(p.instance);
    ctx.globalAlpha = moved ? 0.35 : 1;
    ctx.fillStyle = colorFor(p.id); ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#334956'; ctx.lineWidth = 5;
    if (moved) ctx.setLineDash([14, 10]); else ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y + 4, Math.max(0, w - 8), Math.max(0, h - 8)); ctx.clip();
    ctx.fillStyle = '#243741'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fontSize = Math.max(24, Math.min(48, w / 7, h / 3.4)); ctx.font = `700 ${fontSize}px sans-serif`;
    ctx.fillText(String(p.instance || p.id || '').replace(/-/g, ''), x + w / 2, y + h / 2 - fontSize * .55);
    ctx.font = `500 ${Math.max(22, fontSize * .72)}px sans-serif`; ctx.fillText(`${Math.round(p.w)} × ${Math.round(p.h)}`, x + w / 2, y + h / 2 + fontSize * .55); 
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  
  ctx.strokeStyle = '#233844'; ctx.lineWidth = 6; ctx.strokeRect(ox, oy, slab.w * scale, slab.h * scale);
  const drawingCenter = ox + slab.w * scale / 2;
  ctx.font = '700 44px sans-serif'; ctx.fillStyle = '#233844'; ctx.textAlign = 'center'; 
  ctx.fillText(`${slab.id || ''}板 ${slab.index}`, drawingCenter, oy - 190);
  ctx.font = '500 32px sans-serif'; ctx.fillStyle = '#65757d'; 
  ctx.fillText(`母板 ${slab.w} × ${slab.h} mm · ${slab.placements.length} 件`, drawingCenter, oy - 135);
  
  ctx.strokeStyle = '#526873'; ctx.fillStyle = '#526873'; ctx.lineWidth = 3;
  const dimY = oy - 76; 
  line(ctx, ox, dimY, ox + slab.w * scale, dimY); 
  arrow(ctx, ox, dimY, 'L'); 
  arrow(ctx, ox + slab.w * scale, dimY, 'R'); 
  line(ctx, ox, dimY - 24, ox, oy); 
  line(ctx, ox + slab.w * scale, dimY - 24, ox + slab.w * scale, oy); 
  ctx.font = '700 36px sans-serif'; ctx.textAlign = 'center'; 
  ctx.fillText(`${slab.w} mm`, ox + slab.w * scale / 2, dimY - 20);
  
  const dimX = ox - 84; 
  line(ctx, dimX, oy, dimX, oy + slab.h * scale); 
  arrow(ctx, dimX, oy, 'U'); 
  arrow(ctx, dimX, oy + slab.h * scale, 'D'); 
  line(ctx, dimX - 24, oy, ox, oy); 
  line(ctx, dimX - 24, oy + slab.h * scale, ox, oy + slab.h * scale); 
  ctx.save(); ctx.translate(dimX - 24, oy + slab.h * scale / 2); ctx.rotate(-Math.PI / 2); 
  ctx.fillText(`${slab.h} mm`, 0, -16); ctx.restore();
  
  ctx.lineWidth = 2.4; ctx.strokeStyle = '#263b45aa'; ctx.fillStyle = '#263b45'; ctx.font = '600 24px sans-serif';
  for (const cut of mergeCutSegments(slab.cuts)) {
    drawCutLine(ctx, X, Y, cut.x1, cut.y1, cut.x2, cut.y2, offcuts, slab.placements);
  }
  
  for (const marker of compactOffcuts) {
    const colors = offcutColors(marker.r);
    ctx.beginPath(); ctx.fillStyle = '#ffffffee'; ctx.strokeStyle = colors.stroke; ctx.lineWidth = 4; 
    ctx.arc(marker.x, marker.y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = colors.text; ctx.font = '700 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; 
    ctx.fillText(marker.r.id, marker.x, marker.y + 1);
  }
  
  const panelTop = oy, panelH = slabH;
  const panelX = ox + slabW + gap, panelY = panelTop;
  ctx.fillStyle = '#f7f9f8'; ctx.strokeStyle = '#ccd5d1'; ctx.lineWidth = 4; ctx.setLineDash([]); 
  ctx.fillRect(panelX, panelY, panelW, panelH); ctx.strokeRect(panelX, panelY, panelW, panelH);
  
  ctx.fillStyle = '#29483f'; ctx.font = `700 ${Math.round(40 * zoomK)}px sans-serif`; 
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; 
  ctx.fillText(mainTitle, panelX + 28, panelY + 62);
  
  const listTop = panelY + 110;
  sortedOffcuts.forEach((r, index) => {
    const col = Math.floor(index / actualRows), row = index % actualRows;
    const tx = panelX + 26 + col * colW, ty = listTop + row * lineHeight;
    ctx.fillStyle = offcutColors(r).text; ctx.font = `600 ${fontSize}px sans-serif`; ctx.textAlign = 'left';
    ctx.fillText(offcutLabel(r, index), tx, ty);
  });
}

// 独立的 Canvas 渲染组件
function SlabCanvas({ slab }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current && slab) {
      renderSlabCanvas(canvasRef.current, slab);
    }
  }, [slab]);

  return (
    <div className="bg-slate-100 p-6 rounded-lg overflow-hidden flex items-center justify-center">
      <canvas 
        ref={canvasRef} 
        className="w-full h-auto max-h-[600px] object-contain drop-shadow-md rounded bg-white"
      />
    </div>
  );
}

export function ResultViewer() {
  const { result } = useStore();

  if (!result || !result.plans || !result.plans.A) {
    return null;
  }

  const plan = result.plans.A;
  const s = plan.stats;

  const formatArea = (mm2) => `${(mm2 / 1e6).toFixed(3)} ㎡`;

  return (
    <section id="results-section" className="mt-8 animate-in fade-in slide-in-from-bottom-8 duration-500">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <span className="text-xs font-semibold text-emerald-600 tracking-wider">03 / 结果</span>
            <h2 className="text-xl font-bold text-slate-800 mt-1 flex items-center gap-3">
              切割方案
              <span className="text-sm font-normal px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100">
                先大后小 · 余料集中
              </span>
            </h2>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 bg-slate-50/50">
          <div className="bg-white p-5 rounded-lg border border-slate-100 shadow-sm flex flex-col">
            <span className="text-slate-500 text-sm font-medium mb-1">母板数量</span>
            <strong className="text-3xl font-bold text-slate-800">{s.slabCount}</strong>
          </div>
          <div className="bg-white p-5 rounded-lg border border-slate-100 shadow-sm flex flex-col">
            <span className="text-slate-500 text-sm font-medium mb-1">余料块数</span>
            <strong className="text-3xl font-bold text-slate-800">{s.offcutCount}</strong>
          </div>
          <div className="bg-white p-5 rounded-lg border border-slate-100 shadow-sm flex flex-col">
            <span className="text-slate-500 text-sm font-medium mb-1">余料总面积</span>
            <strong className="text-3xl font-bold text-slate-800">{formatArea(s.offcutArea)}</strong>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {plan.slabs.map((slab, i) => (
          <article key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <header className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <strong className="text-lg text-slate-800">
                {slab.id || ''}板 {slab.index} <span className="text-slate-400 font-normal mx-2">·</span> {slab.w} × {slab.h} mm
              </strong>
              <span className="text-sm text-slate-600 bg-white px-3 py-1 rounded-md border border-slate-200">
                包含 {slab.placements.length} 件成品 / {slab.allOffcuts?.length ?? 0} 块余料
              </span>
            </header>
            <div className="p-4">
              <SlabCanvas slab={slab} />
            </div>
            <div className="px-6 pb-4 pt-2 flex items-center justify-end gap-6 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-[#c4d0df] border-2 border-[#334956] rounded-sm"></div>
                成品
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-[#fde2e1] border-2 border-[#c53d36] rounded-sm border-dashed"></div>
                余料
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
