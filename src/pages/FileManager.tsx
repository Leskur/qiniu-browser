import { Label } from "@/components/ui/label";
import { createUploadRetry } from "../lib/upload-retry";
import { ensureTransferEvents, failActiveTransfers } from "../lib/transfer-events";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fetchFiles, fetchBucketDomains, QiniuFile, deleteFile, deleteDirectory, generateDownloadUrl, batchDeleteFiles, formatBatchDeleteResult, renameFile, createFolder } from "../lib/qiniu";
import {
  File, Image, Film, FileText, Archive,
  Link2, Copy, Check, RefreshCw, Trash2, Upload, FolderOpen,
  Folder, ChevronRight, AlertCircle, Database, Download, X, ArrowUpDown, ArrowUp, ArrowDown, Pencil, ArrowLeft, ArrowRight,
  Search, FolderPlus, ZoomIn, ChevronLeft, Maximize2, Bookmark, Loader2, ChevronDown
} from "lucide-react";
import { toast } from "@/lib/toast";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTransferStore } from "../store/transfer";
import { useAppStore } from "../store";
import { formatBytes, formatQiniuTime } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { Checkbox } from "../components/ui/checkbox";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet";
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

/** 过滤空目录占位符（key 以 / 结尾），目录只取 commonPrefixes */
function normalizeListResult(res: { items?: QiniuFile[]; commonPrefixes?: string[]; marker?: string }) {
  const items = (res.items || []).filter(i => !i.key.endsWith('/'));
  const folders = res.commonPrefixes || [];
  const nextMarker = res.marker || "";
  return { items, folders, nextMarker, hasMore: !!nextMarker };
}

// ─── Component ────────────────────────────────────────────────────────────────

type VirtualEntry =
  | { type: 'folder'; name: string; prefix: string }
  | { type: 'file'; name: string; file: QiniuFile };

export function FileManager({ ak, sk, bucket, onBack, refreshTrigger, initialPrefix, onInitialPrefixUsed }: {
  ak: string; sk: string; bucket: string; onBack: () => void; refreshTrigger?: number;
  initialPrefix?: string; onInitialPrefixUsed?: () => void;
}) {
  const [domains, setDomains] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  // Transfer store
  const setPanelOpen = useTransferStore((s) => s.setPanelOpen);
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
  
  // Folder upload dialog
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
    setSelectedFile(null);
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

  // ── Per-directory data state ──
  const [items, setItems]           = useState<QiniuFile[]>([]);
  const [folders, setFolders]       = useState<string[]>([]); // commonPrefixes from API
  const [nextMarker, setNextMarker] = useState<string>("");
  const [hasMore, setHasMore]       = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");

  // ── Directory cache with timestamp ──
  const dirCache = useRef<Map<string, { 
    items: QiniuFile[]; 
    folders: string[]; 
    nextMarker: string; 
    hasMore: boolean;
    timestamp: number;
  }>>(new Map());

  // 清理只影响缓存，当前展示的数据和登录、书签等偏好保持不变。
  useEffect(() => useAppStore.subscribe((state, previous) => {
    if (state.cacheVersion !== previous.cacheVersion) dirCache.current.clear();
  }), []);

  
  // Get cache expire time from settings
  const { cacheExpireMinutes, itemsPerPage } = useAppStore();
  const CACHE_TTL = cacheExpireMinutes * 60 * 1000;

  // 账号、空间或每页数量变化后，旧列表不能继续用于当前请求。
  useEffect(() => {
    dirCache.current.clear();
  }, [ak, sk, bucket, itemsPerPage]);
  
  // Refresh throttle to prevent excessive API calls
  const [lastRefreshTime, setLastRefreshTime] = useState(0);
  const REFRESH_COOLDOWN = 2000; // 2 seconds

  // ── Detail modal state ──
  const [selectedFile, setSelectedFile] = useState<QiniuFile | null>(null);

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

  // ── Search state ──
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState(""); // 已生效的前缀过滤
  const searchInputRef = useRef<HTMLInputElement>(null);
  const inApiSearchRef = useRef(false);
  const listRequestId = useRef(0);
  const loadedListPrefix = useRef<string | null>(null);
  const paginationPending = useRef(false);
  const currentPrefixRef = useRef(currentPrefix);
  currentPrefixRef.current = currentPrefix;

  // ── Delete state ──
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [dirToDelete, setDirToDelete] = useState<string | null>(null);
  const [batchDeletePending, setBatchDeletePending] = useState(false);
  const [isDeleting, setIsDeleting]     = useState(false);
  const [downloadPrompt, setDownloadPrompt] = useState<string | null>(null);
  const downloadPromptResolver = useRef<((confirmed: boolean) => void) | null>(null);
  useEffect(() => () => downloadPromptResolver.current?.(false), []);

  const confirmDownload = (message: string) => {
    if (downloadPromptResolver.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      downloadPromptResolver.current = resolve;
      setDownloadPrompt(message);
    });
  };

  const finishDownloadPrompt = (confirmed: boolean) => {
    downloadPromptResolver.current?.(confirmed);
    downloadPromptResolver.current = null;
    setDownloadPrompt(null);
  };

  // ── Upload state ──
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Create folder state ──
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  
  // ── Batch selection ──
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const someSelected = selectedKeys.size > 0;

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
    setSelectedFile(null);
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

  const [uploadChoice, setUploadChoice] = useState<{
    sourcePath: string;
    selectionCount: number;
    destination: string;
    fileCount: number;
    totalSize: number;
  } | null>(null);
  const uploadChoiceResolver = useRef<((value: string | null) => void) | null>(null);
  const [overwriteUpload, setOverwriteUpload] = useState(false);
  const uploadPending = useRef(false);
  useEffect(() => () => uploadChoiceResolver.current?.(null), []);
  const finishUploadChoice = (value: string | null) => {
    uploadChoiceResolver.current?.(value);
    uploadChoiceResolver.current = null;
    setUploadChoice(null);
  };
  const handleUploadPaths = async (paths: string[]) => {
    if (!mounted.current || paths.length === 0 || uploadPending.current) return;
    uploadPending.current = true;
    let taskIds: string[] = [];
    
    try {
      const files = await invoke<{ path: string; key: string; size: number }[]>('prepare_uploads', {
        filePaths: paths,
        prefix: currentPrefix,
        relativePaths: null,
      });
      if (!mounted.current) return;
      if (files.length === 0) {
        toast.info("所选目录中没有可上传的文件");
        return;
      }
      setOverwriteUpload(false);
      const policy = await new Promise<string | null>(resolve => {
        uploadChoiceResolver.current = resolve;
        setUploadChoice({
          sourcePath: paths[0],
          selectionCount: paths.length,
          destination: `${bucket}/${currentPrefix}`,
          fileCount: files.length,
          totalSize: files.reduce((total, file) => total + file.size, 0),
        });
      });
      if (!policy) return;
      await ensureTransferEvents();
      if (!mounted.current) return;
      setIsUploading(true);
      const transfers = useTransferStore.getState();
      taskIds = transfers.addTasks(files.map(({ path, key, size }) => ({
        type: 'upload',
        fileName: key,
        filePath: path,
        totalSize: size,
      })));
      transfers.batchUpdateTasks(new Map(files.map(({ path, key }, index) => {
        const id = taskIds[index];
        return [id, { retry: createUploadRetry(id, { ak, sk, bucket, filePath: path, key, conflictPolicy: policy }) }];
      })));
      const upload = invoke<{ uploaded: string[]; failed: string[]; skipped: string[]; cancelled: number }>('upload_files', {
        ak, sk, bucket,
        filePaths: files.map(({ path }) => path),
        prefix: '',
        relativePaths: files.map(({ key }) => key),
        taskIds,
        conflictPolicy: policy,
      });
      setPanelOpen(true);
      const result = await upload;
      
      const summary = `成功 ${result.uploaded.length} 个，跳过 ${result.skipped.length} 个，失败 ${result.failed.length} 个，取消 ${result.cancelled} 个`;
      if (result.failed.length > 0) toast.warning('上传结束，部分文件失败', { description: summary });
      else if (result.cancelled > 0) toast.info('上传已停止', { description: summary });
      else toast.success('上传结束', { description: summary });
      dirCache.current.delete(currentPrefix);
      if (mounted.current && currentPrefix === currentPrefixRef.current) void loadDirectory(currentPrefix, true);
    } catch (err) {
      failActiveTransfers(taskIds, err);
      toast.error('上传失败', { description: String(err) });
    } finally {
      setIsUploading(false);
      uploadPending.current = false;
    }
  };

  // ── Download ──
  const handleDownload = async (key: string) => {
    if (domains.length === 0) {
      toast.warning("此存储空间未绑定外链域名，无法下载", {
        description: "请先在「CDN → 域名」绑定域名后再试",
      });
      return;
    }
    const filename = key.split('/').pop() || key;
    const savePath = await save({
      title: "保存文件",
      defaultPath: filename,
    });
    if (!savePath) return;
    const url = generateDownloadUrl(ak, sk, domains[0], key, isPrivateBucket);
    const tid = toast.loading(`正在下载 ${filename}...`, { duration: Infinity });
    try {
      await invoke("download_file", { url, savePath });
      toast.dismiss(tid);
      toast.success("下载完成", { description: filename });
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error("下载失败", { description: String(err) });
    }
  };

  // ─── Load domain list once with cache ───────────────────────────────────────────────
  useEffect(() => {
    const { getBucketDomains, setBucketDomains } = useAppStore.getState();
    
    // Check cache first
    const cached = getBucketDomains(bucket);
    if (cached) {
      setDomains(cached);
      return;
    }
    
    // Fetch from API
    let cancelled = false;
    fetchBucketDomains(ak, sk, bucket)
      .then(domains => {
        if (cancelled) return;
        setDomains(domains);
        setBucketDomains(bucket, domains);
      })
      .catch(() => { if (!cancelled) setDomains([]); });
    return () => { cancelled = true; };
  }, [ak, sk, bucket]);

  // ─── Load files whenever prefix changes ──────────────────────────────────
  const loadDirectory = useCallback(async (prefix: string, forceRefresh = false) => {
    if (prefix !== currentPrefixRef.current) return;
    const requestId = ++listRequestId.current;
    const isCurrent = () => requestId === listRequestId.current && prefix === currentPrefixRef.current;
    loadedListPrefix.current = null;
    paginationPending.current = false;
    setLoadingMore(false);
    // Check cache first with expiration
    if (!forceRefresh && dirCache.current.has(prefix)) {
      const cached = dirCache.current.get(prefix)!;
      const isExpired = Date.now() - cached.timestamp > CACHE_TTL;
      
      if (!isExpired) {
        // Use cached data
        setItems(cached.items);
        setFolders(cached.folders);
        setNextMarker(cached.nextMarker);
        setHasMore(cached.hasMore);
        loadedListPrefix.current = prefix;
        setLoading(false);
        setError("");
        setSelectedKeys(new Set());
        return;
      } else {
        // Cache expired, remove it
        dirCache.current.delete(prefix);
      }
    }

    setLoading(true);
    setError("");
    setItems([]);
    setFolders([]);
    setNextMarker("");
    setHasMore(false);
    setSelectedKeys(new Set());
    try {
      const res = await fetchFiles(ak, sk, bucket, prefix, "", itemsPerPage, "/");
      if (!isCurrent()) return;
      const { items: newItems, folders: newFolders, nextMarker: newMarker, hasMore: newHasMore } =
        normalizeListResult(res);

      setItems(newItems);
      setFolders(newFolders);
      setNextMarker(newMarker);
      setHasMore(newHasMore);
      loadedListPrefix.current = prefix;
      dirCache.current.set(prefix, { 
        items: newItems, 
        folders: newFolders, 
        nextMarker: newMarker, 
        hasMore: newHasMore,
        timestamp: Date.now()
      });
    } catch (err: any) {
      if (!isCurrent()) return;
      setError(err.message || "加载失败");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [ak, sk, bucket, CACHE_TTL, itemsPerPage]);

  const clearSearch = useCallback(() => {
    setSearchInput("");
    setCommittedSearch("");
    if (inApiSearchRef.current) {
      inApiSearchRef.current = false;
      loadDirectory(currentPrefix);
    }
  }, [loadDirectory, currentPrefix]);

  const runPrefixSearch = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) {
      setCommittedSearch("");
      if (inApiSearchRef.current) {
        inApiSearchRef.current = false;
        await loadDirectory(currentPrefixRef.current);
      }
      return;
    }

    const directoryPrefix = currentPrefixRef.current;
    const listPrefix = directoryPrefix + q;
    const reqId = ++listRequestId.current;
    const isCurrent = () => reqId === listRequestId.current && directoryPrefix === currentPrefixRef.current;
    loadedListPrefix.current = null;
    paginationPending.current = false;
    setLoadingMore(false);
    setNextMarker("");
    setHasMore(false);
    inApiSearchRef.current = true;
    setCommittedSearch(q);
    setLoading(true);
    setError("");
    setSelectedKeys(new Set());
    try {
      const res = await fetchFiles(ak, sk, bucket, listPrefix, "", itemsPerPage, "/");
      if (!isCurrent()) return;
      const normalized = normalizeListResult(res);
      setItems(normalized.items);
      setFolders(normalized.folders);
      setNextMarker(normalized.nextMarker);
      setHasMore(normalized.hasMore);
      loadedListPrefix.current = listPrefix;
    } catch (err: any) {
      if (!isCurrent()) return;
      setError(err.message || "搜索失败");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [ak, sk, bucket, itemsPerPage, loadDirectory]);

  // 输入防抖自动前缀过滤；清空则恢复当前目录
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput.trim() === committedSearch.trim()) return;
      void runPrefixSearch(searchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, committedSearch, runPrefixSearch]);

  /** 刷新当前视图：搜索中则重跑前缀搜索，否则刷新目录 */
  const refreshCurrentView = useCallback(async (forceRefresh = true) => {
    const q = committedSearch.trim();
    if (!q) {
      await loadDirectory(currentPrefix, forceRefresh);
      return;
    }
    await runPrefixSearch(q);
  }, [committedSearch, loadDirectory, currentPrefix, runPrefixSearch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || previewFile) return;
      if (ctxMenu) { closeCtxMenu(); return; }
      if (selectedFile) { setSelectedFile(null); return; }
      if (searchInput || committedSearch) { clearSearch(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ctxMenu, selectedFile, searchInput, committedSearch, previewFile, clearSearch]);

  // ─── Load more (next page) ────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    const listPrefix = committedSearch ? currentPrefix + committedSearch : currentPrefix;
    if (!hasMore || loadingMore || !nextMarker || paginationPending.current ||
        loadedListPrefix.current !== listPrefix || currentPrefix !== currentPrefixRef.current) return;
    const requestId = listRequestId.current;
    const isCurrent = () => requestId === listRequestId.current && currentPrefix === currentPrefixRef.current;
    paginationPending.current = true;
    setLoadingMore(true);
    const isSearch = !!committedSearch;
    try {
      const res = await fetchFiles(ak, sk, bucket, listPrefix, nextMarker, itemsPerPage, "/");
      if (!isCurrent()) return;
      const { items: moreItems, folders: moreFolders, nextMarker: newMarker, hasMore: newHasMore } =
        normalizeListResult(res);

      setItems(prev => [...prev, ...moreItems]);
      setFolders(prev => {
        const existing = new Set(prev);
        return [...prev, ...moreFolders.filter(f => !existing.has(f))];
      });
      setNextMarker(newMarker);
      setHasMore(newHasMore);
      if (!isSearch) {
        dirCache.current.set(currentPrefix, {
          items: [...items, ...moreItems],
          folders: [...new Set([...folders, ...moreFolders])],
          nextMarker: newMarker,
          hasMore: newHasMore,
          timestamp: Date.now()
        });
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      toast.error("加载更多失败", { description: err.message });
    } finally {
      if (isCurrent()) {
        paginationPending.current = false;
        setLoadingMore(false);
      }
    }
  }, [ak, sk, bucket, currentPrefix, nextMarker, hasMore, loadingMore, items, folders, itemsPerPage, committedSearch]);

  useEffect(() => {
    inApiSearchRef.current = false;
    loadDirectory(currentPrefix);
    setSearchInput("");
    setCommittedSearch("");
  }, [currentPrefix, loadDirectory]);

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

  const handleBatchDownload = async () => {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    if (domains.length === 0) {
      toast.warning('此存储空间未绑定外链域名，无法下载', {
        description: '请先在「CDN → 域名」绑定域名后再试',
      });
      return;
    }
    try {
      const dir = await open({ directory: true, title: '选择保存目录' });
      if (!dir || Array.isArray(dir) || !mounted.current) return;
      await downloadBatch(keys.map(key => ({ key, name: key.split('/').pop() || key })), dir);
      setSelectedKeys(new Set());
    } catch (err: any) {
      toast.error('批量下载失败', { description: String(err) });
    }
  };

  const downloadBatch = async (files: { key: string; name: string }[], dir: string) => {
    await ensureTransferEvents();
    if (!mounted.current) return;
    const items = files.map(({ key, name }) => [
      generateDownloadUrl(ak, sk, domains[0], key, isPrivateBucket),
      name,
    ]);
    const taskIds = useTransferStore.getState().addTasks(files.map(({ name }) => ({
      type: "download",
      fileName: name,
      totalSize: 0,
    })));
    setPanelOpen(true);
    try {
      const result = await invoke<{ downloaded: string[]; failed: string[] }>(
        'download_files_to_dir', { items, dir, taskIds },
      );
      if (result.failed.length > 0) {
        toast.warning("下载未完全成功", { description: `成功 ${result.downloaded.length} 个，失败 ${result.failed.length} 个` });
      }
    } catch (error) {
      failActiveTransfers(taskIds, error);
      throw error;
    }
  };
  
  const handleDownloadFolder = async (folderPrefix: string) => {
    if (domains.length === 0) {
      toast.warning('此存储空间未绑定外链域名，无法下载', {
        description: '请先在「CDN → 域名」绑定域名后再试',
      });
      return;
    }
    
    let loadingToast: string | undefined;
    try {
      const dir = await open({ directory: true, title: '选择保存目录' });
      if (!dir || Array.isArray(dir) || !mounted.current) return;
      const allFiles: QiniuFile[] = [];
      const seenMarkers = new Set<string>();
      let marker = "";
      loadingToast = toast.loading('正在获取文件夹内容...');
      do {
        const res = await fetchFiles(ak, sk, bucket, folderPrefix, marker, 1000);
        if (!mounted.current) return;
        allFiles.push(...(res.items || []).filter(file => !file.key.endsWith('/')));
        marker = res.marker || "";
        if (marker && seenMarkers.has(marker)) throw new Error("文件夹分页游标重复");
        seenMarkers.add(marker);
        toast.loading(`已获取 ${allFiles.length} 个文件...`, { id: loadingToast });
      } while (marker);
      toast.dismiss(loadingToast);
      loadingToast = undefined;

      if (allFiles.length === 0) {
        toast.info('文件夹为空');
        return;
      }
      
      const folderName = folderPrefix.slice(0, -1).split('/').pop() || 'folder';

      if (allFiles.length > 100) {
        const totalSize = allFiles.reduce((sum, f) => sum + f.fsize, 0);
        const confirmed = await confirmDownload(
          `即将下载 ${allFiles.length} 个文件，总大小约 ${formatBytes(totalSize)}。\n\n是否继续？`
        );
        if (!confirmed) return;
      }
      
      await downloadBatch(allFiles.map(({ key }) => ({
        key,
        name: folderName + '/' + key.slice(folderPrefix.length),
      })), dir);
    } catch (err) {
      toast.error('下载文件夹失败', { description: String(err) });
    } finally {
      if (loadingToast) toast.dismiss(loadingToast);
    }
  };

  // ─── Navigation ──────────────────────────────────────────────────────────
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

  // ─── Upload ──────────────────────────────────────────────────────────────
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

  const handleUpload = async (directory: boolean) => {
    try {
      const selected = await open({
        multiple: !directory, directory,
        title: directory ? "选择要上传的文件夹" : "选择要上传的文件",
      });
      if (!selected) return;
      const paths: string[] = Array.isArray(selected) ? selected : [selected];
      
      void handleUploadPaths(paths);
    } catch (err: any) {
      toast.error("打开文件对话框失败", { description: err.message });
    }
  };
  
  // ─── Delete ──────────────────────────────────────────────────────────────
  const executeDeleteFile = async (key: string) => {
    setIsDeleting(true);
    try {
      await deleteFile(ak, sk, bucket, key);
      toast.success("文件已删除", { description: key });
      const newItems = items.filter(f => f.key !== key);
      setItems(newItems);
      // Update cache with timestamp
      if (dirCache.current.has(currentPrefix)) {
        dirCache.current.set(currentPrefix, { 
          items: newItems, 
          folders, 
          nextMarker, 
          hasMore,
          timestamp: Date.now()
        });
      }
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
      dirCache.current.clear();
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
    <div className="relative flex h-full flex-col overflow-hidden bg-white dark:bg-zinc-950">
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
                <dd className="truncate" title={uploadChoice.sourcePath}>{uploadChoice.sourcePath}</dd>
                {uploadChoice.selectionCount > 1 && <dd className="text-xs text-muted-foreground">另有 {uploadChoice.selectionCount - 1} 项</dd>}
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">上传到</dt>
                <dd className="truncate" title={uploadChoice.destination}>{uploadChoice.destination}</dd>
              </div>
            </dl>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-1">
              <Label className="cursor-pointer text-sm font-medium" htmlFor="overwrite-upload">覆盖上传</Label>
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
      <div className="relative z-20 shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex h-12 items-center gap-2 px-6">
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
              <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
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
              <div className="relative w-52">
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
                    <span className="px-0.5 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500" title={`${sortedEntries.length} 个结果`}>
                      {sortedEntries.length}
                    </span>
                  )}
                  {(searchInput || committedSearch) && (
                    <Button variant="ghost"
                      type="button"
                      onClick={() => clearSearch()}
                      className="h-auto p-0 rounded-xs p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
                    className="h-auto p-0 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-accent dark:text-zinc-200"
                    onClick={() => { setUploadMenuOpen(false); handleUpload(false); }}
                  >
                    <Upload className="size-4 text-muted-foreground" />
                    上传文件
                  </Button>
                  <Button variant="ghost"
                    type="button"
                    className="h-auto p-0 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-accent dark:text-zinc-200"
                    onClick={() => { setUploadMenuOpen(false); handleUpload(true); }}
                  >
                    <FolderOpen className="size-4 text-muted-foreground" />
                    上传文件夹
                  </Button>
                </PopoverContent>
              </Popover>
              <Button variant="outline" onClick={() => { setShowCreateFolder(true); setNewFolderName(""); }} disabled={loading} title="新建文件夹">
                <FolderPlus />
                新建文件夹
              </Button>
            </div>
          )}
        </div>

        {/* ── Path row ── */}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto px-6 py-2">
          <Button variant="ghost"
            type="button"
            onClick={onBack}
            className="h-auto p-0 shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            空间列表
          </Button>
          <ChevronRight className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
          <Button variant="ghost"
            type="button"
            onClick={() => navigateToBreadcrumb(-1)}
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors ${breadcrumbs.length === 0 ? "font-semibold text-zinc-900 dark:text-zinc-100" : "font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
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
                      className="h-auto p-0 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
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
                              className="h-auto p-0 w-full truncate px-3 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
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
                            ? "font-semibold text-zinc-900 dark:text-zinc-100"
                            : "font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
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
      </div>

      {/* ── Content ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-emerald-400 bg-emerald-50/90 dark:border-emerald-500 dark:bg-emerald-950/80">
            <Upload className="size-12 text-emerald-500" />
            <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">松开以上传到当前目录</p>
            <p className="text-sm text-emerald-600 opacity-70 dark:text-emerald-400">{currentPrefix || bucket}</p>
          </div>
        )}
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-20 text-zinc-500 h-full">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-emerald-600 dark:border-zinc-800" />
            <p className="text-sm">正在获取文件列表...</p>
          </div>
        ) : error ? (
          <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-6 text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <AlertCircle className="size-4" /> 加载失败
            </div>
            <div className="mb-4 break-all rounded-xs bg-red-100/50 p-2 font-mono text-xs dark:bg-red-900/20">{error}</div>
            <Button variant="outline" size="sm" onClick={() => refreshCurrentView(true)}>重试</Button>
          </div>
        ) : entries.length === 0 && !hasMore ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-16 text-center">
            <Folder className="size-8 text-zinc-300 dark:text-zinc-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {committedSearch
                  ? "没有匹配此路径前缀的结果"
                  : currentPrefix ? "该文件夹是空的" : "空间中没有文件"}
              </p>
              <p className="max-w-xs text-xs text-zinc-400 dark:text-zinc-500">
                {committedSearch
                  ? "输入 logo 可匹配当前目录下的 logo.png 或 logo-assets/。"
                  : "上传文件后即可在此管理"}
              </p>
            </div>
          </div>
        ) : (
          <div ref={scrollContainerRef} className="h-full overflow-y-auto">
            <Table containerClassName="contents" className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80">
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
                  <TableHead className="hidden h-10 w-52 whitespace-nowrap px-2 text-left align-middle text-xs font-medium text-zinc-500 md:table-cell dark:text-zinc-400">类型</TableHead>
                  <TableHead className="hidden w-44 p-0 lg:table-cell" aria-sort={sortField === "time" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                    <TableSortButton onClick={() => cycleSort("time")}>修改时间<SortIcon field="time" /></TableSortButton>
                  </TableHead>
                  <TableHead className="h-10 w-36 whitespace-nowrap px-2 pr-5 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400" />
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
                      className={`group flex cursor-pointer items-center border-b border-zinc-100 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800/80 dark:hover:bg-zinc-900/50 ${dirToDelete === entry.prefix && isDeleting ? "pointer-events-none opacity-40" : ""}`}
                      onClick={() => navigateToFolder(entry.prefix)}
                    >
                      <div className="w-10 shrink-0 pl-4" />
                      <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
                        <Folder className="size-4 shrink-0 text-amber-400" />
                        <button type="button" disabled={dirToDelete === entry.prefix && isDeleting}
                          onClick={e => { e.stopPropagation(); navigateToFolder(entry.prefix); }}
                          className="w-full min-w-0 cursor-pointer truncate text-left font-medium text-zinc-800 transition-colors group-hover:text-emerald-600 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring dark:text-zinc-100 dark:group-hover:text-emerald-400">
                          <HighlightText text={entry.name} query={committedSearch} />
                        </button>
                      </div>
                      <div className="w-28 shrink-0 text-xs text-zinc-400">—</div>
                      <div className="hidden w-52 shrink-0 text-xs text-zinc-500 md:block dark:text-zinc-400">文件夹</div>
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
                    onClick={() => !someSelected && !isRenaming && setSelectedFile(file)}
                    onDoubleClick={() => !isRenaming && openPreview(file)}
                    onContextMenu={(e) => openCtxMenu(e, file)}
                    className={`group flex cursor-pointer items-center border-b border-zinc-100 text-sm transition-colors dark:border-zinc-800/80
                      ${isChecked ? "bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"}
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
                          className="file-name-input min-w-0 w-full flex-1 rounded-xs border border-emerald-400 bg-white px-2 py-0.5 text-sm text-zinc-800 outline-none focus:ring-2 focus:ring-emerald-400/40 dark:border-emerald-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      ) : (
                        <>
                          <button type="button" disabled={someSelected || (fileToDelete === file.key && isDeleting)}
                            onClick={e => { e.stopPropagation(); setSelectedFile(file); }}
                            className="min-w-0 cursor-pointer truncate text-left text-zinc-800 transition-colors group-hover:text-emerald-600 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring dark:text-zinc-100 dark:group-hover:text-emerald-400" title={file.key}>
                            <HighlightText text={entry.name} query={committedSearch} />
                          </button>
                          <Button variant="ghost"
                            type="button"
                            onClick={(e) => { void handleCopyFileName(e, file.key); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            title="复制文件名"
                            aria-label={`复制文件名：${file.key.slice(file.key.lastIndexOf("/") + 1)}`}
                            className="h-auto p-0 shrink-0 rounded-xs p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          >
                            <Copy className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                    <div className="w-28 shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatBytes(file.fsize)}</div>
                    <div className="hidden w-52 shrink-0 truncate text-xs text-zinc-500 md:block dark:text-zinc-400">{file.mimeType || "—"}</div>
                    <div className="hidden w-44 shrink-0 font-mono text-xs tabular-nums text-zinc-500 lg:block dark:text-zinc-400">{formatQiniuTime(file.putTime)}</div>
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
              onClick={() => { setSelectedFile(ctxMenu.file); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <File className="w-4 h-4 text-zinc-400" />文件详情
            </Button>
            <Button variant="ghost"
              onClick={(e) => { startRename(e, ctxMenu.file); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Pencil className="w-4 h-4 text-zinc-400" />重命名
            </Button>
            <Button variant="ghost"
              onClick={(e) => { void handleCopyFileName(e, ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Copy className="w-4 h-4 text-zinc-400" />复制文件名
            </Button>
            <Button variant="ghost"
              onClick={(e) => { handleCopyLink(e, ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Link2 className="w-4 h-4 text-zinc-400" />复制链接
            </Button>
            <Button variant="ghost"
              onClick={() => { handleDownload(ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Download className="w-4 h-4 text-zinc-400" />下载
            </Button>
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
            <Button variant="ghost"
              onClick={() => { setFileToDelete(ctxMenu.file.key); closeCtxMenu(); }}
              className="h-auto p-0 justify-start w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />删除
            </Button>
          </PopoverContent>
        </Popover>
      )}

      {/* ── File Detail Drawer ── */}
      <Sheet modal={false} disablePointerDismissal open={Boolean(selectedFile)}
        onOpenChange={(open) => { if (!open) setSelectedFile(null); }}>
        <SheetContent className="gap-0" showCloseButton={false} showOverlay={false}>
        {selectedFile && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <div className="shrink-0">{getFileIcon(selectedFile.mimeType)}</div>
              <SheetTitle className="flex-1 truncate text-sm font-semibold" title={selectedFile.key}>
                {selectedFile.key.split('/').pop() || selectedFile.key}
              </SheetTitle>
              <Button variant="ghost"
                onClick={() => setSelectedFile(null)}
                className="h-auto p-0 p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
              {selectedFile.mimeType?.startsWith('image/') && domains.length > 0 && (
                <div
                  className="rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-zoom-in relative group"
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
              {([
                ["完整路径", selectedFile.key],
                ["文件大小", formatBytes(selectedFile.fsize)],
                ["MIME 类型", selectedFile.mimeType || "unknown"],
                ["上传时间", formatQiniuTime(selectedFile.putTime)],
                ["存储类型", (["标准存储", "低频存储", "归档存储", "深度归档"][selectedFile.type] ?? `类型 ${selectedFile.type}`)],
                ["Hash (Etag)", selectedFile.hash],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
                  <p className="font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-3 py-2">{value}</p>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-4 border-t border-zinc-100 dark:border-zinc-800 flex flex-col gap-2 shrink-0">
              <Button variant="ghost"
                onClick={(e) => { void handleCopyFileName(e, selectedFile.key); }}
                className="h-auto p-0 justify-start w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                <Copy className="w-4 h-4" />复制文件名
              </Button>
              <Button variant="ghost"
                onClick={(e) => { handleCopyLink(e, selectedFile.key); }}
                className="h-auto p-0 justify-start w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
              >
                {copiedKey === selectedFile.key
                  ? <><Check className="w-4 h-4" />已复制链接</>
                  : <><Link2 className="w-4 h-4" />复制访问链接</>}
              </Button>
              <Button variant="ghost"
                onClick={() => handleDownload(selectedFile.key)}
                className="h-auto p-0 justify-start w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
              >
                <Download className="w-4 h-4" />下载文件
              </Button>
              <Button variant="ghost"
                onClick={() => { setFileToDelete(selectedFile.key); setSelectedFile(null); }}
                className="h-auto p-0 justify-start w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              >
                <Trash2 className="w-4 h-4" />删除文件
              </Button>
            </div>
          </>
        )}
        </SheetContent>
      </Sheet>

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
