import { useState, useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { Toaster } from "./components/ui/toast";
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Login } from "./pages/Login";
import { FileManager } from "./pages/FileManager";
import { BucketList } from "./pages/bucket-list/BucketList";
import { CdnManager } from "./pages/CdnManager";
import { DomainManager } from "./pages/DomainManager";
import { TransferPanel } from "./components/TransferPanel";
import { BookmarkPage } from "./pages/BookmarkPage";
import { SettingsPanel } from "./components/SettingsPanel";
import { HAS_CUSTOM_TITLEBAR, WindowTitlebar } from "./components/WindowTitlebar";
import { useAppStore } from "./store";
import { useTransferStore } from "./store/transfer";
import {
  Database, Zap, LogOut, Settings, Bookmark,
  X, Folder, Globe, Loader2, Download,
  PanelLeft, Pencil,
} from "lucide-react";
import "./App.css";

type Section = "storage" | "bookmarks" | "cdn" | "settings";
type CdnSubSection = "refresh" | "domains";

const SETTINGS_SHORTCUT = navigator.userAgent.includes("Mac") ? "⌘," : "Ctrl+,";
const SIDEBAR_COLLAPSED_KEY = "qiniu_sidebar_collapsed";
const SIDEBAR_COLLAPSED_WIDTH = 56;
const SIDEBAR_EXPANDED_WIDTH = 230;

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [credentials, setCredentials] = useState({ ak: "", sk: "", description: "" });
  
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("storage");
  const [cdnSubSection, setCdnSubSection] = useState<CdnSubSection>("domains");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showRenameAccount, setShowRenameAccount] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [renamingAccount, setRenamingAccount] = useState(false);
  const accountRenameInFlight = useRef(false);
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
  
  useEffect(() => {
    const preventTabNavigation = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", preventTabNavigation, true);
    return () => window.removeEventListener("keydown", preventTabNavigation, true);
  }, []);

  useEffect(() => {
    localStorage.removeItem('qiniu_session');
  }, []);

  // ── App version ──
  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => setAppVersion('未知'));
  }, []);

  const handleLogin = (ak: string, sk: string, description?: string) => {
    useAppStore.getState().setBucketAccount(ak);
    setCredentials({ ak, sk, description: description || "" });
    setIsAuthenticated(true);
  };

  const handleRenameAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    const description = accountName.trim();
    if (!description || accountRenameInFlight.current) return;
    accountRenameInFlight.current = true;
    setRenamingAccount(true);
    try {
      if (isTauri()) {
        await invoke("rename_history", { accessKey: credentials.ak, description });
      }
      setCredentials({ ...credentials, description });
      setShowRenameAccount(false);
      toast.success("账号已重命名");
    } catch (error) {
      toast.error("重命名失败", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      accountRenameInFlight.current = false;
      setRenamingAccount(false);
    }
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
      if (isAuthenticated && e.key === 'F5') {
        e.preventDefault();
        
        if (activeSection === 'storage') {
          if (selectedBucket) {
            // 在文件管理页面，触发文件列表刷新
            setRefreshTrigger(prev => prev + 1);
          } else {
            // 在空间列表页面，刷新空间列表
            void useAppStore.getState().loadBuckets(credentials.ak, credentials.sk);
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
  }, [activeSection, selectedBucket, isAuthenticated, credentials.ak, credentials.sk]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCredentials({ ak: "", sk: "", description: "" });
    setSelectedBucket(null);
    setActiveSection("storage");
    setShowAccountMenu(false);
    useAppStore.getState().setBucketAccount(null);
    const transfers = useTransferStore.getState();
    transfers.clearAll();
    transfers.setPanelOpen(false);
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

  const navItems: { id: Section; label: string; icon: typeof Database; cdnSection?: CdnSubSection }[] = [
    { id: "storage", label: "空间管理", icon: Database },
    { id: "bookmarks", label: "书签管理", icon: Bookmark },
    { id: "cdn", label: "域名管理", icon: Globe, cdnSection: "domains" },
    { id: "cdn", label: "刷新预取", icon: Zap, cdnSection: "refresh" },
    { id: "settings", label: "设置", icon: Settings },
  ];

  return (
    <main 
      className="flex h-screen flex-col overflow-hidden bg-sidebar text-foreground font-sans selection:bg-zinc-200 dark:selection:bg-accent"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Toaster />
      <WindowTitlebar showSidebarToggle={isAuthenticated} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebarCollapsed} />
      {!isAuthenticated ? (
        <div className="min-h-0 flex-1 overflow-auto"><Login onLogin={handleLogin} /></div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden bg-sidebar">

          {/* ── Sidebar ── */}
          <aside 
            className="shrink-0 flex flex-col overflow-x-hidden bg-sidebar relative transition-[width] duration-200 ease-out"
            style={{ width: `${sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH}px` }}
            onTransitionEnd={handleSidebarTransitionEnd}
          >
            {/* Sidebar chrome */}
            {!HAS_CUSTOM_TITLEBAR && <div className="flex h-11 shrink-0 items-center">
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
                  <PanelLeft />
                </Button>
              </div>
            </div>}

            {/* Nav */}
            <nav className="flex min-h-0 flex-1 flex-col gap-2 px-2 py-3 overflow-y-auto overflow-x-hidden">
              {navItems.map(({ id, label, icon: Icon, cdnSection }) => {
                const active = activeSection === id && (!cdnSection || cdnSubSection === cdnSection);
                return (
                  <Button variant="ghost"
                    key={cdnSection || id}
                    aria-current={active ? "page" : undefined}
                    aria-label={label}
                    title={sidebarCollapsed ? (id === "settings" ? `设置 (${SETTINGS_SHORTCUT})` : label) : undefined}
                    tooltipSide="right"
                    onClick={() => {
                      if (id === "storage" && activeSection === "storage") {
                        // 如果已经在空间管理页面，返回空间列表
                        setSelectedBucket(null);
                      } else {
                        setActiveSection(id);
                        if (cdnSection) setCdnSubSection(cdnSection);
                      }
                    }}
                    className={`w-full h-10 min-h-10 max-h-10 flex items-center justify-start gap-0 rounded-lg border-0 p-0 text-left leading-none group cursor-default
                      ${active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
                  >
                    <span className="flex w-10 shrink-0 items-center justify-center">
                      <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? "text-sidebar-foreground" : "text-muted-foreground group-hover:text-sidebar-foreground"}`} />
                    </span>
                    <span className={`flex h-full min-w-0 flex-1 items-center text-[13px] leading-none whitespace-nowrap ${active ? "font-semibold" : "font-medium"} ${sidebarCompact ? "invisible w-0 overflow-hidden" : "pr-4"}`}>
                      {label}
                    </span>
                  </Button>
                );
              })}
            </nav>

            {/* Account + system tools */}
            <div className="h-12 shrink-0 relative z-30">
              <div className="flex h-full items-center gap-1 px-2" style={{ minWidth: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH }}>
                <Popover open={showAccountMenu} onOpenChange={setShowAccountMenu}>
                  <PopoverTrigger render={<Button variant="ghost" tooltipSide="right" />}
                  aria-label="当前账号"
                  title={sidebarCompact || sidebarCollapsed ? `${credentials.description || "未命名账号"}（账号）` : undefined}
                  className={`flex h-10 min-w-10 items-center justify-start gap-0 rounded-lg border-0 px-0 text-left text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-foreground ${sidebarCollapsed ? "w-10 flex-none" : "flex-1"}`}
                >
                  <span className="flex w-10 shrink-0 items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-background text-sidebar-foreground flex items-center justify-center font-bold text-sm shrink-0">
                      {(credentials.description || credentials.ak).charAt(0).toUpperCase()}
                    </div>
                  </span>
                  <p className={`min-w-0 truncate pr-2 text-xs font-medium ${
                    sidebarCompact || sidebarCollapsed ? "hidden" : ""
                  }`}>
                    {credentials.description || "未命名账号"}
                  </p>
                  </PopoverTrigger>
                  <PopoverContent side={sidebarCompact || sidebarCollapsed ? "right" : "top"} align="start" className="w-56 gap-0 p-1" aria-label="账号操作">
                    {(sidebarCompact || sidebarCollapsed) && (
                      <div className="mx-1 mb-1 break-words border-b border-border/50 px-1.5 py-2 text-sm font-medium text-popover-foreground">
                        {credentials.description || "未命名账号"}
                      </div>
                    )}
                    <Button variant="ghost" className="w-full justify-start" onClick={() => {
                      setAccountName(credentials.description || "");
                      setShowAccountMenu(false);
                      setShowRenameAccount(true);
                    }}><Pencil />重命名</Button>
                    <Button variant="ghost" className="w-full justify-start" onClick={() => {
                      handleLogout();
                      setShowAccountMenu(false);
                    }}><LogOut />退出登录</Button>
                  </PopoverContent>
                </Popover>

                {(availableUpdate || installingUpdate) && <div className={`${sidebarCollapsed ? "hidden" : "flex"} shrink-0 items-center`}>
                  <Button
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
                  </Button>
                </div>}
              </div>

            </div>

          </aside>

          {/* ── Main ── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative rounded-tl-xl bg-white dark:bg-background">
            {/* Content — always mounted, visibility toggled to preserve state */}
            <div className="flex-1 overflow-hidden relative z-10">
              <div className={`h-full relative flex flex-col ${activeSection === "storage" ? "" : "hidden"}`}>
                {selectedBucket ? (
                  <div className="absolute inset-0 z-20 bg-white dark:bg-background">
                    <FileManager
                      key={selectedBucket}
                      ak={credentials.ak}
                      sk={credentials.sk}
                      bucket={selectedBucket}
                      isActive={activeSection === "storage"}
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
                      isActive={activeSection === "cdn" && cdnSubSection === "domains"}
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

      {isAuthenticated && (
        <Dialog open={showRenameAccount} onOpenChange={(open) => { if (!accountRenameInFlight.current) setShowRenameAccount(open); }}>
          <DialogContent showCloseButton={!renamingAccount}>
            <DialogHeader>
              <DialogTitle>重命名账号</DialogTitle>
              <DialogDescription>修改此账号在应用中显示的名称。</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleRenameAccount} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="account-name">账号名称</Label>
                <Input
                  id="account-name"
                  autoFocus
                  required
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  onFocus={(event) => event.target.select()}
                  placeholder="如：公司账号、个人账号"
                  disabled={renamingAccount}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={renamingAccount} onClick={() => setShowRenameAccount(false)}>取消</Button>
                <Button type="submit" disabled={renamingAccount || !accountName.trim()}>
                  {renamingAccount ? <><Loader2 className="animate-spin" />保存中...</> : "保存"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      
      {/* Transfer Panel - Global */}
      {isAuthenticated && <TransferPanel />}
    </main>
  );
}

export default App;
