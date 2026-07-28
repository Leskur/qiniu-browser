import { useState, useEffect, useRef, useMemo, useCallback, startTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { X, Folder, File, CheckSquare, Square, Loader2 } from "lucide-react";
import { formatBytes } from "../lib/utils";

interface FileInfo {
  path: string;
  name: string;
  size: number;
  relative_path: string;
}

interface ScanResult {
  files: FileInfo[];
  total_size: number;
  total_count: number;
}

interface FolderUploadDialogProps {
  folderPath: string;
  onConfirm: (selectedFiles: { path: string; relativePath: string }[]) => void;
  onCancel: () => void;
}

const ROW_HEIGHT = 52;

export function FolderUploadDialog({ folderPath, onConfirm, onCancel }: FolderUploadDialogProps) {
  const [loading, setLoading] = useState(true);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
  const files = scanResult?.files ?? [];

  useEffect(() => {
    invoke<ScanResult>("scan_folder", { folderPath })
      .then((result) => {
        setScanResult(result);
        setSelectedFiles(new Set(result.files.map(f => f.path)));
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [folderPath]);

  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const toggleFile = useCallback((path: string) => {
    startTransition(() => {
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!scanResult) return;
    startTransition(() => {
      if (selectedFiles.size === scanResult.files.length) {
        setSelectedFiles(new Set());
      } else {
        setSelectedFiles(new Set(scanResult.files.map(f => f.path)));
      }
    });
  }, [scanResult, selectedFiles.size]);

  const allSelected = !!scanResult && selectedFiles.size === scanResult.files.length && scanResult.files.length > 0;

  const selectedSize = useMemo(() => {
    if (!scanResult || selectedFiles.size === 0) return 0;
    if (selectedFiles.size === scanResult.files.length) return scanResult.total_size;
    let sum = 0;
    for (const f of scanResult.files) {
      if (selectedFiles.has(f.path)) sum += f.size;
    }
    return sum;
  }, [scanResult, selectedFiles]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
              <Folder className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                上传文件夹
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate max-w-md">
                {folderName}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
              <p className="text-sm text-zinc-500">正在扫描文件夹...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-red-500 font-medium mb-2">扫描失败</p>
              <p className="text-sm text-zinc-500">{error}</p>
            </div>
          ) : scanResult ? (
            <>
              {/* Summary */}
              <div className="flex items-center justify-between mb-4 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">
                    共 <strong className="text-zinc-900 dark:text-zinc-100">{scanResult.total_count}</strong> 个文件
                  </span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    总大小 <strong className="text-zinc-900 dark:text-zinc-100">{formatBytes(scanResult.total_size)}</strong>
                  </span>
                </div>
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                >
                  {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  全选
                </button>
              </div>

              {/* Virtualized File List */}
              <div
                ref={scrollRef}
                className="h-80 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-y-auto"
              >
                <div
                  className="relative w-full"
                  style={{ height: rowVirtualizer.getTotalSize() }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const file = files[virtualRow.index];
                    const checked = selectedFiles.has(file.path);
                    return (
                      <label
                        key={file.path}
                        className="absolute left-0 w-full flex items-center gap-3 px-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer border-b border-zinc-100 dark:border-zinc-800"
                        style={{
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFile(file.path)}
                          className="size-4 shrink-0 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500/30"
                        />
                        <File className="w-4 h-4 text-zinc-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                            {file.relative_path}
                          </p>
                        </div>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 tabular-nums shrink-0">
                          {formatBytes(file.size)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        {scanResult && !loading && !error && (
          <div className="flex items-center justify-between px-6 py-4 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              已选择 <strong className="text-zinc-900 dark:text-zinc-100">{selectedFiles.size}</strong> 个文件
              {selectedFiles.size > 0 && (
                <span className="ml-2">
                  · {formatBytes(selectedSize)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const selected = files
                    .filter((f) => selectedFiles.has(f.path))
                    .map((f) => ({ path: f.path, relativePath: f.relative_path }));
                  onConfirm(selected);
                }}
                disabled={selectedFiles.size === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:pointer-events-none rounded-lg transition-colors"
              >
                开始上传
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
