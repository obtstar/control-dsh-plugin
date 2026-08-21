// 会话绑定工具集（v0.3）：认领/上下文
import { defineTool } from "@deepseek-ai/dsh-tools";
import { renderJson, presentControlCall } from "./render.js";
import { parseTaskMeta, loadPipeline, stageSpec } from "./pipeline.js";
import { getBinding, setBinding } from "./session.js";

export function registerSessionTools(ctx, cfg) {
	ctx.tools.register(defineTool({
		name: "control_task_claim",
		description: "会话↔任务绑定（v0.3）：当前 DSH 会话认领一个 control 任务，之后 control_task_execute/advance/action 的 task_id 可省略、自动回落绑定。task_id 传 none 或省略时释放绑定。返回 {session_key, task_id, bound, task_dir}。",
		parameters: {
			task_id: { type: "string", description: "认领的任务 ID（形如 TASK-001）；none 或省略 = 释放绑定" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					session_key: { type: "string", required: true },
					task_id: { type: "string" },
					bound: { type: "boolean", required: true },
					task_dir: { type: "string" }
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const requested = args.task_id && args.task_id !== "none" ? args.task_id : "";
			if (requested) {
				const meta = parseTaskMeta(cfg.tasksDir, requested);
				if (!meta) {
					throw new Error(`任务不存在或 task.md 不可读: ${requested}`);
				}
				setBinding(exec, requested);
			} else {
				setBinding(exec, "");
			}
			const taskId = getBinding(exec);
			return {
				session_key: exec?.agent?.sessionId || "default",
				task_id: taskId || "",
				bound: Boolean(taskId),
				task_dir: taskId ? `${cfg.tasksDir.replace(/\/$/, "")}/${taskId}` : ""
			};
		},
		presentCall: (args) => presentControlCall(`Claim task ${args.task_id || "(release)"}`, args)
	}));

	ctx.tools.register(defineTool({
		name: "control_task_context",
		description: "返回当前会话绑定任务的完整上下文（任务目录/阶段/状态/仓库/阶段规格/建议产物）。未绑定时提示先 control_task_claim。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					task_id: { type: "string", required: true },
					bound: { type: "boolean", required: true }
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const taskId = getBinding(exec);
			if (!taskId) {
				return {
					bound: false,
					task_id: "",
					message: "会话未绑定任务：先用 control_task_claim 认领（task_id 必填）"
				};
			}
			const meta = parseTaskMeta(cfg.tasksDir, taskId);
			if (!meta) {
				setBinding(exec, "");
				return { bound: false, task_id: taskId, message: "绑定任务已不存在，绑定已释放" };
			}
			const pipeline = loadPipeline(cfg.pipelinePath);
			const stageId = meta.stage || pipeline?.pipeline?.stages?.[0]?.id || "";
			const spec = stageSpec(pipeline, stageId);
			return {
				bound: true,
				task_id: meta.task_id,
				title: meta.title,
				repo_key: meta.repo_key,
				domain: meta.domain,
				task_dir: `${cfg.tasksDir.replace(/\/$/, "")}/${meta.task_id}`,
				stage: meta.stage,
				status: meta.status,
				stage_spec: spec,
				suggested_artifact: stageId ? `report-${stageId}.md` : ""
			};
		},
		presentCall: (args) => presentControlCall("Get bound task context", args)
	}));
}
