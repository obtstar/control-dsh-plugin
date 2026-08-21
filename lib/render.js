// 工具输出渲染与通用 schema（v0.2 拆模块）
// 注意：value-schema DSL 不支持顶层 required 数组，required 必须内联到属性上。

export function renderJson(args, value) {
	return [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}];
}

export function presentControlCall(title, args) {
	return { card: "generic", title, kind: "control", rawInput: JSON.stringify(args) };
}

// 工具输出声明（与 control-api 响应形状一致；required 内联）
export const healthSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: { type: "string", required: true },
		version: { type: "string" }
	}
};

export const taskIdPathSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		task_id: { type: "string", required: true },
		path: { type: "string", required: true }
	}
};

export const taskActionResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		task_id: { type: "string", required: true },
		stage: { type: "string" },
		status: { type: "string", required: true }
	}
};

export const rowArraySchema = {
	type: "array",
	items: { type: "object", additionalProperties: true, properties: {} }
};
