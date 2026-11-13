import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { CdnDomain, fetchCdnDomain, fetchCdnDomains, onlineCdnDomain, offlineCdnDomain, deleteCdnDomain } from "../lib/qiniu";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, ExternalLink, FileSearch, Filter, Globe, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../components/ui/sheet";
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
  return <Badge variant={value === "failed" || value === "frozen" ? "destructive" : value === "online" ? "secondary" : "outline"}>{statusLabel(state)}</Badge>;
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
      <SelectTrigger aria-label={label} className="w-32">
        <Filter className="size-3.5 text-muted-foreground" />
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
    <dl className="divide-y rounded-lg border px-4">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[6rem_1fr] gap-3 py-3 text-sm">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-all">{value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DomainManager({ ak, sk, selectedDomain, onSelectDomain, onRefreshDomain, refreshTrigger }: {
  ak: string; sk: string; selectedDomain: string | null;
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
  const [detail, setDetail] = useState<CdnDomain | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
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
  useEffect(() => {
    let cancelled = false;
    setDetail(null); setDetailError(""); setConfirmOpen(false); setConfirmation("");
    if (!selectedDomain) { setDetailLoading(false); return; }
    setDetailLoading(true);
    fetchCdnDomain(ak, sk, selectedDomain).then(data => { if (!cancelled) setDetail(data); })
      .catch(error => { if (!cancelled) setDetailError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [ak, sk, selectedDomain, detailVersion]);

  const isFiltered = search.trim() !== "" || statusFilter !== "all" || regionFilter !== "all";

  const visibleDomains = useMemo(() => {
    const query = search.trim().toLowerCase();
    return domains.filter(domain => (!query || `${domain.name} ${domain.cname || ""}`.toLowerCase().includes(query))
      && (statusFilter === "all" || status(domain.operatingState) === statusFilter)
      && (regionFilter === "all" || region(domain.geoCover) === regionFilter))
      .sort((a, b) => (a[sortField] || "").localeCompare(b[sortField] || "") * (descending ? -1 : 1));
  }, [domains, search, statusFilter, regionFilter, descending, sortField]);

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

  const thClass = "cursor-pointer select-none px-6 py-3 text-left text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/50";

  return (
    <div className="flex h-full flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-6 dark:border-zinc-800">
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
          <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">{countLabel}</span>
        )}
        <div className="flex-1" />
        <FilterSelect label="域名状态" value={statusFilter} items={statusItems} onChange={setStatusFilter} />
        <FilterSelect label="加速区域" value={regionFilter} items={regionItems} onChange={setRegionFilter} />
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索域名或 CNAME"
            placeholder="搜索域名或 CNAME..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {loading && domains.length === 0 ? (
          <div aria-label="正在加载域名" className="flex flex-1 flex-col items-center justify-center gap-4 p-20 text-zinc-500">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-emerald-600 dark:border-zinc-800" />
            <p className="text-sm">正在获取域名列表...</p>
          </div>
        ) : listError && domains.length === 0 ? (
          <div className="m-6 rounded-xl border border-red-200 bg-red-50 p-6 text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
            <div className="mb-2 font-medium">加载失败</div>
            <div className="mb-4 break-all rounded bg-red-100/50 p-2 font-mono text-xs dark:bg-red-900/20">{listError}</div>
            <Button variant="outline" size="sm" onClick={loadDomains}>重试</Button>
          </div>
        ) : visibleDomains.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-16 text-center">
            {isFiltered ? (
              <>
                <FileSearch className="size-8 text-zinc-300 dark:text-zinc-700" />
                <p className="text-sm text-zinc-500">没有匹配的域名</p>
              </>
            ) : (
              <>
                <Globe className="size-8 text-zinc-300 dark:text-zinc-600" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">暂无 CDN 域名</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">在七牛控制台添加域名后即可在此管理</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full whitespace-nowrap text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80">
                <tr>
                  <th className={thClass} onClick={() => handleSort("name")} aria-sort={sortField === "name" ? (descending ? "descending" : "ascending") : "none"}>
                    域名 <SortIcon field="name" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("operatingState")} aria-sort={sortField === "operatingState" ? (descending ? "descending" : "ascending") : "none"}>
                    状态 <SortIcon field="operatingState" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("protocol")} aria-sort={sortField === "protocol" ? (descending ? "descending" : "ascending") : "none"}>
                    协议 <SortIcon field="protocol" />
                  </th>
                  <th className={thClass} onClick={() => handleSort("geoCover")} aria-sort={sortField === "geoCover" ? (descending ? "descending" : "ascending") : "none"}>
                    加速区域 <SortIcon field="geoCover" />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">CNAME</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {visibleDomains.map(domain => (
                  <tr
                    key={domain.name}
                    className="group cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    onClick={() => onSelectDomain(domain.name)}
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-800 transition-colors group-hover:text-emerald-600 dark:text-zinc-100 dark:group-hover:text-emerald-400">
                          {domain.name}
                        </span>
                        {isWildcard(domain.type) && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">泛域名</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`text-xs ${status(domain.operatingState) === "failed" || status(domain.operatingState) === "frozen" ? "text-red-500" : status(domain.operatingState) === "online" ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                        {statusLabel(domain.operatingState)}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                      {domain.protocol?.toUpperCase() || "-"}
                    </td>
                    <td className="px-6 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                      {regionLabel(domain.geoCover)}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        <code className="text-xs text-zinc-500 dark:text-zinc-400">{domain.cname || "-"}</code>
                        {domain.cname && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`复制 ${domain.name} 的 CNAME`}
                            className="opacity-0 text-zinc-400 transition-opacity group-hover:opacity-100"
                            onClick={e => { e.stopPropagation(); copy(domain.cname, " CNAME"); }}
                          >
                            <Copy />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Sheet open={!!selectedDomain} onOpenChange={open => { if (!open && !busy) onSelectDomain(null); }}>
        <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl" showCloseButton={!busy}>
          <SheetHeader className="border-b pr-12">
            <SheetTitle>域名详情</SheetTitle>
            <SheetDescription className="break-all">{selectedDomain}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6">
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
                  <Badge variant="outline">{isWildcard(detail.type) ? "泛域名" : "普通域名"}</Badge>
                </div>
                {detail.operatingStateDesc && <p className="text-sm text-muted-foreground">{detail.operatingStateDesc}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(detail.name, "域名")}><Copy />复制域名</Button>
                  <Button variant="outline" size="sm" onClick={() => { onSelectDomain(null); onRefreshDomain(detail.name); }}>刷新缓存</Button>
                  {!isWildcard(detail.type) && (
                    <Button variant="outline" size="sm" nativeButton={false} render={<a href={`${detail.protocol === "https" ? "https" : "http"}://${detail.name}`} target="_blank" rel="noopener noreferrer" />}>
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
                  <div className="flex items-center gap-2 rounded-lg border p-3">
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
                <section className="space-y-3 border-t pt-4">
                  <h3 className="font-medium">域名操作</h3>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" disabled={busy || status(detail.operatingState) !== "offline"} onClick={() => { setPending("online"); setConfirmOpen(true); }}>上线域名</Button>
                    <Button variant="outline" disabled={busy || status(detail.operatingState) !== "online"} onClick={() => { setPending("offline"); setConfirmOpen(true); }}>下线域名</Button>
                    <Button variant="destructive" disabled={busy || status(detail.operatingState) !== "offline"} onClick={() => { setPending("delete"); setConfirmation(""); setConfirmOpen(true); }}>删除域名</Button>
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
        </SheetContent>
      </Sheet>
    </div>
  );
}
