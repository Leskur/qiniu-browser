import { useTransferStore, TransferTask } from "../store/transfer";
import { X, ChevronDown, ChevronUp, Upload, Download, Check, AlertCircle, Trash2, Loader2 } from "lucide-react";
import { formatBytes } from "../lib/utils";
import { ScrollArea } from "./ui/scroll-area";

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

function TaskItem({ task }: { task: TransferTask }) {
  const removeTask = useTransferStore((state) => state.removeTask);
  
  const Icon = task.type === 'upload' ? Upload : Download;
  const StatusIcon = task.status === 'completed' ? Check
    : task.status === 'failed' ? AlertCircle
    : task.status === 'transferring' ? Loader2
    : null;
  
  const elapsed = task.endTime
    ? (task.endTime - task.startTime) / 1000
    : (Date.now() - task.startTime) / 1000;
  
  const estimatedTotal = task.speed && task.speed > 0
    ? (task.totalSize - task.transferredSize) / task.speed
    : 0;
  
  return (
    <div className="group px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors border-b border-zinc-100 dark:border-zinc-800 last:border-0">
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
                  className={`h-full transition-all duration-300 ${
                    task.type === 'upload'
                      ? 'bg-emerald-500'
                      : 'bg-blue-500'
                  }`}
                  style={{ width: `${task.progress}%` }}
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
              {formatBytes(task.totalSize)} · 用时 {formatTime(elapsed)}
            </p>
          )}
          
          {task.status === 'pending' && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">等待中...</p>
          )}
        </div>
        
        <button
          onClick={() => removeTask(task.id)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all shrink-0"
          title="移除"
        >
          <X className="w-3.5 h-3.5 text-zinc-500" />
        </button>
      </div>
    </div>
  );
}

export function TransferPanel() {
  const { tasks, isPanelOpen, togglePanel, clearCompleted, clearAll } = useTransferStore();
  
  const activeTasks = tasks.filter(t => t.status === 'transferring' || t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed');
  const failedTasks = tasks.filter(t => t.status === 'failed');
  
  if (tasks.length === 0) return null;
  
  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            传输任务
          </h3>
          {activeTasks.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
              {activeTasks.length} 进行中
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {completedTasks.length > 0 && (
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
      
      {/* Task List */}
      {isPanelOpen && (
        <ScrollArea className="max-h-96">
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {tasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        </ScrollArea>
      )}
      
      {/* Summary */}
      {!isPanelOpen && (
        <div className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
          {activeTasks.length > 0 && `${activeTasks.length} 个任务进行中`}
          {completedTasks.length > 0 && ` · ${completedTasks.length} 个已完成`}
          {failedTasks.length > 0 && ` · ${failedTasks.length} 个失败`}
        </div>
      )}
    </div>
  );
}
