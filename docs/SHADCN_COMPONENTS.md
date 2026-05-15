# shadcn/ui 组件参考

官方文档：https://ui.shadcn.com/docs/components

本项目已安装并使用以下组件。

---

## 本项目使用的组件

| 组件 | 用途 |
|------|------|
| `Button` | 通用按钮 |
| `Card` / `CardContent` / `CardHeader` / `CardTitle` / `CardDescription` / `CardFooter` | 登录卡片 |
| `Input` | 表单输入框 |
| `Label` | 表单标签 |
| `Checkbox` | 复选框（记住我） |
| `Sonner` (toast) | 全局通知，`<Toaster position="bottom-right" richColors />` 挂载在 `App.tsx` |

---

## Sonner（Toast 通知）

> 项目统一使用 Sonner，不再引入 shadcn 的旧版 Toast 组件。

### 挂载

```tsx
// App.tsx
import { Toaster } from "sonner";
<Toaster position="bottom-right" richColors />
```

### 用法

```ts
import { toast } from "sonner";

toast("普通消息");
toast.success("操作成功");
toast.error("操作失败");
toast.warning("注意事项");
toast.loading("加载中...", { duration: Infinity });

// 带描述
toast.error("刷新失败", { description: err.message });

// 带操作按钮
toast.success("提交成功", {
  description: `RequestID: ${res.requestId}`,
  action: { label: "查看", onClick: () => { /* ... */ } },
});

// 手动关闭（loading 场景）
const tid = toast.loading("处理中...", { duration: Infinity });
toast.dismiss(tid);
```

### 错误通知最佳实践

- **API 调用失败**（catch）→ `toast.error(err.message || "操作失败")`
- **部分项目无效**（invalidUrls 等）→ `toast.warning("N 个无效地址被忽略", { description: urls.join("\n") })`
- **全部成功** → `toast.success(...)`

---

## 可用组件列表（shadcn/ui）

以下为官方全部组件，按字母排序。按需通过 `npx shadcn@latest add <component>` 安装。

| 组件 | 说明 |
|------|------|
| Accordion | 手风琴折叠面板 |
| Alert | 行内提示横幅 |
| Alert Dialog | 强制确认对话框（需用户操作才能关闭） |
| Aspect Ratio | 维持宽高比容器 |
| Avatar | 用户头像 |
| Badge | 标签/徽章 |
| Breadcrumb | 面包屑导航 |
| Button | 按钮 |
| Button Group | 按钮组 |
| Calendar | 日历选择器 |
| Card | 卡片容器 |
| Carousel | 轮播 |
| Chart | 图表（基于 Recharts） |
| Checkbox | 复选框 |
| Collapsible | 可折叠区域 |
| Combobox | 可搜索下拉选择 |
| Command | 命令面板 / 搜索框 |
| Context Menu | 右键菜单 |
| Data Table | 数据表格（含排序/过滤/分页） |
| Date Picker | 日期选择器 |
| Dialog | 模态对话框 |
| Direction | 文字方向（LTR / RTL） |
| Drawer | 抽屉（底部滑出） |
| Dropdown Menu | 下拉菜单 |
| Empty | 空状态占位 |
| Field | 表单字段封装 |
| Hover Card | 悬停卡片 |
| Input | 输入框 |
| Input Group | 输入框组合（前缀/后缀） |
| Input OTP | 一次性密码输入 |
| Item | 列表项 |
| Kbd | 键盘快捷键显示 |
| Label | 表单标签 |
| Menubar | 菜单栏 |
| Native Select | 原生 `<select>` 封装 |
| Navigation Menu | 顶部导航菜单 |
| Pagination | 分页控件 |
| Popover | 气泡弹出层 |
| Progress | 进度条 |
| Radio Group | 单选组 |
| Resizable | 可拖拽调整大小面板 |
| Scroll Area | 自定义滚动区域 |
| Select | 下拉选择框 |
| Separator | 分隔线 |
| Sheet | 侧边抽屉 |
| Sidebar | 侧边栏 |
| Skeleton | 骨架屏加载占位 |
| Slider | 滑块 |
| **Sonner** | **Toast 通知（本项目使用）** |
| Spinner | 加载旋转图标 |
| Switch | 开关 |
| Table | 表格 |
| Tabs | 标签页 |
| Textarea | 多行文本框 |
| Toast | 旧版 Toast（已被 Sonner 取代） |
| Toggle | 切换按钮 |
| Toggle Group | 切换按钮组 |
| Tooltip | 工具提示 |
| Typography | 排版样式 |

---

## 安装命令

```bash
npx shadcn@latest add <component-name>
# 例如：
npx shadcn@latest add dialog
npx shadcn@latest add alert
```

组件文件会生成到 `src/components/ui/` 目录下。
