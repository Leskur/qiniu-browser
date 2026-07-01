import { useState, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { Login } from "./pages/Login";
import { FileManager } from "./pages/FileManager";
import { BucketList } from "./pages/BucketList";
import { CdnManager } from "./pages/CdnManager";
import { DomainManager } from "./pages/DomainManager";
import { TransferPanel } from "./components/TransferPanel";
import { BookmarkPage } from "./pages/BookmarkPage";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppStore } from "./store";
import {
  Database, Zap, LogOut, Settings, Bookmark,
  X, Folder
} from "lucide-react";
import "./App.css";

type Section = "storage" | "bookmarks" | "cdn" | "settings";
type CdnSubSection = "refresh" | "domains";

function App() {
  // 从 localStorage 恢复登录状态
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const saved = localStorage.getItem('qiniu_session');
    return saved ? JSON.parse(saved).isAuthenticated : false;
  });
  
  const [credentials, setCredentials] = useState(() => {
    const saved = localStorage.getItem('qiniu_session');
    return saved ? JSON.parse(saved).credentials : { ak: "", sk: "", description: "" };
  });
  
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("storage");
  const [cdnSubSection, setCdnSubSection] = useState<CdnSubSection>("refresh");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [prefillDomain, setPrefillDomain] = useState<string>("");
  const [sidebarWidth, setSidebarWidth] = useState(208);
  const [isResizing, setIsResizing] = useState(false);
  const [memoryMB, setMemoryMB] = useState<number | null>(null);
  const [bucketListScrollPos, setBucketListScrollPos] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [initialPrefix, setInitialPrefix] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>('...');
  
  // 持久化登录状态
  useEffect(() => {
    if (isAuthenticated && credentials.ak && credentials.sk) {
      localStorage.setItem('qiniu_session', JSON.stringify({
        isAuthenticated,
        credentials
      }));
    } else {
      localStorage.removeItem('qiniu_session');
    }
  }, [isAuthenticated, credentials]);

  // ── App version ──
  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => setAppVersion('未知'));
  }, []);

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

  const handleLogin = (ak: string, sk: string, description?: string) => {
    setCredentials({ ak, sk, description: description || "" });
    setIsAuthenticated(true);
  };

  // 检查更新
  const checkForUpdates = async (manual = false) => {
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
      } else if (manual) {
        toast.success('当前已是最新版本');
      }
    } catch (error) {
      console.error('检查更新失败:', error);
      if (manual) toast.error('检查更新失败', { description: '请检查网络连接' });
    }
  };

  useEffect(() => {
    checkForUpdates(false);
  }, []);

  // F5 刷新当前页面
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        
        if (activeSection === 'storage') {
          if (selectedBucket) {
            // 在文件管理页面，触发文件列表刷新
            setRefreshTrigger(prev => prev + 1);
          } else {
            // 在空间列表页面，刷新空间列表
            loadBuckets(credentials.ak, credentials.sk);
            toast.success('已刷新空间列表');
          }
        } else if (activeSection === 'cdn') {
          // 在 CDN 页面，触发子组件刷新
          setRefreshTrigger(prev => prev + 1);
        }
        // settings 页面不需要刷新
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSection, selectedBucket]);

  const { loadBuckets, clearBuckets } = useAppStore();

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCredentials({ ak: "", sk: "", description: "" });
    setSelectedBucket(null);
    setActiveSection("storage");
    setShowAccountMenu(false);
    clearBuckets();
    localStorage.removeItem('qiniu_session'); // 清除会话
    localStorage.removeItem('qiniu_last_login_ak'); // 清除自动登录记录
    localStorage.removeItem('qiniu_auto_login'); // 清除自动登录标记
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
    { id: "bookmarks", label: "书签管理", icon: Bookmark, desc: "快速访问 · 常用路径" },
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
            <div className="flex items-center gap-2.5 px-4 py-4 shrink-0">
              <img src="/logo.png" alt="Qiniu" className="h-7 w-7 object-contain shrink-0 rounded-[6px]" />
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
                      onBack={() => { setSelectedBucket(null); setInitialPrefix(""); }}
                      refreshTrigger={refreshTrigger}
                      initialPrefix={initialPrefix}
                      onInitialPrefixUsed={() => setInitialPrefix("")}
                    />
                  </div>
                ) : (
                  <div className="h-full p-5 flex flex-col">
                    <BucketList
                      ak={credentials.ak}
                      sk={credentials.sk}
                      onSelectBucket={(bucket) => {
                        // 保存当前滚动位置
                        const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
                        if (scrollArea) {
                          setBucketListScrollPos(scrollArea.scrollTop);
                        }
                        setInitialPrefix("");
                        setSelectedBucket(bucket);
                      }}
                      scrollPosition={bucketListScrollPos}
                      onScrollPositionRestored={() => setBucketListScrollPos(0)}
                    />
                  </div>
                )}
              </div>
              <div className={activeSection === "bookmarks" ? "h-full" : "hidden"}>
                <BookmarkPage
                  ak={credentials.ak}
                  onNavigate={(bucket, prefix) => {
                    setInitialPrefix(prefix);
                    setSelectedBucket(bucket);
                    setActiveSection("storage");
                  }}
                />
              </div>
              <div className={activeSection === "cdn" ? "h-full flex flex-col" : "hidden"}>
                {/* CDN Sub Navigation */}
                <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm shrink-0">
                  <button
                    onClick={() => setCdnSubSection("refresh")}
                    className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                      cdnSubSection === "refresh"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    刷新预取
                  </button>
                  <button
                    onClick={() => setCdnSubSection("domains")}
                    className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                      cdnSubSection === "domains"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    域名管理
                  </button>
                </div>
                
                {/* CDN Content */}
                <div className="flex-1 overflow-hidden">
                  <div className={`h-full ${cdnSubSection === "refresh" ? "" : "hidden"}`}>
                    <CdnManager 
                      ak={credentials.ak} 
                      sk={credentials.sk}
                      prefillDomain={prefillDomain}
                      onPrefillUsed={() => setPrefillDomain("")}
                      refreshTrigger={refreshTrigger}
                    />
                  </div>
                  <div className={`h-full ${cdnSubSection === "domains" ? "" : "hidden"}`}>
                    <DomainManager 
                      ak={credentials.ak} 
                      sk={credentials.sk}
                      selectedDomain={selectedDomain}
                      onSelectDomain={setSelectedDomain}
                      onRefreshDomain={(domain) => {
                        setPrefillDomain(domain);
                        setCdnSubSection("refresh");
                      }}
                      refreshTrigger={refreshTrigger}
                    />
                  </div>
                </div>
              </div>
              <div className={activeSection === "settings" ? "h-full" : "hidden"}>
                <SettingsPanel onCheckUpdate={() => checkForUpdates(true)} appVersion={appVersion} />
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
