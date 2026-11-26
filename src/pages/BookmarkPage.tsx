import { useState } from "react";
import { useAppStore } from "../store";
import { Bookmark as BookmarkIcon, Pencil, Search, Trash2, X } from "lucide-react";
import { toast } from "@/lib/toast";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tooltip } from "../components/ui/tooltip";
import { PageState } from "../components/PageState";
import { PageToolbar } from "../components/PageToolbar";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";

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

  const filtered = bookmarks.filter(
    (bm) =>
      bm.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bm.bucket.toLowerCase().includes(searchQuery.toLowerCase()) ||
      bm.prefix.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const saveEdit = () => {
    if (!editing) return;
    const label = editing.label.trim() || "未命名书签";
    updateBookmark(ak, editing.id, { label });
    toast.success("书签已更新");
    setEditing(null);
  };

  if (bookmarks.length === 0) {
    return (
      <PageState icon={BookmarkIcon} title="还没有书签" description="在文件管理页点击书签按钮，保存常用路径以便快速访问" />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageToolbar>
        <span className="text-xs tabular-nums text-zinc-400 dark:text-muted-foreground">
          {searchQuery ? `${filtered.length} / ${bookmarks.length} 个书签` : `${bookmarks.length} 个书签`}
        </span>
        <div className="flex-1" />
        <div className="relative w-56 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索书签..."
            aria-label="搜索书签"
            className="pl-8 pr-9"
          />
          {searchQuery && (
            <Button variant="ghost"
              size="icon-sm"
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-0.5 top-1/2 -translate-y-1/2 text-muted-foreground active:not-aria-[haspopup]:-translate-y-1/2"
              aria-label="清除搜索"
            >
              <X className="size-3" />
            </Button>
          )}
        </div>
      </PageToolbar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <PageState icon={Search} title="没有匹配的书签" />
        ) : (
          <div className="divide-y divide-border/40 dark:divide-border/80">
            {filtered.map((bm) => {
              const path = `${bm.bucket}${bm.prefix ? "/" + bm.prefix.replace(/\/$/, "") : ""}`;
              return (
                <div
                  key={bm.id}
                  className="group flex items-center gap-3 px-6 transition-colors hover:bg-zinc-50 dark:hover:bg-accent/50"
                >
                  <button type="button"
                    onClick={() => onNavigate(bm.bucket, bm.prefix)}
                    className="flex min-w-0 flex-1 cursor-default items-center gap-3 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                    <BookmarkIcon className="size-4 shrink-0 text-zinc-400 dark:text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-800 transition-colors dark:text-foreground">
                        {bm.label}
                      </span>
                      <Tooltip content={path}>
                        <span className="mt-0.5 block truncate font-mono text-xs text-zinc-400 dark:text-muted-foreground">
                          {path}
                        </span>
                      </Tooltip>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="编辑书签"
                      aria-label={`编辑书签 ${bm.label}`}
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      onClick={() => {
                        setEditing({ id: bm.id, label: bm.label });
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="删除书签"
                      aria-label={`删除书签 ${bm.label}`}
                      className="text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      onClick={() => {
                        removeBookmark(ak, bm.id);
                        toast.success("书签已删除");
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑书签</DialogTitle>
            <DialogDescription>修改书签显示名称，路径不会改变。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bookmark-label">名称</Label>
            <Input
              id="bookmark-label"
              autoFocus
              value={editing?.label ?? ""}
              onChange={(e) => editing && setEditing({ ...editing, label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
              }}
              placeholder="书签名称"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={saveEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
