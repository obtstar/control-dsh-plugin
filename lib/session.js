// 会话↔任务绑定（v0.3）
// DSH 会话"认领"一个 control 任务后，工具调用自动带任务上下文（task_id 缺省回落）。
// 状态：内存 Map + 持久化 <dshHome>/storages/control-session.json（原子写，0600）。
// 有效性：每次回落前重读 task.md 权威状态；任务不存在/已 delivered 自动失效清绑定。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTaskMeta } from "./pipeline.js";

let cache = null; // { bindings: { [sessionKey]: taskId } }

function storageFile() {
	const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
	return path.join(home, "storages", "control-session.json");
}

function load() {
	if (cache) return cache;
	try {
		const raw = fs.readFileSync(storageFile(), "utf8");
		const doc = JSON.parse(raw);
		cache = { bindings: doc && typeof doc.bindings === "object" ? doc.bindings : {} };
	} catch {
		cache = { bindings: {} };
	}
	return cache;
}

function persist() {
	if (!cache) return;
	try {
		const file = storageFile();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
		fs.renameSync(tmp, file);
	} catch (err) {
		// 持久化失败不阻断调用：内存态仍生效，下轮重试
		console.error(`[control] 会话绑定持久化失败: ${err.message}`);
	}
}

// sessionKey 工具执行所属的会话身份；无 agent（非会话上下文）回落默认键
export function sessionKey(exec) {
	return exec?.agent?.sessionId || "default";
}

// getBinding 返回会话绑定的 task_id（可能为空串）
export function getBinding(exec) {
	const key = sessionKey(exec);
	return load().bindings[key] || "";
}

// setBinding 设置（taskId 为空串即释放）并持久化
export function setBinding(exec, taskId) {
	const key = sessionKey(exec);
	if (taskId) {
		load().bindings[key] = taskId;
	} else {
		delete load().bindings[key];
	}
	persist();
}

// resolveTaskId 显式参数优先，否则回落会话绑定；绑定任务已失效自动清理。
// 返回空串表示无可用 task_id（调用方按缺参报错/提示认领）。
export function resolveTaskId(cfg, exec, explicit) {
	if (explicit && explicit !== "none") return explicit;
	const key = sessionKey(exec);
	const bound = load().bindings[key];
	if (!bound) return "";
	const meta = parseTaskMeta(cfg.tasksDir, bound);
	if (!meta || meta.status === "delivered") {
		delete load().bindings[key];
		persist();
		return "";
	}
	return bound;
}

// allBindings 返回 {sessionId: taskId} 视图（反向通知按会话查任务用）
export function allBindings() {
	return { ...load().bindings };
}
