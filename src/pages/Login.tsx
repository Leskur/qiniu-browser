import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { Plus, Trash2, Loader2, Eye, EyeOff, ArrowLeft, ArrowRight, Import } from "lucide-react";
import { validateCredentials } from "@/lib/qiniu";

interface HistoryItem {
  accessKey: string;
  accessSecret: string;
  description?: string;
}

type ViewMode = "list" | "form";

export function Login({ onLogin }: { onLogin: (ak: string, sk: string, description?: string) => void }) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Form state
  const [ak, setAk] = useState("");
  const [sk, setSk] = useState("");
  const [description, setDescription] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showSk, setShowSk] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loggingInKey, setLoggingInKey] = useState<string | null>(null);

  // Kodo import
  const [isImporting, setIsImporting] = useState(false);
  const [showKodoDialog, setShowKodoDialog] = useState(false);
  const [kodoItems, setKodoItems] = useState<HistoryItem[]>([]);
  const [selectedKodoKeys, setSelectedKodoKeys] = useState<Set<string>>(new Set());
  const [savingImport, setSavingImport] = useState(false);
  const importInFlight = useRef(false);

  // Load histories on mount and try auto-login
  useEffect(() => {
    loadHistories();
    tryAutoLogin();
  }, []);

  const tryAutoLogin = async () => {
    try {
      // 从 localStorage 获取上次登录的账号
      const lastLoginKey = localStorage.getItem('qiniu_last_login_ak');
      if (!lastLoginKey) return;

      // 等待历史记录加载完成
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const data = await invoke<string>("get_histories");
      const parsed = JSON.parse(data);
      const items: HistoryItem[] = (parsed.historyItems || []).filter(
        (item: any) => item.accessKey && item.accessSecret
      );
      
      const lastAccount = items.find(item => item.accessKey === lastLoginKey);
      if (lastAccount) {
        setLoggingInKey(lastAccount.accessKey);
        try {
          await doLogin(lastAccount.accessKey, lastAccount.accessSecret, lastAccount.description);
        } catch (err: any) {
          // 自动登录失败，显示登录界面
          toast.error("自动登录失败", { description: err.message });
          setLoggingInKey(null);
        }
      }
    } catch (err) {
      // 忽略自动登录错误
      console.error('Auto login failed:', err);
    }
  };

  const loadHistories = async () => {
    setLoadingHistory(true);
    try {
      const data = await invoke<string>("get_histories");
      const parsed = JSON.parse(data);
      const items: HistoryItem[] = (parsed.historyItems || []).filter(
        (item: any) => item.accessKey && item.accessSecret
      );
      setHistoryItems(items);
      if (items.length === 0) setViewMode("form");
    } catch {
      setViewMode("form");
    } finally {
      setLoadingHistory(false);
    }
  };

  const doLogin = async (loginAk: string, loginSk: string, loginDescription?: string, remember?: () => Promise<boolean>) => {
    try {
      const valid = await validateCredentials(loginAk, loginSk);
      if (!valid) {
        throw new Error("AK/SK 无效，请检查后重试");
      }
      if (!remember || await remember()) localStorage.setItem('qiniu_last_login_ak', loginAk);
      else localStorage.removeItem('qiniu_last_login_ak');
      onLogin(loginAk, loginSk, loginDescription);
    } catch (err: any) {
      throw new Error(err.message || "AK/SK 无效，请检查后重试");
    }
  };

  // Login from history list
  const handleSelectHistory = async (item: HistoryItem) => {
    setLoggingInKey(item.accessKey);
    try {
      await doLogin(item.accessKey, item.accessSecret, item.description);
    } catch (err: any) {
      toast.error("验证失败", { description: err.message });
    } finally {
      setLoggingInKey(null);
    }
  };

  // Login from form
  const handleFormLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ak || !sk) return;
    setIsLoggingIn(true);
    try {
      await doLogin(ak, sk, description, async () => {
        if (!rememberMe) return false;
        try {
          await invoke("save_history", {
            newItem: {
              endpointType: "public",
              accessKey: ak,
              accessSecret: sk,
              rememberMe: true,
              description,
            },
          });
          return true;
        } catch {
          toast.warning("登录成功，但未能保存账号");
          return false;
        }
      });
    } catch (err: any) {
      toast.error("登录失败", { description: err.message });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleDeleteHistory = async (e: React.MouseEvent, accessKey: string) => {
    e.stopPropagation();
    try {
      await invoke("delete_history", { accessKey });
      const next = historyItems.filter(item => item.accessKey !== accessKey);
      setHistoryItems(next);
      if (next.length === 0) setViewMode("form");
      toast.success("已删除");
    } catch (err: any) {
      toast.error("删除失败", { description: err.message });
    }
  };

  const handleImportFromKodo = async () => {
    setIsImporting(true);
    try {
      const data = await invoke<string>("get_kodo_histories");
      const parsed = JSON.parse(data);
      const validItems: HistoryItem[] = (parsed.historyItems || []).filter(
        (item: any) => item.accessKey && item.accessSecret
      );
      if (validItems.length === 0) {
        toast.error("Kodo Browser 配置中未找到凭证");
        return;
      }
      setKodoItems([...new Map(validItems.map(item => [item.accessKey, item])).values()]);
      setSelectedKodoKeys(new Set());
      setShowKodoDialog(true);
    } catch (err: any) {
      toast.error("导入失败", { description: err.message || "未找到 Kodo Browser 配置" });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportSelected = async () => {
    if (importInFlight.current || selectedKodoKeys.size === 0) return;
    importInFlight.current = true;
    setSavingImport(true);
    const selected = kodoItems.filter(item => selectedKodoKeys.has(item.accessKey));
    const failed = new Set<string>();
    let firstError = "";
    try {
      // 顺序写入，避免多个保存操作同时覆盖本地历史文件。
      for (const item of selected) {
        try {
          await invoke("save_history", {
            newItem: {
              endpointType: "public",
              accessKey: item.accessKey,
              accessSecret: item.accessSecret,
              rememberMe: true,
              description: item.description || "",
            },
          });
        } catch (error) {
          failed.add(item.accessKey);
          if (!firstError) firstError = error instanceof Error ? error.message : String(error);
        }
      }
      const imported = selected.length - failed.size;
      if (imported > 0) {
        await loadHistories();
        setViewMode("list");
      }
      setSelectedKodoKeys(failed);
      if (failed.size > 0) {
        toast.error(`已导入 ${imported} 个，${failed.size} 个失败`, { description: `${firstError}。失败账号已保留勾选，可重试。` });
      } else {
        setShowKodoDialog(false);
        toast.success(`已导入 ${imported} 个账号`);
      }
    } finally {
      importInFlight.current = false;
      setSavingImport(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex min-h-screen flex-col bg-zinc-50 text-foreground dark:bg-zinc-950">
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-8">
        <div className="flex items-center gap-2.5">
          <img src="/app-icon.png" alt="" className="size-7 rounded-lg object-contain" />
          <span className="text-sm font-semibold tracking-tight">Qiniu Browser</span>
        </div>
        <ThemeSwitcher />
      </header>
      <div className="flex flex-1 items-center justify-center px-5 pb-16 pt-6">
      <section aria-labelledby="login-title" className="w-full max-w-sm">
        <div className="mb-6">
          {viewMode === "form" && historyItems.length > 0 && (
            <Button variant="ghost" size="sm" className="-ml-2 mb-4 text-muted-foreground" disabled={isLoggingIn} onClick={() => { setViewMode("list"); setAk(""); setSk(""); setDescription(""); }}>
              <ArrowLeft />返回账号列表
            </Button>
          )}
          <h1 id="login-title" className="text-2xl font-semibold tracking-tight">
            {loadingHistory ? "正在加载账号" : viewMode === "list" ? "选择账号" : "连接七牛云"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {viewMode === "list" ? "选择一个已保存的账号，继续管理你的资源。" : "使用 AccessKey 和 SecretKey 登录。"}
          </p>
        </div>

        <div>
          {/* ── Account list mode ── */}
          {viewMode === "list" && (
            <div className="space-y-3">
              {loadingHistory ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border bg-background p-1">
                  <div id="saved-accounts" role="group" aria-label="已保存账号" className="max-h-42 overflow-y-auto overscroll-contain">
                  {historyItems.map((item) => {
                    const isLoading = loggingInKey === item.accessKey;
                    const displayLabel = item.accessKey.substring(0, 16) + "...";
                    return (
                      <div
                        key={item.accessKey}
                        className="group flex items-center rounded-lg transition-colors hover:bg-muted/70 focus-within:bg-muted/70"
                      >
                        <Button variant="ghost"
                          type="button"
                          disabled={loggingInKey !== null}
                          onClick={() => handleSelectHistory(item)}
                          className="h-auto p-0 flex h-14 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
                        >
                        {/* Avatar */}
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-600/10 bg-emerald-50 text-xs font-semibold text-emerald-700 dark:border-emerald-400/10 dark:bg-emerald-400/10 dark:text-emerald-400">
                          {(item.description || item.accessKey).charAt(0).toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium">{item.description || "未命名账号"}</p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{displayLabel}</p>
                        </div>

                        {/* Right side */}
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-emerald-500 shrink-0" />
                        ) : null}
                        </Button>
                            <Button variant="ghost"
                              type="button"
                              onClick={(e) => handleDeleteHistory(e, item.accessKey)}
                              disabled={loggingInKey !== null}
                              className="h-auto p-0 mr-2 rounded-md p-2 text-muted-foreground/50 opacity-0 pointer-events-none transition-[color,background-color,opacity] group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                              title="移除已保存账号"
                              aria-label={`移除${item.description || "未命名账号"}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}

              {/* Add new account */}
              {!loadingHistory && (
                <Button
                  variant="outline"
                  onClick={() => setViewMode("form")}
                  disabled={loggingInKey !== null}
                  className="h-10 w-full bg-transparent text-foreground"
                >
                  <Plus className="w-4 h-4" />
                  添加新账号
                </Button>
              )}
            </div>
          )}

          {/* ── Form mode ── */}
          {viewMode === "form" && (
            <form onSubmit={handleFormLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ak">AccessKey</Label>
                <Input
                  id="ak"
                  placeholder="请输入 AK"
                  value={ak}
                  onChange={(e) => setAk(e.target.value)}
                  required
                  autoFocus
                  className="h-10 bg-background"
                  disabled={isLoggingIn}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sk">SecretKey</Label>
                <div className="relative">
                  <Input
                    id="sk"
                    type={showSk ? "text" : "password"}
                    placeholder="请输入 SK"
                    value={sk}
                    onChange={(e) => setSk(e.target.value)}
                    required
                    className="h-10 bg-background pr-10"
                    disabled={isLoggingIn}
                  />
                  <Button variant="ghost"
                    type="button"
                    onClick={() => setShowSk(v => !v)}
                    className="h-auto p-0 absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    aria-label={showSk ? "隐藏 SecretKey" : "显示 SecretKey"}
                    aria-pressed={showSk}
                  >
                    {showSk ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">账号名称 <span className="font-normal text-muted-foreground">（可选）</span></Label>
                <Input
                  id="description"
                  placeholder="如：公司账号、个人账号"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-10 bg-background"
                  disabled={isLoggingIn}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-1">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                  />
                  <Label htmlFor="remember" className="text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer">
                    记住凭证
                  </Label>
                </div>
              </div>
              <Button
                type="submit"
                disabled={isLoggingIn || !ak || !sk}
                className="h-10 w-full cursor-pointer"
              >
                {isLoggingIn ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />验证中...</>
                ) : (
                  <>连接账号<ArrowRight className="size-4" /></>
                )}
              </Button>

            </form>
          )}
        </div>
        <div className="mt-6 flex justify-center border-t pt-4">
          <Button type="button" variant="ghost" size="sm" onClick={handleImportFromKodo} disabled={isImporting || isLoggingIn || loggingInKey !== null} className="text-xs font-normal text-muted-foreground">
            {isImporting ? <Loader2 className="animate-spin" /> : <Import />}
            {isImporting ? "正在导入…" : "从 Kodo Browser 导入账号"}
          </Button>
        </div>
      </section>
      </div>

      {/* Kodo import dialog */}
      <Dialog open={showKodoDialog} onOpenChange={open => { if (!importInFlight.current) setShowKodoDialog(open); }}>
        <DialogContent showCloseButton={!savingImport}>
          <DialogHeader>
            <DialogTitle>从 Kodo Browser 导入</DialogTitle>
            <DialogDescription>选择要导入的账号。相同 AccessKey 的已保存记录将被更新。</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <Label className="cursor-pointer gap-2 font-normal">
              <Checkbox
                aria-label="全选账号"
                checked={kodoItems.length > 0 && selectedKodoKeys.size === kodoItems.length}
                indeterminate={selectedKodoKeys.size > 0 && selectedKodoKeys.size < kodoItems.length}
                disabled={savingImport}
                onCheckedChange={checked => setSelectedKodoKeys(checked ? new Set(kodoItems.map(item => item.accessKey)) : new Set())}
              />
              全选
            </Label>
            <span>已选 {selectedKodoKeys.size} / {kodoItems.length}</span>
          </div>
          <div className="max-h-[min(18rem,40vh)] space-y-1 overflow-y-auto rounded-lg border p-1">
            {kodoItems.map(item => (
              <Label key={item.accessKey} className={`flex cursor-pointer items-center gap-3 rounded-md p-2.5 hover:bg-muted ${selectedKodoKeys.has(item.accessKey) ? "bg-primary/5" : ""}`}>
                <Checkbox
                  aria-label={`选择${item.description || item.accessKey}`}
                  checked={selectedKodoKeys.has(item.accessKey)}
                  disabled={savingImport}
                  onCheckedChange={checked => setSelectedKodoKeys(previous => {
                    const next = new Set(previous);
                    if (checked) next.add(item.accessKey); else next.delete(item.accessKey);
                    return next;
                  })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.description || "未命名账号"}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] font-normal text-muted-foreground">{item.accessKey.substring(0, 16)}…</span>
                </span>
                {historyItems.some(saved => saved.accessKey === item.accessKey) && <span className="shrink-0 text-[11px] font-normal text-muted-foreground">已保存</span>}
              </Label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={savingImport} onClick={() => setShowKodoDialog(false)}>取消</Button>
            <Button disabled={savingImport || selectedKodoKeys.size === 0} onClick={handleImportSelected}>
              {savingImport ? <><Loader2 className="animate-spin" />正在导入…</> : "导入所选"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
