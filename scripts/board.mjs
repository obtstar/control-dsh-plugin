// control 独立看板服务（v0.5 方案 1）：静态页 + control-api 代理
// 凭据只在服务端持有（env CONTROL_API_TOKEN 优先，否则 CONTROL_API_USER/PASSWORD 登录换取），
// 浏览器只连本服务（127.0.0.1:8787），不经手 token。
// 用法：CONTROL_API_USER=.. CONTROL_API_PASSWORD=.. node scripts/board.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] || process.env.BOARD_PORT || 8787);
const API = process.env.CONTROL_API_BASE || "http://127.0.0.1:8765";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(__dirname, "board", "index.html"), "utf8");

let cachedAuth = null;

async function authHeader() {
	if (process.env.CONTROL_API_TOKEN) return `Bearer ${process.env.CONTROL_API_TOKEN}`;
	const user = process.env.CONTROL_API_USER;
	const pass = process.env.CONTROL_API_PASSWORD;
	if (!user || !pass) return "";
	if (cachedAuth && Date.now() - cachedAuth.at < 23 * 3600e3) return cachedAuth.header;
	const res = await fetch(`${API}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username: user, password: pass })
	});
	if (!res.ok) return "";
	const data = await res.json();
	cachedAuth = { header: `Bearer ${data.token}`, at: Date.now() };
	return cachedAuth.header;
}

async function proxy(req, res) {
	const url = new URL(req.url, `http://${req.headers.host}`);
	const pathname = url.pathname;
	// 白名单：只代理 control-api 的读/审批端点
	const allowed = /^\/(api\/(tasks|tasks\/[^/]+\/action|approvals\/pending|audit|findings|kb\/search)|webhooks\/advance)$/.test(pathname);
	if (!allowed) {
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "path not allowed" }));
		return;
	}
	const headers = { "Content-Type": "application/json" };
	if (!pathname.startsWith("/webhooks/")) {
		const h = await authHeader();
		if (h) headers.Authorization = h;
	}
	let body = null;
	if (req.method === "POST" || req.method === "PUT") {
		body = await new Promise((resolve) => {
			const chunks = [];
			req.on("data", (c) => chunks.push(c));
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8") || null));
		});
	}
	if (pathname.startsWith("/webhooks/advance")) {
		headers["X-Webhook-Token"] = process.env.CONTROL_ADVANCE_TOKEN || "";
	}
	try {
		const upstream = await fetch(`${API}${pathname}${url.search}`, {
			method: req.method,
			headers,
			body: body ?? undefined
		});
		const text = await upstream.text();
		res.writeHead(upstream.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		res.end(text);
	} catch (err) {
		res.writeHead(502, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: `control-api unreachable: ${err.message}` }));
	}
}

const server = http.createServer((req, res) => {
	if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
		res.end(INDEX);
		return;
	}
	proxy(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`[board] control 看板 http://127.0.0.1:${PORT}（代理 ${API}）`);
});
