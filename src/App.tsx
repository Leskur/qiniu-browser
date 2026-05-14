import { useState, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { Login } from "./components/Login";
import { FileManager } from "./components/FileManager";
import { BucketList } from "./components/BucketList";
import { CdnManager } from "./components/CdnManager";
import { TransferPanel } from "./components/TransferPanel";
import { fetchBuckets, QiniuBucket } from "./lib/qiniu";
import { useAppStore, Theme } from "./store";
import {
  Database, Zap, LogOut, Settings,
  Sun, Moon, Monitor
} from "lucide-react";
import "./App.css";

type Section = "storage" | "cdn" | "settings";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light",  label: "浅色",   icon: Sun },
  { value: "dark",   label: "深色",   icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

function SettingsPanel() {
  const { 
    theme, setTheme,
    itemsPerPage, setItemsPerPage,
    cacheExpireMinutes, setCacheExpireMinutes,
    notifyOnComplete, setNotifyOnComplete,
  } = useAppStore();
  
  const [cacheSize, setCacheSize] = useState<string>('计算中...');

  // 计算缓存大小
  useEffect(() => {
    try {
      let totalSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key);
          if (value) {
            totalSize += key.length + value.length;
          }
        }
      }
      // 转换为 KB
      setCacheSize(`${(totalSize / 1024).toFixed(2)} KB`);
    } catch {
      setCacheSize('无法计算');
    }
  }, []);

  const handleClearCache = () => {
    if (confirm('确定要清除所有缓存吗？这将清除目录缓存和域名缓存，但不会清除您的设置。')) {
      // 保存设置相关的 key
      const settingsKeys = ['qiniu-browser-settings', 'qiniu_auto_login', 'qiniu_last_login_ak'];
      const settingsData: Record<string, string> = {};
      
      settingsKeys.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) settingsData[key] = value;
      });
      
      // 清除所有
      localStorage.clear();
      
      // 恢复设置
      Object.entries(settingsData).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      
      toast.success('缓存已清除');
      setCacheSize('0 KB');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">设置</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* 外观设置 */}
        <div>
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">外观设置</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 block">主题</label>
              <div className="grid grid-cols-3 gap-3">
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={`flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all cursor-pointer
                      ${theme === value
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 shadow-sm"
                        : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:border-zinc-300 dark:hover:border-zinc-600"}`}
                  >
                    <Icon className={`w-6 h-6 ${theme === value ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`} />
                    <span className={`text-xs font-medium ${theme === value ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 文件管理设置 */}
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">文件管理</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 block">每页显示数量</label>
              <div className="grid grid-cols-4 gap-2">
                {[20, 50, 100, 200].map((count) => (
                  <button
                    key={count}
                    onClick={() => setItemsPerPage(count as any)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
                      ${itemsPerPage === count
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">较大的数值可能影响性能</p>
            </div>
          </div>
        </div>

        {/* 缓存设置 */}
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">缓存设置</h3>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 block">缓存过期时间</label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 5, 15, 30].map((minutes) => (
                  <button
                    key={minutes}
                    onClick={() => setCacheExpireMinutes(minutes)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
                      ${cacheExpireMinutes === minutes
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}
                  >
                    {minutes}分钟
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">目录列表缓存的有效期</p>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">当前缓存大小</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{cacheSize}</p>
              </div>
              <button
                onClick={handleClearCache}
                className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors"
              >
                清除缓存
              </button>
            </div>
          </div>
        </div>

        {/* 通知设置 */}
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">通知设置</h3>
          <div className="space-y-3">
            <label className="flex items-center justify-between p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">传输完成通知</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">上传或下载完成时显示通知</p>
              </div>
              <input
                type="checkbox"
                checked={notifyOnComplete}
                onChange={(e) => setNotifyOnComplete(e.target.checked)}
                className="w-4 h-4 text-emerald-600 bg-zinc-100 border-zinc-300 rounded focus:ring-emerald-500 dark:focus:ring-emerald-600 dark:ring-offset-zinc-800 focus:ring-2 dark:bg-zinc-700 dark:border-zinc-600"
              />
            </label>
          </div>
        </div>

        {/* 关于 */}
        <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-3">关于</h3>
          <div className="space-y-3">
            <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Qiniu Browser</p>
              <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 mt-1">版本 v0.0.1</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">基于 Tauri + React 构建的七牛云桌面客户端</p>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => window.open('https://github.com/YOUR_USERNAME/qiniu-browser', '_blank')}
                className="flex-1 px-3 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                GitHub
              </button>
              <button
                onClick={() => toast.info('当前已是最新版本')}
                className="flex-1 px-3 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-lg transition-colors"
              >
                检查更新
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [credentials, setCredentials] = useState({ ak: "", sk: "", description: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("storage");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(208);
  const [isResizing, setIsResizing] = useState(false);
  const [memoryMB, setMemoryMB] = useState<number | null>(null);
  const [bucketListScrollPos, setBucketListScrollPos] = useState(0);

  const { buckets, setBuckets } = useAppStore();

  // ── Memory usage polling ──
  useEffect(() => {
    const update = () => {
      const mem = (performance as any).memory;
      if (mem) setMemoryMB(Math.round(mem.usedJSHeapSize / 1024 / 1024));
    };
    update();
    const id = setInterval(update, 3000);
    return () => clearInterval(id);
  }, []);

  const handleLogin = (ak: string, sk: string, description?: string, buckets?: QiniuBucket[]) => {
    setCredentials({ ak, sk, description: description || "" });
    setIsAuthenticated(true);
    // 如果登录时已经获取了 buckets，直接使用
    if (buckets) {
      setBuckets(buckets);
    }
  };

  const loadBuckets = () => {
    setLoading(true);
    setError("");
    fetchBuckets(credentials.ak, credentials.sk)
      .then(data => setBuckets(data))
      .catch(err => setError(err.message || "获取 Bucket 列表失败"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // 只有在登录时没有获取到 buckets 数据时才加载
    if (isAuthenticated && buckets.length === 0) {
      loadBuckets();
    }
  }, [isAuthenticated]);

  // 检查更新
  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await check();
        if (update?.available) {
          toast.info(`发现新版本 ${update.version}`, {
            description: '是否立即更新？',
            action: {
              label: '立即更新',
              onClick: async () => {
                try {
                  toast.loading('正在下载更新...');
                  await update.downloadAndInstall();
                  await relaunch();
                } catch (error) {
                  toast.error('更新失败', {
                    description: error instanceof Error ? error.message : '未知错误'
                  });
                }
              }
            },
            duration: 10000,
          });
        }
      } catch (error) {
        console.error('检查更新失败:', error);
      }
    }
    
    checkForUpdates();
  }, []);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCredentials({ ak: "", sk: "", description: "" });
    setSelectedBucket(null);
    setActiveSection("storage");
    setShowAccountMenu(false);
  };

  // 侧边栏拖拽调整宽度
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      // 限制宽度在 180px 到 400px 之间
      if (newWidth >= 180 && newWidth <= 400) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const navItems: { id: Section; label: string; icon: typeof Database; desc: string }[] = [
    { id: "storage", label: "空间管理", icon: Database, desc: "对象存储 · 文件" },
    { id: "cdn",     label: "CDN",     icon: Zap,      desc: "刷新 · 预取" },
    { id: "settings",label: "设置",    icon: Settings,  desc: "外观 · 偏好" },
  ];

  return (
    <main 
      className={`min-h-screen text-zinc-900 dark:text-zinc-50 font-sans selection:bg-emerald-200 dark:selection:bg-emerald-900 ${isResizing ? "select-none" : ""}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Toaster position="bottom-right" richColors />
      {!isAuthenticated ? (
        <Login onLogin={handleLogin} />
      ) : (
        <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-950">

          {/* ── Sidebar ── */}
          <aside 
            className="shrink-0 flex flex-col bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 relative"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Logo */}
            <div className="flex items-center gap-2.5 px-4 py-4 shrink-0">
              <img src="/logo.png" alt="Qiniu" className="h-7 w-7 object-contain shrink-0" />
              <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100 truncate tracking-tight">Qiniu Browser</span>
            </div>

            {/* Nav */}
            <nav className="flex-1 py-2 overflow-y-auto">
              {navItems.map(({ id, label, icon: Icon, desc }) => {
                const active = activeSection === id;
                return (
                  <button
                    key={id}
                    onClick={() => {
                      if (id === "storage" && activeSection === "storage") {
                        // 如果已经在空间管理页面，返回空间列表
                        setSelectedBucket(null);
                      } else {
                        setActiveSection(id);
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all text-left group relative cursor-pointer
                      ${active
                        ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
                  >
                    {/* Active indicator */}
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-emerald-500" />
                    )}
                    <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] leading-tight ${active ? "font-semibold" : "font-medium"}`}>{label}</p>
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight mt-0.5">{desc}</p>
                    </div>
                  </button>
                );
              })}
            </nav>

            {/* Account Menu */}
            <div className="border-t border-zinc-100 dark:border-zinc-800 shrink-0 relative">
              <button
                onClick={() => setShowAccountMenu(v => !v)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left group cursor-pointer"
              >
                {/* Avatar */}
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {(credentials.description || credentials.ak).charAt(0).toUpperCase()}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {credentials.description || credentials.ak.substring(0, 16) + "..."}
                  </p>
                  {credentials.description && (
                    <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                      {credentials.ak.substring(0, 16)}...
                    </p>
                  )}
                </div>
                <Settings className="w-4 h-4 text-zinc-400 dark:text-zinc-500 shrink-0" />
              </button>

              {/* Account dropdown menu */}
              {showAccountMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowAccountMenu(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-1 mx-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-20 overflow-hidden">
                    <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
                      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">当前账号</p>
                      {credentials.description && (
                        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">{credentials.description}</p>
                      )}
                      <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 break-all">{credentials.ak}</p>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={() => { handleLogout(); setShowAccountMenu(false); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left cursor-pointer"
                      >
                        <LogOut className="w-4 h-4 shrink-0" />
                        <span>切换账号</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Memory usage */}
            {memoryMB !== null && (
              <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
                  内存占用 {memoryMB} MB
                </p>
              </div>
            )}

            {/* Resize handle */}
            <div
              onMouseDown={handleMouseDown}
              className={`absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-emerald-500/50 transition-colors group ${isResizing ? "bg-emerald-500" : ""}`}
              title="拖拽调整宽度"
            >
              <div className="absolute inset-y-0 -right-1 w-3" />
            </div>
          </aside>

          {/* ── Main ── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
            {/* Top bar (Only for storage) */}
            {activeSection === "storage" && !selectedBucket && (
              <header className="shrink-0 flex items-center gap-2 px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm relative z-20">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  空间管理
                </span>
              </header>
            )}

            {/* Content — always mounted, visibility toggled to preserve state */}
            <div className="flex-1 overflow-hidden relative z-10">
              <div className={`h-full relative flex flex-col ${activeSection === "storage" ? "" : "hidden"}`}>
                {selectedBucket ? (
                  <div className="absolute inset-0 z-20 bg-white dark:bg-zinc-950">
                    <FileManager
                      ak={credentials.ak}
                      sk={credentials.sk}
                      bucket={selectedBucket}
                      onBack={() => setSelectedBucket(null)}
                    />
                  </div>
                ) : (
                  <div className="h-full p-5 flex flex-col">
                    <BucketList
                      buckets={buckets}
                      ak={credentials.ak}
                      sk={credentials.sk}
                      loading={loading}
                      error={error}
                      onSelectBucket={(bucket) => {
                        // 保存当前滚动位置
                        const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
                        if (scrollArea) {
                          setBucketListScrollPos(scrollArea.scrollTop);
                        }
                        setSelectedBucket(bucket);
                      }}
                      onRefresh={loadBuckets}
                      scrollPosition={bucketListScrollPos}
                      onScrollPositionRestored={() => setBucketListScrollPos(0)}
                    />
                  </div>
                )}
              </div>
              <div className={activeSection === "cdn" ? "h-full" : "hidden"}>
                <CdnManager ak={credentials.ak} sk={credentials.sk} />
              </div>
              <div className={activeSection === "settings" ? "h-full" : "hidden"}>
                <SettingsPanel />
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Transfer Panel - Global */}
      {isAuthenticated && <TransferPanel />}
    </main>
  );
}

export default App;
