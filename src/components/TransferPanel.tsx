import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { useTransferStore, TransferTask } from "../store/transfer";
import { X, ChevronDown, ChevronUp, Upload, Download, Check, AlertCircle, Trash2, Loader2 } from "lucide-react";
import { formatBytes } from "../lib/utils";

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`;
  return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分`;
}

const ROW_HEIGHT = 72;

const TaskItem = memo(function TaskItem({ taskId }: { taskId: string }) {
  const task = useTransferStore((s) => s.tasksById[taskId]);
  const removeTask = useTransferStore((s) => s.removeTask);

  if (!task) return null;

  return <TaskItemView task={task} onRemove={() => removeTask(task.id)} />;
});

const TaskItemView = memo(function TaskItemView({
  task,
  onRemove,
}: {
  task: TransferTask;
  onRemove: () => void;
}) {
  const Icon = task.type === 'upload' ? Upload : Download;
  const StatusIcon = task.status === 'completed' ? Check
    : task.status === 'failed' ? AlertCircle
    : task.status === 'transferring' ? Loader2
    : null;

  const estimatedTotal = task.speed && task.speed > 0
    ? (task.totalSize - task.transferredSize) / task.speed
    : 0;

  return (
    <div className="group px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
      <div className="flex items-start gap-2.5">
        <div className={`p-1.5 rounded-lg shrink-0 ${
          task.type === 'upload'
            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
        }`}>
          <Icon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {task.fileName}
            </p>
            {StatusIcon && (
              <StatusIcon className={`w-4 h-4 shrink-0 ${
                task.status === 'completed' ? 'text-emerald-500' :
                task.status === 'failed' ? 'text-red-500' :
                'text-blue-500 animate-spin'
              }`} />
            )}
          </div>

          {task.status === 'failed' && task.error && (
            <p className="text-xs text-red-500 mb-1 truncate">{task.error}</p>
          )}

          {task.status === 'transferring' && (
            <>
              <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden mb-1.5">
                <div
                  className={`h-full ${
                    task.type === 'upload' ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  {formatBytes(task.transferredSize)} / {formatBytes(task.totalSize)}
                  {task.speed && task.speed > 0 && ` · ${formatSpeed(task.speed)}`}
                </span>
                {estimatedTotal > 0 && (
                  <span>剩余 {formatTime(estimatedTotal)}</span>
                )}
              </div>
            </>
          )}

          {task.status === 'completed' && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatBytes(task.totalSize)}
              {task.endTime != null && ` · 用时 ${formatTime((task.endTime - task.startTime) / 1000)}`}
            </p>
          )}

          {task.status === 'pending' && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">等待中...</p>
          )}
        </div>

        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
          title="移除"
        >
          <X className="w-3.5 h-3.5 text-zinc-500" />
        </button>
      </div>
    </div>
  );
});

export function TransferPanel() {
  const taskIds = useTransferStore((s) => s.taskIds);
  const isPanelOpen = useTransferStore((s) => s.isPanelOpen);
  const togglePanel = useTransferStore((s) => s.togglePanel);
  const clearCompleted = useTransferStore((s) => s.clearCompleted);
  const clearAll = useTransferStore((s) => s.clearAll);
  const counts = useTransferStore(useShallow((s) => {
    let active = 0, completed = 0, failed = 0;
    for (const id of s.taskIds) {
      const t = s.tasksById[id];
      if (!t) continue;
      if (t.status === 'transferring' || t.status === 'pending') active++;
      else if (t.status === 'completed') completed++;
      else if (t.status === 'failed') failed++;
    }
    return { active, completed, failed };
  }));

  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: taskIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (taskIds.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            传输任务
          </h3>
          {counts.active > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
              {counts.active} 进行中
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {counts.completed > 0 && (
            <button
              onClick={clearCompleted}
              className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              title="清除已完成"
            >
              <Trash2 className="w-3.5 h-3.5 text-zinc-500" />
            </button>
          )}
          <button
            onClick={togglePanel}
            className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            {isPanelOpen ? (
              <ChevronDown className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            ) : (
              <ChevronUp className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            )}
          </button>
          <button
            onClick={clearAll}
            className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            title="关闭"
          >
            <X className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
          </button>
        </div>
      </div>

      {/* Virtualized Task List */}
      {isPanelOpen && (
        <div ref={scrollRef} className="max-h-96 overflow-y-auto">
          <div
            className="relative w-full"
            style={{ height: rowVirtualizer.getTotalSize() }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const taskId = taskIds[virtualRow.index];
              return (
                <div
                  key={taskId}
                  className="absolute left-0 w-full"
                  style={{
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <TaskItem taskId={taskId} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary */}
      {!isPanelOpen && (
        <div className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
          {counts.active > 0 && `${counts.active} 个任务进行中`}
          {counts.completed > 0 && ` · ${counts.completed} 个已完成`}
          {counts.failed > 0 && ` · ${counts.failed} 个失败`}
        </div>
      )}
    </div>
  );
}
