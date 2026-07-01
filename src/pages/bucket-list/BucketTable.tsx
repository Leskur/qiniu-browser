import { ArrowUpDown, ArrowUp, ArrowDown, Trash2, Lock, Globe, FileSearch, AlertCircle } from "lucide-react";
import { QiniuBucket } from "../../lib/qiniu";
import { formatBytes, formatDate } from "../../lib/utils";
import { ScrollArea } from "../../components/ui/scroll-area";
import { SortField } from "./constants";

type Stats = {
  totalBuckets: number;
  totalFiles: number;
  totalSize: number;
};

export function BucketTable({
  buckets,
  stats,
  loading,
  error,
  searchQuery,
  sortField,
  sortDesc,
  deletingBucket,
  onSelectBucket,
  onDeleteBucket,
  onSort,
  formatRegion,
}: {
  buckets: QiniuBucket[];
  stats: Stats;
  loading: boolean;
  error: string;
  searchQuery: string;
  sortField: SortField | null;
  sortDesc: boolean;
  deletingBucket: string | null;
  onSelectBucket: (bucket: string) => void;
  onDeleteBucket: (bucket: string) => void;
  onSort: (field: SortField) => void;
  formatRegion: (code: string) => string;
}) {
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-zinc-300 dark:text-zinc-700 inline-block ml-1" />;
    return sortDesc
      ? <ArrowDown className="w-3 h-3 text-emerald-500 inline-block ml-1" />
      : <ArrowUp className="w-3 h-3 text-emerald-500 inline-block ml-1" />;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-zinc-500 gap-4 flex-1">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-zinc-200 dark:border-zinc-800 border-t-emerald-600"></div>
        <div className="animate-pulse">正在获取七牛云 Bucket 列表...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-900/50">
        <div className="font-bold mb-2 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" /> 请求失败
        </div>
        <div className="font-mono text-sm break-all mb-4 bg-red-100/50 dark:bg-red-900/20 p-2 rounded">{error}</div>
        <div className="text-sm opacity-90 border-t border-red-200 dark:border-red-800 pt-3">
          <strong>诊断提示：</strong>如果是 "Failed to fetch"，极大概率是七牛云的管理 API 不允许浏览器直接跨域访问 (CORS)。
          如果是这样，请告诉我，我们将把请求逻辑下沉到 Rust (Tauri 插件) 中来完美解决它！
        </div>
      </div>
    );
  }

  if (buckets.length === 0 && !searchQuery) {
    return (
      <div className="text-center p-20 text-zinc-500 border-2 border-dashed rounded-xl border-zinc-200 dark:border-zinc-800 flex-1 flex items-center justify-center">
        空空如也，当前账号没有存储空间。
      </div>
    );
  }

  if (buckets.length === 0 && searchQuery) {
    return (
      <div className="text-center p-20 text-zinc-500 border-2 border-dashed rounded-xl border-zinc-200 dark:border-zinc-800 flex-1 flex flex-col items-center justify-center gap-3">
        <FileSearch className="w-10 h-10 text-zinc-300 dark:text-zinc-700" />
        <p className="text-sm">没有找到名字包含 "{searchQuery}" 的存储空间</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 relative">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="sticky top-0 z-10 bg-zinc-50/80 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800 backdrop-blur-md">
          <tr>
            <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-left" onClick={() => onSort('tbl')}>
              空间名称 <SortIcon field="tbl" />
            </th>
            <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center whitespace-nowrap min-w-[120px]" onClick={() => onSort('region')}>
              区域 <SortIcon field="region" />
            </th>
            <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center" onClick={() => onSort('file_num')}>
              文件数量 <SortIcon field="file_num" />
            </th>
            <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center" onClick={() => onSort('storage_size')}>
              存储用量 <SortIcon field="storage_size" />
            </th>
            <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors select-none text-center" onClick={() => onSort('ctime')}>
              创建时间 <SortIcon field="ctime" />
            </th>
            <th className="px-6 py-4 font-medium text-zinc-500 dark:text-zinc-400 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {buckets.map(bucket => (
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
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{bucket.tbl}</span>
                      {bucket.private === 1 ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                          <Lock className="w-2.5 h-2.5" />私有
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">
                          <Globe className="w-2.5 h-2.5" />公开
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-center whitespace-normal">
                <span className="text-xs font-medium bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-zinc-600 dark:text-zinc-400 inline-block">
                  {formatRegion(bucket.region)}
                </span>
              </td>
              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400 text-center font-mono text-xs">
                {bucket.file_num < 0 ? '-' : bucket.file_num.toLocaleString()}
              </td>
              <td className="px-6 py-4 text-zinc-600 dark:text-zinc-400 text-center font-mono text-xs">
                <div className="flex flex-col items-center gap-0.5">
                  <span>{formatBytes(bucket.storage_size)}</span>
                  {stats.totalSize > 0 && bucket.storage_size > 0 && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 tabular-nums">
                      占总存储 {((bucket.storage_size / stats.totalSize) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 text-zinc-500 text-xs text-center font-mono">
                {formatDate(bucket.ctime)}
              </td>
              <td className="px-6 py-4 text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteBucket(bucket.tbl); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                    title="删除空间"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}
