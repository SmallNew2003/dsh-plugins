# git-ui(浏览器侧徽章与面板)

归档后的完整行为:插件包 `dsh-client-ui-git` 在 Web GUI 中呈现会话的 git 状态徽章与 worktree 管理面板。

## 1. 包结构与角色

一个 client UI 插件包,依赖 host 包 `dsh-git-host` 的路由数据;遵守上游 client 插件纪律:槽位唯一注册通道、组件只见四类 props 共享、共享/存活状态用 register 声明的 store、产品文案全部来自双语字典。

## 2. 徽章与面板

- 徽章注册于 `conversation.session.header.actions`:显示当前分支名(A1);会话 cwd 位于 worktree 时附加树形标记,tooltip 展示 worktree 路径与 main 仓库路径(A2);A1 的不渲染条件在此执行:非 git 仓库、cwd 缺失、host 无 git、host 路由不可达时徽章完全不出现。
- 点击徽章打开 popover 面板(A3):
  - worktree 列表:每行显示路径、分支、main 徽标、脏状态计数;脏状态未检查的行显示"未知"而非 0;
  - 新建表单:名称与分支名(默认同名),路径默认 `<repo 父目录>/<repo 名>-<名称>` 且可修改;提交调用新建路由,成功后新行出现(A5);
  - 删除:脏 worktree 的删除按钮禁用并展示更改摘要(计数 + 至多前 10 个更改路径);勾选"丢弃更改"后按钮可用,再次确认后执行(A6);main 与当前会话所在 worktree 不渲染删除按钮(A7);
  - Escape 与点击面板外部关闭面板,焦点归还触发器。

## 3. 数据与刷新

- 面板每次打开时拉取 status 与 worktrees(A4);面板内提供手动刷新按钮,点击重新拉取。
- status 结果按 host 提供的 TTL 语义短缓存;切换会话或关闭后重开面板时重新拉取,呈现当前会话仓库的最新分支(A10)。
- Phase A 不订阅任何推送;所有更新由打开/刷新触发。

## 4. 文案与降级

- 全部产品文案(徽章 tooltip、面板标题、按钮、错误提示、确认文案)来自双语 locale 字典,经标准 `t` 或本地化 props;用户数据(路径、分支名)原样展示。
- host 结构化错误码映射:已知码(`git/dirty`、`git/protected`、`git/not-repo` 等)映射为具体文案;未知码显示通用错误文案并保留 detail(A9)。
