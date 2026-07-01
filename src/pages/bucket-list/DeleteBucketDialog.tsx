import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

export function DeleteBucketDialog({
  bucketName,
  confirmInput,
  setConfirmInput,
  onConfirm,
  onCancel,
}: {
  bucketName: string | null;
  confirmInput: string;
  setConfirmInput: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!bucketName) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden p-6 text-center">
        <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
          <Trash2 className="h-6 w-6 text-red-600 dark:text-red-500" />
        </div>
        <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mb-2">确认删除空间？</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
          删除后该空间内所有文件将永久丢失，且无法恢复。请输入空间名称 <strong className="text-red-500 select-all">{bucketName}</strong> 以确认。
        </p>
        <input
          type="text"
          autoFocus
          placeholder={bucketName}
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && confirmInput === bucketName) onConfirm();
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full px-3 py-2 mb-5 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 font-mono"
        />
        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            disabled={confirmInput !== bucketName}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:pointer-events-none"
          >
            确认删除，不可恢复
          </button>
          <button
            onClick={onCancel}
            className="w-full px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
