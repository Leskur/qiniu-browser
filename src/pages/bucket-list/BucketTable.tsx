import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableSortButton } from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown, Trash2, Lock, Globe, FileSearch, Plus, Database } from "lucide-react";
import { QiniuBucket } from "../../lib/qiniu";
import { formatBytes, formatDate } from "../../lib/utils";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Button } from "../../components/ui/button";
import { SortField } from "./constants";
import { PageState } from "../../components/PageState";

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
      <PageState loading title="正在获取空间列表..." />
    );
  }

  if (error) {
    return (
      <PageState error title="请求失败" description={<span className="break-all">{error}</span>}>
        <Button variant="secondary" size="sm" onClick={onRetry}>重试</Button>
      </PageState>
    );
  }

  if (buckets.length === 0 && stats.totalBuckets === 0) {
    return (
      <PageState icon={Database} title="还没有存储空间" description="创建后即可上传和管理文件">
        <Button onClick={onCreateBucket}>
          <Plus /> 新建第一个空间
        </Button>
      </PageState>
    );
  }

  if (buckets.length === 0) {
    return (
      <PageState icon={FileSearch} title={searchQuery ? `没有找到匹配 “${searchQuery}” 的空间` : "所选区域没有匹配的空间"}>
        <Button variant="secondary" size="sm" onClick={onResetFilters}>清除筛选</Button>
      </PageState>
    );
  }

  return (
    <ScrollArea className="relative min-h-0 flex-1 bg-white dark:bg-background">
      <Table className="w-full whitespace-nowrap text-left text-sm">
        <TableHeader className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-md dark:border-border dark:bg-card/90">
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
        <TableBody className="divide-y divide-zinc-100 dark:divide-border/80">
          {buckets.map(bucket => (
            <TableRow
              key={bucket.tbl}
              className={`group cursor-default transition-colors hover:bg-zinc-50 dark:hover:bg-muted/60 ${deletingBucket === bucket.tbl ? "pointer-events-none bg-red-50/50 opacity-50 dark:bg-red-900/10" : ""}`}
              onClick={() => onSelectBucket(bucket.tbl)}
            >
              <TableCell className="px-6 py-3 text-left">
                <div className="flex items-center gap-2">
                  <button type="button" disabled={deletingBucket === bucket.tbl}
                    onClick={e => { e.stopPropagation(); onSelectBucket(bucket.tbl); }}
                    className="cursor-default text-left font-medium text-zinc-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-foreground">
                    {bucket.tbl}
                  </button>
                  {bucket.private === 1 ? (
                    <span className="inline-flex items-center gap-0.5 rounded-xs px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:text-muted-foreground">
                      <Lock className="size-2.5" />私有
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 rounded-xs px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:text-muted-foreground">
                      <Globe className="size-2.5" />公开
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="px-6 py-3 text-center text-xs text-zinc-500 dark:text-muted-foreground">
                {formatRegion(bucket.region)}
              </TableCell>
              <TableCell className="px-6 py-3 text-center font-mono text-xs tabular-nums text-zinc-600 dark:text-muted-foreground">
                {bucket.file_num < 0 ? "-" : bucket.file_num.toLocaleString()}
              </TableCell>
              <TableCell className="px-6 py-3 text-center font-mono text-xs tabular-nums text-zinc-600 dark:text-muted-foreground">
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
