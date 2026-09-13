# Scoped re-review — Task 12 fix round 1

You are re-reviewing one task's fix round. A previous review produced findings; an implementer has attempted to fix them. Your job is to verdict each finding and inspect the fix diff — nothing else.

## The Task

Read the task brief for context: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-12-brief.md
(Task 12 of dsh-client-ui-usage — the UsageSection component + settings.section registration.)

## The Findings Under Verification

1. **[plan-mandated] state.serviceMissing never rendered** — all fetch failures showed state.error; the 404/service-missing fallback key was dead. Expected fix: 404 discrimination (controller isServiceMissing helper or message match) → state.serviceMissing; other errors → state.error; tests covering both branches.
2. **[plan-mandated] No 60s post-success polling** — polling stopped forever once scanning settled. Expected fix: scanning → 5s re-poll (unchanged); settled success → next poll at 60s; unmount/error/dependency change clears the timer via the single cleanup path. Tests: fake timers assert refetch at 60s boundary and unmount cancellation.
3. **[plan-mandated] 会话数 summary card missing** — sessionCount/skippedSessions exposed on the wire but not rendered. Expected fix: one new card, sessionCount primary + conditional skipped sub-line, new zh/en locale keys with parity.

## The Fix

Read the implementer's report (fix section appended at the end): /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-12-report.md

**Fix base:** 08dda67 (the head the previous review saw)
**Head:** 0c7207f
**Diff file:** /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/review-08dda67..0c7207f.diff

Read the diff file once — it contains the fix commit, a stat summary, and the fix diff with surrounding context. Do not re-run git commands. If the diff file is missing, fetch the diff yourself with git diff --stat 08dda67..0c7207f and git diff 08dda67..0c7207f (from /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard).

Your review is read-only on this checkout. Do not mutate the working tree, the index, HEAD, or branch state.

## You Do Not Dispatch Subagents

Do all of this review yourself. Never spawn a subagent.

## Scope

Verdict each finding. Inspect the fix diff for new problems the fix itself introduced: does the isServiceMissing discrimination actually distinguish 404 from other statuses (message match robust? a non-404 error containing "404" in its message text?)? Is the 60s timer on the same cleanup path (no leaked timer on unmount mid-poll, no double-schedule)? Does the new card break the cards-row layout assumptions or locale parity? Do NOT re-review code the fix did not touch — out-of-scope observations go under Out-of-Scope Observations.

## Tests

The implementer claims: RED 4 failed/6 passed for the right reasons; focused GREEN 14/14; full suite 146/146 (18 files); build exit 0; purity grep 0. Confirm the fix report names covering verification with output and verify claims against the diff. You may run ONE decisive focused check if reading the diff raises a specific doubt: from /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard run pnpm exec vitest run packages/client-ui-usage/tests/usage-section.spec.tsx. Nothing else.

## Output Format

Your final message is the report itself: begin directly with the findings' verdicts.

### Finding Verdicts
- **[finding one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line evidence.

### New Breakage in the Fix Diff
Severity + file:line. "None" if clean.

### Out-of-Scope Observations
Non-blocking. "None" if none.

### Verdict
**Fix round:** [All findings addressed, no new Critical/Important breakage | Findings remain open] — list open ones if any.
