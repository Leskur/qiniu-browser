import { useState, useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { 
  cdnRefresh, 
  cdnPrefetch, 
  cdnQueryRefreshTasks, 
  cdnQueryPrefetchTasks,
  RefreshTask,
  PrefetchTask 
} from "../lib/cdn";
import { CalendarIcon, History, Loader2, X } from "lucide-react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../components/ui/pagination";

const TASK_PAGE_SIZE = 50;
const OPERATION_ITEMS = [
  { value: "refresh", label: "缓存刷新" },
  { value: "prefetch", label: "文件预取" },
];
type Operation = "refresh" | "prefetch";
interface RecordFilters { operation: Operation; date: string }
function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function defaultFilters(operation: Operation = "refresh"): RecordFilters {
  return { operation, date: localDate() };
}

export function formatTaskDuration(task: RefreshTask | PrefetchTask, now: number): string {
  // Normalize the API's space-separated timestamps for WebKit/Safari.
  const parseTime = (value?: string) => value ? Date.parse(value.trim().replace(" ", "T")) : NaN;
  const start = parseTime(task.createAt);
  const processing = task.state === "processing";
  const endAt = parseTime(task.endAt);
  const end = processing ? now : Number.isFinite(endAt) ? endAt : parseTime(task.finishAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";

  const seconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  const duration = hours > 0 ? `${hours}小时 ${minutes}分 ${remainder}秒`
    : minutes > 0 ? `${minutes}分 ${remainder}秒` : `${seconds}秒`;
  return processing ? `已等待 ${duration}` : duration;
}

/** 生成页码序列（0-based pageNo → 1-based 展示） */
function getPageItems(pageNo: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  const current = pageNo;
  const items: Array<number | "ellipsis"> = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(totalPages - 2, current + 1);
  if (start > 1) items.push("ellipsis");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < totalPages - 2) items.push("ellipsis");
  items.push(totalPages - 1);
  return items;
}

export function CdnManager({ 
  ak, 
  sk,
  prefillDomain,
  onPrefillUsed,
  refreshTrigger
}: { 
  ak: string; 
  sk: string;
  prefillDomain?: string;
  onPrefillUsed?: () => void;
  refreshTrigger?: number;
}) {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState<"refresh" | "prefetch" | "history">("refresh");
  const [refreshType, setRefreshType] = useState<"file" | "directory">("file");
  const [tasks, setTasks] = useState<(RefreshTask | PrefetchTask)[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [filters, setFilters] = useState<RecordFilters>(() => defaultFilters());
  const [filterError, setFilterError] = useState("");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const recordRequest = useRef(0);
  const [taskType, setTaskType] = useState<"refresh" | "prefetch">("refresh");
  const [urlError, setUrlError] = useState("");
  const [pageNo, setPageNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [queryRequestId, setQueryRequestId] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now);
  const hasProcessingTasks = tasks.some(task => task.state === "processing");

  useEffect(() => {
    if (subTab !== "history" || !hasProcessingTasks) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [subTab, hasProcessingTasks]);

  // 处理预填域名
  useEffect(() => {
    if (prefillDomain) {
      setUrls(`https://${prefillDomain}/`);
      onPrefillUsed?.();
      toast.info(`已自动填充域名：${prefillDomain}`);
    }
  }, [prefillDomain, onPrefillUsed]);

  const validateUrls = (list: string[]): { valid: string[]; invalid: string[] } => {
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const u of list) {
      try {
        const parsed = new URL(u);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          valid.push(u);
        } else {
          invalid.push(u);
        }
      } catch {
        invalid.push(u);
      }
    }
    return { valid, invalid };
  };

  const handleSubmit = async () => {
    const list = urls.split("\n").map(u => u.trim()).filter(Boolean);
    if (list.length === 0) return toast.warning("请输入URL");

    const { valid, invalid } = validateUrls(list);
    if (invalid.length > 0) {
      setUrlError("存在无效的 URL");
      return;
    }
    if (subTab === "refresh" && refreshType === "directory" && valid.some(url => !url.endsWith("/"))) {
      setUrlError("目录 URL 必须以 / 结尾，请检查后重试");
      return;
    }
    setUrlError("");

    setLoading(true);
    try {
      if (subTab === "refresh") {
        const dirs = refreshType === "directory" ? valid : [];
        const files = refreshType === "file" ? valid : [];
        const res = await cdnRefresh(ak, sk, files, dirs);
        setTaskType("refresh");
        const serverInvalid = [...(res.invalidUrls || []), ...(res.invalidDirs || [])];
        if (serverInvalid.length > 0) toast.warning(`${serverInvalid.length} 个地址被服务器拒绝`, { description: serverInvalid.join("\n") });
        const validCount = list.length - serverInvalid.length;
        if (validCount > 0) {
          const remaining = refreshType === "directory" ? res.dirSurplusDay : res.urlSurplusDay;
          toast.success(`${refreshType === "directory" ? "目录" : "文件"}刷新任务提交成功! 剩余配额: ${remaining}`, {
            description: `RequestID: ${res.requestId}`,
            action: {
              label: '查看记录',
              onClick: () => {
                setSubTab("history");
                const next = defaultFilters("refresh");
                setFilters(next);
                loadTasks({ requestId: res.requestId, filters: next, page: 0 });
              }
            }
          });
        }
      } else {
        const res = await cdnPrefetch(ak, sk, valid);
        setTaskType("prefetch");
        const invalidUrls = res.invalidUrls || [];
        if (invalidUrls.length > 0) toast.warning(`${invalidUrls.length} 个地址被服务器拒绝`, { description: invalidUrls.join("\n") });
        const validCount = list.length - invalidUrls.length;
        if (validCount > 0) {
          toast.success(`预取任务提交成功! 剩余配额: ${res.surplusDay}`, {
            description: `RequestID: ${res.requestId}`,
            action: {
              label: '查看记录',
              onClick: () => {
                setSubTab("history");
                const next = defaultFilters("prefetch");
                setFilters(next);
                loadTasks({ requestId: res.requestId, filters: next, page: 0 });
              }
            }
          });
        }
      }
      setUrls("");
    } catch (err: any) {
      toast.error(err.message || "操作失败");
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async (opts?: {
    requestId?: string;
    filters?: RecordFilters;
    page?: number;
  }) => {
    const active = opts?.filters ?? filters;
    const currentType = active.operation === "prefetch" ? "prefetch" : "refresh";
    if (!Number.isFinite(Date.parse(active.date)) || active.date < localDate(-6) || active.date > localDate()) {
      setFilterError("请选择最近 7 天内的提交日期");
      return;
    }
    setFilterError("");
    const requestVersion = ++recordRequest.current;
    const page = opts?.page ?? pageNo;
    // 用 in 判断，才能让 requestId: undefined 真正清除筛选
    const requestId = opts && "requestId" in opts ? opts.requestId : queryRequestId;
    setLoadingTasks(true);
    try {
      const query = {
        requestId, pageNo: page, pageSize: TASK_PAGE_SIZE,
        startTime: active.date, endTime: active.date,
      };
      const res = currentType === "refresh"
        ? await cdnQueryRefreshTasks(ak, sk, query)
        : await cdnQueryPrefetchTasks(ak, sk, query);
      if (requestVersion !== recordRequest.current) return;
      setTasks(res.items || []);
      setTotal(res.total ?? (res.items?.length || 0));
      setPageNo(res.pageNo ?? page);
      setQueryRequestId(requestId);
      setTaskType(currentType);
    } catch (err: any) {
      if (requestVersion !== recordRequest.current) return;
      console.error("[CDN] 加载任务失败", err);
      toast.error("加载任务失败", { description: err.message });
    } finally {
      if (requestVersion === recordRequest.current) setLoadingTasks(false);
    }
  };

  // ── F5 刷新触发 ──
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0 && subTab === "history") {
      loadTasks({ page: pageNo });
      toast.success('已刷新操作记录');
    }
  }, [refreshTrigger]);

  const totalPages = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));
  const canPrev = pageNo > 0;
  const canNext = pageNo + 1 < totalPages;

  const getStateBadge = (state: string) => {
    switch (state) {
      case "success":
        return <Badge variant="secondary">成功</Badge>;
      case "failure":
        return <Badge variant="destructive">失败</Badge>;
      case "processing":
        return <Badge variant="outline">处理中</Badge>;
      default:
        return <Badge variant="outline">{state}</Badge>;
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex-1 overflow-y-auto p-6">
        <Tabs
          value={subTab}
          onValueChange={(value) => {
            if (value === "refresh" || value === "prefetch" || value === "history") {
              setSubTab(value);
              if (value === "history") loadTasks({ requestId: undefined, page: 0 });
              setUrlError("");
            }
          }}
          className="max-w-4xl mx-auto gap-6"
        >
          {/* Tabs */}
          <TabsList aria-label="刷新预取">
            <TabsTrigger value="refresh">缓存刷新</TabsTrigger>
            <TabsTrigger value="prefetch">文件预取</TabsTrigger>
            <TabsTrigger value="history">操作记录</TabsTrigger>
          </TabsList>

          <TabsContent value={subTab}>
          {subTab === "history" ? (
            /* Task History */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  操作记录
                  {total > 0 && (
                    <span className="ml-2 text-xs font-normal text-zinc-400">共 {total} 条</span>
                  )}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="record-operation" className="shrink-0 text-xs font-normal text-muted-foreground">操作类型</Label>
                  <Select
                    items={OPERATION_ITEMS}
                    value={filters.operation}
                    onValueChange={(value) => {
                      if (value === "refresh" || value === "prefetch") {
                        const next = { ...filters, operation: value };
                        setFilters(next);
                        loadTasks({ filters: next, requestId: undefined, page: 0 });
                      }
                    }}
                  >
                    <SelectTrigger id="record-operation" className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATION_ITEMS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="record-date" className="shrink-0 text-xs font-normal text-muted-foreground">提交时间</Label>
                  <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                    <PopoverTrigger render={<Button id="record-date" variant="outline" />}>
                      <CalendarIcon />
                      {filters.date}
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-0">
                      <Calendar
                        mode="single"
                        locale={zhCN}
                        required
                        selected={new Date(`${filters.date}T00:00:00`)}
                        defaultMonth={new Date(`${filters.date}T00:00:00`)}
                        disabled={{ before: new Date(`${localDate(-6)}T00:00:00`), after: new Date(`${localDate()}T00:00:00`) }}
                        onSelect={date => {
                          const next = { ...filters, date: format(date, "yyyy-MM-dd") };
                          setFilters(next);
                          setDatePickerOpen(false);
                          loadTasks({ filters: next, requestId: undefined, page: 0 });
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                {filterError && <p role="alert" className="basis-full text-xs text-destructive">{filterError}</p>}
              </div>

              {queryRequestId && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-200">
                  <span className="truncate flex-1">
                    已按 RequestID 筛选：
                    <code className="ml-1 font-mono">{queryRequestId}</code>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => loadTasks({ requestId: undefined, page: 0 })}
                  >
                    <X className="w-3 h-3" />
                    查看全部
                  </Button>
                </div>
              )}

              {loadingTasks ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                </div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <History className="w-16 h-16 text-zinc-300 dark:text-zinc-700 mb-4" />
                  <p className="text-zinc-500 dark:text-zinc-400">
                    {queryRequestId ? "该 RequestID 下暂无操作记录" : "暂无操作记录"}
                  </p>
                  {queryRequestId && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => loadTasks({ requestId: undefined, page: 0 })}
                      className="mt-3"
                    >
                      查看全部记录
                    </Button>
                  )}
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <Table className="w-full">
                    <TableHeader className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700">
                      <TableRow>
                        <TableHead className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">URL</TableHead>
                        <TableHead className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-28">刷新类型</TableHead>
                        <TableHead className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-24">状态</TableHead>
                        <TableHead className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-40">提交时间</TableHead>
                        <TableHead className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-32">耗时</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {tasks.map((task, index) => {
                        const rowKey = task.taskId || task.id || `${task.url}-${task.createAt}-${index}`;
                        // Use the server's operation type; a trailing slash can also be a file URL.
                        const isDir = (task as RefreshTask).isDir;
                        const typeLabel = taskType === "prefetch" ? "文件"
                          : isDir === "yes" ? "目录"
                          : isDir === "no" ? "文件" : "未知类型";
                        return (
                        <TableRow key={rowKey} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                          <TableCell className="px-4 py-3 whitespace-normal">
                            <code className="text-xs font-mono text-zinc-600 dark:text-zinc-400 break-all">
                              {task.url}
                            </code>
                          </TableCell>
                          <TableCell className="px-4 py-3 w-28 whitespace-nowrap">
                            <Badge variant="outline">{typeLabel}</Badge>
                          </TableCell>
                          <TableCell className="px-4 py-3 w-24">
                            {getStateBadge(task.state)}
                          </TableCell>
                          <TableCell className="px-4 py-3 w-40">
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              {task.createAt || '-'}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatTaskDuration(task, now)}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {total > 0 && (
                <div className="flex items-center justify-between gap-4 pt-1">
                  <span className="text-xs text-zinc-400 shrink-0">
                    共 {total} 条 · 每页 {TASK_PAGE_SIZE} 条
                  </span>
                  <Pagination className="mx-0 w-auto justify-end">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          text="上一页"
                          aria-disabled={!canPrev || loadingTasks}
                          className={!canPrev || loadingTasks ? "pointer-events-none opacity-40" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (canPrev && !loadingTasks) loadTasks({ page: pageNo - 1 });
                          }}
                        />
                      </PaginationItem>
                      {getPageItems(pageNo, totalPages).map((item, idx) =>
                        item === "ellipsis" ? (
                          <PaginationItem key={`e-${idx}`}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        ) : (
                          <PaginationItem key={item}>
                            <PaginationLink
                              href="#"
                              isActive={item === pageNo}
                              onClick={(e) => {
                                e.preventDefault();
                                if (!loadingTasks && item !== pageNo) loadTasks({ page: item });
                              }}
                            >
                              {item + 1}
                            </PaginationLink>
                          </PaginationItem>
                        )
                      )}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          text="下一页"
                          aria-disabled={!canNext || loadingTasks}
                          className={!canNext || loadingTasks ? "pointer-events-none opacity-40" : undefined}
                          onClick={(e) => {
                            e.preventDefault();
                            if (canNext && !loadingTasks) loadTasks({ page: pageNo + 1 });
                          }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </div>
          ) : (
            /* Submit Form */
            <div className="space-y-3">
              {subTab === "refresh" && (
                <div className="space-y-3">
                  <Label id="cdn-refresh-type-label">刷新类型</Label>
                  <RadioGroup
                    aria-labelledby="cdn-refresh-type-label"
                    value={refreshType}
                    disabled={loading}
                    onValueChange={(value) => {
                      if (value === "file" || value === "directory") {
                        setRefreshType(value);
                        setUrlError("");
                      }
                    }}
                    className="flex gap-6"
                  >
                  {([
                    ["file", "文件刷新"],
                    ["directory", "目录刷新"],
                  ] as const).map(([value, label]) => (
                    <div key={value} className="flex items-center gap-2">
                      <RadioGroupItem
                        id={`cdn-refresh-${value}`}
                        value={value}
                      />
                      <Label htmlFor={`cdn-refresh-${value}`}>{label}</Label>
                    </div>
                  ))}
                  </RadioGroup>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label htmlFor="cdn-urls">
                  输入 {subTab === "refresh" && refreshType === "directory" ? "目录 URL" : "URL"}
                </Label>
                <span className="text-xs text-zinc-400">每行一个，带协议头 (http/https)</span>
              </div>
              <Textarea
                id="cdn-urls"
                aria-invalid={!!urlError}
                aria-describedby={urlError ? "cdn-url-error" : subTab === "refresh" ? "cdn-url-hint" : undefined}
                value={urls}
                onChange={e => { setUrls(e.target.value); setUrlError(""); }}
                placeholder={subTab === "refresh" && refreshType === "directory"
                  ? "https://example.com/assets/\nhttps://example.com/docs/"
                  : "https://example.com/image.jpg\nhttps://example.com/docs/"}
                className="h-48 resize-none font-mono"
              />

              {subTab === "refresh" && (
                <p id="cdn-url-hint" className="text-xs text-muted-foreground leading-relaxed">
                  {refreshType === "directory"
                    ? "刷新目录下的资源，目录 URL 必须以 / 结尾。"
                    : "仅刷新输入的 URL 本身，以 / 结尾的 URL 也按文件刷新。"}
                </p>
              )}

              {urlError && (
                <p id="cdn-url-error" role="alert" className="text-xs text-destructive">{urlError}</p>
              )}

              <Button
                onClick={handleSubmit}
                disabled={loading || !urls.trim()}
              >
                {subTab === "refresh" ? "刷新" : "预取"}
              </Button>
            </div>
          )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
