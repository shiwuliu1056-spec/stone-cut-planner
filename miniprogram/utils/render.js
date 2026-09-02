// 网页版 ResultViewer 的轻量 Canvas 适配：几何、颜色、标签和面板布局保持同一套规则。
const PALETTE = ['#b9d7e7', '#c8dcbc', '#e2cfb7', '#c8c6e4', '#e6c0c0', '#b9ddd5', '#d8d2ae', '#c4d0df'];
const OFFCUT = { reusable: { fill: '#fde2e1', stroke: '#c53d36', text: '#9a2e2a' }, small: { fill: '#f2b2ae', stroke: '#8f2f2a', text: '#6e2522' } };

function colorFor(id) {
  let hash = 0;
  for (let i = 0; i < String(id || '').length; i += 1) hash = ((hash << 5) - hash + String(id || '').charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function offcutColors(item) { return item && item.reusable ? OFFCUT.reusable : OFFCUT.small; }

function groupByDimensions(items) {
  const groups = new Map();
  (items || []).forEach((item) => {
    const rawW = Math.round(Number(item.w) || 0), rawH = Math.round(Number(item.h) || 0);
    const w = Math.max(rawW, rawH), h = Math.min(rawW, rawH), key = `${w}×${h}`;
    if (!groups.has(key)) groups.set(key, { w, h, count: 0, items: [] });
    const group = groups.get(key); group.count += 1; group.items.push(item);
  });
  return [...groups.values()].sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w || b.h - a.h);
}

function compactIds(items, placement) {
  const ids = [...new Set((items || []).map((item) => String((placement ? (item.id || item.instance) : item.id) || '').replace(/-/g, '')).filter(Boolean))];
  if (ids.length <= 1) return ids[0] || '';
  const numbered = ids.map((id) => id.match(/^(.*?)(\d+)$/));
  if (numbered.every(Boolean) && numbered.every((m) => m[1] === numbered[0][1])) {
    const values = numbered.map((m) => Number(m[2])).sort((a, b) => a - b);
    if (values.every((value, i) => i === 0 || value === values[i - 1] + 1)) {
      const width = numbered[0][2].length;
      const first = String(values[0]).padStart(width, '0');
      const last = String(values[values.length - 1]).padStart(width, '0');
      return `${numbered[0][1]}${first}–${numbered[0][1]}${last}`;
    }
  }
  return ids.length > 4 ? `${ids.slice(0, 3).join('、')}等${ids.length}项` : ids.join('、');
}

function groupLabel(group, placement) {
  const id = compactIds(group.items, placement);
  return `${id ? `${id}  ` : ''}${group.w}×${group.h} = ${group.count}`;
}

function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function arrow(ctx, x, y, direction) {
  const d = 18;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (direction === 'L' ? d : direction === 'R' ? -d : -10), y + (direction === 'U' ? d : direction === 'D' ? -d : -10));
  ctx.moveTo(x, y); ctx.lineTo(x + (direction === 'L' ? d : direction === 'R' ? -d : 10), y + (direction === 'U' ? d : direction === 'D' ? -d : 10)); ctx.stroke();
}

function mergeCutSegments(cuts) {
  const eps = 1e-6, groups = new Map();
  (cuts || []).forEach((cut) => {
    const horizontal = Math.abs(cut.y1 - cut.y2) < eps;
    const key = `${horizontal ? 'H' : 'V'}:${horizontal ? cut.y1 : cut.x1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(horizontal
      ? [Math.min(cut.x1, cut.x2), Math.max(cut.x1, cut.x2), cut.y1]
      : [Math.min(cut.y1, cut.y2), Math.max(cut.y1, cut.y2), cut.x1]);
  });
  const merged = [];
  groups.forEach((segments, key) => {
    segments.sort((a, b) => a[0] - b[0]);
    const union = [];
    segments.forEach((segment) => {
      if (union.length && segment[0] <= union[union.length - 1][1] + eps) union[union.length - 1][1] = Math.max(union[union.length - 1][1], segment[1]);
      else union.push([...segment]);
    });
    union.forEach(([lo, hi, fixed]) => {
      if (key[0] === 'H') merged.push({ x1: lo, y1: fixed, x2: hi, y2: fixed });
      else merged.push({ x1: fixed, y1: lo, x2: fixed, y2: hi });
    });
  });
  return merged;
}

function drawCutLine(ctx, X, Y, x1, y1, x2, y2, offcuts, placements) {
  const eps = 1e-6, dx = x2 - x1, dy = y2 - y1, intervals = [];
  const tAt = (value, axis) => (axis === 'x' ? (value - x1) / (dx || eps) : (value - y1) / (dy || eps));
  (offcuts || []).forEach((r) => {
    let lo = 0, hi = 0;
    if (Math.abs(dy) < eps) {
      if (y1 <= r.y + eps || y1 >= r.y + r.h - eps || Math.max(x1, x2) <= r.x + eps || Math.min(x1, x2) >= r.x + r.w - eps) return;
      lo = (r.x - x1) / dx; hi = (r.x + r.w - x1) / dx;
    } else {
      if (x1 <= r.x + eps || x1 >= r.x + r.w - eps || Math.max(y1, y2) <= r.y + eps || Math.min(y1, y2) >= r.y + r.h - eps) return;
      lo = (r.y - y1) / dy; hi = (r.y + r.h - y1) / dy;
    }
    intervals.push([Math.max(0, Math.min(lo, hi)), Math.min(1, Math.max(lo, hi))]);
  });
  (placements || []).forEach((p) => {
    if (Math.abs(dy) < eps) {
      if (Math.abs(y1 - p.y) < eps || Math.abs(y1 - (p.y + p.h)) < eps) intervals.push([Math.max(0, Math.min(tAt(p.x, 'x'), tAt(p.x + p.w, 'x'))), Math.min(1, Math.max(tAt(p.x, 'x'), tAt(p.x + p.w, 'x')))]);
    } else if (Math.abs(x1 - p.x) < eps || Math.abs(x1 - (p.x + p.w)) < eps) {
      intervals.push([Math.max(0, Math.min(tAt(p.y, 'y'), tAt(p.y + p.h, 'y'))), Math.min(1, Math.max(tAt(p.y, 'y'), tAt(p.y + p.h, 'y')))]);
    }
  });
  intervals.sort((a, b) => a[0] - b[0]);
  const blocked = [];
  intervals.forEach((iv) => { if (blocked.length && iv[0] <= blocked[blocked.length - 1][1] + eps) blocked[blocked.length - 1][1] = Math.max(blocked[blocked.length - 1][1], iv[1]); else blocked.push(iv); });
  let cursor = 0;
  const drawSegment = (a, b) => { if (b - a > eps) line(ctx, X(x1 + dx * a), Y(y1 + dy * a), X(x1 + dx * b), Y(y1 + dy * b)); };
  blocked.forEach(([a, b]) => { drawSegment(cursor, a); cursor = Math.max(cursor, b); });
  drawSegment(cursor, 1);
}

function drawPlacementLabel(ctx, x, y, w, h, placement) {
  const label = `${String(placement.instance || placement.id || '').replace(/-/g, '')}  ${Math.round(placement.w)} × ${Math.round(placement.h)}${placement.shortage ? `（少${Math.round(placement.shortage)}mm）` : ''}`;
  const horizontal = w >= h;
  ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y + 4, Math.max(0, w - 8), Math.max(0, h - 8)); ctx.clip();
  ctx.fillStyle = '#243741'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 48px sans-serif';
  const maxWidth = Math.max(8, horizontal ? w - 12 : h - 12);
  const fontSize = Math.max(10, Math.min(48, (horizontal ? h : w) * 0.62, 48 * maxWidth / Math.max(1, ctx.measureText(label).width)));
  ctx.font = `600 ${fontSize}px sans-serif`;
  if (horizontal) ctx.fillText(label, x + w / 2, y + h / 2);
  else { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); }
  ctx.restore();
}

function drawPanelList(ctx, options) {
  const { title, items, label, getColor, panelX, panelY, panelW, sectionH, titleFont } = options;
  ctx.fillStyle = '#29483f'; ctx.font = `700 ${titleFont}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(title, panelX + 28, panelY + 62);
  const listTop = panelY + 124, listHeight = Math.max(20, sectionH - 144);
  const baseFontSize = 52;
  ctx.font = `600 ${baseFontSize}px sans-serif`;
  const maxLabelWidth = items.reduce((max, item, index) => Math.max(max, ctx.measureText(label(item, index)).width), 0);
  const rows = Math.max(1, Math.floor(listHeight / 64));
  const columns = Math.max(1, Math.ceil(items.length / rows));
  const actualRows = Math.max(1, Math.ceil(items.length / columns));
  const colW = (panelW - 56) / columns;
  const lineHeight = Math.max(32, Math.min(72, listHeight / actualRows));
  const widthFit = maxLabelWidth > 0 ? Math.min(1, colW / maxLabelWidth) : 1;
  const fontSize = Math.max(16, Math.min(baseFontSize, lineHeight * 0.72, baseFontSize * widthFit));
  items.forEach((item, index) => {
    const col = Math.floor(index / actualRows), row = index % actualRows;
    ctx.fillStyle = getColor(item); ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.fillText(label(item, index), panelX + 26 + col * colW, listTop + row * lineHeight);
  });
}

function drawSlab(canvas, slab) {
  if (!canvas || !slab) return;
  const ctx = canvas.getContext('2d');
  const offcuts = slab.allOffcuts || slab.reusableOffcuts || [], placements = slab.placements || [];
  const movedIds = new Set();
  (slab.cuts || []).forEach((cut) => placements.forEach((p) => {
    const left = Math.min(cut.x1, cut.x2), right = Math.max(cut.x1, cut.x2), top = Math.min(cut.y1, cut.y2), bottom = Math.max(cut.y1, cut.y2);
    const through = cut.x1 === cut.x2
      ? (cut.x1 > p.x + 1e-6 && cut.x1 < p.x + p.w - 1e-6 && bottom > p.y + 1e-6 && top < p.y + p.h - 1e-6)
      : (cut.y1 === cut.y2 && cut.y1 > p.y + 1e-6 && cut.y1 < p.y + p.h - 1e-6 && right > p.x + 1e-6 && left < p.x + p.w - 1e-6);
    if (through) movedIds.add(p.instance);
  }));
  const TARGET_SLAB_H = 1500, scale = TARGET_SLAB_H / slab.h, slabW = slab.w * scale, slabH = slab.h * scale;
  const padL = 130, gap = 80, padR = 40, titleH = 210, bottomH = 80;
  const offcutGroups = groupByDimensions(offcuts), placementGroups = groupByDimensions(placements);
  ctx.font = '700 38px sans-serif';
  const panelW = Math.ceil(ctx.measureText('全部余料尺寸（100）块').width + 56);
  const W = Math.ceil(padL + slabW + gap + panelW + padR), H = Math.ceil(titleH + slabH + bottomH), CANVAS_W = 3000, CANVAS_H = 2121;
  canvas.width = CANVAS_W; canvas.height = CANVAS_H; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const fit = Math.min((CANVAS_W - 120) / W, (CANVAS_H - 120) / H), offX = (CANVAS_W - W * fit) / 2, offY = (CANVAS_H - H * fit) / 2;
  ctx.translate(offX, offY); ctx.scale(fit, fit);
  const ox = padL, oy = titleH, X = (x) => ox + x * scale, Y = (y) => oy + y * scale;
  ctx.fillStyle = '#edeeee'; ctx.fillRect(ox, oy, slabW, slabH);
  const compactOffcuts = [];
  offcuts.forEach((item) => {
    const x = X(item.x), y = Y(item.y), w = item.w * scale, h = item.h * scale, colors = offcutColors(item);
    ctx.fillStyle = colors.fill; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#9aa4a9'; ctx.lineWidth = 3; ctx.setLineDash([12, 9]); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
    if (w > 150 && h > 80) { ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4)); ctx.clip(); ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const font = Math.max(20, Math.min(34, w / 4.5, h / 2.5)); ctx.font = `700 ${font}px sans-serif`; ctx.fillText(item.id || '余料', x + w / 2, y + h / 2 - font * 0.55); ctx.font = `500 ${Math.max(18, font * 0.72)}px sans-serif`; ctx.fillText(`${Math.round(item.w)}×${Math.round(item.h)}`, x + w / 2, y + h / 2 + font * 0.65); ctx.restore(); }
    else compactOffcuts.push({ item, x: x + w / 2, y: y + h / 2 });
  });
  placements.forEach((item) => { const x = X(item.x), y = Y(item.y), w = item.w * scale, h = item.h * scale, moved = movedIds.has(item.instance); ctx.globalAlpha = moved ? 0.35 : 1; ctx.fillStyle = colorFor(item.id); ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#334956'; ctx.lineWidth = 5; ctx.setLineDash(moved ? [14, 10] : []); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); drawPlacementLabel(ctx, x, y, w, h, item); ctx.globalAlpha = 1; });
  ctx.strokeStyle = '#233844'; ctx.lineWidth = 6; ctx.strokeRect(ox, oy, slabW, slabH); const center = ox + slabW / 2;
  ctx.font = '700 44px sans-serif'; ctx.fillStyle = '#233844'; ctx.textAlign = 'center'; ctx.fillText(`${slab.id || ''}板 ${slab.index}`, center, oy - 190); ctx.font = '500 32px sans-serif'; ctx.fillStyle = '#65757d'; ctx.fillText(`母板 ${slab.w} × ${slab.h} mm · ${placements.length} 件`, center, oy - 135);
  ctx.strokeStyle = '#526873'; ctx.fillStyle = '#526873'; ctx.lineWidth = 3; const dimY = oy - 76; line(ctx, ox, dimY, ox + slabW, dimY); arrow(ctx, ox, dimY, 'L'); arrow(ctx, ox + slabW, dimY, 'R'); line(ctx, ox, dimY - 24, ox, oy); line(ctx, ox + slabW, dimY - 24, ox + slabW, oy); ctx.font = '700 36px sans-serif'; ctx.fillText(`${slab.w} mm`, center, dimY - 20);
  const dimX = ox - 84; line(ctx, dimX, oy, dimX, oy + slabH); arrow(ctx, dimX, oy, 'U'); arrow(ctx, dimX, oy + slabH, 'D'); line(ctx, dimX - 24, oy, ox, oy); line(ctx, dimX - 24, oy + slabH, ox, oy + slabH); ctx.save(); ctx.translate(dimX - 24, oy + slabH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`${slab.h} mm`, 0, -16); ctx.restore();
  ctx.lineWidth = 2.4; ctx.strokeStyle = '#263b45aa'; mergeCutSegments(slab.cuts || []).forEach((cut) => drawCutLine(ctx, X, Y, cut.x1, cut.y1, cut.x2, cut.y2, offcuts, placements));
  compactOffcuts.forEach(({ item, x, y }) => { const colors = offcutColors(item); ctx.beginPath(); ctx.fillStyle = '#ffffffee'; ctx.strokeStyle = colors.stroke; ctx.lineWidth = 4; ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = colors.text; ctx.font = '700 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(item.id, x, y + 1); });
  const panelX = ox + slabW + gap, panelY = oy, panelH = slabH; ctx.fillStyle = '#f7f9f8'; ctx.strokeStyle = '#ccd5d1'; ctx.lineWidth = 4; ctx.fillRect(panelX, panelY, panelW, panelH); ctx.strokeRect(panelX, panelY, panelW, panelH);
  const dividerY = panelY + Math.round(panelH * 0.5); ctx.strokeStyle = '#ccd5d1'; ctx.lineWidth = 3; line(ctx, panelX + 18, dividerY, panelX + panelW - 18, dividerY);
  ctx.font = '700 40px sans-serif'; const titleZoom = Math.min(2, (panelW - 56) / Math.max(1, ctx.measureText(`全部余料（${offcuts.length}块）`).width)), titleFont = Math.round(40 * titleZoom);
  drawPanelList(ctx, { title: `全部下料（${placements.length}件）`, items: placementGroups, label: (group) => groupLabel(group, true), getColor: () => '#8f2f2a', panelX, panelY, panelW, sectionH: dividerY - panelY, titleFont });
  drawPanelList(ctx, { title: `全部余料（${offcuts.length}块）`, items: offcutGroups, label: (group) => groupLabel(group, false), getColor: (group) => offcutColors(group).text, panelX, panelY: dividerY + 8, panelW, sectionH: panelY + panelH - dividerY - 8, titleFont });
}

module.exports = { drawSlab };
