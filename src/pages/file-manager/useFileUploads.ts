import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { createUploadRetry } from '../../lib/upload-retry';
import { ensureTransferEvents, failActiveTransfers } from '../../lib/transfer-events';
import { toast } from '../../lib/toast';
import { useTransferStore } from '../../store/transfer';

interface FileUploadsOptions {
  ak: string;
  sk: string;
  bucket: string;
  currentPrefix: string;
  mounted: RefObject<boolean>;
  onUploaded: (prefix: string) => void;
}

/** Coordinates file selection, conflict confirmation, task creation and upload results. */
export function useFileUploads({ ak, sk, bucket, currentPrefix, mounted, onUploaded }: FileUploadsOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const setPanelOpen = useTransferStore(s => s.setPanelOpen);
  const [uploadChoice, setUploadChoice] = useState<{
    sourcePath: string;
    selectionCount: number;
    destination: string;
    fileCount: number;
    totalSize: number;
  } | null>(null);
  const uploadChoiceResolver = useRef<((value: string | null) => void) | null>(null);
  const [overwriteUpload, setOverwriteUpload] = useState(false);
  const uploadPending = useRef(false);
  useEffect(() => () => uploadChoiceResolver.current?.(null), []);
  const finishUploadChoice = (value: string | null) => {
    uploadChoiceResolver.current?.(value);
    uploadChoiceResolver.current = null;
    setUploadChoice(null);
  };
  const handleUploadPaths = async (paths: string[]) => {
    if (!mounted.current || paths.length === 0 || uploadPending.current) return;
    uploadPending.current = true;
    let taskIds: string[] = [];

    try {
      const files = await invoke<{ path: string; key: string; size: number }[]>('prepare_uploads', {
        filePaths: paths,
        prefix: currentPrefix,
        relativePaths: null,
      });
      if (!mounted.current) return;
      if (files.length === 0) {
        toast.info("所选目录中没有可上传的文件");
        return;
      }
      setOverwriteUpload(false);
      const policy = await new Promise<string | null>(resolve => {
        uploadChoiceResolver.current = resolve;
        setUploadChoice({
          sourcePath: paths[0],
          selectionCount: paths.length,
          destination: `${bucket}/${currentPrefix}`,
          fileCount: files.length,
          totalSize: files.reduce((total, file) => total + file.size, 0),
        });
      });
      if (!policy) return;
      await ensureTransferEvents();
      if (!mounted.current) return;
      setIsUploading(true);
      const transfers = useTransferStore.getState();
      taskIds = transfers.addTasks(files.map(({ path, key, size }) => ({
        type: 'upload',
        fileName: key,
        filePath: path,
        totalSize: size,
      })));
      transfers.batchUpdateTasks(new Map(files.map(({ path, key }, index) => {
        const id = taskIds[index];
        return [id, { retry: createUploadRetry(id, { ak, sk, bucket, filePath: path, key, conflictPolicy: policy }) }];
      })));
      const upload = invoke<{ uploaded: string[]; failed: string[]; skipped: string[]; cancelled: number }>('upload_files', {
        ak, sk, bucket,
        filePaths: files.map(({ path }) => path),
        prefix: '',
        relativePaths: files.map(({ key }) => key),
        taskIds,
        conflictPolicy: policy,
      });
      setPanelOpen(true);
      const result = await upload;

      const summary = `成功 ${result.uploaded.length} 个，跳过 ${result.skipped.length} 个，失败 ${result.failed.length} 个，取消 ${result.cancelled} 个`;
      if (result.failed.length > 0) toast.warning('上传结束，部分文件失败', { description: summary });
      else if (result.cancelled > 0) toast.info('上传已停止', { description: summary });
      else toast.success('上传结束', { description: summary });
      onUploaded(currentPrefix);
    } catch (err) {
      failActiveTransfers(taskIds, err);
      toast.error('上传失败', { description: String(err) });
    } finally {
      setIsUploading(false);
      uploadPending.current = false;
    }
  };

  const handleUpload = async (directory: boolean) => {
    try {
      const selected = await open({
        multiple: !directory, directory,
        title: directory ? "选择要上传的文件夹" : "选择要上传的文件",
      });
      if (!selected) return;
      const paths: string[] = Array.isArray(selected) ? selected : [selected];

      void handleUploadPaths(paths);
    } catch (err: any) {
      toast.error("打开文件对话框失败", { description: err.message });
    }
  };

  return { isUploading, uploadChoice, overwriteUpload, setOverwriteUpload, finishUploadChoice, handleUploadPaths, handleUpload };
}
