# Dispatch — Task 8(dsh-usage-host:路由 + cordis apply,整体替换 src/index.ts)

## Task brief(requirements,exact values verbatim — 先读)
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-8-brief.md

## Report file
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-8-report.md
## Context(dsh-usage-host 收尾任务通用)

Repo root / working directory: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard(git worktree,branch usage-dashboard — 只在这里工作)。

包内已交付:src/shared.ts、src/fold-usage.ts、src/registry.ts(+models.json,build 时随 bundle 拷贝到 lib/)、src/price.ts、src/aggregate.ts、src/usage-index.ts、src/service.ts;src/index.ts 现有 export * from './registry.ts'。全量基线 126 tests,从 worktree 根跑 pnpm exec vitest run;构建 pnpm --filter dsh-usage-host build。

既有裁定(约束你):
- Readonly + 严格 TS;纯函数风格。
- Task 5 的 aggregate.ts 尚未从 src/index.ts 导出 —— 本任务装配时必须补上(路由返回它组装的完整 UsageSummaryResponse)。
- limit 语义:路由 ?limit= 1..200,越界/非数字回退 20;summary(limit) 已实现 topSessions 截断。
- 计划文本与已交付代码签名冲突时以已交付代码为准,偏差写入报告。

## You Do Not Dispatch Subagents
全部自己做。绝不 spawn subagent。

## TDD 纪律
先失败测试 → RED 证据 → 最小实现 → GREEN 证据 → 一任务一提交。

## 报告契约
完整报告写指派 report 文件(实现内容;RED/GREEN 证据;变更文件;self-review;concerns)。最终回复只给(15 行内):Status、commits、一行测试摘要、concerns、report 路径。