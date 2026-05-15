# API 滥用分析报告

## 概述

本报告分析了 Qiniu Browser 项目中可能存在的 API 滥用问题，并提供优化建议。

分析日期：2026-05-14

---

## 1. 文件列表 API (fetchFiles)

### 当前实现

**位置**: `src/components/FileManager.tsx` - `loadDirectory()` 函数

**问题分析**:

✅ **良好实践**:
- 使用了合理的分页大小 (limit: 50)
- 实现了目录缓存机制 (`dirCache`)
- 支持增量加载 (loadMore)
- 使用 marker 进行分页，符合七牛 API 规范

⚠️ **潜在问题**:
1. **缓存失效策略不完善**: 缓存永久保存在内存中，没有过期时间
2. **强制刷新频率**: 用户可以频繁点击刷新按钮，没有防抖限制
3. **自动滚动加载**: 滚动到底部自动加载更多，可能在快速滚动时触发多次请求

```typescript
// 当前代码
const loadDirectory = useCallback(async (prefix: string, forceRefresh = false) => {
  // 检查缓存
  if (!forceRefresh && dirCache.current.has(prefix)) {
    const cached = dirCache.current.get(prefix)!;
    // ... 使用缓存
    return;
  }
  
  // 每次加载 50 条
  const res = await fetchFiles(ak, sk, bucket, prefix, "", 50, "/");
  // ...
}, [ak, sk, bucket]);
```

### 优化建议

1. **添加缓存过期时间**:
```typescript
interface CacheEntry {
  items: QiniuFile[];
  folders: string[];
  nextMarker: string;
  hasMore: boolean;
  timestamp: number; // 添加时间戳
}

// 检查缓存时验证过期时间 (例如 5 分钟)
const CACHE_TTL = 5 * 60 * 1000;
if (!forceRefresh && dirCache.current.has(prefix)) {
  const cached = dirCache.current.get(prefix)!;
  if (Date.now() - cached.timestamp < CACHE_TTL) {
    // 使用缓存
  }
}
```

2. **添加刷新防抖**:
```typescript
const [lastRefreshTime, setLastRefreshTime] = useState(0);
const REFRESH_COOLDOWN = 2000; // 2秒冷却时间

const handleRefresh = () => {
  const now = Date.now();
  if (now - lastRefreshTime < REFRESH_COOLDOWN) {
    toast.info('刷新太频繁，请稍后再试');
    return;
  }
  setLastRefreshTime(now);
  loadDirectory(currentPrefix, true);
};
```

3. **优化自动加载**:
```typescript
// 添加加载节流
const loadMoreThrottled = useCallback(
  throttle(() => {
    if (!hasMore || loadingMore) return;
    loadMore();
  }, 1000), // 1秒内最多触发一次
  [hasMore, loadingMore, loadMore]
);
```

---

## 2. 域名获取 API (fetchBucketDomains)

### 当前实现

**位置**: `src/components/FileManager.tsx` - useEffect

**问题分析**:

✅ **良好实践**:
- 只在组件挂载时获取一次
- 使用 useEffect 依赖数组控制

⚠️ **潜在问题**:
1. **每次切换 bucket 都会重新请求**: 当用户在不同 bucket 之间切换时，每次都会请求域名
2. **没有全局缓存**: 域名信息应该在应用级别缓存

```typescript
// 当前代码
useEffect(() => {
  fetchBucketDomains(ak, sk, bucket).then(setDomains).catch(() => setDomains([]));
}, [ak, sk, bucket]);
```

### 优化建议

1. **添加全局域名缓存**:
```typescript
// 在 src/store/index.ts 中添加
interface AppState {
  buckets: QiniuBucket[];
  bucketDomains: Map<string, string[]>; // 添加域名缓存
  setBucketDomains: (bucket: string, domains: string[]) => void;
}

// 在 FileManager 中使用
const { bucketDomains, setBucketDomains } = useAppStore();

useEffect(() => {
  const cached = bucketDomains.get(bucket);
  if (cached) {
    setDomains(cached);
    return;
  }
  
  fetchBucketDomains(ak, sk, bucket)
    .then(domains => {
      setDomains(domains);
      setBucketDomains(bucket, domains);
    })
    .catch(() => setDomains([]));
}, [ak, sk, bucket, bucketDomains, setBucketDomains]);
```

---

## 3. 批量删除 API (batchDeleteFiles)

### 当前实现

**位置**: `src/components/FileManager.tsx` - `handleBatchDelete()`

**问题分析**:

✅ **良好实践**:
- 使用批量 API 而不是循环调用单个删除
- 在 `src/lib/qiniu.ts` 中实现了分块处理 (每批 1000 个)

```typescript
// src/lib/qiniu.ts
export async function batchDeleteFiles(ak: string, sk: string, bucket: string, keys: string[]) {
  const BATCH_SIZE = 1000;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const chunk = keys.slice(i, i + BATCH_SIZE);
    // ... 批量删除
  }
}
```

✅ **无明显问题**: 批量删除实现合理，符合七牛 API 最佳实践

---

## 4. 文件上传

### 当前实现

**位置**: `src/components/FileManager.tsx` - `handleUploadPaths()`

**问题分析**:

✅ **良好实践**:
- 使用 Tauri 后端处理上传，避免前端直接调用
- 通过事件监听器接收进度更新
- 上传完成后刷新目录

⚠️ **潜在问题**:
1. **上传完成后立即刷新**: 可能在大量文件上传时触发多次刷新
2. **没有批量上传限制**: 用户可以同时上传大量文件

```typescript
const handleUploadPaths = async (paths: string[]) => {
  // ...
  const result = await invoke('upload_files', { 
    ak, sk, bucket, 
    filePaths: paths, 
    prefix: currentPrefix 
  });
  
  // 立即刷新
  loadDirectory(currentPrefix, true);
};
```

### 优化建议

1. **延迟刷新**:
```typescript
// 使用防抖延迟刷新
const debouncedRefresh = useMemo(
  () => debounce(() => loadDirectory(currentPrefix, true), 2000),
  [currentPrefix, loadDirectory]
);

const handleUploadPaths = async (paths: string[]) => {
  // ...
  const result = await invoke('upload_files', { ... });
  
  // 延迟刷新，避免频繁调用
  debouncedRefresh();
};
```

2. **添加并发限制**:
```typescript
const MAX_CONCURRENT_UPLOADS = 5;

if (paths.length > MAX_CONCURRENT_UPLOADS) {
  const confirmed = await confirm(
    `您选择了 ${paths.length} 个文件，建议分批上传以获得更好的性能。是否继续？`
  );
  if (!confirmed) return;
}
```

---

## 5. 文件下载

### 当前实现

**位置**: `src/components/FileManager.tsx` - `handleDownload()`, `handleBatchDownload()`

**问题分析**:

✅ **良好实践**:
- 使用 Tauri 后端处理下载
- 批量下载使用后端批处理

⚠️ **潜在问题**:
1. **下载文件夹时一次性获取所有文件**: `fetchFiles` 使用 limit: 10000
2. **没有检查文件夹大小**: 可能下载超大文件夹

```typescript
const handleDownloadFolder = async (folderPrefix: string) => {
  // 一次性获取 10000 个文件
  const res = await fetchFiles(ak, sk, bucket, folderPrefix, "", 10000);
  const folderFiles = res.items || [];
  // ...
};
```

### 优化建议

1. **分页获取文件夹内容**:
```typescript
const handleDownloadFolder = async (folderPrefix: string) => {
  let allFiles: QiniuFile[] = [];
  let marker = "";
  let hasMore = true;
  
  // 分页获取所有文件
  while (hasMore) {
    const res = await fetchFiles(ak, sk, bucket, folderPrefix, marker, 1000);
    allFiles = [...allFiles, ...(res.items || [])];
    marker = res.marker || "";
    hasMore = !!res.marker;
    
    // 添加安全限制
    if (allFiles.length > 10000) {
      const confirmed = await confirm(
        `该文件夹包含超过 10000 个文件，下载可能需要很长时间。是否继续？`
      );
      if (!confirmed) return;
      break;
    }
  }
  
  // ... 继续下载
};
```

---

## 6. CDN 管理 API

### 当前实现

**位置**: `src/components/CdnManager.tsx`, `src/lib/cdn.ts`

**问题分析**:

✅ **良好实践**:
- CDN API 调用都是用户主动触发
- 没有自动轮询或定时刷新
- 使用合理的分页参数 (limit: 100)

✅ **无明显问题**: CDN 管理功能实现合理

---

## 7. 事件监听器

### 当前实现

**位置**: `src/components/FileManager.tsx` - upload/download progress listeners

**问题分析**:

⚠️ **潜在问题**:
1. **事件监听器可能触发频繁的状态更新**: 每个进度事件都会调用 `updateTask`
2. **没有节流处理**: 高频进度更新可能影响性能

```typescript
useEffect(() => {
  const unlistenUpload = listen('upload-progress', (event) => {
    // 每次进度更新都调用
    updateTask(frontendId, {
      transferredSize: uploaded_size,
      progress,
      status: ...
    });
  });
  // ...
}, [addTask, updateTask]);
```

### 优化建议

1. **添加进度更新节流**:
```typescript
// 在 Rust 后端限制事件发送频率
// 或在前端添加节流
const throttledUpdateTask = useMemo(
  () => throttle((id: string, updates: any) => {
    updateTask(id, updates);
  }, 100), // 100ms 更新一次
  [updateTask]
);
```

---

## 总结

### 严重问题 (需要立即修复)

❌ **无严重问题**

### 中等问题 (建议优化)

⚠️ 1. **下载文件夹时一次性获取 10000 个文件** - 应该分页获取并添加大小警告
⚠️ 2. **缓存没有过期时间** - 可能导致数据不一致
⚠️ 3. **域名信息没有全局缓存** - 切换 bucket 时重复请求

### 轻微问题 (可选优化)

💡 1. **刷新按钮没有防抖** - 用户可能频繁点击
💡 2. **进度事件更新频率高** - 可以添加节流
💡 3. **上传完成后立即刷新** - 可以延迟刷新

---

## 优化优先级

### 高优先级
1. ✅ 下载文件夹分页获取 + 大小警告
2. ✅ 添加缓存过期机制
3. ✅ 域名信息全局缓存

### 中优先级
4. ✅ 刷新按钮防抖
5. ✅ 上传后延迟刷新

### 低优先级
6. ✅ 进度更新节流
7. ✅ 并发上传限制

---

## 总体评价

**评分: 8/10**

项目整体 API 使用较为合理，主要优点：
- ✅ 正确使用批量 API
- ✅ 实现了基本的缓存机制
- ✅ 合理的分页大小
- ✅ 没有不必要的轮询

主要改进空间：
- 缓存策略可以更完善
- 大数据量操作需要更多保护措施
- 用户交互可以添加更多限流保护

**结论**: 没有发现严重的 API 滥用问题，现有实现基本符合最佳实践。建议按优先级逐步优化上述问题。
