# control-dsh-plugin

control 平台 × DeepSeek Harness 集成插件。把 control-api 的任务状态机/审批/审计暴露为
DSH 模型侧工具（`control_*`），配合 web profile 的配置层（Route A：PieKBS MCP 桥 +
control 编排技能），让 DSH 会话成为 control 平台的执行工作台。

C1 执行层迁移后的职责划分：**模型接入走 DSH（dsh-llm），任务执行在 DSH 会话内，
状态机/审批/审计仍在 control-api**。LiteLLM 通道废弃。详见
[docs/execution-migration-C1.md](docs/execution-migration-C1.md)。

## 安装

```bash
# 1) 作为依赖装入目标 profile（web 为例）
dsh plugin --profile web add /home/dev/control-dsh-plugin

# 2) 在 ~/.dsh/profiles/web/cordis.patch.yml 插入插件行
#    - insert:
#        - id: control
#          name: 'control-dsh-plugin'
```

依赖对齐：peerDependencies 与当前 DSH 安装一致（`@deepseek-ai/dsh-tools`/`schemastery`/`cordis`，
rc.8 系列）。

## 认证（环境变量注入，不落盘）

| 变量 | 用途 |
|---|---|
| `CONTROL_API_TOKEN` | 优先：静态 Bearer token（control-api 会话 token） |
| `CONTROL_API_USER` + `CONTROL_API_PASSWORD` | 备选：调 `/api/auth/login` 换取并缓存（24h） |

## 工具

| 工具 | 端点 | 说明 |
|---|---|---|
| `control_health` | GET /actuator/health | 探活 |
| `control_task_create` | POST /api/tasks | 建任务（L1 需求人写；repo_key 须已登记 registry） |
| `control_task_list` | GET /api/tasks | 任务一览 |
| `control_task_action` | POST /api/tasks/{id}/action | approve/reject/pause/resume/deliver |
| `control_task_advance` | POST /api/webhooks/advance | **阶段完成回传**（DSH 执行完阶段产物后调用，任务进审批闸；`X-Webhook-Token` 独立认证，env `CONTROL_ADVANCE_TOKEN`） |
| `control_approvals_list` | GET /api/approvals/pending | 待审批队列（按角色路由） |
| `control_audit` | GET /api/audit | work_log 审计（最近 100 条） |
| `control_findings` | GET /api/findings | FINDINGS.md 问题台账 |
| `control_reconcile` | CLI（spawn） | 对账：文档声明 vs 代码事实（CONFLICT 退出码 1） |
| `control_task_execute` | 本地读 | 阶段执行指引：任务上下文 + pipeline.yaml 阶段规格 + 产物要求 |
| `control_grounding_check` | GET /api/kb/search | 有据可依校验（18.3 语义） |
| `control_pipeline_status` | 本地读 + GET /api/tasks | 流水线声明 + 任务状态分布 |
| `control_task_claim` | 本地状态 | **会话↔任务绑定**：认领/释放（task_id 缺省回落绑定） |
| `control_task_context` | 本地读 | 当前绑定任务的完整上下文 |

> **v0.3 会话绑定**：`control_task_claim` 认领后，`control_task_execute`/`control_task_advance`/
> `control_task_action` 的 `task_id` 可省略自动回落绑定；绑定持久化于
> `~/.dsh/storages/control-session.json`（0600），任务不存在/已交付自动失效。
> 每次回落前重读 task.md 权威状态（文件为准）。

KB 检索不走本插件：由 web profile 的 `@deepseek-ai/dsh-mcp-client` 桥接 PieKBS
（`mcp__piekbs__kb_search` / `kb_add`）。

## 看板（v0.5，内建）

插件在 webServer 服务存在时注册 **`/control/dashboard`**（任务/审批/审计三 tab，深色 UI），
同源代理 `/control/dashboard/api/*`（Bearer 服务端持有，浏览器不经手 token）。

```bash
# dsh-web 重启后生效；打开
#   http://127.0.0.1:3080/control/dashboard
# 独立版 dsh-board.service 已废弃移除（被内建版取代）
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8765` | control-api 地址 |
| `tokenEnv` / `usernameEnv` / `passwordEnv` | `CONTROL_API_*` | 凭据环境变量名 |
| `advanceTokenEnv` | `CONTROL_ADVANCE_TOKEN` | advance webhook 共享密钥环境变量 |
| `controlBin` | `~/control-api/control-api` | control-api 二进制（reconcile） |
| `tasksDir` | `~/control-center/tasks` | 任务目录（任务即文档） |
| `pipelinePath` | `~/control-center/orchestration/workflows/pipeline.yaml` | 流水线声明 |
| `timeoutMs` | 15000 | 单请求超时 |

## 路线图

- [x] v0.1 工具桥（Route B，7 工具）
- [x] Route A 配置层：PieKBS MCP + control 技能（web profile patch，宿主平面）
- [x] P1：`control_task_advance` + control-api advance 桥（TASK-003）
- [x] P1 收尾：pi 执行器退役 + LiteLLM 死代码清理 + grounding 迁 Advance 入口（TASK-004）
- [x] P2：蒸馏技能化——wiki-distill 技能 + FINDING-052 purge 兼容修复（TASK-005/006，OAS 5 页演示可检索）
- [x] v0.2 执行面工具（reconcile/task_execute/grounding_check/pipeline_status，TASK-009）+ 末段技能（merge-review/deliver-archive）
- [x] v0.3 会话↔任务绑定（claim/context，task_id 回落 + 持久化）
- [ ] v0.4 反向通知（状态变化推送到 DSH 会话）
- [x] v0.5 看板：内建 /control/dashboard（同源代理，凭据不进浏览器），独立 dsh-board 服务已移除
