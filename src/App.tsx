import { useState, useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { Toaster } from "./components/ui/toast";
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from "./components/ui/button";
import { Login } from "./pages/Login";
import { FileManager } from "./pages/FileManager";
import { BucketList } from "./pages/bucket-list/BucketList";
import { CdnManager } from "./pages/CdnManager";
import { DomainManager } from "./pages/DomainManager";
import { TransferPanel } from "./components/TransferPanel";
import { BookmarkPage } from "./pages/BookmarkPage";
import { SettingsPanel } from "./components/SettingsPanel";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { useAppStore } from "./store";
import {
  Database, Zap, LogOut, Settings, Bookmark,
  X, Folder, Globe, Loader2, Download,
  PanelLeftClose, PanelLeft,
} from "lucide-react";
import "./App.css";

type Section = "storage" | "bookmarks" | "cdn" | "settings";
type CdnSubSection = "refresh" | "domains";

const SETTINGS_SHORTCUT = navigator.userAgent.includes("Mac") ? "⌘," : "Ctrl+,";
const SIDEBAR_COLLAPSED_KEY = "qiniu_sidebar_collapsed";
const SIDEBAR_COLLAPSED_WIDTH = 56;
const SIDEBAR_EXPANDED_WIDTH = 230;

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
  const [cdnSubSection, setCdnSubSection] = useState<CdnSubSection>("domains");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [prefillDomain, setPrefillDomain] = useState<string>("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  // Compact UI lags behind width on collapse so content clips instead of reflowing mid-animation.
  const [sidebarCompact, setSidebarCompact] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  const [bucketListScrollPos, setBucketListScrollPos] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [initialPrefix, setInitialPrefix] = useState<string>("");
  const [appVersion, setAppVersion] = useState<string>('...');
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const updateInstallInFlight = useRef(false);
  const updateCheckInFlight = useRef(false);
  
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

  const handleLogin = (ak: string, sk: string, description?: string) => {
    setCredentials({ ak, sk, description: description || "" });
    setIsAuthenticated(true);
  };

  // Check silently at startup; keep the returned update for a direct install.
  useEffect(() => {
    if (updateCheckInFlight.current) return;
    updateCheckInFlight.current = true;
    check().then(setAvailableUpdate).catch(error => console.error('检查更新失败:', error));
  }, []);

  const installUpdate = async () => {
    if (!availableUpdate || updateInstallInFlight.current) return;
    updateInstallInFlight.current = true;
    setInstallingUpdate(true);
    const notice = toast.loading('正在下载更新...');
    try {
      await availableUpdate.downloadAndInstall(event => {
        if (event.event === 'Finished') toast.loading('正在安装更新...', { id: notice });
      });
      setAvailableUpdate(null);
      try {
        await relaunch();
      } catch {
        toast.info('更新已安装，请手动重启应用');
      }
    } catch (error) {
      toast.error('更新失败，请重试', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      toast.dismiss(notice);
      updateInstallInFlight.current = false;
      setInstallingUpdate(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    const handleSettingsShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setShowAccountMenu(false);
        setActiveSection("settings");
      }
    };
    window.addEventListener("keydown", handleSettingsShortcut);
    return () => window.removeEventListener("keydown", handleSettingsShortcut);
  }, [isAuthenticated]);

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

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  const toggleSidebarCollapsed = () => {
    setShowAccountMenu(false);
    if (sidebarCollapsed) {
      // Expand: restore full layout first (clipped), then grow width.
      setSidebarCompact(false);
      requestAnimationFrame(() => setSidebarCollapsed(false));
    } else {
      // Collapse: shrink width first; switch to icon rail after transition.
      setSidebarCollapsed(true);
    }
  };

  const handleSidebarTransitionEnd = (event: React.TransitionEvent<HTMLElement>) => {
    if (event.propertyName !== "width" || event.target !== event.currentTarget) return;
    setSidebarCompact(sidebarCollapsed);
  };

  const navItems: { id: Section; label: string; icon: typeof Database; desc: string; cdnSection?: CdnSubSection }[] = [
    { id: "storage", label: "空间管理", icon: Database, desc: "对象存储 · 文件" },
    { id: "bookmarks", label: "书签管理", icon: Bookmark, desc: "快速访问 · 常用路径" },
    { id: "cdn", label: "域名管理", icon: Globe, desc: "加速域名 · 配置详情", cdnSection: "domains" },
    { id: "cdn", label: "刷新预取", icon: Zap, desc: "缓存刷新 · 文件预取", cdnSection: "refresh" },
    { id: "settings", label: "设置", icon: Settings, desc: "外观 · 偏好" },
  ];

  return (
    <main 
      className="min-h-screen text-zinc-900 dark:text-zinc-50 font-sans selection:bg-emerald-200 dark:selection:bg-emerald-900"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Toaster />
      {!isAuthenticated ? (
        <Login onLogin={handleLogin} />
      ) : (
        <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-950">

          {/* ── Sidebar ── */}
          <aside 
            className="shrink-0 flex flex-col overflow-x-hidden bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 relative transition-[width] duration-200 ease-out"
            style={{ width: `${sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH}px` }}
            onTransitionEnd={handleSidebarTransitionEnd}
          >
            {/* Sidebar chrome */}
            <div className="flex h-11 shrink-0 items-center">
              <div className="flex w-14 shrink-0 justify-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={toggleSidebarCollapsed}
                  title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
                  aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
                  aria-pressed={sidebarCollapsed}
                >
                  {sidebarCollapsed ? <PanelLeft /> : <PanelLeftClose />}
                </Button>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
              {navItems.map(({ id, label, icon: Icon, desc, cdnSection }) => {
                const active = activeSection === id && (!cdnSection || cdnSubSection === cdnSection);
                return (
                  <button
                    key={cdnSection || id}
                    aria-current={active ? "page" : undefined}
                    aria-label={label}
                    title={id === "settings" ? `设置 (${SETTINGS_SHORTCUT})` : label}
                    onClick={() => {
                      if (id === "storage" && activeSection === "storage") {
                        // 如果已经在空间管理页面，返回空间列表
                        setSelectedBucket(null);
                      } else {
                        setActiveSection(id);
                        if (cdnSection) setCdnSubSection(cdnSection);
                      }
                    }}
                    className={`w-full h-12 flex items-center text-left group relative cursor-pointer
                      ${active
                        ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
                  >
                    {/* Active indicator */}
                    {active && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-emerald-500" />
                    )}
                    <span className="flex w-14 shrink-0 items-center justify-center">
                      <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}`} />
                    </span>
                    <div className={`min-w-0 flex-1 ${sidebarCompact ? "invisible w-0 overflow-hidden" : "pr-4 -ml-2"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-[13px] leading-tight whitespace-nowrap ${active ? "font-semibold" : "font-medium"}`}>{label}</p>
                      </div>
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 leading-tight mt-0.5 whitespace-nowrap">{desc}</p>
                    </div>
                  </button>
                );
              })}
            </nav>

            {/* Account + system tools */}
            <div className="h-12 shrink-0 relative z-30">
              <div className="flex h-full items-center gap-1 px-0" style={{ minWidth: SIDEBAR_EXPANDED_WIDTH }}>
                <button
                  aria-label="当前账号"
                  aria-expanded={showAccountMenu}
                  title={sidebarCompact || sidebarCollapsed ? `${credentials.description || "未命名账号"}（账号）` : undefined}
                  onClick={() => setShowAccountMenu(v => !v)}
                  className="group/account flex h-9 min-w-0 flex-1 items-center gap-0 rounded-lg px-0 text-left transition-colors cursor-pointer"
                >
                  <span className="flex w-14 shrink-0 items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300 flex items-center justify-center font-bold text-sm shrink-0">
                      {(credentials.description || credentials.ak).charAt(0).toUpperCase()}
                    </div>
                  </span>
                  <p className={`min-w-0 truncate pr-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors group-hover/account:text-zinc-900 dark:group-hover/account:text-zinc-100 ${
                    sidebarCompact || sidebarCollapsed ? "hidden" : "-ml-1"
                  }`}>
                    {credentials.description || "未命名账号"}
                  </p>
                </button>

                <div className="flex shrink-0 items-center gap-0.5 pr-3">
                  {(availableUpdate || installingUpdate) && <Button
                    variant="ghost"
                    size="icon-sm"
                    className="relative shrink-0 text-muted-foreground"
                    disabled={installingUpdate}
                    onClick={installUpdate}
                    title={installingUpdate ? '正在下载安装更新' : `更新至 v${availableUpdate?.version}`}
                    aria-label={installingUpdate ? '正在更新' : `更新至 ${availableUpdate?.version}`}
                  >
                    {installingUpdate ? <Loader2 className="animate-spin" /> : <Download />}
                    {!installingUpdate && <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background" />}
                  </Button>}
                  <ThemeSwitcher />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="GitHub"
                    title="查看源码、反馈问题"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => {
                      if (isTauri()) {
                        openUrl('https://github.com/Leskur/qiniu-browser').catch(() => toast.error('打开 GitHub 失败，请重试'));
                      } else {
                        window.open('https://github.com/Leskur/qiniu-browser', '_blank', 'noopener,noreferrer');
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4">
                      <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.63 0c2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.28-5.15 5.56.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.78.54A11.25 11.25 0 0 0 12 .75Z" />
                    </svg>
                  </Button>
                </div>
              </div>

              {showAccountMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAccountMenu(false)} />
                  <div
                    className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden ${
                      sidebarCompact || sidebarCollapsed
                        ? "fixed bottom-3 w-56"
                        : "absolute bottom-full mb-1 left-0 right-0 mx-2"
                    }`}
                    style={
                      sidebarCompact || sidebarCollapsed
                        ? { left: SIDEBAR_COLLAPSED_WIDTH + 8 }
                        : undefined
                    }
                  >
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
                        <span>退出登录</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

          </aside>

          {/* ── Main ── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
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
                  <div className="h-full flex flex-col">
                    <BucketList
                      ak={credentials.ak}
                      sk={credentials.sk}
                      onSelectBucket={(bucket) => {
                        // 保存当前滚动位置
                        const scrollArea = document.querySelector('[data-slot="scroll-area-viewport"]');
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
                        setActiveSection("cdn");
                        setCdnSubSection("refresh");
                      }}
                      refreshTrigger={refreshTrigger}
                    />
                  </div>
                </div>
              </div>
              <div className={activeSection === "settings" ? "h-full" : "hidden"}>
                <SettingsPanel appVersion={appVersion} />
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
