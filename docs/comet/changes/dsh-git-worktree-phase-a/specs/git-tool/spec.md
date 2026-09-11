# git-tool(模型工具)

归档后的完整行为:插件包 `dsh-tool-git-worktree` 向 agent 暴露 worktree 查询与管理工具。

## 1. 包结构与角色

一个工具插件包,注入 host 包 `dsh-git-host` 的 git 服务;工具与路由是同一服务的两个 Consumer,保护规则只有一份实现。

## 2. 工具集

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `git_worktree_list` | 无 | 返回当前会话仓库的全部 worktree(路径、分支、是否 main、脏状态);等价于 UI 列表数据 |
| `git_worktree_add` | name, branch?, createBranch?, startPoint?, path? | 新建 worktree;语义与 host 新建路由一致 |
| `git_worktree_remove` | path, discardChanges? | 删除 worktree;保护规则与 host 删除路由一致:脏且未显式 `discardChanges` 时返回结构化错误(`git/dirty`)并不执行;main 与当前会话所在 worktree 返回 `git/protected` |

- 工具在会话内执行,作用于当前会话 cwd 所在仓库;调用与结果自动记录在会话日志,无需额外 session 事件。
- 工具描述(模型可见文本)为英文,遵循上游工具文本惯例;结果为结构化 JSON,与 host 路由返回形状一致。
- Phase A 不提供切分支工具;工具集不包含任何绕过 §删除保护 的参数。
