import { Filter, Search } from "lucide-react";

export function RegionFilterSelect({
  regions,
  regionFilter,
  setRegionFilter,
  formatRegion,
}: {
  regions: string[];
  regionFilter: string;
  setRegionFilter: (v: string) => void;
  formatRegion: (code: string) => string;
}) {
  if (regions.length <= 1) return null;

  return (
    <div className="relative">
      <Filter className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <select
        value={regionFilter}
        onChange={(e) => setRegionFilter(e.target.value)}
        className="pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all cursor-pointer appearance-none"
      >
        <option value="all">全部区域</option>
        {regions.map(r => (
          <option key={r} value={r}>{formatRegion(r)}</option>
        ))}
      </select>
    </div>
  );
}

export function SearchInput({
  searchQuery,
  setSearchQuery,
  placeholder = "搜索空间名称...",
}: {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        type="text"
        placeholder={placeholder}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="pl-8 pr-3 py-1.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-all w-56 cursor-text"
      />
    </div>
  );
}
