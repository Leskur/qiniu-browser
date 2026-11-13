import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fetchFiles, fetchBucketDomains, QiniuFile, deleteFile, deleteDirectory, generateDownloadUrl, batchDeleteFiles, renameFile, createFolder } from "../lib/qiniu";
import {
  File, Image, Film, FileText, Archive,
  Link2, Copy, Check, RefreshCw, Trash2, Upload, FolderOpen,
  Folder, ChevronRight, AlertCircle, Database, Download, X, Square, CheckSquare, ArrowUpDown, ArrowUp, ArrowDown, Pencil, ArrowLeft, ArrowRight,
  Search, FolderPlus, ZoomIn, ChevronLeft, Maximize2, Bookmark, Loader2, ChevronDown
} from "lucide-react";
import { toast } from "@/lib/toast";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { FolderUploadDialog } from "../components/FolderUploadDialog";
import { useTransferStore, type TransferTask } from "../store/transfer";
import { useAppStore } from "../store";
import { formatBytes, formatQiniuTime } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
  const addTask = useTransferStore((s) => s.addTask);
  const setPanelOpen = useTransferStore((s) => s.setPanelOpen);

  // Bucket stats from global store
  const { buckets } = useAppStore();
  const bucketInfo = buckets.find(b => b.tbl === bucket);
  // 桶信息未就绪时默认按私有签名，避免裸链 401
  const isPrivateBucket = bucketInfo ? bucketInfo.private === 1 : true;
  
  // Folder upload dialog
  const [folderUploadPath, setFolderUploadPath] = useState<string | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  // ── Virtual folder navigation + history ──
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [navHistory, setNavHistory] = useState<string[]>([""]);  // visited prefixes
  const [navIndex, setNavIndex] = useState(0);                    // current position

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
    const handler = (e: MouseEvent) => {
      if (e.button === 3) { e.preventDefault(); goBack(); }
      if (e.button === 4) { e.preventDefault(); goForward(); }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
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
  
  // Get cache expire time from settings
  const { cacheExpireMinutes, itemsPerPage } = useAppStore();
  const CACHE_TTL = cacheExpireMinutes * 60 * 1000;
  
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
    if (idx < imageFiles.length - 1) setPreviewFile(imageFiles[idx + 1]);
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
  const searchRequestId = useRef(0);
  const currentPrefixRef = useRef(currentPrefix);
  currentPrefixRef.current = currentPrefix;

  // ── Delete state ──
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [dirToDelete, setDirToDelete] = useState<string | null>(null);
  const [batchDeletePending, setBatchDeletePending] = useState(false);
  const [isDeleting, setIsDeleting]     = useState(false);

  // ── Upload state ──
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Create folder state ──
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  
  // ── Listen to upload/download progress events ──
  useEffect(() => {
    const taskMap = new Map<string, string>(); // backend task_id -> frontend task id
    const pendingPatches = new Map<string, Partial<TransferTask>>();
    let rafId = 0;

    const flushPatches = () => {
      rafId = 0;
      if (pendingPatches.size === 0) return;
      const batch = new Map(pendingPatches);
      pendingPatches.clear();
      useTransferStore.getState().batchUpdateTasks(batch);
    };

    const schedulePatch = (frontendId: string, patch: Partial<TransferTask>, immediate: boolean) => {
      const prev = pendingPatches.get(frontendId);
      pendingPatches.set(frontendId, prev ? { ...prev, ...patch } : patch);
      if (immediate) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
        flushPatches();
        return;
      }
      if (!rafId) rafId = requestAnimationFrame(flushPatches);
    };

    const ensureTask = (task_id: string, type: 'upload' | 'download', fileName: string, totalSize: number) => {
      let frontendId = taskMap.get(task_id);
      if (!frontendId) {
        frontendId = addTask({ type, fileName, totalSize });
        taskMap.set(task_id, frontendId);
      }
      return frontendId;
    };

    const unlistenUpload = listen<{
      task_id: string;
      file_name: string;
      file_path: string;
      total_size: number;
      uploaded_size: number;
      progress: number;
      status: string;
      error?: string;
    }>('upload-progress', (event) => {
      const { task_id, file_name, total_size, uploaded_size, progress, status, error } = event.payload;
      const frontendId = ensureTask(task_id, 'upload', file_name, total_size);
      // 已取消：忽略迟到进度；若实际上传已完成则仍记成功
      const existing = useTransferStore.getState().tasksById[frontendId];
      if (existing?.status === 'cancelled' && status !== 'completed' && status !== 'cancelled') {
        return;
      }

      const terminal = status === 'completed' || status === 'failed' || status === 'cancelled';
      const mappedStatus =
        status === 'completed' ? 'completed'
        : status === 'failed' ? 'failed'
        : status === 'cancelled' ? 'cancelled'
        : 'transferring';
      schedulePatch(frontendId, {
        transferredSize: uploaded_size,
        progress,
        status: mappedStatus,
        error,
        ...(terminal ? { endTime: Date.now() } : {}),
        ...(total_size > 0 ? { totalSize: total_size } : {}),
      }, terminal);
    });

    const unlistenDownload = listen<{
      task_id: string;
      file_name: string;
      url: string;
      total_size: number;
      downloaded_size: number;
      progress: number;
      status: string;
      error?: string;
    }>('download-progress', (event) => {
      const { task_id, file_name, total_size, downloaded_size, progress, status, error } = event.payload;
      const frontendId = ensureTask(task_id, 'download', file_name, total_size);
      const terminal = status === 'completed' || status === 'failed';
      schedulePatch(frontendId, {
        transferredSize: downloaded_size,
        progress,
        status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'transferring',
        error,
        ...(terminal ? { endTime: Date.now() } : {}),
        ...(total_size > 0 ? { totalSize: total_size } : {}),
      }, terminal);
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      unlistenUpload.then(f => f());
      unlistenDownload.then(f => f());
    };
  }, [addTask]);

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
      // 图片预览模式下的键盘导航
      if (previewFile) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); previewPrev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); previewNext(); }
        return;
      }
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
  }, [previewFile, previewPrev, previewNext]);

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

  const toggleSelect = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
      async (event) => {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (paths.length === 0) return;

        try {
          const classified = await invoke<[string, boolean][]>('classify_paths', { paths });
          const dirs = classified.filter(([, isDir]) => isDir).map(([p]) => p);
          const files = classified.filter(([, isDir]) => !isDir).map(([p]) => p);

          // 只拖一个文件夹 → 弹出确认窗（与「上传文件夹」一致）
          if (dirs.length === 1 && files.length === 0) {
            setFolderUploadPath(dirs[0]);
            return;
          }

          // 多个文件夹：提示一次只处理一个
          if (dirs.length > 1 && files.length === 0) {
            toast.info('请一次拖入一个文件夹');
            setFolderUploadPath(dirs[0]);
            return;
          }

          // 文件 + 文件夹混拖：文件直接上传，单个文件夹走确认窗
          if (files.length > 0) {
            handleUploadPaths(files);
          }
          if (dirs.length === 1) {
            setFolderUploadPath(dirs[0]);
          } else if (dirs.length > 1) {
            toast.info('检测到多个文件夹，请一次拖入一个以便确认内容');
          }
        } catch (err: any) {
          // 分类失败则回退为直接上传
          handleUploadPaths(paths);
        }
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

  const handleUploadPaths = async (paths: string[], relativePaths?: string[]) => {
    if (paths.length === 0) return;
    setIsUploading(true);
    setPanelOpen(true); // Open transfer panel
    
    try {
      const result: { uploaded: string[]; failed: string[] } = await invoke('upload_files', {
        ak, sk, bucket,
        filePaths: paths,
        prefix: currentPrefix,
        relativePaths: relativePaths ?? null,
      });
      
      // Only show toast for failures, progress panel shows success
      if (result.failed.length > 0) {
        toast.warning('部分文件上传失败', { description: `成功 ${result.uploaded.length} 个，失败 ${result.failed.length} 个` });
      }
      loadDirectory(currentPrefix, true);
    } catch (err: any) {
      toast.error('上传失败', { description: String(err) });
    } finally {
      setIsUploading(false);
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
    fetchBucketDomains(ak, sk, bucket)
      .then(domains => {
        setDomains(domains);
        setBucketDomains(bucket, domains);
      })
      .catch(() => setDomains([]));
  }, [ak, sk, bucket]);

  // ─── Load files whenever prefix changes ──────────────────────────────────
  const loadDirectory = useCallback(async (prefix: string, forceRefresh = false) => {
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
      const { items: newItems, folders: newFolders, nextMarker: newMarker, hasMore: newHasMore } =
        normalizeListResult(res);

      setItems(newItems);
      setFolders(newFolders);
      setNextMarker(newMarker);
      setHasMore(newHasMore);
      dirCache.current.set(prefix, { 
        items: newItems, 
        folders: newFolders, 
        nextMarker: newMarker, 
        hasMore: newHasMore,
        timestamp: Date.now()
      });
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
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

    const reqId = ++searchRequestId.current;
    inApiSearchRef.current = true;
    setCommittedSearch(q);
    setLoading(true);
    setError("");
    setSelectedKeys(new Set());
    try {
      const res = await fetchFiles(ak, sk, bucket, currentPrefixRef.current + q, "", itemsPerPage, "/");
      if (reqId !== searchRequestId.current) return;
      const normalized = normalizeListResult(res);
      setItems(normalized.items);
      setFolders(normalized.folders);
      setNextMarker(normalized.nextMarker);
      setHasMore(normalized.hasMore);
    } catch (err: any) {
      if (reqId !== searchRequestId.current) return;
      setError(err.message || "搜索失败");
    } finally {
      if (reqId === searchRequestId.current) setLoading(false);
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
      if (e.key !== 'Escape') return;
      if (previewFile) { closePreview(); return; }
      if (ctxMenu) { closeCtxMenu(); return; }
      if (selectedFile) { setSelectedFile(null); return; }
      if (searchInput || committedSearch) { clearSearch(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ctxMenu, selectedFile, searchInput, committedSearch, previewFile, clearSearch]);

  // ─── Load more (next page) ────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextMarker) return;
    setLoadingMore(true);
    const listPrefix = committedSearch ? currentPrefix + committedSearch : currentPrefix;
    const isSearch = !!committedSearch;
    try {
      const res = await fetchFiles(ak, sk, bucket, listPrefix, nextMarker, itemsPerPage, "/");
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
      toast.error("加载更多失败", { description: err.message });
    } finally {
      setLoadingMore(false);
    }
  }, [ak, sk, bucket, currentPrefix, nextMarker, hasMore, loadingMore, items, folders, itemsPerPage, committedSearch]);

  useEffect(() => {
    inApiSearchRef.current = false;
    searchRequestId.current += 1; // cancel in-flight search
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
      navigate(initialPrefix);
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
      await batchDeleteFiles(ak, sk, bucket, keys);
      toast.dismiss(tid);
      toast.success(`已删除 ${keys.length} 个文件`);
      setSelectedKeys(new Set());
      setBatchDeletePending(false);
      loadDirectory(currentPrefix, true);
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error('批量删除失败', { description: err.message });
    } finally {
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
    const dir = await open({ directory: true, title: '选择保存目录' });
    if (!dir || Array.isArray(dir)) return;
    
    setPanelOpen(true); // Open transfer panel
    
    const batchItems: [string, string][] = keys.map(key => [
      generateDownloadUrl(ak, sk, domains[0], key, isPrivateBucket),
      key.split('/').pop() || key,
    ]);
    
    try {
      const result: { downloaded: string[]; failed: string[] } = await invoke('download_files_to_dir', { items: batchItems, dir });
      
      // Only show toast for failures, progress panel shows success
      if (result.failed.length > 0) {
        toast.warning(`部分文件下载失败`, { description: `成功 ${result.downloaded.length} 个，失败 ${result.failed.length} 个` });
      }
      setSelectedKeys(new Set());
    } catch (err: any) {
      toast.error('批量下载失败', { description: String(err) });
    }
  };
  
  const handleDownloadFolder = async (folderPrefix: string) => {
    if (domains.length === 0) {
      toast.warning('此存储空间未绑定外链域名，无法下载', {
        description: '请先在「CDN → 域名」绑定域名后再试',
      });
      return;
    }
    
    const dir = await open({ directory: true, title: '选择保存目录' });
    if (!dir || Array.isArray(dir)) return;
    
    setPanelOpen(true);
    
    try {
      // Fetch all files in the folder with pagination
      let allFiles: QiniuFile[] = [];
      let marker = "";
      let hasMore = true;
      const MAX_FILES = 10000;
      
      // Show loading toast
      const loadingToast = toast.loading('正在获取文件夹内容...');
      
      while (hasMore && allFiles.length < MAX_FILES) {
        const res = await fetchFiles(ak, sk, bucket, folderPrefix, marker, 1000);
        const newFiles = res.items || [];
        allFiles = [...allFiles, ...newFiles];
        marker = res.marker || "";
        hasMore = !!res.marker;
        
        // Update loading message
        toast.loading(`已获取 ${allFiles.length} 个文件...`, { id: loadingToast });
        
        // Safety check
        if (allFiles.length >= MAX_FILES && hasMore) {
          toast.dismiss(loadingToast);
          const confirmed = confirm(
            `该文件夹包含超过 ${MAX_FILES} 个文件，下载可能需要很长时间。\n\n是否继续下载？`
          );
          if (!confirmed) return;
          break;
        }
      }
      
      toast.dismiss(loadingToast);
      
      if (allFiles.length === 0) {
        toast.info('文件夹为空');
        return;
      }
      
      // Get folder name from prefix (remove trailing slash)
      const folderName = folderPrefix.slice(0, -1).split('/').pop() || 'folder';
      
      // Create download items with folder name + relative paths
      // Filter out items that end with '/' (they are folders, not files)
      const batchItems: [string, string][] = allFiles
        .filter(file => !file.key.endsWith('/'))
        .map(file => [
          generateDownloadUrl(ak, sk, domains[0], file.key, isPrivateBucket),
          folderName + '/' + file.key.slice(folderPrefix.length), // Add folder name prefix
        ]);
      
      if (batchItems.length === 0) {
        toast.info('文件夹中没有文件');
        return;
      }
      
      // Show confirmation for large downloads
      if (batchItems.length > 100) {
        const totalSize = allFiles.reduce((sum, f) => sum + f.fsize, 0);
        const confirmed = confirm(
          `即将下载 ${batchItems.length} 个文件，总大小约 ${formatBytes(totalSize)}。\n\n是否继续？`
        );
        if (!confirmed) return;
      }
      
      const result: { downloaded: string[]; failed: string[] } = await invoke('download_files_to_dir', { items: batchItems, dir });
      
      if (result.failed.length > 0) {
        toast.warning(`部分文件下载失败`, { description: `成功 ${result.downloaded.length} 个，失败 ${result.failed.length} 个` });
      }
    } catch (err: any) {
      toast.error('下载文件夹失败', { description: String(err) });
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
      
      if (directory && paths.length > 0) {
        // Show folder upload dialog
        setFolderUploadPath(paths[0]);
      } else if (paths.length > 0) {
        // Direct upload for files
        handleUploadPaths(paths);
      }
    } catch (err: any) {
      toast.error("打开文件对话框失败", { description: err.message });
    }
  };
  
  const handleFolderUploadConfirm = (selectedFiles: { path: string; relativePath: string }[]) => {
    setFolderUploadPath(null);
    if (selectedFiles.length > 0) {
      handleUploadPaths(
        selectedFiles.map((f) => f.path),
        selectedFiles.map((f) => f.relativePath),
      );
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
      toast.dismiss(tid);
      toast.success("目录已彻底删除", { description: prefix });
      setDirToDelete(null);
      // reload current directory to reflect changes
      loadDirectory(currentPrefix, true);
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error("删除目录失败", { description: err.message });
    } finally {
      setIsDeleting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white dark:bg-zinc-950">

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
                  placeholder="前缀过滤…"
                  aria-label="按路径前缀过滤"
                  title="匹配当前目录下的 key 前缀，区分大小写，输入后自动过滤"
                  className="pl-8 pr-14"
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
                    <button
                      type="button"
                      onClick={() => clearSearch()}
                      className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      aria-label="清除过滤"
                    >
                      <X className="size-3" />
                    </button>
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
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-accent dark:text-zinc-200"
                    onClick={() => { setUploadMenuOpen(false); handleUpload(false); }}
                  >
                    <Upload className="size-4 text-muted-foreground" />
                    上传文件
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-700 transition-colors hover:bg-accent dark:text-zinc-200"
                    onClick={() => { setUploadMenuOpen(false); handleUpload(true); }}
                  >
                    <FolderOpen className="size-4 text-muted-foreground" />
                    上传文件夹
                  </button>
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
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            空间列表
          </button>
          <ChevronRight className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
          <button
            type="button"
            onClick={() => navigateToBreadcrumb(-1)}
            className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors ${breadcrumbs.length === 0 ? "font-semibold text-zinc-900 dark:text-zinc-100" : "font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"}`}
          >
            <Database className="size-3.5 shrink-0 text-emerald-500" />
            <span>{bucket}</span>
          </button>
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
                    <button type="button" onClick={() => navigateToBreadcrumb(i)}
                      className="whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
                      {seg}
                    </button>
                  </span>
                ))}
                {collapsed && (
                  <span className="relative flex shrink-0 items-center">
                    <ChevronRight className="size-3.5 text-zinc-300 dark:text-zinc-600" />
                    <button
                      type="button"
                      onClick={() => setBreadcrumbMenuOpen(o => !o)}
                      className="rounded-md px-2 py-1 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >…</button>
                    {breadcrumbMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setBreadcrumbMenuOpen(false)} />
                        <div className="absolute top-full left-0 z-50 mt-1 max-h-64 min-w-36 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                          {hiddenMiddle.map((seg, i) => (
                            <button key={i} type="button"
                              onClick={() => { navigateToBreadcrumb(i); setBreadcrumbMenuOpen(false); }}
                              className="w-full truncate px-3 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >{seg}</button>
                          ))}
                        </div>
                      </>
                    )}
                  </span>
                )}
                {visibleTail.map((seg, relIdx) => {
                  const i = collapsed ? breadcrumbs.length - SHOW_TAIL + relIdx : breadcrumbs.length - 1;
                  const isLast = relIdx === visibleTail.length - 1;
                  return (
                    <span key={i} className="flex min-w-0 shrink-0 items-center">
                      <ChevronRight className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" />
                      <button
                        type="button"
                        onClick={() => navigateToBreadcrumb(i)}
                        className={`max-w-[240px] truncate rounded-md px-2 py-1 text-sm transition-colors ${
                          isLast
                            ? "font-semibold text-zinc-900 dark:text-zinc-100"
                            : "font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                        }`}
                        title={seg}
                      >{seg}</button>
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
            <div className="mb-4 break-all rounded bg-red-100/50 p-2 font-mono text-xs dark:bg-red-900/20">{error}</div>
            <Button variant="outline" size="sm" onClick={() => refreshCurrentView(true)}>重试</Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-16 text-center">
            <Folder className="size-8 text-zinc-300 dark:text-zinc-600" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                {committedSearch
                  ? "没有匹配的前缀结果"
                  : currentPrefix ? "该文件夹是空的" : "空间中没有文件"}
              </p>
              <p className="max-w-xs text-xs text-zinc-400 dark:text-zinc-500">
                {committedSearch
                  ? "搜索只匹配路径前缀，例如 images/ 或 images/logo"
                  : "上传文件后即可在此管理"}
              </p>
            </div>
          </div>
        ) : (
          <div ref={scrollContainerRef} className="h-full overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80">
                <tr>
                  <th className="h-10 w-10 whitespace-nowrap px-2 pl-4 text-left align-middle">
                    <button type="button" onClick={toggleSelectAll} className="p-0.5 text-zinc-400 transition-colors hover:text-emerald-500" aria-label="全选">
                      {allSelected
                        ? <CheckSquare className="size-4 shrink-0 text-emerald-500" />
                        : <Square className="size-4 shrink-0" />}
                    </button>
                  </th>
                  <th className="h-10 cursor-pointer select-none whitespace-nowrap px-2 pl-1 text-left align-middle text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/50" onClick={() => cycleSort("name")}>
                    <span className="inline-flex items-center">名称<SortIcon field="name" /></span>
                  </th>
                  <th className="h-10 w-28 cursor-pointer select-none whitespace-nowrap px-2 text-left align-middle text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/50" onClick={() => cycleSort("size")}>
                    <span className="inline-flex items-center">大小<SortIcon field="size" /></span>
                  </th>
                  <th className="hidden h-10 w-52 whitespace-nowrap px-2 text-left align-middle text-xs font-medium text-zinc-500 md:table-cell dark:text-zinc-400">类型</th>
                  <th className="hidden h-10 w-44 cursor-pointer select-none whitespace-nowrap px-2 text-left align-middle text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 lg:table-cell dark:text-zinc-400 dark:hover:bg-zinc-800/50" onClick={() => cycleSort("time")}>
                    <span className="inline-flex items-center">修改时间<SortIcon field="time" /></span>
                  </th>
                  <th className="h-10 w-36 whitespace-nowrap px-2 pr-5 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400" />
                </tr>
              </thead>
            </table>

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
                        <span className="min-w-0 w-full truncate font-medium text-zinc-800 transition-colors group-hover:text-emerald-600 dark:text-zinc-100 dark:group-hover:text-emerald-400">
                          <HighlightText text={entry.name} query={committedSearch} />
                        </span>
                      </div>
                      <div className="w-28 shrink-0 text-xs text-zinc-400">—</div>
                      <div className="hidden w-52 shrink-0 text-xs text-zinc-500 md:block dark:text-zinc-400">文件夹</div>
                      <div className="hidden w-44 shrink-0 text-xs text-zinc-400 lg:block">—</div>
                      <div className="w-36 shrink-0 pr-5">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
                    <div className="w-10 shrink-0 pl-4" onClick={e => toggleSelect(file.key, e)}>
                      <button type="button" className="p-0.5 text-zinc-400 transition-colors hover:text-emerald-500" aria-label={isChecked ? "取消选择" : "选择"}>
                        {isChecked
                          ? <CheckSquare className="size-4 shrink-0 text-emerald-500" />
                          : <Square className="size-4 shrink-0 opacity-0 group-hover:opacity-100" />}
                      </button>
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
                      {getFileIcon(file.mimeType)}
                      {isRenaming ? (
                        <input autoFocus value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(file.key)}
                          onKeyDown={e => { if (e.key === "Enter") commitRename(file.key); if (e.key === "Escape") setRenamingKey(null); }}
                          onClick={e => e.stopPropagation()}
                          className="file-name-input min-w-0 w-full flex-1 rounded border border-emerald-400 bg-white px-2 py-0.5 text-sm text-zinc-800 outline-none focus:ring-2 focus:ring-emerald-400/40 dark:border-emerald-600 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      ) : (
                        <>
                          <span className="min-w-0 truncate text-zinc-800 transition-colors group-hover:text-emerald-600 dark:text-zinc-100 dark:group-hover:text-emerald-400" title={file.key}>
                            <HighlightText text={entry.name} query={committedSearch} />
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { void handleCopyFileName(e, file.key); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            title="复制文件名"
                            aria-label={`复制文件名：${file.key.slice(file.key.lastIndexOf("/") + 1)}`}
                            className="shrink-0 rounded p-1 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-600 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                          >
                            <Copy className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                    <div className="w-28 shrink-0 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatBytes(file.fsize)}</div>
                    <div className="hidden w-52 shrink-0 truncate text-xs text-zinc-500 md:block dark:text-zinc-400">{file.mimeType || "—"}</div>
                    <div className="hidden w-44 shrink-0 font-mono text-xs tabular-nums text-zinc-500 lg:block dark:text-zinc-400">{formatQiniuTime(file.putTime)}</div>
                    <div className="w-36 shrink-0 pr-5">
                      <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
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
                  : <span className="text-zinc-300 dark:text-zinc-600">向下滚动加载更多</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Context Menu ── */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-50 cursor-pointer" onClick={closeCtxMenu} onContextMenu={e => { e.preventDefault(); closeCtxMenu(); }} />
          <div
            className="fixed z-50 min-w-44 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 py-1 overflow-hidden"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              onClick={() => { setSelectedFile(ctxMenu.file); closeCtxMenu(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <File className="w-4 h-4 text-zinc-400" />文件详情
            </button>
            <button
              onClick={(e) => { startRename(e, ctxMenu.file); closeCtxMenu(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Pencil className="w-4 h-4 text-zinc-400" />重命名
            </button>
            <button
              onClick={(e) => { void handleCopyFileName(e, ctxMenu.file.key); closeCtxMenu(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Copy className="w-4 h-4 text-zinc-400" />复制文件名
            </button>
            <button
              onClick={(e) => { handleCopyLink(e, ctxMenu.file.key); closeCtxMenu(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Link2 className="w-4 h-4 text-zinc-400" />复制链接
            </button>
            <button
              onClick={() => { handleDownload(ctxMenu.file.key); closeCtxMenu(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Download className="w-4 h-4 text-zinc-400" />下载
            </button>
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
            <button
              onClick={() => { setFileToDelete(ctxMenu.file.key); closeCtxMenu(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />删除
            </button>
          </div>
        </>
      )}

      {/* ── File Detail Drawer ── */}
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-30 transition-opacity duration-200 cursor-pointer ${selectedFile ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'transparent' }}
        onClick={() => setSelectedFile(null)}
      />
      {/* Panel */}
      <div
        className={`absolute top-0 right-0 h-full w-80 z-40 flex flex-col bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl transition-transform duration-250 ease-in-out ${selectedFile ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {selectedFile && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <div className="shrink-0">{getFileIcon(selectedFile.mimeType)}</div>
              <p className="flex-1 font-semibold text-zinc-800 dark:text-zinc-100 text-sm truncate" title={selectedFile.key}>
                {selectedFile.key.split('/').pop() || selectedFile.key}
              </p>
              <button
                onClick={() => setSelectedFile(null)}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
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
              <button
                onClick={(e) => { void handleCopyFileName(e, selectedFile.key); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                <Copy className="w-4 h-4" />复制文件名
              </button>
              <button
                onClick={(e) => { handleCopyLink(e, selectedFile.key); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
              >
                {copiedKey === selectedFile.key
                  ? <><Check className="w-4 h-4" />已复制链接</>
                  : <><Link2 className="w-4 h-4" />复制访问链接</>}
              </button>
              <button
                onClick={() => handleDownload(selectedFile.key)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
              >
                <Download className="w-4 h-4" />下载文件
              </button>
              <button
                onClick={() => { setFileToDelete(selectedFile.key); setSelectedFile(null); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              >
                <Trash2 className="w-4 h-4" />删除文件
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Image Preview Modal ── */}
      {previewFile && domains.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={closePreview}
        >
          {/* Close */}
          <button
            onClick={closePreview}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Counter */}
          {imageFiles.length > 1 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/50 text-white text-xs">
              {imageFiles.findIndex(f => f.key === previewFile.key) + 1} / {imageFiles.length}
            </div>
          )}

          {/* Prev */}
          {imageFiles.findIndex(f => f.key === previewFile.key) > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); previewPrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10 cursor-pointer"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Next */}
          {imageFiles.findIndex(f => f.key === previewFile.key) < imageFiles.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); previewNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10 cursor-pointer"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Image */}
          <img
            src={generateDownloadUrl(ak, sk, domains[0], previewFile.key, isPrivateBucket)}
            alt={previewFile.key}
            className="max-w-[90vw] max-h-[90vh] object-contain select-none"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />

          {/* Filename */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/50 text-white text-xs max-w-[80vw] truncate text-center">
            {previewFile.key.split('/').pop()}
          </div>
        </div>
      )}

      {/* ── Create Folder Modal ── */}
      {showCreateFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 mx-4">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                <FolderPlus className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">新建文件夹</h3>
                {currentPrefix && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5 truncate max-w-[220px]">
                    位置：{currentPrefix}
                  </p>
                )}
              </div>
            </div>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') { setShowCreateFolder(false); setNewFolderName(""); }
              }}
              placeholder="输入文件夹名称"
              className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 mb-5"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowCreateFolder(false); setNewFolderName(""); }}
                disabled={isCreatingFolder}
                className="flex-1 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCreatingFolder
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />创建中...</>
                  : '确认创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      {(fileToDelete || dirToDelete || batchDeletePending) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 text-center mx-4">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
              <Trash2 className="h-6 w-6 text-red-600 dark:text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">确认删除？</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 break-all">
              {batchDeletePending ? (
                <>
                  <strong className="text-red-500 block mb-1">将删除已选的 {selectedKeys.size} 个文件</strong>
                  删除后将无法恢复
                </>
              ) : (
                <>
                  <strong className="text-red-500 block mb-1">{fileToDelete || dirToDelete}</strong>
                  {dirToDelete ? "该目录下的所有文件都将被彻底删除，并且无法恢复" : "删除后将无法恢复"}
                </>
              )}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  if (batchDeletePending) handleBatchDelete();
                  else if (dirToDelete) executeDeleteDirectory(dirToDelete);
                  else executeDeleteFile(fileToDelete!);
                }}
                disabled={isDeleting}
                className="w-full px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />删除中...</>
                  : "确认删除"}
              </button>
              <button
                onClick={() => {
                  if (!isDeleting) {
                    setFileToDelete(null);
                    setDirToDelete(null);
                    setBatchDeletePending(false);
                  }
                }}
                disabled={isDeleting}
                className="w-full px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Folder Upload Dialog */}
      {folderUploadPath && (
        <FolderUploadDialog
          folderPath={folderUploadPath}
          onConfirm={handleFolderUploadConfirm}
          onCancel={() => setFolderUploadPath(null)}
        />
      )}

      {/* ── Bookmark Dialog ── */}
      {showBookmarkDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={isEditingBookmark ? handleBookmarkDone : handleBookmarkCancel}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-4 text-base font-bold text-zinc-800 dark:text-zinc-100">
              {isEditingBookmark ? "修改书签" : "添加书签"}
            </h3>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">名称</label>
            <div className="relative mb-3">
              <input
                autoFocus
                type="text"
                value={bookmarkLabel}
                onChange={e => setBookmarkLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleBookmarkDone();
                  if (e.key === "Escape") {
                    if (isEditingBookmark) handleBookmarkDone();
                    else handleBookmarkCancel();
                  }
                }}
                placeholder="书签名称"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 pl-3 pr-8 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-600"
              />
              {bookmarkLabel && (
                <button
                  type="button"
                  onClick={() => setBookmarkLabel("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label="清除名称"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <p
              className="mb-5 min-w-0 break-all font-mono text-xs text-zinc-400 dark:text-zinc-500"
              title={`${bucket}${currentPrefix ? "/" + currentPrefix.replace(/\/$/, "") : ""}`}
            >
              {bucket}{currentPrefix ? "/" + currentPrefix.replace(/\/$/, "") : ""}
            </p>
            <div className="flex gap-2">
              {isEditingBookmark ? (
                <button
                  type="button"
                  onClick={handleBookmarkRemove}
                  className="flex-1 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  移除
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBookmarkCancel}
                  className="flex-1 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                >
                  取消
                </button>
              )}
              <button
                type="button"
                onClick={handleBookmarkDone}
                className="flex-1 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
