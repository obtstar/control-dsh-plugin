// 核心工具集（v0.1 的 8 个管理面工具，v0.2 拆模块）：探活/任务/审批/审计/台账
import { defineTool } from "@deepseek-ai/dsh-tools";
import { requestJson, webhookRequest } from "./http.js";
import { resolveTaskId } from "./session.js";
import { renderJson, presentControlCall, healthSchema, taskIdPathSchema, taskActionResultSchema, rowArraySchema } from "./render.js";

export function registerCoreTools(ctx, cfg) {
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
			task_id: { type: "string", description: "任务 ID（可省略，缺省用会话绑定，control_task_claim 认领）" },
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
			const taskId = resolveTaskId(cfg, exec, args.task_id);
			if (!taskId) throw new Error("缺少 task_id：显式传入或先用 control_task_claim 认领任务");
			return requestJson(cfg, `/api/tasks/${encodeURIComponent(taskId)}/action`, {
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
			task_id: { type: "string", description: "任务 ID（可省略，缺省用会话绑定，control_task_claim 认领）" },
			artifact: { type: "string", description: "阶段产物说明（可选），如 report-design.md，记入 work_log detail" }
		},
		output: {
			schema: taskActionResultSchema,
			render: renderJson
		},
		async execute(args, exec) {
			const taskId = resolveTaskId(cfg, exec, args.task_id);
			if (!taskId) throw new Error("缺少 task_id：显式传入或先用 control_task_claim 认领任务");
			return webhookRequest(cfg, "/api/webhooks/advance", {
				json: {
					task_id: taskId,
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
