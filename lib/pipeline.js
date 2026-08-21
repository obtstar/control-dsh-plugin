// 任务即文档与流水线声明的本地读取（v0.2）
// task.md frontmatter 解析、pipeline.yaml 阶段声明加载（js-yaml）、~ 展开。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

// expandHome 展开 ~ 前缀（control 平台各路径均以 home 相对）
export function expandHome(p) {
	if (!p) return p;
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

// parseTaskMeta 读取任务目录 task.md 的 frontmatter（权威字段：stage/status/repo_key/title）
// 返回 null 当任务不存在或 frontmatter 解析失败。
export function parseTaskMeta(tasksDir, taskId) {
	const file = path.join(expandHome(tasksDir), taskId, "task.md");
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
	const m = /^---\n([\s\S]*?)\n---/.exec(raw);
	if (!m) return null;
	let fm;
	try {
		fm = yaml.load(m[1]) || {};
	} catch {
		return null;
	}
	return {
		task_id: fm.task_id || taskId,
		title: fm.title || "",
		repo_key: fm.repo_key || "",
		domain: fm.domain || "",
		stage: fm.stage || "",
		status: fm.status || "",
		priority: fm.priority || "",
		authority: fm.authority || "",
		// 产物建议：本阶段应产出 report-<stage>.md（与 runner/引擎约定一致）
		artifact: fm.stage ? `report-${fm.stage}.md` : ""
	};
}

// loadPipeline 加载流水线声明（pipeline.yaml），返回 {authority, pause, pipeline, approval, circuit_breaker}
export function loadPipeline(pipelinePath) {
	const file = expandHome(pipelinePath);
	let doc;
	try {
		doc = yaml.load(fs.readFileSync(file, "utf8"));
	} catch (err) {
		throw new Error(`读取流水线声明失败 ${file}: ${err.message}`);
	}
	return doc;
}

// stageSpec 取单个阶段的声明（model/agent/artifact/approval/on_reject/env/quality_gate）
export function stageSpec(pipeline, stageId) {
	if (!pipeline?.pipeline?.stages) return null;
	return pipeline.pipeline.stages.find((s) => s.id === stageId) || null;
}

// stageSummaries 所有阶段的精简摘要（pipeline_status 用）
export function stageSummaries(pipeline) {
	if (!pipeline?.pipeline?.stages) return [];
	return pipeline.pipeline.stages.map((s) => ({
		id: s.id,
		model: s.model || "",
		artifact: s.artifact || "",
		approval: s.approval || "auto",
		on_reject: s.on_reject || ""
	}));
}
