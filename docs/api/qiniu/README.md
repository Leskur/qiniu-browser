# 七牛云 API 详细文档

本目录包含七牛云对象存储 Kodo 的详细 API 接口文档。

## 📚 文档索引

### Service API
- [buckets - 获取 Bucket 列表](https://developer.qiniu.com/kodo/api/3926/get-service)

### Bucket API
- [mkbucketv3 - 创建 Bucket](https://developer.qiniu.com/kodo/api/1382/mkbucketv3)
- [drop - 删除 Bucket](https://developer.qiniu.com/kodo/api/1601/drop-bucket)
- [domains - 获取 Bucket 空间域名](https://developer.qiniu.com/kodo/api/3949/get-the-bucket-space-domain)
- [private - 设置 Bucket 访问权限](https://developer.qiniu.com/kodo/api/3946/set-bucket-private)
- [putBucketTagging - 设置空间标签](https://developer.qiniu.com/kodo/api/6314/put-bucket-tagging)
- [getBucketTagging - 查询空间标签](https://developer.qiniu.com/kodo/api/6315/get-bucket-tagging)
- [deleteBucketTagging - 删除空间标签](https://developer.qiniu.com/kodo/api/6316/delete-bucket-tagging)

### Object API - 上传相关

#### 简单上传
- [upload - 直传文件](https://developer.qiniu.com/kodo/api/1312/upload)

#### 分片上传 v1 版
- [mkblk - 创建块](https://developer.qiniu.com/kodo/api/1286/mkblk)
- [bput - 上传片](https://developer.qiniu.com/kodo/api/1251/bput)
- [mkfile - 创建文件](https://developer.qiniu.com/kodo/api/1287/mkfile)

#### 分片上传 v2 版（推荐）
- [initiateMultipartUpload - 初始化任务](https://developer.qiniu.com/kodo/api/6365/initialize-multipartupload)
- [uploadPart - 分块上传数据](https://developer.qiniu.com/kodo/api/6366/upload-part)
- [completeMultipartUpload - 完成文件上传](https://developer.qiniu.com/kodo/api/6368/complete-multipart-upload)
- [abortMultipartUpload - 终止上传](https://developer.qiniu.com/kodo/api/6367/abort-multipart-upload)
- [listParts - 列举已上传分片](https://developer.qiniu.com/kodo/api/6858/listparts)

### Object API - 资源管理

- [list - 资源列举](./list.md) ✅
- [stat - 资源元信息查询](./stat.md) ✅
- [chgm - 资源元信息修改](./chgm.md) ✅
- [move - 资源移动/重命名](./move.md) ✅
- [copy - 资源复制](./copy.md) ✅
- [delete - 资源删除](./delete.md) ✅
- [batch - 批量操作](./batch.md) ✅

### Object API - 存储状态管理

- [chstatus - 修改文件状态](https://developer.qiniu.com/kodo/api/4173/modify-the-file-status)
- [chtype - 修改文件存储类型](https://developer.qiniu.com/kodo/api/3710/chtype)
- [restoreAr - 解冻归档/深度归档存储文件](https://developer.qiniu.com/kodo/api/6380/restore-archive)

### Object API - 生命周期管理

- [deleteAfterDays - 修改文件过期删除时间](https://developer.qiniu.com/kodo/api/1732/update-file-lifecycle)
- [lifecycle - 修改文件生命周期](https://developer.qiniu.com/kodo/api/8062/modify-object-life-cycle)

### Object API - 资源抓取

- [prefetch - 镜像资源更新](https://developer.qiniu.com/kodo/api/1293/prefetch)
- [sisyphus/fetch - 异步第三方资源抓取](https://developer.qiniu.com/kodo/api/4097/asynch-fetch)

---

## 🔧 通用说明

### 认证方式

所有 API 接口都需要使用七牛云的认证机制：

1. **管理凭证 (Access Token)** - 用于资源管理操作
   - 格式：`Qiniu <AccessToken>`
   - 文档：[管理凭证](https://developer.qiniu.com/kodo/manual/1201/access-token)

2. **上传凭证 (Upload Token)** - 用于文件上传操作
   - 文档：[上传凭证](https://developer.qiniu.com/kodo/manual/1208/upload-token)

3. **下载凭证 (Download Token)** - 用于私有资源下载
   - 文档：[下载凭证](https://developer.qiniu.com/kodo/manual/1202/download-token)

### 请求域名

- **管理操作**: `rs.qiniu.com` 或 `rsf.qiniu.com`
- **上传操作**: `upload.qiniup.com` 或区域专属域名
- **下载操作**: 绑定的自定义域名或默认域名

### 数据格式

- **请求参数**: URL 编码或 JSON 格式
- **文件名编码**: URL 安全的 Base64 编码
- **响应格式**: JSON

### 错误处理

- **2xx**: 成功
- **4xx**: 客户端错误（参数错误、认证失败等）
- **5xx**: 服务器错误

详细错误码请参考：[错误响应](https://developer.qiniu.com/kodo/api/3928/error-responses)

---

## 📖 相关文档

- [API 概览](../api-overview.md)
- [Object 接口](../api-object.md)
- [上传接口](../api-upload.md)
- [HTTP Headers 说明](https://developer.qiniu.com/kodo/3924/common-request-headers)
- [数据格式说明](https://developer.qiniu.com/kodo/1276/data-format)

---

## 💡 使用建议

### 开发流程

1. **了解基础概念** - 阅读 API 概览文档
2. **选择合适接口** - 根据需求选择对应的 API
3. **查看详细文档** - 阅读具体接口的详细说明
4. **测试接口** - 使用测试工具验证接口调用
5. **集成到项目** - 将接口集成到实际项目中

### 最佳实践

1. **使用批量接口** - 对于多个操作，使用 batch 接口提高效率
2. **合理设置超时** - 根据文件大小和网络情况设置合理的超时时间
3. **错误重试** - 实现合理的错误重试机制
4. **日志记录** - 记录关键操作的日志便于排查问题
5. **安全存储密钥** - 不要在客户端暴露 AccessKey 和 SecretKey

### 性能优化

1. **使用 CDN** - 为下载操作配置 CDN 加速
2. **分片上传** - 大文件使用分片上传提高成功率
3. **并发控制** - 合理控制并发请求数量
4. **缓存策略** - 对不常变化的数据进行缓存

---

## 🔗 快速链接

### 常用操作

- [上传文件](https://developer.qiniu.com/kodo/api/1312/upload)
- [列举文件](./list.md)
- [获取文件信息](./stat.md)
- [删除文件](./delete.md)
- [批量操作](./batch.md)

### 高级功能

- [分片上传 v2](https://developer.qiniu.com/kodo/api/6365/initialize-multipartupload)
- [修改存储类型](https://developer.qiniu.com/kodo/api/3710/chtype)
- [生命周期管理](https://developer.qiniu.com/kodo/api/8062/modify-object-life-cycle)
- [资源抓取](https://developer.qiniu.com/kodo/api/4097/asynch-fetch)

---

## 📝 文档说明

- ✅ 标记表示已创建详细文档
- 未标记的接口请访问官方文档链接
- 文档持续更新中，欢迎贡献

---

**最后更新**: 2026-05-13
