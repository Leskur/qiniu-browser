import { invoke } from '@tauri-apps/api/core';
import { useTransferStore } from '../store/transfer';
import { toast } from './toast';
import { ensureTransferEvents } from './transfer-events';

let retrying = false;
export function uploadsActive() {
  return Object.values(useTransferStore.getState().tasksById).some(t => t.type === 'upload' && (t.status === 'pending' || t.status === 'transferring'));
}

export function createUploadRetry(id: string, context: { ak: string; sk: string; bucket: string; filePath: string; key: string; conflictPolicy: string }) {
  return async () => {
    const store = useTransferStore.getState();
    if (retrying || uploadsActive() || store.tasksById[id]?.status !== 'failed') return;
    retrying = true;
    store.updateTask(id, { status: 'pending', progress: 0, transferredSize: 0, error: undefined, startTime: Date.now(), endTime: undefined });
    try {
      await ensureTransferEvents();
      if (useTransferStore.getState().tasksById[id]?.status !== 'pending') return;
      const result = await invoke<{ uploaded: string[]; skipped: string[]; failed: string[] }>('upload_files', {
        ak: context.ak, sk: context.sk, bucket: context.bucket, prefix: '',
        filePaths: [context.filePath], relativePaths: [context.key], conflictPolicy: context.conflictPolicy, taskIds: [id],
      });
      const task = useTransferStore.getState().tasksById[id];
      if (result.uploaded.length) store.updateTask(id, { status: 'completed', progress: 100, transferredSize: task?.totalSize || 0, endTime: Date.now() });
      else if (result.skipped.length) store.updateTask(id, { status: 'skipped', error: '同名文件已跳过', endTime: Date.now() });
      else if (result.failed.length) store.updateTask(id, { status: 'failed', error: result.failed.join('\n'), endTime: Date.now() });
      else store.updateTask(id, { status: 'cancelled', endTime: Date.now() });
    } catch (error) {
      store.updateTask(id, { status: 'failed', error: String(error), endTime: Date.now() });
    } finally {
      retrying = false;
    }
  };
}

export async function retryFailedUploads() {
  if (retrying || uploadsActive()) { toast.info('请等待当前上传结束后重试'); return; }
  const failed = Object.values(useTransferStore.getState().tasksById).filter(t => t.type === 'upload' && t.status === 'failed' && t.retry);
  for (const task of failed) {
    if (uploadsActive()) break;
    await task.retry?.();
    if (useTransferStore.getState().tasksById[task.id]?.status === 'cancelled') break;
  }
}
