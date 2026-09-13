# Final fix round — Critical scan containment + cheap branch-polish batch

You are implementing the final fix round before merge. One Critical MUST-FIX plus a batch of cheap, review-adjudicated fixes. Work in /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard (branch usage-dashboard, HEAD 0c7207f). Never touch upstream deepseek-harness. Never spawn subagents. TDD where a test can pin the behavior.

## Read first

- Ledger with the review rulings: /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/progress.md (final review entry at the end)

## Commit 1 — Critical: scan() must never crash the host (TDD)

packages/usage-host/src/service.ts: summary() does void this.scan(limit); scan() has try/finally with NO catch. Any failure — sessionQuery.listSessions rejection, corrupt registryOverridesPath JSON (loadModelRegistry readFileSync/JSON.parse), saveIndexAtomic failure — is an unhandled promise rejection; Node default aborts the process (reviewer verified via node smoke on the built lib with a fake listSessions rejection).

Fix: contain every failure path inside scan() (wrap the body in try/catch — on catch: keep the previous cache untouched, still update lastScanAt so the refreshMs throttle holds, log a single warning via a logger-compatible channel consistent with existing code style; if the file has no logger, use console.warn). finally still resets scanning. Do NOT swallow errors silently into nothing: one log line, cache preserved.

Tests (service.spec.ts): (1) listSessions rejects -> summary() promise still resolves, cache/zero-shell unchanged, scanning eventually false, no unhandled rejection (assert via process 'unhandledRejection' listener or by scan() not throwing when awaited directly — pick the observable hook, state it); (2) saveIndexAtomic failure (mock rename/ writeFile reject) -> same containment. Capture RED evidence: the uncaught version fails these tests.

## Commit 2 — cheap batch (all review-adjudicated, do exactly this, nothing more)

1. (q) Untruncated cache: service.ts scan calls aggregateSessions(inputs, normalizer, Number.MAX_SAFE_INTEGER) and drops its own limit param; summary(limit) already slices cached.topSessions (service.ts:66). Add a real cap test in service.spec or routes.spec: cache built with many sessions, first summary(?limit small) then larger limit inside the same window returns MORE rows (this was impossible before).
2. (b) aggregate.ts: filter all-zero entries from routeBuckets and dailyRows (usageTotal === 0) with a test pinning: a route whose buckets were fully replaced to zero disappears from providers/models AND its daily column disappears.
3. (c) fold-usage.spec.ts: two missing tests — "no usage and no stream -> not counted" and "usage wins over stream when both present".
4. (u) UsageSection.tsx: delete local bucketTotal (lines ~56-58), import { usageTotal } from 'dsh-usage-host/shared' (browser-safe, purity already holds via the constant inlining channel — re-verify grep -c deepseek-ai packages/client-ui-usage/lib/client.js = 0 after build).
5. (a) fold-usage.ts EOF newline; (r) routes.spec.ts EOF newline.
6. (aa) rename misleading test 'keeps polling while scanning and stops when settled' -> reflect that settled keeps polling at 60s.

## Verify

1. Focused RED evidence for commit 1 before the fix.
2. Full suite from worktree root: pnpm exec vitest run (baseline 146; your new tests add; all green).
3. pnpm -r run build.
4. Purity: grep -c deepseek-ai packages/client-ui-usage/lib/client.js -> 0.
5. Node smoke for the Critical: from worktree root, import packages/usage-host/lib/index.js, build a UsageService whose sessionQuery.listSessions rejects, await summary(), confirm the process survives (exit 0) and cache is the zero shell.

## Reports

Append the fix report to /Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard/.superpowers/sdd/2026-09-11-usage-dashboard/task-6-7-report.md (Critical) — it owns service.ts — and note the cheap-batch items in the same appended section with per-item files touched.

Reply with ONLY (under 15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT); commits; one-line test summary; concerns; report path.
