# Dispatch — Task 12(UsageSection 组件 + settings.section 注册)

## Task brief(requirements,exact values verbatim — 先读)
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-12-brief.md

## Report file
/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-12-report.md
## Context(client 侧收官任务)

Repo root / working directory: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard(git worktree,branch usage-dashboard — 只在这里工作)。

已交付:dsh-client-ui-usage 包(脚手架/controller/locales,17 文件 136 tests 全绿,bundle 纯度 grep 0);dsh-usage-host 完成(GET /dsh-usage/summary)。

既有裁定(约束你):
- 全量测试从 worktree 根:pnpm exec vitest run(基线 136 tests);构建 pnpm --filter dsh-client-ui-usage build。
- UsageSection 组件直喂 props 测试(不经 ctx.slots);jsdom lane 已配好。
- 组件 inject-face 模式参照 deepseek-harness/packages/client/ui-settings-models/src/client/ModelsSection.tsx(Partial<InjectFace> + 早期 null 返回);注册调用照 task-12-brief 的 register 参数。
- 若 TranslateNS / InjectFace 在 @deepseek-ai/dsh-client-ui-slots 实际导出名不同,以 node_modules .d.ts 为准修正 import,模式不变。
- zh 字典已是事实源(任务 11 交付的 NS 'usage');组件需要的 key 若缺,可追加到 zh/en(保持键集对齐,更新 locales.spec 断言自然通过)。
- 计划文本与已交付代码签名冲突时以 brief Interfaces 和既有代码为准,偏差写入报告。

## You Do Not Dispatch Subagents
全部自己做。绝不 spawn subagent。

## TDD 纪律
先失败测试 → RED 证据 → 最小实现 → GREEN 证据 → 提交。

## 报告契约
完整报告写指派 report 文件。最终回复只给(15 行内):Status、commits、一行测试摘要、concerns、report 路径。