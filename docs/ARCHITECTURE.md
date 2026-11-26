# 职责划分

## 前端

| 模块 | 职责 |
| --- | --- |
| `src/App.tsx` | 应用布局、登录会话、页面切换和更新入口 |
| `src/components/WindowTitlebar.tsx` | Windows 自绘窗口控制；macOS 在原生红黄绿按钮旁显示侧栏折叠入口，Linux 保留系统标题栏 |
| `src/pages/FileManager.tsx` | 文件管理界面、导航、排序、选择、对话框及编辑操作的交互协调 |
| `src/pages/file-manager/useDirectoryListing.ts` | 目录请求、搜索、分页、缓存、旧请求隔离，以及操作完成后的列表更新 |
| `src/pages/file-manager/useBucketDomains.ts` | 当前账号和空间的域名加载与共享缓存协调 |
| `src/pages/file-manager/useFileUploads.ts` | 上传文件选择、同名策略确认、任务创建、重试入口配置和结果处理 |
| `src/pages/file-manager/useFileDownloads.ts` | 下载确认、文件夹枚举、下载链接生成和任务提交 |
| `src/lib/qiniu.ts`、`src/lib/cdn.ts` | 七牛 API 的签名、请求、响应解析和业务错误处理 |
| `src/store/index.ts` | 账号相关的空间状态，以及主题、书签等应用设置 |
| `src/store/transfer.ts` | 跨页面共享的传输任务状态 |
| `src/lib/transfer-events.ts` | 统一接收原生传输事件，并批量更新任务状态 |
| `src/lib/upload-retry.ts` | 上传重试与并发重试约束 |

页面调用 Hook 返回的操作更新目录，不直接操作目录缓存。上传流程通过 `onUploaded(prefix)` 通知页面，页面协调目录刷新；上传模块不依赖目录模块。

导航、选择、排序和对话框仍由页面控制。账号记录存储方式和任务状态语义由对应模块维护。

## Rust 后端

| 模块 | 职责 |
| --- | --- |
| `src-tauri/src/lib.rs` | 组装应用、插件和命令注册，保留现有兼容入口 |
| `src-tauri/src/appearance.rs` | 为 Windows 启用自绘顶栏和窗口阴影；macOS 的覆盖式标题栏、隐藏标题及原生按钮位置由 `tauri.conf.json` 配置 |
| `src-tauri/src/accounts.rs` | 本地账号记录的读取、保存、重命名、删除和 Kodo 记录导入读取 |
| `src-tauri/src/qiniu_http.rs` | 七牛 HTTP 请求桥接、域名限制和非标准状态码保留 |
| `src-tauri/src/filesystem.rs` | 本地路径分类、文件夹扫描和上传文件清单准备 |
| `src-tauri/src/transfers/upload.rs` | SDK 上传、同名策略、并发控制、取消和上传进度事件 |
| `src-tauri/src/transfers/download.rs` | 下载执行、目标路径校验、文件写入和下载进度事件 |

本地文件扫描不依赖上传执行模块。上传执行复用扫描模块的文件收集逻辑。现有 Tauri 命令名称、参数、返回结构及传输事件名称保持一致，前端无需根据 Rust 模块路径调整调用。

单文件和批量下载复用流式下载实现，使用 64 KiB 文件写缓冲，将数据写入目标目录内的临时文件。完整接收并写入成功后才发布最终文件；发生错误时清理临时文件。单文件下载允许覆盖所选目标，批量下载拒绝覆盖，并在最终落地时再次检查同名冲突。批量下载的中间进度以 100 ms 间隔节流，开始和结束事件立即发送；中间进度不表示文件已经发布。

## 修改代码时

- 界面展示和交互入口放在页面或组件中；复杂的异步流程放在对应 Hook 中。
- 七牛 API 行为放在 `src/lib`，本地文件与 SDK 执行放在 Rust 对应模块中。
- 需要离开页面后继续展示的任务状态放在传输 Store 中，事件处理统一经过 `transfer-events.ts`。
- 修改目录请求或缓存时，从 `useDirectoryListing` 的公开操作进入，避免页面重新持有一份目录状态。
- Rust 回归测试随实现保存在 `qiniu_http` 和 `transfers/download/tests.rs` 中；下载测试使用本地模拟 HTTP 服务。

验证命令：`npm run build`、`cargo check --locked --manifest-path src-tauri/Cargo.toml`、`cargo test --locked --lib --manifest-path src-tauri/Cargo.toml`。
