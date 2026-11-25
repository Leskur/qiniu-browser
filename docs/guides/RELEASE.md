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

发布环境固定为以下版本：

| 构建目标 | Runner |
| --- | --- |
| macOS Apple Silicon | `macos-15`（ARM64） |
| macOS Intel | `macos-15-intel`（x64） |
| Windows x64 | `windows-2025` |
| Linux x64 | `ubuntu-22.04` |
| 发布 Release | `ubuntu-22.04` |

Node.js 固定为 `26` 主版本，Rust 固定为 `1.94.1`。Node.js 仍接收 26 系列内的更新，Runner 镜像中的预装工具也会更新；这并非完整的环境快照。升级系统或工具链时，应单独修改工作流并验证构建。

### Windows
- `Qiniu.Browser_x.x.x_Windows_x64_setup.exe` - 64 位 Intel / AMD 安装程序

### macOS
- `Qiniu.Browser_x.x.x_macOS_Apple-Silicon.dmg` - Apple Silicon（M1、M2、M3、M4 等 M 系列芯片）
- `Qiniu.Browser_x.x.x_macOS_Intel.dmg` - Intel 芯片

### Linux
- `Qiniu.Browser_x.x.x_Linux_x64.deb` - Debian / Ubuntu，64 位 Intel / AMD
- `Qiniu.Browser_x.x.x_Linux_x64.AppImage` - AppImage 格式，64 位 Intel / AMD

发布附件通过 `tauri-action` 的 `assetNamePattern` 统一命名，自动更新包及其 `.sig` 签名也使用同一规则，`latest.json` 自动引用改名后的下载地址。macOS 的自动更新包命名为 `Qiniu.Browser_x.x.x_macOS_Apple-Silicon.app.tar.gz` 或 `Qiniu.Browser_x.x.x_macOS_Intel.app.tar.gz`，手动安装请下载 `.dmg`。

此命名规则在包含该配置的后续发布中生效，不会修改已经发布的附件。本地 `npm run tauri build` 仍使用 Tauri 默认产物名。旧版 macOS 安装包的 `aarch64.dmg` 对应 M 系列芯片，`x64.dmg` 对应 Intel 芯片。

构建时间约 20-30 分钟。

## 发布 Release

各平台构建期间，安装包上传到草稿。所有平台构建成功后，GitHub Actions 会自动发布正式版。任一平台构建失败时，版本保持草稿状态。发布完成后可在 [Releases](https://github.com/Leskur/qiniu-browser/releases) 查看。

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
3. 需要仓库的 write 权限才能创建 Release

## 手动触发构建

如果需要重新构建（不创建新 tag）：

1. 访问 GitHub Actions 页面
2. 选择 "Release" workflow
3. 点击 "Run workflow"
4. 选择已有的版本 tag（如 `v0.0.2`）并运行
