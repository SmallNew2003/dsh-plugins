# Outcome

为 DSH Desktop 的 Web GUI 增加 git worktree 能力:人类用户在会话界面查看当前分支与工作树、并管理 worktree(列表/新建/删除);agent 通过模型工具使用同一能力。三个纯插件包交付,零上游源码改动。

# Scope

Phase A:只读展示(分支、worktree 判定、脏状态)+ worktree 列表/新建/删除 + 模型工具。目标平台:DSH Desktop(原样运行上游 deepseek-harness);插件同时兼容普通 `dsh web`。

## Source coverage

来源:`docs/design/2026-09-11-git-worktree-phase-a.md`(用户确认的设计文档,完整读取一次)。

| 来源单元 | 读取 | 语义处置 | Spec 位置 | 验收 | 覆盖 |
| --- | --- | --- | --- | --- | --- |
| 背景与目标(Phase A 范围陈述) | complete | 范围陈述 | 全部三个 spec 的总体章节 | A1–A10 | covered |
| 已验证的可行性依据(open-in-app / ui-jobs / tool-jobs 先例) | complete | 背景,不产生独立行为 | — | — | background |
| 总体结构:三个插件包及依赖关系 | complete | 结构约束 | specs/git-host §1、specs/git-ui §1、specs/git-tool §1 | A8 | covered |
| host:依赖与解析(session cwd → 仓库根解析与缓存) | complete | 实现语义 | specs/git-host §2 | A1 | covered |
| host:四条路由(status/worktrees/新建/删除) | complete | 行为语义 | specs/git-host §3 | A3、A4、A5、A6、A7 | covered |
| host:git 命令映射 | complete | 实现语义 | specs/git-host §4 | A2 | covered |
| host:删除保护三条规则 | complete | 行为语义 | specs/git-host §5 | A6、A7 | covered |
| host:错误词汇与 Config 字段 | complete | 行为语义 | specs/git-host §6 | A9 | covered |
| host:SSH 情形(git 同 host 执行不受 SSH 禁用约束) | complete | 行为语义 | specs/git-host §6 | A1 | covered |
| ui:槽位与展示(徽章 + popover 面板) | complete | 行为语义 | specs/git-ui §2 | A1、A2、A3、A5、A6 | covered |
| ui:数据与刷新(打开拉取 + 手动刷新 + TTL 缓存) | complete | 行为语义 | specs/git-ui §3 | A4、A10 | covered |
| ui:文案与降级(双语字典、错误码映射、徽章不渲染条件) | complete | 行为语义 | specs/git-ui §4 | A9、A1 | covered |
| tool:三个工具与保护规则一致 | complete | 行为语义 | specs/git-tool §2 | A8 | covered |
| tool:Phase A 不提供切分支工具 | complete | 非目标 | — | — | non-goal |
| 部署与开发流程(profile/dsh plugin 安装、外部沙箱) | complete | 约束 | Constraints and invariants | — | covered |
| 测试计划 | complete | 验证期望 | Verification expectations | — | covered |
| 待验证点 1–4(host cwd 接口、桌面版 service 可用性、client 鉴权细节、安装形态) | complete | 实现前调查项,不改变用户可见语义 | Build 第一轮核实并记录结论 | — | background |
| Phase C 展望(切分支、分支管理、stash、diff、commit、实时推送) | complete | 非目标 | — | — | non-goal |

# Non-goals

- 切分支(checkout/switch)、分支新建/删除、stash、diff 查看、commit —— 全部属于 Phase C。
- 实时推送(worktree/分支变化的自动通知)—— Phase C 用 upgrade 路由或 SSE。
- 修改 deepseek-harness 或 dsh-desktop 源码;将 git 能力上游化为 Typert Remote 命名空间。
- 插件市场发布与 npm 公开发布命名(第一版本地安装)。

# Acceptance examples

- A1:会话 cwd 属于 git 仓库时,Session header 显示分支名徽章;cwd 非 git 仓库、cwd 不存在或 host 无 git 命令时,徽章不渲染。
- A2:会话 cwd 位于 worktree 时,徽章带 worktree 标记,tooltip 展示 worktree 路径与 main 仓库路径;main checkout 无该标记。
- A3:点击徽章打开面板,列出全部 worktree(路径、分支、main 徽标、脏状态计数,顺序同 `git worktree list`);Escape 与点击面板外部关闭并归还焦点。
- A4:面板每次打开时拉取 status 与 worktrees;面板内手动刷新按钮点击后重新拉取并呈现最新数据。
- A5:面板内新建 worktree:输入名称与分支名(默认同名),路径默认 `<repo 父目录>/<repo 名>-<名称>` 且可修改;成功后新 worktree 出现在列表。
- A6:删除脏 worktree:删除按钮禁用并展示更改摘要;勾选"丢弃更改"后按钮可用,确认后该 worktree 被删除并从列表移除。
- A7:main worktree 与当前会话 workspace 所在 worktree 不提供删除入口;host 对这两类删除请求返回 `git/protected`。
- A8:模型可调用 `git_worktree_list`/`git_worktree_add`/`git_worktree_remove`;调用与结果记录在会话日志;remove 对脏 worktree 且未显式 `discardChanges` 时返回结构化错误且不执行删除。
- A9:全部用户可见文案来自双语字典;host 错误以结构化错误码传递,面板将已知码映射为具体文案,未知码显示通用错误文案。
- A10:status 读取带短 TTL 缓存(TTL 由 host Config 提供);切换会话或关闭后重开面板时重新拉取,呈现当前会话仓库的最新分支。

# Constraints and invariants

- 纯插件:不修改 deepseek-harness 与 dsh-desktop 源码;只使用普通 DSH 插件面(webServer 路由、client 槽位、模型工具),不依赖 Desktop 专用 service,普通 `dsh web` 同样可用。
- 安装进当前运行的 DSH Desktop:profile 配置或 `dsh plugin` 语义;开发调试用外部开发沙箱。
- host 路由要求与 open-in-app 同级的浏览器鉴权与 origin 校验;git 命令经 subprocess 能力执行并带 deadline。
- UI 遵守上游 client 插件纪律:槽位唯一注册通道、组件只见四类 props、产品文案进双语字典、无硬编码 tunables(Config 字段)。
- 工具与路由是同一 host 服务的两个 Consumer:保护规则只有一份实现。
- 不可逆操作(删除 worktree)必须显式确认;丢弃未提交更改必须显式选择,任何路径不得静默丢弃。

# Decisions

- 第一版范围 A(只读 + worktree 增删),终态 C(完整 git 面板)—— 用户 2026-09-11 确认。
- 人与 agent 双入口:模型工具与 UI 并存 —— 用户 2026-09-11 确认。
- 删除保护:脏 worktree 默认拒绝,UI 显式勾选"丢弃更改"后放行 —— 用户 2026-09-11 确认。
- 刷新:面板打开拉取 + 手动刷新,第一版不做推送 —— 用户 2026-09-11 确认。
- 纯插件路线(方案 1),接口按可上游化形态设计 —— 用户 2026-09-11 确认。
- 专用仓库 `dsh-plugins`(个人 DSH 插件 monorepo)承载 —— 用户 2026-09-11 确认。

# Open questions

- [blocking] CONFIRM:目标 = DSH Desktop 内展示会话分支/worktree 并管理 worktree(人 + agent 双入口);范围 = Phase A 的 A1–A10;关键决定 = 三插件包结构、脏 worktree 删除需显式"丢弃更改"、main 与当前 worktree 不可删、刷新为打开拉取 + 手动刷新、纯插件零上游改动、第一版本地安装(包名与发布后定);非目标 = 切分支/分支管理/stash/diff/commit/实时推送(Phase C)。

# Verification expectations

- host:真实临时 git 仓库 fixture(`git init` 成本可忽略);保护规则全覆盖(dirty 拒绝、discardChanges 放行、main 与当前 worktree 拒绝、错误码映射);deadline 与取消路径。
- client:组件测试直喂 props(store 工厂 + 桩数据),断言用户可见行为而非实现细节;jsdom 按上游惯例。
- tool:schema 校验、执行路径;保护规则与 host 共用同一实现,不重复实现。
- Build 第一轮必须核实设计文档"待验证点 1–3"(host 按 sessionId 读会话 cwd 的接口、当前桌面版固定上游版本中所需 service 可用性、client 调用 host 路由的鉴权做法),并记录结论;发现不可用事实时回到 Shape。
