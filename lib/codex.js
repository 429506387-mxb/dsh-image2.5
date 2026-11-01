/**
 * Optional Codex-subscription transport for dsh-image25.
 *
 * When the DSH profile also runs `dsh-codex-subscription` and the user is
 * signed in to the ChatGPT/Codex subscription, Image 2.5 requests can ride on
 * that subscription instead of an API key. Everything here is best-effort and
 * fails with a clear message when the subscription plugin is absent or not
 * signed in.
 *
 * Two paths are tried, newest first:
 *   1. a host service the subscription plugin may expose for image tools
 *      (`ctx.get("codexSubscription")`: `generateImage({ prompt, quality, ... })`);
 *   2. the plugin's authenticated HTTP endpoint, called in-process with the
 *      active account's token (Bearer from the credential store the plugin
 *      owns), which is how its own `codex_image_generate` tool works.
 *
 * @module dsh-image25/codex
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GENERATION_URL = "https://chatgpt.com/backend-api/codex/images/generations";
const EDIT_URL = "https://chatgpt.com/backend-api/codex/images/edits";
const SUPPORT_ID = /^[A-Za-z0-9._-]{1,80}$/u;

/** The plugin module the credential helpers are read from. */
function loadSubscriptionModule() {
	return import("dsh-codex-subscription");
}

/** Active OAuth credential, via the subscription plugin's own reader. */
async function credentialsFromPlugin(ctx) {
	const mod = await loadSubscriptionModule();
	const credentials = ctx.get?.("credentials");
	const store = new mod.DshOAuthCredentialStore(credentials, "OPENAI_CODEX_SUBSCRIPTION_OAUTH", ["WSL043_OPENAI_CODEX_OAUTH"]);
	const credential = await store.read("openai-codex");
	return normalizeCredential(credential);
}

/** `~/.codex/auth.json` written by the Codex CLI, as a fallback sign-in. */
function credentialsFromCodexCli() {
	const env = process.env.CODEX_HOME?.trim();
	const root = env !== undefined && env !== "" ? env : join(homedir(), ".codex");
	const file = join(root, "auth.json");
	if (!existsSync(file)) return undefined;
	try {
		const value = JSON.parse(readFileSync(file, "utf8"));
		const tokens = value?.tokens;
		if (typeof tokens?.access_token !== "string") return undefined;
		const accountId = value.account_id ?? tokens.account_id;
		return normalizeCredential({ access: tokens.access_token, accountId });
	} catch {
		return undefined;
	}
}

function normalizeCredential(credential) {
	if (credential === undefined || credential === null) return undefined;
	if (credential.type !== undefined && credential.type !== "oauth") return undefined;
	const access = credential.access ?? credential.accessToken;
	const accountId = credential.accountId ?? credential.account_id ?? credential.accountID;
	return typeof access === "string" && access.length > 0 && typeof accountId === "string" && accountId.length > 0 ? { access, accountId } : undefined;
}

/**
 * The active ChatGPT/Codex sign-in, or undefined.
 * @param {any} ctx - cordis context.
 */
export async function readCodexCredentials(ctx) {
	const service = ctx.get?.("codexSubscription") ?? ctx.get?.("codex-subscription");
	if (service !== undefined && service !== null) {
		try {
			const credential = normalizeCredential(await service.credentials?.());
			if (credential !== undefined) return credential;
		} catch {}
	}
	try {
		const credential = await credentialsFromPlugin(ctx);
		if (credential !== undefined) return credential;
	} catch {}
	return credentialsFromCodexCli();
}

/** Whether a subscription sign-in is available. */
export function codexSignedIn(ctx) {
	return Boolean(ctx.get?.("codexSubscription") ?? ctx.get?.("codex-subscription"));
}

/** Turn a failed upstream response into a readable error. */
async function failure(response, editing) {
	let detail = "";
	try {
		const body = await response.text();
		const parsed = JSON.parse(body);
		const message = parsed?.error?.message ?? parsed?.detail ?? parsed?.error;
		if (typeof message === "string") detail = message.slice(0, 200);
		else detail = body.slice(0, 200);
	} catch {}
	const requestId = response.headers?.get?.("x-codex-imagegen-request-id");
	const suffix = typeof requestId === "string" && SUPPORT_ID.test(requestId) ? ` (request ${requestId})` : "";
	if (response.status === 403) return new Error(`ChatGPT 订阅拒绝了 Image 2.5${editing ? "编辑" : "生图"}请求（HTTP 403${detail === "" ? "" : `：${detail}`}）：该账号或工作区可能不含此能力${suffix}`);
	if (response.status === 429) return new Error(`ChatGPT 订阅的图片配额暂时用尽（HTTP 429）${suffix}`);
	if (response.status === 401) return new Error(`ChatGPT 订阅登录已失效（HTTP 401），请在“Codex 订阅”设置中重新登录${suffix}`);
	return new Error(`Image 2.5${editing ? "编辑" : "生图"}请求失败（HTTP ${response.status}）${detail === "" ? "" : `：${detail}`}${suffix}`);
}

function decodePayload(payload) {
	const first = Array.isArray(payload?.data) ? payload.data[0] : undefined;
	if (typeof first?.b64_json !== "string") throw new Error("Image 2.5 returned no image data");
	const data = Buffer.from(first.b64_json, "base64");
	if (data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50) throw new Error("Image 2.5 returned an invalid PNG");
	return data;
}

/**
 * Generate through the subscription.
 * @param {any} ctx - cordis context.
 * @param {ReturnType<typeof import("./index.js").normalizeRequest>} request
 * @param {{ images?: Array<{ bytes: Buffer, mediaType?: string, name?: string }>, signal?: AbortSignal, fetchImpl?: typeof fetch }} options
 */
export async function generateViaCodex(ctx, request, options = {}) {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const service = ctx.get?.("codexSubscription") ?? ctx.get?.("codex-subscription");
	if (service !== undefined && typeof service.generateImage === "function") {
		const value = await service.generateImage({
			prompt: request.prompt,
			quality: request.quality,
			size: request.size,
			background: request.background,
			model: request.model,
			...(options.images === undefined ? {} : { images: options.images }),
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		const data = value instanceof Uint8Array ? Buffer.from(value) : Buffer.isBuffer(value) ? value : decodePayload(value);
		return { data, quality: typeof value?.quality === "string" ? value.quality : request.quality, size: typeof value?.size === "string" ? value.size : request.size };
	}
	const credential = await readCodexCredentials(ctx);
	if (credential === undefined) throw new Error("未检测到 ChatGPT/Codex 订阅登录：请先在“Codex 订阅”设置中登录，或在 Image 2.5 设置里改用 API Key 方式");
	const editing = Array.isArray(options.images) && options.images.length > 0;
	const headers = {
		authorization: `Bearer ${credential.access}`,
		"chatgpt-account-id": credential.accountId,
		accept: "application/json",
		originator: "pi",
		"user-agent": "dsh-image25/0.1.0",
	};
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
	const signals = [AbortSignal.timeout(300_000)];
	if (options.signal !== undefined) signals.push(options.signal);
	let response;
	try {
		response = await fetchImpl(editing ? EDIT_URL : GENERATION_URL, { method: "POST", headers, body, signal: AbortSignal.any(signals) });
	} catch (error) {
		if (options.signal?.aborted === true) throw options.signal.reason;
		throw new Error(`Image 2.5 订阅请求失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	if (!response.ok) throw await failure(response, editing);
	const payload = await response.json();
	const data = decodePayload(payload);
	return {
		data,
		quality: typeof payload?.quality === "string" ? payload.quality : request.quality,
		size: typeof payload?.size === "string" ? payload.size : request.size,
	};
}
