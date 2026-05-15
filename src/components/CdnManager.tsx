import { useState, useEffect } from "react";
import { toast } from "sonner";
import { 
  cdnRefresh, 
  cdnPrefetch, 
  cdnQueryRefreshTasks, 
  cdnQueryPrefetchTasks,
  RefreshTask,
  PrefetchTask 
} from "../lib/cdn";
import { RefreshCw, History, Loader2 } from "lucide-react";

export function CdnManager({ 
  ak, 
  sk,
  prefillDomain,
  onPrefillUsed
}: { 
  ak: string; 
  sk: string;
  prefillDomain?: string;
  onPrefillUsed?: () => void;
}) {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<"refresh" | "prefetch" | "history">("refresh");
  const [tasks, setTasks] = useState<(RefreshTask | PrefetchTask)[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [taskType, setTaskType] = useState<"refresh" | "prefetch">("refresh");
  const [urlError, setUrlError] = useState("");

  // 处理预填域名
  useEffect(() => {
    if (prefillDomain) {
      setUrls(`https://${prefillDomain}/`);
      onPrefillUsed?.();
      toast.info(`已自动填充域名：${prefillDomain}`);
    }
  }, [prefillDomain, onPrefillUsed]);

  const validateUrls = (list: string[]): { valid: string[]; invalid: string[] } => {
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const u of list) {
      try {
        const parsed = new URL(u);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          valid.push(u);
        } else {
          invalid.push(u);
        }
      } catch {
        invalid.push(u);
      }
    }
    return { valid, invalid };
  };

  const handleSubmit = async () => {
    const list = urls.split("\n").map(u => u.trim()).filter(Boolean);
    if (list.length === 0) return toast.warning("请输入URL");

    const { valid, invalid } = validateUrls(list);
    if (invalid.length > 0) {
      setUrlError("存在无效的 URL");
      return;
    }
    setUrlError("");

    setLoading(true);
    try {
      if (subTab === "refresh") {
        const dirs = valid.filter(u => u.endsWith("/"));
        const files = valid.filter(u => !u.endsWith("/"));
        const res = await cdnRefresh(ak, sk, files, dirs);
        setLastRequestId(res.requestId);
        setTaskType("refresh");
        const serverInvalid = [...(res.invalidUrls || []), ...(res.invalidDirs || [])];
        if (serverInvalid.length > 0) toast.warning(`${serverInvalid.length} 个地址被服务器拒绝`, { description: serverInvalid.join("\n") });
        const validCount = list.length - serverInvalid.length;
        if (validCount > 0) {
          toast.success(`刷新任务提交成功! 剩余配额: ${res.urlSurplusDay}`, {
            description: `RequestID: ${res.requestId}`,
            action: {
              label: '查看任务',
              onClick: () => {
                setSubTab("history");
                loadTasks(res.requestId, "refresh");
              }
            }
          });
        }
      } else {
        const res = await cdnPrefetch(ak, sk, valid);
        setLastRequestId(res.requestId);
        setTaskType("prefetch");
        const invalidUrls = res.invalidUrls || [];
        if (invalidUrls.length > 0) toast.warning(`${invalidUrls.length} 个地址被服务器拒绝`, { description: invalidUrls.join("\n") });
        const validCount = list.length - invalidUrls.length;
        if (validCount > 0) {
          toast.success(`预取任务提交成功! 剩余配额: ${res.surplusDay}`, {
            description: `RequestID: ${res.requestId}`,
            action: {
              label: '查看任务',
              onClick: () => {
                setSubTab("history");
                loadTasks(res.requestId, "prefetch");
              }
            }
          });
        }
      }
      setUrls("");
    } catch (err: any) {
      toast.error(err.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async (requestId?: string, type?: "refresh" | "prefetch") => {
    const currentType = type || taskType;
    setLoadingTasks(true);
    try {
      if (currentType === "refresh") {
        const res = await cdnQueryRefreshTasks(ak, sk, requestId);
        setTasks(res.items || []);
      } else {
        const res = await cdnQueryPrefetchTasks(ak, sk, requestId);
        setTasks(res.items || []);
      }
    } catch (err: any) {
      toast.error("加载任务失败", { description: err.message });
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    if (subTab === "history") {
      loadTasks(lastRequestId || undefined);
    }
  }, [subTab]);

  const getStateBadge = (state: string) => {
    switch (state) {
      case "success":
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">成功</span>;
      case "failure":
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">失败</span>;
      case "processing":
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">处理中</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{state}</span>;
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm z-20 relative">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">刷新预取</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Tabs */}
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg w-fit">
            <button
              onClick={() => setSubTab("refresh")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${subTab === "refresh" ? "bg-white dark:bg-zinc-700 shadow-sm text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              缓存刷新
            </button>
            <button
              onClick={() => setSubTab("prefetch")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${subTab === "prefetch" ? "bg-white dark:bg-zinc-700 shadow-sm text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              资源预取
            </button>
            <button
              onClick={() => setSubTab("history")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${subTab === "history" ? "bg-white dark:bg-zinc-700 shadow-sm text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              任务历史
            </button>
          </div>

          {subTab === "history" ? (
            /* Task History */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  {taskType === "refresh" ? "刷新" : "预取"}任务记录
                </h3>
                <div className="flex items-center gap-2">
                  <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg">
                    <button
                      onClick={() => { setTaskType("refresh"); loadTasks(undefined, "refresh"); }}
                      className={`px-3 py-1 text-xs font-medium rounded transition-all cursor-pointer ${taskType === "refresh" ? "bg-white dark:bg-zinc-700 shadow-sm text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}`}
                    >
                      刷新
                    </button>
                    <button
                      onClick={() => { setTaskType("prefetch"); loadTasks(undefined, "prefetch"); }}
                      className={`px-3 py-1 text-xs font-medium rounded transition-all cursor-pointer ${taskType === "prefetch" ? "bg-white dark:bg-zinc-700 shadow-sm text-emerald-600 dark:text-emerald-400" : "text-zinc-500"}`}
                    >
                      预取
                    </button>
                  </div>
                  <button
                    onClick={() => loadTasks()}
                    disabled={loadingTasks}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingTasks ? 'animate-spin' : ''}`} />
                    刷新
                  </button>
                </div>
              </div>

              {loadingTasks ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                </div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <History className="w-16 h-16 text-zinc-300 dark:text-zinc-700 mb-4" />
                  <p className="text-zinc-500 dark:text-zinc-400">暂无任务记录</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-24">状态</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">URL</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-40">创建时间</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-40">完成时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {tasks.map((task) => (
                        <tr key={task.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                          <td className="px-4 py-3 w-24">
                            {getStateBadge(task.state)}
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs font-mono text-zinc-600 dark:text-zinc-400 break-all">
                              {task.url}
                            </code>
                          </td>
                          <td className="px-4 py-3 w-40">
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {new Date(task.createAt).toLocaleString()}
                            </span>
                          </td>
                          <td className="px-4 py-3 w-40">
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {task.finishAt ? new Date(task.finishAt).toLocaleString() : '-'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* Submit Form */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  输入 {subTab === "refresh" ? "URL或目录" : "URL"}
                </label>
                <span className="text-xs text-zinc-400">每行一个，带协议头 (http/https)</span>
              </div>
              <textarea
                value={urls}
                onChange={e => { setUrls(e.target.value); setUrlError(""); }}
                placeholder={`http://example.com/image.jpg\n${subTab === "refresh" ? "http://example.com/assets/" : ""}`}
                className="w-full h-48 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 text-sm font-mono text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none resize-none"
              />

              {urlError && (
                <p className="text-xs text-red-500 dark:text-red-400">{urlError}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading || !urls.trim()}
                className="flex bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors items-center gap-2 shadow-sm cursor-pointer disabled:cursor-not-allowed"
              >
                {subTab === "refresh" ? "刷新" : "预取"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
