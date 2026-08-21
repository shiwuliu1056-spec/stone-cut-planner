"use client";

import { useStore } from "@/store";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Plus, X, RotateCcw } from "lucide-react";

export function SlabsPanel() {
  const { slabs, updateSlab, addSlabRow, removeSlabRow, resetDefault } = useStore();

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
        <div>
          <span className="text-xs font-semibold text-blue-600 tracking-wider">01 / 大板</span>
          <h2 className="text-xl font-bold text-slate-800 mt-1">大板尺寸</h2>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={addSlabRow} className="gap-1.5">
            <Plus className="w-4 h-4" /> 添加一行
          </Button>
          <Button variant="ghost" onClick={resetDefault} className="gap-1.5 text-slate-500 hover:text-slate-900">
            <RotateCcw className="w-4 h-4" /> 恢复默认
          </Button>
        </div>
      </div>

      <div className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">编号</TableHead>
              <TableHead>长度 (mm)</TableHead>
              <TableHead>宽度 (mm)</TableHead>
              <TableHead>可用数量</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slabs.map((slab, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    value={slab.id}
                    readOnly
                    className="bg-slate-50 text-slate-500 font-semibold text-center border-slate-200"
                  />
                </TableCell>
                <TableCell>
                  <Input 
                    type="number" 
                    min="1" 
                    value={slab.w || ''} 
                    onChange={(e) => updateSlab(i, 'w', Number(e.target.value))} 
                    placeholder="输入长度"
                  />
                </TableCell>
                <TableCell>
                  <Input 
                    type="number" 
                    min="1" 
                    value={slab.h || ''} 
                    onChange={(e) => updateSlab(i, 'h', Number(e.target.value))} 
                    placeholder="输入宽度"
                  />
                </TableCell>
                <TableCell>
                  <select 
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    value={slab.limit === null ? '' : slab.limit}
                    onChange={(e) => updateSlab(i, 'limit', e.target.value === '' ? null : Number(e.target.value))}
                  >
                    <option value="">不限</option>
                    {[1,2,3,4,5,6,7,8,9,10].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => removeSlabRow(i)} className="text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                    <X className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="bg-slate-50 p-4 text-sm text-slate-500 border-t border-slate-100 flex items-center justify-center">
        排料时按表格顺序优先使用，数量用完自动换下一行
      </div>
    </section>
  );
}
