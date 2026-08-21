# control-dsh-plugin 深度集成后续设计要点（v0.3+）

> 状态：设计要点（下阶段执行）。关联 TASK-009。

## 1. 会话 ↔ 任务绑定（v0.3 首选）

**目标**：DSH 会话"认领"一个 control 任务后，工具调用自动带任务上下文，产物自动落
任务目录、advance 自动引用，不再逐次手传 task_id。

**设计**：
- 插件内维护会话级状态：`Map<sessionId, {taskId}>` + 持久化（`~/.dsh/storages/control-session.json`，
  跟随 `dshHomePath` 解析；写入走原子写 + 0600）；
- 新工具 `control_task_claim(task_id?)`：认领/释放（`claim=none`）；`control_task_context()`
  返回当前会话绑定任务的完整上下文（任务目录/阶段/产物要求）；
- 改造：`control_task_execute`/`control_task_advance`/`control_task_action` 的 `task_id`
  参数在缺省时回落会话绑定值；
- 产物路径约定：`<tasks_dir>/<TASK-id>/report-<stage>.md`（与 control-api runner 产物
  命名一致，FINDING-020 同口径）；
- 生命周期：会话结束/重启后绑定持久化保留；任务 delivered/删除后绑定自动失效。

**风险**：会话状态与任务状态可能漂移（人在别处推进任务）；每次工具调用前重读 task.md
权威状态（parseTaskMeta），以文件为准。

## 2. 反向通知（v0.4）

**目标**：control-api 状态变化（新待审批/暂停/熔断/merge 回传）推送到 DSH 会话，消除
主动轮询。

**设计**：
- 插件注册周期任务（`cordis-plugin-timer` 或 `setInterval`，间隔可配，默认 60s）：轮询
  `control_approvals_list` + `control_audit`（增量游标），diff 出新增事件；
- 注入通道：仿 `dsh-tool-jobs` 的 `onJobDone → owner.followup/inject` 模式，向绑定会话
  的 agent 注入 UserMessage（`source.kind='plugin'`），忙会话下一轮可见、闲会话唤醒
  （wakeup 语义需研究 dsh-agent 的 inbox 接口）；
- 事件去重：按 work_log id 游标 + 会话内已通知集合；
- 配置：`notify.enabled` / `notify.intervalSec` / `notify.onlyBound`（默认仅绑定会话）。

**前置研究**：dsh-agent 的 `agent.inbox` / `owner.followup` 精确接口（dsh-tool-jobs 是
现成参考实现）；轮询与 HMR 卸载的清理。

## 3. UI client module（v0.5，设计已定稿 → docs/ui-client-module.md）

**状态**：可行性设计已交付（client 半区契约映射 + host Remote 数据通道 + M0-M3 里程碑）。
实现前置：deepseek-harness 源码仓 dev:web 构建工作流（client bundle 注入 boot graph）。

**目标**：control 任务看板（TASK 列表/审批闸/状态机）嵌入 DSH GUI。

**设计**：
- 按 `dsh-client-modules` 契约实现 control 面板：`window.__DSH_BOOT__` roster 装配、
  client 半区注册到 `dsh-client-runtime`；
- 数据源：复用 host `pluginInventory` 同款 Typert Remote 模式——插件新增
  `control/task-list` 等 Remote（挂 `ctx.apiProxy` 或独立 TypertRemoteService），
  前端只读投影，不直连 control-api（避免在浏览器暴露凭据）；
- 装配：web profile 增加 client-module 行 + host Remote 行；前端产物需随
  `pnpm run dev:web` 重建（AGENTS.md：client-plugin 改动依赖 watcher 重建验证）；
- 范围裁剪：MVP 只做"任务列表 + 状态/阶段徽标 + 审批操作入口"，看板/图表后置。

**前置**：通读 `dsh-client-modules` 契约与现有 client-ui-* 包装配示例；确认 dsh web
前端 bundle 的注入方式（distIndex/webserver 行）。

## 4. 其他候选

- `control_task_execute` 与 skills 联动：按 pipeline 声明自动选择 stage 技能
  （requirements→analysis、design→design、coding→coding、merge→merge-review…）；
- `control_wiki_ingest`：业务资料入 KB（kb_add 封装 + 蒸馏技能联动）；
- 熔断/预算感知：token 用量回传（pi 时代未实现，FINDING-027 留白）——DSH token-meter
  投影到任务 work_log 的可行性。
