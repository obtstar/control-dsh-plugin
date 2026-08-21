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
import { registerCoreTools } from "./tools-core.js";
import { registerExecTools } from "./tools-exec.js";
import { registerSessionTools } from "./tools-session.js";

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
	// 执行面配置：control-api 二进制（reconcile）、任务目录、流水线声明路径
	controlBin: z.string().default("~/control-api/control-api"),
	tasksDir: z.string().default("~/control-center/tasks"),
	pipelinePath: z.string().default("~/control-center/orchestration/workflows/pipeline.yaml"),
	timeoutMs: z.number().min(100).default(15000)
});

export function apply(ctx, config) {
	const cfg = {
		baseUrl: config.baseUrl,
		tokenEnv: config.tokenEnv,
		usernameEnv: config.usernameEnv,
		passwordEnv: config.passwordEnv,
		advanceTokenEnv: config.advanceTokenEnv,
		controlBin: config.controlBin,
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
}
