// 反向通知（v0.4）：control-api 审批闸状态变化 → 推送到绑定会话的 DSH agent。
// 轮询 /api/approvals/pending 快照 diff（新增/阶段变化的待审批项），对绑定该任务的
// live agent 注入通知（仿 dsh-tool-jobs 的 followup/inject 模式）。
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { requestJson } from "./http.js";
import { allBindings } from "./session.js";

let lastSnapshot = null; // Map<taskId, stage>

// diffSnapshot 返回新增/阶段变化的待审批事件 [{task_id, stage, role}]
function diffSnapshot(pending) {
	const next = new Map();
	const events = [];
	for (const p of Array.isArray(pending) ? pending : []) {
		const key = p.task_id;
		const stage = p.stage || "";
		next.set(key, stage);
		const prev = lastSnapshot ? lastSnapshot.get(key) : undefined;
		if (prev === undefined || prev !== stage) {
			events.push({ task_id: key, stage, role: p.role || "" });
		}
	}
	lastSnapshot = next;
	return events;
}

// deliver 向绑定该任务的 live agent 注入通知（idle → followup 唤醒；否则 inject 下一轮）
function deliver(ctx, taskId, event) {
	const bound = allBindings();
	for (const agent of ctx.agents.list()) {
		if (agent.sessionId && bound[agent.sessionId] === taskId) {
			const text = `control 通知：任务 ${taskId} 进入 ${event.stage} 阶段待审批（审批角色 ${event.role || "—"}），可用 control_task_action approve/reject 处理`;
			const message = createUserMessage({
				content: [{ type: "text", text }],
				source: { kind: "plugin", plugin: "control", form: "notice", summary: `control: ${taskId} 待审批` }
			});
			try {
				if (agent.status === "idle") {
					agent.followup(message);
				} else {
					agent.inject(message);
				}
			} catch (err) {
				console.error(`[control] 通知注入失败 ${taskId}@${agent.sessionId}: ${err.message}`);
			}
		}
	}
}

// startNotifier 注册周期轮询；返回 cordis effect disposer（卸载时 clearInterval）
export function startNotifier(ctx, cfg) {
	if (!cfg.notifyEnabled) return;
	const intervalMs = Math.max(10, cfg.notifyIntervalSec) * 1000;
	ctx.effect(() => {
		const timer = setInterval(async () => {
			try {
				// 无凭据时 authHeader 返回空 → 401，静默跳过（health 可用但审批列表不可达）
				const pending = await requestJson(cfg, "/api/approvals/pending");
				const events = diffSnapshot(pending);
				for (const ev of events) {
					deliver(ctx, ev.task_id, ev);
				}
			} catch (err) {
				// 轮询失败静默（服务未起/凭据缺失），下一轮重试
				if (err.message && err.message.includes("control-api")) {
					console.error(`[control] 通知轮询失败: ${err.message}`);
				}
			}
		}, intervalMs);
		return () => clearInterval(timer);
	}, "control:notify");
}
