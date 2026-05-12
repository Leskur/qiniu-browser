import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Folder, File, CheckSquare, Square, Loader2 } from "lucide-react";
import { formatBytes } from "./FileManager";
import { ScrollArea } from "./ui/scroll-area";
import { Checkbox } from "./ui/checkbox";

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
  onConfirm: (selectedFiles: string[]) => void;
  onCancel: () => void;
}

export function FolderUploadDialog({ folderPath, onConfirm, onCancel }: FolderUploadDialogProps) {
  const [loading, setLoading] = useState(true);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  
  const folderName = folderPath.split(/[/\\]/).pop() || folderPath;
  
  useEffect(() => {
    invoke<ScanResult>("scan_folder", { folderPath })
      .then((result) => {
        setScanResult(result);
        // Select all files by default
        setSelectedFiles(new Set(result.files.map(f => f.path)));
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [folderPath]);
  
  const toggleFile = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  
  const toggleAll = () => {
    if (!scanResult) return;
    if (selectedFiles.size === scanResult.files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(scanResult.files.map(f => f.path)));
    }
  };
  
  const selectedSize = scanResult
    ? scanResult.files
        .filter(f => selectedFiles.has(f.path))
        .reduce((sum, f) => sum + f.size, 0)
    : 0;
  
  const allSelected = scanResult && selectedFiles.size === scanResult.files.length;
  
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
                  {allSelected ? (
                    <>
                      <CheckSquare className="w-4 h-4" />
                      全不选
                    </>
                  ) : (
                    <>
                      <Square className="w-4 h-4" />
                      全选
                    </>
                  )}
                </button>
              </div>
              
              {/* File List */}
              <ScrollArea className="h-80 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {scanResult.files.map((file) => (
                    <label
                      key={file.path}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedFiles.has(file.path)}
                        onCheckedChange={() => toggleFile(file.path)}
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
                  ))}
                </div>
              </ScrollArea>
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
                onClick={() => onConfirm(Array.from(selectedFiles))}
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
