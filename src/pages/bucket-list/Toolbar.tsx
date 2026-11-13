import { Filter, Search } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Input } from "../../components/ui/input";

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

  const items = [
    { value: "all", label: "全部区域" },
    ...regions.map(r => ({ value: r, label: formatRegion(r) })),
  ];

  return (
    <Select
      items={items}
      value={regionFilter}
      onValueChange={value => {
        if (value !== null) setRegionFilter(value);
      }}
    >
      <SelectTrigger aria-label="筛选区域" className="w-36">
        <Filter className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="!w-auto min-w-36">
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    <div className="relative w-56">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        className="pl-8"
        aria-label={placeholder}
      />
    </div>
  );
}
