# Changelog

## 0.1.0 — 2026-11-01

首个可用版本：宿主工具 + Web 设置页 + 图片卡片内联渲染。

### 修复记录（开发过程中踩到的坑，均已并入 0.1.0）

- **配置校验**：`Config` 由普通对象改为 Standard Schema（`Config["~standard"].validate`）。
  Cordis 会调用 `validate`，缺它会抛 `Cannot read properties of undefined (reading 'validate')`，整条 row 挂载失败。
- **布尔转换**：手写校验器里用 `Boolean(raw)` 会把字符串 `"false"` 判成真，改为显式真值判断。
- **服务注入**：宿主半个 `inject` 补上 `tools`（原来只声明 `webServer`，读 `ctx.tools` 会抛
  `cannot get property "tools" without inject`，导致插件不激活）。
- **客户端注入**：客户端半个补上导出的 `inject`，否则 `ctx.slots` / `ctx.locale` 直接读取会被 cordis 拒绝。
- **工具参数 schema**：`image_generate` / `image_edit` 的入参改成 `type: "object"` 的 JSON Schema；
  结构不合法会随请求发给模型，导致所有模型返回 `INVALID_REQUEST`。
- **同源校验**：桌面端页面是 `dsh-app://app`，原实现要求 `Origin` 与 `Host` 相同，导致保存设置一律 403；
  改为放行非 http(s) 来源与回环地址，远程跨站仍然 403。
- **设置保存**：保存后同步回填 `hasApiKey`，避免「已配置 Key 却仍显示未配置」。
- **图片回显**：工具返回补上 `image` 内容块并把 PNG 写入 DSH 附件库，图片才能出现在对话里。
- **工具卡片视图**：注册 `tool.call.toolview`；**不再声明** `tool.call.images` 子槽位——
  该槽位已由官方 `read_image` 视图声明，重复声明会抛
  `slot "tool.call.images" is already declared`，使整个视图注册失败、回退到只渲染文字的通用卡片。
  现在卡片自己用 `loadImage` 渲染 `<img>`，并带加载中 / 失败重试 / URL 回退三态。
