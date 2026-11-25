import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { fetchFiles, generateDownloadUrl, type QiniuFile } from '../../lib/qiniu';
import { ensureTransferEvents, failActiveTransfers } from '../../lib/transfer-events';
import { formatBytes } from '../../lib/utils';
import { toast } from '../../lib/toast';
import { useTransferStore } from '../../store/transfer';

interface FileDownloadsOptions {
  ak: string;
  sk: string;
  bucket: string;
  domains: string[];
  isPrivateBucket: boolean;
  mounted: RefObject<boolean>;
  selectedKeys: Set<string>;
  onSelectionReset: () => void;
}

/** Coordinates download confirmation, signed URLs, task creation and folder enumeration. */
export function useFileDownloads({ ak, sk, bucket, domains, isPrivateBucket, mounted, selectedKeys, onSelectionReset }: FileDownloadsOptions) {
  const setPanelOpen = useTransferStore(s => s.setPanelOpen);
  const [downloadPrompt, setDownloadPrompt] = useState<string | null>(null);
  const downloadPromptResolver = useRef<((confirmed: boolean) => void) | null>(null);
  useEffect(() => () => downloadPromptResolver.current?.(false), []);

  const confirmDownload = (message: string) => {
    if (downloadPromptResolver.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      downloadPromptResolver.current = resolve;
      setDownloadPrompt(message);
    });
  };

  const finishDownloadPrompt = (confirmed: boolean) => {
    downloadPromptResolver.current?.(confirmed);
    downloadPromptResolver.current = null;
    setDownloadPrompt(null);
  };

  const handleDownload = async (key: string) => {
    if (domains.length === 0) {
      toast.warning("此存储空间未绑定外链域名，无法下载", {
        description: "请先在「CDN → 域名」绑定域名后再试",
      });
      return;
    }
    const filename = key.split('/').pop() || key;
    const savePath = await save({
      title: "保存文件",
      defaultPath: filename,
    });
    if (!savePath) return;
    const url = generateDownloadUrl(ak, sk, domains[0], key, isPrivateBucket);
    const tid = toast.loading(`正在下载 ${filename}...`, { duration: Infinity });
    try {
      await invoke("download_file", { url, savePath });
      toast.dismiss(tid);
      toast.success("下载完成", { description: filename });
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error("下载失败", { description: String(err) });
    }
  };

  const handleBatchDownload = async () => {
    const keys = [...selectedKeys];
    if (keys.length === 0) return;
    if (domains.length === 0) {
      toast.warning('此存储空间未绑定外链域名，无法下载', {
        description: '请先在「CDN → 域名」绑定域名后再试',
      });
      return;
    }
    try {
      const dir = await open({ directory: true, title: '选择保存目录' });
      if (!dir || Array.isArray(dir) || !mounted.current) return;
      await downloadBatch(keys.map(key => ({ key, name: key.split('/').pop() || key })), dir);
      onSelectionReset();
    } catch (err: any) {
      toast.error('批量下载失败', { description: String(err) });
    }
  };

  const downloadBatch = async (files: { key: string; name: string }[], dir: string) => {
    await ensureTransferEvents();
    if (!mounted.current) return;
    const items = files.map(({ key, name }) => [
      generateDownloadUrl(ak, sk, domains[0], key, isPrivateBucket),
      name,
    ]);
    const taskIds = useTransferStore.getState().addTasks(files.map(({ name }) => ({
      type: "download",
      fileName: name,
      totalSize: 0,
    })));
    setPanelOpen(true);
    try {
      const result = await invoke<{ downloaded: string[]; failed: string[] }>(
        'download_files_to_dir', { items, dir, taskIds },
      );
      if (result.failed.length > 0) {
        toast.warning("下载未完全成功", { description: `成功 ${result.downloaded.length} 个，失败 ${result.failed.length} 个` });
      }
    } catch (error) {
      failActiveTransfers(taskIds, error);
      throw error;
    }
  };

  const handleDownloadFolder = async (folderPrefix: string) => {
    if (domains.length === 0) {
      toast.warning('此存储空间未绑定外链域名，无法下载', {
        description: '请先在「CDN → 域名」绑定域名后再试',
      });
      return;
    }

    let loadingToast: string | undefined;
    try {
      const dir = await open({ directory: true, title: '选择保存目录' });
      if (!dir || Array.isArray(dir) || !mounted.current) return;
      const allFiles: QiniuFile[] = [];
      const seenMarkers = new Set<string>();
      let marker = "";
      loadingToast = toast.loading('正在获取文件夹内容...');
      do {
        const res = await fetchFiles(ak, sk, bucket, folderPrefix, marker, 1000);
        if (!mounted.current) return;
        allFiles.push(...(res.items || []).filter(file => !file.key.endsWith('/')));
        marker = res.marker || "";
        if (marker && seenMarkers.has(marker)) throw new Error("文件夹分页游标重复");
        seenMarkers.add(marker);
        toast.loading(`已获取 ${allFiles.length} 个文件...`, { id: loadingToast });
      } while (marker);
      toast.dismiss(loadingToast);
      loadingToast = undefined;

      if (allFiles.length === 0) {
        toast.info('文件夹为空');
        return;
      }

      const folderName = folderPrefix.slice(0, -1).split('/').pop() || 'folder';

      if (allFiles.length > 100) {
        const totalSize = allFiles.reduce((sum, f) => sum + f.fsize, 0);
        const confirmed = await confirmDownload(
          `即将下载 ${allFiles.length} 个文件，总大小约 ${formatBytes(totalSize)}。\n\n是否继续？`
        );
        if (!confirmed) return;
      }

      await downloadBatch(allFiles.map(({ key }) => ({
        key,
        name: folderName + '/' + key.slice(folderPrefix.length),
      })), dir);
    } catch (err) {
      toast.error('下载文件夹失败', { description: String(err) });
    } finally {
      if (loadingToast) toast.dismiss(loadingToast);
    }
  };

  return { downloadPrompt, finishDownloadPrompt, handleDownload, handleBatchDownload, handleDownloadFolder };
}
