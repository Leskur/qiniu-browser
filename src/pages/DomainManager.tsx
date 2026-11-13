import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { CdnDomain, fetchCdnDomain, fetchCdnDomains, onlineCdnDomain, offlineCdnDomain, deleteCdnDomain } from "../lib/qiniu";
import { Copy, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";

type Action = "online" | "offline" | "delete";
type SortField = "name" | "operatingState" | "protocol" | "geoCover";
const actionNames: Record<Action, string> = { online: "上线", offline: "下线", delete: "删除" };
const statusItems = [{ value: "all", label: "全部状态" }, { value: "online", label: "在线" }, { value: "offline", label: "离线" }, { value: "processing", label: "配置中" }, { value: "failed", label: "失败" }];
const regionItems = [{ value: "all", label: "全部区域" }, { value: "china", label: "中国大陆" }, { value: "foreign", label: "海外" }, { value: "global", label: "全球" }];
function status(state: string) {
  if (state === "success") return "online";
  if (["offline", "offlined"].includes(state)) return "offline";
  if (["failed", "failure"].includes(state)) return "failed";
  return state;
}
function StatusBadge({ state }: { state: string }) {
  const value = status(state);
  return <Badge variant={value === "failed" ? "destructive" : value === "online" ? "secondary" : "outline"}>{statusItems.find(item => item.value === value)?.label ?? (state || "未知")}</Badge>;
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
  return <Select items={items} value={value} onValueChange={value => { if (value !== null) onChange(value); }}>
    <SelectTrigger aria-label={label} className="w-32"><SelectValue /></SelectTrigger>
    <SelectContent>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
  </Select>;
}
function InfoRows({ rows }: { rows: [string, string][] }) {
  return <dl className="divide-y rounded-lg border px-4">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[6rem_1fr] gap-3 py-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-all">{value || "-"}</dd></div>)}</dl>;
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

  const visibleDomains = useMemo(() => {
    const query = search.trim().toLowerCase();
    return domains.filter(domain => (!query || `${domain.name} ${domain.cname || ""}`.toLowerCase().includes(query))
      && (statusFilter === "all" || status(domain.operatingState) === statusFilter)
      && (regionFilter === "all" || region(domain.geoCover) === regionFilter))
      .sort((a, b) => (a[sortField] || "").localeCompare(b[sortField] || "") * (descending ? -1 : 1));
  }, [domains, search, statusFilter, regionFilter, descending, sortField]);

  const sortHeader = (field: SortField, label: string) => <TableHead aria-sort={sortField === field ? descending ? "descending" : "ascending" : "none"}>
    <Button variant="ghost" size="sm" onClick={() => {
      if (sortField === field) setDescending(value => !value);
      else { setSortField(field); setDescending(false); }
    }} aria-label={`按${label}排序`}>{label} {sortField === field ? descending ? "↓" : "↑" : "↕"}</Button>
  </TableHead>;

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

  return <div className="flex h-full flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">域名管理</h2>
        <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums bg-zinc-50 dark:bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-200/50 dark:border-zinc-700/50">
          共 {domains.length} 个
        </span>
      </div>
      <Button variant="outline" size="default" disabled={loading} onClick={() => { loadDomains(); setDetailVersion(value => value + 1); }}><RefreshCw className={loading ? "animate-spin" : ""} />刷新</Button>
    </header>
    <div className="flex h-12 flex-wrap items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 px-6 shrink-0">
      <div className="relative min-w-48 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索域名或 CNAME" placeholder="搜索域名或 CNAME" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div>
      <FilterSelect label="域名状态" value={statusFilter} items={statusItems} onChange={setStatusFilter} />
      <FilterSelect label="加速区域" value={regionFilter} items={regionItems} onChange={setRegionFilter} />
      <span className="text-xs text-zinc-400 dark:text-zinc-500">{visibleDomains.length} 个匹配</span>
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-6">
      {listError && <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"><span>加载失败：{listError}</span><Button variant="outline" size="sm" onClick={loadDomains}>重试</Button></div>}
      {loading && domains.length === 0 ? <div aria-label="正在加载域名" className="space-y-3">{[0, 1, 2, 3].map(value => <Skeleton key={value} className="h-12 w-full" />)}</div> :
        <div className="overflow-hidden rounded-lg border"><Table>
          <TableHeader><TableRow>
            {sortHeader("name", "域名")}{sortHeader("operatingState", "状态")}{sortHeader("protocol", "协议")}{sortHeader("geoCover", "加速区域")}<TableHead>CNAME</TableHead><TableHead className="text-right">操作</TableHead>
          </TableRow></TableHeader>
          <TableBody>{visibleDomains.length === 0 ? <TableRow><TableCell colSpan={6} className="h-40 text-center text-muted-foreground">{listError ? "未能获取域名" : domains.length ? "没有匹配的域名" : "暂无 CDN 域名"}</TableCell></TableRow> : visibleDomains.map(domain => <TableRow key={domain.name}>
            <TableCell><div className="flex items-center gap-2"><Button variant="link" className="h-auto p-0" onClick={() => onSelectDomain(domain.name)}>{domain.name}</Button>{isWildcard(domain.type) && <Badge variant="outline">泛域名</Badge>}</div></TableCell>
            <TableCell><StatusBadge state={domain.operatingState} /></TableCell><TableCell>{domain.protocol?.toUpperCase() || "-"}</TableCell><TableCell>{regionLabel(domain.geoCover)}</TableCell>
            <TableCell><div className="flex items-center gap-1"><code className="text-xs">{domain.cname || "-"}</code><Button variant="ghost" size="icon-xs" disabled={!domain.cname} aria-label={`复制 ${domain.name} 的 CNAME`} onClick={() => copy(domain.cname, " CNAME")}><Copy /></Button></div></TableCell>
            <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => onSelectDomain(domain.name)}>详情</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>}
    </div>
    <Sheet open={!!selectedDomain} onOpenChange={open => { if (!open && !busy) onSelectDomain(null); }}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl" showCloseButton={!busy}>
        <SheetHeader className="border-b pr-12"><SheetTitle>域名详情</SheetTitle><SheetDescription className="break-all">{selectedDomain}</SheetDescription></SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6">
          {detailLoading ? <div className="space-y-3" aria-label="正在加载域名详情"><Skeleton className="h-10 w-full" /><Skeleton className="h-48 w-full" /></div> : detailError ? <div role="alert" className="space-y-3 text-sm text-destructive"><p>加载详情失败：{detailError}</p><Button variant="outline" onClick={() => setDetailVersion(value => value + 1)}>重试</Button></div> : detail && <>
            <div className="flex items-center gap-2"><StatusBadge state={detail.operatingState} /><Badge variant="outline">{isWildcard(detail.type) ? "泛域名" : "普通域名"}</Badge></div>
            {detail.operatingStateDesc && <p className="text-sm text-muted-foreground">{detail.operatingStateDesc}</p>}
            <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => copy(detail.name, "域名")}><Copy />复制域名</Button><Button variant="outline" size="sm" onClick={() => { onSelectDomain(null); onRefreshDomain(detail.name); }}>刷新缓存</Button>{!isWildcard(detail.type) && <Button variant="outline" size="sm" nativeButton={false} render={<a href={`${detail.protocol === "https" ? "https" : "http"}://${detail.name}`} target="_blank" rel="noopener noreferrer" />}><ExternalLink />访问域名</Button>}</div>
            <section className="space-y-3"><h3 className="font-medium">基本信息</h3><InfoRows rows={[["协议", detail.protocol?.toUpperCase() || "-"], ["加速区域", regionLabel(detail.geoCover)], ["业务类型", ({ web: "静态网站", download: "文件下载", vod: "音视频点播", dynamic: "动态加速" } as Record<string, string>)[detail.platform] || detail.platform], ["备案号", detail.registerNo || "-"], ["创建时间", formatTime(detail.createAt)], ["更新时间", formatTime(detail.modifyAt)]]} /></section>
            <section className="space-y-3"><h3 className="font-medium">CNAME</h3><div className="flex items-center gap-2 rounded-lg border p-3"><code className="min-w-0 flex-1 break-all text-xs">{detail.cname || "尚未分配"}</code><Button variant="ghost" size="icon-sm" disabled={!detail.cname} aria-label="复制 CNAME" onClick={() => copy(detail.cname, " CNAME")}><Copy /></Button></div><p className="text-xs text-muted-foreground">在域名服务商处添加 CNAME 记录，指向上述地址。</p></section>
            <section className="space-y-3"><h3 className="font-medium">源站配置</h3><InfoRows rows={[["源站类型", ({ qiniuBucket: "七牛存储空间", domain: "源站域名", ip: "源站 IP", advanced: "高级源站" } as Record<string, string>)[detail.source?.sourceType || ""] || detail.source?.sourceType || "-"], ["源站地址", detail.source?.sourceQiniuBucket || detail.source?.sourceDomain || detail.source?.sourceIPs?.join("、") || "-"], ["回源 Host", detail.source?.sourceHost || "-"]]} /></section>
            <section className="space-y-3"><h3 className="font-medium">HTTPS</h3><InfoRows rows={[["HTTPS", detail.protocol === "https" ? "已开启" : "未开启"], ["证书 ID", detail.https?.certId || "-"], ["强制 HTTPS", detail.https?.forceHttps === undefined ? "-" : detail.https.forceHttps ? "已开启" : "未开启"], ["HTTP/2", detail.https?.http2Enable === undefined ? "-" : detail.https.http2Enable ? "已开启" : "未开启"]]} /></section>
            <section className="space-y-3 border-t pt-4"><h3 className="font-medium">域名操作</h3><div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || status(detail.operatingState) !== "offline"} onClick={() => { setPending("online"); setConfirmOpen(true); }}>上线域名</Button>
              <Button variant="outline" disabled={busy || status(detail.operatingState) !== "online"} onClick={() => { setPending("offline"); setConfirmOpen(true); }}>下线域名</Button>
              <Button variant="destructive" disabled={busy || status(detail.operatingState) !== "offline"} onClick={() => { setPending("delete"); setConfirmation(""); setConfirmOpen(true); }}>删除域名</Button>
            </div><p className="text-xs text-muted-foreground">下线会停止 CDN 加速服务。删除前需先下线域名。</p></section>
          </>}
        </div>
        <Dialog open={confirmOpen} onOpenChange={open => { if (!busy) { setConfirmOpen(open); if (!open) setConfirmation(""); } }}>
          <DialogContent showCloseButton={!busy}>
            <DialogHeader><DialogTitle>{pending ? actionNames[pending] : ""}域名</DialogTitle><DialogDescription className="break-all">{pending === "delete" ? "删除后将移除该域名的 CDN 加速配置。" : pending === "offline" ? "下线后该域名将停止 CDN 加速服务。" : "确认恢复该域名的 CDN 加速服务？"} {detail?.name}</DialogDescription></DialogHeader>
            {pending === "delete" && <div className="space-y-2"><Label htmlFor="delete-domain-confirm">输入完整域名确认删除</Label><Input id="delete-domain-confirm" autoComplete="off" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></div>}
            <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>取消</Button><Button variant={pending === "online" ? "default" : "destructive"} disabled={busy || (pending === "delete" && confirmation !== detail?.name)} onClick={executeAction}>{busy && <Loader2 className="animate-spin" />}确认{pending ? actionNames[pending] : ""}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  </div>;
}
