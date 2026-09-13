# Dispatch — Tasks 3+4 (dsh-usage-host: registry + pricing)

## Task briefs (requirements, exact values verbatim — read first)
- /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-3-brief.md (Task 3: models.json + registry.ts, TDD)
- /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-4-brief.md (Task 4: price.ts, TDD)

Do Task 3 completely (including its commit) before starting Task 4.

## Context

Repo root / working directory: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard (git worktree, branch usage-dashboard — work ONLY here, never in /Users/jelvin/000_source_code/dsh-plugins itself).

Tasks 1-2 already delivered: package scaffold, src/shared.ts (UsageBuckets, route types, usageTotal), src/fold-usage.ts. Interfaces you consume verbatim:
- UsageBuckets from '../src/shared.ts' — { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }, all readonly number.
- NUL separator convention: routeKey = provider + NUL-char + model, where NUL is the JS escape \u0000 inside single-quoted strings (see src/fold-usage.ts routeKey). registry.ts builds its provider-scoped alias key the same way: providerKey.toLowerCase() + NUL + candidate.

Prior-task rulings that bind you:
- Readonly interfaces + strict TS: mutate maps/totals only through pure functions returning new values, or Map.set with newly built objects. The brief code already complies; keep the style.
- vitest runs from the worktree ROOT (per-package include-pattern cwd issue). Focused commands:
  - pnpm exec vitest run packages/usage-host/tests/registry.spec.ts
  - pnpm exec vitest run packages/usage-host/tests/price.spec.ts
  - Full suite once before final commit: pnpm exec vitest run (baseline: 99 tests passing)
  - Build: pnpm --filter dsh-usage-host build

models.json unit prices are example data per the brief deliverable note; transcribe as-is.

## Before You Begin
If you have questions about requirements or anything unclear in the briefs — ask now (report NEEDS_CONTEXT). Don't guess.

## Your Job
1. Transcribe the briefs' code faithfully; follow TDD steps in order (failing test, RED evidence, implement, GREEN)
2. Verify with the commands above
3. Commit per each brief's commit step (two commits, one per task)
4. Self-review: completeness vs brief, naming, YAGNI, tests verify real behavior, pristine output
5. Write the full report (what you implemented; TDD evidence RED/GREEN with commands and output; files changed; self-review findings; concerns) to:
   /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-3-4-report.md

## You Do Not Dispatch Subagents
Do all of this work yourself. Never spawn a subagent — not a helper, never a reviewer. Review is the controller's job and is already scheduled.

## When You're in Over Your Head
Report BLOCKED with specifics. Bad work is worse than no work.