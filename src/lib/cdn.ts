import CryptoJS from "crypto-js";
import { urlSafeBase64Encode, generateQiniuToken, loggedFetch } from "./qiniu";

// ─── QBox Auth (for fusion.qiniuapi.com) ─────────────────────────────────────
// QBox signs only the path (+query) + "\n". JSON body does NOT participate.

function generateQBoxToken(ak: string, sk: string, pathWithQuery: string): string {
  const signingStr = `${pathWithQuery}\n`;
  const hash = CryptoJS.HmacSHA1(signingStr, sk);
  const encodedSign = urlSafeBase64Encode(hash);
  return `QBox ${ak}:${encodedSign}`;
}

// ─── Helper: Fusion POST (QBox auth) ─────────────────────────────────────────

async function fusionPost<T = any>(ak: string, sk: string, path: string, body: object): Promise<T> {
  const host = "fusion.qiniuapi.com";
  const token = generateQBoxToken(ak, sk, path);
  const response = await loggedFetch(`https://${host}${path}`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || (data.code && data.code !== 200)) {
    throw new Error(data.error || `请求失败: ${response.status}`);
  }
  return data as T;
}

// ─── Helper: api.qiniu.com (Qiniu auth) ──────────────────────────────────────

async function qiniuApiGet<T = any>(ak: string, sk: string, pathWithQuery: string): Promise<T> {
  const host = "api.qiniu.com";
  const url = `https://${host}${pathWithQuery}`;
  const token = generateQiniuToken(ak, sk, "GET", pathWithQuery, host, "application/json");
  const response = await loggedFetch(url, {
    method: "GET",
    headers: { Authorization: token, "Content-Type": "application/json" },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `请求失败: ${response.status}`);
  }
  return data as T;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 域名管理 (api.qiniu.com, Qiniu auth)
// ═══════════════════════════════════════════════════════════════════════════════

export interface CdnDomain {
  name: string;
  cname: string;
  type: string;        // normal | wildcard
  platform: string;    // web | vod | download | dynamic
  product: string;     // cdn | dcdn
  geoCover: string;    // china | foreign | global
  protocol: string;    // http | https
  operatingState: string; // processing | success | offlined | ...
  operationType: string;
  freezeType: string;
  createAt: string;
  modifyAt: string;
  source?: any;
  cache?: any;
  https?: any;
  ipTypes?: number;
}

export interface CdnDomainListResult {
  domains: CdnDomain[];
  marker: string;
}

/** 获取 CDN 加速域名列表 */
export async function cdnListDomains(ak: string, sk: string, marker?: string, limit: number = 100): Promise<CdnDomainListResult> {
  let path = `/domain?limit=${limit}`;
  if (marker) path += `&marker=${encodeURIComponent(marker)}`;
  return qiniuApiGet<CdnDomainListResult>(ak, sk, path);
}

/** 获取单个域名详情 */
export async function cdnGetDomain(ak: string, sk: string, name: string): Promise<CdnDomain> {
  return qiniuApiGet<CdnDomain>(ak, sk, `/domain/${name}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 用量统计 (fusion.qiniuapi.com, QBox auth)
// ═══════════════════════════════════════════════════════════════════════════════

export interface UsageStatsResult {
  code: number;
  error: string;
  time: string[];
  data: Record<string, { china: number[]; oversea: number[] }>;
}

/** 计量带宽查询 (bps) */
export async function cdnQueryBandwidth(
  ak: string, sk: string,
  domains: string[],   // will be joined with ";"
  startDate: string,   // "2026-01-01"
  endDate: string,
  granularity: "5min" | "hour" | "day" = "day"
): Promise<UsageStatsResult> {
  return fusionPost(ak, sk, "/v2/tune/bandwidth", {
    domains: domains.join(";"),
    startDate, endDate, granularity,
  });
}

/** 计量流量查询 (bytes) */
export async function cdnQueryFlux(
  ak: string, sk: string,
  domains: string[],
  startDate: string,
  endDate: string,
  granularity: "5min" | "hour" | "day" = "day"
): Promise<UsageStatsResult> {
  return fusionPost(ak, sk, "/v2/tune/flux", {
    domains: domains.join(";"),
    startDate, endDate, granularity,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. 缓存刷新 & 预取 (fusion.qiniuapi.com, QBox auth)
// ═══════════════════════════════════════════════════════════════════════════════

export interface CdnRefreshResult {
  code: number;
  error: string;
  requestId: string;
  invalidUrls: string[];
  invalidDirs: string[];
  urlQuotaDay: number;
  urlSurplusDay: number;
  dirQuotaDay: number;
  dirSurplusDay: number;
}

export interface CdnPrefetchResult {
  code: number;
  error: string;
  requestId: string;
  invalidUrls: string[];
  quotaDay: number;
  surplusDay: number;
}

/** CDN 缓存刷新（URL + 目录） */
export async function cdnRefresh(ak: string, sk: string, urls: string[], dirs: string[]): Promise<CdnRefreshResult> {
  return fusionPost(ak, sk, "/v2/tune/refresh", { urls, dirs });
}

/** CDN 资源预取 */
export async function cdnPrefetch(ak: string, sk: string, urls: string[]): Promise<CdnPrefetchResult> {
  return fusionPost(ak, sk, "/v2/tune/prefetch", { urls });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. 日志下载 (fusion.qiniuapi.com, QBox auth)
// ═══════════════════════════════════════════════════════════════════════════════

export interface LogFileEntry {
  name: string;
  size: number;
  mtime: number;
  url: string;
  md5: string;
  domain: string;
}

export interface CdnLogResult {
  code: number;
  error: string;
  data: Record<string, LogFileEntry[]>;
}

/** 获取 CDN 日志下载链接 */
export async function cdnGetLogs(
  ak: string, sk: string,
  domains: string[],
  day: string  // "2026-01-15"
): Promise<CdnLogResult> {
  return fusionPost(ak, sk, "/v2/tune/log/list", {
    domains: domains.join(";"),
    day,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. 刷新/预取任务查询
// ═══════════════════════════════════════════════════════════════════════════════

export interface RefreshTask {
  id?: string;
  taskId?: string;
  requestId?: string;
  url: string;
  state: string;  // processing | success | failure
  isDir?: string;
  progress?: number;
  createAt: string;
  beginAt?: string;
  endAt?: string;
  finishAt?: string; // 兼容旧字段
}

export interface RefreshTaskListResult {
  code: number;
  error: string;
  items: RefreshTask[];
  marker?: string;
  total?: number;
  pageNo?: number;
  pageSize?: number;
  currentSize?: number;
}

export interface PrefetchTask {
  id?: string;
  taskId?: string;
  requestId?: string;
  url: string;
  state: string;  // processing | success | failure
  progress?: number;
  createAt: string;
  beginAt?: string;
  endAt?: string;
  finishAt?: string; // 兼容旧字段
}

export interface PrefetchTaskListResult {
  code: number;
  error: string;
  items: PrefetchTask[];
  marker?: string;
  total?: number;
  pageNo?: number;
  pageSize?: number;
  currentSize?: number;
}

export interface CdnTaskQueryOptions {
  requestId?: string;
  urls?: string[];
  isDir?: "yes" | "no";
  state?: "processing" | "success" | "failure";
  pageNo?: number;
  pageSize?: number;
}

/** 查询刷新任务状态 */
export async function cdnQueryRefreshTasks(
  ak: string,
  sk: string,
  options: CdnTaskQueryOptions = {}
): Promise<RefreshTaskListResult> {
  const {
    requestId,
    urls,
    isDir,
    state,
    pageNo = 0,
    pageSize = 50,
  } = options;
  const body: Record<string, unknown> = { pageNo, pageSize };
  if (requestId) body.requestId = requestId;
  if (urls && urls.length > 0) body.urls = urls;
  if (isDir) body.isDir = isDir;
  if (state) body.state = state;

  return fusionPost(ak, sk, "/v2/tune/refresh/list", body);
}

/** 查询预取任务状态 */
export async function cdnQueryPrefetchTasks(
  ak: string,
  sk: string,
  options: CdnTaskQueryOptions = {}
): Promise<PrefetchTaskListResult> {
  const {
    requestId,
    urls,
    state,
    pageNo = 0,
    pageSize = 50,
  } = options;
  const body: Record<string, unknown> = { pageNo, pageSize };
  if (requestId) body.requestId = requestId;
  if (urls && urls.length > 0) body.urls = urls;
  if (state) body.state = state;

  return fusionPost(ak, sk, "/v2/tune/prefetch/list", body);
}
