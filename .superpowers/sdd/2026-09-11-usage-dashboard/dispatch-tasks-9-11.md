# Dispatch — Tasks 9+10+11(dsh-client-ui-usage:脚手架 → controller → 双语字典)

## Task briefs(requirements,exact values verbatim — 先读)
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-9-brief.md(Task 9:包脚手架;含根 vitest.config.ts environmentMatchGlobs 追加)
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-10-brief.md(Task 10:UsageController,TDD)
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-11-brief.md(Task 11:locales.ts,TDD)

按序执行,每任务完整交付(含提交)再开始下一个。Task 9 的构建验证(pnpm --filter dsh-client-ui-usage build)必须在进入 Task 10 前通过。

## Report file
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-9-11-report.md
## Context(client 侧三连发通用)

Repo root / working directory: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard(git worktree,branch usage-dashboard — 只在这里工作)。

dsh-usage-host 已完成(Task 1-8):GET /dsh-usage/summary 路由 + shared.ts 线上类型(USAGE_SUMMARY_ROUTE/UsageSummaryResponse/各 Row),经 connection.requestRejection 浏览器信任围栏。

既有裁定(约束你):
- client 测试走根 vitest 的 jsdom lane;Task 9 必须把 packages/client-ui-usage/tests/** 加进根 vitest.config.ts 的 environmentMatchGlobs。
- 全量测试从 worktree 根:pnpm exec vitest run(当前基线 131 tests);构建 pnpm --filter dsh-client-ui-usage build。
- 浏览器 bundle 纯度:lib/client.js 不得含 @deepseek-ai 值(仅 import type);'dsh-usage-host/shared' 的常量按 client-ui-git 对 'dsh-git-host/shared' 的同构方式内联/解析(先 cat packages/client-ui-git/tsconfig.json 与 tsdown.config.ts 对照再抄)。
- 计划文本与已交付代码冲突时以 brief Interfaces 和既有代码签名为准,偏差写入报告。

## You Do Not Dispatch Subagents
全部自己做。绝不 spawn subagent(助手或审查者都不行);审查由 controller 负责,已排程。

## TDD 纪律
先失败测试 → RED 证据 → 最小实现 → GREEN 证据 → 一任务一提交。

## 报告契约
完整报告写指派 report 文件(实现内容;RED/GREEN 证据含命令与输出;变更文件;self-review 发现;concerns)。最终回复只给(15 行内):Status(DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT)、commits、一行测试摘要、concerns、report 路径。BLOCKED/NEEDS_CONTEXT 时把具体内容写进最终回复。