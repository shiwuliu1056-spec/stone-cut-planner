import { create } from 'zustand';

const DRAFT_KEY = 'stone-planner-draft-v3';

// 默认初始数据
const sampleParts = [
  { id: 'A', w: 1750, h: 450, qty: 13 },
  { id: 'B', w: 1400, h: 600, qty: 13 },
  { id: 'C', w: 600, h: 400, qty: 4 },
];

const sampleSlabs = [
  { id: '甲', w: 2700, h: 1800, limit: null },
];

const CHINESE_NUMBERS = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸", "子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

const getChineseId = (index) => {
  if (index < CHINESE_NUMBERS.length) return CHINESE_NUMBERS[index];
  return `板${index + 1}`;
};

const getPartId = (index) => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (index < letters.length) return letters[index];
  const first = Math.floor(index / letters.length) - 1;
  const second = index % letters.length;
  return letters[first] + letters[second];
};

const recalculateIds = (items, getPrefixOrId) => {
  return items.map((item, index) => ({ ...item, id: getPrefixOrId(index) }));
};

const recalculatePartIdsByArea = (parts) => {
  // 按面积(w * h)从大到小排序，面积相同的按原先顺序（这里简单处理）
  const sorted = [...parts].sort((a, b) => {
    const areaA = (Number(a.w) || 0) * (Number(a.h) || 0) * (Number(a.qty) || 0);
    const areaB = (Number(b.w) || 0) * (Number(b.h) || 0) * (Number(b.qty) || 0);
    return areaB - areaA;
  });
  
  // 重新赋予ID，但是我们需要把排好的ID映射回原来的顺序以保持用户视角的表格不变？
  // 用户的意思是“编号按面积大小排序命名”。
  // 意味着列表本身的顺序可能不变，只是 ID 的分配变了（比如面积最大的叫 A，第二大叫 B）
  // 我们可以通过记录原索引来恢复顺序。
  const withOriginalIndex = sorted.map((p, i) => ({ ...p, _tempId: getPartId(i) }));
  
  // 不过通常情况下，“重新命名”结合状态更新，最简单的是直接在每次更新尺寸、增删时触发重算。
  // 为了不改变行在表格里的顺序，我们需要根据当前行在排序后数组里的位置来决定它的 id。
  return parts.map(p => {
    const rank = sorted.findIndex(sp => sp === p);
    return { ...p, id: getPartId(rank) };
  });
};

// 尝试从本地加载草稿
const loadInitialState = () => {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.slabs && parsed.parts) {
          parsed.slabs = recalculateIds(parsed.slabs, getChineseId);
          parsed.parts = recalculatePartIdsByArea(parsed.parts);
          return parsed;
        }
      }
    } catch (e) {
      console.error("加载草稿失败", e);
    }
  }
  return { slabs: recalculateIds(sampleSlabs, getChineseId), parts: recalculatePartIdsByArea(sampleParts) };
};

export const useStore = create((set, get) => {
  const initialState = loadInitialState();

  const updateStateAndSave = (updater) => {
    set((state) => {
      const updates = typeof updater === 'function' ? updater(state) : updater;
      
      let nextSlabs = updates.slabs || state.slabs;
      let nextParts = updates.parts || state.parts;
      
      if (updates.slabs) nextSlabs = recalculateIds(nextSlabs, getChineseId);
      if (updates.parts) nextParts = recalculatePartIdsByArea(nextParts);
      
      const nextState = { ...state, ...updates, slabs: nextSlabs, parts: nextParts };
      
      if (typeof window !== 'undefined') {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          slabs: nextSlabs,
          parts: nextParts
        }));
      }
      return nextState;
    });
  };

  return {
    slabs: initialState.slabs,
    parts: initialState.parts,
    isSolving: false,
    result: null,

    // --- 大板操作 ---
    updateSlab: (index, field, value) => {
      updateStateAndSave(state => {
        const slabs = [...state.slabs];
        slabs[index] = { ...slabs[index], [field]: value };
        return { slabs };
      });
    },
    addSlabRow: () => updateStateAndSave(state => ({ slabs: [...state.slabs, { id: '', w: 2400, h: 1600, limit: null }] })),
    removeSlabRow: (index) => updateStateAndSave(state => ({ slabs: state.slabs.filter((_, i) => i !== index) })),
    
    // --- 小料操作 ---
    updatePart: (index, field, value) => {
      updateStateAndSave(state => {
        const parts = [...state.parts];
        parts[index] = { ...parts[index], [field]: value };
        return { parts };
      });
    },
    addPartRow: () => updateStateAndSave(state => ({ parts: [...state.parts, { id: '', w: 0, h: 0, qty: 1 }] })),
    removePartRow: (index) => updateStateAndSave(state => ({ parts: state.parts.filter((_, i) => i !== index) })),
    setParts: (parts) => updateStateAndSave({ parts }),

    // --- 全局操作 ---
    resetDefault: () => updateStateAndSave({ slabs: sampleSlabs, parts: sampleParts, result: null }),
    setSolving: (status) => set({ isSolving: status }),
    setResult: (result) => set({ result }),
  };
});
