import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableSortButton } from "@/components/ui/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { CdnDomain, fetchCdnDomain, fetchCdnDomains, onlineCdnDomain, offlineCdnDomain, deleteCdnDomain } from "../lib/qiniu";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, ExternalLink, FileSearch, Filter, Globe, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";
import { Tooltip } from "../components/ui/tooltip";
import { PageState } from "../components/PageState";
import { PageToolbar } from "../components/PageToolbar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";

type Action = "online" | "offline" | "delete";
type SortField = "name" | "operatingState" | "protocol" | "geoCover";
const actionNames: Record<Action, string> = { online: "上线", offline: "下线", delete: "删除" };
const statusItems = [{ value: "all", label: "全部状态" }, { value: "online", label: "在线" }, { value: "offline", label: "离线" }, { value: "frozen", label: "冻结" }, { value: "processing", label: "配置中" }, { value: "failed", label: "失败" }];
const regionItems = [{ value: "all", label: "全部区域" }, { value: "china", label: "中国大陆" }, { value: "foreign", label: "海外" }, { value: "global", label: "全球" }];

function status(state: string) {
  if (state === "success") return "online";
  if (["offline", "offlined"].includes(state)) return "offline";
  if (state === "frozen") return "frozen";
  if (["failed", "failure"].includes(state)) return "failed";
  return state;
}

function statusLabel(state: string) {
  return statusItems.find(item => item.value === status(state))?.label ?? (state || "未知");
}

function StatusBadge({ state }: { state: string }) {
  const value = status(state);
  return <Badge variant={value === "failed" || value === "frozen" ? "destructive" : "secondary"}>{statusLabel(state)}</Badge>;
}

function region(value: string) {
  return value === "overseas" ? "foreign" : value;
}

function regionLabel(value: string) {
  return regionItems.find(item => item.value === region(value))?.label ?? (value || "-");
}

function isWildcard(value: string) { return value === "wildcard" || value === "pan"; }

function formatTime(value?: string | number) {
  if (!value) return "-";
  const date = new Date(typeof value === "number" ? value * 1000 : value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
}

function FilterSelect({ label, value, items, onChange }: { label: string; value: string; items: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <Select items={items} value={value} onValueChange={v => { if (v !== null) onChange(v); }}>
      <SelectTrigger aria-label={label} className="w-36 shrink-0">
        <Filter className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="!w-auto min-w-32">
        {items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function InfoRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-border/60">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 py-3 text-xs first:pt-0 last:pb-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-all">{value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DomainManager({ ak, sk, isActive, selectedDomain, onSelectDomain, onRefreshDomain, refreshTrigger }: {
  ak: string; sk: string; selectedDomain: string | null;
  isActive: boolean;
  onSelectDomain: (domain: string | null) => void;
  onRefreshDomain: (domain: string) => void; refreshTrigger?: number;
}) {
  const [domains, setDomains] = useState<CdnDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [descending, setDescending] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const listRequest = useRef(0);
  const [detailState, setDetailState] = useState<{
    domain: string | null; data: CdnDomain | null; loading: boolean; error: string;
  }>({ domain: null, data: null, loading: false, error: "" });
  const [detailVersion, setDetailVersion] = useState(0);
  const [pending, setPending] = useState<Action | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDomains = useCallback(async () => {
    const version = ++listRequest.current;
    setLoading(true); setListError("");
    try {
      const result: CdnDomain[] = [];
      const markers = new Set<string>();
      let marker = "";
      do {
        const page = await fetchCdnDomains(ak, sk, marker, 100);
        if (version !== listRequest.current) return;
        result.push(...(page.domains || []));
        marker = page.marker || "";
        if (marker && markers.has(marker)) throw new Error("域名列表分页异常，请重试");
        markers.add(marker);
      } while (marker);
      setDomains(result);
    } catch (error) {
      if (version === listRequest.current) setListError(error instanceof Error ? error.message : String(error));
    } finally { if (version === listRequest.current) setLoading(false); }
  }, [ak, sk]);

  useEffect(() => {
    setDomains([]); onSelectDomain(null);
    loadDomains();
    return () => { listRequest.current++; };
  }, [loadDomains]);
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) { loadDomains(); setDetailVersion(value => value + 1); }
  }, [refreshTrigger]);

  const isFiltered = search.trim() !== "" || statusFilter !== "all" || regionFilter !== "all";

  const visibleDomains = useMemo(() => {
    const query = search.trim().toLowerCase();
    return domains.filter(domain => (!query || `${domain.name} ${domain.cname || ""}`.toLowerCase().includes(query))
      && (statusFilter === "all" || status(domain.operatingState) === statusFilter)
      && (regionFilter === "all" || region(domain.geoCover) === regionFilter))
      .sort((a, b) => (a[sortField] || "").localeCompare(b[sortField] || "") * (descending ? -1 : 1));
  }, [domains, search, statusFilter, regionFilter, descending, sortField]);

  const activeDomain = isActive && visibleDomains.some(domain => domain.name === selectedDomain)
    ? selectedDomain : null;
  const detail = detailState.domain === activeDomain ? detailState.data : null;
  const detailError = detailState.domain === activeDomain ? detailState.error : "";
  const detailLoading = activeDomain !== null && (detailState.domain !== activeDomain || detailState.loading);

  useEffect(() => {
    if (selectedDomain && !activeDomain) onSelectDomain(null);
  }, [selectedDomain, activeDomain, onSelectDomain]);

  useEffect(() => {
    let cancelled = false;
    setConfirmOpen(false); setConfirmation("");
    setDetailState({ domain: activeDomain, data: null, loading: !!activeDomain, error: "" });
    if (!activeDomain) return;
    fetchCdnDomain(ak, sk, activeDomain).then(data => {
      if (!cancelled) setDetailState({ domain: activeDomain, data, loading: false, error: "" });
    }).catch(error => {
      if (!cancelled) setDetailState({ domain: activeDomain, data: null, loading: false, error: error instanceof Error ? error.message : String(error) });
    });
    return () => { cancelled = true; };
  }, [ak, sk, activeDomain, detailVersion]);

  useEffect(() => {
    if (!activeDomain || busy || confirmOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      const focusedElement = document.activeElement;
      if (focusedElement instanceof HTMLElement && focusedElement.hasAttribute("data-domain-detail-trigger")) {
        focusedElement.blur();
      }
      onSelectDomain(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeDomain, busy, confirmOpen, onSelectDomain]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setDescending(value => !value);
    else { setSortField(field); setDescending(false); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="ml-1 inline-block size-3 text-zinc-300 dark:text-zinc-700" />;
    return descending
      ? <ArrowDown className="ml-1 inline-block size-3 text-emerald-500" />
      : <ArrowUp className="ml-1 inline-block size-3 text-emerald-500" />;
  };

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); toast.success(`已复制${label}`); }
    catch { toast.error("复制失败，请重试"); }
  };

  const executeAction = async () => {
    if (!pending || !detail || busy || (pending === "delete" && confirmation !== detail.name)) return;
    const action = pending, name = detail.name;
    setBusy(true);
    try {
      const invoke = { online: onlineCdnDomain, offline: offlineCdnDomain, delete: deleteCdnDomain }[action];
      await invoke(ak, sk, name);
      toast.success(action === "delete" ? "域名已删除" : `${actionNames[action]}请求已提交`);
      setConfirmOpen(false); setConfirmation("");
      if (action === "delete") onSelectDomain(null);
      else setDetailVersion(value => value + 1);
      await loadDomains();
    } catch (error) { toast.error(`${actionNames[action]}失败`, { description: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };

  const countLabel = isFiltered
    ? `${visibleDomains.length} / ${domains.length} 个域名`
    : `${domains.length} 个域名`;

  const sortableColumns = [
    { field: "name", label: "域名" },
    { field: "operatingState", label: "状态" },
    { field: "protocol", label: "协议" },
    { field: "geoCover", label: "加速区域" },
  ] as const;

  return (
    <div className="@container/domain-page flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <PageToolbar>
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => { loadDomains(); setDetailVersion(value => value + 1); }}
          title="刷新列表"
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          刷新
        </Button>
        {!loading && !listError && domains.length > 0 && (
          <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">{countLabel}</span>
        )}
        <div className="flex-1" />
        <FilterSelect label="域名状态" value={statusFilter} items={statusItems} onChange={setStatusFilter} />
        <FilterSelect label="加速区域" value={regionFilter} items={regionItems} onChange={setRegionFilter} />
        <div className="relative w-56 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索域名或 CNAME"
            placeholder="搜索域名或 CNAME..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
      </PageToolbar>

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="@container/domain-list relative flex min-h-0 min-w-0 flex-1 flex-col">
        {loading && domains.length === 0 ? (
          <PageState loading title="正在获取域名列表..." />
        ) : listError && domains.length === 0 ? (
          <PageState error title="加载失败" description={<span className="break-all">{listError}</span>}>
            <Button variant="secondary" size="sm" onClick={loadDomains}>重试</Button>
          </PageState>
        ) : visibleDomains.length === 0 ? (
          <PageState icon={isFiltered ? FileSearch : Globe}
            title={isFiltered ? "没有匹配的域名" : "暂无 CDN 域名"}
            description={isFiltered ? undefined : "在七牛控制台添加域名后即可在此管理"} />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table containerClassName="contents" className="w-full table-fixed text-left text-sm">
              <TableHeader className="sticky top-0 z-10 border-b border-border bg-zinc-50 dark:bg-card">
                <TableRow>
                  {sortableColumns.map(({ field, label }) => (
                    <TableHead key={field} className={`p-0 ${field === "geoCover" ? "hidden w-24 @2xl/domain-list:table-cell" : field === "name" ? "" : "w-20"}`}
                      aria-sort={sortField === field ? (descending ? "descending" : "ascending") : undefined}>
                      <TableSortButton className="px-3" onClick={() => handleSort(field)}>
                        {label}<SortIcon field={field} />
                      </TableSortButton>
                    </TableHead>
                  ))}
                  <TableHead className="hidden px-3 py-3 text-left text-xs font-medium text-muted-foreground @3xl/domain-list:table-cell">CNAME</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/40 dark:divide-border/80">
                {visibleDomains.map(domain => (
                  <TableRow
                    key={domain.name}
                    className={`group cursor-default transition-colors ${activeDomain === domain.name ? "bg-accent/70 hover:bg-accent" : "hover:bg-accent/50"}`}
                    onClick={() => { if (!busy) onSelectDomain(domain.name); }}
                  >
                    <TableCell className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Tooltip content={domain.name}>
                        <button type="button" data-domain-detail-trigger disabled={busy}
                          onClick={e => { e.stopPropagation(); onSelectDomain(domain.name); }}
                          className="min-w-0 truncate text-left font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          {domain.name}
                        </button>
                        </Tooltip>
                        {isWildcard(domain.type) && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">泛域名</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <span className={`text-xs ${status(domain.operatingState) === "failed" || status(domain.operatingState) === "frozen" ? "text-red-500" : status(domain.operatingState) === "online" ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-muted-foreground"}`}>
                        {statusLabel(domain.operatingState)}
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                      {domain.protocol?.toUpperCase() || "-"}
                    </TableCell>
                    <TableCell className="hidden px-3 py-3 text-xs text-muted-foreground @2xl/domain-list:table-cell">
                      {regionLabel(domain.geoCover)}
                    </TableCell>
                    <TableCell className="hidden px-3 py-3 @3xl/domain-list:table-cell">
                      <div className="flex min-w-0 items-center gap-1">
                        <Tooltip content={domain.cname}><code className="min-w-0 truncate text-xs text-muted-foreground">{domain.cname || "-"}</code></Tooltip>
                        {domain.cname && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`复制 ${domain.name} 的 CNAME`}
                            className="opacity-0 text-zinc-400 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                            onClick={e => { e.stopPropagation(); copy(domain.cname, " CNAME"); }}
                          >
                            <Copy />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {activeDomain && (
        <aside aria-label="域名详情" className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border bg-background text-foreground">
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <Tooltip content={activeDomain}><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{activeDomain}</h2></Tooltip>
            <Button variant="ghost" size="icon-sm" disabled={busy} title="关闭域名详情" aria-label="关闭域名详情" onClick={() => onSelectDomain(null)}><X /></Button>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 text-sm">
            {detailLoading ? (
              <div className="space-y-3" aria-label="正在加载域名详情">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : detailError ? (
              <div role="alert" className="space-y-3 text-sm text-destructive">
                <p>加载详情失败：{detailError}</p>
                <Button variant="outline" onClick={() => setDetailVersion(value => value + 1)}>重试</Button>
              </div>
            ) : detail && (
              <>
                <div className="flex items-center gap-2">
                  <StatusBadge state={detail.operatingState} />
                  <span className="text-xs text-muted-foreground">{isWildcard(detail.type) ? "泛域名" : "普通域名"}</span>
                </div>
                {detail.operatingStateDesc && <p className="text-sm text-muted-foreground">{detail.operatingStateDesc}</p>}
                <div className="divide-y divide-border overflow-hidden rounded-xl bg-muted/50">
                  <Button variant="ghost" className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5" onClick={() => copy(detail.name, "域名")}><Copy />复制域名</Button>
                  <Button variant="ghost" className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5" disabled={busy} onClick={() => { onSelectDomain(null); onRefreshDomain(detail.name); }}>刷新缓存</Button>
                  {!isWildcard(detail.type) && (
                    <Button variant="ghost" className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5" nativeButton={false} render={<a href={`${detail.protocol === "https" ? "https" : "http"}://${detail.name}`} target="_blank" rel="noopener noreferrer" />}>
                      <ExternalLink />访问域名
                    </Button>
                  )}
                </div>
                <section className="space-y-3">
                  <h3 className="font-medium">基本信息</h3>
                  <InfoRows rows={[
                    ["协议", detail.protocol?.toUpperCase() || "-"],
                    ["加速区域", regionLabel(detail.geoCover)],
                    ["业务类型", ({ web: "静态网站", download: "文件下载", vod: "音视频点播", dynamic: "动态加速" } as Record<string, string>)[detail.platform] || detail.platform],
                    ["备案号", detail.registerNo || "-"],
                    ["创建时间", formatTime(detail.createAt)],
                    ["更新时间", formatTime(detail.modifyAt)],
                  ]} />
                </section>
                <section className="space-y-3">
                  <h3 className="font-medium">CNAME</h3>
                  <div className="flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all text-xs">{detail.cname || "尚未分配"}</code>
                    <Button variant="ghost" size="icon-sm" disabled={!detail.cname} aria-label="复制 CNAME" onClick={() => copy(detail.cname, " CNAME")}><Copy /></Button>
                  </div>
                  <p className="text-xs text-muted-foreground">在域名服务商处添加 CNAME 记录，指向上述地址。</p>
                </section>
                <section className="space-y-3">
                  <h3 className="font-medium">源站配置</h3>
                  <InfoRows rows={[
                    ["源站类型", ({ qiniuBucket: "七牛存储空间", domain: "源站域名", ip: "源站 IP", advanced: "高级源站" } as Record<string, string>)[detail.source?.sourceType || ""] || detail.source?.sourceType || "-"],
                    ["源站地址", detail.source?.sourceQiniuBucket || detail.source?.sourceDomain || detail.source?.sourceIPs?.join("、") || "-"],
                    ["回源 Host", detail.source?.sourceHost || "-"],
                  ]} />
                </section>
                <section className="space-y-3">
                  <h3 className="font-medium">HTTPS</h3>
                  <InfoRows rows={[
                    ["HTTPS", detail.protocol === "https" ? "已开启" : "未开启"],
                    ["证书 ID", detail.https?.certId || "-"],
                    ["强制 HTTPS", detail.https?.forceHttps === undefined ? "-" : detail.https.forceHttps ? "已开启" : "未开启"],
                    ["HTTP/2", detail.https?.http2Enable === undefined ? "-" : detail.https.http2Enable ? "已开启" : "未开启"],
                  ]} />
                </section>
                <section className="space-y-3">
                  <h3 className="font-medium">域名操作</h3>
                  <div className="divide-y divide-border overflow-hidden rounded-xl bg-muted/50">
                    <Button variant="ghost" className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5" disabled={busy || status(detail.operatingState) !== "offline"} onClick={() => { setPending("online"); setConfirmOpen(true); }}>上线域名</Button>
                    <Button variant="ghost" className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5" disabled={busy || status(detail.operatingState) !== "online"} onClick={() => { setPending("offline"); setConfirmOpen(true); }}>下线域名</Button>
                    <Button variant="ghost" className="h-auto w-full justify-start rounded-none border-0 px-3 py-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy || status(detail.operatingState) !== "offline"} onClick={() => { setPending("delete"); setConfirmation(""); setConfirmOpen(true); }}>删除域名</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">下线会停止 CDN 加速服务。删除前需先下线域名。</p>
                </section>
              </>
            )}
          </div>
          <Dialog open={confirmOpen} onOpenChange={open => { if (!busy) { setConfirmOpen(open); if (!open) setConfirmation(""); } }}>
            <DialogContent showCloseButton={!busy}>
              <DialogHeader>
                <DialogTitle>{pending ? actionNames[pending] : ""}域名</DialogTitle>
                <DialogDescription className="break-all">
                  {pending === "delete" ? "删除后将移除该域名的 CDN 加速配置。" : pending === "offline" ? "下线后该域名将停止 CDN 加速服务。" : "确认恢复该域名的 CDN 加速服务？"} {detail?.name}
                </DialogDescription>
              </DialogHeader>
              {pending === "delete" && (
                <div className="space-y-2">
                  <Label htmlFor="delete-domain-confirm">输入完整域名确认删除</Label>
                  <Input id="delete-domain-confirm" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>取消</Button>
                <Button variant={pending === "online" ? "default" : "destructive"} disabled={busy || (pending === "delete" && confirmation !== detail?.name)} onClick={executeAction}>
                  {busy && <Loader2 className="animate-spin" />}确认{pending ? actionNames[pending] : ""}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </aside>
      )}
      </div>
    </div>
  );
}
