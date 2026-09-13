# Scoped re-review — final fix round (Critical scan containment + cheap batch)

You are re-reviewing the final fix round of the usage-dashboard branch. A whole-branch review produced findings; an implementer attempted them. Verdict each finding and inspect the fix diff — nothing else.

## The Findings Under Verification

1. **CRITICAL — scan() unhandled rejection can crash the host** (service.ts:57-58, 69-120 at 0c7207f): summary() does void this.scan(); scan() try/finally with no catch — listSessions rejection / corrupt registry JSON / saveIndexAtomic failure all become unhandled rejections (node default aborts). Expected fix: containment inside scan() (catch: previous cache untouched, lastScanAt still advances so refreshMs throttle holds, one log line; finally resets scanning) + tests proving containment (listSessions rejection; saveIndexAtomic failure) + a node smoke on the built lib showing the process survives a permanently rejecting listSessions.
2. **(q) refresh-window larger-limit underfill** — expected fix: scan aggregates with Number.MAX_SAFE_INTEGER, scan's limit param dropped, summary() slices cached; plus a real cap test (small limit first, larger limit same window returns more rows).
3. **(b) all-zero route/daily rows surface in UI** — expected fix: aggregate filters usageTotal===0 routes and daily rows + test.
4. **(c) two missing fold tests** — "no usage and no stream -> not counted"; "usage priority over stream when both present".
5. **(u) bucketTotal duplicate** — expected fix: UsageSection imports usageTotal from 'dsh-usage-host/shared', local helper deleted; purity grep still 0.
6. **(a)(r) EOF newlines** (fold-usage.ts, routes.spec.ts); **(aa) misleading test rename**.

## The Fix

Read the implementer's report (final appended section): /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-6-7-report.md

**Fix base:** 0c7207f (the head the whole-branch review saw)
**Head:** 6d507d8
**Diff file:** /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/review-0c7207f..6d507d8.diff

Read the diff file once. Do not re-run git commands. If missing, fetch with git diff --stat 0c7207f..6d507d8 and git diff 0c7207f..6d507d8 from /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard.

Read-only review: do not mutate the working tree, index, HEAD, or branch state. Never spawn subagents.

## Scope

Verdict each finding. Inspect the fix diff for new problems: does the catch alter success-path semantics (lastScanAt/throttle/scanning flag)? Does MAX_SAFE_INTEGER aggregation change summary()'s default-limit behavior (client must still see 20)? Does the zero-filter drop legitimately zero-usage sessions from topSessions? Does the usageTotal import break bundle purity? Out-of-scope observations separately.

## Tests

Implementer claims: RED evidence for both commits; full suite 18 files / 152 passed; pnpm -r build exit 0; purity grep 0; node smoke: listSessions permanent rejection -> process survives, zero shell preserved, single console.warn, no unhandled rejection. Verify claims against the diff. You may run ONE decisive check for the Critical — the node smoke — since it is the crash path itself and no unit test covers the real process semantics: from /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard run something equivalent to: node -e "import('./packages/usage-host/lib/index.js').then(async (m) => { const svc = new m.UsageService({ sessionQuery: { listSessions: async () => { throw new Error('boom'); } }, refreshMs: 0 }); const r1 = await svc.summary(); await new Promise(r => setTimeout(r, 50)); const r2 = await svc.summary(); console.log('survived', r1.scanning, r2.sessionCount); process.exit(0); }).catch(e => { console.error('CRASH', e); process.exit(1); })" — adjust the constructor shape to the real exports first (read lib/index.d.ts or src/service.ts). If the built lib is absent, run pnpm --filter dsh-usage-host build first. Nothing else.

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
