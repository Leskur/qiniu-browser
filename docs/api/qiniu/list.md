# 资源列举 (list)

> 参考来源: [七牛开发者中心 - 资源列举](https://developer.qiniu.com/kodo/1284/list)
> 最近更新时间: 2025-07-21 17:42:46

## 描述

本接口用于列举指定空间里的所有文件条目。

---

## 请求

### 请求语法

```http
GET /list?bucket=<Bucket>&marker=<Marker>&limit=<Limit>&prefix=<UrlEncodedPrefix>&delimiter=<UrlEncodedDelimiter> HTTP/1.1
Host:           rsf.qiniuapi.com
Content-Type:   application/x-www-form-urlencoded
X-Qiniu-Date: 20060102T150405Z
Authorization:  Qiniu <AccessToken>
```

### 请求参数

| 参数名称 | 必填 | 说明 |
|---------|------|------|
| **bucket** | 是 | 指定空间 |
| **marker** | 否 | 上一次列举返回的位置标记，作为本次列举的起点信息。默认值为空字符串 |
| **limit** | 否 | 本次列举的条目数，范围为 1-1000。默认值为 1000 |
| **prefix** | 否 | 指定前缀，只有资源名匹配该前缀的资源会被列出。默认值为空字符串 |
| **delimiter** | 否 | 指定目录分隔符，列出所有公共前缀（模拟列出目录效果）。默认值为空字符串 |

### 请求头

| 头部名称 | 必填 | 说明 |
|---------|------|------|
| **Authorization** | 是 | 该参数应严格按照[管理凭证](https://developer.qiniu.com/kodo/manual/1201/access-token)格式进行填充，否则会返回 401 错误码。一个合法的 Authorization 值应类似于：`Qiniu QNJi_bYJlmO5LeY08FfoNj9w_r7...` |
| **其他** | - | 该请求操作的实现使用了所有操作的公共请求头。详情请查阅[公共请求头](https://developer.qiniu.com/kodo/api/3924/common-request-headers) |

### 请求内容

该请求操作的请求体为空。

---

## 响应

### 响应头

| 头部名称 | 必填 | 说明 |
|---------|------|------|
| **Content-Type** | 是 | 正常情况下该值将被设为 `application/json`，表示返回 JSON 格式的文本信息 |
| **其他** | - | 该请求实现使用了所有操作的公共响应头。详细信息，请查阅[公共响应头](https://developer.qiniu.com/kodo/api/3924/common-request-headers) |

### 响应内容

| 字段名称 | 必响应项 | 说明 |
|---------|---------|------|
| **marker** | 是 | 起始条目标记，将作为下一次列举的参数传入。如果没有剩余条目则返回空字符串。类型：字符串 |
| **commonPrefixes** | 是 | 返回目录名的数组，如没有指定 `delimiter` 参数则返回空。类型：数组 |
| **items** | 是 | 返回条目的数组。不能用来判断是否还有剩余条目。类型：数组 |
| **key** | 是 | 资源名。类型：字符串 |
| **putTime** | 是 | 上传时间，单位：100纳秒，其值去掉低七位即为 Unix 时间戳。类型：数字 |
| **lastModify** | 是 | 文件修改时间，文件上传（含覆盖写）或修改元数据（含文件类型）、存储类型的时间。类型：数字 |
| **hash** | 是 | 文件的 HASH 值，即文件的七牛 ETag 值。类型：字符串 |
| **fsize** | 是 | 资源内容的大小，单位：字节。类型：数字 |
| **mimeType** | 是 | 资源的 MIME 类型。类型：字符串 |
| **endUser** | 否 | 资源内容的唯一属主标识，请参考[上传策略 (PutPolicy)](https://developer.qiniu.com/kodo/manual/1206/put-policy)。类型：字符串 |
| **type** | 是 | 资源的存储类型：<br>• `0` - 标准存储<br>• `1` - [低频存储](https://developer.qiniu.com/kodo/3956/kodo-category#IA)<br>• `2` - [归档存储](https://developer.qiniu.com/kodo/3956/kodo-category#archive)<br>• `3` - [深度归档存储](https://developer.qiniu.com/kodo/3956/kodo-category#deep_archive)<br>• `4` - [归档直读存储](https://developer.qiniu.com/kodo/3956/kodo-category#archive_ir)<br>• `5` - [智能分层存储](https://developer.qiniu.com/kodo/3956/kodo-category#INT)<br>类型：数字 |
| **status** | 是 | 文件的存储状态，即禁用状态和启用状态间的互相转换：<br>• `0` - 启用<br>• `1` - 禁用<br>请参考：[文件状态](https://developer.qiniu.com/kodo/api/4173/modify-the-file-status)。类型：数字 |
| **md5** | 否 | 文件 md5 值，32位16进制组成的字符串。只有通过直传文件和追加文件 API 上传的文件，服务端确保有该字段返回。如请求时服务端没有返回 md5 字段，可以通过请求 `qhash/md5` 方法来获取，比如 `http://test.com/test.mp4?qhash/md5` |

### 响应状态码

该操作的实现不会返回特殊错误。有关错误和错误代码列表的一般信息，请查阅[错误响应](https://developer.qiniu.com/kodo/api/3928/error-responses)。

---

## 示例

### 示例 1: 列出所有 00 打头的资源

#### 请求示例

```http
GET /list?bucket=test02&prefix=00 HTTP/1.1
Host: rsf.qiniuapi.com
User-Agent: Go-http-client/1.1
X-Qiniu-Date: 20171122T014120Z
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:XvRh0ABLViTohBkgKqa0upyiug0=
Content-Type: application/x-www-form-urlencoded
Accept-Encoding: gzip
```

*注：要在 `Authorization` 头部的 `<AccessToken>` 前添加 `Qiniu` 和半角空格。*

#### 响应示例

```http
HTTP/1.1 200 OK
Content-Length: 739
Connection: keep-alive
Content-Type: application/json
Date: Wed, 22 Nov 2017 01:41:20 GMT
Server: nginx
X-Reqid: QBUAAKUcoGrgRPkU

{
  "items": [
    {
      "key": "000001.pdf",
      "hash": "Fs3oFOyOFDUp5CEODM8J6xquSq3s",
      "fsize": 452584,
      "mimeType": "application/pdf",
      "putTime": 15112568720620784,
      "md5": "e41714a18899cf59c200a9bddfa78b95",
      "type": 0,
      "status": 0
    },
    {
      "key": "000002.ico",
      "hash": "FpGrGHQOjETYnwxmSF3uXmFpmZIb",
      "fsize": 5686,
      "mimeType": "image/x-icon",
      "putTime": 15112568850754920,
      "type": 0,
      "status": 0
    },
    {
      "key": "000003.png",
      "hash": "FreZ58OmkQe5ZRUktRsO3zoqRaHi",
      "fsize": 21741,
      "mimeType": "image/png",
      "putTime": 15112568948976712,
      "type": 0,
      "status": 0
    },
    {
      "key": "000004.png",
      "hash": "FreZ58OmkQe5ZRUktRsO3zoqRaHi",
      "fsize": 21741,
      "mimeType": "image/png",
      "putTime": 15112569033603324,
      "type": 0,
      "status": 0
    }
  ]
}
```

### 示例 2: 列出所有 00 打头的资源并每批 2 个

#### 请求示例

```http
GET /list?bucket=test02&prefix=00&limit=2 HTTP/1.1
Host: rsf.qiniuapi.com
User-Agent: Go-http-client/1.1
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:m-2lEHcnRVwgYBqJdC5SW7groT8=
Content-Type: application/x-www-form-urlencoded
Accept-Encoding: gzip
```

#### 响应示例

```http
HTTP/1.1 200 OK
Content-Length: 352
Connection: keep-alive
Content-Type: application/json
Date: Wed, 22 Nov 2017 01:46:58 GMT
Server: nginx
X-Reqid: pEYAABGkVfAuRfkU

{
  "marker": "eyJjIjowLCJrIjoiMDAwMDAyLmljbyJ9",
  "items": [
    {
      "key": "000001.pdf",
      "hash": "Fs3oFOyOFDUp5CEODM8J6xquSq3s",
      "fsize": 452584,
      "mimeType": "application/pdf",
      "putTime": 15112568720620784,
      "type": 0,
      "status": 0
    },
    {
      "key": "000002.ico",
      "hash": "FpGrGHQOjETYnwxmSF3uXmFpmZIb",
      "fsize": 5686,
      "mimeType": "image/x-icon",
      "putTime": 15112568850754920,
      "type": 0,
      "status": 0
    }
  ]
}
```

---

## 使用说明

### 分页列举

1. 首次请求不传 `marker` 参数
2. 如果响应中的 `marker` 不为空，说明还有更多文件
3. 使用返回的 `marker` 作为下次请求的参数继续列举
4. 重复步骤 2-3 直到 `marker` 为空字符串

### 前缀搜索

使用 `prefix` 参数可以列举指定前缀的文件，例如：
- `prefix=images/` - 列举所有 images/ 目录下的文件
- `prefix=2024/01/` - 列举特定日期目录下的文件

### 目录模拟

使用 `delimiter` 参数（通常设为 `/`）可以模拟目录结构：
- 返回的 `commonPrefixes` 包含所有"子目录"
- 返回的 `items` 包含当前"目录"下的文件

### 性能优化

- 合理设置 `limit` 值，避免单次请求数据量过大
- 使用 `prefix` 缩小搜索范围
- 对于大量文件的空间，建议使用异步方式处理

---

## 相关接口

- [stat - 资源元信息查询](./stat.md)
- [batch - 批量操作](./batch.md)
- [delete - 资源删除](./delete.md)
