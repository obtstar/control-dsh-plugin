// control-api HTTP 客户端（v0.2 拆模块）
// Bearer 会话（静态 token 或登录换取） + webhook 共享密钥（X-Webhook-Token）双通道。
// 密钥只经环境变量注入，不落盘、不进配置。

let cachedAuth = null; // { header, at }：登录换取 token 的进程内缓存

// authHeader 返回 Authorization 头；无凭据返回 ""（调用方不带鉴权头）
export async function authHeader(cfg) {
	const staticToken = process.env[cfg.tokenEnv];
	if (staticToken) return `Bearer ${staticToken}`;
	const user = process.env[cfg.usernameEnv];
	const pass = process.env[cfg.passwordEnv];
	if (!user || !pass) return "";
	if (cachedAuth && Date.now() - cachedAuth.at < 23 * 3600e3) return cachedAuth.header;
	const res = await requestJson(cfg, "/api/auth/login", {
		method: "POST",
		json: { username: user, password: pass },
		useAuth: false
	});
	if (!res || typeof res.token !== "string") {
		throw new Error("control-api 登录失败：响应缺少 token");
	}
	cachedAuth = { header: `Bearer ${res.token}`, at: Date.now() };
	return cachedAuth.header;
}

// requestJson 通用 JSON 请求（Bearer 会话）
export async function requestJson(cfg, path, { method = "GET", json, useAuth = true, signal } = {}) {
	const headers = { "Content-Type": "application/json" };
	if (useAuth) {
		const h = await authHeader(cfg);
		if (h) headers.Authorization = h;
	}
	const res = await fetch(`${cfg.baseUrl}${path}`, {
		method,
		headers,
		body: json !== undefined ? JSON.stringify(json) : undefined,
		signal
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	if (!res.ok) {
		const detail = data && typeof data === "object" && typeof data.error === "string"
			? data.error
			: `HTTP ${res.status}`;
		throw new Error(`control-api ${method} ${path} -> ${res.status}: ${detail}`);
	}
	return data;
}

// webhookRequest 独立共享密钥通道（advance 等，X-Webhook-Token）
export async function webhookRequest(cfg, path, { json, signal } = {}) {
	const token = process.env[cfg.advanceTokenEnv];
	if (!token) {
		throw new Error(`control-api advance webhook 未配置：环境变量 ${cfg.advanceTokenEnv} 为空（对应 control-api server.webhook_secret）`);
	}
	const res = await fetch(`${cfg.baseUrl}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Webhook-Token": token
		},
		body: json !== undefined ? JSON.stringify(json) : undefined,
		signal
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	if (!res.ok) {
		const detail = data && typeof data === "object" && typeof data.error === "string"
			? data.error
			: `HTTP ${res.status}`;
		throw new Error(`control-api ${path} -> ${res.status}: ${detail}`);
	}
	return data;
}
