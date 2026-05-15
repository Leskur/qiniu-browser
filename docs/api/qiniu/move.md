# 资源移动/重命名 (move)

> 参考来源: [七牛开发者中心 - 资源移动/重命名](https://developer.qiniu.com/kodo/1288/move)

## 描述

本接口用于将源空间的指定文件移动到目标空间，或在同一空间内对文件重命名。

---

## 请求

### 请求语法

```http
POST /move/<EncodedEntryURISrc>/<EncodedEntryURIDest> HTTP/1.1
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

### 示例 1: 同空间重命名

#### 请求示例

```http
POST /move/dGVzdDpvbGQudHh0/dGVzdDpuZXcudHh0 HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

#### 响应示例

```http
HTTP/1.1 200 OK
Content-Length: 0
```

### 示例 2: 跨空间移动

#### 请求示例

```http
POST /move/c291cmNlOmZpbGUudHh0/dGFyZ2V0OmZpbGUudHh0 HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

### 示例 3: 强制覆盖

#### 请求示例

```http
POST /move/dGVzdDpvbGQudHh0/dGVzdDpuZXcudHh0?force=true HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

---

## 使用说明

### 操作特点

1. **原子性**: 移动操作是原子性的，要么成功要么失败
2. **源文件删除**: 移动成功后源文件会被删除
3. **跨空间**: 支持在不同空间之间移动文件
4. **重命名**: 在同一空间内移动即为重命名

### 注意事项

1. **目标文件存在**: 默认情况下，如果目标文件已存在会返回错误，需要使用 `force=true` 强制覆盖
2. **权限要求**: 需要对源空间有读权限，对目标空间有写权限
3. **不可恢复**: 移动操作会删除源文件，请谨慎使用

### 应用场景

- 文件重命名
- 文件归档整理
- 跨空间迁移
- 目录结构调整

---

## 代码示例

### JavaScript 示例

```javascript
async function moveFile(srcBucket, srcKey, destBucket, destKey, force = false) {
  // 编码源文件 URI
  const srcEntryURI = `${srcBucket}:${srcKey}`;
  const encodedSrc = btoa(srcEntryURI).replace(/\+/g, '-').replace(/\//g, '_');
  
  // 编码目标文件 URI
  const destEntryURI = `${destBucket}:${destKey}`;
  const encodedDest = btoa(destEntryURI).replace(/\+/g, '-').replace(/\//g, '_');
  
  // 构建 URL
  let url = `https://rs.qiniuapi.com/move/${encodedSrc}/${encodedDest}`;
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
await moveFile('my-bucket', 'old-name.txt', 'my-bucket', 'new-name.txt');
```

### Python 示例

```python
import base64
import requests

def move_file(src_bucket, src_key, dest_bucket, dest_key, access_token, force=False):
    """移动或重命名文件"""
    # 编码源文件 URI
    src_entry_uri = f"{src_bucket}:{src_key}"
    encoded_src = base64.urlsafe_b64encode(src_entry_uri.encode()).decode()
    
    # 编码目标文件 URI
    dest_entry_uri = f"{dest_bucket}:{dest_key}"
    encoded_dest = base64.urlsafe_b64encode(dest_entry_uri.encode()).decode()
    
    # 构建 URL
    url = f"https://rs.qiniuapi.com/move/{encoded_src}/{encoded_dest}"
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
success = move_file('my-bucket', 'old.txt', 'my-bucket', 'new.txt', access_token)
```

---

## 相关接口

- [copy - 资源复制](./copy.md)
- [delete - 资源删除](./delete.md)
- [batch - 批量操作](./batch.md)
- [stat - 资源元信息查询](./stat.md)
