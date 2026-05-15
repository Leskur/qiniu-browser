# 发布指南

本文档说明如何发布 Qiniu Browser 的新版本。

## 快速发布

使用自动化脚本发布新版本：

```bash
npm run release <version>
```

例如：
```bash
npm run release 0.0.2
```

脚本会自动完成以下操作：
1. 更新所有配置文件中的版本号
2. 提交更改到 git
3. 创建版本 tag
4. 推送到 GitHub
5. 触发 GitHub Actions 自动构建

## 手动发布流程

### 1. 更新版本号

需要同步更新以下三个文件：

**package.json**
```json
{
  "version": "0.0.2"
}
```

**src-tauri/Cargo.toml**
```toml
[package]
version = "0.0.2"
```

**src-tauri/tauri.conf.json**
```json
{
  "version": "0.0.2"
}
```

### 2. 提交更改

```bash
git add .
git commit -m "chore: bump version to 0.0.2"
```

### 3. 创建 tag

```bash
git tag v0.0.2
```

### 4. 推送到 GitHub

```bash
git push origin main
git push origin v0.0.2
```

## GitHub Actions 自动构建

推送 tag 后，GitHub Actions 会自动构建以下平台的安装包：

### Windows
- `Qiniu-Browser_x.x.x_x64-setup.exe` - 安装程序
- `Qiniu-Browser_x.x.x_x64.msi` - MSI 安装包

### macOS
- `Qiniu-Browser_x.x.x_aarch64.dmg` - Apple Silicon (M1/M2/M3)
- `Qiniu-Browser_x.x.x_x64.dmg` - Intel 芯片

### Linux
- `qiniu-browser_x.x.x_amd64.deb` - Debian/Ubuntu
- `qiniu-browser_x.x.x_amd64.AppImage` - 通用格式

构建时间约 20-30 分钟。

## 发布 Release

1. 构建完成后，访问 GitHub 仓库的 [Releases](https://github.com/YOUR_USERNAME/qiniu-browser/releases) 页面
2. 找到自动创建的草稿 Release
3. 编辑 Release 说明，添加更新内容
4. 点击 "Publish release" 发布

## 更新日志模板

```markdown
## 新增功能
- 添加了 XXX 功能
- 支持 XXX 操作

## 问题修复
- 修复了 XXX 问题
- 解决了 XXX 崩溃

## 优化改进
- 优化了 XXX 性能
- 改进了 XXX 体验

## 其他
- 更新依赖版本
```

## 本地构建测试

发布前建议先在本地测试构建：

```bash
# 开发模式
npm run tauri dev

# 构建生产版本
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/` 目录。

## 版本号规范

遵循语义化版本规范（Semantic Versioning）：

- **主版本号 (x.0.0)**: 不兼容的重大更改
- **次版本号 (0.x.0)**: 向下兼容的功能新增
- **修订号 (0.0.x)**: 向下兼容的问题修复

示例：
- `0.0.1` - 初始版本
- `0.0.2` - Bug 修复
- `0.1.0` - 新功能
- `1.0.0` - 正式版本

## 注意事项

1. 确保三个配置文件的版本号一致
2. Tag 必须以 `v` 开头，如 `v0.0.2`
3. 自动创建的 Release 是草稿状态，需要手动发布
4. 需要仓库的 write 权限才能创建 Release

## 手动触发构建

如果需要重新构建（不创建新 tag）：

1. 访问 GitHub Actions 页面
2. 选择 "Release" workflow
3. 点击 "Run workflow"
4. 选择分支并运行
