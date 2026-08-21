import { SlabsPanel } from "@/components/SlabsPanel";
import { PartsPanel } from "@/components/PartsPanel";
import { ActionConsole } from "@/components/ActionConsole";
import { ResultViewer } from "@/components/ResultViewer";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      <header className="bg-slate-900 text-white shadow-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <div className="w-1.5 h-6 bg-blue-500 rounded-full"></div>
              <div className="w-1.5 h-6 bg-blue-400 rounded-full opacity-80"></div>
              <div className="w-1.5 h-6 bg-blue-300 rounded-full opacity-60"></div>
            </div>
            <h1 className="font-bold text-xl tracking-wide">九江宝松石材下料工具</h1>
          </div>
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full text-sm border border-slate-700">
            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] relative">
              <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping opacity-75"></div>
            </div>
            <span className="text-slate-300 font-medium tracking-wide">离线运行</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-8 mt-8 space-y-8">
        <SlabsPanel />
        <PartsPanel />
        <ActionConsole />
        <ResultViewer />
      </main>

      <footer className="mt-20 border-t border-slate-200 bg-white py-8 text-center text-slate-500 text-sm">
        <div className="max-w-6xl mx-auto px-4 md:px-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p>Windows 10/11 · WPS 可打开导出文件 · v2.0.0-Next</p>
          <div className="flex gap-4">
            <button className="hover:text-blue-600 transition-colors font-medium">检查更新</button>
            <span className="text-slate-300">|</span>
            <button className="hover:text-rose-600 transition-colors font-medium">退出工具</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
