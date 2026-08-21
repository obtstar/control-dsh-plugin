// control 平台 DSH 集成插件（v0.2）
//
// 把 control-api 的任务状态机/审批/审计/对账暴露为模型侧工具（control_*）。
// C1 执行层迁移后的角色划分：
//   - 模型接入（LLM）→ DSH（dsh-llm），不再走 control 的 LiteLLM 通道
//   - 任务执行 → DSH 会话内（plan mode / subagent / workflow），产物落任务目录
//   - 状态机/审批/审计/对账 → control-api（本插件是它的 HTTP 桥）
//
// v0.2：拆模块（http/pipeline/render/tools-core/tools-exec），新增执行面工具
// （control_reconcile / control_task_execute / control_grounding_check / control_pipeline_status）。
// 密钥只经环境变量注入，不落盘、不进配置。
import z from "@deepseek-ai/schemastery";
import { authHeader } from "./http.js";
import { registerCoreTools } from "./tools-core.js";
import { registerExecTools } from "./tools-exec.js";
import { registerSessionTools } from "./tools-session.js";
import { startNotifier } from "./notify.js";

export const name = "control";
export const inject = ["tools", "systemPrompt", "agents", "llm"];

export const Config = z.object({
	baseUrl: z.string().default("http://127.0.0.1:8765"),
	tokenEnv: z.string().default("CONTROL_API_TOKEN"),
	usernameEnv: z.string().default("CONTROL_API_USER"),
	passwordEnv: z.string().default("CONTROL_API_PASSWORD"),
	// advance webhook 共享密钥（对应 control-api server.webhook_secret / env
	// CONTROL_WEBHOOK_SECRET）；X-Webhook-Token 头，独立于 Bearer 会话
	advanceTokenEnv: z.string().default("CONTROL_ADVANCE_TOKEN"),
	// 执行面配置：control-api 二进制（reconcile）、任务目录、流水线声明路径
	controlBin: z.string().default("~/control-api/control-api"),
	// 反向通知（v0.4）：轮询审批闸变化并注入绑定会话
	notifyEnabled: z.boolean().default(true),
	notifyIntervalSec: z.number().min(10).default(60),
	tasksDir: z.string().default("~/control-center/tasks"),
	pipelinePath: z.string().default("~/control-center/orchestration/workflows/pipeline.yaml"),
	timeoutMs: z.number().min(100).default(15000)
});

export function apply(ctx, config) {
	// webServer 可选（web-app 组合提供；headless 无）：看板挂载（v0.5 方案 2）。
	// 不 inject 以免阻塞无 webServer 的 profile；ctx.get 探测存在性。
	const cfg = {
		baseUrl: config.baseUrl,
		tokenEnv: config.tokenEnv,
		usernameEnv: config.usernameEnv,
		passwordEnv: config.passwordEnv,
		advanceTokenEnv: config.advanceTokenEnv,
		controlBin: config.controlBin,
		notifyEnabled: config.notifyEnabled,
		notifyIntervalSec: config.notifyIntervalSec,
		tasksDir: config.tasksDir,
		pipelinePath: config.pipelinePath,
		timeoutMs: config.timeoutMs
	};

	// 平台工作流提示词：任务生命周期 + 审批闸 + 依据要求
	ctx.systemPrompt.section({
		name: "tool:control",
		order: 107,
		text: [
			"control 平台任务编排（经 control-api）：任务即文档，流水线 requirements → design → coding → testing → merge → deliver，每阶段一道审批闸。",
			"- 创建任务用 control_task_create（body 为 L1 需求，人写；repo_key 须已在 registry 登记）；",
			"- 阶段执行在 DSH 会话内完成：control_task_execute 取任务当前阶段指引（任务目录/阶段规格/产物要求），产物落任务目录（report-<stage>.md 等），完成后用 control_task_advance 声明阶段完成，任务进入审批闸；",
			"- 查询待审批用 control_approvals_list，执行审批用 control_task_action（approve/reject/pause/resume/deliver，附 comment 留痕）；",
			"- 产出必须引用 KB 依据：control_grounding_check 或 mcp__piekbs__kb_search 校验，无依据时输出 NO_BASIS 并停止；",
			"- 文档改动后用 control_reconcile 跑对账；流水线/熔断状态用 control_pipeline_status；",
			"- 权柄分级 L1>L2>L3>L4 顺行产出，禁止逆行修改上级文档（authority-check 技能）。"
		].join("\n")
	});

	registerCoreTools(ctx, cfg);
	registerExecTools(ctx, cfg);
	registerSessionTools(ctx, cfg);
	startNotifier(ctx, cfg);

	// ── Web Dashboard 路由（v0.5 方案 2：看板静态挂载）─────────────────────────
	// 提供 /control/dashboard 端点，返回任务看板 HTML
	// webServer 可选且加载顺序不保证：ctx.get 在 apply 时可能尚未就绪，
	// 用 ctx.inject 延迟到 webServer 可用时再挂载（其卸载时自动回收路由）。
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = webCtx.get("webServer");
		const dashboardHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Control Platform Dashboard</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #30363d; }
.header h1 { font-size: 24px; color: #f0f6fc; }
.tabs { display: flex; gap: 8px; margin-bottom: 24px; }
.tab { padding: 8px 16px; background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; cursor: pointer; }
.tab.active { background: #1f6feb; border-color: #1f6feb; color: white; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #30363d; }
.table th { font-weight: 600; color: #f0f6fc; background: #161b22; }
.table tr:hover { background: #161b22; }
.status { padding: 2px 8px; border-radius: 12px; font-size: 12px; }
.status.pending { background: #f0883e33; color: #f0883e; }
.status.running { background: #3fb95033; color: #3fb950; }
.status.awaiting_approval { background: #a371f733; color: #a371f7; }
.status.delivered { background: #58a6ff33; color: #58a6ff; }
.loading { text-align: center; padding: 40px; color: #8b949e; }
.error { text-align: center; padding: 40px; color: #f85149; }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.card-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
.card-title { font-weight: 600; color: #f0f6fc; }
.card-meta { font-size: 12px; color: #8b949e; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
.btn { padding: 6px 12px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; }
.btn-approve { background: #238636; color: white; }
.btn-reject { background: #da3633; color: white; }
</style>
</head>
<body>
<div class="header">
<h1>🎛️ Control Platform Dashboard</h1>
<span id="status">Loading...</span>
</div>
<div class="tabs">
<button class="tab active" onclick="showTab('tasks')">Tasks</button>
<button class="tab" onclick="showTab('approvals')">Approvals</button>
<button class="tab" onclick="showTab('audit')">Audit Log</button>
</div>
<div id="content">
<div class="loading">Loading data...</div>
</div>
<script>
const API_BASE = '/control/dashboard';
async function apiRequest(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error('API error: ' + res.status);
  return res.json();
}
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  if (tab === 'tasks') loadTasks();
  else if (tab === 'approvals') loadApprovals();
  else if (tab === 'audit') loadAudit();
}
async function loadTasks() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading tasks...</div>';
  try {
    const tasks = await apiRequest('/api/tasks');
    if (!tasks.length) { content.innerHTML = '<div class="loading">No tasks found</div>'; return; }
    let html = '<table class="table"><tr><th>ID</th><th>Title</th><th>Stage</th><th>Status</th><th>Updated</th></tr>';
    tasks.forEach(t => {
      html += '<tr><td>' + t.task_id + '</td><td>' + t.title + '</td><td>' + (t.stage || '-') + '</td><td><span class="status ' + t.status + '">' + t.status + '</span></td><td>' + new Date(t.updated_at).toLocaleDateString() + '</td></tr>';
    });
    html += '</table>';
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = '<div class="error">Error: ' + err.message + '</div>';
  }
}
async function loadApprovals() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading approvals...</div>';
  try {
    const approvals = await apiRequest('/api/approvals/pending');
    if (!approvals.length) { content.innerHTML = '<div class="loading">No pending approvals</div>'; return; }
    let html = '';
    approvals.forEach(a => {
      html += '<div class="card"><div class="card-header"><span class="card-title">' + a.task_id + '</span><span class="card-meta">' + a.stage + '</span></div><div>' + a.title + '</div><div class="card-meta">Role: ' + a.role + '</div></div>';
    });
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = '<div class="error">Error: ' + err.message + '</div>';
  }
}
async function loadAudit() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading audit log...</div>';
  try {
    const logs = await apiRequest('/api/audit');
    if (!logs.length) { content.innerHTML = '<div class="loading">No audit entries</div>'; return; }
    let html = '<table class="table"><tr><th>ID</th><th>Task</th><th>Action</th><th>Operator</th><th>Stage</th><th>Time</th></tr>';
    logs.forEach(l => {
      html += '<tr><td>' + l.id + '</td><td>' + l.task_id + '</td><td>' + l.action + '</td><td>' + l.operator + '</td><td>' + (l.stage || '-') + '</td><td>' + new Date(l.created_at).toLocaleString() + '</td></tr>';
    });
    html += '</table>';
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = '<div class="error">Error: ' + err.message + '</div>';
  }
}
loadTasks();
document.getElementById('status').textContent = 'Connected to ' + API_BASE;
</script>
</body>
</html>`;

		webCtx.effect(() => {
			const route = webServer.register({
				path: '/control/dashboard',
				kind: 'prefix',
				handler: async (req, res) => {
					const url = new URL(req.url, 'http://x');
					const p = url.pathname;
					if (p === '/control/dashboard' || p === '/control/dashboard/') {
						res.setHeader('Content-Type', 'text/html; charset=utf-8');
						res.end(dashboardHtml);
						return;
					}
					// 同源代理：/control/dashboard/api/* → control-api（Bearer 服务端持有）
					const rest = p.slice('/control/dashboard'.length);
					if (!/^\/(api\/(tasks|tasks\/[^/]+\/action|approvals\/pending|audit|findings|kb\/search)|webhooks\/advance)$/.test(rest)) {
						res.writeHead(404, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'path not allowed' }));
						return;
					}
					const headers = { 'Content-Type': 'application/json' };
					if (rest.startsWith('/webhooks/')) {
						headers['X-Webhook-Token'] = process.env[cfg.advanceTokenEnv] || '';
					} else {
						const h = await authHeader(cfg);
						if (h) headers.Authorization = h;
					}
					let body = null;
					if (req.method === 'POST' || req.method === 'PUT') {
						body = await new Promise((resolve) => {
							const chunks = [];
							req.on('data', (c) => chunks.push(c));
							req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || null));
						});
					}
					try {
						const up = await fetch(cfg.baseUrl + rest, { method: req.method, headers, body: body ?? undefined });
						const text = await up.text();
						res.writeHead(up.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
						res.end(text);
					} catch (err) {
						res.writeHead(502, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'control-api unreachable: ' + err.message }));
					}
				}
			});
			console.log('[control] Dashboard registered at /control/dashboard');
			return route;
		}, 'control: dashboard route');
	});
}
