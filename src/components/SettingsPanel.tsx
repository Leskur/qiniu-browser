import { useState, useEffect } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-shell";
import { useAppStore, Theme } from "../store";
import { Sun, Moon, Monitor, Cat, Download } from "lucide-react";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light",  label: "浅色",   icon: Sun },
  { value: "dark",   label: "深色",   icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export function SettingsPanel({ onCheckUpdate, appVersion }: { onCheckUpdate: () => void; appVersion: string }) {
  const { 
    theme, setTheme,
    itemsPerPage, setItemsPerPage,
    cacheExpireMinutes, setCacheExpireMinutes,
  } = useAppStore();
  
  const [cacheSize, setCacheSize] = useState<string>('计算中...');
  const [confirmClear, setConfirmClear] = useState(false);

  const calcCacheSize = () => {
    try {
      let totalSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) totalSize += key.length + value.length;
        }
      }
      setCacheSize(`${(totalSize / 1024).toFixed(2)} KB`);
    } catch {
      setCacheSize('无法计算');
    }
  };

  useEffect(() => {
    calcCacheSize();
  }, []);

  const handleClearCache = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      // 3 秒后自动取消确认状态
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    // 保存设置相关的 key
    const settingsKeys = ['qiniu-browser-settings', 'qiniu_auto_login', 'qiniu_last_login_ak', 'qiniu_session'];
    const settingsData: Record<string, string> = {};
    settingsKeys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) settingsData[key] = value;
    });
    localStorage.clear();
    Object.entries(settingsData).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });
    toast.success('缓存已清除');
    setConfirmClear(false);
    calcCacheSize();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">设置</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => open('https://github.com/Leskur/qiniu-browser')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="访问 GitHub 仓库"
          >
            <Cat className="w-3.5 h-3.5" />
            <span>GitHub</span>
          </button>
          <button
            onClick={onCheckUpdate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors cursor-pointer"
            title="检查应用更新"
          >
            <Download className="w-3.5 h-3.5" />
            <span>检查更新</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* 外观 */}
        <div>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">外观</h3>
          <div className="grid grid-cols-3 gap-3">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex flex-col items-center gap-2 p-3 rounded-lg border transition-all cursor-pointer
                  ${theme === value
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                    : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600"}`}
              >
                <Icon className={`w-5 h-5 ${theme === value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`} />
                <span className={`text-xs font-medium ${theme === value ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 文件管理 */}
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">文件管理</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 block">每页显示</label>
              <div className="grid grid-cols-4 gap-2">
                {[20, 50, 100, 200].map((count) => (
                  <button
                    key={count}
                    onClick={() => setItemsPerPage(count as any)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
                      ${itemsPerPage === count
                        ? "bg-emerald-500 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 缓存 */}
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">缓存</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 block">过期时间</label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 5, 15, 30].map((minutes) => (
                  <button
                    key={minutes}
                    onClick={() => setCacheExpireMinutes(minutes)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
                      ${cacheExpireMinutes === minutes
                        ? "bg-emerald-500 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
                  >
                    {minutes}分钟
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">当前大小</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{cacheSize}</p>
              </div>
              <button
                onClick={handleClearCache}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                  confirmClear
                    ? 'text-white bg-red-500 hover:bg-red-600'
                    : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                }`}
              >
                {confirmClear ? '确认清除' : '清除'}
              </button>
            </div>
          </div>
        </div>

        {/* 关于 */}
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">关于</h3>
          <div className="text-sm text-zinc-600 dark:text-zinc-400 space-y-1">
            <p className="font-medium text-zinc-700 dark:text-zinc-300">Qiniu Browser</p>
            <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500">v{appVersion}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">基于 Tauri + React 构建</p>
          </div>
        </div>
      </div>
    </div>
  );
}
