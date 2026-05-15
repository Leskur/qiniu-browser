# 自动更新功能配置指南

本文档说明如何为 Qiniu Browser 配置自动更新功能。

## 📋 前提条件

已生成签名密钥对：
- 私钥：`~/.tauri/qiniu-browser.key`
- 公钥：`~/.tauri/qiniu-browser.key.pub`

公钥内容：
```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1M0NEODdBQ0M1QUVGNjMKUldSajcxck1ldGc4cFhqSUwvVVl2Q1hoQ21vQVV1b0RmQ3VBeXM4Q2duek9haEtKOFAvajJGOEQK
```

## 🔧 配置步骤

### 1. 添加 GitHub Secret

1. 访问仓库设置：https://github.com/Leskur/qiniu-browser/settings/secrets/actions
2. 点击 "New repository secret"
3. 添加以下 secret：

**Name**: `TAURI_SIGNING_PRIVATE_KEY`

**Value**: (私钥内容，运行以下命令获取)
```bash
# Windows PowerShell
Get-Content "$env:USERPROFILE\.tauri\qiniu-browser.key" -Raw

# macOS/Linux
cat ~/.tauri/qiniu-browser.key
```

### 2. 更新 tauri.conf.json

在 `src-tauri/tauri.conf.json` 中添加 updater 配置：

```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi", "deb", "appimage", "dmg"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "productName": "qiniu-browser",
  "version": "0.0.2"
}
```

注意：Tauri 2.0 的 updater 配置方式已改变，需要通过 Cargo.toml 配置。

### 3. 更新 Cargo.toml

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 中添加：

```toml
[dependencies]
tauri = { version = "2", features = ["updater"] }
```

### 4. 更新 GitHub Actions

在 `.github/workflows/release.yml` 中添加签名环境变量：

```yaml
- name: Build the app
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  with:
    tagName: ${{ github.ref_name }}
    releaseName: 'Qiniu Browser ${{ github.ref_name }}'
    releaseBody: 'See the assets to download and install this version.'
    releaseDraft: true
    prerelease: false
    args: ${{ matrix.args }}
```

### 5. 在应用中添加更新检查代码

在 `src/App.tsx` 中添加更新检查逻辑：

```typescript
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// 在组件挂载时检查更新
useEffect(() => {
  async function checkForUpdates() {
    try {
      const update = await check();
      if (update?.available) {
        const yes = confirm(
          `发现新版本 ${update.version}！\n\n${update.body}\n\n是否立即更新？`
        );
        if (yes) {
          await update.downloadAndInstall();
          await relaunch();
        }
      }
    } catch (error) {
      console.error('检查更新失败:', error);
    }
  }
  
  checkForUpdates();
}, []);
```

### 6. 安装必要的依赖

```bash
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

## 🚀 发布流程

配置完成后，每次发布新版本：

1. 更新版本号（使用 `npm run release x.x.x`）
2. 推送 tag 到 GitHub
3. GitHub Actions 自动构建并签名
4. 生成 `latest.json` 更新配置文件
5. 用户打开应用时自动检测更新

## 📝 更新配置文件

GitHub Actions 会自动生成 `latest.json`，包含：
- 最新版本号
- 更新说明
- 下载链接
- 签名信息

## ⚠️ 注意事项

1. **私钥安全**：
   - 私钥只存储在 GitHub Secrets 中
   - 不要提交到代码仓库
   - 不要分享给他人

2. **公钥配置**：
   - 公钥需要配置在应用中
   - 用于验证更新包的签名

3. **版本号规范**：
   - 必须遵循语义化版本
   - 新版本号必须大于当前版本

4. **测试**：
   - 发布前在本地测试更新流程
   - 确保签名正确

## 🔍 故障排查

### 更新检查失败
- 检查网络连接
- 确认 GitHub Releases 可访问
- 查看控制台错误日志

### 签名验证失败
- 确认公钥配置正确
- 检查私钥是否正确添加到 GitHub Secrets
- 验证更新包是否被正确签名

### 更新下载失败
- 检查磁盘空间
- 确认有写入权限
- 查看防火墙设置

## 📚 参考文档

- [Tauri Updater 文档](https://tauri.app/v2/guides/distribution/updater/)
- [tauri-action 文档](https://github.com/tauri-apps/tauri-action)
