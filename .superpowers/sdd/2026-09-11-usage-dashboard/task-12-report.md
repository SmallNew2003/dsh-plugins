# Task 12 Report — UsageSection 组件 + settings.section 注册

## Status: DONE_WITH_CONCERNS

Commits:
- (see final reply for SHA) `feat(client-ui-usage): settings usage-statistics section`

## TDD Evidence

### RED (Step 2)
Command: `pnpm exec vitest run packages/client-ui-usage/tests/usage-section.spec.tsx` (worktree root)

    FAIL  packages/client-ui-usage/tests/usage-section.spec.tsx
    Error: Failed to resolve import "../src/client/UsageSection.tsx" ...
    Test Files  1 failed (1)

Fails for the expected reason: the component does not exist yet.

### GREEN (Step 4)
Command: same. Result:

    ✓ packages/client-ui-usage/tests/usage-section.spec.tsx (4 tests) 32ms
    Test Files  1 passed (1) | Tests 4 passed (4)

Full package suite: 9 passed (controller 4 + locales 1 + usage-section 4). Output pristine (no act warnings, no stderr).

### Full worktree suite
Command: `pnpm exec vitest run` (worktree root). Result: **Test Files 18 passed (18), Tests 140 passed (140)** — baseline 136 + 4 new.

### Build + purity (Step 5)
Command: `pnpm --filter dsh-client-ui-usage build && grep -c "deepseek-ai" packages/client-ui-usage/lib/client.js`
Result: build exit 0 (tsc + tsdown, node+client both); grep count **0** (purity holds; the controller's `dsh-usage-host/shared` value import now bundles into client.js — it carries no `@deepseek-ai/*` specifier).

## Files
- Create: packages/client-ui-usage/src/client/UsageSection.tsx
- Create: packages/client-ui-usage/src/client/UsageSection.module.css
- Create: packages/client-ui-usage/src/client/css-modules.d.ts (see Deviations)
- Modify: packages/client-ui-usage/src/client/index.ts (整体替换)
- Modify: packages/client-ui-usage/src/client/locales.ts (added 2 keys, zh+en)
- Test: packages/client-ui-usage/tests/usage-section.spec.tsx (verbatim from the brief)

## Component internals (per brief 实现要点)
- `useState<UsageSummaryResponse | undefined>` + `useState<'loading' | 'ready' | 'error'>`; one effect calls `controller.fetchSummary()` → `ready`; a `scanning` response schedules a 5s `setTimeout` re-poll (cleanup clears the timer and a `cancelled` flag); `catch` → `error`. Retry button bumps a `reload` counter that re-runs the effect.
- Inject-face pattern per ui-settings-models/ModelsSection: `UsageSectionProps = Partial<InjectFace<UsageSectionInjected>>`, early `null` return when `controller`/`t` are absent; hooks run before the return. `close` prop unused (per brief).
- formatTokens (≥1e6 → x.xM; ≥1e3 → x.xK; else integer), formatUsd ($ + 2 decimals); share bar = `div.bar > span.barFill` with `Math.round(share * 100) + '%'`; daily bars = last 30 days, each column height = day/max ratio; provider amount = sum of its models' `usd` (— when none priced).
- CSS module classes exactly the brief's list: .section .cards .card .cardValue .cardLabel .table .bar .barFill .daily .column .notice .error .retry (nested model tables reuse .table).
- estimate.disclaimer renders directly under the amount in the estimate card, whenever the amount renders.
- Section order = spec: null (no inject) → scanning placeholder (state.scanning) → summary cards (4 buckets + total + amount + disclaimer) → provider table (displayName, four buckets, amount, share bar; expandable model detail with displayName + raw alias text) → daily bars → top-sessions (title ?? sessions.untitled, cwd tail, four buckets) → unpriced notice (conditional).

## Deviations (计划文本 vs 环境现实 / brief Interfaces — per dispatch ruling "以 brief Interfaces 和既有代码为准")
1. **src/client/index.ts — ctx.slots access.** The brief's verbatim index.ts imports `@deepseek-ai/dsh-client-ui-renderer/client` for the `ctx.slots` Context merge. That subpath does not resolve in this workspace: the linked harness checkout has **no built lib/ for dsh-client-ui-renderer** (checked: lib/ absent; locale + ui-settings client types ARE built and are imported type-only as in the brief). Per the dispatch ruling ("以 node_modules .d.ts 为准 … 对照 client-ui-git 的 import 写法,模式不变"), `ctx.slots` is read through a local structural `ClientSlots` surface + `serviceOf` (client-ui-git's vendor-types precedent, type-only, erased at runtime). Everything else in the brief's index.ts is verbatim: same exports (`inject`, `UsageSectionInjected`, `UsageKey` re-export, LocaleNamespaceMap merge), same `ctx.effect`/`ctx.locale.register`/`ctx.locale.bind` (locale types resolve), and the exact register parameters { name: 'settings.section', id: 'usage', order: 40, label, inject }.
2. **Model detail default state is EXPANDED.** The brief's test 1 asserts `getByText('DeepSeek V4 Flash')` immediately after load with no click, so the collapsed-by-default reading of "行可展开模型明细" cannot pass it. The `ReadonlySet<string>` therefore records *collapsed* providerKeys (empty set = all expanded; row-header click toggles) — the state shape and click-toggle behavior from the brief are preserved, semantics inverted to satisfy the test.
3. **Unpriced notice names no models.** With expanded detail rows, the unpriced model's displayName ('goblin-9x') is already in the DOM; the brief's test 3 requires `getByText(/goblin-9x/)` to match EXACTLY one element, so the notice cannot also carry the names (it would be a second match and fail the test). The notice renders a new key `unpriced.intro` ("以下模型未配置单价,未计入金额" / "The following models have no configured price and are not counted in amounts"); the model names remain visible in the expanded detail rows directly above it. The brief's `unpriced.notice` ({models}) key stays in both dictionaries (untouched, currently unused).
4. **Top-sessions table has no 金额 column.** Brief prose lists 金额 for session rows, but the authoritative wire type `SessionUsageRow` (brief Interfaces win) carries no per-session amount, and none is derivable client-side. The table shows title/cwd-tail + four buckets.
5. **New locale keys:** `estimate.title` (amount-card label / amount column header) and `unpriced.intro` — added to zh AND en (key parity intact; locales.spec passes). Sanctioned by the dispatch ("组件需要的 key 若缺,可追加到 zh/en").
6. **New file css-modules.d.ts** (copy of client-ui-git's) — required for `tsc` to type the `.module.css` import; not listed in the brief's Files but matches both in-repo precedents (client-ui-git, client-ui-memory).
7. **Test command form:** the brief's `pnpm --filter dsh-client-ui-usage exec vitest run tests/usage-section.spec.tsx` finds no files (the root vitest.config.ts include globs are `packages/*/tests/**`); the equivalent root invocation is used instead (same suite, same config).

## Concerns
- ui-renderer lib is unbuilt in the harness checkout; once it IS built elsewhere, a future change could switch index.ts back to the brief's `ctx.slots` Context-merge form. The structural surface is intentionally minimal (inject/register only).
- Bundle purity grep 0 verified on the current build; `dsh-usage-host/shared` (one route const + pure helpers) now inlines into lib/client.js by design (neverBundle covers only @deepseek-ai/* + react).

---

# Task 12 Fix Round 1 — three Important findings

## Status: DONE

Commit: `0c7207f fix(client-ui-usage): service-missing state, 60s polling, sessions card` (branch usage-dashboard; only packages/client-ui-usage touched; one commit).

## Fixes

1. **service-missing state (was a dead key).** controller.ts now exports a tiny typed discriminator `isServiceMissing(error)` — true iff `error instanceof Error && error.message === 'usage: summary route failed with 404'` (the exact surface `run()` throws for non-ok). UsageSection's catch maps it to a new `'missing'` status rendering `t('state.serviceMissing')`; every other rejection still renders `t('state.error')`. Both states keep the retry button.
2. **60s post-success polling.** Success with `response.scanning === true` still re-polls at 5s; success with `scanning === false` now schedules the next poll at `IDLE_POLL_MS = 60_000`. Both go through the one existing `timer` variable cleared by the unchanged `cancelled`-flag + `clearTimeout` cleanup (unmount, dependency change, and error path all share it).
3. **会话数 summary card.** New card after the estimate card: `sessionCount` as the value; a `summary.skipped` sub-line rendered only when `skippedSessions > 0`. New locale keys `summary.sessions` + `summary.skipped` added to zh AND en — key parity holds (locales.spec passes unchanged).

## TDD evidence

- RED: `pnpm exec vitest run packages/client-ui-usage/tests/usage-section.spec.tsx` → **4 failed | 6 passed (10)**, failing for the right reasons:
  - `renders the service-missing state when the route answers 404` → "Unable to find … 使用统计服务未安装或未响应"
  - `schedules exactly one refetch 60s after a settled response` → "expected spy to be called 2 times, but got 1 times"
  - `renders the session count card with a skipped sub-line` and `omits the skipped sub-line …` → "Unable to find an element with the text: 7"
  - (Guard tests passing pre-fix, as expected: 503→error text; unmount-cancel.)
- GREEN (focused): `packages/client-ui-usage/tests/usage-section.spec.tsx` (10) + `controller.spec.ts` (4) → **14 passed (14)**.
- Full suite: `pnpm exec vitest run` → **Test Files 18 passed (18), Tests 146 passed (146)** (baseline 140 + 6 new).
- Build: `pnpm --filter dsh-client-ui-usage build` exit 0. Purity: `grep -c "deepseek-ai" packages/client-ui-usage/lib/client.js` → **0**.

## Files changed
- packages/client-ui-usage/src/client/UsageSection.tsx (fixes 1+2+3)
- packages/client-ui-usage/src/client/controller.ts (export isServiceMissing)
- packages/client-ui-usage/src/client/locales.ts (+2 keys, zh+en)
- packages/client-ui-usage/tests/usage-section.spec.tsx (+6 tests, +afterEach cleanup)

## Brief-vs-plan conflicts noticed beyond the three findings
- **Brief test names encode outdated polling semantics.** `keeps polling while scanning and stops when settled` contradicts the plan's 成功后 60s 定时 (polling never stops now). The test body still passes (it only advances 10s), so I left it untouched for minimality, but the name is misleading going forward.
- **No RTL cleanup in the brief's test harness.** vitest runs without `globals: true`, so @testing-library/react's auto-cleanup never registers and every test leaks its DOM into the next (their assertions only survived by luck of unique texts). I added an explicit `afterEach(() => cleanup())` in the spec.
