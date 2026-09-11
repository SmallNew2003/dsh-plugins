# git-host(host 侧 git 服务与路由)

归档后的完整行为:插件包 `dsh-git-host` 在 host 进程内提供 git 查询与 worktree 管理服务,经 webServer 路由暴露给浏览器,经服务面暴露给模型工具。

## 1. 包结构与角色

一个 host 插件包,内部两层:git 域服务(命令执行、解析、保护规则)与路由 Consumer。UI 包与工具包是同一服务的另外两个 Consumer;本包不依赖任何 Desktop 专用 service,普通 `dsh web` 组合同样可用。

## 2. 会话解析与缓存

- 按 `sessionId` 解析会话工作目录(cwd,来自 host 侧 session 摘要;具体接口在 Build 第一轮核实并记录)。
- 由 cwd 向上解析仓库根:`git -C <cwd> rev-parse --show-toplevel` 取当前 worktree 根,`rev-parse --git-common-dir` 取 main 仓库标识;一次解析、进程内缓存,以路径失效。
- cwd 不存在返回 `git/missing-dir`;目录不是 git 仓库返回 `git/not-repo`;git 命令不在 PATH 返回 `git/unavailable`。

## 3. 路由

全部路由要求与 open-in-app 同级的浏览器鉴权与 origin 校验,并校验 sessionId 归属。

| 路由 | 行为 |
| --- | --- |
| `GET /git/status?sessionId=` | 返回:{ branch(分离 HEAD 时为 `HEAD` + 短 sha)、isWorktree、worktreePath、mainRepoPath、dirtyCount } |
| `GET /git/worktrees?sessionId=` | `git worktree list --porcelain` 投影数组:{ path、branch、head、isMain、dirtyCount };顺序同 git 输出 |
| `POST /git/worktrees?sessionId=` | body { name, branch, createBranch?, startPoint?, path? };执行 `git worktree add`;成功返回新建行;路径冲突、分支冲突透传为 `git/command-failed` 携带 stderr 摘要 |
| `DELETE /git/worktrees?sessionId=&path=&discardChanges=` | 删除指定 worktree,受 §5 保护规则;成功返回删除确认 |

## 4. git 命令映射

- 脏状态:`git -C <path> status --porcelain` 非空行数即 dirtyCount。
- worktree 列表的脏检查逐个执行,受 Config `dirtyCheckLimit` 限制:超出上限的 worktree 不计脏状态并以 `dirtyChecked: false` 标注,UI 显示为未知而非零。
- 新建:`git -C <mainRepoPath> worktree add [-b <branch>] [<startPoint>] <path>`。
- 删除:`git worktree remove <path>`;仅当请求显式 `discardChanges=true` 时追加 `--force`。
- 每个 git 命令经 subprocess 能力执行,deadline 取 Config `commandTimeoutMs`;超时/取消返回 `git/command-failed` 并注明原因。

## 5. 删除保护(不可绕过)

1. 目标 worktree dirtyCount > 0 且请求未带 `discardChanges=true` → 拒绝(`git/dirty`),附更改摘要(计数 + 至多前 10 个更改路径)。
2. main worktree 拒绝删除(`git/protected`);当前会话 workspace 所在 worktree 拒绝删除(`git/protected`)。UI 不提供入口,host 再次拒绝 —— 双保险,规则在服务层执行,路由与工具都无法绕过。
3. `discardChanges=true` 但实际无更改 → 照常删除,不视为错误。

## 6. 错误词汇与配置

- 结构化错误码:`git/unavailable`、`git/not-repo`、`git/missing-dir`、`git/dirty`、`git/protected`、`git/command-failed`(携带 stderr 摘要与退出码)。错误体为 JSON:{ code, message, detail? }。
- Config(全部经 cordis Config 校验,无硬编码 tunables):`commandTimeoutMs`(单个 git 命令 deadline,必填)、`dirtyCheckLimit`(脏检查 worktree 数上限,必填)、`statusCacheTtlMs`(status 缓存 TTL,必填)。
- SSH 情形:git 与会话同 host 执行,不受 open-in-app 的 SSH 禁用规则约束;仅 cwd 不可达时按 `git/missing-dir` 降级。
