# dsh-image25

An [Image 2.5](https://platform.openai.com/docs) (`gpt-image-2.5`) image-generation plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Once installed:

- the model gains two tools — `image_generate` (text → image) and `image_edit` (reference image → image);
- the Web settings gain an **“Image 2.5 generation”** page with a six-step quality selector
  (low / medium / high / xhigh / max / auto);
- generated PNGs are written into the DSH state directory and returned to the conversation as an
  inline image block.

![sample output](docs/preview.jpg)

## Features

| | |
| --- | --- |
| Quality steps | `low / medium / high / xhigh / max / auto` (Chinese equivalents accepted) |
| Transports | `api` (OpenAI-compatible Images API with a key) or `codex-subscription` (reuse a signed-in ChatGPT/Codex subscription, no key) |
| Edits | up to 5 local reference images (PNG / JPEG / WebP, absolute paths) |
| Size / background | `auto` or multiples of 16 (`1024x1024`, `1536x1024`, `1152x1536`, …); background `auto / transparent / opaque` |
| Inline result | the tool result carries an `image` block; the picture also lands on disk |
| i18n | settings page follows the current DSH locale (zh / en) |

## Install

The plugin is a local `file:` dependency and targets DSH 0.2.x (`@deepseek-ai/cordis` 4.x).

1. Clone this repository somewhere, e.g. `D:\plugins\dsh-image25`.
2. Add the dependency and the bundle row to your profile manifest
   (`%USERPROFILE%\.dsh\profiles\desktop\package.json` on Windows):

   ```jsonc
   {
     "dependencies": { "dsh-image25": "file:D:/plugins/dsh-image25" },
     "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-image25"] } }
   }
   ```

3. `pnpm install`, then restart DSH (power button → restart; do **not** pick “disable third-party plugins”).

Changes under `lib/` are picked up on the next restart — the client bundle is assembled at boot.

## Configure

Open **Settings → Image 2.5 generation**:

| Field | Value | Notes |
| --- | --- | --- |
| Quality | low / medium / high / xhigh / max / auto | default used when a tool call omits `quality` |
| Model | `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` | |
| Transport | `api` / `codex-subscription` | |
| Endpoint | `https://api.openai.com/v1` by default | any OpenAI-compatible gateway works |
| API key | stored in the DSH credential store as `IMAGE25_API_KEY` | env `IMAGE25_API_KEY` / `OPENAI_API_KEY` also accepted |
| Size / background | `auto` or `WxH` / `auto`·`transparent`·`opaque` | |

## Tools

```text
image_generate(prompt, quality?, size?, background?)
image_edit(prompt, referenceImages[], quality?, size?, background?)
```

`referenceImages` must be absolute local paths (1–5). Output PNGs live in
`$DSH_HOME/state/dsh-image25/images/` and are served at `/api/dsh-image25/images/<name>`.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/dsh-image25/status` | current settings, whether a key exists, quality list |
| `POST` | `/api/dsh-image25/config` | save settings (same-origin checked; `dsh-app://` and loopback allowed, remote cross-site 403) |
| `POST` | `/api/dsh-image25/generate` | `{ prompt, quality?, size?, background?, referenceImages? }` |
| `GET` | `/api/dsh-image25/images/<name>` | generated image |

## How it is built

- **Host half** (`lib/index.js`): `inject: ["webServer", "tools"]`. The config is declared with a
  Standard Schema validator — Cordis calls `Config["~standard"].validate`, and a plain object makes the
  whole row fail to mount. Registers the two tools, the settings endpoints and the image route.
- **Client half** (`lib/client.js`): `inject: ["slots", "locale"]`. Registers the settings section into
  `settings.section` and one tool view per wire tool name into `tool.call.toolview`.
- **Images**: the built-in `read_image` view already declares the `tool.call.images` child slot, and the
  slot core rejects a second declarer (`slot "…" is already declared`). This plugin therefore renders the
  image itself through the session-authorized `loadImage` (with a retry control and a fallback to the
  `/api/dsh-image25/images/…` URL) instead of claiming that slot.

## Known limitations

- The tool card sits inside DSH's collapsible step-process row (`已完成，用时 …`); expand that row to see it.
- `codex-subscription` reuses local signed-in credentials, so a new machine needs a new sign-in.
- No streaming: one request, one final image.

## License

[MIT](LICENSE)
