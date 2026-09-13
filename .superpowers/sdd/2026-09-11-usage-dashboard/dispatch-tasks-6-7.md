# Dispatch — Tasks 6+7(dsh-usage-host:增量索引 + UsageService)

## Task briefs(requirements,exact values verbatim — 先读)
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-6-brief.md(Task 6:usage-index.ts,TDD)
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-7-brief.md(Task 7:service.ts,TDD)

先完整完成 Task 6(含提交)再开始 Task 7。Task 7 的实现注意段(骨架后的两条修正:eventCount 探针 + refreshMs 节流)是权威要求,按其执行,占位代码不得保留。

## Report file
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-6-7-report.md
## Context(两个派发共用)

Repo root / working directory: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard(git worktree,branch usage-dashboard — 只在这里工作,绝不碰 /Users/jelvin/000_source_code/dsh-plugins 本体)。

包 dsh-usage-host 已交付:脚手架、src/shared.ts(UsageBuckets/route 类型/usageTotal)、src/fold-usage.ts(foldSessionUsage/routeKey/dayKeyOf/emptyBuckets)、src/registry.ts(buildNormalizer/loadModelRegistry)、src/price.ts(priceBuckets)。

既有裁定(约束你):
- Readonly 接口 + 严格 TS:只经由纯函数变更状态。
- vitest 一律从 worktree 根运行:pnpm exec vitest run <path>;全量 pnpm exec vitest run(当前基线 107 tests);构建 pnpm --filter dsh-usage-host build。
- 计划文本与实际冲突时:以 brief 的 Interfaces 段和既有已交付代码签名为准,偏差写入报告 concerns,不要静默改签名。

## You Do Not Dispatch Subagents
全部自己做。绝不 spawn subagent(助手或审查者都不行);审查由 controller 负责,已排程。

## When You're in Over Your Head
报告 BLOCKED / NEEDS_CONTEXT 并写明具体卡点。烂交付比不交付更糟。

## TDD 纪律
严格按 brief 步骤:先写失败测试 → 运行留 RED 证据 → 最小实现 → GREEN 证据 → 按每个任务自己的 commit step 提交(一任务一提交)。

## 报告契约
完整报告写入指派的 report 文件(实现内容;RED/GREEN 证据含命令与输出;变更文件;self-review 发现;concerns)。最终回复只给(15 行内):Status(DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT)、commits(短 SHA + subject)、一行测试摘要、concerns、report 文件路径。BLOCKED/NEEDS_CONTEXT 时把具体内容写进最终回复。
## 额外约束(来自 Task 3-4 审查裁定)
- UsageServiceOptions.registryOverridesPath 的默认值必须接线为 join(homedir(), ".dsh", "storages", "usage-host", "models.json")(loadModelRegistry 自带 existsSync 检查,路径默认即可);indexPath 默认同目录 index.json。
- Task 7 的 src/index.ts re-export 需暴露 loadModelRegistry/buildNormalizer(Task 3-4 fix round 1 已处理 bundle 入口可达性;若发现未导出,补上并在报告注明)。
