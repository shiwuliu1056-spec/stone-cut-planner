"use client";

import { useRef, useMemo, useState } from "react";
import { useStore } from "@/store";
import { requestJson } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Plus, X, UploadCloud, Camera, Loader2 } from "lucide-react";
import { recognizePhoto } from "@/lib/photo-ocr";

export function PartsPanel() {
  const { parts, updatePart, addPartRow, removePartRow, setParts, setSolving } = useStore();
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoUnit, setPhotoUnit] = useState('mm');
  const [photoParts, setPhotoParts] = useState([]);
  const [photoText, setPhotoText] = useState('');
  const [photoProgress, setPhotoProgress] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');

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

  const runPhotoRecognition = async (file, unit) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError('');
    setPhotoProgress(0);
    try {
      const result = await recognizePhoto(file, {
        unit,
        onProgress: (progress) => setPhotoProgress(Math.round(progress * 100)),
      });
      setPhotoText(result.text || '');
      setPhotoParts(result.parts || []);
      if (!result.parts?.length) {
        setPhotoError('没有识别出“长度 × 宽度 = 数量”格式，请调整照片或手动补录。');
      }
    } catch (error) {
      setPhotoParts([]);
      setPhotoError(`图片识别失败：${error.message || '本地 OCR 资源不可用'}`);
    } finally {
      setPhotoBusy(false);
    }
  };

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    await runPhotoRecognition(file, photoUnit);
    e.target.value = '';
  };

  const handlePhotoUnitChange = async (e) => {
    const unit = e.target.value;
    setPhotoUnit(unit);
    if (photoFile) await runPhotoRecognition(photoFile, unit);
  };

  const updatePhotoPart = (index, field, value) => {
    setPhotoParts((current) => current.map((part, i) => (
      i === index ? { ...part, [field]: value } : part
    )));
  };

  const closePhotoDialog = () => {
    if (photoBusy) return;
    setPhotoDialogOpen(false);
    setPhotoFile(null);
    setPhotoParts([]);
    setPhotoText('');
    setPhotoError('');
    setPhotoProgress(0);
  };

  const appendPhotoParts = () => {
    const valid = photoParts
      .filter((part) => Number(part.w) > 0 && Number(part.h) > 0 && Number(part.qty) > 0)
      .map(({ source, ...part }) => ({ ...part, w: Number(part.w), h: Number(part.h), qty: Number(part.qty) }));
    if (!valid.length) {
      setPhotoError('请至少保留一条有效的尺寸记录。');
      return;
    }
    setParts([...parts, ...valid]);
    closePhotoDialog();
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
          <Button variant="outline" onClick={() => setPhotoDialogOpen(true)} className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
            <Camera className="w-4 h-4" /> 拍照识别
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

      {photoDialogOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800">拍照识别小料尺寸</h3>
                <p className="mt-1 text-sm text-slate-500">支持手写或打印的“长度 × 宽度 = 数量”记录，识别后可逐行校对。</p>
              </div>
              <button type="button" onClick={closePhotoDialog} disabled={photoBusy} className="text-slate-400 hover:text-slate-700 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50 px-6 py-4">
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoSelect} />
              <Button variant="outline" onClick={() => photoInputRef.current?.click()} disabled={photoBusy} className="gap-1.5">
                <Camera className="h-4 w-4" /> {photoFile ? '重新选择图片' : '选择照片'}
              </Button>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                尺寸单位
                <select value={photoUnit} onChange={handlePhotoUnitChange} disabled={photoBusy} className="h-9 rounded-md border border-slate-300 bg-white px-3">
                  <option value="mm">mm（毫米）</option>
                  <option value="cm">cm（厘米，自动换算为 mm）</option>
                </select>
              </label>
              {photoFile && <span className="text-sm text-slate-500">{photoFile.name}</span>}
              {photoBusy && <span className="flex items-center gap-2 text-sm text-blue-600"><Loader2 className="h-4 w-4 animate-spin" /> 正在联网识别 {photoProgress}%</span>}
            </div>

            {photoError && <div className="mx-6 mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{photoError}</div>}

            {photoParts.length > 0 && (
              <div className="p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="font-semibold text-slate-800">识别结果（请校对）</h4>
                  <span className="text-sm text-slate-500">共 {photoParts.length} 条</span>
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr><th className="px-3 py-2">编号</th><th className="px-3 py-2">长度 (mm)</th><th className="px-3 py-2">宽度 (mm)</th><th className="px-3 py-2">数量</th><th className="px-3 py-2"></th></tr>
                    </thead>
                    <tbody>
                      {photoParts.map((part, index) => (
                        <tr key={`${part.source || 'row'}-${index}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-500">{part.id || '自动编号'}</td>
                          {['w', 'h', 'qty'].map((field) => (
                            <td key={field} className="px-3 py-2"><input type="number" min="1" value={part[field] || ''} onChange={(e) => updatePhotoPart(index, field, Number(e.target.value))} className="h-9 w-full min-w-[110px] rounded-md border border-slate-300 px-2" /></td>
                          ))}
                          <td className="px-3 py-2"><button type="button" onClick={() => setPhotoParts((current) => current.filter((_, i) => i !== index))} className="text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {photoText && (
              <details className="mx-6 mb-5 rounded-md border border-slate-200 px-4 py-3 text-sm text-slate-500">
                <summary className="cursor-pointer font-medium text-slate-600">查看 OCR 原文</summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{photoText}</pre>
              </details>
            )}

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button variant="outline" onClick={closePhotoDialog} disabled={photoBusy}>取消</Button>
              <Button onClick={appendPhotoParts} disabled={photoBusy || photoParts.length === 0}>加入小料清单</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
