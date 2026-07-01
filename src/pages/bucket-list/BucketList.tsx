import { useState, useMemo, useEffect } from "react";
import { createBucket, forceDeleteBucket } from "../../lib/qiniu";
import { useAppStore } from "../../store";
import { toast } from "sonner";
import { SortField, formatRegion } from "./constants";
import { BucketListHeader } from "./BucketListHeader";
import { RegionFilterSelect, SearchInput } from "./Toolbar";
import { Plus, RefreshCw } from "lucide-react";
import { LoadingOverlay } from "../../components/LoadingOverlay";
import { BucketTable } from "./BucketTable";
import { CreateBucketDialog } from "./CreateBucketDialog";
import { DeleteBucketDialog } from "./DeleteBucketDialog";

export function BucketList({
  ak,
  sk,
  onSelectBucket,
  scrollPosition = 0,
  onScrollPositionRestored
}: {
  ak: string,
  sk: string,
  onSelectBucket: (bucket: string) => void,
  scrollPosition?: number,
  onScrollPositionRestored?: () => void
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const { buckets, bucketsLoading: loading, bucketsRefreshing: refreshing, bucketsError: error, loadBuckets, refreshBuckets, getTotalStats } = useAppStore();
  const stats = getTotalStats();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [newBucketRegion, setNewBucketRegion] = useState("z0");
  const [isCreating, setIsCreating] = useState(false);
  const [deletingBucket, setDeletingBucket] = useState<string | null>(null);
  const [bucketToDelete, setBucketToDelete] = useState<string | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDesc) {
        setSortField(null);
      } else {
        setSortDesc(true);
      }
    } else {
      setSortField(field);
      setSortDesc(false);
    }
  };

  const regions = useMemo(() => {
    const set = new Set(buckets.map(b => b.region));
    return Array.from(set);
  }, [buckets]);

  const processedBuckets = useMemo(() => {
    let result = buckets.filter(bucket =>
      bucket.tbl.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (regionFilter !== "all") {
      result = result.filter(b => b.region === regionFilter);
    }

    if (sortField) {
      result = [...result].sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDesc ? valB - valA : valA - valB;
        }
        return 0;
      });
    }

    return result;
  }, [buckets, searchQuery, sortField, sortDesc, regionFilter]);

  useEffect(() => {
    if (buckets.length === 0 && !loading && !error) {
      loadBuckets(ak, sk);
    }
  }, []);

  const handleRefresh = () => {
    refreshBuckets(ak, sk);
  };

  useEffect(() => {
    if (scrollPosition > 0 && !loading && !refreshing && processedBuckets.length > 0) {
      requestAnimationFrame(() => {
        const scrollArea = document.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollArea) {
          scrollArea.scrollTop = scrollPosition;
          onScrollPositionRestored?.();
        }
      });
    }
  }, [scrollPosition, loading, refreshing, processedBuckets.length, onScrollPositionRestored]);

  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBucketName.trim()) return;

    setIsCreating(true);
    try {
      await createBucket(ak, sk, newBucketName.trim(), newBucketRegion);
      setShowCreateDialog(false);
      setNewBucketName("");
      setNewBucketRegion("z0");
      toast.success("空间创建成功");
      refreshBuckets(ak, sk);
    } catch (err: any) {
      toast.error("创建失败", { description: err.message });
    } finally {
      setIsCreating(false);
    }
  };

  const executeDelete = async (bucketName: string) => {
    setBucketToDelete(null);
    setDeletingBucket(bucketName);
    const tid = toast.loading(`正在清空并删除空间 ${bucketName}...`);
    try {
      await forceDeleteBucket(ak, sk, bucketName);
      toast.dismiss(tid);
      toast.success(`空间 ${bucketName} 已删除`);
      refreshBuckets(ak, sk);
    } catch (err: any) {
      toast.dismiss(tid);
      toast.error("删除失败", { description: err.message });
    } finally {
      setDeletingBucket(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 relative h-full">
      {!loading && !error && (
        <BucketListHeader stats={stats} />
      )}

      {!loading && !error && (
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> 新建空间
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-sm font-medium transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
            title="刷新列表"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <div className="flex-1" />
          <RegionFilterSelect
            regions={regions}
            regionFilter={regionFilter}
            setRegionFilter={setRegionFilter}
            formatRegion={formatRegion}
          />
          <SearchInput
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
        </div>
      )}

      <div className="relative flex-1 flex flex-col min-h-0 p-4 pt-3">
        <BucketTable
          buckets={processedBuckets}
          stats={stats}
          loading={loading}
          error={error}
          searchQuery={searchQuery}
          sortField={sortField}
          sortDesc={sortDesc}
          deletingBucket={deletingBucket}
          onSelectBucket={onSelectBucket}
          onDeleteBucket={(name: string) => { setBucketToDelete(name); setDeleteConfirmInput(""); }}
          onSort={handleSort}
          formatRegion={formatRegion}
        />
        <LoadingOverlay loading={refreshing} text="正在刷新..." />
      </div>

      <CreateBucketDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        bucketName={newBucketName}
        setBucketName={setNewBucketName}
        bucketRegion={newBucketRegion}
        setBucketRegion={setNewBucketRegion}
        isCreating={isCreating}
        onSubmit={handleCreateBucket}
      />

      <DeleteBucketDialog
        bucketName={bucketToDelete}
        confirmInput={deleteConfirmInput}
        setConfirmInput={setDeleteConfirmInput}
        onConfirm={() => bucketToDelete && executeDelete(bucketToDelete)}
        onCancel={() => { setBucketToDelete(null); setDeleteConfirmInput(""); }}
      />
    </div>
  );
}
