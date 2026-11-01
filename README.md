# dsh-image25

把 **Image 2.5**（`gpt-image-2.5` 系列）接进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的生图插件。

装上之后：

- 模型多出两个工具：`image_generate`（文生图）和 `image_edit`（按参考图改图）；
- Web 设置里多出一页 **「Image 2.5 生图」**，可以在 **低 / 中 / 高 / 很高 / 最高 / 自动** 六档之间切换生成质量；
- 生成的 PNG 落在 DSH 的 state 目录，并直接以图片形式回到对话里。

![生成示例](docs/preview.jpg)

## 特性

| 能力 | 说明 |
| --- | --- |
| 质量分档 | `low / medium / high / xhigh / max / auto`，中文也认：`低 / 中 / 高 / 很高 / 最高 / 自动` |
| 两种接入方式 | `api`（OpenAI 兼容 Images API，填 Key）或 `codex-subscription`（复用已登录的 ChatGPT/Codex 订阅，免 Key） |
| 改图 | 最多 5 张本地参考图（PNG / JPEG / WebP 绝对路径） |
| 尺寸 / 背景 | `auto` 或 16 的倍数（`1024x1024`、`1536x1024`、`1152x1536`…）；背景 `auto / transparent / opaque` |
| 图片回显 | 结果里带 `image` 内容块，卡片内联渲染，原图同时落盘 |
| 中英双语 | 设置页按 DSH 当前语言切换 |

## 安装

本插件是本地 `file:` 依赖，需要 DSH 0.2.x（`@deepseek-ai/cordis` 4.x）。

1. 把本仓库放到任意目录，例如 `D:\plugins\dsh-image25`。

2. 在 profile 的 `package.json`（Windows 是 `%USERPROFILE%\.dsh\profiles\desktop\package.json`）里加依赖和 bundle：

   ```jsonc
   {
     "dependencies": {
       "dsh-image25": "file:D:/plugins/dsh-image25"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-image25"
         ]
       }
     }
   }
   ```

3. 安装依赖并重启 DSH（侧边栏电源按钮 → 重启，不要选「禁用第三方插件」）。

   ```bash
   pnpm install
   ```

> 改完 `lib/` 里的代码后需要重启一次 DSH 才会重新加载，客户端 bundle 在启动时装配。

## 配置

打开 **设置 → Image 2.5 生图**：

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| 生成质量 | 低 / 中 / 高 / 很高 / 最高 / 自动 | 工具调用没带 `quality` 时用这里的默认值 |
| 模型 | `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` | |
| 接入方式 | `api` / `codex-subscription` | 前者需要 API Key，后者借用已登录订阅 |
| 接口地址 | 默认 `https://api.openai.com/v1` | 可换成任意 OpenAI 兼容网关 |
| API Key | 存进 DSH 凭据库 `IMAGE25_API_KEY` | 也可用环境变量 `IMAGE25_API_KEY` / `OPENAI_API_KEY` |
| 默认尺寸 / 背景 | `auto` 或 `宽x高` / `auto`·`transparent`·`opaque` | |

## 模型工具

```text
image_generate(prompt, quality?, size?, background?)
image_edit(prompt, referenceImages[], quality?, size?, background?)
```

- `referenceImages` 必须是**本地绝对路径**，1–5 个。
- `size` 两边都得是 16 的倍数，否则会掉回 `auto`。
- 生成的 PNG 存在 `$DSH_HOME/state/dsh-image25/images/`，网页通过 `/api/dsh-image25/images/<文件名>` 直接访问。

## HTTP 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/dsh-image25/status` | 当前设置、是否已配置 Key、可选质量列表 |
| `POST` | `/api/dsh-image25/config` | 保存设置（同源校验：桌面端 `dsh-app://` 与回环地址放行，远程跨站 403） |
| `POST` | `/api/dsh-image25/generate` | `{ prompt, quality?, size?, background?, referenceImages? }` |
| `GET` | `/api/dsh-image25/images/<name>` | 生成的图片 |

## 实现要点

插件同时含宿主半边和 Web 客户端半边，靠 `cordis.patch.yml` 一行装配：

- **宿主**（`lib/index.js`）：`inject: ["webServer", "tools"]`；用 Standard Schema 声明配置（Cordis 会调 `Config["~standard"].validate`，普通对象会让整条 row 挂载失败）；注册两个工具、设置接口和图片静态路由。
- **客户端**（`lib/client.js`）：`inject: ["slots", "locale"]`；往 `settings.section` 注册设置页，往 `tool.call.toolview` 按 wire 工具名注册卡片视图。
- **图片渲染**：官方 `read_image` 已经声明了 `tool.call.images` 子槽位，而 slot 核心**不允许第二个条目声明同一个子槽位**（会抛 `slot "..." is already declared`）。所以本插件的卡片不抢这个槽位，而是直接用会话授权的 `loadImage` 渲染 `<img>`，失败时显示重试按钮，没有 loader 时回退到 `/api/dsh-image25/images/...`。

## 已知限制

- 生图卡片位于 DSH 的「步骤流程」折叠行（`已完成，用时 …`）内，需要展开那一行才看得到卡片正文。
- `codex-subscription` 走的是本地已登录的订阅凭据，换机器需要重新登录。
- 不支持流式出图，一次请求一次性返回。

## 开发

```bash
# 语法检查
node --check lib/index.js
node --check lib/client.js

# 直接跑一次生成（需要先配置 Key）
curl -s http://127.0.0.1:<port>/api/dsh-image25/status
```

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

[MIT](LICENSE)
