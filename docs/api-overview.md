# 七牛云对象存储 API 概览

> 参考来源: [七牛开发者中心 - API 概览](https://developer.qiniu.com/kodo/3939/overview-of-the-api)
> 最近更新时间: 2025-06-10 11:11:03

## 概述

本文档提供七牛云对象存储 Kodo 的完整 API 接口概览，包括 Service、Bucket 和 Object 三个层级的操作接口。

---

## Service API

Service 级别的接口用于管理账户下的所有存储空间。

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **buckets** | 列举请求者拥有的所有 Bucket | [查看文档](https://developer.qiniu.com/kodo/api/3926/get-service) |

### 使用场景
- 获取账户下所有存储空间列表
- 查看空间的基本信息和配置

---

## Bucket API

Bucket 级别的接口用于管理存储空间的创建、删除、配置等操作。

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **mkbucketv3** | 创建新的存储空间 | [查看文档](https://developer.qiniu.com/kodo/api/1382/mkbucketv3) |
| **drop** | 删除指定存储空间 | [查看文档](https://developer.qiniu.com/kodo/api/1601/drop-bucket) |
| **domains** | 获取一个空间绑定的所有域名列表 | [查看文档](https://developer.qiniu.com/kodo/api/3949/get-the-bucket-space-domain) |
| **private** | 设置空间访问权限 | [查看文档](https://developer.qiniu.com/kodo/api/3946/set-bucket-private) |
| **putBucketTagging** | 设置空间标签 | [查看文档](https://developer.qiniu.com/kodo/api/6314/put-bucket-tagging) |
| **getBucketTagging** | 查询空间标签 | [查看文档](https://developer.qiniu.com/kodo/api/6315/get-bucket-tagging) |
| **deleteBucketTagging** | 删除空间标签 | [查看文档](https://developer.qiniu.com/kodo/api/6316/delete-bucket-tagging) |

### 使用场景
- **空间管理**: 创建、删除存储空间
- **权限控制**: 设置公开或私有访问权限
- **域名管理**: 查看和管理绑定的域名
- **标签管理**: 通过标签对空间进行分类和管理

---

## Object API

Object 级别的接口用于管理存储空间内的文件对象，包括上传、下载、修改、删除等操作。

### 1. 上传相关接口

#### 简单上传

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **upload** | 用于在一次 HTTP 会话中上传单一的一个对象 | [查看文档](https://developer.qiniu.com/kodo/api/1312/upload) |

**适用场景**: 小文件上传（建议 < 100MB）

#### 分片上传 v1 版

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **mkblk** | 为后续分片上传创建一个新的块，同时上传第一片数据 | [查看文档](https://developer.qiniu.com/kodo/api/1286/mkblk) |
| **bput** | 上传指定块的一片数据，具体数据量可根据现场环境调整，同一块的每片数据必须串行上传 | [查看文档](https://developer.qiniu.com/kodo/api/1251/bput) |
| **mkfile** | 将上传好的所有数据块按指定顺序合并成一个对象资源 | [查看文档](https://developer.qiniu.com/kodo/api/1287/mkfile) |

**适用场景**: 大文件上传，支持断点续传

#### 分片上传 v2 版（推荐）

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **initiateMultipartUpload** | 通知服务端开启分块上传任务，得到全局唯一任务 UploadId | [查看文档](https://developer.qiniu.com/kodo/api/6365/initialize-multipartupload) |
| **uploadPart** | 分块上传数据，需指定的任务 UploadId | [查看文档](https://developer.qiniu.com/kodo/api/6366/upload-part) |
| **completeMultipartUpload** | 完成整个对象的分块上传，需指定的任务 UploadId | [查看文档](https://developer.qiniu.com/kodo/api/6368/complete-multipart-upload) |
| **abortMultipartUpload** | 中止分块上传任务，并且删除已经上传的块，需指定的任务 UploadId | [查看文档](https://developer.qiniu.com/kodo/api/6367/abort-multipart-upload) |
| **listParts** | 列举指定 UploadId 所属的所有已经上传成功 Part | [查看文档](https://developer.qiniu.com/kodo/api/6858/listparts) |

**适用场景**: 
- 大文件上传（> 100MB）
- 需要更好的并发控制
- 需要查询上传进度

### 2. 资源管理接口

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **list** | 用于列举指定空间里的所有对象条目 | [查看文档](https://developer.qiniu.com/kodo/api/1284/list) |
| **stat** | 仅获取对象的 Metadata 信息，不返回对象内容 | [查看文档](https://developer.qiniu.com/kodo/api/1308/stat) |
| **chgm** | 修改对象的 MIME 类型信息 | [查看文档](https://developer.qiniu.com/kodo/api/1252/chgm) |
| **move** | 将源空间的指定对象移动到目标空间，或在同一空间内对对象重命名 | [查看文档](https://developer.qiniu.com/kodo/api/1288/move) |
| **copy** | 将指定对象复制为新命名对象 | [查看文档](https://developer.qiniu.com/kodo/api/1254/copy) |
| **delete** | 删除指定对象 | [查看文档](https://developer.qiniu.com/kodo/api/1257/delete) |
| **batch** | 指在单一请求中执行多次获取元信息、移动、复制、删除操作，极大提高对象管理效率 | [查看文档](https://developer.qiniu.com/kodo/api/1250/batch) |

**使用场景**:
- **list**: 浏览文件列表、搜索文件
- **stat**: 获取文件大小、类型、上传时间等元信息
- **chgm**: 修改文件的 Content-Type
- **move**: 文件重命名或跨空间移动
- **copy**: 文件备份、复制
- **delete**: 删除不需要的文件
- **batch**: 批量操作，提高效率

### 3. 存储状态管理接口

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **chstatus** | 修改对象的存储状态，即切换启用、禁用状态 | [查看文档](https://developer.qiniu.com/kodo/api/4173/modify-the-file-status) |
| **chtype** | 修改对象的存储类型信息，即标准存储、低频存储、归档直读存储等不同存储类型之间的互相转换 | [查看文档](https://developer.qiniu.com/kodo/api/3710/chtype) |
| **restoreAr** | 解冻归档存储类型的对象 | [查看文档](https://developer.qiniu.com/kodo/api/6380/restore-archive) |

**存储类型说明**:
- **标准存储**: 高频访问场景，访问速度快
- **低频存储**: 低频访问场景，存储成本低
- **归档直读存储**: 长期存储，成本更低，需要解冻后访问
- **归档存储**: 极少访问，成本最低
- **深度归档存储**: 长期归档，成本极低

### 4. 生命周期管理接口

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **deleteAfterDays** | 设置一个对象多少天后过期删除 | [查看文档](https://developer.qiniu.com/kodo/api/1732/update-file-lifecycle) |
| **lifecycle** | 修改已上传对象的生命周期，即修改对象转低频时间、转归档直读时间、转归档时间、转深度归档时间和过期删除时间 | [查看文档](https://developer.qiniu.com/kodo/api/8062/modify-object-life-cycle) |

**使用场景**:
- 自动清理过期文件
- 自动转换存储类型以降低成本
- 实现数据的生命周期管理策略

### 5. 资源抓取接口

| 接口 | 说明 | 文档链接 |
|------|------|----------|
| **prefetch** | 对于设置了镜像存储的空间，从镜像源站抓取指定名称的对象并存储到该空间中 | [查看文档](https://developer.qiniu.com/kodo/api/1293/prefetch) |
| **sisyphus/fetch** | 从指定 URL 抓取对象，并将该对象存储到指定空间中。每次只抓取一个对象，抓取时可以指定保存空间名和最终对象名 | [查看文档](https://developer.qiniu.com/kodo/api/4097/asynch-fetch) |

**使用场景**:
- **prefetch**: 镜像回源，自动从源站同步文件
- **sisyphus/fetch**: 从第三方 URL 抓取文件到七牛云存储

---

## API 调用规范

### 1. 认证方式

七牛云 API 使用以下几种认证方式：

- **上传凭证 (Upload Token)**: 用于文件上传操作
- **管理凭证 (Access Token)**: 用于资源管理操作
- **下载凭证 (Download Token)**: 用于私有资源下载

### 2. 请求域名

不同的 API 使用不同的服务域名：

- **上传域名**: `upload.qiniup.com` 或区域专属域名
- **管理域名**: `rs.qiniu.com` 或 `rsf.qiniu.com`
- **下载域名**: 绑定的自定义域名或默认域名

### 3. 数据格式

- 请求参数通常使用 URL 编码或 JSON 格式
- 文件名（key）需要进行 URL 安全的 Base64 编码
- 响应通常为 JSON 格式

### 4. 错误处理

API 调用失败时会返回相应的 HTTP 状态码和错误信息：

- **2xx**: 成功
- **4xx**: 客户端错误（如参数错误、认证失败）
- **5xx**: 服务器错误

---

## 最佳实践

### 1. 上传策略

- **小文件（< 100MB）**: 使用简单上传接口
- **大文件（> 100MB）**: 使用分片上传 v2 版接口
- **需要断点续传**: 使用分片上传接口

### 2. 批量操作

使用 `batch` 接口可以在一次请求中执行多个操作，显著提高效率：
- 批量获取文件信息
- 批量删除文件
- 批量移动或复制文件

### 3. 存储成本优化

- 使用生命周期管理自动转换存储类型
- 定期清理不需要的文件
- 根据访问频率选择合适的存储类型

### 4. 安全建议

- 不要在客户端暴露 AccessKey 和 SecretKey
- 使用上传凭证控制上传权限
- 为私有资源使用下载凭证
- 设置合理的凭证过期时间

---

## 相关文档

- [Object 接口详细文档](./api-object.md)
- [上传接口文档](./api-upload.md)
- [HTTP Headers 说明](https://developer.qiniu.com/kodo/3924/common-request-headers)
- [错误响应说明](https://developer.qiniu.com/kodo/3928/error-responses)
- [数据格式说明](https://developer.qiniu.com/kodo/1276/data-format)

---

## 快速导航

### 按功能分类

**文件上传**
- [简单上传](https://developer.qiniu.com/kodo/api/1312/upload)
- [分片上传 v2](https://developer.qiniu.com/kodo/api/6365/initialize-multipartupload)

**文件管理**
- [列举文件](https://developer.qiniu.com/kodo/api/1284/list)
- [获取文件信息](https://developer.qiniu.com/kodo/api/1308/stat)
- [删除文件](https://developer.qiniu.com/kodo/api/1257/delete)
- [批量操作](https://developer.qiniu.com/kodo/api/1250/batch)

**空间管理**
- [创建空间](https://developer.qiniu.com/kodo/api/1382/mkbucketv3)
- [删除空间](https://developer.qiniu.com/kodo/api/1601/drop-bucket)
- [设置访问权限](https://developer.qiniu.com/kodo/api/3946/set-bucket-private)

**存储优化**
- [修改存储类型](https://developer.qiniu.com/kodo/api/3710/chtype)
- [生命周期管理](https://developer.qiniu.com/kodo/api/8062/modify-object-life-cycle)
- [解冻归档文件](https://developer.qiniu.com/kodo/api/6380/restore-archive)
