import CryptoJS from "crypto-js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * URL 安全的 Base64 编码
 * 七牛云要求 Base64 编码的 '+' 替换为 '-', '/' 替换为 '_'
 */
export function urlSafeBase64Encode(str: string | CryptoJS.lib.WordArray): string {
  let base64 = "";
  if (typeof str === "string") {
    base64 = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(str));
  } else {
    base64 = CryptoJS.enc.Base64.stringify(str);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * 生成管理类 API 所需的 Qiniu 鉴权 Token
 * 格式: Qiniu <AccessKey>:<Sign>
 */
export function generateQiniuToken(
  ak: string,
  sk: string,
  method: string,
  pathWithQuery: string,
  host: string,
  contentType?: string,
  body?: string
): string {
  let signingStr = `${method} ${pathWithQuery}\nHost: ${host}\n`;
  
  if (contentType) {
    signingStr += `Content-Type: ${contentType}\n`;
  }
  
  signingStr += "\n";

  if (body && contentType !== "application/octet-stream") {
    signingStr += body;
  }

  const hash = CryptoJS.HmacSHA1(signingStr, sk);
  const encodedSign = urlSafeBase64Encode(hash);

  return `Qiniu ${ak}:${encodedSign}`;
}

export interface QiniuBucket {
  id: string;
  tbl: string;
  region: string;
  file_num: number;
  storage_size: number;
  ctime: number;
}

/**
 * 获取用户的存储空间 (Bucket) 列表
 */
async function parseQiniuError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json();
    return new Error(data?.error || `${fallback}: ${response.status}`);
  } catch {
    return new Error(`${fallback}: ${response.status}`);
  }
}

export async function fetchBuckets(ak: string, sk: string): Promise<QiniuBucket[]> {
  const host = "uc.qiniuapi.com";
  const path = "/v3/buckets?shared=rd";
  const url = `https://${host}${path}`;
  
  const token = generateQiniuToken(ak, sk, "GET", path, host, "application/x-www-form-urlencoded");

  const response = await tauriFetch(url, {
    method: "GET",
    headers: {
      Authorization: token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    throw await parseQiniuError(response, "获取 Bucket 列表失败");
  }

  const data = await response.json();
  return data as QiniuBucket[];
}

export interface QiniuFile {
  key: string;      // 文件名
  hash: string;     // Etag / 文件 hash
  fsize: number;    // 文件大小 (bytes)
  mimeType: string; // MIME 类型
  putTime: number;  // 上传时间 (单位：100纳秒)
  type: number;     // 存储类型: 0普通 1低频 2归档...
}

export interface ListFilesResult {
  marker?: string;
  items: QiniuFile[];
  commonPrefixes?: string[];
}

/**
 * 获取指定存储空间下的文件列表
 * @param prefix    当前目录前缀，例如 "photos/2024/"
 * @param marker    分页游标
 * @param limit     每页最大条数（默认 1000）
 * @param delimiter 目录分隔符，传 "/" 时 API 会返回 commonPrefixes（子目录列表）
 */
export async function fetchFiles(
  ak: string, 
  sk: string, 
  bucket: string, 
  prefix: string = "", 
  marker: string = "", 
  limit: number = 1000,
  delimiter: string = ""
): Promise<ListFilesResult> {
  const host = "rsf.qiniuapi.com";
  let pathWithQuery = `/list?bucket=${bucket}&limit=${limit}`;
  
  if (prefix) {
    pathWithQuery += `&prefix=${encodeURIComponent(prefix)}`;
  }
  if (marker) {
    pathWithQuery += `&marker=${encodeURIComponent(marker)}`;
  }
  if (delimiter) {
    pathWithQuery += `&delimiter=${encodeURIComponent(delimiter)}`;
  }

  const url = `https://${host}${pathWithQuery}`;
  const token = generateQiniuToken(ak, sk, "GET", pathWithQuery, host, "application/x-www-form-urlencoded");

  const response = await tauriFetch(url, {
    method: "GET",
    headers: {
      Authorization: token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    throw await parseQiniuError(response, "获取文件列表失败");
  }

  const data = await response.json();
  return data as ListFilesResult;
}

/**
 * 获取指定存储空间绑定的域名列表
 */
export async function fetchBucketDomains(ak: string, sk: string, bucket: string): Promise<string[]> {
  const host = "api.qiniu.com";
  const pathWithQuery = `/v6/domain/list?tbl=${bucket}`;
  const url = `https://${host}${pathWithQuery}`;
  
  const token = generateQiniuToken(ak, sk, "GET", pathWithQuery, host, "application/x-www-form-urlencoded");

  const response = await tauriFetch(url, {
    method: "GET",
    headers: {
      Authorization: token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    console.warn(`获取域名列表失败 (${bucket}): ${response.status}`);
    return [];
  }

  const data = await response.json();
  return data as string[];
}



/**
 * 删除指定文件
 */
export async function deleteFile(ak: string, sk: string, bucket: string, key: string): Promise<void> {
  const host = "rs.qiniuapi.com";
  const entry = `${bucket}:${key}`;
  const encodedEntry = urlSafeBase64Encode(entry);
  const path = `/delete/${encodedEntry}`;
  const url = `https://${host}${path}`;

  const token = generateQiniuToken(ak, sk, "POST", path, host, "application/x-www-form-urlencoded");

  try {
    const response = await tauriFetch(url, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      if (response.status === 612) return;
      throw await parseQiniuError(response, "删除文件失败");
    }
  } catch (err: any) {
    throw err;
  }
}

/**
 * 创建新存储空间 (Bucket)
 */
export async function createBucket(ak: string, sk: string, bucket: string, region: string = "z0"): Promise<void> {
  const host = "uc.qiniuapi.com";
  const path = `/mkbucketv3/${bucket}/region/${region}`;
  const url = `https://${host}${path}`;

  const token = generateQiniuToken(ak, sk, "POST", path, host, "application/x-www-form-urlencoded");

  try {
    const response = await tauriFetch(url, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      if (response.status === 614) throw new Error("存储空间名称已存在（七牛云要求全网唯一），请换一个名称试试");
      if (response.status === 630) throw new Error("创建的存储空间数量已达上限");
      throw await parseQiniuError(response, "创建存储空间失败");
    }
  } catch (err: any) {
    throw err;
  }
}

/**
 * 删除存储空间 (Bucket)
 */
export async function deleteBucket(ak: string, sk: string, bucket: string): Promise<void> {
  const host = "uc.qiniuapi.com";
  const path = `/drop/${bucket}`;
  const url = `https://${host}${path}`;

  const token = generateQiniuToken(ak, sk, "POST", path, host, "application/x-www-form-urlencoded");

  try {
    const response = await tauriFetch(url, {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      if (response.status === 612) return;
      throw await parseQiniuError(response, "删除存储空间失败");
    }
  } catch (err: any) {
    throw err;
  }
}


/**
 * 生成文件下载 URL
 * 私有 bucket 需要签名，公开 bucket 直接返回原始 URL
 */
export function generateDownloadUrl(
  ak: string,
  sk: string,
  domain: string,
  key: string,
  isPrivate: boolean = true,
  expireSeconds: number = 3600
): string {
  if (!domain.startsWith("http")) domain = "http://" + domain;
  const baseUrl = `${domain}/${encodeURI(key)}`;
  if (!isPrivate) return baseUrl;

  const deadline = Math.floor(Date.now() / 1000) + expireSeconds;
  const urlWithDeadline = `${baseUrl}?e=${deadline}`;
  const hash = CryptoJS.HmacSHA1(urlWithDeadline, sk);
  const sign = urlSafeBase64Encode(hash);
  return `${urlWithDeadline}&token=${ak}:${sign}`;
}

export async function batchOperations(ak: string, sk: string, ops: string[]): Promise<any> {
  if (ops.length === 0) return [];
  const host = "rs.qiniuapi.com";
  const path = "/batch";
  const url = `https://${host}${path}`;
  const body = ops.map(op => `op=${op}`).join("&");
  const token = generateQiniuToken(ak, sk, "POST", path, host, "application/x-www-form-urlencoded", body);
  const response = await tauriFetch(url, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body
  });
  if (!response.ok && response.status !== 298) {
    throw await parseQiniuError(response, "批量操作失败");
  }
  return await response.json();
}

export async function batchDeleteFiles(ak: string, sk: string, bucket: string, keys: string[]): Promise<void> {
  const chunks = [];
  for (let i = 0; i < keys.length; i += 1000) {
    chunks.push(keys.slice(i, i + 1000));
  }
  for (const chunk of chunks) {
    const ops = chunk.map(key => {
      const encodedEntryURI = urlSafeBase64Encode(`${bucket}:${key}`);
      return `/delete/${encodedEntryURI}`;
    });
    await batchOperations(ak, sk, ops);
  }
}

/**
 * 重命名文件（七牛 move API，同 bucket 内改 key）
 */
export async function renameFile(
  ak: string, sk: string,
  bucket: string, oldKey: string, newKey: string
): Promise<void> {
  const host = "rs.qiniuapi.com";
  const srcEntry = urlSafeBase64Encode(`${bucket}:${oldKey}`);
  const dstEntry = urlSafeBase64Encode(`${bucket}:${newKey}`);
  const path = `/move/${srcEntry}/${dstEntry}/force/true`;
  const url = `https://${host}${path}`;
  const token = generateQiniuToken(ak, sk, "POST", path, host, "application/x-www-form-urlencoded");
  const response = await tauriFetch(url, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!response.ok) throw await parseQiniuError(response, "重命名失败");
}

/**
 * 根据区域代码获取上传域名
 */
function getUploadDomain(region: string): string {
  const domainMap: Record<string, string> = {
    'z0': 'up.qiniup.com',           // 华东
    'cn-east-1': 'up.qiniup.com',    // 华东
    'z1': 'up-z1.qiniup.com',        // 华北
    'cn-north-1': 'up-z1.qiniup.com', // 华北
    'z2': 'up-z2.qiniup.com',        // 华南
    'cn-south-1': 'up-z2.qiniup.com', // 华南
    'na0': 'up-na0.qiniup.com',      // 北美
    'us-north-1': 'up-na0.qiniup.com', // 北美
    'as0': 'up-as0.qiniup.com',      // 东南亚
    'ap-southeast-1': 'up-as0.qiniup.com', // 东南亚
    'cn-east-2': 'up-cn-east-2.qiniup.com', // 华东-浙江2
    'fog-cn-east-1': 'up-fog-cn-east-1.qiniup.com', // 华东-雾存储
  };
  return domainMap[region] || 'up.qiniup.com'; // 默认华东
}

/**
 * 创建虚拟文件夹
 * 七牛云没有真正的文件夹概念，通过上传一个 key 以 "/" 结尾的空文件来模拟
 * 使用上传凭证 + 直接 POST 到上传域名
 */
export async function createFolder(
  ak: string,
  sk: string,
  bucket: string,
  region: string,  // 新增：bucket 的区域
  folderKey: string  // 必须以 "/" 结尾，例如 "photos/2024/"
): Promise<void> {
  // 生成上传凭证 (Upload Token)
  // scope: bucket:key 限定只能上传这个 key
  const scope = `${bucket}:${folderKey}`;
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1小时有效
  const putPolicy = JSON.stringify({ scope, deadline });
  const encodedPolicy = urlSafeBase64Encode(putPolicy);
  const sign = CryptoJS.HmacSHA1(encodedPolicy, sk);
  const encodedSign = urlSafeBase64Encode(sign);
  const uploadToken = `${ak}:${encodedSign}:${encodedPolicy}`;

  // 根据区域选择正确的上传域名
  const uploadDomain = getUploadDomain(region);

  // 上传空文件到七牛云上传域名
  const formData = new FormData();
  formData.append("token", uploadToken);
  formData.append("key", folderKey);
  formData.append("file", new Blob([]), folderKey); // 空文件

  const response = await tauriFetch(`https://${uploadDomain}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw await parseQiniuError(response, "创建文件夹失败");
  }
}

export async function deleteDirectory(ak: string, sk: string, bucket: string, prefix: string): Promise<void> {
  let marker = "";
  while (true) {
    const res = await fetchFiles(ak, sk, bucket, prefix, marker, 1000);
    if (res.items && res.items.length > 0) {
      const keys = res.items.map((i: any) => i.key);
      await batchDeleteFiles(ak, sk, bucket, keys);
    }
    if (!res.marker) break;
    marker = res.marker;
  }
}

export async function forceDeleteBucket(ak: string, sk: string, bucket: string): Promise<void> {
  await deleteDirectory(ak, sk, bucket, "");
  await deleteBucket(ak, sk, bucket);
}
