# DSH Git Worktree 插件设计 —— Phase A

> 状态:待用户评审。本文是设计文档,不是实现计划。
> 目标平台:DSH Desktop(anywhere-labs/dsh-desktop,原样运行上游 deepseek-harness)。

## 背景与目标

DSH Desktop 固定并原样运行特定上游 deepseek-harness 版本,扩展一律走 DSH 插件机制。本功能为 Web GUI 增加当前会话的 git 分支与工作树(worktree)展示,以及 worktree 的增删查;人类用户在界面上操作,agent(模型)通过工具使用同一能力。

**Phase A 范围(本文)**:只读展示(分支、worktree 判定、脏状态)+ worktree 列表/新建/删除。
**Phase C 展望(不在本文范围)**:切分支、分支增删、stash、diff 查看、commit、实时推送。

**硬约束**:纯插件,零上游源码改动;直接安装进当前运行的 DSH Desktop;接口按将来可上游化为 capability seam 的形态设计。

## 已验证的可行性依据

- host 侧插件可用 `ctx.webServer.register(route)` 注册具名 HTTP 路由,先例:`@deepseek-ai/dsh-host-open-in-app`(三条路由,自带浏览器鉴权与 origin 校验;其 README 记录了"为什么用 raw webServer routes 而不是 Typert Remote"的决策)。
- client 侧插件可用框架槽位注册 UI,先例:`@deepseek-ai/dsh-client-ui-open-in-app`(Session header 按钮 + 页面生命周期 controller fetch host 路由)、`@deepseek-ai/dsh-client-ui-jobs`(Session header 动作 + popover 列表)。
- 模型工具是标准插件,先例:`dsh-tool-jobs`;工具调用自动进会话日志,无需额外 session 事件。
- dsh-desktop 插件开发文档明确认可该路径:"有浏览器界面的插件应使用普通 DSH Web routes、RPC、client metadata、service 和 slot",并配套 `dsh plugin` 安装语义与外部开发沙箱。

## 总体结构:三个插件包

| 包 | 角色 | 模板 |
| --- | --- | --- |
| `dsh-git-host` | host 侧:git 命令执行 + webServer 路由 | `dsh-host-open-in-app` |
| `dsh-client-ui-git` | 浏览器侧:header 徽章 + worktree 面板 | `ui-open-in-app` + `ui-jobs` |
| `dsh-tool-git-worktree` | 模型工具:worktree 列表/新建/删除 | `dsh-tool-jobs` |

依赖关系:`dsh-git-host` 对外提供 git 服务(Cordis service,路由与工具都是它的 Consumer);UI 包与工具包可以独立于彼此安装,但都要求 host 包在场 —— UI 缺席时徽章与面板不出现,host 独立提供路由;工具缺席时模型看不到工具;host 缺席时 UI 与工具因服务未就绪而显式失败(配置错误大声失败,不静默)。

## dsh-git-host 设计

### 依赖与解析

- 注入 service:`webServer`、`subprocess`,以及 host 侧 session 摘要查询(按 `sessionId` 解析会话 cwd;具体接口在实现计划阶段从 `dsh-host-open-in-app` 源码确认,见"待验证点")。
- 由会话 cwd 解析 git 仓库根(`git -C <cwd> rev-parse --show-toplevel` 与 `--git-common-dir`),一次解析、进程内缓存,以路径失效。

### 路由(全部要求会话归属与浏览器鉴权,同 open-in-app)

| 路由 | 语义 |
| --- | --- |
| `GET /git/status?sessionId=` | 当前分支、是否 worktree、worktree 路径、main 仓库路径、脏状态计数 |
| `GET /git/worktrees?sessionId=` | `git worktree list --porcelain` 投影:路径、分支、head、是否 main、脏状态 |
| `POST /git/worktrees?sessionId=` | 新建 worktree(body:path、branch、createBranch) |
| `DELETE /git/worktrees?sessionId=&path=&discardChanges=` | 删除 worktree,受下述保护规则约束 |

### git 命令映射

- status:`rev-parse --abbrev-ref HEAD`(分支;detached HEAD 返回 `HEAD` 加短路 sha)、`rev-parse --git-common-dir`(worktree 判定)、`status --porcelain`(脏计数)。
- worktrees:`worktree list --porcelain`;脏状态逐个 `status --porcelain`,默认只检查前 N 个(configurable)防止大列表卡顿。
- 新建:`worktree add <path> [-b <branch>] <start-point?>`。
- 删除:`worktree remove <path>`;仅当请求显式 `discardChanges=true` 时加 `--force`。

### 删除保护(已拍板)

1. 目标 worktree `status --porcelain` 非空且请求未带 `discardChanges=true` → 拒绝(409),返回脏更改摘要;UI 据此禁用删除并展示"丢弃更改"显式勾选。
2. 永不删除 main worktree;永不删除当前会话 workspace 所在的 worktree(git 本身也拒绝删 main,应用层同样拒绝,双保险)。
3. `discardChanges=true` 但实际无更改 → 照常删除,不视为错误。

### 错误词汇与配置

- 结构化错误码:`git/unavailable`(git 不在 PATH)、`git/not-repo`、`git/missing-dir`、`git/dirty`、`git/protected`、`git/command-failed`(携带 stderr 摘要)。
- Config 字段(遵守 no-hardcoded-tunables):`commandTimeoutMs`(单个 git 命令 deadline)、`dirtyCheckLimit`(脏检查的 worktree 数上限)、`statusCacheTtlMs`(status 缓存,避免连续点击打爆子进程)。
- SSH 情形:git 与会话同 host 执行,不受 open-in-app 的 SSH 禁用规则约束;cwd 不存在时返回 `git/missing-dir`。

## dsh-client-ui-git 设计

### 槽位与展示

- 徽章注册在 `conversation.session.header.actions`:显示分支名;处于 worktree 时加树形标记,tooltip 显示 worktree 路径与 main 仓库路径。
- 点击打开 popover 面板(对齐 `ui-jobs` 的交互:Escape 与外部点击关闭、焦点返回触发器):
  - worktree 列表:路径、分支、main 徽标、脏状态徽标(数字);
  - 新建表单:worktree 名称与分支名,默认同名;路径默认 `<repo 父目录>/<repo 名>-<名称>`,可改;
  - 删除:脏 worktree 禁用删除按钮并展示更改摘要,勾选"丢弃更改"后可删(对应 host 的 `discardChanges`)。

### 数据与刷新(已拍板)

- 面板打开时拉取 status + worktrees;面板内提供手动刷新按钮。第一版不做自动推送(Phase C 用 upgrade 路由或 SSE)。
- status 结果带短 TTL 缓存,徽章在会话切换与面板关闭后再打开时重新拉取。

### 文案与降级

- 全部产品文案进双语 locale 字典,经标准 `t` 或本地化 props(`verify-client-ui-i18n` 级别的约束在插件项目内自查)。
- 非 git 仓库、git 缺失、会话无 cwd:徽章不渲染;面板内错误以结构化错误码映射文案,未知码回退通用文案。

## dsh-tool-git-worktree 设计

- 工具:`git_worktree_list`(无参,作用于当前会话 cwd 所在仓库)、`git_worktree_add(path, branch?, createBranch?, startPoint?)`、`git_worktree_remove(path, discardChanges?)`。
- 删除的保护规则与 host 路由完全一致(同一实现,工具与路由是同一 host 服务的两个 Consumer);脏 worktree 且未显式 `discardChanges` 时返回结构化错误,模型转述给用户,由用户在面板或指示模型二次调用完成。Phase A 不给模型 `discardChanges` 之外任何绕过手段。
- Phase A 不提供切分支工具。

## 部署与开发流程

- 安装:通过 profile 配置或 `dsh plugin` 语义安装进 DSH Desktop;三个包都是普通 DSH 插件,不依赖 Desktop 专用 service(兼容普通 `dsh web`)。
- 开发:使用 dsh-desktop 文档描述的外部开发沙箱(普通 `dsh web` 镜像)调试,构建用 `desktopPnpm.run` 保持打包工具链权威。

## 测试计划

- host:git 命令封装与路由 handler 用真实临时 git 仓库 fixture(`git init` 成本可忽略);保护规则全覆盖:dirty 拒绝、`discardChanges` 放行、main/当前 worktree 拒绝、错误码映射;超时与取消。
- client:组件测试直喂 props(store 工厂 + 桩数据),断言用户可见行为;jsdom pragma 按上游惯例。
- tool:schema 校验、执行路径、保护规则复用 host 测试。
- 快照:模型可见的工具 schema/结果文本钉住(参照上游 snapshot 精神,形式从简)。

## 待验证点(实现计划阶段落实)

1. host 侧按 `sessionId` 读取 session 摘要 cwd 的确切 service 接口(从 `dsh-host-open-in-app` 源码确认)。
2. 当前桌面版固定的上游版本中 `webServer`/`subprocess`/session 查询 service 的可用性与签名(桌面按 profile 挂上游 bundle,大概率完整,但以运行中的版本为准)。
3. client fetch host 路由的鉴权细节(`ui-open-in-app` controller 的现成做法)。
4. 桌面版插件安装的最终形态:profile 配置行 vs `dsh plugin` CLI vs 未来插件市场。

## Phase C 展望(接口不阻碍)

切分支(需要 agent 空闲检测与审批接入)、分支管理、stash、diff 查看、commit;实时推送经 `registerUpgrade` 或 SSE;若上游社区接受,可将 `dsh-git-host` 的服务面提升为 deepseek-harness 的 git capability seam(Service Definition / Provider / Consumer)与 Typert Remote 命名空间。