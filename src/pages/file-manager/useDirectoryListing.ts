import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFiles, type QiniuFile } from '../../lib/qiniu';
import { toast } from '../../lib/toast';
import { useAppStore } from '../../store';

/** 过滤空目录占位符（key 以 / 结尾），目录只取 commonPrefixes */
function normalizeListResult(res: { items?: QiniuFile[]; commonPrefixes?: string[]; marker?: string }) {
  const items = (res.items || []).filter(i => !i.key.endsWith('/'));
  const folders = res.commonPrefixes || [];
  const nextMarker = res.marker || "";
  return { items, folders, nextMarker, hasMore: !!nextMarker };
}

interface DirectoryListingOptions {
  ak: string;
  sk: string;
  bucket: string;
  currentPrefix: string;
  onSelectionReset: () => void;
}

/** Owns directory requests, stale-response protection, search, pagination and cache. */
export function useDirectoryListing({ ak, sk, bucket, currentPrefix, onSelectionReset }: DirectoryListingOptions) {
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

  // ── Search state ──
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState(""); // 已生效的前缀过滤
  const inApiSearchRef = useRef(false);
  const listRequestId = useRef(0);
  const loadedListPrefix = useRef<string | null>(null);
  const paginationPending = useRef(false);
  const currentPrefixRef = useRef(currentPrefix);
  currentPrefixRef.current = currentPrefix;

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
        onSelectionReset();
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
    onSelectionReset();
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
  }, [ak, sk, bucket, CACHE_TTL, itemsPerPage, onSelectionReset]);

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
    onSelectionReset();
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
  }, [ak, sk, bucket, itemsPerPage, loadDirectory, onSelectionReset]);

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

  const invalidateDirectory = useCallback((prefix: string) => { dirCache.current.delete(prefix); }, []);
  const clearDirectoryCache = useCallback(() => { dirCache.current.clear(); }, []);
  const removeListedFile = (key: string) => {
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
  };

  return {
    items, folders, hasMore, loadingMore, loading, error,
    searchInput, setSearchInput, committedSearch, currentPrefixRef,
    loadDirectory, loadMore, clearSearch, runPrefixSearch, refreshCurrentView,
    invalidateDirectory, clearDirectoryCache, removeListedFile,
  };
}
