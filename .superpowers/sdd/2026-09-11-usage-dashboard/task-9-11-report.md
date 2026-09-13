# Report — Tasks 9 + 10 + 11 (dsh-client-ui-usage)

Branch `usage-dashboard`, worktree `/Users/jelvin/000_source_code/dsh-plugins/.worktrees/usage-dashboard`. Final tree clean.

## Commits

| SHA | Subject |
|---|---|
| 916b74a | feat(client-ui-usage): package scaffold |
| f482b67 | feat(client-ui-usage): summary fetch carrier |
| 573bfb9 | feat(client-ui-usage): bilingual usage dictionaries |

## Task 9 — package scaffold (916b74a)

- `packages/client-ui-usage/package.json`: name/description per brief; `dsh.client.inject` = [ui-settings, locale, ui-primitives], platform web; devDependencies = client-ui-git link set minus `dsh-git-host` and `dsh-client-ui-conversation`, plus `@deepseek-ai/dsh-client-ui-settings` link and (see Deviations) `dsh-usage-host: workspace:^`.
- `tsconfig.json`: verbatim copy of client-ui-git (jsx react-jsx, DOM libs).
- `tsdown.config.ts`: copy with `id = 'dsh-client-ui-usage'`, EXTERNALS = [react, react/jsx-runtime, @deepseek-ai/cordis, @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives], cssModulesPlugin name `dsh-usage-css-modules`.
- `src/index.ts`: node half-empty apply (brief verbatim). `src/client/index.ts`: placeholder (Task 12 replaces).
- Root `vitest.config.ts`: added `['packages/client-ui-usage/tests/**', 'jsdom']` to environmentMatchGlobs.

**Build verification**: `pnpm install && pnpm --filter dsh-client-ui-usage build` → exit 0; `lib/client.js` generated, banner `window.__ModuleLoader__.load({ id: 'dsh-client-ui-usage', factory: ... })`.

## Task 10 — UsageController, TDD (f482b67)

**RED**: wrote `tests/controller.spec.ts` (4 cases: null-origin fallback URL/headers, in-flight sharing, non-ok throws with status, TTL window). Ran `pnpm exec vitest run packages/client-ui-usage/tests/controller.spec.ts` → exit 1, `Test Files 1 failed`; error: `Failed to resolve import "../src/client/controller.ts"` — i.e. the only missing piece was the implementation (`dsh-usage-host/shared` itself resolved fine).

**GREEN**: implemented `src/client/controller.ts` verbatim from the brief (hostBase null-origin fallback, TTL_MS 5_000, inflight dedupe, `usage: summary route failed with <status>`). Rerun → exit 0, `4 passed (4)`.

**Self-review adjustment (test-side only)**: `fetchSummary` is an `async` method, so each caller receives the async facade's wrapper promise — `second !== first` at promise identity even though both wrap the one in-flight. Assertion changed to resolved-value identity (`expect(b).toBe(a)` after `Promise.all`) plus `fetcher` called exactly once; the shared-single-fetch behavior the brief specifies is fully asserted. Implementation untouched (brief-verbatim).

## Task 11 — bilingual dictionaries, TDD (573bfb9)

**RED**: `tests/locales.spec.ts` (brief verbatim: en keys sorted equal zh keys sorted) → exit 1 (module missing).

**GREEN**: `src/client/locales.ts` — `NS = 'usage'`; `zh` as const with all 20 required keys, brief copy verbatim for nav / state.scanning / estimate.disclaimer / unpriced.notice / state.serviceMissing / sessions.untitled; `en: Record<UsageKey, string>`; `UsageKey = keyof typeof zh`; `declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { usage: UsageKey } }`. Rerun → exit 0.

**Fix during verification**: first `pnpm --filter dsh-client-ui-usage build` after adding locales failed with `TS2664: Invalid module name in augmentation, module '@deepseek-ai/dsh-client-ui-slots' cannot be found`. Root cause: the augmentation needs the target module in the tsc program. Fix mirrors the existing `ui-theme/src/client/index.ts` pattern: added `import type {} from '@deepseek-ai/dsh-client-ui-slots'` (type-only, erased — bundle purity unaffected). Build → exit 0.

## Full verification

- `pnpm exec vitest run` (worktree root) → exit 0, **17 files / 136 tests passed** (baseline 131 + 5 new: 4 controller + 1 locales).
- `pnpm --filter dsh-client-ui-usage build` → exit 0; `lib/client.js` contains **0** occurrences of `deepseek-ai` (purity gate holds; only type-only import used).
- `git status` clean; 3 commits on usage-dashboard.

## Deviations / notes

1. **package.json adds `"dsh-usage-host": "workspace:^"`** although Task 9 Step 1 did not list it. Required for the brief's own Interfaces contract: Task 10 imports `'dsh-usage-host/shared'`, and client-ui-git resolves `'dsh-git-host/shared'` exactly this way (workspace devDependency link; no tsconfig paths, no tsdown alias — the constant is bundled/inlined because the specifier is not in EXTERNALS). Without the link neither tsc, vitest, nor tsdown can resolve the import.
2. **RED/GREEN run command shape**: `pnpm --filter dsh-client-ui-usage exec vitest run tests/controller.spec.ts` (brief Step 2 command) resolves the root vitest config whose `include` is root-relative, so the package-relative filter matches nothing ("No test files found"). Equivalent run from the worktree root: `pnpm exec vitest run packages/client-ui-usage/tests/<spec>.ts`. No config change needed; noting for future dispatches.
3. Vitest warns `environmentMatchGlobs` is deprecated (pre-existing pattern, kept for consistency with the other client packages).
4. en copy for keys without brief-fixed wording was authored (providers/models/daily/sessions titles, bucket names, state.empty/error/retry, share.of, summary.title); zh remains the source of truth.

## Concerns

- None blocking. The in-flight identity nuance (item in Task 10 self-review) is the only semantic subtlety; documented in the spec comment.
