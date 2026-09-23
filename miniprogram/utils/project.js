// 文件用途：定义下料项目默认值，并负责本地缓存、数据规范化和汇总计算。
const STORAGE_KEY = "stone-planner-miniprogram-draft-v1";

const DEFAULT_PROJECT = {
  slabs: [{ id: "甲", w: 2700, h: 1800, limit: null }],
  parts: [
    { id: "A", w: 1750, h: 450, qty: 13 },
    { id: "B", w: 1400, h: 600, qty: 13 },
    { id: "C", w: 600, h: 400, qty: 4 },
  ],
};

const SLAB_IDS = [
  "甲",
  "乙",
  "丙",
  "丁",
  "戊",
  "己",
  "庚",
  "辛",
  "壬",
  "癸",
  "子",
  "丑",
  "寅",
  "卯",
  "辰",
  "巳",
  "午",
  "未",
  "申",
  "酉",
  "戌",
  "亥",
];

function partId(index) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < letters.length) return letters[index];
  const first = Math.floor(index / letters.length) - 1;
  const second = index % letters.length;
  return `${letters[first]}${letters[second]}`;
}

function recalculatePartIdsByArea(parts) {
  const ranks = new Array(parts.length);
  parts
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const areaA = (Number(a.item.w) || 0) * (Number(a.item.h) || 0);
      const areaB = (Number(b.item.w) || 0) * (Number(b.item.h) || 0);
      return areaB - areaA || a.index - b.index;
    })
    .forEach((entry, rank) => {
      ranks[entry.index] = rank;
    });
  return parts.map((item, index) => ({ ...item, id: partId(ranks[index]) }));
}

function normalizeProject(input) {
  const source = input && typeof input === "object" ? input : {};
  const slabs =
    Array.isArray(source.slabs) && source.slabs.length
      ? source.slabs.map((item, index) => ({
          id: SLAB_IDS[index] || `板${index + 1}`,
          w: Number(item.w) || 0,
          h: Number(item.h) || 0,
          limit:
            item.limit === null || item.limit === "" || item.limit === undefined
              ? null
              : Number(item.limit) || null,
        }))
      : DEFAULT_PROJECT.slabs.map((item) => ({ ...item }));
  const parts = Array.isArray(source.parts)
    ? source.parts.map((item, index) => ({
        id: item.id || partId(index),
        w: Number(item.w) || 0,
        h: Number(item.h) || 0,
        qty: Number(item.qty) || 0,
        rotatable: item.rotatable !== false,
      }))
    : DEFAULT_PROJECT.parts.map((item) => ({ ...item, rotatable: true }));
  return {
    slabs,
    parts: recalculatePartIdsByArea(parts),
  };
}

function loadProject() {
  try {
    return normalizeProject(wx.getStorageSync(STORAGE_KEY) || DEFAULT_PROJECT);
  } catch {
    return normalizeProject(DEFAULT_PROJECT);
  }
}

function saveProject(project) {
  const normalized = normalizeProject(project);
  wx.setStorageSync(STORAGE_KEY, normalized);
  return normalized;
}

function defaultProject() {
  return normalizeProject(DEFAULT_PROJECT);
}

function projectSummary(project) {
  const parts = project.parts || [];
  const totalArea = parts.reduce(
    (sum, item) =>
      sum +
      ((Number(item.w) || 0) *
        (Number(item.h) || 0) *
        (Number(item.qty) || 0)) /
        1000000,
    0,
  );
  return {
    totalCount: parts.reduce((sum, item) => sum + (Number(item.qty) || 0), 0),
    totalArea: totalArea.toFixed(3),
  };
}

module.exports = {
  defaultProject,
  loadProject,
  normalizeProject,
  projectSummary,
  saveProject,
};
