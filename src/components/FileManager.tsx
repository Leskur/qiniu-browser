import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fetchFiles, fetchBucketDomains, QiniuFile, deleteFile, deleteDirectory, generateDownloadUrl, batchDeleteFiles, renameFile, createFolder } from "../lib/qiniu";
import { Skeleton } from "./ui/skeleton";
import {
  File, Image, Film, FileText, Archive,
  Link2, Check, RefreshCw, Trash2, Upload, FolderOpen,
  Folder, ChevronRight, AlertCircle, Database, Download, X, Square, CheckSquare, ArrowUpDown, ArrowUp, ArrowDown, Pencil, ArrowLeft, ArrowRight,
  HardDrive, FileBox, Search, FolderPlus, ZoomIn, ChevronLeft, Maximize2, Bookmark
} from "lucide-react";
import { toast } from "sonner";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { FolderUploadDialog } from "./FolderUploadDialog";
import { useTransferStore } from "../store/transfer";
import { useAppStore } from "../store";

export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function formatQiniuTime(putTime: number) {
  const date = new Date(putTime / 10000);
  return date.toLocaleString();
}

export function getFileIcon(mimeType: string) {
  if (mimeType?.startsWith('image/')) return <Image className="w-4 h-4 text-emerald-500" />;
  if (mimeType?.startsWith('video/')) return <Film className="w-4 h-4 text-purple-500" />;
  if (mimeType?.startsWith('text/')) return <FileText className="w-4 h-4 text-blue-400" />;
  if (mimeType?.includes('zip') || mimeType?.includes('tar') || mimeType?.includes('rar')) return <Archive className="w-4 h-4 text-amber-500" />;
  return <File className="w-4 h-4 text-zinc-400" />;
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

export function FileManager({ ak, sk, bucket, onBack, refreshTrigger, initialPrefix, onInitialPrefixUsed }: {
  ak: string; sk: string; bucket: string; onBack: () => void; refreshTrigger?: number;
  initialPrefix?: string; onInitialPrefixUsed?: () => void;
}) {
  const [domains, setDomains] = useState<string[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  
  // Transfer store
  const { addTask, updateTask, setPanelOpen } = useTransferStore();

  // Bucket stats from global store
  const { buckets } = useAppStore();
  const bucketInfo = buckets.find(b => b.tbl === bucket);
  
  // Folder upload dialog
  const [folderUploadPath, setFolderUploadPath] = useState<string | null>(null);

  // ── Virtual folder navigation + history ──
  const [currentPrefix, setCurrentPrefix] = useState("");
  const [navHistory, setNavHistory] = useState<string[]>([""]);  // visited prefixes
  const [navIndex, setNavIndex] = useState(0);                    // current position

  const canGoBack    = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

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
      // Already at root and can't go back further, return to bucket list
      if (currentPrefix === "") {
        onBack();
      }
      return;
    }
    const target = navHistory[navIndex - 1];
    setNavIndex(i => i - 1);
    setCurrentPrefix(target);
  }, [canGoBack, navHistory, navIndex, currentPrefix, onBack]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    const target = navHistory[navIndex + 1];
    setNavIndex(i => i + 1);
    setCurrentPrefix(target);
  }, [canGoForward, navHistory, navIndex]);

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
    const menuW = 176, menuH = 200;
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX;
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY;
    setCtxMenu({ file, x, y });
  };

  const closeCtxMenu = () => setCtxMenu(null);

  // ── Search state ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewFile) { closePreview(); return; }
      if (ctxMenu) { closeCtxMenu(); return; }
      if (selectedFile) { setSelectedFile(null); return; }
      if (searchActive) { setSearchQuery(""); setSearchActive(false); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ctxMenu, selectedFile, searchActive, previewFile]);

  // ── Delete state ──
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [dirToDelete, setDirToDelete] = useState<string | null>(null);
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
      console.log('[upload-progress]', { task_id, file_name, status, progress, uploaded_size, total_size });
      
      if (!taskMap.has(task_id)) {
        // New upload task
        const frontendId = addTask({
          type: 'upload',
          fileName: file_name,
          totalSize: total_size,
        });
        console.log('[upload-progress] created task', { backendId: task_id, frontendId });
        taskMap.set(task_id, frontendId);
      }
      
      const frontendId = taskMap.get(task_id);
      if (frontendId) {
        console.log('[upload-progress] updating task', { frontendId, status, progress });
        updateTask(frontendId, {
          transferredSize: uploaded_size,
          progress,
          status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'transferring',
          error,
          endTime: status === 'completed' || status === 'failed' ? Date.now() : undefined,
        });
      }
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
      console.log('[download-progress]', { task_id, file_name, status, progress, downloaded_size, total_size });
      
      if (!taskMap.has(task_id)) {
        // New download task
        const frontendId = addTask({
          type: 'download',
          fileName: file_name,
          totalSize: total_size,
        });
        console.log('[download-progress] created task', { backendId: task_id, frontendId });
        taskMap.set(task_id, frontendId);
      }
      
      const frontendId = taskMap.get(task_id);
      if (frontendId) {
        console.log('[download-progress] updating task', { frontendId, status, progress });
        updateTask(frontendId, {
          transferredSize: downloaded_size,
          progress,
          status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'transferring',
          error,
          endTime: status === 'completed' || status === 'failed' ? Date.now() : undefined,
        });
      }
    });
    
    return () => {
      unlistenUpload.then(f => f());
      unlistenDownload.then(f => f());
    };
  }, [addTask, updateTask]);

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
            setSearchActive(true);
            setTimeout(() => searchInputRef.current?.focus(), 50);
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
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
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
      (event) => {
        setIsDragOver(false);
        const paths = event.payload.paths;
        if (paths.length > 0) handleUploadPaths(paths);
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

  const handleUploadPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    setIsUploading(true);
    setPanelOpen(true); // Open transfer panel
    
    try {
      const result: { uploaded: string[]; failed: string[] } = await invoke('upload_files', { ak, sk, bucket, filePaths: paths, prefix: currentPrefix });
      
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
    if (domains.length === 0) { toast.warning("此存储空间未绑定外链域名，无法下载"); return; }
    const filename = key.split('/').pop() || key;
    const savePath = await save({
      title: "保存文件",
      defaultPath: filename,
    });
    if (!savePath) return;
    const url = generateDownloadUrl(ak, sk, domains[0], key);
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
      // 过滤掉文件夹占位符（key 以 / 结尾的空文件）
      const newItems = (res.items || []).filter(item => !item.key.endsWith('/'));
      const newFolders = res.commonPrefixes || [];
      const newMarker = res.marker || "";
      const newHasMore = !!res.marker;

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
  }, [ak, sk, bucket, CACHE_TTL]);

  // ─── Load more (next page) ────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextMarker) return;
    setLoadingMore(true);
    try {
      const res = await fetchFiles(ak, sk, bucket, currentPrefix, nextMarker, itemsPerPage, "/");
      // 过滤掉文件夹占位符（key 以 / 结尾的空文件）
      const moreItems = (res.items || []).filter(item => !item.key.endsWith('/'));
      const moreFolders = res.commonPrefixes || [];
      const newMarker = res.marker || "";
      const newHasMore = !!res.marker;

      setItems(prev => [...prev, ...moreItems]);
      setFolders(prev => {
        // merge without duplicates
        const existing = new Set(prev);
        return [...prev, ...moreFolders.filter(f => !existing.has(f))];
      });
      setNextMarker(newMarker);
      setHasMore(newHasMore);
      // Update cache with timestamp
      dirCache.current.set(currentPrefix, {
        items: [...items, ...moreItems],
        folders: [...new Set([...folders, ...moreFolders])],
        nextMarker: newMarker,
        hasMore: newHasMore,
        timestamp: Date.now()
      });
    } catch (err: any) {
      toast.error("加载更多失败", { description: err.message });
    } finally {
      setLoadingMore(false);
    }
  }, [ak, sk, bucket, currentPrefix, nextMarker, hasMore, loadingMore, items, folders]);

  useEffect(() => {
    loadDirectory(currentPrefix);
    setSearchQuery("");   // clear search when navigating
    setSearchActive(false);
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
    const q = searchQuery.trim().toLowerCase();
    const folders = entries.filter(e => e.type === 'folder');
    const files = entries.filter(e => e.type === 'file') as { type: 'file'; name: string; file: QiniuFile }[];
    
    // Apply search filter
    const filteredFolders = q
      ? folders.filter(e => e.name.toLowerCase().includes(q))
      : folders;
    const filteredFiles = q
      ? files.filter(e => e.name.toLowerCase().includes(q))
      : files;
    
    const sorted = [...filteredFiles].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'size') cmp = a.file.fsize - b.file.fsize;
      else if (sortField === 'time') cmp = a.file.putTime - b.file.putTime;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return [...filteredFolders, ...sorted];
  }, [entries, sortField, sortDir, searchQuery]);

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
      loadDirectory(currentPrefix, true);
      toast.success('已刷新文件列表');
    }
  }, [refreshTrigger]);

  // ── 书签：从外部跳转到指定 prefix ──
  const addBookmark = useAppStore((s) => s.addBookmark);
  const bookmarkList = useAppStore((s) => s.bookmarks[ak]) ?? [];
  const [showBookmarkDialog, setShowBookmarkDialog] = useState(false);
  const [bookmarkLabel, setBookmarkLabel] = useState("");

  useEffect(() => {
    if (initialPrefix !== undefined && initialPrefix !== "") {
      navigate(initialPrefix);
      onInitialPrefixUsed?.();
    }
  }, [initialPrefix]);

  const handleAddBookmark = () => {
    const label = bookmarkLabel.trim() || (currentPrefix ? `${bucket}/${currentPrefix.replace(/\/$/, "")}` : bucket);
    addBookmark(ak, { bucket, prefix: currentPrefix, label });
    toast.success("书签已添加", { description: label });
    setShowBookmarkDialog(false);
    setBookmarkLabel("");
  };

  const isCurrentBookmarked = useMemo(() => {
    return bookmarkList.some(b => b.bucket === bucket && b.prefix === currentPrefix);
  }, [bookmarkList, bucket, currentPrefix]);

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
    const tid = toast.loading(`正在删除 ${keys.length} 个文件...`, { duration: Infinity });
    try {
      await batchDeleteFiles(ak, sk, bucket, keys);
      toast.dismiss(tid);
      toast.success(`已删除 ${keys.length} 个文件`);
      setSelectedKeys(new Set());
      loadDirectory(currentPrefix, true);
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error('批量删除失败', { description: err.message });
    }
  };

  const handleBatchDownload = async () => {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    if (domains.length === 0) { toast.warning('此存储空间未绑定外链域名，无法下载'); return; }
    const dir = await open({ directory: true, title: '选择保存目录' });
    if (!dir || Array.isArray(dir)) return;
    
    setPanelOpen(true); // Open transfer panel
    
    const batchItems: [string, string][] = keys.map(key => [
      generateDownloadUrl(ak, sk, domains[0], key),
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
    if (domains.length === 0) { toast.warning('此存储空间未绑定外链域名，无法下载'); return; }
    
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
          generateDownloadUrl(ak, sk, domains[0], file.key),
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

  // ─── Copy link ───────────────────────────────────────────────────────────
  const handleCopyLink = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    if (domains.length === 0) { toast.warning("此存储空间未绑定外链域名"); return; }
    let domain = domains[0];
    if (!domain.startsWith("http")) domain = "http://" + domain;
    const url = `${domain}/${encodeURI(key)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedKey(key);
      toast.success("已复制到剪贴板");
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
  
  const handleFolderUploadConfirm = (selectedFiles: string[]) => {
    setFolderUploadPath(null);
    if (selectedFiles.length > 0) {
      handleUploadPaths(selectedFiles);
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
    <div className="relative flex flex-col h-full bg-white dark:bg-zinc-950 overflow-hidden">

      {/* ── Top Bar ── */}
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm shrink-0 min-w-0 relative z-20">
        <button onClick={goBack} disabled={!canGoBack} title="后退（鼠标侧键）"
          className="p-1.5 rounded-lg transition-colors text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95 shrink-0 disabled:opacity-30 disabled:pointer-events-none cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button onClick={goForward} disabled={!canGoForward} title="前进（鼠标侧键）"
          className="p-1.5 rounded-lg transition-colors text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95 shrink-0 disabled:opacity-30 disabled:pointer-events-none cursor-pointer">
          <ArrowRight className="w-4 h-4" />
        </button>

        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden">
          <button onClick={onBack} className="text-sm font-medium text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800 transition-colors shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 cursor-pointer">
            空间管理
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" />
          <button
            onClick={() => navigateToBreadcrumb(-1)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${breadcrumbs.length === 0 ? 'font-semibold text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800/70' : 'font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
          >
            <Database className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="truncate max-w-[120px]">{bucket}</span>
          </button>
          {breadcrumbs.length > 0 && (() => {
            const SHOW_TAIL = 2;
            const collapsed = breadcrumbs.length > SHOW_TAIL + 1;
            const visibleHead = collapsed ? [] : breadcrumbs.slice(0, -1);
            const visibleTail = collapsed ? breadcrumbs.slice(-SHOW_TAIL) : [breadcrumbs[breadcrumbs.length - 1]];
            const hiddenMiddle = collapsed ? breadcrumbs.slice(0, -SHOW_TAIL) : [];
            return (
              <>
                {visibleHead.map((seg, i) => (
                  <span key={i} className="flex items-center shrink-0">
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600" />
                    <button onClick={() => navigateToBreadcrumb(i)}
                      className="px-2 py-1 rounded-md text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap">
                      {seg}
                    </button>
                  </span>
                ))}
                {collapsed && (
                  <span className="flex items-center shrink-0 relative">
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600" />
                    <button
                      onClick={() => setBreadcrumbMenuOpen(o => !o)}
                      className="px-2 py-1 rounded-md text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                    >…</button>
                    {breadcrumbMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setBreadcrumbMenuOpen(false)} />
                        <div className="absolute top-full left-0 mt-1 z-50 min-w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl py-1">
                          {hiddenMiddle.map((seg, i) => (
                            <button key={i}
                              onClick={() => { navigateToBreadcrumb(i); setBreadcrumbMenuOpen(false); }}
                              className="w-full text-left px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors truncate"
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
                    <span key={i} className="flex items-center min-w-0">
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" />
                      <button
                        onClick={() => navigateToBreadcrumb(i)}
                        className={`px-2 py-1 rounded-md text-sm transition-colors whitespace-nowrap ${
                          isLast
                            ? 'font-semibold text-zinc-900 dark:text-zinc-100 bg-zinc-200/70 dark:bg-zinc-800/70 truncate max-w-[160px]'
                            : 'font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 shrink-0'
                        }`}
                        title={isLast ? seg : undefined}
                      >{seg}</button>
                    </span>
                  );
                })}
              </>
            );
          })()}
        </div>

        {/* Batch action bar (replaces upload buttons when items selected) */}
        {someSelected ? (
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              已选 <strong className="text-zinc-700 dark:text-zinc-200">{selectedKeys.size}</strong> 项
            </span>
            <button
              onClick={handleBatchDownload}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />批量下载
            </button>
            <button
              onClick={handleBatchDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />批量删除
            </button>
            <button
              onClick={() => setSelectedKeys(new Set())}
              className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
              title="取消选择"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <button
            onClick={() => {
              const now = Date.now();
              if (now - lastRefreshTime < REFRESH_COOLDOWN) {
                toast.info('刷新太频繁，请稍后再试');
                return;
              }
              setLastRefreshTime(now);
              loadDirectory(currentPrefix, true);
            }}
            disabled={loading}
            title="刷新"
            className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => {
              setSearchActive(true);
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            title="搜索 (Ctrl+F)"
            className={`p-2 rounded-lg transition-colors ${searchActive || searchQuery ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800'}`}
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isCurrentBookmarked) {
                toast.info("当前位置已在书签中");
                return;
              }
              setBookmarkLabel("");
              setShowBookmarkDialog(true);
            }}
            title="添加书签"
            className={`p-2 rounded-lg transition-colors ${isCurrentBookmarked ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800'}`}
          >
            <Bookmark className="w-4 h-4" fill={isCurrentBookmarked ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => handleUpload(false)}
            disabled={isUploading || loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 rounded-lg transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none"
          >
            {isUploading
              ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Upload className="w-4 h-4" />}
            上传文件
          </button>
          <button
            onClick={() => handleUpload(true)}
            disabled={isUploading || loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 rounded-lg transition-all disabled:opacity-50 disabled:pointer-events-none"
          >
            <FolderOpen className="w-4 h-4" />
            上传文件夹
          </button>
          <button
            onClick={() => { setShowCreateFolder(true); setNewFolderName(""); }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 rounded-lg transition-all disabled:opacity-50 disabled:pointer-events-none"
            title="新建文件夹"
          >
            <FolderPlus className="w-4 h-4" />
            新建文件夹
          </button>
        </div>
        )}
      </div>

      {/* ── Stats Bar ── */}
      {!loading && !someSelected && (bucketInfo || items.length > 0) && (
        <div className="flex items-center gap-4 px-6 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 text-xs text-zinc-400 dark:text-zinc-500 tabular-nums shrink-0">
          {bucketInfo ? (
            <>
              <span className="flex items-center gap-1">
                <FileBox className="w-3.5 h-3.5" />
                {bucketInfo.file_num.toLocaleString()} 个文件
              </span>
              <span className="flex items-center gap-1">
                <HardDrive className="w-3.5 h-3.5" />
                {formatBytes(bucketInfo.storage_size)}
              </span>
            </>
          ) : (
            <span>{items.length} 项</span>
          )}
        </div>
      )}

      {/* ── Search Bar ── */}
      {searchActive && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/40 shrink-0">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索当前目录文件名..."
            className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 outline-none"
            onKeyDown={e => {
              if (e.key === 'Escape') { setSearchQuery(""); setSearchActive(false); }
            }}
          />
          {searchQuery && (
            <span className="text-xs text-zinc-400 tabular-nums shrink-0">
              {sortedEntries.length} 个结果
            </span>
          )}
          <button
            onClick={() => { setSearchQuery(""); setSearchActive(false); }}
            className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <div className="flex-1 overflow-hidden relative">
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-emerald-50/90 dark:bg-emerald-950/80 border-2 border-dashed border-emerald-400 dark:border-emerald-500 rounded-none pointer-events-none">
            <Upload className="w-12 h-12 text-emerald-500" />
            <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">松开以上传到当前目录</p>
            <p className="text-sm text-emerald-600 dark:text-emerald-400 opacity-70">{currentPrefix || bucket}</p>
          </div>
        )}
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full dark:bg-zinc-800/50" style={{ opacity: 1 - i * 0.08 }} />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-12 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
            <p className="text-red-500 font-medium">加载失败</p>
            <p className="text-sm text-zinc-400 mt-1">{error}</p>
            <button
              onClick={() => loadDirectory(currentPrefix, true)}
              className="mt-4 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-sm hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >重试</button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-20 text-center text-zinc-400">
            <Folder className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium text-zinc-500">
              {currentPrefix ? "该文件夹是空的" : "空间中没有文件"}
            </p>
            <p className="text-sm mt-1">上传一些文件来开始吧</p>
          </div>
        ) : (
          <div ref={scrollContainerRef} className="h-full overflow-y-auto">
            {/* Sticky header */}
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 shadow-sm">
                <tr>
                  <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap pl-4 w-10">
                    <button onClick={toggleSelectAll} className="p-0.5 text-zinc-400 hover:text-emerald-500 transition-colors">
                      {allSelected
                        ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                        : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap pl-1">
                    <button onClick={() => cycleSort('name')} className="flex items-center text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
                      名称<SortIcon field="name" />
                    </button>
                  </th>
                  <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap w-28">
                    <button onClick={() => cycleSort('size')} className="flex items-center text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
                      大小<SortIcon field="size" />
                    </button>
                  </th>
                  <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap w-52 hidden md:table-cell text-xs font-semibold text-zinc-500">类型</th>
                  <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap w-44 hidden lg:table-cell">
                    <button onClick={() => cycleSort('time')} className="flex items-center text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
                      修改时间<SortIcon field="time" />
                    </button>
                  </th>
                  <th className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-right pr-5 w-44 text-xs font-semibold text-zinc-500">操作</th>
                </tr>
              </thead>
            </table>

            {/* Virtual rows */}
            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map(virtualRow => {
                const entry = sortedEntries[virtualRow.index];
                const rowStyle: React.CSSProperties = {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                };

                if (entry.type === 'folder') {
                  return (
                    <div
                      key={`d:${entry.prefix}`}
                      style={rowStyle}
                      className={`group flex items-center cursor-pointer border-b border-zinc-100 dark:border-zinc-800/60 hover:bg-amber-50/40 dark:hover:bg-amber-900/10 transition-colors text-sm ${dirToDelete === entry.prefix && isDeleting ? 'opacity-40 pointer-events-none' : ''}`}
                      onClick={() => navigateToFolder(entry.prefix)}
                    >
                      <div className="pl-4 w-10 shrink-0" />
                      <div className="flex-1 pl-1 flex items-center gap-3 min-w-0">
                        <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="font-medium text-zinc-700 dark:text-zinc-200 truncate">
                          <HighlightText text={entry.name} query={searchQuery} />
                        </span>
                      </div>
                      <div className="w-28 shrink-0 text-zinc-400">—</div>
                      <div className="w-52 shrink-0 hidden md:block">
                        <span className="bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded text-xs font-medium">文件夹</span>
                      </div>
                      <div className="w-44 shrink-0 hidden lg:block text-zinc-400">—</div>
                      <div className="w-44 shrink-0 pr-5">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); handleDownloadFolder(entry.prefix); }}
                            className="p-1.5 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded" title="下载整个文件夹">
                            <Download className="w-4 h-4" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setDirToDelete(entry.prefix); }}
                            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded" title="删除整个目录">
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600 ml-1" />
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
                    className={`group flex items-center cursor-pointer border-b border-zinc-100 dark:border-zinc-800/60 transition-colors text-sm
                      ${isChecked ? 'bg-emerald-50/60 dark:bg-emerald-900/10 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'hover:bg-zinc-50/80 dark:hover:bg-zinc-800/30'}
                      ${fileToDelete === file.key && isDeleting ? 'opacity-40 pointer-events-none' : ''}`}
                  >
                    <div className="pl-4 w-10 shrink-0" onClick={e => toggleSelect(file.key, e)}>
                      <button className="p-0.5 text-zinc-400 hover:text-emerald-500 transition-colors">
                        {isChecked
                          ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                          : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100" />}
                      </button>
                    </div>
                    <div className="flex-1 pl-1 flex items-center gap-3 min-w-0">
                      {getFileIcon(file.mimeType)}
                      {isRenaming ? (
                        <input autoFocus value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => commitRename(file.key)}
                          onKeyDown={e => { if (e.key === 'Enter') commitRename(file.key); if (e.key === 'Escape') setRenamingKey(null); }}
                          onClick={e => e.stopPropagation()}
                          className="flex-1 max-w-[220px] px-2 py-0.5 text-sm rounded border border-emerald-400 dark:border-emerald-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-400/40"
                        />
                      ) : (
                        <span className="truncate max-w-[240px] text-zinc-700 dark:text-zinc-200" title={file.key}>
                          <HighlightText text={entry.name} query={searchQuery} />
                        </span>
                      )}
                    </div>
                    <div className="w-28 shrink-0 font-mono text-xs tabular-nums text-zinc-500">{formatBytes(file.fsize)}</div>
                    <div className="w-52 shrink-0 hidden md:block">
                      <span className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded text-xs">{file.mimeType || 'unknown'}</span>
                    </div>
                    <div className="w-44 shrink-0 hidden lg:block text-zinc-400 text-xs tabular-nums">{formatQiniuTime(file.putTime)}</div>
                    <div className="w-44 shrink-0 pr-5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={(e) => startRename(e, file)}
                          className="p-1.5 text-zinc-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded opacity-0 group-hover:opacity-100 transition-all" title="重命名">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDownload(file.key); }}
                          className="p-1.5 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded opacity-0 group-hover:opacity-100 transition-all" title="下载文件">
                          <Download className="w-4 h-4" />
                        </button>
                        <button onClick={(e) => handleCopyLink(e, file.key)}
                          className={`text-xs font-medium px-2 py-1.5 rounded-md transition-all flex items-center gap-1 whitespace-nowrap shrink-0
                            ${copiedKey === file.key
                              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                              : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100'}`}>
                          {copiedKey === file.key ? <><Check className="w-3 h-3" />已复制</> : <><Link2 className="w-3 h-3" />复制链接</>}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setFileToDelete(file.key); }}
                          className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded opacity-0 group-hover:opacity-100 transition-all" title="删除文件">
                          <Trash2 className="w-4 h-4" />
                        </button>
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
                    src={generateDownloadUrl(ak, sk, domains[0], selectedFile.key)}
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
            src={generateDownloadUrl(ak, sk, domains[0], previewFile.key)}
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
      {(fileToDelete || dirToDelete) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 text-center mx-4">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
              <Trash2 className="h-6 w-6 text-red-600 dark:text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">确认删除？</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 break-all">
              <strong className="text-red-500 block mb-1">{fileToDelete || dirToDelete}</strong>
              {dirToDelete ? "该目录下的所有文件都将被彻底删除，并且无法恢复" : "删除后将无法恢复"}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => dirToDelete ? executeDeleteDirectory(dirToDelete) : executeDeleteFile(fileToDelete!)}
                disabled={isDeleting}
                className="w-full px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />删除中...</>
                  : "确认删除"}
              </button>
              <button
                onClick={() => { if (!isDeleting) { setFileToDelete(null); setDirToDelete(null); } }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6 mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Bookmark className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100">添加书签</h3>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{bucket}{currentPrefix ? " / " + currentPrefix.replace(/\/$/, "") : ""}</p>
              </div>
            </div>
            <input
              autoFocus
              type="text"
              value={bookmarkLabel}
              onChange={e => setBookmarkLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddBookmark();
                if (e.key === 'Escape') { setShowBookmarkDialog(false); setBookmarkLabel(""); }
              }}
              placeholder="书签名称（如：产品图片库）"
              className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 mb-5"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowBookmarkDialog(false); setBookmarkLabel(""); }}
                className="flex-1 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddBookmark}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-xl transition-colors"
              >
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
