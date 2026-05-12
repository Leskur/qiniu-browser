import { useState } from "react";
import { toast } from "sonner";
import { cdnRefresh, cdnPrefetch } from "../lib/cdn";
import { RefreshCw, Zap } from "lucide-react";

export function CdnManager({ ak, sk }: { ak: string; sk: string }) {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<"refresh" | "prefetch">("refresh");

  const handleSubmit = async () => {
    const list = urls.split("\n").map(u => u.trim()).filter(Boolean);
    if (list.length === 0) return toast.warning("请输入URL");

    setLoading(true);
    try {
      if (subTab === "refresh") {
        const dirs = list.filter(u => u.endsWith("/"));
        const files = list.filter(u => !u.endsWith("/"));
        const res = await cdnRefresh(ak, sk, files, dirs);
        toast.success(`刷新任务提交成功! 剩余配额: ${res.urlSurplusDay}`);
      } else {
        const res = await cdnPrefetch(ak, sk, list);
        toast.success(`预取任务提交成功! 剩余配额: ${res.surplusDay}`);
      }
      setUrls("");
    } catch (err: any) {
      toast.error(err.message || "操作失败");
    } finally {
      setLoading(false);
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
        <div className="max-w-2xl space-y-6">
          <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg w-fit">
            <button
              onClick={() => setSubTab("refresh")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${subTab === "refresh" ? "bg-white dark:bg-zinc-700 shadow-sm text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              缓存刷新
            </button>
            <button
              onClick={() => setSubTab("prefetch")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${subTab === "prefetch" ? "bg-white dark:bg-zinc-700 shadow-sm text-emerald-600 dark:text-emerald-400" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
            >
              资源预取
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                输入 {subTab === "refresh" ? "URL或目录" : "URL"}
              </label>
              <span className="text-xs text-zinc-400">每行一个，带协议头 (http/https)</span>
            </div>
            <textarea
              value={urls}
              onChange={e => setUrls(e.target.value)}
              placeholder={`http://example.com/image.jpg\n${subTab === "refresh" ? "http://example.com/assets/" : ""}`}
              className="w-full h-48 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 text-sm font-mono text-zinc-800 dark:text-zinc-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !urls.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {subTab === "refresh" ? "提交刷新" : "提交预取"}
          </button>
        </div>
      </div>
    </div>
  );
}
