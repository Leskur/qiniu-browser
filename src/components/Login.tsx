import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, LogIn, Loader2, Eye, EyeOff, ChevronRight } from "lucide-react";
import { fetchBuckets, QiniuBucket } from "@/lib/qiniu";

interface HistoryItem {
  accessKey: string;
  accessSecret: string;
  description?: string;
}

type ViewMode = "list" | "form";

export function Login({ onLogin }: { onLogin: (ak: string, sk: string, description?: string, buckets?: QiniuBucket[]) => void }) {
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
  const [autoLogin, setAutoLogin] = useState(() => {
    return localStorage.getItem('qiniu_auto_login') === 'true';
  });

  // Kodo import
  const [isImporting, setIsImporting] = useState(false);
  const [showKodoDialog, setShowKodoDialog] = useState(false);
  const [kodoItems, setKodoItems] = useState<HistoryItem[]>([]);

  // Load histories on mount and try auto-login
  useEffect(() => {
    loadHistories();
    tryAutoLogin();
  }, []);

  const tryAutoLogin = async () => {
    try {
      // 从 localStorage 获取上次登录的账号
      const lastLoginKey = localStorage.getItem('qiniu_last_login_ak');
      const autoLogin = localStorage.getItem('qiniu_auto_login') === 'true';
      
      if (!lastLoginKey || !autoLogin) return;

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

  const doLogin = async (loginAk: string, loginSk: string, loginDescription?: string) => {
    try {
      // 直接获取 Bucket 列表，同时验证凭证
      const buckets = await fetchBuckets(loginAk, loginSk);
      // 保存上次登录的账号
      localStorage.setItem('qiniu_last_login_ak', loginAk);
      // 登录成功，传递 buckets 数据
      onLogin(loginAk, loginSk, loginDescription, buckets);
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
      if (rememberMe) {
        await invoke("save_history", {
          newItem: {
            endpointType: "public",
            accessKey: ak,
            accessSecret: sk,
            rememberMe: true,
            description: description,
          },
        });
      }
      await doLogin(ak, sk, description);
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
      setKodoItems(validItems);
      setShowKodoDialog(true);
    } catch (err: any) {
      toast.error("导入失败", { description: err.message || "未找到 Kodo Browser 配置" });
    } finally {
      setIsImporting(false);
    }
  };

  const handleSelectKodoItem = async (item: HistoryItem) => {
    console.log("[kodo import] selected item:", { accessKey: item.accessKey, description: item.description });
    try {
      console.log("[kodo import] calling save_history...");
      await invoke("save_history", {
        newItem: {
          endpointType: "public",
          accessKey: item.accessKey,
          accessSecret: item.accessSecret,
          rememberMe: true,
          description: item.description || "",
        },
      });
      console.log("[kodo import] save_history ok, reloading histories...");
      toast.success("已导入");
      await loadHistories();
      console.log("[kodo import] loadHistories ok, switching to list view");
      setShowKodoDialog(false);
      setViewMode("list");
    } catch (err: any) {
      console.error("[kodo import] failed:", err);
      toast.error("导入失败", { description: err.message });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4">
      <Card className="w-full max-w-md shadow-xl border-zinc-200/50 dark:border-zinc-800/50 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl">
        <CardHeader className="space-y-1 text-center pb-6">
          <div className="flex justify-center mb-4">
            <img src="/logo.png" alt="Qiniu Logo" className="h-16 w-auto object-contain drop-shadow-sm" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            Qiniu Browser
          </CardTitle>
          <CardDescription className="text-zinc-500">
            {viewMode === "list" ? "选择账号登录" : "输入七牛云 AccessKey 和 SecretKey"}
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-4">
          {/* ── Account list mode ── */}
          {viewMode === "list" && (
            <div className="space-y-3">
              {/* Auto-login toggle */}
              <div className="flex items-center justify-between px-1 py-2">
                <Label htmlFor="autoLoginToggle" className="text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer">
                  自动登录上次使用的账号
                </Label>
                <Checkbox
                  id="autoLoginToggle"
                  checked={autoLogin}
                  onCheckedChange={(checked) => {
                    const value = checked === true;
                    setAutoLogin(value);
                    localStorage.setItem('qiniu_auto_login', value.toString());
                  }}
                />
              </div>

              {loadingHistory ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              ) : (
                <div className="space-y-2">
                  {historyItems.map((item) => {
                    const isLoading = loggingInKey === item.accessKey;
                    const displayLabel = item.accessKey.substring(0, 16) + "...";
                    return (
                      <div
                        key={item.accessKey}
                        onClick={() => !isLoading && loggingInKey === null && handleSelectHistory(item)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-all group text-left cursor-pointer ${loggingInKey !== null ? 'opacity-60 pointer-events-none' : ''}`}
                      >
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                          {(item.description || item.accessKey).charAt(0).toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          {item.description ? (
                            <>
                              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">{item.description}</p>
                              <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 truncate mt-0.5">{displayLabel}</p>
                            </>
                          ) : (
                            <p className="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate">{displayLabel}</p>
                          )}
                        </div>

                        {/* Right side */}
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-emerald-500 shrink-0" />
                        ) : (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => handleDeleteHistory(e, item.accessKey)}
                              className="p-1.5 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 group-hover:text-emerald-500 transition-colors" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add new account */}
              {!loadingHistory && (
                <button
                  onClick={() => setViewMode("form")}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500 hover:border-emerald-400 dark:hover:border-emerald-600 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  添加新账号
                </button>
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
                  className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/50"
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
                    className="pr-10 transition-all duration-200 focus:ring-2 focus:ring-emerald-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSk(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    tabIndex={-1}
                  >
                    {showSk ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">描述（可选）</Label>
                <Input
                  id="description"
                  placeholder="如：公司账号、个人账号"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
              <div className="space-y-2">
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
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoLogin"
                    checked={autoLogin}
                    onCheckedChange={(checked) => {
                      const value = checked === true;
                      setAutoLogin(value);
                      localStorage.setItem('qiniu_auto_login', value.toString());
                    }}
                  />
                  <Label htmlFor="autoLogin" className="text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer">
                    下次自动登录
                  </Label>
                </div>
              </div>
              <Button
                type="submit"
                disabled={isLoggingIn || !ak || !sk}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-md hover:shadow-lg py-2.5 text-base cursor-pointer disabled:opacity-60"
              >
                {isLoggingIn ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />验证中...</>
                ) : (
                  <><LogIn className="w-4 h-4 mr-2" />登录并验证</>
                )}
              </Button>

              {/* Import from Kodo */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={handleImportFromKodo}
                  disabled={isImporting}
                  className="text-sm text-zinc-500 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isImporting ? "导入中..." : "从 Kodo Browser 导入凭证"}
                </button>
              </div>

              {/* Back to list */}
              {historyItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setViewMode("list"); setAk(""); setSk(""); setDescription(""); }}
                  className="w-full text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors text-center pt-1"
                >
                  ← 返回账号列表
                </button>
              )}
            </form>
          )}
        </CardContent>

        <CardFooter className="text-[11px] text-center text-zinc-400 justify-center pt-3 pb-4">
          您的凭证将安全地存储在本地设备中
        </CardFooter>
      </Card>

      {/* Kodo import dialog */}
      {showKodoDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-6">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-4">从 Kodo Browser 导入</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {kodoItems.map((item, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectKodoItem(item)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">
                        {item.description || item.accessKey.substring(0, 16) + '...'}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">
                        {item.accessKey.substring(0, 16)}...
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
                  </button>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button
                  onClick={() => setShowKodoDialog(false)}
                  className="w-full text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
