# Fix round 1 — Task 12 (dsh-client-ui-usage UsageSection)

You are implementing a fix round for Task 12. A prior implementer completed the task; a review approved it with three Important findings you now own. All three share one root cause: the task brief's text diverged from the plan's global constraints, and the plan's global text is authoritative.

## Read first

1. Context: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/dispatch-task-12.md and /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-12-brief.md
2. Prior implementer's report: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-12-report.md

Work in /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard (branch usage-dashboard). Only packages/client-ui-usage/** may change. Never touch upstream deepseek-harness. Never spawn subagents. One commit for all three fixes.

## Finding 1 — state.serviceMissing is a dead key

All fetch failures render state.error (packages/client-ui-usage/src/client/UsageSection.tsx:262-273). The controller (packages/client-ui-usage/src/client/controller.ts:46) throws Error('usage: summary route failed with <status>') on non-ok.

Fix: in the component's catch, discriminate status 404 (smallest observable hook: match the controller's thrown message for 404, or have controller.ts export a tiny typed helper — pick ONE, keep it minimal) and render t('state.serviceMissing') instead of t('state.error'). Tests: a 404-shaped rejection renders serviceMissing text and not error text; a 503-shaped rejection renders error text.

## Finding 2 — no 60s post-success polling

Current: while response.scanning, re-poll after 5s; once scanning settles, polling stops forever (UsageSection.tsx:238-239). Plan constraint: 挂载即拉,成功后 60s 定时,卸载清理.

Fix: on success with response.scanning true, next poll in 5s (unchanged); on success with scanning false, schedule next poll in 60_000ms; unmount / error / dependency change clears the pending timer (extend the existing cancelled-flag + clearTimeout pattern at UsageSection.tsx:228-249; single cleanup path). Tests (fake timers): non-scanning first response schedules exactly one refetch at 60s (calledTimes 1 at 59s, 2 at 61s); unmount before 60s cancels it.

## Finding 3 — 会话数 summary card missing

Plan card list: 总 tokens/总费用/会话数. Wire has sessionCount and skippedSessions (packages/usage-host/src/shared.ts:69-72) but UI renders neither.

Fix: add one card to the cards row: sessionCount primary, sub-line rendering the skipped suffix only when skippedSessions > 0 (add locale keys to zh AND en, key parity must hold — locales.spec enforces it). Tests: sessionCount 7 + skippedSessions 2 renders 7 and the skipped sub-line; skippedSessions 0 renders no skipped sub-line.

## TDD + verify

1. Tests first; capture RED evidence (failing run output).
2. Focused: pnpm exec vitest run packages/client-ui-usage/tests/usage-section.spec.tsx packages/client-ui-usage/tests/controller.spec.ts (from worktree root)
3. Full suite: pnpm exec vitest run (baseline 140, all passing)
4. Build: pnpm --filter dsh-client-ui-usage build
5. Purity: grep -c "deepseek-ai" packages/client-ui-usage/lib/client.js must print 0

## Commit

One commit: "fix(client-ui-usage): service-missing state, 60s polling, sessions card"

## Report

Append a fix report to /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-12-report.md. Also surface any brief-vs-plan conflicts you notice that were NOT in this list (the prior implementer missed some).

Reply with ONLY (under 15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT); commits; one-line test summary; concerns; report path.
