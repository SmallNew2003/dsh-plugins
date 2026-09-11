/** git-worktree namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'git-worktree'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'badge.tooltip.repo': '当前分支：{branch}',
  'badge.tooltip.worktree': '当前分支：{branch}\nworktree：{worktreePath}\n主仓库：{mainRepoPath}',
  'panel.title': 'Git 工作树',
  'panel.refresh': '刷新',
  'panel.main.badge': '主',
  'panel.dirty.unknown': '未知',
  'panel.dirty.count': '{count} 个更改',
  'panel.dirty.summary': '{count} 个未提交更改：{paths}',
  'panel.delete': '删除',
  'panel.delete.discard': '丢弃更改',
  'panel.delete.disabled.main': '主工作树不可删除',
  'panel.delete.disabled.current': '当前会话所在工作树不可删除',
  'add.name': '名称',
  'add.branch': '分支',
  'add.branch.same': '与名称相同',
  'add.path': '路径',
  'add.submit': '创建',
  'add.creating': '创建中…',
  'error.generic': '操作失败：{message}',
  'error.git/dirty': '工作树存在未提交更改；勾选“丢弃更改”后重试。',
  'error.git/protected': '该工作树受保护，无法删除。',
  'error.git/not-repo': '当前会话目录不是 git 仓库。',
  'error.git/missing-dir': '当前会话没有可用的工作目录。',
  'error.git/unavailable': '宿主机上没有可用的 git 命令。',
  'error.git/command-failed': 'git 命令执行失败。',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<GitKey, string> = {
  'badge.tooltip.repo': 'Branch: {branch}',
  'badge.tooltip.worktree': 'Branch: {branch}\nWorktree: {worktreePath}\nMain repo: {mainRepoPath}',
  'panel.title': 'Git worktrees',
  'panel.refresh': 'Refresh',
  'panel.main.badge': 'main',
  'panel.dirty.unknown': 'unknown',
  'panel.dirty.count': '{count} changes',
  'panel.dirty.summary': '{count} uncommitted changes: {paths}',
  'panel.delete': 'Delete',
  'panel.delete.discard': 'Discard changes',
  'panel.delete.disabled.main': 'The main worktree cannot be removed',
  'panel.delete.disabled.current': 'The session workspace worktree cannot be removed',
  'add.name': 'Name',
  'add.branch': 'Branch',
  'add.branch.same': 'Same as name',
  'add.path': 'Path',
  'add.submit': 'Create',
  'add.creating': 'Creating…',
  'error.generic': 'Operation failed: {message}',
  'error.git/dirty': 'The worktree has uncommitted changes; tick "Discard changes" and retry.',
  'error.git/protected': 'This worktree is protected and cannot be removed.',
  'error.git/not-repo': 'The session directory is not a git repository.',
  'error.git/missing-dir': 'The session has no usable working directory.',
  'error.git/unavailable': 'No git executable is available on the host.',
  'error.git/command-failed': 'The git command failed.',
}

/** Key domain of the git-worktree namespace (zh is the source of truth). */
export type GitKey = keyof typeof zh
