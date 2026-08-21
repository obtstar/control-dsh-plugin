# control 任务看板嵌入 DSH GUI（v0.5）可行性设计

> 状态：设计定稿（TASK-009 续）。实现前置依赖源码仓构建工作流（见 §5）。

## 1. 目标与 MVP

control 任务看板（TASK 列表/阶段/状态/审批入口）以 **client module** 形态嵌入 DSH Web UI。

- **MVP（M1+M2）**：侧边栏/面板显示任务列表（task_id/title/stage/status 徽标）+ 绑定会话的任务上下文；只读投影
- **M3**：审批操作入口（approve/reject 按钮，经 host Remote 转发，凭据不进浏览器）
- 非目标：图表/看板拖拽/实时推送（后置）

## 2. 契约映射（dsh-client-modules）

依据 `dsh-client-modules/README.md`：

| DSH 契约 | control 侧实现 |
|---|---|
| 插件包 `exports["./client"]` | control-dsh-plugin 增加 client 半区（前端 bundle），导出 client 模块 |
| `dsh.client` 包元数据 | package.json 声明（host 扫描启用条目 → boot graph `window.__DSH_BOOT__`） |
| Node 半区扫描 + `/plugins` serve | 前端 bundle 由 dsh web 的 webserver 行 serve（源码仓构建产物） |
| `ctx.modules`（client 半区的 Cordis apply） | client 半区注册 UI 面板到侧边栏/设置扩展点（参照现有 `client-ui-*` 包） |

## 3. host 数据通道

浏览器**不得直连 control-api**（凭据泄露面）：数据走 host Remote，仿
`dsh-host-plugin-inventory`（TypertRemoteService + strict 生成描述符）：

- `control/taskList`：返回任务投影（复用 control_task_list 的 HTTP 调用，host 侧 Bearer）
- `control/taskContext(sessionId)`：绑定任务上下文（复用 lib/session.js + pipeline.js）
- `control/taskAction(taskId, action, comment)`：审批操作（M3；host 侧转发 /api/tasks/{id}/action）
- 装配：web-app 组合新增 host Remote 行 + client 行；与 plugin-inventory 同款注册模式

## 4. UI 形态（MVP）

- 侧边栏 section「Control」：任务列表（点击展开详情：stage 徽标/status/审批角色/artifact）
- 绑定提示：当前会话绑定任务高亮 + `control_task_claim` 入口提示
- 数据刷新：进入页面拉取 + 手动刷新（不依赖 v0.4 通知推送，通知仍走会话内消息）

## 5. 构建与验证（关键前置）

client bundle 的注入依赖 **deepseek-harness 源码仓构建工作流**（与已安装版 dsh 不同）：

1. 在 `~/deepseek-harness`（源码 checkout，已存在）新建 client 包（或复用 control-dsh-plugin 的
   client 半区，经 `dsh.client` 元数据声明）
2. `pnpm run dev:web`（源码构建前端）+ client-plugin HMR watcher——AGENTS.md 提醒：
   **改动是否热载须先验证 watcher 在跑**；否则每次改动要重建 web 产物 + 页面刷新
3. 装配验证：`window.__DSH_BOOT__` 含 control client 行；`/plugins/<pkg>/client` 可加载；
   面板渲染任务列表
4. 与已安装版的关系：当前 `dsh web` 跑的是安装包预构建前端；client 面板的开发/验证在
   源码 dev 实例进行，验收后并入发布构建

## 6. 里程碑

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| M0 | 源码仓 dev:web 工作流可用（watcher 验证） | 源码 checkout（已有） |
| M1 | client 半区骨架 + host Remote（taskList/taskContext）| M0 |
| M2 | 侧边栏面板渲染任务列表 + 绑定高亮 | M1 |
| M3 | 审批操作入口（approve/reject 经 host 转发） | M2 |

## 7. 风险

- **前端与 DSH 版本耦合**：client 半区按 rc.8 契约编译，DSH 升级需重编译
- **凭据边界**：任何情况下 token 不出 host 进程（浏览器只调 host Remote）
- **构建链**：源码仓 dev 工作流与本环境"已安装 dsh"并存，需明确验收与发布路径
