# 资源复制 (copy)

> 参考来源: [七牛开发者中心 - 资源复制](https://developer.qiniu.com/kodo/1254/copy)

## 描述

本接口用于将指定文件复制为新命名文件。

---

## 请求

### 请求语法

```http
POST /copy/<EncodedEntryURISrc>/<EncodedEntryURIDest> HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu <AccessToken>
Content-Type: application/x-www-form-urlencoded
```

### 请求参数

| 参数名称 | 必填 | 说明 |
|---------|------|------|
| **EncodedEntryURISrc** | 是 | 源文件的 EntryURI，格式为 `<bucket>:<key>` 经过 URL 安全的 Base64 编码 |
| **EncodedEntryURIDest** | 是 | 目标文件的 EntryURI，格式为 `<bucket>:<key>` 经过 URL 安全的 Base64 编码 |

### 可选参数

在 URL 后添加查询参数：

| 参数名称 | 说明 |
|---------|------|
| **force=true** | 强制覆盖目标文件（如果存在） |

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

### 示例 1: 同空间复制

#### 请求示例

```http
POST /copy/dGVzdDpvcmlnaW5hbC50eHQ=/dGVzdDpjb3B5LnR4dA== HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

#### 响应示例

```http
HTTP/1.1 200 OK
Content-Length: 0
```

### 示例 2: 跨空间复制

#### 请求示例

```http
POST /copy/c291cmNlOmZpbGUudHh0/dGFyZ2V0OmZpbGUudHh0 HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

### 示例 3: 强制覆盖

#### 请求示例

```http
POST /copy/dGVzdDpvcmlnaW5hbC50eHQ=/dGVzdDpjb3B5LnR4dA==?force=true HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

---

## 使用说明

### 操作特点

1. **保留源文件**: 复制操作不会删除源文件
2. **跨空间**: 支持在不同空间之间复制文件
3. **元信息**: 复制后的文件会保留源文件的元信息
4. **独立文件**: 复制后的文件是独立的，修改不会影响源文件

### 注意事项

1. **目标文件存在**: 默认情况下，如果目标文件已存在会返回错误，需要使用 `force=true` 强制覆盖
2. **权限要求**: 需要对源空间有读权限，对目标空间有写权限
3. **存储费用**: 复制会产生额外的存储费用

### 应用场景

- 文件备份
- 创建文件副本
- 跨空间数据迁移
- 文件版本管理

---

## 代码示例

### JavaScript 示例

```javascript
async function copyFile(srcBucket, srcKey, destBucket, destKey, force = false) {
  // 编码源文件 URI
  const srcEntryURI = `${srcBucket}:${srcKey}`;
  const encodedSrc = btoa(srcEntryURI).replace(/\+/g, '-').replace(/\//g, '_');
  
  // 编码目标文件 URI
  const destEntryURI = `${destBucket}:${destKey}`;
  const encodedDest = btoa(destEntryURI).replace(/\+/g, '-').replace(/\//g, '_');
  
  // 构建 URL
  let url = `https://rs.qiniuapi.com/copy/${encodedSrc}/${encodedDest}`;
  if (force) {
    url += '?force=true';
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Qiniu ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  
  return response.ok;
}

// 使用示例
await copyFile('my-bucket', 'original.txt', 'my-bucket', 'backup.txt');
```

### Python 示例

```python
import base64
import requests

def copy_file(src_bucket, src_key, dest_bucket, dest_key, access_token, force=False):
    """复制文件"""
    # 编码源文件 URI
    src_entry_uri = f"{src_bucket}:{src_key}"
    encoded_src = base64.urlsafe_b64encode(src_entry_uri.encode()).decode()
    
    # 编码目标文件 URI
    dest_entry_uri = f"{dest_bucket}:{dest_key}"
    encoded_dest = base64.urlsafe_b64encode(dest_entry_uri.encode()).decode()
    
    # 构建 URL
    url = f"https://rs.qiniuapi.com/copy/{encoded_src}/{encoded_dest}"
    if force:
        url += "?force=true"
    
    response = requests.post(
        url,
        headers={
            'Authorization': f'Qiniu {access_token}',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    )
    
    return response.status_code == 200

# 使用示例
success = copy_file('my-bucket', 'file.txt', 'backup-bucket', 'file.txt', access_token)
```

---

## 与 move 接口的区别

| 特性 | copy | move |
|------|------|------|
| **源文件** | 保留 | 删除 |
| **用途** | 备份、复制 | 重命名、迁移 |
| **存储费用** | 增加 | 不变 |
| **可恢复性** | 源文件仍存在 | 源文件被删除 |

---

## 相关接口

- [move - 资源移动/重命名](./move.md)
- [delete - 资源删除](./delete.md)
- [batch - 批量操作](./batch.md)
- [stat - 资源元信息查询](./stat.md)
