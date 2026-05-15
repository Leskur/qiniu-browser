# 版本更新说明

## 自动更新

Qiniu Browser 支持自动检测新版本。当有新版本发布时，应用会自动提示更新。

### 更新流程

1. 应用启动时会自动检查更新
2. 如果有新版本，会弹出更新提示
3. 点击"更新"按钮即可自动下载并安装
4. 安装完成后重启应用即可

### 手动检查更新

如果想手动检查更新：
1. 访问 [Releases 页面](https://github.com/Leskur/qiniu-browser/releases)
2. 下载最新版本的安装包
3. 运行安装包覆盖安装

## 版本发布流程

### 使用自动化脚本（推荐）

```bash
# 发布新版本，例如 0.0.2
npm run release 0.0.2
```

脚本会自动：
1. 更新所有配置文件中的版本号
2. 提交更改并创建 git tag
3. 推送到 GitHub
4. 触发 GitHub Actions 自动构建
5. 生成更新配置文件

### 手动发布

```bash
# 1. 更新版本号
# 编辑以下文件：
# - package.json
# - src-tauri/Cargo.toml
# - src-tauri/tauri.conf.json
# - src/App.tsx (设置页面显示的版本号)

# 2. 提交更改
git add .
git commit -m "chore: bump version to 0.0.2"

# 3. 创建并推送 tag
git tag v0.0.2
git push origin main
git push origin v0.0.2
```

## 更新配置

更新功能的配置位于 `src-tauri/tauri.conf.json`：

```json
{
  "bundle": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/Leskur/qiniu-browser/releases/latest/download/latest.json"
      ],
      "dialog": true
    }
  }
}
```

### 配置说明

- `active`: 是否启用自动更新
- `endpoints`: 更新检查的 URL
- `dialog`: 是否显示更新对话框

## 版本号规范

遵循语义化版本规范（Semantic Versioning）：

- **主版本号 (x.0.0)**: 不兼容的重大更改
- **次版本号 (0.x.0)**: 向下兼容的功能新增
- **修订号 (0.0.x)**: 向下兼容的问题修复

## 注意事项

1. **版本号一致性**: 确保所有配置文件中的版本号一致
2. **Tag 格式**: 必须以 `v` 开头，如 `v0.0.2`
3. **更新文件**: GitHub Actions 会自动生成 `latest.json` 更新配置
4. **测试**: 发布前建议在本地测试构建

## 常见问题

### 更新检测失败

- 检查网络连接
- 确认 GitHub Releases 页面可访问
- 查看应用日志获取详细错误信息

### 更新下载失败

- 检查磁盘空间
- 确认有写入权限
- 尝试手动下载安装

### 更新安装失败

- 关闭所有应用实例
- 以管理员权限运行安装程序
- 检查防病毒软件是否拦截
