"use client";

import { useState } from "react";
import { requestJson } from "@/lib/api";

export function FooterActions() {
  const [checking, setChecking] = useState(false);

  const handleCheckUpdate = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const info = await requestJson('/api/update/check');
      if (info.error) {
        alert(`更新检查失败：${info.error}`);
      } else if (!info.configured) {
        alert('尚未配置更新地址。发布新版后，在绿色包根目录放置 update-config.json 即可启用。');
      } else if (!info.update) {
        alert(`当前已是最新版本（${info.currentVersion}）。`);
      } else {
        const notes = info.update.notes ? `\n\n更新说明：${info.update.notes}` : '';
        if (confirm(`发现新版本 ${info.update.version}，是否立即更新？${notes}`)) {
          await requestJson('/api/update/apply', { method: 'POST', body: '{}' });
          alert('更新包已下载，程序将关闭并自动替换后重新启动。');
        }
      }
    } catch (error) {
      alert(`更新检查失败：${error.message}`);
    } finally {
      setChecking(false);
    }
  };

  const handleExit = async () => {
    try {
      await requestJson('/api/shutdown', { method: 'POST', body: '{}' });
    } catch (_) {
      // 服务关闭时浏览器可能先断开连接，这是正常现象。
    }
  };

  return (
    <div className="flex gap-4">
      <button onClick={handleCheckUpdate} disabled={checking} className="hover:text-blue-600 transition-colors font-medium disabled:opacity-50">
        {checking ? '检查中…' : '检查更新'}
      </button>
      <span className="text-slate-300">|</span>
      <button onClick={handleExit} className="hover:text-rose-600 transition-colors font-medium">退出工具</button>
    </div>
  );
}
