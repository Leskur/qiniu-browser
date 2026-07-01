import { createPortal } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { REGION_MAP } from "./constants";

export function CreateBucketDialog({
  open,
  onClose,
  bucketName,
  setBucketName,
  bucketRegion,
  setBucketRegion,
  isCreating,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  setBucketName: (v: string) => void;
  bucketRegion: string;
  setBucketRegion: (v: string) => void;
  isCreating: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="p-6">
          <h3 className="text-xl font-bold text-zinc-800 dark:text-zinc-100 mb-6">新建存储空间 (Bucket)</h3>
          <form onSubmit={onSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">空间名称</label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="由 3～63 个字符组成，支持小写字母、数字、短划线"
                  value={bucketName}
                  onChange={(e) => setBucketName(e.target.value)}
                  className="w-full px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">存储区域</label>
                <Select value={bucketRegion} onValueChange={setBucketRegion}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REGION_MAP)
                      .sort(([codeA, nameA], [codeB, nameB]) => {
                        const isShortA = !codeA.includes('-');
                        const isShortB = !codeB.includes('-');
                        if (isShortA && !isShortB) return -1;
                        if (!isShortA && isShortB) return 1;
                        return nameA.localeCompare(nameB, 'zh-CN');
                      })
                      .map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {name} ({code})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-8 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isCreating || !bucketName}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isCreating ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>创建中...</>
                ) : "确定创建"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
}
