"use client";

import { useStore } from "@/store";
import { Button } from "@/components/ui/Button";
import { Play, Download } from "lucide-react";
import { requestJson, downloadBlob } from "@/lib/api";

export function ActionConsole() {
  const { parts, slabs, isSolving, result, setSolving, setResult } = useStore();

  const handleSolve = async () => {
    try {
      setSolving(true);
      const settings = {
        slabs: slabs.map(s => ({
          id: s.id,
          w: Number(s.w),
          h: Number(s.h),
          limit: s.limit === null || s.limit === '' ? null : Number(s.limit)
        }))
      };

      const payloadParts = parts.map(p => ({
        id: p.id,
        w: Number(p.w),
        h: Number(p.h),
        qty: Number(p.qty),
        rotatable: true
      }));

      const data = await requestJson('/api/solve', {
        method: 'POST',
        body: JSON.stringify({ settings, parts: payloadParts })
      });

      setResult(data.result);
      
      // Scroll to results slightly after render
      setTimeout(() => {
        document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);

    } catch (error) {
      alert("排版发生错误: " + error.message);
    } finally {
      setSolving(false);
    }
  };

  const handleExport = async () => {
    if (!result) {
      alert("请先进行自动排版！");
      return;
    }
    
    try {
      setSolving(true); // 复用状态来展示正在导出
      
      // 提取所有 canvas 图片 Base64
      const images = { A: [] };
      const canvases = document.querySelectorAll('#results-section canvas');
      canvases.forEach(canvas => {
        images.A.push(canvas.toDataURL('image/png'));
      });

      const payload = {
        result,
        images
      };

      // 导出 Excel
      await downloadBlob('/api/export', {
        method: 'POST',
        body: JSON.stringify(payload)
      }, "石材下料方案.xlsx");

      // 导出 Word
      await downloadBlob('/api/export-word', {
        method: 'POST',
        body: JSON.stringify(payload)
      }, "石材下料排版图.docx");

    } catch (error) {
      alert("导出发生错误: " + error.message);
    } finally {
      setSolving(false);
    }
  };

  return (
    <section className="bg-slate-900 rounded-xl shadow-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8 sticky bottom-6 z-40">
      <div>
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          自动排版
        </h3>
        <p className="text-slate-400 mt-1 text-sm">
          算法将尝试最优摆放，先大后小，余料集中
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Button 
          variant="outline" 
          size="lg" 
          onClick={handleExport} 
          disabled={!result || isSolving}
          className="bg-transparent text-white border-slate-700 hover:bg-slate-800 hover:text-white"
        >
          <Download className="w-5 h-5 mr-2" />
          导出 Excel + Word
        </Button>
        <Button 
          variant="primary" 
          size="lg" 
          onClick={handleSolve} 
          disabled={isSolving}
          className="bg-blue-500 hover:bg-blue-600 text-white font-bold px-8 shadow-blue-500/20 shadow-lg"
        >
          {isSolving ? (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              正在规划...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Play className="w-5 h-5 fill-current" />
              开始排版
            </div>
          )}
        </Button>
      </div>
    </section>
  );
}
