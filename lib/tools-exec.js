// 执行面工具集（v0.2）：对账/阶段引导/有据校验/流水线状态
import { execFile } from "node:child_process";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { requestJson } from "./http.js";
import { renderJson, presentControlCall, rowArraySchema } from "./render.js";
import { expandHome, parseTaskMeta, loadPipeline, stageSpec, stageSummaries } from "./pipeline.js";
import { resolveTaskId } from "./session.js";

// runReconcile 执行 control-api reconcile（对账 loop：文档声明 vs 代码事实，CONFLICT 退出码 1）
function runReconcile(bin, timeoutMs) {
	return new Promise((resolve) => {
		execFile(expandHome(bin), ["reconcile"], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
			const output = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim();
			resolve({
				exit_code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
				output: output.slice(0, 8000),
				note: err && err.killed ? "超时被终止" : ""
			});
		});
	});
}

export function registerExecTools(ctx, cfg) {
	ctx.tools.register(defineTool({
		name: "control_reconcile",
		description: "运行 control-api 对账（reconcile）：按 orchestration/reconcile/checks.yaml 校验文档声明 vs 代码事实（后端/前端/数据库/注册表/镜像新鲜度），CONFLICT 退出码 1。返回 {exit_code, output}。文档改动后应跑一次。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					exit_code: { type: "number", required: true },
					output: { type: "string", required: true },
					note: { type: "string" }
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			return runReconcile(cfg.controlBin, cfg.timeoutMs);
		},
		presentCall: (args) => presentControlCall("Run control-api reconcile", args)
	}));

	ctx.tools.register(defineTool({
		name: "control_task_execute",
		description: "获取任务当前阶段的执行指引（C1 执行模型：阶段在 DSH 会话内执行）：读取任务目录 task.md 与流水线声明 pipeline.yaml，返回任务上下文（task_dir/stage/status/repo_key）与该阶段规格（model/agent/artifact/approval/on_reject）及建议产物名 report-<stage>.md。执行完产物落任务目录后调 control_task_advance 声明阶段完成。",
		parameters: {
			task_id: { type: "string", description: "任务 ID（可省略，缺省用会话绑定，control_task_claim 认领）" },
			stage: { type: "string", description: "指定阶段（默认取任务当前 stage；空则取流水线首阶段）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					task_id: { type: "string", required: true }
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const taskId = resolveTaskId(cfg, exec, args.task_id);
			if (!taskId) throw new Error("缺少 task_id：显式传入或先用 control_task_claim 认领任务");
			const meta = parseTaskMeta(cfg.tasksDir, taskId);
			if (!meta) {
				throw new Error(`任务不存在或 task.md 不可读: ${taskId}（tasks_dir=${cfg.tasksDir}）`);
			}
			const pipeline = loadPipeline(cfg.pipelinePath);
			const stageId = args.stage || meta.stage || pipeline?.pipeline?.stages?.[0]?.id || "";
			const spec = stageSpec(pipeline, stageId);
			const tasksRoot = expandHome(cfg.tasksDir);
			return {
				task_id: meta.task_id,
				title: meta.title,
				repo_key: meta.repo_key,
				task_dir: `${tasksRoot}/${meta.task_id}`,
				current_stage: meta.stage,
				current_status: meta.status,
				execute_stage: stageId,
				stage_spec: spec || null,
				suggested_artifact: stageId ? `report-${stageId}.md` : ""
			};
		},
		presentCall: (args) => presentControlCall(`Get execution guide for ${args.task_id}`, args)
	}));

	ctx.tools.register(defineTool({
		name: "control_grounding_check",
		description: "有据可依校验（18.3）：经 control-api /api/kb/search 检索 KB，确认产出依据真实存在。返回 {count, has_basis, hits}。无依据时不得输出（应输出 NO_BASIS 并停止/补齐语料）。",
		parameters: {
			query: { type: "string", required: true, description: "检索词（可多词空格分隔；建议含别名/缩写）" },
			limit: { type: "number", description: "最大返回条数（默认 5）" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					count: { type: "number", required: true },
					has_basis: { type: "boolean", required: true },
					hits: rowArraySchema
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const limit = args.limit && args.limit > 0 ? args.limit : 5;
			const hits = await requestJson(cfg, `/api/kb/search?q=${encodeURIComponent(args.query)}&limit=${limit}`, { signal: exec.signal });
			const arr = Array.isArray(hits) ? hits : [];
			return {
				count: arr.length,
				has_basis: arr.length > 0,
				hits: arr.slice(0, limit)
			};
		},
		presentCall: (args) => presentControlCall(`Grounding check: ${args.query}`, args)
	}));

	ctx.tools.register(defineTool({
		name: "control_pipeline_status",
		description: "读取流水线声明（pipeline.yaml：阶段/审批/熔断）并汇总 control-api 任务状态分布（按 stage/status 计数）。返回 {stages, circuit_breaker, tasks_summary}。",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					stages: { type: "array", required: true, items: { type: "object", additionalProperties: true, properties: {} } }
				}
			},
			render: renderJson
		},
		async execute(args, exec) {
			const pipeline = loadPipeline(cfg.pipelinePath);
			const tasks = await requestJson(cfg, "/api/tasks", { signal: exec.signal });
			const list = Array.isArray(tasks) ? tasks : [];
			const byStatus = {};
			const byStage = {};
			for (const t of list) {
				byStatus[t.status || "?"] = (byStatus[t.status || "?"] || 0) + 1;
				byStage[t.stage || "?"] = (byStage[t.stage || "?"] || 0) + 1;
			}
			return {
				stages: stageSummaries(pipeline),
				circuit_breaker: pipeline?.circuit_breaker || null,
				tasks_summary: {
					total: list.length,
					by_status: byStatus,
					by_stage: byStage
				}
			};
		},
		presentCall: (args) => presentControlCall("Pipeline status", args)
	}));
}
