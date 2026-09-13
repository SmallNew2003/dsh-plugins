# Task 1 + 2 Report: dsh-usage-host scaffold and route-attributed usage fold

**Status: DONE_WITH_CONCERNS** — both tasks implemented, verified, and committed; three brief defects required documented, minimal reconciliations (details below).

## What was implemented

### Task 1 — package scaffold (commit a983750)
Created `packages/usage-host/` exactly per the brief:
- `package.json` — verbatim (name/description/version, exports map incl. `./shared` and `./src/*`, build/test scripts, 4 peerDependencies, 8 devDependencies with `link:../../../deepseek-harness/...` specifiers).
- `tsconfig.json` — verbatim (extends root base, rootDir src, outDir lib/types, lib ES2022).
- `tsdown.config.ts` — full copy of `packages/git-host/tsdown.config.ts` including header comment (node-only single entry `lib/types/index.js`).
- `src/shared.ts` — verbatim: `USAGE_SUMMARY_ROUTE = '/dsh-usage/summary'`, `UsageBuckets`, `usageTotal()`, `ModelUsageRow`, `ProviderUsageRow`, `DailyUsageRow`, `SessionUsageRow`, `UsageSummaryResponse` (Chinese doc comments preserved).
- `src/index.ts` — verbatim placeholder (`name` + empty `apply`, Task 8 replaces).
- Link targets verified to exist before install: `vendor/cordis`, `vendor/schemastery`, `packages/host/webserver`, `packages/llm/llm` all present under the harness checkout the `.worktrees/deepseek-harness` symlink resolves to.
- `pnpm install` exit 0 (lockfile +27 lines for the new importer); `pnpm --filter dsh-usage-host build` exit 0 producing `lib/index.js`, `lib/types/index.{js,d.ts}`, `lib/types/shared.{js,d.ts}`.
- **Commit deviation:** also committed `pnpm-lock.yaml` (brief's `git add packages/usage-host` would have left the required importer change uncommitted; repo convention — e.g. scaffold commit 70646c2 — includes the lockfile).

### Task 2 — fold-usage.ts, TDD (commit 7b2564e)
- `tests/fold-usage.spec.ts` — 8 tests, 1:1 with the brief's tests; every 口径 rule covered: usage-first sampling, stream fallback, assistant-only event filter, retry-started slot clearing, idempotent skip, replacement with cross-route subtraction, invalid-bucket rejection, local-day bucketing with old-day subtraction, raw eventCount.
- `src/fold-usage.ts` — brief's implementation verbatim except the three reconciliations below. Branch order verified against upstream `token-meter/src/usage-projection.ts` `apply()` (retry-started first at line 123; idempotency check before replacement at line 142).

## TDD evidence

**RED** — test written first, implementation file absent:
- Command: `pnpm exec vitest run packages/usage-host/tests/fold-usage.spec.ts` (from worktree root)
- Output: `FAIL ... Error: Cannot find module '../src/fold-usage.ts' imported from .../tests/fold-usage.spec.ts` — 1 suite failed, no tests. Fails for the expected reason: the feature module does not exist yet.

**GREEN** — after implementation:
- Command: same; Output: `✓ packages/usage-host/tests/fold-usage.spec.ts (8 tests) — Tests 8 passed (8)`.
- Focused rerun after the totals fix: 8/8 passed.
- Full root suite (run before final commit): `Test Files 9 passed (9) — Tests 99 passed (99)` (baseline 91 + 8 new).
- Build: `pnpm --filter dsh-usage-host build` exit 0.

**Upstream cross-check (brief Step 5)** — `grep -n "retry-started" .../usage-projection.ts` → lines 114/123; manually confirmed the fold's branch order matches `apply()`: retry handling precedes sample processing; idempotency precedes replacement.

## Brief defects found and how they were reconciled

The brief's Task 2 test and implementation, transcribed verbatim, cannot both hold. Evidence and resolutions:

1. **Attribution shape mismatch.** The brief's test helper spreads `{ source: {...} }` at `data` top level, but the brief's own `RawUsageEventData` interface and `sourceOf()` read `data.message?.source`. Top-level `data.source` is also contradicted by the plan's own Task 5 fixtures (`docs/superpowers/plans/2026-09-11-usage-dashboard.md:839`: `message: { source: { provider, model } }`) and by real session logs (upstream `turn-usage.ts:73` reads `message.source`). Verbatim transcription fails brief tests 1–4 and 7 (all usage would land on `unattributed`). **Fix: test fixtures corrected to `message: { source: {...} }`; implementation unchanged.** If instead the implementation had been "fixed" to read `data.source`, Task 5's aggregation tests would break downstream.

2. **Stream record shape mismatch.** The brief's test uses bare stream records `[{ delta: 'x' }, { usage: {...} }]`, but upstream `lastAssistantStreamChunk` (which the brief's implementation calls, and which real logs feed) only matches wrapped compact records `{ type: 'chunk', chunk: { type: 'usage', usage } }` (`assistant-stream.ts:377-382`; `StreamChunk` usage variant at `types.ts:396`). Verbatim, brief test 5 can never pass. **Fix: test fixture corrected to wrapped records; scan semantics unchanged.**

3. **Unresolvable import (build-breaking).** `import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'` cannot resolve in this environment, verified empirically (vitest: "Cannot find package '@deepseek-ai/dsh-llm/assistant-stream'"): the harness checkout carries `src/assistant-stream.ts` as a staged-but-unbuilt change — `lib/types/assistant-stream.js`/`.d.ts` do not exist, so the exports-mapped subpath is dangling; root `lib/index.js` does not export it either. The reference repo is read-only, so it cannot be rebuilt. `tsc -p tsconfig.json` would fail TS2307 the same way. **Fix: replaced the import with a private `lastUsageChunk()` mirroring the upstream scan exactly (backwards, `record.type === 'chunk'`, first `chunk.type === 'usage'` hit), with a header comment documenting the substitution and the one-line restore path once the dsh-llm subpath ships.**

4. **Readonly mutation (compile error).** The brief's implementation mutates `totals.uncachedInputTokens -= ...` etc., but `UsageBuckets` fields are `readonly` in the brief's own shared.ts — `tsc` fails TS2540 on all four buckets (observed during build). **Fix: pure `replaceTotals(totals, previous, next)` helper with the identical per-bucket arithmetic, mirroring upstream's `addReplacing`; behavior unchanged.**

5. **Focused-test command (environment note, not a code change).** The brief's `pnpm --filter dsh-usage-host exec vitest run tests/fold-usage.spec.ts` exits 1 with "No test files found": vitest runs with the package as cwd while the root config's include patterns are repo-root-relative — the same pre-existing include-pattern cwd issue noted for `pnpm -r run test`. Working equivalent used throughout: `pnpm exec vitest run packages/usage-host/tests/fold-usage.spec.ts` from the worktree root.

## Self-review

- Completeness vs briefs: all Task 1 steps done and committed; all Task 2 steps done (RED → GREEN → upstream cross-check → commit). The 5 口径 rules are each covered by at least one test, with assertions identical to the brief's.
- Naming/YAGNI: no extra files, no new configs, no exported surface beyond the brief's Produces list; `lastUsageChunk` is private; placeholder index stays minimal.
- Tests verify real behavior: fixtures now match the declared interface and the real durable log format (wrapped chunk records, `message.source`), not synthetic shapes that never occur in production.
- Pristine output: `git status` clean after both commits; `lib/` build output gitignored; reference repo untouched.

## Concerns for the controller

- **C1 (restore point):** When the harness checkout's dsh-llm change lands and `lib/types/assistant-stream.js` is built, restore the upstream import in `fold-usage.ts` (comment in the file marks the spot) and delete the private `lastUsageChunk`.
- **C2 (downstream compatibility):** Later tasks must feed the fold events shaped as declared (`data.message.source`, wrapped stream records). The plan's Task 5 fixtures already do; no action needed, but any task hand-copying the Task 2 brief's test helper would reintroduce bug 1.
- **C3 (test runner):** Focused per-package test commands must run vitest from the worktree root (or the root include patterns need fixing — pre-existing repo-wide issue affecting every package's `pnpm test` script).
