import { useDirectoryListing } from './file-manager/useDirectoryListing';
import { useBucketDomains } from './file-manager/useBucketDomains';
import { useFileUploads } from './file-manager/useFileUploads';
import { useFileDownloads } from './file-manager/useFileDownloads';
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { QiniuFile, deleteFile, deleteDirectory, generateDownloadUrl, batchDeleteFiles, formatBatchDeleteResult, renameFile, createFolder } from "../lib/qiniu";
import {
  File, Image, Film, FileText, Archive,
  Link2, Copy, Check, RefreshCw, Trash2, Upload, FolderOpen,
  Folder, ChevronRight, Database, Download, X, ArrowUpDown, ArrowUp, ArrowDown, Pencil, ArrowLeft, ArrowRight,
  Search, FolderPlus, ZoomIn, ChevronLeft, Maximize2, Bookmark, Loader2, ChevronDown
} from "lucide-react";
import { toast } from "@/lib/toast";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { formatBytes, formatQiniuTime } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Tooltip } from "../components/ui/tooltip";
import { PageState } from "../components/PageState";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import { Table, TableHead, TableHeader, TableRow, TableSortButton } from "../components/ui/table";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";

export function getFileIcon(mimeType: string) {
  if (mimeType?.startsWith('image/')) return <Image className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (mimeType?.startsWith('video/')) return <Film className="w-4 h-4 text-purple-500 shrink-0" />;
  if (mimeType?.startsWith('text/')) return <FileText className="w-4 h-4 text-blue-400 shrink-0" />;
  if (mimeType?.includes('zip') || mimeType?.includes('tar') || mimeType?.includes('rar')) return <Archive className="w-4 h-4 text-amber-500 shrink-0" />;
  return <File className="w-4 h-4 text-zinc-400 shrink-0" />;
}

// ─── Highlight matching text ──────────────────────────────────────────────────
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200 dark:bg-amber-700/60 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

type VirtualEntry =
  | { type: 'folder'; name: string; prefix: string }
  | { type: 'file'; name: string; file: QiniuFile };

export function FileManager({ ak, sk, bucket, isActive, onBack, refreshTrigger, initialPrefix, onInitialPrefixUsed }: {
  ak: string; sk: string; bucket: string; onBack: () => void; refreshTrigger?: number;
  isActive: boolean;
  initialPrefix?: string; onInitialPrefixUsed?: () => void;
}) {
  const domains = useBucketDomains(ak, sk, bucket);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Bucket stats from global store
  const { buckets } = useAppStore();
  const bucketInfo = buckets.find(b => b.tbl === bucket);
  // 桶信息未就绪时默认按私有签名，避免裸链 401
  const isPrivateBucket = bucketInfo ? bucketInfo.private === 1 : true;
  
  // Upload menu visibility
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  // ── Virtual folder navigation + history ──
  const [currentPrefix, setCurrentPrefix] = useState(initialPrefix || "");
  const [navHistory, setNavHistory] = useState<string[]>(() => initialPrefix ? ["", initialPrefix] : [""]);
  const [navIndex, setNavIndex] = useState(initialPrefix ? 1 : 0);

  const canGoBack    = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;
  const canGoUp      = currentPrefix !== "";

  const navigate = (prefix: string) => {
    setCurrentPrefix(prefix);
    setNavHistory(prev => {
      const trimmed = prev.slice(0, navIndex + 1);
      return [...trimmed, prefix];
    });
    setNavIndex(i => i + 1);
  };

  const goBack = useCallback(() => {
    setSelectedFileKey(null);
    if (!canGoBack) {
      onBack();
      return;
    }
    const target = navHistory[navIndex - 1];
    setNavIndex(i => i - 1);
    setCurrentPrefix(target);
  }, [canGoBack, navHistory, navIndex, onBack]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    const target = navHistory[navIndex + 1];
    setNavIndex(i => i + 1);
    setCurrentPrefix(target);
  }, [canGoForward, navHistory, navIndex]);

  const goUp = useCallback(() => {
    if (!canGoUp) return;
    const parts = currentPrefix.replace(/\/$/, "").split("/").filter(Boolean);
    parts.pop();
    const parent = parts.length ? `${parts.join("/")}/` : "";
    setCurrentPrefix(parent);
    setNavHistory(prev => [...prev.slice(0, navIndex + 1), parent]);
    setNavIndex(i => i + 1);
  }, [canGoUp, currentPrefix, navIndex]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); goBack(); }
      if (e.button === 4) { e.preventDefault(); goForward(); }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [goBack, goForward]);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const someSelected = selectedKeys.size > 0;
  const resetSelection = useCallback(() => setSelectedKeys(new Set()), []);
  const {
    items, folders, hasMore, loadingMore, loading, error,
    searchInput, setSearchInput, committedSearch, currentPrefixRef,
    loadDirectory, loadMore, clearSearch, runPrefixSearch, refreshCurrentView,
    invalidateDirectory, clearDirectoryCache, removeListedFile,
  } = useDirectoryListing({ ak, sk, bucket, currentPrefix, onSelectionReset: resetSelection });
  const {
    isUploading, uploadChoice, overwriteUpload, setOverwriteUpload,
    finishUploadChoice, handleUploadPaths, handleUpload,
  } = useFileUploads({
    ak, sk, bucket, currentPrefix, mounted,
    onUploaded: (prefix) => {
      invalidateDirectory(prefix);
      if (mounted.current && prefix === currentPrefixRef.current) void loadDirectory(prefix, true);
    },
  });
  const { downloadPrompt, finishDownloadPrompt, handleDownload, handleBatchDownload, handleDownloadFolder } = useFileDownloads({
    ak, sk, bucket, domains, isPrivateBucket, mounted, selectedKeys, onSelectionReset: resetSelection,
  });

  // Refresh throttle to prevent excessive API calls
  const [lastRefreshTime, setLastRefreshTime] = useState(0);
  const REFRESH_COOLDOWN = 2000; // 2 seconds

  // Detail belongs to the active file list, never to a stale file snapshot.
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const selectedFile = isActive && !loading && !error && selectedFileKey !== null
    ? items.find(file => file.key === selectedFileKey) ?? null
    : null;

  useEffect(() => {
    if (selectedFileKey !== null && !selectedFile) setSelectedFileKey(null);
  }, [selectedFileKey, selectedFile]);

  // ── Image preview state ──
  const [previewFile, setPreviewFile] = useState<QiniuFile | null>(null);

  // 所有图片文件列表（用于前后导航）
  const imageFiles = useMemo(() =>
    items.filter(f => f.mimeType?.startsWith('image/')),
    [items]
  );

  const openPreview = (file: QiniuFile) => {
    if (!file.mimeType?.startsWith('image/')) return;
    setPreviewFile(file);
  };

  const closePreview = () => setPreviewFile(null);

  const previewPrev = useCallback(() => {
    if (!previewFile) return;
    const idx = imageFiles.findIndex(f => f.key === previewFile.key);
    if (idx > 0) setPreviewFile(imageFiles[idx - 1]);
  }, [previewFile, imageFiles]);

  const previewNext = useCallback(() => {
    if (!previewFile) return;
    const idx = imageFiles.findIndex(f => f.key === previewFile.key);
    if (idx >= 0 && idx < imageFiles.length - 1) setPreviewFile(imageFiles[idx + 1]);
  }, [previewFile, imageFiles]);

  // ── Context menu ──
  const [ctxMenu, setCtxMenu] = useState<{ file: QiniuFile; x: number; y: number } | null>(null);

  const openCtxMenu = (e: React.MouseEvent, file: QiniuFile) => {
    e.preventDefault();
    e.stopPropagation();
    const menuW = 176, menuH = 240;
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX;
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;
    setCtxMenu({ file, x, y });
  };

  const closeCtxMenu = () => setCtxMenu(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── Delete state ──
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [dirToDelete, setDirToDelete] = useState<string | null>(null);
  const [batchDeletePending, setBatchDeletePending] = useState(false);
  const [isDeleting, setIsDeleting]     = useState(false);
  // ── Drag-drop feedback ──
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Create folder state ──
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  
  // ── Breadcrumb overflow menu ──
  const [breadcrumbMenuOpen, setBreadcrumbMenuOpen] = useState(false);

  // ── Scroll container ref ──
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Keyboard scroll shortcuts (PgUp/PgDn/Home/End) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || previewFile) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const el = scrollContainerRef.current;
      if (!el) return;
      switch (e.key) {
        case 'PageDown': e.preventDefault(); el.scrollBy({ top: el.clientHeight * 0.9, behavior: 'smooth' }); break;
        case 'PageUp':   e.preventDefault(); el.scrollBy({ top: -el.clientHeight * 0.9, behavior: 'smooth' }); break;
        case 'Home':     e.preventDefault(); el.scrollTo({ top: 0, behavior: 'smooth' }); break;
        case 'End':      e.preventDefault(); el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); break;
        case 'f':
        case 'F':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            searchInputRef.current?.focus();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewFile]);

  // ── Sort state ──
  type SortField = 'name' | 'size' | 'time';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const cycleSort = (field: SortField) => {
    if (sortField !== field) { setSortField(field); setSortDir('asc'); }
    else setSortDir(d => d === 'asc' ? 'desc' : 'asc');
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 inline-block size-3 shrink-0 text-zinc-300 dark:text-zinc-700" />;
    return sortDir === "asc"
      ? <ArrowUp className="ml-1 inline-block size-3 shrink-0 text-emerald-500" />
      : <ArrowDown className="ml-1 inline-block size-3 shrink-0 text-emerald-500" />;
  };

  // ── Rename state ──
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const startRename = (e: React.MouseEvent, file: QiniuFile) => {
    e.stopPropagation();
    const filename = file.key.split('/').pop() || file.key;
    setRenamingKey(file.key);
    setRenameValue(filename);
    setSelectedFileKey(null);
  };

  const commitRename = async (oldKey: string) => {
    const filename = renameValue.trim();
    if (!filename || filename === (oldKey.split('/').pop() || oldKey)) {
      setRenamingKey(null); return;
    }
    const dir = oldKey.includes('/') ? oldKey.slice(0, oldKey.lastIndexOf('/') + 1) : '';
    const newKey = dir + filename;
    try {
      await renameFile(ak, sk, bucket, oldKey, newKey);
      toast.success('重命名成功');
      loadDirectory(currentPrefix, true);
    } catch (err: any) {
      toast.error('重命名失败', { description: err.message });
    } finally {
      setRenamingKey(null);
    }
  };

  const toggleSelect = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── Drag-drop upload ──
  useEffect(() => {
    const unlisten = listen<{ paths: string[]; position: { x: number; y: number } }>(
      'tauri://drag-drop',
      (event) => {
        setIsDragOver(false);
        void handleUploadPaths(event.payload.paths);
      }
    );
    const unlistenHover = listen('tauri://drag-over', () => setIsDragOver(true));
    const unlistenLeave = listen('tauri://drag-leave', () => setIsDragOver(false));
    return () => {
      unlisten.then(f => f());
      unlistenHover.then(f => f());
      unlistenLeave.then(f => f());
    };
  }, [ak, sk, bucket, currentPrefix]);

  // ── Escape closes the current interaction ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || previewFile) return;
      if (ctxMenu) { closeCtxMenu(); return; }
      if (selectedFile) {
        e.preventDefault();
        const focusedElement = document.activeElement;
        if (focusedElement instanceof HTMLElement && focusedElement.hasAttribute('data-file-detail-trigger')) {
          focusedElement.blur();
        }
        setSelectedFileKey(null);
        return;
      }
      if (searchInput || committedSearch) { clearSearch(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ctxMenu, selectedFile, searchInput, committedSearch, previewFile, clearSearch]);

  // ─── Derived entries for current level ───────────────────────────────────
  // folders come directly from API commonPrefixes, files from items
  const entries = useMemo((): VirtualEntry[] => {
    const folderEntries: VirtualEntry[] = folders.map(pfx => ({
      type: 'folder',
      name: pfx.slice(currentPrefix.length).replace(/\/$/, ''),
      prefix: pfx,
    }));
    const fileEntries: VirtualEntry[] = items.map(file => ({
      type: 'file',
      name: file.key.slice(currentPrefix.length),
      file,
    }));
    return [...folderEntries, ...fileEntries];
  }, [folders, items, currentPrefix]);
  const allFileKeys = useMemo(
    () => entries.filter(e => e.type === 'file').map(e => (e as { type: 'file'; name: string; file: QiniuFile }).file.key),
    [entries]
  );
  const allSelected = allFileKeys.length > 0 && allFileKeys.every(k => selectedKeys.has(k));

  const sortedEntries = useMemo(() => {
    const folderEntries = entries.filter(e => e.type === 'folder');
    const files = entries.filter(e => e.type === 'file') as { type: 'file'; name: string; file: QiniuFile }[];

    const sorted = [...files].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'size') cmp = a.file.fsize - b.file.fsize;
      else if (sortField === 'time') cmp = a.file.putTime - b.file.putTime;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return [...folderEntries, ...sorted];
  }, [entries, sortField, sortDir]);

  // ── Auto load more on scroll to bottom ──
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = () => {
      if (!hasMore || loadingMore) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        loadMore();
      }
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [hasMore, loadingMore, loadMore]);

  // ── F5 刷新触发 ──
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      refreshCurrentView(true);
      toast.success('已刷新文件列表');
    }
  }, [refreshTrigger]);

  // ── 书签：从外部跳转到指定 prefix ──
  const addBookmark = useAppStore((s) => s.addBookmark);
  const removeBookmark = useAppStore((s) => s.removeBookmark);
  const updateBookmark = useAppStore((s) => s.updateBookmark);
  const bookmarkList = useAppStore((s) => s.bookmarks[ak]) ?? [];
  const [showBookmarkDialog, setShowBookmarkDialog] = useState(false);
  const [bookmarkLabel, setBookmarkLabel] = useState("");
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);

  useEffect(() => {
    if (initialPrefix !== undefined && initialPrefix !== "") {
      if (initialPrefix !== currentPrefixRef.current) navigate(initialPrefix);
      onInitialPrefixUsed?.();
    }
  }, [initialPrefix]);

  const defaultBookmarkLabel = () => {
    const parts = currentPrefix.replace(/\/$/, "").split("/").filter(Boolean);
    return parts[parts.length - 1] || bucket;
  };

  const currentBookmark = useMemo(
    () => bookmarkList.find(b => b.bucket === bucket && b.prefix === currentPrefix),
    [bookmarkList, bucket, currentPrefix],
  );
  const isCurrentBookmarked = !!currentBookmark;
  const isEditingBookmark = !!editingBookmarkId;

  const closeBookmarkDialog = () => {
    setShowBookmarkDialog(false);
    setBookmarkLabel("");
    setEditingBookmarkId(null);
  };

  const handleBookmarkClick = () => {
    if (currentBookmark) {
      setEditingBookmarkId(currentBookmark.id);
      setBookmarkLabel(currentBookmark.label);
      setShowBookmarkDialog(true);
      return;
    }
    setEditingBookmarkId(null);
    setBookmarkLabel(defaultBookmarkLabel());
    setShowBookmarkDialog(true);
  };

  const handleBookmarkDone = () => {
    const label = bookmarkLabel.trim() || defaultBookmarkLabel();
    if (editingBookmarkId) {
      updateBookmark(ak, editingBookmarkId, { label });
    } else {
      addBookmark(ak, { bucket, prefix: currentPrefix, label });
      toast.success("书签已添加", { description: label });
    }
    closeBookmarkDialog();
  };

  const handleBookmarkCancel = () => {
    closeBookmarkDialog();
  };

  const handleBookmarkRemove = () => {
    if (editingBookmarkId) {
      removeBookmark(ak, editingBookmarkId);
      toast.success("书签已移除");
    }
    closeBookmarkDialog();
  };

  const rowVirtualizer = useVirtualizer({
    count: sortedEntries.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 44, // row height in px
    overscan: 10,
  });

  const toggleSelectAll = () => {    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(allFileKeys));
    }
  };

  const handleBatchDelete = async () => {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    setIsDeleting(true);
    const tid = toast.loading(`正在删除 ${keys.length} 个文件...`, { duration: Infinity });
    try {
      const result = await batchDeleteFiles(ak, sk, bucket, keys);
      const description = formatBatchDeleteResult(result);
      if (result.failed || result.unconfirmed) {
        toast.warning("批量删除未完全成功", { description: `${description}。 ${result.error}` });
      } else {
        toast.success("批量删除完成", { description });
      }
      setSelectedKeys(new Set());
      setBatchDeletePending(false);
      await refreshCurrentView(true);
    } catch (err: any) {
      toast.error('批量删除失败', { description: err.message });
    } finally {
      toast.dismiss(tid);
      setIsDeleting(false);
    }
  };

  const breadcrumbs = useMemo(() => {
    if (!currentPrefix) return [];
    return currentPrefix.split('/').filter(Boolean);
  }, [currentPrefix]);

  const navigateToFolder = (folderPrefix: string) => navigate(folderPrefix);

  const navigateToBreadcrumb = (index: number) => {
    if (index < 0) { navigate(""); return; }
    const parts = breadcrumbs.slice(0, index + 1);
    navigate(parts.join('/') + '/');
  };

  const handleCopyFileName = async (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const fileName = key.slice(key.lastIndexOf('/') + 1);
    try {
      await navigator.clipboard.writeText(fileName);
      toast.success('已复制文件名');
    } catch {
      toast.error('复制文件名失败，请重试');
    }
  };

  // ─── Copy link ───────────────────────────────────────────────────────────
  const handleCopyLink = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    if (domains.length === 0) {
      toast.warning("此存储空间未绑定外链域名", {
        description: "请先在「CDN → 域名」绑定域名后再试",
      });
      return;
    }
    // 私有空间复制签名临时链；公开空间复制裸链
    const url = generateDownloadUrl(ak, sk, domains[0], key, isPrivateBucket, 3600);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedKey(key);
      toast.success(
        isPrivateBucket ? "已复制临时访问链接" : "已复制到剪贴板",
        {
          ...(isPrivateBucket ? { description: "链接约 1 小时内有效" } : {}),
        },
      );
      setTimeout(() => setCopiedKey(null), 2000);
    }).catch(() => toast.error("复制失败"));
  };

  // ─── Create folder ───────────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;

    // 校验：不能包含非法字符
    if (name.includes('/')) {
      toast.error('文件夹名称不能包含 /');
      return;
    }

    // 获取 bucket 的 region
    const region = bucketInfo?.region || 'z0'; // 默认华东
    const folderKey = currentPrefix + name + '/';
    setIsCreatingFolder(true);
    try {
      await createFolder(ak, sk, bucket, region, folderKey);
      toast.success(`文件夹 "${name}" 创建成功`);
      setShowCreateFolder(false);
      setNewFolderName("");
      loadDirectory(currentPrefix, true);
    } catch (err: any) {
      toast.error('创建文件夹失败', { description: err.message });
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────────────
  const executeDeleteFile = async (key: string) => {
    setIsDeleting(true);
    try {
      await deleteFile(ak, sk, bucket, key);
      toast.success("文件已删除", { description: key });
      removeListedFile(key);
      setFileToDelete(null);
    } catch (err: any) {
      toast.error("删除失败", { description: err.message });
    } finally {
      setIsDeleting(false);
    }
  };

  const executeDeleteDirectory = async (prefix: string) => {
    setIsDeleting(true);
    const tid = toast.loading(`正在强制删除目录 ${prefix}...`);
    try {
      await deleteDirectory(ak, sk, bucket, prefix);
      toast.success("目录已彻底删除", { description: prefix });
    } catch (err: any) {
      toast.error("删除目录失败", { description: err.message });
    } finally {
      toast.dismiss(tid);
      setDirToDelete(null);
      clearDirectoryCache();
      if (mounted.current && currentPrefix === currentPrefixRef.current) void refreshCurrentView(true);
      setIsDeleting(false);
    }
  };

  const cancelDelete = () => {
    if (isDeleting) return;
    setFileToDelete(null);
    setDirToDelete(null);
    setBatchDeletePending(false);
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="@container/file-page relative flex h-full min-w-0 flex-col overflow-hidden bg-white dark:bg-background">
      <Dialog open={downloadPrompt !== null} onOpenChange={(open) => { if (!open) finishDownloadPrompt(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认下载文件夹</DialogTitle>
            <DialogDescription className="whitespace-pre-line">{downloadPrompt}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => finishDownloadPrompt(false)}>取消</Button>
            <Button onClick={() => finishDownloadPrompt(true)}>继续下载</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={uploadChoice !== null} onOpenChange={open => { if (!open) finishUploadChoice(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认上传</DialogTitle>
            <DialogDescription>{uploadChoice?.fileCount.toLocaleString()} 个文件 · {formatBytes(uploadChoice?.totalSize ?? 0)}</DialogDescription>
          </DialogHeader>
          {uploadChoice && (
            <dl className="grid gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">本地路径</dt>
                <Tooltip content={uploadChoice.sourcePath}><dd className="truncate">{uploadChoice.sourcePath}</dd></Tooltip>
                {uploadChoice.selectionCount > 1 && <dd className="text-xs text-muted-foreground">另有 {uploadChoice.selectionCount - 1} 项</dd>}
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">上传到</dt>
                <Tooltip content={uploadChoice.destination}><dd className="truncate">{uploadChoice.destination}</dd></Tooltip>
              </div>
            </dl>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label className="cursor-default text-sm font-medium" htmlFor="overwrite-upload">覆盖上传</Label>
              <p id="overwrite-upload-hint" className="text-xs text-muted-foreground">开启后替换云端同名文件，仅本次生效。</p>
            </div>
            <Switch
              id="overwrite-upload"
              aria-describedby="overwrite-upload-hint"
              checked={overwriteUpload}
              onCheckedChange={setOverwriteUpload}
            />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => finishUploadChoice(null)}>取消</Button><Button onClick={() => finishUploadChoice(overwriteUpload ? "overwrite" : "skip")}>开始上传</Button></DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ── Top Bar ── */}
      <div className="relative z-20 shrink-0 border-b border-zinc-200 dark:border-border">
        {/* ── Path row ── */}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-6 py-2">
          <Button variant="ghost"
            type="button"
            onClick={onBack}
            className="h-auto p-0 shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-zinc-200"
          >
            空间列表
          </Button>
          <ChevronRight className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
          <Button variant="ghost"
            type="button"
            onClick={() => navigateToBreadcrumb(-1)}
            className={`flex shrink-0 cursor-default items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors ${breadcrumbs.length === 0 ? "font-semibold text-zinc-900 dark:text-foreground" : "font-medium text-zinc-500 hover:text-zinc-800 dark:text-muted-foreground dark:hover:text-zinc-200"}`}
          >
            <Database className="size-3.5 shrink-0 text-emerald-500" />
            <span>{bucket}</span>
          </Button>
          {breadcrumbs.length > 0 && (() => {
            const SHOW_TAIL = 4;
            const collapsed = breadcrumbs.length > SHOW_TAIL + 1;
            const visibleHead = collapsed ? [] : breadcrumbs.slice(0, -1);
            const visibleTail = collapsed ? breadcrumbs.slice(-SHOW_TAIL) : [breadcrumbs[breadcrumbs.length - 1]];
            const hiddenMiddle = collapsed ? breadcrumbs.slice(0, -SHOW_TAIL) : [];
            return (
              <>
                {visibleHead.map((seg, i) => (
                  <span key={i} className="flex shrink-0 items-center">
                    <ChevronRight className="size-3.5 text-zinc-300 dark:text-zinc-600" />
                    <Button variant="ghost" type="button" onClick={() => navigateToBreadcrumb(i)}
                      className="h-auto p-0 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-muted-foreground dark:hover:text-zinc-200">
                      {seg}
                    </Button>
                  </span>
                ))}
                {collapsed && (
                  <span className="relative flex shrink-0 items-center">
                    <ChevronRight className="size-3.5 text-zinc-300 dark:text-zinc-600" />
                    <Popover open={breadcrumbMenuOpen} onOpenChange={setBreadcrumbMenuOpen}>
                      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" aria-label="显示上级目录" />}>…</PopoverTrigger>
                      <PopoverContent align="start" className="max-h-64 w-44 gap-0 overflow-y-auto p-1" aria-label="上级目录">
                          {hiddenMiddle.map((seg, i) => (
                            <Button variant="ghost" key={i} type="button"
                              onClick={() => { navigateToBreadcrumb(i); setBreadcrumbMenuOpen(false); }}
                              className="h-auto p-0 w-full truncate px-3 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-foreground dark:hover:bg-accent"
                            >{seg}</Button>
                          ))}
                      </PopoverContent>
                    </Popover>
                  </span>
                )}
                {visibleTail.map((seg, relIdx) => {
                  const i = collapsed ? breadcrumbs.length - SHOW_TAIL + relIdx : breadcrumbs.length - 1;
                  const isLast = relIdx === visibleTail.length - 1;
                  return (
                    <span key={i} className="flex min-w-0 shrink-0 items-center">
                      <ChevronRight className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
                      <Button variant="ghost"
                        type="button"
                        onClick={() => navigateToBreadcrumb(i)}
                        className={`max-w-[240px] truncate rounded-md px-2 py-1 text-sm transition-colors ${
                          isLast
                            ? "font-semibold text-zinc-900 dark:text-foreground"
                            : "font-medium text-zinc-500 hover:text-zinc-800 dark:text-muted-foreground dark:hover:text-zinc-200"
                        }`}
                        title={seg}
                      >{seg}</Button>
                    </span>
                  );
                })}
              </>
            );
          })()}
        </div>

        {/* ── Actions row ── */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-6">
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={goBack}
              title={canGoBack ? "后退（鼠标侧键）" : "返回空间列表"}
              aria-label={canGoBack ? "后退" : "返回空间列表"}
            >
              <ArrowLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goForward} disabled={!canGoForward} title="前进（鼠标侧键）" aria-label="前进">
              <ArrowRight />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goUp} disabled={!canGoUp} title="上一级" aria-label="上一级">
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={loading}
              title="刷新"
              aria-label="刷新"
              onClick={() => {
                const now = Date.now();
                if (now - lastRefreshTime < REFRESH_COOLDOWN) {
                  toast.info("刷新太频繁，请稍后再试");
                  return;
                }
                setLastRefreshTime(now);
                refreshCurrentView(true);
              }}
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={isCurrentBookmarked ? "修改书签" : "添加书签"}
              aria-label={isCurrentBookmarked ? "修改书签" : "添加书签"}
              className={isCurrentBookmarked ? "text-amber-500" : undefined}
              onClick={handleBookmarkClick}
            >
              <Bookmark fill={isCurrentBookmarked ? "currentColor" : "none"} />
            </Button>
          </div>

          <div className="flex-1" />

          {someSelected ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs tabular-nums text-zinc-400 dark:text-muted-foreground">
                已选 {selectedKeys.size} 项
              </span>
              <Button variant="outline" onClick={handleBatchDownload}>
                <Download />批量下载
              </Button>
              <Button variant="destructive" onClick={() => setBatchDeletePending(true)}>
                <Trash2 />批量删除
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setSelectedKeys(new Set())} title="取消选择" aria-label="取消选择">
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <div className="relative w-40 @3xl/file-page:w-52">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="按路径前缀查找，如 logo"
                  aria-label="按路径前缀查找"
                  title="在当前目录输入 logo，可匹配 logo.png 或 logo-assets/，区分大小写"
                  className={`pl-8 ${searchInput || committedSearch ? "pr-14" : "pr-2.5"}`}
                  onKeyDown={e => {
                    if (e.key === "Escape") { clearSearch(); (e.target as HTMLInputElement).blur(); }
                    if (e.key === "Enter") { e.preventDefault(); void runPrefixSearch(searchInput); }
                  }}
                />
                <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                  {committedSearch && (
                    <Tooltip content={`${sortedEntries.length} 个结果`}>
                      <span className="px-0.5 text-[11px] tabular-nums text-zinc-400 dark:text-muted-foreground">
                        {sortedEntries.length}
                      </span>
                    </Tooltip>
                  )}
                  {(searchInput || committedSearch) && (
                    <Button variant="ghost"
                      type="button"
                      onClick={() => clearSearch()}
                      className="h-auto p-0 rounded-xs p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-accent dark:hover:text-zinc-200"
                      aria-label="清除查找"
                    >
                      <X className="size-3" />
                    </Button>
                  )}
                </div>
              </div>
              <Popover open={uploadMenuOpen} onOpenChange={setUploadMenuOpen}>
                <PopoverTrigger
                  render={<Button disabled={isUploading || loading} />}
                  aria-label="上传"
                  title="上传"
                >
                  {isUploading ? <Loader2 className="animate-spin" /> : <Upload />}
                  上传
                  <ChevronDown className="size-3.5 opacity-70" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1">
                  <Button variant="ghost"
                    type="button"
                    className="h-auto p-0 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-accent dark:text-foreground"
                    onClick={() => { setUploadMenuOpen(false); handleUpload(false); }}
                  >
                    <Upload className="size-4 text-muted-foreground" />
                    上传文件
                  </Button>
                  <Button variant="ghost"
                    type="button"
                    className="h-auto p-0 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-accent dark:text-foreground"
                    onClick={() => { setUploadMenuOpen(false); handleUpload(true); }}
                  >
                    <FolderOpen className="size-4 text-muted-foreground" />
                    上传文件夹
                  </Button>
                </PopoverContent>
              </Popover>
              <Button variant="outline" onClick={() => { setShowCreateFolder(true); setNewFolderName(""); }} disabled={loading} title="新建文件夹" aria-label="新建文件夹">
                <FolderPlus />
                <span className="hidden @3xl/file-page:inline">新建文件夹</span>
              </Button>
            </div>
          )}
        </div>

      </div>

      {/* ── Content ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="@container/file-list relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-emerald-400 bg-emerald-50/90 dark:border-emerald-500 dark:bg-emerald-950/80">
            <Upload className="size-12 text-emerald-500" />
            <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">松开以上传到当前目录</p>
            <p className="text-sm text-emerald-600 opacity-70 dark:text-emerald-400">{currentPrefix || bucket}</p>
          </div>
        )}
        {loading ? (
          <PageState loading title="正在获取文件列表..." />
        ) : error ? (
          <PageState error title="加载失败" description={<span className="break-all">{error}</span>}>
            <Button variant="secondary" size="sm" onClick={() => refreshCurrentView(true)}>重试</Button>
          </PageState>
        ) : entries.length === 0 && !hasMore ? (
          <PageState icon={Folder}
            title={committedSearch ? "没有匹配此路径前缀的结果" : currentPrefix ? "该文件夹是空的" : "空间中没有文件"}
            description={committedSearch ? "输入 logo 可匹配当前目录下的 logo.png 或 logo-assets/。" : "上传文件后即可在此管理"} />
        ) : (
          <div ref={scrollContainerRef} className="h-full overflow-y-auto">
            <Table containerClassName="contents" className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-md dark:border-border dark:bg-card/90">
                <TableRow>
                  <TableHead className="h-10 w-10 whitespace-nowrap px-2 pl-4 text-left align-middle">
                    <Checkbox checked={allSelected} indeterminate={someSelected && !allSelected}
                      onCheckedChange={toggleSelectAll} aria-label="选择已加载的文件" title="选择已加载的文件" />
                  </TableHead>
                  <TableHead className="p-0" aria-sort={sortField === "name" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                    <TableSortButton className="pl-1" onClick={() => cycleSort("name")}>名称<SortIcon field="name" /></TableSortButton>
                  </TableHead>
                  <TableHead className="w-28 p-0" aria-sort={sortField === "size" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                    <TableSortButton onClick={() => cycleSort("size")}>大小<SortIcon field="size" /></TableSortButton>
                  </TableHead>
                  <TableHead className="hidden h-10 w-52 whitespace-nowrap px-2 text-left align-middle text-xs font-medium text-zinc-500 @3xl/file-list:table-cell dark:text-muted-foreground">类型</TableHead>
                  <TableHead className="hidden w-44 p-0 @4xl/file-list:table-cell" aria-sort={sortField === "time" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                    <TableSortButton onClick={() => cycleSort("time")}>修改时间<SortIcon field="time" /></TableSortButton>
                  </TableHead>
                  <TableHead className="h-10 w-36 whitespace-nowrap px-2 pr-5 text-right text-xs font-medium text-zinc-500 dark:text-muted-foreground" />
                </TableRow>
              </TableHeader>
            </Table>

            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const entry = sortedEntries[virtualRow.index];
                const rowStyle: React.CSSProperties = {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                };

                if (entry.type === "folder") {
                  return (
                    <div
                      key={`d:${entry.prefix}`}
                      style={rowStyle}
                      className={`group flex cursor-default items-center border-b border-zinc-100 text-sm transition-colors hover:bg-zinc-50 dark:border-border/80 dark:hover:bg-muted/60 ${dirToDelete === entry.prefix && isDeleting ? "pointer-events-none opacity-40" : ""}`}
                      onClick={() => navigateToFolder(entry.prefix)}
                    >
                      <div className="w-10 shrink-0 pl-4" />
                      <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
                        <Folder className="size-4 shrink-0 text-amber-400" />
                        <button type="button" disabled={dirToDelete === entry.prefix && isDeleting}
                          onClick={e => { e.stopPropagation(); navigateToFolder(entry.prefix); }}
                          className="w-full min-w-0 cursor-default truncate text-left font-medium text-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring dark:text-foreground">
                          <HighlightText text={entry.name} query={committedSearch} />
                        </button>
                      </div>
                      <div className="w-28 shrink-0 text-xs text-zinc-400">—</div>
                      <div className="hidden w-52 shrink-0 text-xs text-zinc-500 md:block dark:text-muted-foreground">文件夹</div>
                      <div className="hidden w-44 shrink-0 text-xs text-zinc-400 lg:block">—</div>
                      <div className="w-36 shrink-0 pr-5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <Button type="button" variant="ghost" size="icon-xs" title="下载整个文件夹" aria-label="下载整个文件夹" className="text-zinc-400" onClick={(e) => { e.stopPropagation(); handleDownloadFolder(entry.prefix); }}>
                            <Download />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-xs" title="删除整个目录" aria-label="删除整个目录" className="text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400" onClick={(e) => { e.stopPropagation(); setDirToDelete(entry.prefix); }}>
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }

                const { file } = entry;
                const isChecked = selectedKeys.has(file.key);
                const isRenaming = renamingKey === file.key;
                return (
                  <div
                    key={`f:${file.key}`}
                    style={rowStyle}
                    onClick={() => !someSelected && !isRenaming && setSelectedFileKey(file.key)}
                    onDoubleClick={() => !isRenaming && openPreview(file)}
                    onContextMenu={(e) => openCtxMenu(e, file)}
                    className={`group flex cursor-default items-center border-b border-zinc-100 text-sm transition-colors dark:border-border/80
                      ${isChecked || selectedFile?.key === file.key ? "bg-accent/70 hover:bg-accent" : "hover:bg-zinc-50 dark:hover:bg-muted/60"}
                      ${fileToDelete === file.key && isDeleting ? "pointer-events-none opacity-40" : ""}`}
                  >
                    <div className="w-10 shrink-0 pl-4" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
                      <Checkbox checked={isChecked} onCheckedChange={() => toggleSelect(file.key)}
                        aria-label={`选择 ${file.key}`} />
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
                      {getFileIcon(file.mimeType)}
                      {isRenaming ? (
                        <Input autoFocus value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(file.key)}
                          onKeyDown={e => { if (e.key === "Enter") commitRename(file.key); if (e.key === "Escape") setRenamingKey(null); }}
                          onClick={e => e.stopPropagation()}
                          className="file-name-input min-w-0 w-full flex-1 rounded-xs border border-input bg-white px-2 py-0.5 text-sm text-zinc-800 outline-none dark:bg-muted dark:text-foreground"
                        />
                      ) : (
                        <>
                          <Tooltip content={file.key}>
                            <button type="button" data-file-detail-trigger disabled={someSelected || (fileToDelete === file.key && isDeleting)}
                              onClick={e => { e.stopPropagation(); setSelectedFileKey(file.key); }}
                              className="min-w-0 cursor-default truncate text-left text-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring dark:text-foreground">
                              <HighlightText text={entry.name} query={committedSearch} />
                            </button>
                          </Tooltip>
                          <Button variant="ghost"
                            type="button"
                            onClick={(e) => { void handleCopyFileName(e, file.key); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            title="复制文件名"
                            aria-label={`复制文件名：${file.key.slice(file.key.lastIndexOf("/") + 1)}`}
                            className="h-auto p-0 shrink-0 rounded-xs p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-accent dark:hover:text-zinc-200"
                          >
                            <Copy className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="w-28 shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-muted-foreground">{formatBytes(file.fsize)}</div>
                    <div className="hidden w-52 shrink-0 truncate text-xs text-zinc-500 @3xl/file-list:block dark:text-muted-foreground">{file.mimeType || "—"}</div>
                    <div className="hidden w-44 shrink-0 font-mono text-xs tabular-nums text-zinc-500 @4xl/file-list:block dark:text-muted-foreground">{formatQiniuTime(file.putTime)}</div>
                    <div className="w-36 shrink-0 pr-5">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <Button type="button" variant="ghost" size="icon-xs" title="重命名" aria-label="重命名" className="text-zinc-400" onClick={(e) => startRename(e, file)}>
                          <Pencil />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-xs" title="下载文件" aria-label="下载文件" className="text-zinc-400" onClick={(e) => { e.stopPropagation(); handleDownload(file.key); }}>
                          <Download />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title={copiedKey === file.key ? "已复制" : "复制链接"}
                          aria-label="复制链接"
                          className={copiedKey === file.key ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}
                          onClick={(e) => handleCopyLink(e, file.key)}
                        >
                          {copiedKey === file.key ? <Check /> : <Link2 />}
                        </Button>
                        <Button type="button" variant="ghost" size="icon-xs" title="删除文件" aria-label="删除文件" className="text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400" onClick={(e) => { e.stopPropagation(); setFileToDelete(file.key); }}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load more indicator */}
            {hasMore && (
              <div className="flex justify-center py-4 text-xs text-zinc-400">
                {loadingMore
                  ? <span className="flex items-center gap-2"><div className="w-3.5 h-3.5 border-2 border-zinc-300/40 border-t-zinc-400 rounded-full animate-spin" />加载中...</span>
                  : <Button type="button" variant="ghost" size="sm" onClick={() => void loadMore()}>加载更多</Button>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Context Menu ── */}
      {ctxMenu && (
        <Popover open onOpenChange={(open) => { if (!open) closeCtxMenu(); }}>
          <PopoverContent
            anchor={{ getBoundingClientRect: () => new DOMRect(ctxMenu.x, ctxMenu.y, 0, 0) }}
            align="start"
            sideOffset={0}
            className="w-44 gap-0 p-1"
            aria-label="文件操作"
          >
            <Button variant="ghost"
              onClick={() => { setSelectedFileKey(ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-foreground hover:bg-zinc-100 dark:hover:bg-accent transition-colors"
            >
              <File className="w-4 h-4 text-zinc-400" />文件详情
            </Button>
            <Button variant="ghost"
              onClick={(e) => { startRename(e, ctxMenu.file); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-foreground hover:bg-zinc-100 dark:hover:bg-accent transition-colors"
            >
              <Pencil className="w-4 h-4 text-zinc-400" />重命名
            </Button>
            <Button variant="ghost"
              onClick={(e) => { void handleCopyFileName(e, ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-foreground hover:bg-zinc-100 dark:hover:bg-accent transition-colors"
            >
              <Copy className="w-4 h-4 text-zinc-400" />复制文件名
            </Button>
            <Button variant="ghost"
              onClick={(e) => { handleCopyLink(e, ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-foreground hover:bg-zinc-100 dark:hover:bg-accent transition-colors"
            >
              <Link2 className="w-4 h-4 text-zinc-400" />复制链接
            </Button>
            <Button variant="ghost"
              onClick={() => { handleDownload(ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-foreground hover:bg-zinc-100 dark:hover:bg-accent transition-colors"
            >
              <Download className="w-4 h-4 text-zinc-400" />下载
            </Button>
            <div className="my-1 border-t border-zinc-100 dark:border-border" />
            <Button variant="ghost"
              onClick={() => { setFileToDelete(ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />删除
            </Button>
          </PopoverContent>
        </Popover>
      )}

      {/* ── File Detail Pane ── */}
      {selectedFile && (
          <aside aria-label="文件详情" className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border bg-background text-foreground">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 dark:border-border shrink-0">
              <div className="shrink-0">{getFileIcon(selectedFile.mimeType)}</div>
              <Tooltip content={selectedFile.key}>
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {selectedFile.key.split('/').pop() || selectedFile.key}
                </h2>
              </Tooltip>
              <Button variant="ghost"
                onClick={() => setSelectedFileKey(null)}
                title="关闭文件详情"
                aria-label="关闭文件详情"
                className="h-auto p-0 p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-accent transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
              {selectedFile.mimeType?.startsWith('image/') && domains.length > 0 && (
                <div
                  className="rounded-xl overflow-hidden bg-zinc-100 dark:bg-muted flex items-center justify-center cursor-default relative group"
                  style={{ minHeight: 140 }}
                  onClick={() => openPreview(selectedFile)}
                >
                  <img
                    src={generateDownloadUrl(ak, sk, domains[0], selectedFile.key, isPrivateBucket)}
                    alt={selectedFile.key}
                    className="max-w-full max-h-56 object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                </div>
              )}
              <dl className="divide-y divide-border/60">
                {([
                  ["完整路径", selectedFile.key],
                  ["文件大小", formatBytes(selectedFile.fsize)],
                  ["MIME 类型", selectedFile.mimeType || "unknown"],
                  ["上传时间", formatQiniuTime(selectedFile.putTime)],
                  ["存储类型", (["标准存储", "低频存储", "归档存储", "深度归档"][selectedFile.type] ?? `类型 ${selectedFile.type}`)],
                  ["Hash (Etag)", selectedFile.hash],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-all font-mono text-xs text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Footer */}
            <div className="shrink-0 px-4 pb-4">
              <div className="divide-y divide-border overflow-hidden rounded-xl bg-muted/50">
                <Button variant="ghost"
                  onClick={(e) => { void handleCopyFileName(e, selectedFile.key); }}
                  className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5 text-foreground"
                >
                  <Copy className="w-4 h-4" />复制文件名
                </Button>
                <Button variant="ghost"
                  onClick={(e) => { handleCopyLink(e, selectedFile.key); }}
                  className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5 text-foreground"
                >
                  {copiedKey === selectedFile.key
                    ? <><Check className="w-4 h-4 text-emerald-500" />已复制链接</>
                    : <><Link2 className="w-4 h-4" />复制访问链接</>}
                </Button>
                <Button variant="ghost"
                  onClick={() => handleDownload(selectedFile.key)}
                  className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5 text-foreground"
                >
                  <Download className="w-4 h-4" />下载文件
                </Button>
                <Button variant="ghost"
                  onClick={() => { setFileToDelete(selectedFile.key); setSelectedFileKey(null); }}
                  className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />删除文件
                </Button>
              </div>
            </div>
          </aside>
      )}
      </div>

      {/* ── Image Preview Modal ── */}
      {previewFile && domains.length > 0 && (
        <Dialog open onOpenChange={(open) => { if (!open) closePreview(); }}>
          <DialogContent
            showCloseButton={false}
            className="top-0 left-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none bg-black/90 p-0 ring-0 sm:max-w-none"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === "ArrowLeft") previewPrev();
              else previewNext();
            }}
          >
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          <div className="absolute inset-0" aria-hidden="true" onClick={closePreview} />
          {/* Close */}
          <Button variant="ghost"
            onClick={closePreview}
            aria-label="关闭图片预览"
            className="absolute top-4 right-4 z-10 size-9 rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 active:not-aria-[haspopup]:translate-y-0"
          >
            <X className="w-5 h-5" />
          </Button>

          {/* Counter */}
          {imageFiles.length > 1 && (
            <div className="pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2 px-3 py-1 rounded-lg bg-black/50 text-white text-xs">
              {imageFiles.findIndex(f => f.key === previewFile.key) + 1} / {imageFiles.length}
            </div>
          )}

          {/* Prev */}
          {imageFiles.length > 1 && (
            <Button variant="ghost"
              onClick={previewPrev}
              aria-label="上一张"
              aria-disabled={imageFiles.findIndex(f => f.key === previewFile.key) <= 0}
              className="absolute inset-y-0 left-4 z-10 my-auto size-10 rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 aria-disabled:opacity-35 active:not-aria-[haspopup]:translate-y-0"
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          )}

          {/* Next */}
          {imageFiles.length > 1 && (
            <Button variant="ghost"
              onClick={previewNext}
              aria-label="下一张"
              aria-disabled={imageFiles.findIndex(f => f.key === previewFile.key) >= imageFiles.length - 1}
              className="absolute inset-y-0 right-4 z-10 my-auto size-10 rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 aria-disabled:opacity-35 active:not-aria-[haspopup]:translate-y-0"
            >
              <ChevronRight className="w-6 h-6" />
            </Button>
          )}

          {/* Image */}
          <img
            src={generateDownloadUrl(ak, sk, domains[0], previewFile.key, isPrivateBucket)}
            alt={previewFile.key}
            className="relative max-w-[90vw] max-h-[90vh] object-contain select-none"
            draggable={false}
          />

          {/* Filename */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/50 text-white text-xs max-w-[80vw] truncate text-center">
            {previewFile.key.split('/').pop()}
          </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showCreateFolder} onOpenChange={(open) => {
        if (!open && !isCreatingFolder) {
          setShowCreateFolder(false);
          setNewFolderName("");
        }
      }}>
        <DialogContent showCloseButton={!isCreatingFolder}>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            {currentPrefix && <DialogDescription className="break-all">位置：{currentPrefix}</DialogDescription>}
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => {
            event.preventDefault();
            if (!isCreatingFolder && newFolderName.trim()) void handleCreateFolder();
          }}>
            <Input autoFocus value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)}
              aria-label="文件夹名称" placeholder="输入文件夹名称" />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isCreatingFolder} onClick={() => {
                setShowCreateFolder(false);
                setNewFolderName("");
              }}>取消</Button>
              <Button type="submit" disabled={isCreatingFolder || !newFolderName.trim()}>
                {isCreatingFolder && <Loader2 className="animate-spin" aria-hidden="true" />}
                {isCreatingFolder ? "创建中..." : "确认创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(fileToDelete || dirToDelete || batchDeletePending)} onOpenChange={(open) => {
        if (!open) cancelDelete();
      }}>
        <DialogContent showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>确认删除？</DialogTitle>
            <DialogDescription className="break-all">
              <strong className="block text-destructive">
                {batchDeletePending ? `将删除已选的 ${selectedKeys.size} 个文件` : fileToDelete || dirToDelete}
              </strong>
              {dirToDelete ? "该目录下的所有文件都将被彻底删除，并且无法恢复" : "删除后将无法恢复"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={isDeleting} onClick={cancelDelete}>取消</Button>
            <Button variant="destructive" disabled={isDeleting} onClick={() => {
              if (batchDeletePending) void handleBatchDelete();
              else if (dirToDelete) void executeDeleteDirectory(dirToDelete);
              else if (fileToDelete) void executeDeleteFile(fileToDelete);
            }}>
              {isDeleting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {isDeleting ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBookmarkDialog} onOpenChange={(open) => {
        if (!open) {
          if (isEditingBookmark) handleBookmarkDone();
          else handleBookmarkCancel();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditingBookmark ? "修改书签" : "添加书签"}</DialogTitle>
            <DialogDescription className="break-all font-mono">
              {bucket}{currentPrefix ? "/" + currentPrefix.replace(/\/$/, "") : ""}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => {
            event.preventDefault();
            handleBookmarkDone();
          }}>
            <div className="grid gap-2">
              <Label htmlFor="file-manager-bookmark-name">名称</Label>
              <div className="relative">
                <Input id="file-manager-bookmark-name" autoFocus value={bookmarkLabel} className="pr-9"
                  onChange={(event) => setBookmarkLabel(event.target.value)} placeholder="书签名称" />
                {bookmarkLabel && (
                  <Button type="button" variant="ghost" size="icon-xs" className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setBookmarkLabel("")} aria-label="清除名称"><X /></Button>
                )}
              </div>
            </div>
            <DialogFooter>
              {isEditingBookmark
                ? <Button type="button" variant="outline" onClick={handleBookmarkRemove}>移除</Button>
                : <Button type="button" variant="outline" onClick={handleBookmarkCancel}>取消</Button>}
              <Button type="submit">完成</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
