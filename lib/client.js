window.__ModuleLoader__.load({
	id: "dsh-image25",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// Every module the factory requires must also be declared by this package's
		// dsh.client.inject. "react" is optional there, so require it softly.
		const react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client.ts
		/**
		* dsh-image25 — web client half.
		*
		* Registers one settings page ("Image 2.5 生图") where the user picks the
		* generation quality (低 / 中 / 高 / 很高 / 最高 / 自动), the model, the
		* transport (API key or ChatGPT/Codex subscription), the endpoint, the API
		* key, and the default size / background. Values are read from and written
		* to this plugin's host endpoints, so the page always shows the live
		* settings the model tools use.
		*/
		const NS = "dsh-image25";
		const BASE = "/api/dsh-image25";
		const zh = {
			nav: "Image 2.5 生图",
			title: "Image 2.5 生图",
			subtitle: "连接 Image 2.5 生图模型，并选择每次生成的质量。模型工具 image_generate / image_edit 会使用这里的设置。",
			quality: "生成质量",
			qualityHint: "低=最快草稿，中/高=均衡，很高/最高=最精细也最慢，自动=由模型决定。",
			model: "模型",
			provider: "接入方式",
			providerApi: "API Key（OpenAI 兼容接口）",
			providerSubscription: "ChatGPT/Codex 订阅（已登录时）",
			baseUrl: "接口地址",
			apiKey: "API Key",
			apiKeyPlaceholder: "粘贴 Image 2.5 的 API Key",
			apiKeySaved: "已保存，留空则不改动",
			apiKeyMissing: "尚未配置",
			size: "默认尺寸",
			background: "默认背景",
			sizeHint: "可选 auto，或 16 的倍数，如 1024x1024 / 1536x1024。",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			failed: "保存失败",
			loading: "读取设置…",
			loadFailed: "读取设置失败",
			ready: "已就绪",
			noKey: "缺少 API Key",
			auto: "自动",
			transparent: "透明",
			opaque: "不透明",
			imageAlt: "Image 2.5 生成图",
			imageLoading: "图片加载中…",
			imageRetry: "图片加载失败，点击重试",
			imageWorking: "Image 2.5 生成中…"
		};
		const en = {
			nav: "Image 2.5 generation",
			title: "Image 2.5 generation",
			subtitle: "Connect the Image 2.5 model and choose the quality used for every generation. The image_generate / image_edit tools follow these settings.",
			quality: "Generation quality",
			qualityHint: "low = fastest draft, medium/high = balanced, xhigh/max = most detailed and slowest, auto = the model decides.",
			model: "Model",
			provider: "Transport",
			providerApi: "API key (OpenAI-compatible endpoint)",
			providerSubscription: "ChatGPT/Codex subscription (when signed in)",
			baseUrl: "Endpoint",
			apiKey: "API key",
			apiKeyPlaceholder: "Paste your Image 2.5 API key",
			apiKeySaved: "Saved — leave empty to keep it",
			apiKeyMissing: "Not configured",
			size: "Default size",
			background: "Default background",
			sizeHint: "auto, or multiples of 16 such as 1024x1024 / 1536x1024.",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			failed: "Save failed",
			loading: "Loading settings…",
			loadFailed: "Could not load settings",
			ready: "Ready",
			noKey: "API key missing",
			auto: "Auto",
			transparent: "Transparent",
			opaque: "Opaque",
			imageAlt: "Image 2.5 output",
			imageLoading: "Loading image…",
			imageRetry: "Image failed to load — click to retry",
			imageWorking: "Image 2.5 is generating…"
		};
		const QUALITIES = [
			{ value: "low", label: "低", labelEn: "Low" },
			{ value: "medium", label: "中", labelEn: "Medium" },
			{ value: "high", label: "高", labelEn: "High" },
			{ value: "xhigh", label: "很高", labelEn: "Very high" },
			{ value: "max", label: "最高", labelEn: "Max" },
			{ value: "auto", label: "自动", labelEn: "Auto" }
		];
		const MODELS = ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
		const SIZES = [
			{ value: "auto", label: "" },
			{ value: "1024x1024", label: "1024 × 1024" },
			{ value: "1536x1024", label: "1536 × 1024" },
			{ value: "1024x1536", label: "1024 × 1536" }
		];
		const BACKGROUNDS = [
			{ value: "auto", key: "auto" },
			{ value: "transparent", key: "transparent" },
			{ value: "opaque", key: "opaque" }
		];
		async function request(path, init) {
			const response = await fetch(BASE + path, {
				credentials: "same-origin",
				cache: "no-store",
				...init,
				headers: {
					"content-type": "application/json",
					...(init?.headers ?? {})
				}
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body?.ok === false) throw new Error(body?.error ?? "HTTP " + String(response.status));
			return body;
		}
		function Field(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "image25Row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "image25RowLabel",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "image25Label", children: props.label }), props.hint ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "image25Hint", children: props.hint }) : null]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "image25RowControl", children: props.children })]
			});
		}
		function Image25Settings({ t }) {
			const [state, setState] = react.useState({
				phase: "loading",
				data: null,
				error: null
			});
			const [draft, setDraft] = react.useState(null);
			const [save, setSave] = react.useState({ phase: "idle", message: "" });
			react.useEffect(() => {
				let live = true;
				request("/status").then((data) => {
					if (!live) return;
					setState({
						phase: "ready",
						data,
						error: null
					});
					setDraft({
						...data.settings,
						apiKey: ""
					});
				}).catch((error) => {
					if (live) setState({
						phase: "error",
						data: null,
						error: String(error?.message ?? error)
					});
				});
				return () => {
					live = false;
				};
			}, []);
			const patch = (change) => setDraft((current) => ({
				...current,
				...change
			}));
			const commit = async (change) => {
				patch(change);
				setSave({
					phase: "saving",
					message: ""
				});
				try {
					const body = await request("/config", {
						method: "POST",
						body: JSON.stringify(change, (_key, value) => value === void 0 ? null : value)
					});
					setState((current) => ({
						...current,
						data: {
							...current.data,
							settings: body.settings,
							hasApiKey: body.hasApiKey
						}
					}));
					setDraft((current) => current === null ? current : {
						...current,
						...body.settings,
						...change.apiKey === void 0 ? {} : { apiKey: "" }
					});
					setSave({
						phase: "saved",
						message: t("saved")
					});
				} catch (error) {
					setSave({
						phase: "error",
						message: t("failed") + "：" + String(error?.message ?? error)
					});
				}
			};
			if (state.phase === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "image25Page", children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "image25Hint", children: t("loading") }) });
			if (state.phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "image25Page", children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "image25Error", children: t("loadFailed") + "：" + state.error }) });
			const value = draft ?? state.data.settings;
			const isCjk = /^(zh|ja|ko)/.test(t.locale?.() ?? "");
			const knownSize = SIZES.some((size) => size.value === value.size);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "image25Page",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "image25Head",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "image25Badge",
							"data-state": state.data.hasApiKey ? "ready" : "missing",
							children: state.data.hasApiKey ? t("ready") : t("noKey")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { className: "image25Subtitle", children: t("subtitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Field, {
						label: t("quality"),
						hint: t("qualityHint"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "image25Segments",
							role: "radiogroup",
							"aria-label": t("quality"),
							children: QUALITIES.map((quality) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "radio",
								"aria-checked": value.quality === quality.value ? "true" : "false",
								"data-active": value.quality === quality.value ? "true" : "false",
								"data-quality": quality.value,
								onClick: () => commit({ quality: quality.value }),
								children: isCjk ? quality.label : quality.labelEn
							}, quality.value))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("model"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							className: "image25Control",
							value: value.model,
							"aria-label": t("model"),
							onChange: (event) => commit({ model: event.target.value }),
							children: MODELS.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: model,
								children: model
							}, model))
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("provider"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "image25Control",
							value: value.provider,
							"aria-label": t("provider"),
							onChange: (event) => commit({ provider: event.target.value }),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "api",
								children: t("providerApi")
							}, "api"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "codex-subscription",
								children: t("providerSubscription")
							}, "codex-subscription")]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						label: t("baseUrl"),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "image25Control",
							type: "text",
							spellCheck: false,
							value: value.baseUrl,
							"aria-label": t("baseUrl"),
							onChange: (event) => patch({ baseUrl: event.target.value }),
							onBlur: () => commit({ baseUrl: value.baseUrl }),
							onKeyDown: (event) => {
								if (event.key === "Enter") commit({ baseUrl: value.baseUrl });
							}
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Field, {
						label: t("apiKey"),
						hint: state.data.hasApiKey ? t("apiKeySaved") : t("apiKeyMissing"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "image25Control",
							type: "password",
							autoComplete: "off",
							placeholder: t("apiKeyPlaceholder"),
							value: value.apiKey ?? "",
							"aria-label": t("apiKey"),
							onChange: (event) => patch({ apiKey: event.target.value }),
							onKeyDown: (event) => {
								if (event.key === "Enter") commit({ apiKey: value.apiKey });
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "image25Button",
							onClick: () => commit({ apiKey: value.apiKey }),
							children: t("save")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Field, {
						label: t("size"),
						hint: t("sizeHint"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "image25Control image25ControlSmall",
							value: knownSize ? value.size : "custom",
							"aria-label": t("size"),
							onChange: (event) => {
								const next = event.target.value;
								if (next !== "custom") commit({ size: next });
							},
							children: [SIZES.map((size) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: size.value,
								children: size.value === "auto" ? t("auto") : size.label
							}, size.value)), knownSize ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "custom",
								children: value.size
							}, "custom")]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							className: "image25Control image25ControlSmall",
							value: value.background,
							"aria-label": t("background"),
							onChange: (event) => commit({ background: event.target.value }),
							children: BACKGROUNDS.map((background) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: background.value,
								children: t(background.key)
							}, background.value))
						})]
					}),
					save.phase === "saving" || save.phase === "saved" || save.phase === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: save.phase === "error" ? "image25Error" : "image25Hint",
						"data-save-state": save.phase,
						children: save.phase === "saving" ? t("saving") : save.message
					}) : null
				]
			});
		}
		const CSS = `
.dshImage25Page,.image25Page{display:flex;flex-direction:column;gap:6px;padding:2px 0 18px;font-family:inherit;color:var(--dsw-alias-label-primary,inherit)}
.image25Head{display:flex;align-items:center;gap:10px}
.image25Head h2{margin:0;font-size:16px;font-weight:600}
.image25Badge{padding:2px 8px;border-radius:999px;font-size:11.5px;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.6));background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.05))}
.image25Badge[data-state="missing"]{color:var(--dsw-alias-state-warning-primary,#b26a00)}
.image25Subtitle{margin:0 0 4px;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.6))}
.image25Row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
.image25RowLabel{display:flex;flex-direction:column;gap:3px;min-width:0}
.image25Label{font-size:13px;font-weight:500}
.image25Hint{font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-tertiary,rgba(0,0,0,.45))}
.image25Error{font-size:12px;color:var(--dsw-alias-state-error-primary,#c62828)}
.image25RowControl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:62%}
.image25Control{box-sizing:border-box;min-width:200px;max-width:100%;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));background:var(--dsw-alias-bg-primary,#fff);color:inherit;font:inherit;font-size:12.5px}
.image25ControlSmall{min-width:120px}
.image25Button{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));background:var(--dsw-alias-bg-primary,#fff);color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.image25Button:hover{background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.04))}
.image25Segments{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.05))}
.image25Segments button{height:26px;min-width:40px;padding:0 10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.image25Segments button:hover{background:var(--dsw-alias-bg-tertiary,rgba(0,0,0,.06))}
.image25Segments button[data-active="true"]{background:var(--dsw-alias-bg-primary,#fff);box-shadow:0 1px 3px rgba(0,0,0,.16);font-weight:600}
.image25ToolRow{display:flex;flex-direction:column;gap:8px;padding:4px 0;max-width:100%}
.image25ToolRow img{max-width:100%;height:auto;border-radius:8px}
.image25ToolImage{display:block;max-width:min(100%,520px);height:auto;border-radius:10px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
.image25ToolRetry{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));background:var(--dsw-alias-bg-primary,#fff);color:inherit;font:inherit;font-size:12px;cursor:pointer}
.image25ToolText{font-size:12px;line-height:1.6;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,rgba(0,0,0,.6))}
`;
		function installStyles() {
			const ID = "dsh-image25-style";
			if (document.getElementById(ID) !== null) return;
			const style = document.createElement("style");
			style.id = ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}
		/**
		* Register the settings page.
		* @param ctx - client context.
		* @param settings - the settings domain service (declared injected, so it is
		*   bound in the browser; the page reads and writes through the host HTTP
		*   endpoints, so nothing else from it is needed).
		*/
		function apply(ctx, settings) {
			void settings;
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-image25: dictionaries");
			installStyles();
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-image25",
				order: 30,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({ t })
			}, Image25Settings));
			for (const key of ["image_generate", "image_edit"]) {
				ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
					name: "tool.call.toolview",
					key,
					locale: NS
				}, ImageToolRow));
			}
		}
		/**
		* One generated image. The row resolves the durable attachment through the
		* session-authorized loader and renders it inline, so the picture appears in
		* the conversation without depending on the attachment gallery slot.
		* @param props - durable image reference, loader, and translator.
		* @returns the image, a loading line, or a retry control.
		*/
		function Image25Image(props) {
			const { image, loader, fallback, t } = props;
			const [src, setSrc] = react.useState(null);
			const [failed, setFailed] = react.useState(false);
			const [attempt, setAttempt] = react.useState(0);
			react.useEffect(() => {
				if (typeof loader !== "function") {
					if (typeof fallback === "string" && fallback !== "") setSrc(fallback);
					else setFailed(true);
					return;
				}
				let live = true;
				setFailed(false);
				setSrc(typeof loader.peek === "function" ? loader.peek(image) ?? null : null);
				let pending;
				try {
					pending = loader(image);
				} catch {
					setFailed(true);
					return;
				}
				Promise.resolve(pending).then((url) => {
					if (!live) return;
					const next = typeof url === "string" ? url : url?.url ?? null;
					if (next === null) setFailed(true);
					else setSrc(next);
				}).catch(() => {
					if (live) setFailed(true);
				});
				return () => {
					live = false;
				};
			}, [image?.attachmentId, loader, attempt]);
			if (failed) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "image25ToolRetry",
				onClick: () => setAttempt((value) => value + 1),
				children: t("imageRetry")
			});
			if (src === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "image25ToolText",
				children: t("imageLoading")
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
				className: "image25ToolImage",
				src,
				alt: t("imageAlt"),
				loading: "lazy",
				decoding: "async"
			});
		}
		/**
		* Tool row for the image tools. The generic card renders text only, so this
		* view draws the generated picture itself from the result's image blocks.
		*/
		function ImageToolRow(props) {
			const t = typeof props.t === "function" ? props.t : (key) => key;
			const content = Array.isArray(props.block?.content) ? props.block.content : [];
			const images = [];
			for (const part of content) {
				if (part !== null && typeof part === "object" && part.type === "image" && part.attachment !== undefined && part.attachment !== null) images.push(part.attachment);
			}
			const text = content.filter((part) => part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").split("\n").filter((line) => !/do not embed/i.test(line)).join("\n").trim();
			const children = [];
			const served = text.match(/\/api\/dsh-image25\/images\/\S+/);
			const fallback = served === null ? null : served[0];
			images.forEach((image, index) => {
				children.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Image25Image, {
					image,
					loader: props.loadImage,
					fallback,
					t
				}, "image-" + String(index)));
			});
			if (images.length === 0 && text === "") children.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "image25ToolText",
				children: t("imageWorking")
			}, "working"));
			if (text !== "") children.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "image25ToolText",
				children: text
			}, "text"));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "image25ToolRow",
				children
			});
		}
		//#endregion
		exports.inject = ["slots", "locale"];
		exports.apply = apply;
		exports.NS = NS;
		exports.Image25Settings = Image25Settings;
		return module.exports;
	}
});
