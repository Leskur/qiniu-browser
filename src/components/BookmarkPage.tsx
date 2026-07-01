import { useState } from "react";
import { useAppStore } from "../store";
import { Bookmark as BookmarkIcon, X } from "lucide-react";
import { toast } from "sonner";

export function BookmarkPage({
  ak,
  onNavigate,
}: {
  ak: string;
  onNavigate: (bucket: string, prefix: string) => void;
}) {
  const removeBookmark = useAppStore((s) => s.removeBookmark);
  const bookmarks = useAppStore((s) => s.bookmarks[ak]) ?? [];
  const [searchQuery, setSearchQuery] = useState("");

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
          在文件管理页面点击星标按钮，将常用的空间路径保存为书签，方便下次快速访问
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm shrink-0">
        <BookmarkIcon className="w-5 h-5 text-amber-500" />
        <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">书签</h2>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
          {bookmarks.length} 个
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索书签..."
            className="w-48 px-3 py-1.5 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-zinc-400">
            <p className="text-sm">没有匹配的书签</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((bm) => (
              <div
                key={bm.id}
                className="group relative flex items-center gap-3 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-md transition-all cursor-pointer"
                onClick={() => onNavigate(bm.bucket, bm.prefix)}
              >
                <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                  <BookmarkIcon className="w-4.5 h-4.5 text-amber-500" fill="currentColor" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                    {bm.label}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 truncate">
                    {bm.bucket}{bm.prefix ? "/" + bm.prefix.replace(/\/$/, "") : ""}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeBookmark(ak, bm.id);
                    toast.success("书签已删除");
                  }}
                  className="p-1.5 rounded text-zinc-300 dark:text-zinc-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"
                  title="删除书签"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
