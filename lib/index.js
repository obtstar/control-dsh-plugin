// control 平台 DSH 集成插件（v0.1）
//
// 把 control-api 的任务状态机/审批/审计暴露为模型侧工具（control_*）。
// C1 执行层迁移后的角色划分：
//   - 模型接入（LLM）→ DSH（dsh-llm），不再走 control 的 LiteLLM 通道
//   - 任务执行 → DSH 会话内（plan mode / subagent / workflow）
//   - 状态机/审批/审计/对账 → control-api（本插件是它的 HTTP 桥）
//
// 认证：优先取 process.env[tokenEnv] 的静态 Bearer token；未配置时用
// usernameEnv/passwordEnv 指向的环境变量调 /api/auth/login 换取会话 token
// 并缓存（24h）。密钥只经环境变量注入，不落盘、不进配置。
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "control";
export const inject = ["tools", "systemPrompt"];

export const Config = z.object({
	baseUrl: z.string().default("http://127.0.0.1:8765"),
	tokenEnv: z.string().default("CONTROL_API_TOKEN"),
	usernameEnv: z.string().default("CONTROL_API_USER"),
	passwordEnv: z.string().default("CONTROL_API_PASSWORD"),
	// advance webhook 共享密钥（对应 control-api server.webhook_secret / env
	// CONTROL_WEBHOOK_SECRET）；X-Webhook-Token 头，独立于 Bearer 会话
	advanceTokenEnv: z.string().default("CONTROL_ADVANCE_TOKEN"),
	timeoutMs: z.number().min(100).default(15000)
});

// ── control-api HTTP 客户端 ────────────────────────────────────────────────

let cachedAuth = null; // { header, at }：登录换取 token 的进程内缓存

async function authHeader(cfg) {
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

async function requestJson(cfg, path, { method = "GET", json, useAuth = true, signal } = {}) {
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

// ── webhook 通道（advance，X-Webhook-Token 独立认证）────────────────────────

async function webhookRequest(cfg, path, { json, signal } = {}) {
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

// ── 输出渲染与 schema ──────────────────────────────────────────────────────
// 注意：value-schema DSL 不支持顶层 required 数组，required 必须内联到属性上。

function renderJson(args, value) {
	return [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}];
}

function presentControlCall(title, args) {
	return { card: "generic", title, kind: "control", rawInput: JSON.stringify(args) };
}

// 工具输出声明（与 control-api 响应形状一致；required 内联）
const healthSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: { type: "string", required: true },
		version: { type: "string" }
	}
};

const taskIdPathSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		task_id: { type: "string", required: true },
		path: { type: "string", required: true }
	}
};

const taskActionResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		task_id: { type: "string", required: true },
		stage: { type: "string" },
		status: { type: "string", required: true }
	}
};

const rowArraySchema = {
	type: "array",
	items: { type: "object", additionalProperties: true, properties: {} }
};

export function apply(ctx, config) {
	const cfg = {
		baseUrl: config.baseUrl,
		tokenEnv: config.tokenEnv,
		usernameEnv: config.usernameEnv,
		passwordEnv: config.passwordEnv,
		advanceTokenEnv: config.advanceTokenEnv,
		timeoutMs: config.timeoutMs
	};

	// 平台工作流提示词：任务生命周期 + 审批闸 + 依据要求
	ctx.systemPrompt.section({
		name: "tool:control",
		order: 107,
		text: [
			"control 平台任务编排（经 control-api）：任务即文档，流水线 requirements → design → coding → testing → merge → deliver，每阶段一道审批闸。",
			"- 创建任务用 control_task_create（body 为 L1 需求，人写；repo_key 须已在 registry 登记）；",
			"- 阶段执行在 DSH 会话内完成，产物落任务目录（report-<stage>.md 等），完成后用 control_task_advance 声明阶段完成，任务进入审批闸；",
			"- 查询待审批用 control_approvals_list，执行审批用 control_task_action（approve/reject/pause/resume/deliver，附 comment 留痕）；",
			"- 产出必须引用 KB 依据（mcp__piekbs__kb_search），无依据时输出 NO_BASIS 并停止；",
			"- 权柄分级 L1>L2>L3>L4 顺行产出，禁止逆行修改上级文档（authority-check 技能）。"
		].join("\n")
	});

	ctx.tools.register(defineTool({
		name: "control_health",
		description: "control-api 探活：返回 {status, version}。调用其他 control_* 工具前先确认服务可用。",
		parameters: {},
		output: {
			schema: healthSchema,
			render: renderJson
		},
		async execute(args, exec) {
			return requestJson(cfg, "/actuator/health", { signal: exec.signal });
		},
		presentCall: (args) => presentControlCall("Check control-api health", args)
	}));

	ctx.tools.register(defineTool({
		name: "control_task_create",
		description: "创建 control 任务（落一份 task.md，任务即文档）。body 是 L1 需求正文，须由人提供；repo_key 可选但若提供必须已在 registry（control-center/registry/repos.yaml）登记。返回 {task_id, path}。",
		parameters: {
			title: { type: "string", required: true, description: "任务标题（一句话）" },
			body: { type: "string", required: true, description: "L1 需求正文（人写；AI 不替人编造需求）" },
			repo_key: { type: "string", description: "目标仓库 key（registry 已登记），可留空作草稿任务" },
			domain: { type: "string", description: "领域技能覆盖（frontend-dev/backend-go/…），可留空" }
		},
		output: {
			schema: taskIdPathSchema,
			render: renderJson
		},
		async execute(args, exec) {
			return requestJson(cfg, "/api/tasks", {
				method: "POST",
				json: {
					title: args.title,
					body: args.body,
					repo_key: args.repo_key || "",
					domain: args.domain || ""
				},
				signal: exec.signal
			});
		},
		presentCall: (args) => presentControlCall(`Create control task: ${args.title}`, args)
	}));

	ctx.tools.register(defineTool({
		name: "control_task_list",
		description: "列出 control 全部任务（store.ListTasks 原样返回：task_id/title/stage/status/…）。需要按阶段或状态过滤时在后续分析中自行筛选。",
		parameters: {},
		output: {
			schema: rowArraySchema,
			render: renderJson
		},
		async execute(args, exec) {
			return requestJson(cfg, "/api/tasks", { signal: exec.signal });
		},
		presentCall: (args) => presentControlCall("List control tasks", args)
	}));

	ctx.tools.register(defineTool({
		name: "control_task_action",
		description: "对 control 任务执行状态动作：approve（通过当前阶段审批）/reject（驳回，须附 comment）/pause（暂停，最高优先级，暂停期间禁一切写操作）/resume（恢复）/deliver（交付确认，仅 merge/merged 阶段）。返回 {task_id, stage, status}。",
		parameters: {
			task_id: { type: "string", required: true, description: "任务 ID，形如 TASK-001" },
			action: {
				type: "string", required: true,
				enum: ["approve", "reject", "pause", "resume", "deliver"],
				description: "状态动作"
			},
			comment: { type: "string", description: "批注（reject 必填，其余可选）；留痕审计" },
			artifact: { type: "string", description: "阶段产物路径/说明（可选）" }
		},
		output: {
			schema: taskActionResultSchema,
			render: renderJson
		},
		async execute(args, exec) {
			return requestJson(cfg, `/api/tasks/${encodeURIComponent(args.task_id)}/action`, {
				method: "POST",
				json: {
					action: args.action,
					comment: args.comment || "",
					artifact: args.artifact || ""
				},
				signal: exec.signal
			});
		},
		presentCall: (args) => presentControlCall(`control action ${args.action} on ${args.task_id}`, args)
	}));

	ctx.tools.register(defineTool({
		name: "control_task_advance",
		description: "向 control-api 声明任务当前阶段已完成（C1 执行模型：阶段在 DSH 会话内执行，产物落任务目录后调用），任务进入审批闸 awaiting_approval，由人 approve/reject 后推进下一阶段。仅 pending/running 状态可 advance；paused（暂停禁一切写）/awaiting_approval/delivered 会 409。认证为 X-Webhook-Token 独立共享密钥（环境变量 CONTROL_ADVANCE_TOKEN，对应 control-api server.webhook_secret）。返回 {task_id, stage, status}。",
		parameters: {
			task_id: { type: "string", required: true, description: "任务 ID，形如 TASK-001" },
			artifact: { type: "string", description: "阶段产物说明（可选），如 report-design.md，记入 work_log detail" }
		},
		output: {
			schema: taskActionResultSchema,
			render: renderJson
		},
		async execute(args, exec) {
			return webhookRequest(cfg, "/api/webhooks/advance", {
				json: {
					task_id: args.task_id,
					artifact: args.artifact || ""
				},
				signal: exec.signal
			});
		},
		presentCall: (args) => presentControlCall(`Advance stage of ${args.task_id}`, args)
	}));

	ctx.tools.register(defineTool({
		name: "control_approvals_list",
		description: "列出当前待审批项（按当前会话用户角色路由；admin 通吃）。返回行含 task_id/阶段/审批角色等。",
		parameters: {},
		output: {
			schema: rowArraySchema,
			render: renderJson
		},
		async execute(args, exec) {
			return requestJson(cfg, "/api/approvals/pending", { signal: exec.signal });
		},
		presentCall: (args) => presentControlCall("List pending control approvals", args)
	}));

	ctx.tools.register(defineTool({
		name: "control_audit",
		description: "读取 control-api 审计日志（最近 100 条 work_log：任务动作留痕）。",
		parameters: {},
		output: {
			schema: rowArraySchema,
			render: renderJson
		},
		async execute(args, exec) {
			return requestJson(cfg, "/api/audit", { signal: exec.signal });
		},
		presentCall: (args) => presentControlCall("Read control audit log", args)
	}));

	ctx.tools.register(defineTool({
		name: "control_findings",
		description: "读取 FINDINGS.md 问题台账（FINDING-* 逐条：现象/证据/影响/状态/目标）。",
		parameters: {},
		output: {
			schema: rowArraySchema,
			render: renderJson
		},
		async execute(args, exec) {
			return requestJson(cfg, "/api/findings", { signal: exec.signal });
		},
		presentCall: (args) => presentControlCall("Read control findings ledger", args)
	}));
}
