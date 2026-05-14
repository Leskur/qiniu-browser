# 资源删除 (delete)

> 参考来源: [七牛开发者中心 - 资源删除](https://developer.qiniu.com/kodo/1257/delete)

## 描述

本接口用于删除指定的文件。

---

## 请求

### 请求语法

```http
POST /delete/<EncodedEntryURI> HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu <AccessToken>
Content-Type: application/x-www-form-urlencoded
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

### 成功响应

HTTP 状态码 200，响应体为空。

### 错误响应

返回相应的错误状态码和错误信息。

---

## 示例

### 请求示例

```http
POST /delete/dGVzdDpleGFtcGxlLnR4dA== HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

### 响应示例

```http
HTTP/1.1 200 OK
Content-Length: 0
```

---

## 使用说明

### 注意事项

1. **不可恢复**: 删除操作不可恢复，请谨慎使用
2. **权限要求**: 需要有对应空间的删除权限
3. **批量删除**: 对于多个文件，建议使用 batch 接口提高效率

### 应用场景

- 清理过期文件
- 删除临时文件
- 空间管理和清理

---

## 相关接口

- [batch - 批量操作](./batch.md)
- [list - 资源列举](./list.md)
- [stat - 资源元信息查询](./stat.md)
