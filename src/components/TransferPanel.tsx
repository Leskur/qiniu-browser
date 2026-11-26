import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { retryFailedUploads, uploadsActive } from "../lib/upload-retry";
import { memo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { useTransferStore, TransferTask } from "../store/transfer";
import { X, ChevronUp, Upload, Download, Check, AlertCircle, Trash2, Loader2, Square, RotateCw, Copy } from "lucide-react";
import { formatBytes } from "../lib/utils";
import { toast } from "@/lib/toast";

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

async function copyTaskError(message: string) {
  try {
    await navigator.clipboard.writeText(message);
    toast.success("已复制失败原因");
  } catch {
    toast.error("复制失败，请重试");
  }
}

const ROW_HEIGHT = 72;

const TaskItem = memo(function TaskItem({ taskId }: { taskId: string }) {
  const task = useTransferStore((s) => s.tasksById[taskId]);
  const removeTask = useTransferStore((s) => s.removeTask);
  const uploadBusy = useTransferStore(s => Object.values(s.tasksById).some(t => t.type === "upload" && (t.status === "pending" || t.status === "transferring")));

  if (!task) return null;

  const isActive = task.status === 'pending' || task.status === 'transferring';

  return (
    <TaskItemView
      task={task}
      onRetry={task.status === "failed" && task.retry && !uploadBusy ? () => { void task.retry?.(); } : undefined}
      onRemove={isActive ? undefined : () => removeTask(task.id)}
    />
  );
});

const TaskItemView = memo(function TaskItemView({
  task,
  onRemove,
  onRetry,
}: {
  task: TransferTask;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  const Icon = task.type === 'upload' ? Upload : Download;
  const StatusIcon = task.status === 'completed' ? Check
    : task.status === 'failed' ? AlertCircle
    : (task.status === 'cancelled' || task.status === 'skipped') ? Square
    : task.status === 'transferring' ? Loader2
    : null;
  const failure = task.status === 'failed' ? task.error : undefined;

  const estimatedTotal = task.speed && task.speed > 0
    ? (task.totalSize - task.transferredSize) / task.speed
    : 0;

  return (
    <div className="group px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-accent/50 border-b border-border/40 dark:border-border">
      <div className="flex items-start gap-2.5">
        <div className="p-1.5 rounded-lg shrink-0 bg-muted text-muted-foreground">
          <Icon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-sm font-medium text-zinc-900 dark:text-foreground truncate">
              {task.fileName}
            </p>
            {StatusIcon && (
              <StatusIcon className={`w-4 h-4 shrink-0 ${
                task.status === 'completed' ? 'text-emerald-500' :
                task.status === 'failed' ? 'text-red-500' :
                (task.status === 'cancelled' || task.status === 'skipped') ? 'text-zinc-400' :
                'text-muted-foreground animate-spin'
              }`} />
            )}
          </div>

          {failure && (
            <div className="mb-1 flex min-w-0 items-center gap-1 text-red-500">
              <Tooltip content={failure}><p className="min-w-0 truncate text-xs">{failure}</p></Tooltip>
              <Button type="button" variant="ghost" size="icon-xs" title="复制失败原因"
                aria-label={`复制 ${task.fileName} 的失败原因`} onClick={() => void copyTaskError(failure)}>
                <Copy />
              </Button>
            </div>
          )}

          {task.status === 'skipped' && <p className="text-xs text-zinc-400 mb-1">同名文件已跳过</p>}
          {task.status === 'cancelled' && (
            <p className="text-xs text-zinc-400 mb-1">已停止</p>
          )}
          {task.status === 'transferring' && (
            <>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-1.5">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-muted-foreground">
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
            <p className="text-xs text-zinc-500 dark:text-muted-foreground">
              {formatBytes(task.totalSize)}
              {task.endTime != null && ` · 用时 ${formatTime((task.endTime - task.startTime) / 1000)}`}
            </p>
          )}

          {task.status === 'pending' && (
            <p className="text-xs text-zinc-500 dark:text-muted-foreground">等待中...</p>
          )}
        </div>

        {onRetry && <Button variant="ghost" onClick={onRetry} title="重试上传" aria-label={`重试上传 ${task.fileName}`} className="h-auto shrink-0 rounded-md p-1 text-muted-foreground"><RotateCw className="size-4" /></Button>}
        {onRemove && (
          <Button variant="ghost"
            onClick={onRemove}
            className="h-auto p-0 opacity-0 group-hover:opacity-100 p-1 rounded-xs hover:bg-zinc-200 dark:hover:bg-accent shrink-0"
            title="移除"
          >
            <X className="w-3.5 h-3.5 text-zinc-500" />
          </Button>
        )}
      </div>
    </div>
  );
});

export function TransferPanel() {
  const taskIds = useTransferStore((s) => s.taskIds);
  const isPanelOpen = useTransferStore((s) => s.isPanelOpen);
  const setPanelOpen = useTransferStore((s) => s.setPanelOpen);
  const clearInactive = useTransferStore((s) => s.clearInactive);
  const cancelActiveUploads = useTransferStore((s) => s.cancelActiveUploads);
  const [stopping, setStopping] = useState(false);
  const summary = useTransferStore(useShallow((s) => {
    let active = 0, completed = 0, failed = 0, retryable = 0;
    let uploadCount = 0, uploadDone = 0, uploadFailed = 0;
    let uploadTotal = 0, uploadTransferred = 0;
    let uploadActive = 0;

    for (const id of s.taskIds) {
      const t = s.tasksById[id];
      if (!t) continue;
      if (t.status === 'transferring' || t.status === 'pending') active++;
      else if (t.status === 'completed') completed++;
      else if (t.status === 'failed') failed++;

      if (t.type !== 'upload') continue;
      if (t.status === 'failed' && t.retry) retryable++;
      uploadCount++;
      const size = Math.max(0, t.totalSize || 0);
      uploadTotal += size;
      if (t.status === 'completed') {
        uploadDone++;
        uploadTransferred += size;
      } else {
        if (t.status === 'pending' || t.status === 'transferring') uploadActive++;
        else uploadFailed++;
        uploadTransferred += Math.min(size, Math.max(0, t.transferredSize || 0));
      }
    }

    const uploadPercent = uploadTotal > 0
      ? Math.min(100, (uploadTransferred / uploadTotal) * 100)
      : uploadCount > 0
        ? ((uploadDone + uploadFailed) / uploadCount) * 100
        : 0;

    return {
      active,
      retryable,
      completed,
      failed,
      uploadCount,
      uploadDone,
      uploadFailed,
      uploadActive,
      uploadTotal,
      uploadTransferred,
      uploadPercent: uploadActive > 0 ? Math.min(99, uploadPercent) : uploadPercent,
    };
  }));

  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: taskIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (taskIds.length === 0) return null;

  // 多文件上传且仍有进行中任务时显示总进度
  const showOverall = summary.uploadCount >= 2 && summary.uploadActive > 0;
  const otherFinished = taskIds.length - summary.active - summary.completed - summary.failed;
  const collapsedSummary = [
    summary.active > 0 && `${summary.active} 个进行中`,
    summary.completed > 0 && `${summary.completed} 个已完成`,
    summary.failed > 0 && `${summary.failed} 个失败`,
    otherFinished > 0 && `${otherFinished} 个已取消或跳过`,
  ].filter(Boolean).join(" · ");

  const handleStopAll = async () => {
    if (stopping || summary.uploadActive === 0) return;
    setStopping(true);
    try {
      cancelActiveUploads();
      await invoke('cancel_uploads');
      toast.info('正在停止上传…', { description: '进行中的文件会尽快中断，未开始的已跳过' });
    } catch (err: any) {
      toast.error('停止失败', { description: String(err) });
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-popover text-popover-foreground rounded-xl shadow-md overflow-hidden z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-foreground">
            传输任务
          </h3>
          {summary.active > 0 && (
            <span className="text-xs text-muted-foreground">
              {summary.active} 进行中
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {summary.retryable > 0 && summary.uploadActive === 0 && <Button variant="ghost" title="重试全部失败上传" aria-label="重试全部失败上传" onClick={() => { if (!uploadsActive()) void retryFailedUploads(); }} className="h-auto rounded-md p-1.5 text-muted-foreground"><RotateCw className="size-4" /></Button>}
          {summary.uploadActive > 0 && (
            <Button variant="ghost"
              onClick={handleStopAll}
              disabled={stopping}
              className="h-auto p-0 p-1.5 rounded-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              title="停止全部上传"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </Button>
          )}
          {taskIds.length > summary.active && (
            <Button variant="ghost"
              onClick={clearInactive}
              className="h-auto p-0 p-1.5 rounded-xs hover:bg-zinc-200 dark:hover:bg-accent transition-colors"
              title="清除已结束的任务记录"
              aria-label="清除已结束的任务记录"
            >
              <Trash2 className="w-3.5 h-3.5 text-zinc-500" />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setPanelOpen(!isPanelOpen)}
            aria-expanded={isPanelOpen}
            title={isPanelOpen ? "收起传输面板" : "展开传输面板"}
            aria-label={isPanelOpen ? "收起传输面板" : "展开传输面板"}>
            {isPanelOpen ? <X /> : <ChevronUp />}
          </Button>
        </div>
      </div>

      {/* Overall upload progress */}
      {isPanelOpen && showOverall && (
        <div className="px-4 py-2.5 border-b border-border/60">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium text-foreground">
              上传总进度
            </span>
            <span className="tabular-nums text-zinc-500 dark:text-muted-foreground">
              {summary.uploadDone + summary.uploadFailed}/{summary.uploadCount} 个
              · {summary.uploadPercent.toFixed(0)}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, summary.uploadPercent))}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] tabular-nums text-zinc-500 dark:text-muted-foreground">
            {formatBytes(summary.uploadTransferred)} / {formatBytes(summary.uploadTotal)}
          </div>
        </div>
      )}

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

      {/* Summary when collapsed */}
      {!isPanelOpen && (
        <div className="px-4 py-2 text-xs text-zinc-500 dark:text-muted-foreground">
          {collapsedSummary}
        </div>
      )}
    </div>
  );
}
