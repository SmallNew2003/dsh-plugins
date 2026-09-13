# Final whole-branch review — usage-dashboard (BASE 153cf56)

You are performing the final whole-branch review before merge. Every task has already passed a task-scoped review; your job is the cross-task view: contract seams between tasks, deferred-minor adjudication, and merge readiness. This is read-heavy — spend your effort on seams, not on re-checking what task reviews verified.

## Inputs

- Approved spec: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/docs/design/2026-09-11-usage-dashboard-design.md
- Plan: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/docs/superpowers/plans/2026-09-11-usage-dashboard.md
- SDD ledger (all task verdicts, rulings, deferred minors): /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/progress.md
- Branch diff: run git diff --stat 153cf56..HEAD and git diff 153cf56..HEAD from /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard (HEAD = 0c7207f at dispatch time; verify with git log --oneline 153cf56..HEAD)

## Review dimensions (in priority order)

1. **Seam contracts** — the handoffs: fold(routeKey NUL) ↔ aggregate split; fold/aggregate ↔ service (SessionUsageFold, AggregateInput, views Omit-type); service ↔ route (UsageServiceOptions defaults, summary(limit) semantics); route ↔ client (shared.ts wire types, USAGE_SUMMARY_ROUTE constant inlined into client bundle — verify the constant value in client lib matches host lib EXACTLY, e.g. grep both); controller ↔ component (fetchSummary contract, isServiceMissing); locales keys ↔ component t() calls (every key referenced exists in zh AND en).
2. **Deferred minors adjudication** — progress.md lists ~12 deferred minors (a)-(ab). For each: fix now (must-fix before merge), fix now (cheap, do it), or WONTFIX (accepted, one-line rationale). The two flagged for this review specifically: (q) refresh-window larger-limit underfill — decide whether cached topSessions/daily should store untruncated and slice at route; (u) bucketTotal duplicate of usageTotal — collapse to the shared import (cheap, browser-safe).
3. **Whole-branch consistency** — commit hygiene (messages, no debug residue), no upstream deepseek-harness changes anywhere in the diff, docs (design/plan) unchanged, root configs (vitest.config.ts) touched only as briefed, pnpm-lock consistent with package.json changes.
4. **Merge readiness** — conflicts likely with master's parallel commits 0201b46/c141130? Check: git log --oneline master..usage-dashboard and git merge-base; identify files both sides touched (esp. root vitest.config.ts / pnpm-lock.yaml).

You may run focused verification (vitest single-file, grep, node smoke on built lib) for specific doubts — name each before running. Never spawn subagents. Read-only on the working tree: do not commit, do not mutate.

## Output format

### Seam Verdicts (one line each seam, file:line evidence)

### Deferred Minors Ruling (table: id | verdict | rationale | commit if fixed)

### Whole-Branch Findings (Critical/Important/Minor with file:line)

### Merge Readiness (conflict forecast with master; blocks merge Y/N; if Y list them)

**Final verdict:** [MERGEABLE | NEEDS FIXES — list]
