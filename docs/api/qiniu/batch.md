# 批量操作 (batch)

> 参考来源: [七牛开发者中心 - 批量操作](https://developer.qiniu.com/kodo/1250/batch)

## 描述

本接口用于在单一请求中执行多次获取元信息、移动、复制、删除操作，极大提高对象管理效率。

---

## 请求

### 请求语法

```http
POST /batch HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu <AccessToken>
Content-Type: application/x-www-form-urlencoded

op=<Operation1>&op=<Operation2>&op=<Operation3>...
```

### 支持的操作

| 操作 | 格式 | 说明 |
|------|------|------|
| **stat** | `stat/<EncodedEntryURI>` | 获取文件元信息 |
| **delete** | `delete/<EncodedEntryURI>` | 删除文件 |
| **copy** | `copy/<EncodedEntryURISrc>/<EncodedEntryURIDest>` | 复制文件 |
| **move** | `move/<EncodedEntryURISrc>/<EncodedEntryURIDest>` | 移动文件 |
| **chgm** | `chgm/<EncodedEntryURI>/mime/<EncodedMimeType>` | 修改 MIME 类型 |
| **chtype** | `chtype/<EncodedEntryURI>/type/<Type>` | 修改存储类型 |
| **deleteAfterDays** | `deleteAfterDays/<EncodedEntryURI>/<Days>` | 设置过期删除 |

### 请求头

| 头部名称 | 必填 | 说明 |
|---------|------|------|
| **Authorization** | 是 | 管理凭证，格式：`Qiniu <AccessToken>` |
| **Content-Type** | 是 | 必须为 `application/x-www-form-urlencoded` |

---

## 响应

### 响应内容

返回一个 JSON 数组，每个元素对应一个操作的结果：

```json
[
  {
    "code": 200,
    "data": { /* 操作结果数据 */ }
  },
  {
    "code": 612,
    "data": {
      "error": "no such file or directory"
    }
  }
]
```

### 响应字段

| 字段名称 | 类型 | 说明 |
|---------|------|------|
| **code** | number | HTTP 状态码，200 表示成功 |
| **data** | object | 操作结果数据或错误信息 |

---

## 示例

### 示例 1: 批量获取文件信息

#### 请求示例

```http
POST /batch HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded

op=stat/dGVzdDpmaWxlMS50eHQ=&op=stat/dGVzdDpmaWxlMi50eHQ=
```

#### 响应示例

```json
[
  {
    "code": 200,
    "data": {
      "fsize": 1024,
      "hash": "FhGxwQ...",
      "mimeType": "text/plain",
      "putTime": 15112568720620784,
      "type": 0,
      "status": 0
    }
  },
  {
    "code": 200,
    "data": {
      "fsize": 2048,
      "hash": "FjKxwR...",
      "mimeType": "text/plain",
      "putTime": 15112568820620784,
      "type": 0,
      "status": 0
    }
  }
]
```

### 示例 2: 批量删除文件

#### 请求示例

```http
POST /batch HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded

op=delete/dGVzdDpmaWxlMS50eHQ=&op=delete/dGVzdDpmaWxlMi50eHQ=&op=delete/dGVzdDpmaWxlMy50eHQ=
```

#### 响应示例

```json
[
  {
    "code": 200
  },
  {
    "code": 200
  },
  {
    "code": 612,
    "data": {
      "error": "no such file or directory"
    }
  }
]
```

### 示例 3: 混合操作

#### 请求示例

```http
POST /batch HTTP/1.1
Host: rs.qiniuapi.com
Authorization: Qiniu j853F3bLkWl59I5BOkWm6q1Z1mZClpr9Z9CLfDE0:...
Content-Type: application/x-www-form-urlencoded

op=stat/dGVzdDpmaWxlMS50eHQ=&op=delete/dGVzdDpmaWxlMi50eHQ=&op=copy/dGVzdDpmaWxlMy50eHQ=/dGVzdDpmaWxlNC50eHQ=
```

---

## 使用说明

### 批量限制

- 单次批量操作最多支持 **1000** 个操作
- 超过限制需要分批处理

### 错误处理

- 批量操作中某个操作失败不会影响其他操作
- 需要检查每个操作的返回码判断是否成功
- 建议记录失败的操作进行重试

### 性能优化

1. **合理分批**: 根据网络情况和操作复杂度合理设置批量大小
2. **并发控制**: 多个批次可以并发执行，但要控制并发数
3. **错误重试**: 对失败的操作实现重试机制

### 应用场景

- 批量删除文件
- 批量获取文件信息
- 批量修改文件属性
- 批量移动或复制文件

---

## 代码示例

### JavaScript 示例

```javascript
// 批量删除文件
async function batchDelete(bucket, keys) {
  const ops = keys.map(key => {
    const entryURI = `${bucket}:${key}`;
    const encodedEntryURI = btoa(entryURI).replace(/\+/g, '-').replace(/\//g, '_');
    return `op=delete/${encodedEntryURI}`;
  });
  
  const body = ops.join('&');
  
  const response = await fetch('https://rs.qiniuapi.com/batch', {
    method: 'POST',
    headers: {
      'Authorization': `Qiniu ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  
  return await response.json();
}
```

### Python 示例

```python
import base64
import requests

def batch_stat(bucket, keys, access_token):
    """批量获取文件信息"""
    ops = []
    for key in keys:
        entry_uri = f"{bucket}:{key}"
        encoded_entry_uri = base64.urlsafe_b64encode(entry_uri.encode()).decode()
        ops.append(f"op=stat/{encoded_entry_uri}")
    
    body = '&'.join(ops)
    
    response = requests.post(
        'https://rs.qiniuapi.com/batch',
        headers={
            'Authorization': f'Qiniu {access_token}',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        data=body
    )
    
    return response.json()
```

---

## 相关接口

- [stat - 资源元信息查询](./stat.md)
- [delete - 资源删除](./delete.md)
- [move - 资源移动/重命名](./move.md)
- [copy - 资源复制](./copy.md)
- [chgm - 资源元信息修改](./chgm.md)
