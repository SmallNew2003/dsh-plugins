# Task 3+4 Report — dsh-usage-host registry + pricing

Status: DONE

## What was implemented

### Task 3 — Canonical model registry and alias normalization (commit f01444d)
- `packages/usage-host/src/models.json` — built-in registry transcribed verbatim from the brief (providers: deepseek/anthropic/openai/unattributed; models: deepseek-chat, deepseek-reasoner with example $/M pricing).
- `packages/usage-host/src/registry.ts` — verbatim from the brief: interfaces `ModelPricing`, `ModelEntry`, `ProviderEntry`, `ModelRegistryData`, `NormalizedRoute`, `Normalizer`; `buildNormalizer` with candidate sequence [raw, lowercased, date-suffix-stripped (/\-\d{8}$/), ds-/deepseek- prefix stripped, combinations], provider-scoped alias lookup (providerKey.toLowerCase() + NUL ('\u0000') + candidate) before global alias; provider resolved via lowercase + alias table; version = "v1:" + sha256(JSON.stringify(data)) first 16 hex chars; `loadModelRegistry` loads built-in models.json and shallow-merges a user overrides file when it exists.
- `packages/usage-host/tests/registry.spec.ts` — verbatim from the brief (6 tests).

### Task 4 — Bucket pricing estimator (commit e6093a6)
- `packages/usage-host/src/price.ts` — verbatim from the brief: `priceBuckets(buckets, pricing)` = Σ (bucket / 1e6 × unit price), consuming `UsageBuckets` (Task 1) and `ModelPricing` (Task 3).
- `packages/usage-host/tests/price.spec.ts` — verbatim from the brief (2 tests).

## TDD evidence

### Task 3
- RED: `pnpm exec vitest run packages/usage-host/tests/registry.spec.ts` →
  `Error: Failed to load url ../src/registry.ts ... Test Files 1 failed (1), Tests no tests` (module not yet implemented).
- GREEN (same command): `Test Files 1 passed (1), Tests 6 passed (6)`.

### Task 4
- RED: `pnpm exec vitest run packages/usage-host/tests/price.spec.ts` →
  `Test Files 1 failed (1), Tests no tests` (price.ts not yet implemented).
- GREEN (same command): `Test Files 1 passed (1), Tests 2 passed (2)`.

## Verification
- Full suite from worktree root: `pnpm exec vitest run` → **11 files / 107 tests passed** (99 baseline + 6 registry + 2 price).
- Build: `pnpm --filter dsh-usage-host build` → ✔ Build complete. Pre-existing warning about an invalid `define` key in the scaffold build config — not introduced by these tasks.
- `git status` clean after both commits.

## Command deviation (per dispatch ruling)
The briefs' per-package commands (`pnpm --filter dsh-usage-host exec vitest run tests/*.spec.ts`) fail with "No test files found" due to the known include-pattern cwd issue; the dispatch explicitly rules vitest runs from the worktree ROOT, so all vitest runs used:
- `pnpm exec vitest run packages/usage-host/tests/registry.spec.ts`
- `pnpm exec vitest run packages/usage-host/tests/price.spec.ts`
- `pnpm exec vitest run` (full)

## Files changed
- Created: packages/usage-host/src/models.json, src/registry.ts, src/price.ts
- Created: packages/usage-host/tests/registry.spec.ts, tests/price.spec.ts

## Commits
- f01444d feat(usage-host): canonical model registry and alias normalization
- e6093a6 feat(usage-host): bucket pricing estimator

## Self-review findings
- Code transcribed faithfully; no naming or scope drift; no extra abstractions (YAGNI respected).
- Tests verify real behavior (alias resolution, candidate fallbacks, provider scoping, unrecognized passthrough, content-hash version stability, pricing arithmetic incl. zero case) — not implementation details.
- models.json prices are example data per the brief's deliverable note ("单价为示例美元价…这是数据修正,不是实现占位") — transcribed as-is; a later data-verification pass against official price sheets is expected and out of scope here.
- Readonly/strict style consistent with prior rulings (pure functions, no mutation of inputs).

## Concerns
- None blocking. Note: build warning is pre-existing (scaffold tsup config, present before Task 3).


---

# Fix Round 1 — builtin models.json resolution from the built bundle

Commit: f62dcb2 fix(usage-host): emit builtin models.json alongside the bundle

## Finding addressed
[plan-mandated] `registry.ts` resolves `new URL('./models.json', import.meta.url)`, but the runtime entry is the tsdown bundle `lib/index.js` (entry `lib/types/index.js`); tsc does not copy JSON and tsdown had no copy step, so the builtin load would ENOENT at runtime while vitest (src imports) and build both passed.

## Changes
1. `packages/usage-host/tsdown.config.ts` — added tsdown's built-in `copy` option (verified present in installed tsdown 0.12.9 typings: `copy?: CopyOptions | CopyOptionsFn`; a string entry copies to `outDir/basename(from)`):
   ```ts
   // registry.ts resolves ./models.json relative to import.meta.url; the
   // bundle lands in lib/, so the builtin data must sit next to it.
   copy: ['src/models.json'],
   ```
   Resolution semantics in registry.ts unchanged.
2. `packages/usage-host/src/index.ts` — added `export * from './registry.ts'` so `loadModelRegistry`/`buildNormalizer` are reachable through the bundle entry (consumer-facing API; minimal change per fix instruction).

## Verification (all from worktree root)
1. Build: `pnpm --filter dsh-usage-host build` → ✔ Build complete; `ls packages/usage-host/lib` now shows `index.js  models.json  tsconfig.tsbuildinfo  types` (bundle grew to 2.83 kB since registry code is now pulled in through the re-export).
2. Node smoke against the BUILT artifact (proves the builtin JSON resolves from lib/):
   ```
   $ node -e "import('./packages/usage-host/lib/index.js').then(m => { const data = m.loadModelRegistry(); const n = m.buildNormalizer(data); const route = n.normalize('ds', 'ds-chat-20260115'); console.log('version:', n.version); console.log('normalized:', JSON.stringify(route)); console.log('price check:', JSON.stringify(Object.keys(data.models))); })"
   version: v1:b8b631b51b72dbb8
   normalized: {"providerKey":"deepseek","providerDisplayName":"DeepSeek","modelKey":"deepseek-chat","displayName":"DeepSeek Chat","recognized":true}
   price check: ["deepseek-chat","deepseek-reasoner"]
   ```
   (exit 0 — no ENOENT; alias+date-suffix normalization works from the built bundle)
3. Focused test: `pnpm exec vitest run packages/usage-host/tests/registry.spec.ts` → Test Files 1 passed (1), Tests 6 passed (6).
4. Full suite: `pnpm exec vitest run` → 11 files / 107 tests passed.
5. `git status` clean after commit (`lib/` is gitignored — only src/index.ts and tsdown.config.ts committed).
