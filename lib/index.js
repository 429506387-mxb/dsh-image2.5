/**
 * dsh-image25 — host half (self-contained, no package imports).
 *
 * Connects DeepSeek Harness to the **Image 2.5** image-generation model and
 * lets the user choose the generation quality.
 *
 *   - model tools `image_generate` (text → image) and `image_edit`
 *     (reference images → image); both send the chosen `quality`;
 *   - a web composer button and settings section (see `./client.js`) backed by
 *     the same-origin endpoints below;
 *   - the defaults live in the plugin's own cordis Config (volatile fields),
 *     so the settings section and the model both see one source of truth.
 *
 * Endpoints (same-origin JSON):
 *   GET  /api/dsh-image25/status        -> settings, key presence, catalog
 *   POST /api/dsh-image25/config        -> { provider?, baseUrl?, model?, quality?, size?, background?, apiKey? }
 *   POST /api/dsh-image25/generate      -> { prompt, quality?, size?, background?, referenceImages?[] }
 *   GET  /api/dsh-image25/images/:name  -> a PNG this plugin generated
 *
 * Upstream transport: an OpenAI-compatible Images API. Default base URL
 * `https://api.openai.com/v1`, default model `gpt-image-2.5-flare`. Both are
 * editable, so any gateway that serves an Image 2.5 model works.
 *
 * `provider: "codex-subscription"` routes the same request through the
 * in-process ChatGPT/Codex subscription plugin when it is installed and signed
 * in (best-effort; see codexTransport()).
 *
 * @module dsh-image25
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "dsh-image25";
/** Only the web routes are required; tools/settings/credentials are read lazily. */
export const inject = ["webServer", "tools"];

const BASE = "/api/dsh-image25";
const PLUGIN_VERSION = "0.1.0";

/** Image 2.5 identifiers this plugin drives. */
export const IMAGE_MODELS = Object.freeze(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
/** Quality levels of the Image 2.5 family, cheapest first; `auto` lets the model decide. */
export const QUALITIES = Object.freeze(["low", "medium", "high", "xhigh", "max", "auto"]);
/** Background modes of the Images API. */
export const BACKGROUNDS = Object.freeze(["auto", "transparent", "opaque"]);
/** Word → quality map, so `低/中/高/很高/最高` or `draft/standard/final` all work. */
const QUALITY_WORDS = Object.freeze({
	low: "low", draft: "low", 低: "low", 草稿: "low",
	medium: "medium", standard: "medium", 中: "medium", 标准: "medium",
	high: "high", final: "high", 高: "high", 终稿: "high",
	xhigh: "xhigh", "x-high": "xhigh", 很高: "xhigh", 超高: "xhigh",
	max: "max", 最高: "max", 极限: "max",
	auto: "auto", 自动: "auto",
});

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 300_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Plugin configuration; volatile fields are live-editable from the settings section. */
const CONFIG_FIELDS = {
	/** Upstream: `api` (API key + OpenAI-compatible endpoint) or `codex-subscription`. */
	provider: { type: "string", default: "api" },
	/** OpenAI-compatible base URL (the part before `/images/generations`). */
	baseUrl: { type: "string", default: "https://api.openai.com/v1" },
	/** Image 2.5 model id. */
	model: { type: "string", default: "gpt-image-2.5-flare" },
	/** Default quality used when a request names none. */
	quality: { type: "string", default: "high" },
	/** Default output size (`auto` or WIDTHxHEIGHT). */
	size: { type: "string", default: "auto" },
	/** Default background. */
	background: { type: "string", default: "auto" },
	/** Register the image tools for the model. */
	enableTools: { type: "boolean", default: true },
	/** Seconds a generated PNG may be cached by the browser. */
	imageCacheSeconds: { type: "number", default: 3600 },
};

/** cordis validates with a Standard Schema (`~standard`); the plain field list above stays for docs. */
export const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-image25",
		validate(value) {
			const base = { ...DEFAULTS };
			if (value && typeof value === "object") {
				for (const key of Object.keys(DEFAULTS)) {
					const raw = value[key];
					if (raw === void 0) continue;
					const fallback = DEFAULTS[key];
					base[key] = typeof fallback === "number" ? Number(raw) : typeof fallback === "boolean" ? raw === true || raw === "true" || raw === 1 || raw === "1" : String(raw);
				}
			}
			return { value: base };
		},
	},
};

const DEFAULTS = Object.freeze({ provider: "api", baseUrl: "https://api.openai.com/v1", model: "gpt-image-2.5-flare", quality: "high", size: "auto", background: "auto", enableTools: true, imageCacheSeconds: 3600 });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** DSH home: explicit `$DSH_HOME`, else `~/.dsh`. */
export function dshHome() {
	const env = process.env.DSH_HOME?.trim();
	return env !== undefined && env !== "" ? env.replace(/[\\/]+$/u, "") : join(homedir(), ".dsh");
}

/** Directory holding generated PNGs served under /images. */
export function imageDirectory() {
	return join(dshHome(), "state", "dsh-image25", "images");
}

/** Map a quality word (English, Chinese or tone words) to a level. */
export function normalizeQuality(value) {
	if (typeof value !== "string") return undefined;
	const word = value.trim().toLowerCase();
	return Object.hasOwn(QUALITY_WORDS, word) ? QUALITY_WORDS[word] : undefined;
}

/** Whether `WIDTHxHEIGHT` names a size the Image 2.5 family accepts. */
export function isSize(size) {
	const match = /^(\d+)[xX×](\d+)$/u.exec(size.trim());
	if (match === null) return false;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return false;
	return width >= 256 && height >= 256 && width <= 4096 && height <= 4096 && width % 16 === 0 && height % 16 === 0 && width * height >= 655360;
}

/** Read live configuration off the plugin fiber (falls back to `config`). */
function liveConfig(ctx, config) {
	const base = { ...DEFAULTS, ...(config && typeof config === "object" ? config : {}) };
	for (const get of [() => ctx.fiber?.runtime?.config, () => ctx.fiber?.config]) try {
		const runtime = get();
		if (runtime !== undefined && runtime !== null) return { ...base, ...runtime };
	} catch {}
	return base;
}

/** Normalize a stored settings object. */
export function sanitizeSettings(patch) {
	const out = {};
	if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return out;
	if (patch.provider === "api" || patch.provider === "codex-subscription") out.provider = patch.provider;
	if (IMAGE_MODELS.includes(patch.model)) out.model = patch.model;
	const quality = normalizeQuality(patch.quality);
	if (quality !== undefined) out.quality = quality;
	if (BACKGROUNDS.includes(patch.background)) out.background = patch.background;
	if (typeof patch.size === "string" && (patch.size === "auto" || isSize(patch.size))) out.size = patch.size;
	if (typeof patch.baseUrl === "string" && patch.baseUrl.trim() !== "" && patch.baseUrl.trim().length <= 300) out.baseUrl = patch.baseUrl.trim();
	if (typeof patch.enableTools === "boolean") out.enableTools = patch.enableTools;
	if (Number.isSafeInteger(patch.imageCacheSeconds) && patch.imageCacheSeconds >= 0 && patch.imageCacheSeconds <= 86400) out.imageCacheSeconds = patch.imageCacheSeconds;
	return out;
}

/** Settings as the web section and the model see them. */
function currentSettings(ctx, config) {
	return sanitizeSettings(liveConfig(ctx, config));
}

// ---------------------------------------------------------------------------
// API key
// ---------------------------------------------------------------------------

/** Resolve the API key: DSH credential store, then environment. */
export async function resolveApiKey(ctx) {
	try {
		const stored = await ctx.get?.("credentials")?.resolve?.("IMAGE25_API_KEY");
		if (typeof stored?.value === "string" && stored.value.trim() !== "") return stored.value.trim();
	} catch {}
	for (const key of ["IMAGE25_API_KEY", "OPENAI_API_KEY"]) {
		const value = process.env[key];
		if (typeof value === "string" && value.trim() !== "") return value.trim();
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// request normalization and the Images API
// ---------------------------------------------------------------------------

/** OpenAI-compatible base URL made absolute; a bare host gets https://. */
export function absoluteBaseUrl(value) {
	const raw = typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULTS.baseUrl;
	let url;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`);
	} catch {
		throw new Error(`接口地址不是有效 URL：${raw}`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`接口地址必须是 http(s) URL：${raw}`);
	return url.href.replace(/\/+$/u, "");
}

/** Normalize one generation request against the current settings. */
export function normalizeRequest(input, settings) {
	const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
	if (prompt === "") throw new Error("prompt 不能为空");
	if (prompt.length > 32000) throw new Error("prompt 不能超过 32000 字符");
	const quality = normalizeQuality(input?.quality) ?? settings.quality;
	const size = typeof input?.size === "string" && (input.size === "auto" || isSize(input.size)) ? input.size.trim() : settings.size;
	if (size !== "auto" && !isSize(size)) throw new Error(`size 必须是 "auto" 或 16 的倍数边长，例如 1024x1024（收到 ${size}）`);
	const background = BACKGROUNDS.includes(input?.background) ? input.background : settings.background;
	return { model: settings.model, quality, size, background, prompt };
}

/** Read PNG dimensions from the IHDR chunk. */
export function pngSize(bytes) {
	if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
	const width = bytes.readUInt32BE(16);
	const height = bytes.readUInt32BE(20);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

function decodePng(encoded) {
	const data = Buffer.from(encoded, "base64");
	if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Image 2.5 返回的数据不是 PNG");
	if (data.length > MAX_IMAGE_BYTES) throw new Error("Image 2.5 返回的图片超过 32 MB");
	return data;
}

/** A failed upstream response as a readable error. */
function upstreamError(status, text) {
	let detail = "";
	try {
		const parsed = JSON.parse(text);
		const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error;
		detail = typeof message === "string" ? message : typeof parsed?.error === "string" ? parsed.error : "";
	} catch {
		detail = "";
	}
	if (detail === "") detail = text.replace(/\s+/gu, " ").slice(0, 300).trim();
	const hints = status === 401 ? "API Key 无效或已过期" : status === 404 ? "接口地址或模型名可能不对" : status === 429 ? "请求过于频繁或额度不足" : undefined;
	return new Error(`Image 2.5 请求失败（HTTP ${status}${hints === undefined ? "" : `，${hints}`}）${detail === "" ? "" : `：${detail}`}`);
}

/** Combined timeout + caller cancellation. */
function requestSignals(signal) {
	return signal === undefined ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]);
}

/**
 * Call the OpenAI-compatible Images API once.
 * @returns {{ data: Buffer, quality: string, size: string, reportedModel?: string }}
 */
export async function callImagesApi(request, options) {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const base = absoluteBaseUrl(options.baseUrl ?? DEFAULTS.baseUrl);
	const images = Array.isArray(options.images) ? options.images.slice(0, 5) : [];
	const headers = { authorization: `Bearer ${options.apiKey}`, accept: "application/json" };
	let url;
	let body;
	if (images.length > 0) {
		url = `${base}/images/edits`;
		const form = new FormData();
		form.append("model", request.model);
		form.append("prompt", request.prompt);
		form.append("quality", request.quality);
		form.append("size", request.size);
		if (request.background !== "auto") form.append("background", request.background);
		for (const image of images) form.append("image[]", new Blob([image.bytes], { type: image.mediaType ?? "image/png" }), image.name ?? "reference.png");
		body = form;
	} else {
		url = `${base}/images/generations`;
		headers["content-type"] = "application/json";
		body = JSON.stringify({ model: request.model, prompt: request.prompt, quality: request.quality, size: request.size, background: request.background, n: 1 });
	}
	let response;
	try {
		response = await fetchImpl(url, { method: "POST", headers, body, signal: requestSignals(options.signal) });
	} catch (error) {
		if (options.signal?.aborted === true) throw options.signal.reason;
		throw new Error(`连接 Image 2.5 服务失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	if (!response.ok) throw upstreamError(response.status, await response.text().catch(() => ""));
	const payload = await response.json().catch(() => undefined);
	const first = Array.isArray(payload?.data) ? payload.data[0] : undefined;
	let data;
	if (typeof first?.b64_json === "string") data = decodePng(first.b64_json);
	else if (typeof first?.url === "string") {
		const fetched = await fetchImpl(first.url, { signal: requestSignals(options.signal) });
		if (!fetched.ok) throw new Error(`图片已生成但下载失败（HTTP ${fetched.status}）`);
		data = Buffer.from(await fetched.arrayBuffer());
		if (data.length > MAX_IMAGE_BYTES) throw new Error("Image 2.5 返回的图片超过 32 MB");
	} else throw new Error("Image 2.5 没有返回图片数据");
	const dimensions = pngSize(data);
	return {
		data,
		quality: typeof payload?.quality === "string" && payload.quality !== "" ? payload.quality : request.quality,
		size: dimensions === undefined ? request.size : `${dimensions.width}x${dimensions.height}`,
		...(typeof payload?.model === "string" && payload.model !== "" ? { reportedModel: payload.model } : {}),
	};
}

// ---------------------------------------------------------------------------
// optional ChatGPT/Codex subscription transport
// ---------------------------------------------------------------------------

const CODEX_GENERATION_URL = "https://chatgpt.com/backend-api/codex/images/generations";
const CODEX_EDIT_URL = "https://chatgpt.com/backend-api/codex/images/edits";
const SUPPORT_ID = /^[A-Za-z0-9._-]{1,80}$/u;

/** First DSH service the subscription plugin may expose, if any. */
function subscriptionService(ctx) {
	return ctx.get?.("codexSubscription") ?? ctx.get?.("codex-subscription");
}

/** Active OAuth credential via the subscription plugin's own store. */
async function subscriptionCredential(ctx) {
	const service = subscriptionService(ctx);
	if (service !== undefined && typeof service.credentials === "function") {
		try {
			const value = await service.credentials();
			const access = value?.access ?? value?.accessToken;
			const accountId = value?.accountId ?? value?.account_id;
			if (typeof access === "string" && typeof accountId === "string") return { access, accountId };
		} catch {}
	}
	try {
		const mod = await import("dsh-codex-subscription");
		if (typeof mod?.DshOAuthCredentialStore !== "function") return undefined;
		const store = new mod.DshOAuthCredentialStore(ctx.get?.("credentials"), "OPENAI_CODEX_SUBSCRIPTION_OAUTH", ["WSL043_OPENAI_CODEX_OAUTH"]);
		const credential = await store.read("openai-codex");
		if (credential?.type === "oauth" && typeof credential.access === "string" && typeof credential.accountId === "string") return { access: credential.access, accountId: credential.accountId };
	} catch {}
	return undefined;
}

/** `~/.codex/auth.json` written by the Codex CLI, as a last resort. */
function codexCliCredential() {
	const root = process.env.CODEX_HOME?.trim() !== undefined && process.env.CODEX_HOME.trim() !== "" ? process.env.CODEX_HOME.trim() : join(homedir(), ".codex");
	const file = join(root, "auth.json");
	if (!existsSync(file)) return undefined;
	try {
		const value = JSON.parse(readFileSync(file, "utf8"));
		const access = value?.tokens?.access_token;
		const accountId = value?.account_id ?? value?.tokens?.account_id;
		return typeof access === "string" && typeof accountId === "string" ? { access, accountId } : undefined;
	} catch {
		return undefined;
	}
}

/** Whether a ChatGPT/Codex sign-in is available for the subscription transport. */
export async function subscriptionAvailable(ctx) {
	return (await subscriptionCredential(ctx)) !== undefined || codexCliCredential() !== undefined;
}

/** Generate through the subscription (service hook first, then its HTTP endpoint). */
export async function callSubscription(ctx, request, options = {}) {
	const service = subscriptionService(ctx);
	if (service !== undefined && typeof service.generateImage === "function") {
		const value = await service.generateImage({ prompt: request.prompt, quality: request.quality, size: request.size, background: request.background, model: request.model, ...(options.images === undefined ? {} : { images: options.images }), ...(options.signal === undefined ? {} : { signal: options.signal }) });
		const data = value instanceof Uint8Array ? Buffer.from(value) : value?.data instanceof Uint8Array ? Buffer.from(value.data) : undefined;
		if (data === undefined) throw new Error("订阅服务没有返回图片数据");
		return { data, quality: typeof value?.quality === "string" ? value.quality : request.quality, size: typeof value?.size === "string" ? value.size : request.size };
	}
	const credential = (await subscriptionCredential(ctx)) ?? codexCliCredential();
	if (credential === undefined) throw new Error("未检测到 ChatGPT/Codex 订阅登录：请在“Codex 订阅”设置中登录，或在“Image 2.5”设置里改用 API Key");
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const editing = Array.isArray(options.images) && options.images.length > 0;
	const headers = { authorization: `Bearer ${credential.access}`, "chatgpt-account-id": credential.accountId, accept: "application/json", originator: "pi", "user-agent": `dsh-image25/${PLUGIN_VERSION}` };
	let body;
	if (editing) {
		const form = new FormData();
		form.append("prompt", request.prompt);
		form.append("model", request.model);
		form.append("quality", request.quality);
		form.append("size", request.size);
		if (request.background !== "auto") form.append("background", request.background);
		for (const image of options.images) form.append("image[]", new Blob([image.bytes], { type: image.mediaType ?? "image/png" }), image.name ?? "reference.png");
		body = form;
	} else {
		headers["content-type"] = "application/json";
		body = JSON.stringify({ prompt: request.prompt, model: request.model, quality: request.quality, size: request.size, background: request.background });
	}
	let response;
	try {
		response = await fetchImpl(editing ? CODEX_EDIT_URL : CODEX_GENERATION_URL, { method: "POST", headers, body, signal: requestSignals(options.signal) });
	} catch (error) {
		if (options.signal?.aborted === true) throw options.signal.reason;
		throw new Error(`连接订阅生图服务失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	if (!response.ok) {
		const requestId = response.headers?.get?.("x-codex-imagegen-request-id");
		const suffix = typeof requestId === "string" && SUPPORT_ID.test(requestId) ? `（请求号 ${requestId}）` : "";
		const reason = response.status === 401 ? "订阅登录已失效，请重新登录" : response.status === 403 ? "该账号或工作区可能不含此能力" : response.status === 429 ? "订阅生图配额暂时用尽" : "未知错误";
		throw new Error(`订阅生图失败（HTTP ${response.status}，${reason}）${suffix}`);
	}
	const payload = await response.json().catch(() => undefined);
	const first = Array.isArray(payload?.data) ? payload.data[0] : undefined;
	if (typeof first?.b64_json !== "string") throw new Error("订阅生图没有返回图片数据");
	return {
		data: decodePng(first.b64_json),
		quality: typeof payload?.quality === "string" ? payload.quality : request.quality,
		size: typeof payload?.size === "string" ? payload.size : request.size,
	};
}

// ---------------------------------------------------------------------------
// generate + save
// ---------------------------------------------------------------------------

/** Write one PNG into the image directory; returns path, URL and byte size. */
export async function saveImage(data) {
	const dir = imageDirectory();
	await mkdir(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
	const fileName = `image25-${stamp}-${randomUUID().slice(0, 8)}.png`;
	const filePath = join(dir, fileName);
	const handle = await open(filePath, "wx");
	try {
		await handle.writeFile(data);
	} finally {
		await handle.close();
	}
	return { file: fileName, path: filePath, url: `${BASE}/images/${encodeURIComponent(fileName)}`, bytes: data.length };
}

/**
 * Generate (or edit) one image with the current settings.
 * @param {any} ctx plugin context.
 * @param {any} config live plugin config.
 * @param {{ prompt: string, quality?: string, size?: string, background?: string, referenceImages?: any[], signal?: AbortSignal }} input
 * @param {{ fetch?: typeof fetch }} [transport]
 */
export async function generateImage(ctx, config, input, transport = {}) {
	const settings = currentSettings(ctx, config);
	const request = normalizeRequest(input, settings);
	const images = Array.isArray(input?.referenceImages) && input.referenceImages.length > 0 ? input.referenceImages.slice(0, 5) : undefined;
	const result = settings.provider === "codex-subscription" ?
		await callSubscription(ctx, request, { images, signal: input?.signal, fetch: transport.fetch }) :
		await (async () => {
			const apiKey = await resolveApiKey(ctx);
			if (apiKey === undefined) throw new Error("还没有配置 Image 2.5 API Key：请在“设置 → Image 2.5 生图”中填入，或设置环境变量 IMAGE25_API_KEY / OPENAI_API_KEY");
			return callImagesApi(request, { apiKey, baseUrl: settings.baseUrl, images, signal: input?.signal, fetch: transport.fetch });
		})();
	const saved = await saveImage(result.data);
	return { ...result, ...saved, model: request.model, background: request.background };
}

// ---------------------------------------------------------------------------
// model tools
// ---------------------------------------------------------------------------

const TOOL_DESCRIPTION = [
	"Generate or edit an image with the Image 2.5 model (gpt-image-2.5 family) when the user asks for image output.",
	"Choose `quality` deliberately: 低/low = fast draft, 中/medium and 高/high = balanced, 很高/xhigh and 最高/max = slowest and most detailed; `auto` lets the model decide.",
	"Omit `quality` to use the user's default from the Image 2.5 settings section.",
	"The result is saved on the DSH host and shown to the user directly.",
].join(" ");

const QUALITY_PARAM = {
	type: "string",
	description: "Rendering quality: low | medium | high | xhigh | max | auto (also accepts 低/中/高/很高/最高). Omit for the user's default.",
};

const OUTPUT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		path: { type: "string", description: "Absolute path of the PNG on the DSH host." },
		url: { type: "string", description: "Same-origin URL serving the PNG to the web UI." },
		size: { type: "string" },
		quality: { type: "string" },
		model: { type: "string" },
		bytes: { type: "integer" },
		image: {
			type: "object",
			description: "Attachment reference for inline preview; present when the DSH attachment store is available.",
			additionalProperties: false,
			properties: {
				attachmentId: { type: "string" },
				mediaType: { type: "string" },
				bytes: { type: "integer" },
				width: { type: "integer" },
				height: { type: "integer" },
			},
		},
	},
};

/**
 * Store the generated PNG in the DSH attachment store so the conversation can
 * render it inline. Without this the tool could only return text and the web UI
 * had nothing to preview.
 * @param {any} ctx plugin context.
 * @param {Uint8Array|Buffer} data PNG bytes.
 * @param {string} name file name recorded in the attachment store.
 */
async function attachImage(ctx, data, name) {
	const attachments = ctx.get?.("attachments");
	if (typeof attachments?.saveImage !== "function") return undefined;
	try {
		const ref = await attachments.saveImage({ data: new Uint8Array(data), mediaType: "image/png", name });
		return {
			attachmentId: ref.attachmentId,
			mediaType: ref.mediaType ?? "image/png",
			bytes: ref.bytes ?? data.length,
			width: ref.width,
			height: ref.height,
		};
	} catch {
		return undefined;
	}
}

function toolDefinition(ctx, config, editing) {
	return {
		name: editing ? "image_edit" : "image_generate",
		description: editing ? `${TOOL_DESCRIPTION} This variant edits reference images: pass each reference as an absolute local file path in \`referenceImages\`.` : TOOL_DESCRIPTION,
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				prompt: { type: "string", description: "Complete description of the image to generate, or of the change to make." },
				quality: QUALITY_PARAM,
				size: { type: "string", description: 'Output size: "auto" (default) or WIDTHxHEIGHT with 16-multiple sides, e.g. "1024x1536".' },
				background: { type: "string", description: 'Background: "auto" | "transparent" | "opaque". Request transparent only when the user needs transparency.' },
				...(editing ? { referenceImages: { type: "array", description: "Absolute paths of 1-5 local PNG/JPEG/WebP files used as references.", items: { type: "string" } } } : {}),
			},
			required: editing ? ["prompt", "referenceImages"] : ["prompt"],
		},
		output: {
			schema: OUTPUT_SCHEMA,
			render(_args, value) {
				const blocks = [
					{ type: "text", text: `Image 2.5 generated a ${value.size} image (quality: ${value.quality}, model: ${value.model}).\nPNG saved on the DSH host at ${JSON.stringify(value.path)}; the image is already shown to the user, so do not embed it again — copy the file if it is needed in the workspace.` },
				];
				if (value.image !== undefined) blocks.push({ type: "image", attachment: value.image });
				blocks.push({ type: "text", text: `Served to the web UI at ${value.url}` });
				return blocks;
			},
		},
		timeoutMs: REQUEST_TIMEOUT_MS + 15_000,
		isConcurrencySafe: () => false,
		async execute(args, exec) {
			let referenceImages;
			if (editing) {
				const paths = Array.isArray(args?.referenceImages) ? args.referenceImages.filter((item) => typeof item === "string" && item.trim() !== "") : [];
				if (paths.length === 0) throw new Error("referenceImages 至少要给出一个本地图片路径");
				referenceImages = await Promise.all(paths.slice(0, 5).map(async (path) => {
					const bytes = await readFile(path);
					const lower = path.toLowerCase();
					const mediaType = lower.endsWith(".jpg") || lower.endsWith(".jpeg") ? "image/jpeg" : lower.endsWith(".webp") ? "image/webp" : "image/png";
					return { bytes, mediaType, name: path.split(/[\\/]/u).pop() ?? "reference.png" };
				}));
			}
			const result = await generateImage(ctx, liveConfig(ctx, config), { prompt: args?.prompt, quality: args?.quality, size: args?.size, background: args?.background, referenceImages, signal: exec?.signal });
			const image = await attachImage(ctx, result.data, editing ? "image25-edited.png" : "image25-generated.png");
			return { path: result.path, url: result.url, size: result.size, quality: result.quality, model: result.model, bytes: result.bytes, ...image === undefined ? {} : { image } };
		},
	};
}

/** Register the image tools; returns a disposer. */
export function registerTools(ctx, config) {
	const disposers = [];
	for (const editing of [false, true]) {
		const tool = toolDefinition(ctx, config, editing);
		try {
			disposers.push(ctx.tools.register(tool));
		} catch (error) {
			if (!String(error).includes("already registered")) throw error;
			ctx.logger?.warn?.("dsh-image25: tool %s is already registered; leaving it alone", tool.name);
		}
	}
	return () => {
		for (const dispose of disposers) try {
			dispose?.();
		} catch {}
	};
}

// ---------------------------------------------------------------------------
// HTTP surface
// ---------------------------------------------------------------------------

function json(res, status, value) {
	if (res.headersSent) {
		res.end();
		return;
	}
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}

/**
 * Same-origin guard for state-changing endpoints.
 *
 * The desktop shell serves the renderer from the `dsh-app://` custom scheme, so
 * its fetches either carry no `Origin` (same-scheme request) or a non-HTTP
 * origin whose host never equals the API host. A loopback `http(s)` origin is
 * also accepted because the shell may proxy through a local port. Browser
 * cross-site posts from a remote page are still rejected. The `/api`
 * browser-trust fence remains the real authentication boundary for every
 * request that reaches this route.
 */
function crossOriginReason(req) {
	const origin = req.headers.origin;
	if (typeof origin !== "string" || origin === "" || origin === "null") return undefined;
	try {
		const { protocol, host, hostname } = new URL(origin);
		if (protocol !== "http:" && protocol !== "https:") return undefined;
		if (host === req.headers.host) return undefined;
		if (hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || hostname === "localhost") return undefined;
		return `forbidden: cross-origin request (origin=${origin}, host=${String(req.headers.host)})`;
	} catch {
		return `forbidden: malformed origin ${origin}`;
	}
}

async function readJsonBody(req, limit) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of req) {
		bytes += chunk.length;
		if (bytes > limit) throw new Error("请求体过大");
		chunks.push(chunk);
	}
	if (bytes === 0) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new Error("请求体不是 JSON");
	}
}

async function serveImage(req, res, fileName, cacheSeconds) {
	if (!/^image25-[A-Za-z0-9._-]+\.png$/u.test(fileName)) {
		json(res, 404, { ok: false, error: "not found" });
		return;
	}
	let bytes;
	try {
		bytes = await readFile(join(imageDirectory(), fileName));
	} catch {
		json(res, 404, { ok: false, error: "not found" });
		return;
	}
	res.writeHead(200, { "content-type": "image/png", "content-length": String(bytes.length), "cache-control": cacheSeconds > 0 ? `private, max-age=${cacheSeconds}` : "no-store" });
	res.end(bytes);
}

/** Persist a settings patch into the plugin's own volatile Config fields. */
async function persistSettings(ctx, patch) {
	const clean = sanitizeSettings(patch);
	const apiKey = typeof patch?.apiKey === "string" && patch.apiKey.trim() !== "" ? patch.apiKey.trim() : undefined;
	const rows = ctx.get?.("configEditor")?.entries?.() ?? [];
	const entry = rows.find((row) => row.options?.id === "image25") ?? rows.find((row) => typeof row.options?.name === "string" && row.options.name.startsWith("dsh-image25"));
	if (entry === undefined) throw new Error("找不到 dsh-image25 插件配置项，无法保存设置");
	await ctx.get("configEditor").edit(entry, (current) => ({ ...(current && typeof current === "object" ? current : {}), ...clean }));
	if (apiKey !== undefined) {
		const credentials = ctx.get?.("credentials");
		if (credentials === undefined) throw new Error("DSH 凭据服务不可用，无法保存 API Key");
		await credentials.set("IMAGE25_API_KEY", apiKey);
	}
	return currentSettings(ctx, liveConfig(ctx, {}));
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------

/**
 * Plugin entry point.
 * @param {any} ctx cordis context.
 * @param {any} config validated plugin configuration.
 */
export function apply(ctx, config = {}) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: BASE,
		handler: async (req, res) => {
			const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
			let sub = pathname.slice(BASE.length);
			try {
				sub = decodeURIComponent(sub);
			} catch {
				json(res, 400, { ok: false, error: "bad path" });
				return;
			}
			if (sub.length > 1 && sub.endsWith("/")) sub = sub.replace(/\/+$/u, "");
			if (sub === "") sub = "/";
			try {
				const imageMatch = /^\/images\/([^/]+)$/u.exec(sub);
				if (imageMatch !== null) {
					if (req.method !== "GET" && req.method !== "HEAD") {
						json(res, 405, { ok: false, error: "method not allowed" });
						return;
					}
					await serveImage(req, res, imageMatch[1], currentSettings(ctx, config).imageCacheSeconds);
					return;
				}
				if (req.method !== "GET" && req.method !== "POST") {
					json(res, 405, { ok: false, error: "method not allowed" });
					return;
				}
				if (req.method === "POST") {
					const verdict = crossOriginReason(req);
					if (verdict !== undefined) {
						json(res, 403, { ok: false, error: verdict });
						return;
					}
				}
				if (sub === "/status" && req.method === "GET") {
					const settings = currentSettings(ctx, config);
					json(res, 200, {
						ok: true,
						version: PLUGIN_VERSION,
						settings,
						hasApiKey: (await resolveApiKey(ctx)) !== undefined,
						signedIn: settings.provider === "codex-subscription" ? (await subscriptionAvailable(ctx)) === true : false,
						qualities: QUALITIES,
						models: IMAGE_MODELS,
						backgrounds: BACKGROUNDS,
					});
					return;
				}
				if (sub === "/health" && req.method === "GET") {
					json(res, 200, { ok: true, version: PLUGIN_VERSION });
					return;
				}
				if (sub === "/config" && req.method === "POST") {
					const body = await readJsonBody(req, 64 * 1024);
					const settings = await persistSettings(ctx, body);
					json(res, 200, { ok: true, settings, hasApiKey: (await resolveApiKey(ctx)) !== undefined });
					return;
				}
				if (sub === "/generate" && req.method === "POST") {
					const body = await readJsonBody(req, 64 * 1024 * 1024);
					const references = Array.isArray(body?.referenceImages) ? body.referenceImages.flatMap((item) => {
						if (typeof item?.base64 !== "string" || item.base64.length > 48 * 1024 * 1024) return [];
						return [{ bytes: Buffer.from(item.base64, "base64"), mediaType: typeof item.mediaType === "string" ? item.mediaType : "image/png", name: typeof item.name === "string" ? item.name : "reference.png" }];
					}) : undefined;
					const result = await generateImage(ctx, liveConfig(ctx, config), { prompt: body?.prompt, quality: body?.quality, size: body?.size, background: body?.background, referenceImages: references });
					json(res, 200, { ok: true, url: result.url, path: result.path, size: result.size, quality: result.quality, model: result.model, bytes: result.bytes });
					return;
				}
				json(res, 404, { ok: false, error: `no dsh-image25 endpoint ${sub}` });
			} catch (error) {
				ctx.logger?.warn?.("dsh-image25 request %s failed: %s", sub, error instanceof Error ? error.message : String(error));
				json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
			}
		},
	}), "dsh-image25: http routes");

	ctx.effect(() => {
		if (ctx.get?.("tools") === undefined) return () => {};
		if (liveConfig(ctx, config).enableTools === false) return () => {};
		return registerTools(ctx, config);
	}, "dsh-image25: image tools");

	ctx.logger?.info?.("dsh-image25 %s: Image 2.5 ready (qualities: %s)", PLUGIN_VERSION, QUALITIES.join(" / "));
}
