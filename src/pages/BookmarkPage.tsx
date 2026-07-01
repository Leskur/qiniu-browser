import { useState } from "react";
import { useAppStore } from "../store";
import { Bookmark as BookmarkIcon, X, Pencil, LayoutGrid, List } from "lucide-react";
import { toast } from "sonner";

type EditingState = { id: string; label: string } | null;

export function BookmarkPage({
  ak,
  onNavigate,
}: {
  ak: string;
  onNavigate: (bucket: string, prefix: string) => void;
}) {
  const removeBookmark = useAppStore((s) => s.removeBookmark);
  const updateBookmark = useAppStore((s) => s.updateBookmark);
  const bookmarks = useAppStore((s) => s.bookmarks[ak]) ?? [];
  const [searchQuery, setSearchQuery] = useState("");
  const [editing, setEditing] = useState<EditingState>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filtered = bookmarks.filter(
    (bm) =>
      bm.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bm.bucket.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bm.prefix.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (bookmarks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-4">
          <BookmarkIcon className="w-8 h-8 text-amber-400" />
        </div>
        <p className="text-lg font-semibold text-zinc-600 dark:text-zinc-300">还没有书签</p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2 max-w-xs">
          在文件管理页面点击书签按钮，将常用的空间路径保存为书签，方便下次快速访问
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm shrink-0">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">书签管理</span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums bg-zinc-50 dark:bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-200/50 dark:border-zinc-700/50">
          {bookmarks.length} 个
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === "grid" ? "bg-white dark:bg-zinc-700 text-amber-500 shadow-sm" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`}
              title="宫格视图"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === "list" ? "bg-white dark:bg-zinc-700 text-amber-500 shadow-sm" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"}`}
              title="列表视图"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索书签..."
              className="w-48 pl-8 pr-3 py-1.5 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
            />
            <svg className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-zinc-400">
            <p className="text-sm">没有匹配的书签</p>
          </div>
        ) : (
          <div className={viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" : "flex flex-col gap-2"}>
            {filtered.map((bm) => (
              <div
                key={bm.id}
                className={`group relative flex items-center gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-md transition-all cursor-pointer ${viewMode === "grid" ? "p-4" : "p-3"}`}
                onClick={() => onNavigate(bm.bucket, bm.prefix)}
              >
                <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                  <BookmarkIcon className="w-4.5 h-4.5 text-amber-500" fill="currentColor" />
                </div>
                <div className="min-w-0 flex-1 pr-16">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                    {bm.label}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 truncate">
                    {bm.bucket}{bm.prefix ? "/" + bm.prefix.replace(/\/$/, "") : ""}
                  </p>
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing({ id: bm.id, label: bm.label });
                    }}
                    className="p-1.5 rounded text-zinc-300 dark:text-zinc-600 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors cursor-pointer"
                    title="编辑书签"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBookmark(ak, bm.id);
                      toast.success("书签已删除");
                    }}
                    className="p-1.5 rounded text-zinc-300 dark:text-zinc-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
                    title="删除书签"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Edit Dialog ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6 mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Pencil className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">编辑书签</h3>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">名称</label>
                <input
                  autoFocus
                  type="text"
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const label = editing.label.trim() || "未命名书签";
                      updateBookmark(ak, editing.id, { label });
                      toast.success("书签已更新");
                      setEditing(null);
                    }
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  placeholder="书签名称"
                  className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const label = editing.label.trim() || "未命名书签";
                  updateBookmark(ak, editing.id, { label });
                  toast.success("书签已更新");
                  setEditing(null);
                }}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
