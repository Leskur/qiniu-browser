# 资源元信息查询 (stat)

> 参考来源: [七牛开发者中心 - 资源元信息查询](https://developer.qiniu.com/kodo/1308/stat)

## 描述

本接口用于获取指定文件的元信息，不返回文件内容。

---

## 请求

### 请求语法

```http
GET /stat/<EncodedEntryURI> HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu <AccessToken>
```

### 请求参数

| 参数名称 | 必填 | 说明 |
|---------|------|------|
| **EncodedEntryURI** | 是 | 指定资源的 EntryURI，格式为 `<bucket>:<key>` 经过 URL 安全的 Base64 编码后的字符串 |

### 请求头

| 头部名称 | 必填 | 说明 |
|---------|------|------|
| **Authorization** | 是 | 管理凭证，格式：`Qiniu <AccessToken>` |

---

## 响应

### 响应内容

| 字段名称 | 类型 | 说明 |
|---------|------|------|
| **fsize** | number | 文件大小，单位：字节 |
| **hash** | string | 文件的 ETag 值 |
| **mimeType** | string | 文件的 MIME 类型 |
| **putTime** | number | 上传时间，单位：100纳秒 |
| **type** | number | 存储类型：0-标准存储，1-低频存储，2-归档存储，3-深度归档，4-归档直读，5-智能分层 |
| **status** | number | 文件状态：0-启用，1-禁用 |
| **md5** | string | 文件的 MD5 值（如果有） |

---

## 示例

### 请求示例

```http
GET /stat/dGVzdDpleGFtcGxlLnR4dA== HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
```

### 响应示例

```json
{
  "fsize": 1024,
  "hash": "FhGxwQ...",
  "mimeType": "text/plain",
  "putTime": 15112568720620784,
  "type": 0,
  "status": 0
}
```

---

## 使用说明

### EntryURI 编码

EntryURI 格式为 `<bucket>:<key>`，需要进行 URL 安全的 Base64 编码：

```javascript
// JavaScript 示例
const bucket = 'my-bucket';
const key = 'example.txt';
const entryURI = `${bucket}:${key}`;
const encodedEntryURI = btoa(entryURI).replace(/\+/g, '-').replace(/\//g, '_');
```

### 应用场景

- 检查文件是否存在
- 获取文件大小和类型
- 查看文件上传时间
- 确认文件存储类型

---

## 相关接口

- [list - 资源列举](./list.md)
- [chgm - 资源元信息修改](./chgm.md)
- [batch - 批量操作](./batch.md)
