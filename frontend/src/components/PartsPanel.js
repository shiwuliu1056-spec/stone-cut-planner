"use client";

import { useRef, useMemo } from "react";
import { useStore } from "@/store";
import { requestJson } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Plus, X, UploadCloud } from "lucide-react";

export function PartsPanel() {
  const { parts, updatePart, addPartRow, removePartRow, setParts, setSolving } = useStore();
  const fileInputRef = useRef(null);

  const { totalCount, totalArea } = useMemo(() => {
    let count = 0, area = 0;
    parts.forEach(p => {
      const q = Number(p.qty) || 0;
      const w = Number(p.w) || 0;
      const h = Number(p.h) || 0;
      count += q;
      area += (w * h * q) / 1000000;
    });
    return { totalCount: count, totalArea: area.toFixed(3) };
  }, [parts]);

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setSolving(true); // Re-use solving flag for loading state
      const data = await requestJson('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer()
      });
      
      if (data.parts) {
        setParts(data.parts);
        alert(`已成功导入 ${data.parts.length} 种规格`);
      }
    } catch (error) {
      alert("导入失败: " + error.message);
    } finally {
      setSolving(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
        <div>
          <span className="text-xs font-semibold text-blue-600 tracking-wider">02 / 清单</span>
          <h2 className="text-xl font-bold text-slate-800 mt-1">小料尺寸</h2>
        </div>
        <div className="flex items-center gap-3">
          <input 
            type="file" 
            accept=".xlsx" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleImport} 
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50">
            <UploadCloud className="w-4 h-4" /> 导入 Excel
          </Button>
          <Button variant="outline" onClick={addPartRow} className="gap-1.5">
            <Plus className="w-4 h-4" /> 添加一行
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
              <TableHead>数量</TableHead>
              <TableHead>面积</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parts.map((part, i) => {
              const area = ((Number(part.w) || 0) * (Number(part.h) || 0) * (Number(part.qty) || 0)) / 1000000;
              return (
                <TableRow key={i}>
                  <TableCell>
                    <Input
                      value={part.id}
                      readOnly
                      className="bg-slate-50 text-slate-500 font-semibold text-center border-slate-200"
                    />
                  </TableCell>
                  <TableCell>
                    <Input 
                      type="number" 
                      min="1" 
                      value={part.w || ''} 
                      onChange={(e) => updatePart(i, 'w', Number(e.target.value))}
                    />
                  </TableCell>
                  <TableCell>
                    <Input 
                      type="number" 
                      min="1" 
                      value={part.h || ''} 
                      onChange={(e) => updatePart(i, 'h', Number(e.target.value))}
                    />
                  </TableCell>
                  <TableCell>
                    <Input 
                      type="number" 
                      min="1" 
                      max="100" 
                      value={part.qty || ''} 
                      onChange={(e) => updatePart(i, 'qty', Number(e.target.value))}
                    />
                  </TableCell>
                  <TableCell className="text-slate-500 font-mono text-sm whitespace-nowrap">
                    {area.toFixed(3)} ㎡
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => removePartRow(i)} className="text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                      <X className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-700">
        <div className="font-medium">共 {totalCount} 件</div>
        <div className="font-medium">成品总面积 {totalArea} ㎡</div>
        <div className="text-slate-400">上限 100 件</div>
      </div>
    </section>
  );
}
