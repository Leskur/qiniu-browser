# 技术参考文档

本文档记录项目开发中的重要参考资料和技术要点。

---

## 📚 官方文档

### 七牛云 API
- **对象存储 API**: https://developer.qiniu.com/kodo/3939/overview-of-the-api
- **CDN API**: https://developer.qiniu.com/fusion/api/1227/file-refresh
- **区域列表**: https://developer.qiniu.com/kodo/1671/region-endpoint-fq

### Tauri
- **官方文档**: https://tauri.app/
- **API 参考**: https://tauri.app/v2/reference/
- **HTTP Plugin**: https://tauri.app/plugin/http/

### React & UI
- **React 文档**: https://react.dev/
- **Shadcn UI**: https://ui.shadcn.com/
- **Tailwind CSS**: https://tailwindcss.com/

---

## 🔑 核心技术要点

### 1. 七牛云认证机制

七牛云使用 Qbox Token 进行 API 认证：

```
Authorization: Qbox <AccessKey>:<EncodedSign>
```

签名算法：
1. 构造签名字符串：`<Method> <Path>\nHost: <Host>\n\n`
2. 使用 HMAC-SHA1 和 SecretKey 计算签名
3. Base64 URL Safe 编码

实现位置：`src/lib/qiniu.ts`

### 2. 跨域问题解决

七牛云 API 不支持浏览器跨域请求。解决方案：

- 使用 Tauri HTTP Plugin (`@tauri-apps/plugin-http`)
- 所有请求通过 Rust 后端发送
- 完全绕过浏览器的 CORS 限制

### 3. 文件上传

使用七牛云上传 API：
1. 生成上传 Token（包含上传策略）
2. 使用 multipart/form-data 格式上传
3. 支持直传和分片上传

### 4. 私有空间访问

私有空间文件需要带签名的下载链接：
1. 构造原始 URL
2. 添加过期时间参数
3. 使用 HMAC-SHA1 生成下载 Token
4. 拼接到 URL 参数中

---

## 🛠️ 开发工具

### 推荐 IDE
- Visual Studio Code
- WebStorm

### 推荐插件
- Tauri
- Rust Analyzer
- ESLint
- Prettier
- Tailwind CSS IntelliSense

### 调试工具
- Chrome DevTools (前端调试)
- Rust 日志输出 (后端调试)

---

## 📖 相关项目

### 官方工具
- **Kodo Browser**: https://github.com/qiniu/kodo-browser
  - 官方 Electron 版本客户端
  - 可参考其功能设计

### 社区项目
- **qiniu-js**: 七牛云 JavaScript SDK
- **qiniu-sdk**: 七牛云 Rust SDK

---

## 🔗 有用的链接

- **七牛云控制台**: https://portal.qiniu.com/
- **七牛云开发者中心**: https://developer.qiniu.com/
- **Tauri 示例**: https://github.com/tauri-apps/tauri/tree/dev/examples
- **Shadcn UI 示例**: https://ui.shadcn.com/examples

---

## 💡 开发建议

1. **API 调用**: 优先查阅官方 API 文档，确保参数正确
2. **错误处理**: 完善的错误提示能大幅提升用户体验
3. **性能优化**: 大文件列表需要分页或虚拟滚动
4. **安全性**: 凭证信息只存储在本地，不要上传到服务器
5. **跨平台**: 注意不同操作系统的路径和文件系统差异

---

## 📝 更新日志

本文档会随着项目发展持续更新，记录新的技术要点和参考资料。
