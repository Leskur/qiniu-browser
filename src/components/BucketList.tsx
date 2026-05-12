import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { QiniuBucket, createBucket, forceDeleteBucket } from "../lib/qiniu";
import { formatSize, formatDate } from "../lib/utils";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { ArrowUpDown, ArrowUp, ArrowDown, Database, HardDrive, FileBox, Plus, Trash2 } from "lucide-react";
import { useAppStore } from "../store";
import { toast } from "sonner";

type SortField = 'tbl' | 'region' | 'file_num' | 'storage_size' | 'ctime';

const REGION_MAP: Record<string, string> = {
  'z0': '华东',
  'cn-east-1': '华东',
  'z1': '华北',
  'cn-north-1': '华北',
  'z2': '华南',
  'cn-south-1': '华南',
  'na0': '北美',
  'us-north-1': '北美',
  'as0': '东南亚',
  'ap-southeast-1': '东南亚',
  'cn-east-2': '华东-浙江2',
  'fog-cn-east-1': '华东-雾存储'
};

function formatRegion(regionCode: string) {
  return REGION_MAP[regionCode] || regionCode;
}

export function BucketList({
  buckets,
  ak,
  sk,
  loading,
  error,
  onSelectBucket,
  onRefresh
}: {
  buckets: QiniuBucket[],
  ak: string,
  sk: string,
  loading: boolean,
  error: string,
  onSelectBucket: (bucket: string) => void,
  onRefresh: () => void
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const { getTotalStats } = useAppStore();
  const stats = getTotalStats();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [newBucketRegion, setNewBucketRegion] = useState("z0");
  const [isCreating, setIsCreating] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<string | null>(null);
  
  // 用于替换原生 window.confirm
  const [bucketToDelete, setBucketToDelete] = useState<string | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDesc) {
        setSortField(null); // 三态循环：升 -> 降 -> 无
      } else {
        setSortDesc(true);
      }
    } else {
      setSortField(field);
      setSortDesc(false);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-zinc-300 dark:text-zinc-700 inline-block ml-1" />;
    return sortDesc 
      ? <ArrowDown className="w-3 h-3 text-emerald-500 inline-block ml-1" />
      : <ArrowUp className="w-3 h-3 text-emerald-500 inline-block ml-1" />;
  };

  const processedBuckets = useMemo(() => {
    let result = buckets.filter(bucket => 
      bucket.tbl.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (sortField) {
      result = [...result].sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];
        
        // 处理 string
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
        }
        // 处理 number
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDesc ? valB - valA : valA - valB;
        }
        return 0;
      });
    }

    return result;
  }, [buckets, searchQuery, sortField, sortDesc]);

  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBucketName.trim()) return;
    
    setIsCreating(true);
    try {
      await createBucket(ak, sk, newBucketName.trim(), newBucketRegion);
      setShowCreateDialog(false);
      setNewBucketName("");
      setNewBucketRegion("z0");
      toast.success("空间创建成功");
      onRefresh(); // 刷新列表
    } catch (err: any) {
      toast.error("创建失败", { description: err.message });
    } finally {
      setIsCreating(false);
    }
  };

  const executeDelete = async (bucketName: string) => {
    setBucketToDelete(null);
    setDeletingBucket(bucketName);
    const tid = toast.loading(`正在清空并删除空间 ${bucketName}...`);
    try {
      await forceDeleteBucket(ak, sk, bucketName);
      toast.dismiss(tid);
      toast.success(`空间 ${bucketName} 已删除`);
      onRefresh();
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error("删除失败", { description: err.message });
    } finally {
      setDeletingBucket(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 relative h-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 shrink-0">
        <div className="flex flex-col gap-2">
          {!loading && !error && buckets.length > 0 && (
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1 rounded-md border border-zinc-200/50 dark:border-zinc-700/50">
                <Database className="w-4 h-4 text-emerald-500" />
                <span><strong className="text-zinc-700 dark:text-zinc-300 font-semibold">{stats.totalBuckets}</strong> 个空间</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1 rounded-md border border-zinc-200/50 dark:border-zinc-700/50">
                <FileBox className="w-4 h-4 text-blue-500" />
                <span><strong className="text-zinc-700 dark:text-zinc-300 font-semibold">{stats.totalFiles.toLocaleString()}</strong> 个文件</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 px-2.5 py-1 rounded-md border border-zinc-200/50 dark:border-zinc-700/50">
                <HardDrive className="w-4 h-4 text-amber-500" />
                <span>已用 <strong className="text-zinc-700 dark:text-zinc-300 font-semibold">{formatSize(stats.totalSize)}</strong></span>
              </div>
            </div>
          )}
        </div>
        {!loading && !error && (
          <div className="flex items-center gap-3">
            <div className="relative">
              <input 
                type="text" 
                placeholder="搜索空间名称..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-1.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all w-64"
              />
              <svg className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button 
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm active:scale-95"
            >
              <Plus className="w-4 h-4" /> 新建空间
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center p-20 text-zinc-500 gap-4 flex-1">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-zinc-200 dark:border-zinc-800 border-t-emerald-600"></div>
          <div className="animate-pulse">正在获取七牛云 Bucket 列表...</div>
        </div>
      )}

      {error && (
        <div className="p-6 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900/50">
          <div className="font-bold mb-2 flex items-center gap-2">
            <span className="text-xl">⚠️</span> 请求失败
          </div>
          <div className="font-mono text-sm break-all mb-4 bg-red-100/50 dark:bg-red-900/20 p-2 rounded">{error}</div>
          <div className="text-sm opacity-90 border-t border-red-200 dark:border-red-800 pt-3">
            <strong>诊断提示：</strong>如果是 "Failed to fetch"，极大概率是七牛云的管理 API 不允许浏览器直接跨域访问 (CORS)。
            如果是这样，请告诉我，我们将把请求逻辑下沉到 Rust (Tauri 插件) 中来完美解决它！
          </div>
        </div>
      )}

      {!loading && !error && buckets.length === 0 && (
        <div className="text-center p-20 text-zinc-500 border-2 border-dashed rounded-xl border-zinc-200 dark:border-zinc-800 flex-1 flex items-center justify-center">
          空空如也，当前账号没有存储空间。
        </div>
      )}

      {!loading && !error && buckets.length > 0 && processedBuckets.length === 0 && (
        <div className="text-center p-20 text-zinc-500 border-2 border-dashed rounded-xl border-zinc-200 dark:border-zinc-800 flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-4xl">🔍</span>
          <p>没有找到名字包含 "{searchQuery}" 的存储空间</p>
        </div>
      )}

      {!loading && !error && processedBuckets.length > 0 && (
        <ScrollArea className="flex-1 min-h-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 relative">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="sticky top-0 z-10 bg-zinc-50/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 backdrop-blur-md">
              <tr>
                <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-left" onClick={() => handleSort('tbl')}>
                  空间名称 <SortIcon field="tbl" />
                </th>
                <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center" onClick={() => handleSort('region')}>
                  区域 <SortIcon field="region" />
                </th>
                <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center" onClick={() => handleSort('file_num')}>
                  文件数量 <SortIcon field="file_num" />
                </th>
                <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center" onClick={() => handleSort('storage_size')}>
                  存储用量 <SortIcon field="storage_size" />
                </th>
                <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center" onClick={() => handleSort('ctime')}>
                  创建时间 <SortIcon field="ctime" />
                </th>
                <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {processedBuckets.map(bucket => (
                <tr 
                  key={bucket.tbl} 
                  className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group cursor-pointer ${deletingBucket === bucket.tbl ? 'opacity-50 pointer-events-none bg-red-50/50 dark:bg-red-900/10' : ''}`}
                  onClick={() => onSelectBucket(bucket.tbl)}
                >
                  <td className="px-6 py-4 text-left">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white shadow-sm bg-gradient-to-br from-emerald-400 to-teal-500">
                        {bucket.tbl.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{bucket.tbl}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-xs font-medium bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-zinc-600 dark:text-zinc-400">
                      {formatRegion(bucket.region)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400 text-center font-mono text-xs">
                    {bucket.file_num < 0 ? '-' : bucket.file_num.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400 text-center font-mono text-xs">
                    {formatSize(bucket.storage_size)}
                  </td>
                  <td className="px-6 py-4 text-zinc-500 text-xs text-center font-mono">
                    {formatDate(bucket.ctime)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setBucketToDelete(bucket.tbl); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                        title="删除空间"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <span className="text-emerald-600 dark:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 font-medium ml-2">
                        进入管理 <span>→</span>
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}

      {/* 新建空间模态框 */}
      {showCreateDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-6">
              <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-100 mb-6">新建存储空间 (Bucket)</h3>
              <form onSubmit={handleCreateBucket}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">空间名称</label>
                    <input 
                      type="text" 
                      autoFocus
                      required
                      placeholder="由 3～63 个字符组成，支持小写字母、数字、短划线"
                      value={newBucketName}
                      onChange={(e) => setNewBucketName(e.target.value)}
                      className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">存储区域</label>
                    <Select value={newBucketRegion} onValueChange={setNewBucketRegion}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(REGION_MAP)
                          .sort(([codeA, nameA], [codeB, nameB]) => {
                            // 旧代码（短代码）优先，新代码（长代码）靠后
                            const isShortA = !codeA.includes('-');
                            const isShortB = !codeB.includes('-');
                            if (isShortA && !isShortB) return -1;
                            if (!isShortA && isShortB) return 1;
                            // 同类型按名称排序
                            return nameA.localeCompare(nameB, 'zh-CN');
                          })
                          .map(([code, name]) => (
                          <SelectItem key={code} value={code}>
                            {name} ({code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-8 flex items-center justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowCreateDialog(false)}
                    className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button 
                    type="submit"
                    disabled={isCreating || !newBucketName}
                    className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isCreating ? (
                      <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>创建中...</>
                    ) : "确定创建"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 删除确认模态框 */}
      {bucketToDelete && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden p-6 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
              <Trash2 className="h-6 w-6 text-red-600 dark:text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">确认删除空间？</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
              确定要删除存储空间 <strong className="text-red-500">{bucketToDelete}</strong> 吗？删除后该空间内所有文件将永久丢失，且无法恢复！
            </p>
            <div className="flex flex-col gap-2">
              <button 
                onClick={() => executeDelete(bucketToDelete)}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
              >
                确认删除，不可恢复
              </button>
              <button 
                onClick={() => setBucketToDelete(null)}
                className="w-full px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
