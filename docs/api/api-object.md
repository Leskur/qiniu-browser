# 七牛云对象存储 Object 接口文档

> 参考来源: [七牛开发者中心 - Object 接口](https://developer.qiniu.com/kodo/1274/rs)
> 最近更新时间: 2021-12-06 12:19:58

## 概述

对象管理相关的接口，用于管理七牛云对象存储中的文件资源。

## 接口列表

### 上传相关

| 接口 | 说明 |
|------|------|
| [upload](https://developer.qiniu.com/kodo/api/1312/upload) | 用于在一次 HTTP 会话中上传单一的一个对象 |
| [mkblk](https://developer.qiniu.com/kodo/api/1286/mkblk) | 为后续分片上传创建一个新的块，同时上传第一片数据 |
| [bput](https://developer.qiniu.com/kodo/api/1251/bput) | 上传指定块的一片数据，具体数据量可根据现场环境调整，同一块的每片数据必须串行上传 |
| [mkfile](https://developer.qiniu.com/kodo/api/1287/mkfile) | 将上传好的所有数据块按指定顺序合并成一个对象资源 |

### 分片上传 v2 版

| 接口 | 说明 |
|------|------|
| [initiateMultipartUpload](https://developer.qiniu.com/kodo/api/6365/initialize-multipartupload) | 通知服务端开启分块上传任务，得到全局唯一任务 UploadId |
| [uploadPart](https://developer.qiniu.com/kodo/api/6366/upload-part) | 分块上传数据，需指定的任务 UploadId |
| [completeMultipartUpload](https://developer.qiniu.com/kodo/api/6368/complete-multipart-upload) | 完成整个对象的分块上传，需指定的任务 UploadId |
| [abortMultipartUpload](https://developer.qiniu.com/kodo/api/6367/abort-multipart-upload) | 中止分块上传任务，并且删除已经上传的块，需指定的任务 UploadId |
| [listParts](https://developer.qiniu.com/kodo/api/6858/listparts) | 列举指定 UploadId 所属的所有已经上传成功 Part |

### 资源管理

| 接口 | 说明 |
|------|------|
| [list](https://developer.qiniu.com/kodo/api/1284/list) | 用于列举指定空间里的所有对象条目 |
| [stat](https://developer.qiniu.com/kodo/api/1308/stat) | 仅获取对象的 Metadata 信息，不返回对象内容 |
| [chgm](https://developer.qiniu.com/kodo/api/1252/chgm) | 修改对象的 MIME 类型信息 |
| [move](https://developer.qiniu.com/kodo/api/1288/move) | 将源空间的指定对象移动到目标空间，或在同一空间内对对象重命名 |
| [copy](https://developer.qiniu.com/kodo/api/1254/copy) | 将指定对象复制为新命名对象 |
| [delete](https://developer.qiniu.com/kodo/api/1257/delete) | 删除指定对象 |
| [batch](https://developer.qiniu.com/kodo/api/1250/batch) | 指在单一请求中执行多次获取元信息、移动、复制、删除操作，极大提高对象管理效率 |

### 存储状态管理

| 接口 | 说明 |
|------|------|
| [chstatus](https://developer.qiniu.com/kodo/api/4173/modify-the-file-status) | 修改对象的存储状态，即切换启用、禁用状态 |
| [chtype](https://developer.qiniu.com/kodo/api/3710/chtype) | 修改对象的存储类型信息，即低频存储、标准存储和归档存储的互相转换 |
| [restoreAr](https://developer.qiniu.com/kodo/api/6380/restore-archive) | 解冻归档存储类型的对象 |

### 生命周期管理

| 接口 | 说明 |
|------|------|
| [deleteAfterDays](https://developer.qiniu.com/kodo/api/1732/update-file-lifecycle) | 设置一个对象多少天后过期删除 |
| [lifecycle](https://developer.qiniu.com/kodo/api/8062/modify-object-life-cycle) | 修改已上传对象的生命周期，即修改对象转低频时间、转归档时间、过期删除时间 |

### 资源抓取

| 接口 | 说明 |
|------|------|
| [prefetch](https://developer.qiniu.com/kodo/api/1293/prefetch) | 对于设置了镜像存储的空间，从镜像源站抓取指定名称的对象并存储到该空间中 |
| [sisyphus/fetch](https://developer.qiniu.com/kodo/api/4097/asynch-fetch) | 从指定 URL 抓取对象，并将该对象存储到指定空间中。每次只抓取一个对象，抓取时可以指定保存空间名和最终对象名 |

## 使用说明

### 认证方式

所有 Object 接口都需要使用七牛云的认证机制：

1. **上传凭证 (Upload Token)**: 用于上传操作
2. **管理凭证 (Access Token)**: 用于资源管理操作
3. **下载凭证 (Download Token)**: 用于私有资源下载

### 常见使用场景

#### 1. 简单文件上传
使用 `upload` 接口直接上传小文件（建议 < 100MB）

#### 2. 大文件分片上传
- **v1 版本**: 使用 `mkblk` → `bput` → `mkfile` 流程
- **v2 版本**: 使用 `initiateMultipartUpload` → `uploadPart` → `completeMultipartUpload` 流程

#### 3. 批量操作
使用 `batch` 接口可以在一次请求中执行多个操作，提高效率

#### 4. 存储类型转换
使用 `chtype` 接口在标准存储、低频存储、归档存储之间转换

## 相关文档

- [上传接口文档](./api-upload.md)
- [API 概览](https://developer.qiniu.com/kodo/3939/overview-of-the-api)
- [数据格式](https://developer.qiniu.com/kodo/1276/data-format)
- [错误响应](https://developer.qiniu.com/kodo/3928/error-responses)

## 注意事项

1. 所有接口调用都需要正确的认证凭证
2. 分片上传时，同一块的每片数据必须串行上传
3. 归档存储的文件需要先解冻才能访问
4. 批量操作接口有单次请求的操作数量限制
5. 文件名（key）需要进行 URL 安全的 Base64 编码
