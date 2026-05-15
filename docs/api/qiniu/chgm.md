# 资源元信息修改 (chgm)

> 参考来源: [七牛开发者中心 - 资源元信息修改](https://developer.qiniu.com/kodo/1252/chgm)

## 描述

本接口用于修改文件的 MIME 类型信息。

---

## 请求

### 请求语法

```http
POST /chgm/<EncodedEntryURI>/mime/<EncodedMimeType> HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu <AccessToken>
Content-Type: application/x-www-form-urlencoded
```

### 请求参数

| 参数名称 | 必填 | 说明 |
|---------|------|------|
| **EncodedEntryURI** | 是 | 指定资源的 EntryURI，格式为 `<bucket>:<key>` 经过 URL 安全的 Base64 编码 |
| **EncodedMimeType** | 是 | 新的 MIME 类型，经过 URL 安全的 Base64 编码 |

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

### 示例 1: 修改为 text/plain

#### 请求示例

```http
POST /chgm/dGVzdDpleGFtcGxlLnR4dA==/mime/dGV4dC9wbGFpbg== HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

#### 响应示例

```http
HTTP/1.1 200 OK
Content-Length: 0
```

### 示例 2: 修改为 application/json

#### 请求示例

```http
POST /chgm/dGVzdDpkYXRhLmpzb24=/mime/YXBwbGljYXRpb24vanNvbg== HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded
```

---

## 使用说明

### MIME 类型

MIME 类型（Multipurpose Internet Mail Extensions）用于标识文件的类型，常见的 MIME 类型包括：

| 文件类型 | MIME 类型 |
|---------|----------|
| **文本文件** | `text/plain` |
| **HTML** | `text/html` |
| **CSS** | `text/css` |
| **JavaScript** | `application/javascript` |
| **JSON** | `application/json` |
| **XML** | `application/xml` |
| **PDF** | `application/pdf` |
| **JPEG 图片** | `image/jpeg` |
| **PNG 图片** | `image/png` |
| **GIF 图片** | `image/gif` |
| **MP4 视频** | `video/mp4` |
| **MP3 音频** | `audio/mpeg` |
| **ZIP 压缩包** | `application/zip` |

### 编码说明

MIME 类型需要进行 URL 安全的 Base64 编码：

```javascript
// JavaScript 示例
const mimeType = 'application/json';
const encodedMimeType = btoa(mimeType).replace(/\+/g, '-').replace(/\//g, '_');
```

### 应用场景

1. **修正错误的 MIME 类型**: 上传时设置错误，需要修正
2. **优化下载体验**: 设置正确的 MIME 类型可以让浏览器正确处理文件
3. **内容类型转换**: 文件用途改变时修改 MIME 类型

### 注意事项

1. **不改变文件内容**: 只修改元信息，不改变文件实际内容
2. **影响下载行为**: MIME 类型会影响浏览器如何处理下载的文件
3. **权限要求**: 需要对空间有写权限

---

## 代码示例

### JavaScript 示例

```javascript
async function changeMimeType(bucket, key, newMimeType) {
  // 编码 EntryURI
  const entryURI = `${bucket}:${key}`;
  const encodedEntryURI = btoa(entryURI).replace(/\+/g, '-').replace(/\//g, '_');
  
  // 编码 MIME 类型
  const encodedMimeType = btoa(newMimeType).replace(/\+/g, '-').replace(/\//g, '_');
  
  // 构建 URL
  const url = `https://rs.qiniuapi.com/chgm/${encodedEntryURI}/mime/${encodedMimeType}`;
  
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
await changeMimeType('my-bucket', 'data.txt', 'application/json');
```

### Python 示例

```python
import base64
import requests

def change_mime_type(bucket, key, new_mime_type, access_token):
    """修改文件的 MIME 类型"""
    # 编码 EntryURI
    entry_uri = f"{bucket}:{key}"
    encoded_entry_uri = base64.urlsafe_b64encode(entry_uri.encode()).decode()
    
    # 编码 MIME 类型
    encoded_mime_type = base64.urlsafe_b64encode(new_mime_type.encode()).decode()
    
    # 构建 URL
    url = f"https://rs.qiniuapi.com/chgm/{encoded_entry_uri}/mime/{encoded_mime_type}"
    
    response = requests.post(
        url,
        headers={
            'Authorization': f'Qiniu {access_token}',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    )
    
    return response.status_code == 200

# 使用示例
success = change_mime_type('my-bucket', 'file.txt', 'text/plain', access_token)
```

---

## 相关接口

- [stat - 资源元信息查询](./stat.md)
- [batch - 批量操作](./batch.md)
- [chtype - 修改文件存储类型](https://developer.qiniu.com/kodo/api/3710/chtype)
