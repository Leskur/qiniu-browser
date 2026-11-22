import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableSortButton } from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown, Trash2, Lock, Globe, FileSearch, AlertCircle, Plus } from "lucide-react";
import { QiniuBucket } from "../../lib/qiniu";
import { formatBytes, formatDate } from "../../lib/utils";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Button } from "../../components/ui/button";
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
  onResetFilters,
  onRetry,
  sortField,
  sortDesc,
  deletingBucket,
  onSelectBucket,
  onDeleteBucket,
  onCreateBucket,
  onSort,
  formatRegion,
}: {
  buckets: QiniuBucket[];
  stats: Stats;
  loading: boolean;
  error: string;
  searchQuery: string;
  onResetFilters: () => void;
  onRetry: () => void;
  sortField: SortField | null;
  sortDesc: boolean;
  deletingBucket: string | null;
  onSelectBucket: (bucket: string) => void;
  onDeleteBucket: (bucket: string) => void;
  onCreateBucket: () => void;
  onSort: (field: SortField) => void;
  formatRegion: (code: string) => string;
}) {
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 inline-block size-3 text-zinc-300 dark:text-zinc-700" />;
    return sortDesc
      ? <ArrowDown className="ml-1 inline-block size-3 text-emerald-500" />
      : <ArrowUp className="ml-1 inline-block size-3 text-emerald-500" />;
  };
  const sortableColumns = [
    { field: "tbl", label: "空间名称" },
    { field: "region", label: "区域" },
    { field: "file_num", label: "文件数" },
    { field: "storage_size", label: "用量" },
    { field: "ctime", label: "创建时间" },
  ] as const;

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-20 text-zinc-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-emerald-600 dark:border-zinc-800" />
        <p className="text-sm">正在获取空间列表...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <AlertCircle className="size-4" /> 请求失败
        </div>
        <div className="mb-4 break-all rounded-xs bg-red-100/50 p-2 font-mono text-xs dark:bg-red-900/20">{error}</div>
        <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
      </div>
    );
  }

  if (buckets.length === 0 && stats.totalBuckets === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-16 text-center">
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">还没有存储空间</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">创建后即可上传和管理文件</p>
        </div>
        <Button onClick={onCreateBucket}>
          <Plus /> 新建第一个空间
        </Button>
      </div>
    );
  }

  if (buckets.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-16 text-center">
        <FileSearch className="size-8 text-zinc-300 dark:text-zinc-700" />
        <p className="text-sm text-zinc-500">
          {searchQuery ? `没有找到匹配 “${searchQuery}” 的空间` : "所选区域没有匹配的空间"}
        </p>
        <Button variant="outline" size="sm" onClick={onResetFilters}>清除筛选</Button>
      </div>
    );
  }

  return (
    <ScrollArea className="relative min-h-0 flex-1 bg-white dark:bg-zinc-950">
      <Table className="w-full whitespace-nowrap text-left text-sm">
        <TableHeader className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80">
          <TableRow>
            {sortableColumns.map(({ field, label }) => (
              <TableHead key={field} className={field === "region" ? "min-w-[100px] p-0" : "p-0"}
                aria-sort={sortField === field ? (sortDesc ? "descending" : "ascending") : undefined}>
                <TableSortButton className={field === "tbl" ? "px-6" : "justify-center px-6"} onClick={() => onSort(field)}>
                  {label}<SortIcon field={field} />
                </TableSortButton>
              </TableHead>
            ))}
            <TableHead className="w-12 px-6 py-3" />
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {buckets.map(bucket => (
            <TableRow
              key={bucket.tbl}
              className={`group cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${deletingBucket === bucket.tbl ? "pointer-events-none bg-red-50/50 opacity-50 dark:bg-red-900/10" : ""}`}
              onClick={() => onSelectBucket(bucket.tbl)}
            >
              <TableCell className="px-6 py-3 text-left">
                <div className="flex items-center gap-2">
                  <button type="button" disabled={deletingBucket === bucket.tbl}
                    onClick={e => { e.stopPropagation(); onSelectBucket(bucket.tbl); }}
                    className="cursor-pointer text-left font-medium text-zinc-800 transition-colors group-hover:text-emerald-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-zinc-100 dark:group-hover:text-emerald-400">
                    {bucket.tbl}
                  </button>
                  {bucket.private === 1 ? (
                    <span className="inline-flex items-center gap-0.5 rounded-xs px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      <Lock className="size-2.5" />私有
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 rounded-xs px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                      <Globe className="size-2.5" />公开
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
                {formatRegion(bucket.region)}
              </TableCell>
              <TableCell className="px-6 py-3 text-center font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                {bucket.file_num < 0 ? "-" : bucket.file_num.toLocaleString()}
              </TableCell>
              <TableCell className="px-6 py-3 text-center font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                <div className="flex flex-col items-center gap-0.5">
                  <span>{formatBytes(bucket.storage_size)}</span>
                  {stats.totalSize > 0 && bucket.storage_size > 0 && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
                      {((bucket.storage_size / stats.totalSize) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3 text-center font-mono text-xs text-zinc-500">
                {formatDate(bucket.ctime)}
              </TableCell>
              <TableCell className="px-6 py-3 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={deletingBucket === bucket.tbl}
                  title="删除空间"
                  aria-label={`删除空间 ${bucket.tbl}`}
                  className="opacity-0 text-zinc-400 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  onClick={(e) => { e.stopPropagation(); onDeleteBucket(bucket.tbl); }}
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
