# C1 执行层迁移设计：废弃 control 的 LiteLLM，模型接入统一走 DSH

> 状态：设计稿（2026-08-21）。落地前按 control 规约开 TASK、出 L2/L3 设计并过审批。
> 本文档是 control-dsh-plugin 集成的演进方向（Route C），不是对 L1–L4 权柄文档的修改。

## 1. 背景与目标

control 平台目前的模型通道是自建 LiteLLM 网关（`llm.endpoint: http://litellm.internal:4000`）。
当前该网关 DNS 不可达、蒸馏未启用（FINDING-017/050），control-api 的 `pi` 执行器实际已无法
驱动任务阶段。DSH（DeepSeek Harness）自带完整模型接入（`dsh-llm` 适配器 + settings.yaml
providers + 会话级模型选择），且本机已运行 web GUI。

**目标**：废弃 control 的 LiteLLM 通道；模型请求统一经 DSH 出口（密钥仍走环境变量，不落盘）。

**关键事实**：DSH **不对外暴露 OpenAI 兼容的 HTTP 端点**——模型接入只在 DSH 进程内
（`dsh-llm`），浏览器面是 `/api` RPC 网关（`dsh-host-apiproxy`），不是模型 API。因此
「直接集成使用 dsh」≠「把 control-api 的 base_url 指到 DSH」，而是**执行层迁移**：
任务阶段在 DSH 会话内执行，control-api 保留状态机/审批/审计职责。

## 2. 现状盘点

| 组件 | 现状 | 迁移后 |
|---|---|---|
| control-api `internal/agent`（pi/fake-pi 执行器） | 每阶段拉起 `pi --print`（Node 编码代理，自带模型配置）执行 | **可选退役**：DSH 会话可替代 pi 执行阶段；pi 本身可继续作为阶段执行器 |
| control-api.yaml `llm` 段（endpoint/api_key/models） | `LLMConfig` **运行时零消费方**（config.go:31 注释："APIKey 运行时无消费方，仅占位"）——LiteLLM 已是死代码 | 删除该段 + `internal/config` LLMConfig 清理（纯死代码清理，无行为变更） |
| control-api 状态机/审批/审计（engine/store） | 权威 | 保留不动，仍是唯一裁决方 |
| PieKBS 蒸馏（internal/distill） | token 空 + 网关不可达，已停 | 蒸馏改由 DSH 侧完成（见 §4） |
| DSH web GUI | 已运行（127.0.0.1:3080） | 成为 control 的**执行工作台**（可选替代 pi） |

## 3. 方案：DSH 执行、control-api 裁决

### 3.1 职责切分

```
人（需求/审批/合并）──┬── DSH 会话（执行层）          control-api（裁决层）
                      │    plan mode = 设计闸              状态机：stage/status
                      │    subagent/workflow = 阶段执行     审批：角色路由 + work_log 审计
                      │    产物落任务目录（task.md 旁）     对账：reconcile
                      │    control_task_advance → 阶段完成
                      └── control_task_action(approve/reject/pause/resume/deliver)
```

- 每阶段一道审批闸不变：DSH 执行完阶段 → 调 advance 桥 → control-api 置 `awaiting_approval`
  并生成审批队列 → 人在 DSH 会话（或 control-web）里 approve/reject。
- DSH 侧用 `ctx.approval`（ask→deny）做执行内交互审批，但**权威裁决仍是 control-api**。

### 3.2 advance 桥（已实现，TASK-003，2026-08-21）

- `POST /api/webhooks/advance`：body `{task_id, artifact?}`，复用 webhook 模式
  （webhook.go：`X-Webhook-Token` 与 `server.webhook_secret` 常量时间比较，FINDING-003 同款）；
- 状态守卫：仅 `pending/running` 可 advance；`paused`（暂停禁一切写）/`awaiting_approval`/
  `delivered` → 409；任务不存在 404；secret 未配置 503；
- `engine.Advance` 复用：置 `Stage=First()`（若空）、末阶段→delivered、需审批阶段→
  awaiting_approval+审批队列、auto 阶段→下一阶段；
- 契约同步：`docs/api/openapi.yaml` 增 `/webhooks/advance` + AdvanceEvent 两个 schema，
  contract_test.go 双向对账全绿（10 用例）；
- **执行器退役（TASK-004 完成）**：`internal/agent` 包、`engine.Runner`/maybeRun/
  handleRunFailure、RetryLoop（FINDING-027）与 config 的 `llm`/`agent` 段全部移除；
  18.3 grounding 检查点迁至 `Advance` 入口（enforce 无据仍自动暂停）；
- 配套：control-dsh-plugin `control_task_advance`（`CONTROL_ADVANCE_TOKEN` 环境变量）。

### 3.3 control-api 执行器/配置退役（✅ 已随 TASK-004 完成）

- `LLMConfig`（`llm` 段）运行时零消费方 → 已删除（结构/默认值/env 覆盖/脱敏引用 + control-api.yaml llm 段）；
- `internal/agent` 包、`engine.Runner`/`maybeRun`/`handleRunFailure`、`RetryLoop`/`RetryOnce`
  （FINDING-027，依赖 pi 失败语义）→ 已删除；config `agent` 段一并移除；
- 18.3 KB grounding 语义保留：检查点从执行前（maybeRun）迁至 `Advance` 入口
  （enforce 无据/不可达 → 自动暂停 + advance 409 返回 NO_BASIS 原因；warn 记 work_log 继续）；
- `RecoverOnBoot`（FINDING-043：running → paused 留痕）保留，resume 后置 running 重新等 DSH；
- 回退：git 历史保留全部旧代码；如需恢复 pi 执行路径，从历史还原 `internal/agent` 与配置段即可。

## 4. PieKBS 蒸馏迁移（✅ 已交付，TASK-005/006，2026-08-21）

蒸馏已由 DSH 会话承担：新增 `wiki-distill` 技能（orchestration/skills/domain/，
Route A 自动可见），定义「读 raw → 按 schema/templates/source-note.md 生成 → 写
wiki/source-notes/ → watcher 重建 FTS → kb_search 验证」工作流，含大文档分段规则。
`internal/distill`（Go）保留但不启用（config.yaml `distill.token` 空）。

**FINDING-052 配套修复（TASK-006）**：PurgeOrphanWikiFiles 原按 stem 判据（假定 1:1
蒸馏）会误删多页蒸馏产物；已改为 sources 感知——页面前置元数据 `sources` 任一条目指向
存在的 raw 文件即非孤儿（okf.go noteHasLiveSource + 单测 3 用例，二进制重建并 systemd
重启）。

演示：raw/converted/oas/v3.1.0.md（OAS 3.1.0 规范，152K 技术规范）蒸馏为
wiki/source-notes/control-api-openapi/ 5 页（01-overview + 02/03 对象目录 + 04 扩展附录
+ OKF index），kb_search 实测命中。

## 5. 审批闸与权柄在 DSH 侧的表达

- 执行内约束：control 技能（`authority-check`/`grounding-check`/`branch-guard`/`secret-scan`）
  已作为 DSH 技能可用（Route A），阶段出口由模型按技能执行；
- 交互审批：`ctx.approval` 的 ask 语义兜底「写操作前问人」；
- 权威审批：`control_task_action`（approve/reject）走 control-api 角色路由（admin 通吃），
  驳回必须附批注（engine 校验），测试驳回打回 coding（pipeline on_reject）。

## 6. 落地顺序

| 序 | 事项 | 状态 |
|---|---|---|
| P0 | control-dsh-plugin 工具桥（v0.1，7 工具） | ✅ 已交付 |
| P0 | Route A：MCP + 技能配置（web profile patch 热载） | ✅ 已交付 |
| P1 | advance 桥 + control_task_advance（TASK-003） | ✅ 已交付（契约/测试/reconcile 全绿） |
| P1 | 执行器退役：internal/agent/LLMConfig/RetryLoop 移除，grounding 迁 Advance（TASK-004） | ✅ 已交付（build/test/reconcile 全绿，E2E 回归通过） |
| P2 | 蒸馏技能化：wiki-distill 技能 + FINDING-052 purge 兼容修复（TASK-005/006） | ✅ 已交付（5 页演示产物可检索） |
| P2 | control-web 规划以 DSH client module 形态收敛（可选） | ⏳ 待办 |

## 7. 风险与回退

- **执行痕迹**：阶段执行日志在 DSH 会话（~/.dsh/sessions），control-api work_log 只记
  流转（advance/approve/…）。审计口径变化需在 TASK 设计中明确。
- **回退**：git 历史完整保留 pi 执行器代码；如需恢复，从历史还原 `internal/agent`、
  `maybeRun`/`RetryLoop` 与 config 的 `llm`/`agent` 段（改动均在 TASK-003/004 两个 commit 内）。
- **权限**：advance 桥与 merge webhook 同级——泄漏 `webhook_secret` 可伪造阶段完成，
  密钥只走环境变量，不落 Git（与现 webhook 同策略）。
