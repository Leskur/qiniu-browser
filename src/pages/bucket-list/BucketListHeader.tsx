import { Database, HardDrive, FileBox } from "lucide-react";
import { formatBytes } from "../../lib/utils";

type Stats = {
  totalBuckets: number;
  totalFiles: number;
  totalSize: number;
};

export function BucketListHeader({
  stats,
}: {
  stats: Stats;
}) {
  return (
    <div className="flex items-center gap-2 px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm shrink-0">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">空间管理</span>
      {stats.totalBuckets > 0 && (
        <>
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
            <span>已用 <strong className="text-zinc-700 dark:text-zinc-300 font-semibold">{formatBytes(stats.totalSize)}</strong></span>
          </div>
        </>
      )}
    </div>
  );
}
