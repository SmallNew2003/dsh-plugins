### Task 5: aggregate.ts 四视图聚合(TDD)

**Files:**
- Create: packages/usage-host/src/aggregate.ts
- Test: packages/usage-host/tests/aggregate.spec.ts

**Interfaces:**
- Consumes: SessionUsageFold(Task 2)、Normalizer(Task 3)、priceBuckets(Task 4)、usageTotal 与全部 Row 类型(Task 1)。
- Produces:
  - interface AggregateInput — { sessionId: string; title?: string; cwd?: string; createdAt: number; fold: SessionUsageFold }
  - aggregateSessions(records: readonly AggregateInput[], normalizer: Normalizer, limit: number): Omit<UsageSummaryResponse, 'generatedAt' | 'scanning' | 'skippedSessions'>
  - 排序:providers 与 models 按 usageTotal 降序;daily 按日期字符串升序;topSessions 按 usageTotal 降序取前 limit;share = providerTotal / grandTotal(grandTotal 为 0 时 share = 0)。aliases 收集归并到该 canonical 的全部原始 model 名(recognized 与否都收集)。

- [ ] **Step 1: 写失败测试**

```
ts
import { describe, expect, it } from 'vitest'
import { buildNormalizer, type ModelRegistryData } from '../src/registry.ts'
import { aggregateSessions, type AggregateInput } from '../src/aggregate.ts'
import { emptyBuckets, foldSessionUsage, type RawUsageEvent } from '../src/fold-usage.ts'

const registry: ModelRegistryData = {
  providers: { deepseek: { displayName: 'DeepSeek', aliases: [] } },
  models: { 'deepseek-v4-flash': { displayName: 'DeepSeek V4 Flash', aliases: ['ds-v4-flash'] } },
}
const normalizer = buildNormalizer(registry)

function record(sessionId: string, events: RawUsageEvent[], extra: Partial<AggregateInput> = {}): AggregateInput {
  return { sessionId, createdAt: 0, fold: foldSessionUsage(events), ...extra }
}

function message(provider: string, model: string, output: number, day = 11): RawUsageEvent {
  return {
    type: 'assistant/message',
    time: new Date(2026, 8, day).getTime(),
    data: { turn: 1, step: 1, usage: { inputTokens: 0, outputTokens: output }, message: { source: { provider, model } } },
  }
}

describe('aggregateSessions', () => {
  it('groups aliased model ids under one canonical model and provider', () => {
    const result = aggregateSessions([
      record('a', [message('deepseek', 'deepseek-v4-flash', 100)]),
      record('b', [message('deepseek', 'ds-v4-flash', 50)]),
    ], normalizer, 20)
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]!.displayName).toBe('DeepSeek')
    const model = result.providers[0]!.models[0]!
    expect(model.model).toBe('deepseek-v4-flash')
    expect(model.buckets.outputTokens).toBe(150)
    expect(model.aliases).toEqual(expect.arrayContaining(['deepseek-v4-flash', 'ds-v4-flash']))
    expect(model.usd).toBeUndefined()
  })

  it('lists unrecognized models unpriced and reports them', () => {
    const result = aggregateSessions([record('a', [message('mystery', 'goblin-9x', 10)])], normalizer, 20)
    expect(result.providers[0]!.models[0]!.recognized).toBe(false)
    expect(result.providers[0]!.models[0]!.usd).toBeUndefined()
    expect(result.unpricedModels).toContain('goblin-9x')
  })

  it('prices recognized models from the registry table', () => {
    const priced = buildNormalizer({
      models: { m: { displayName: 'M', pricing: { input: 0, cacheRead: 0, cacheWrite: 0, output: 1 } } },
    })
    const result = aggregateSessions([record('a', [message('x', 'm', 1_000_000)])], priced, 20)
    expect(result.providers[0]!.models[0]!.usd).toBeCloseTo(1, 10)
    expect(result.estimate?.totalUsd).toBeCloseTo(1, 10)
    expect(result.unpricedModels).toEqual([])
  })

  it('computes provider share from the four-bucket sum', () => {
    const result = aggregateSessions([
      record('a', [message('deepseek', 'deepseek-v4-flash', 75)]),
      record('b', [message('other', 'goblin-9x', 25)]),
    ], normalizer, 20)
    expect(result.providers[0]!.share).toBeCloseTo(0.75, 6)
    expect(result.totals.outputTokens).toBe(100)
  })

  it('sorts and limits top sessions by total', () => {
    const result = aggregateSessions([
      record('small', [message('deepseek', 'deepseek-v4-flash', 1)]),
      record('big', [message('deepseek', 'deepseek-v4-flash', 9)]),
    ], normalizer, 1)
    expect(result.topSessions).toHaveLength(1)
    expect(result.topSessions[0]!.sessionId).toBe('big')
    expect(result.topSessions[0]!.buckets.outputTokens).toBe(9)
    expect(result.topSessions[0]!.title).toBeUndefined()
  })

  it('merges daily rows ascending across sessions', () => {
    const result = aggregateSessions([
      record('a', [message('deepseek', 'deepseek-v4-flash', 2, 11), message('deepseek', 'deepseek-v4-flash', 1, 10)]),
    ], normalizer, 20)
    expect(result.daily.map(row => row.date)).toEqual(['2026-09-10', '2026-09-11'])
    expect(result.daily[1]!.buckets.outputTokens).toBe(2)
  })

  it('handles an empty corpus', () => {
    const result = aggregateSessions([], normalizer, 20)
    expect(result.providers).toEqual([])
    expect(result.totals).toEqual(emptyBuckets())
    expect(result.estimate).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/aggregate.spec.ts
Expected: FAIL。

- [ ] **Step 3: 实现 src/aggregate.ts**

纯函数无 IO。结构:
1. 跨会话按 routeKey 汇总 fold.routes 到 routeBuckets;fold.daily 同法合并;totals 累加 fold.totals;sessionRows 收集。
2. 每个 routeKey 拆出 provider 与 model(NUL 分隔,indexOf 定位),经 normalizer.normalize 归一,归入 provider → model 两层 Map;aliases 收集原始 model 名;同一 canonical 命中多个 route 时桶累加。
3. 计价:normalizer.modelEntry(canonical)?.pricing → priceBuckets;无 pricing → usd: undefined 且进 unpricedModels;estimate 在任一模型有价时为 { totalUsd: Σ }。
4. provider.displayName 用 normalize 返回的 providerDisplayName。
5. 排序截断如 Interfaces 所述。

```
ts
/**
 * Pure cross-session aggregation: session folds in, the four dashboard views
 * and the price estimate out. No IO.
 *
 * @module dsh-usage-host/aggregate
 */

import { emptyBuckets, type SessionUsageFold } from './fold-usage.ts'
import { priceBuckets } from './price.ts'
import type { Normalizer } from './registry.ts'
import {
  usageTotal,
  type DailyUsageRow,
  type ModelUsageRow,
  type ProviderUsageRow,
  type SessionUsageRow,
  type UsageBuckets,
  type UsageSummaryResponse,
} from './shared.ts'

export interface AggregateInput {
  readonly sessionId: string
  readonly title?: string
  readonly cwd?: string
  readonly createdAt: number
  readonly fold: SessionUsageFold
}

type Views = Omit<UsageSummaryResponse, 'generatedAt' | 'scanning' | 'skippedSessions'>

function mergeInto(target: UsageBuckets, source: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: target.uncachedInputTokens + source.uncachedInputTokens,
    outputTokens: target.outputTokens + source.outputTokens,
    cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
    cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
  }
}

export function aggregateSessions(records: readonly AggregateInput[], normalizer: Normalizer, limit: number): Views {
  const routeBuckets = new Map<string, UsageBuckets>()
  const daily = new Map<string, UsageBuckets>()
  let totals = emptyBuckets()
  const sessionRows: SessionUsageRow[] = []

  for (const record of records) {
    for (const [key, buckets] of record.fold.routes) routeBuckets.set(key, mergeInto(routeBuckets.get(key) ?? emptyBuckets(), buckets))
    for (const [day, buckets] of record.fold.daily) daily.set(day, mergeInto(daily.get(day) ?? emptyBuckets(), buckets))
    totals = mergeInto(totals, record.fold.totals)
    sessionRows.push({
      sessionId: record.sessionId,
      title: record.title,
      cwd: record.cwd,
      createdAt: record.createdAt,
      buckets: record.fold.totals,
    })
  }

  interface ModelAcc { displayName: string; recognized: boolean; aliases: Set<string>; buckets: UsageBuckets }
  interface ProviderAcc { displayName: string; buckets: UsageBuckets; models: Map<string, ModelAcc> }
  const providerAcc = new Map<string, ProviderAcc>()
  const unpriced = new Set<string>()
  let totalUsd = 0
  let anyPriced = false

  for (const [key, buckets] of routeBuckets) {
    const separator = key.indexOf('\u0000')
    const normalized = normalizer.normalize(key.slice(0, separator), key.slice(separator + 1))
    const provider = providerAcc.get(normalized.providerKey) ?? {
      displayName: normalized.providerDisplayName,
      buckets: emptyBuckets(),
      models: new Map<string, ModelAcc>(),
    }
    const model = provider.models.get(normalized.modelKey) ?? {
      displayName: normalized.displayName,
      recognized: normalized.recognized,
      aliases: new Set<string>(),
      buckets: emptyBuckets(),
    }
    model.aliases.add(key.slice(separator + 1))
    provider.buckets = mergeInto(provider.buckets, buckets)
    model.buckets = mergeInto(model.buckets, buckets)
    provider.models.set(normalized.modelKey, model)
    providerAcc.set(normalized.providerKey, provider)
  }

  const grandTotal = usageTotal(totals)
  const providers: ProviderUsageRow[] = []
  for (const [providerKey, row] of providerAcc) {
    const models: ModelUsageRow[] = []
    for (const [modelKey, model] of row.models) {
      const pricing = normalizer.modelEntry(modelKey)?.pricing
      const usd = pricing === undefined ? undefined : priceBuckets(model.buckets, pricing)
      if (usd === undefined) unpriced.add(modelKey)
      else {
        totalUsd += usd
        anyPriced = true
      }
      models.push({
        model: modelKey,
        displayName: model.displayName,
        recognized: model.recognized,
        aliases: [...model.aliases].sort(),
        buckets: model.buckets,
        usd,
      })
    }
    models.sort((left, right) => usageTotal(right.buckets) - usageTotal(left.buckets))
    providers.push({
      provider: providerKey,
      displayName: row.displayName,
      buckets: row.buckets,
      share: grandTotal === 0 ? 0 : usageTotal(row.buckets) / grandTotal,
      models,
    })
  }
  providers.sort((left, right) => usageTotal(right.buckets) - usageTotal(left.buckets))

  const dailyRows: DailyUsageRow[] = [...daily.entries()]
    .map(([date, buckets]) => ({ date, buckets }))
    .sort((left, right) => left.date.localeCompare(right.date))
  sessionRows.sort((left, right) => usageTotal(right.buckets) - usageTotal(left.buckets))

  return {
    totals,
    providers,
    daily: dailyRows,
    topSessions: sessionRows.slice(0, limit),
    unpricedModels: [...unpriced].sort(),
    estimate: anyPriced ? { totalUsd } : undefined,
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: pnpm --filter dsh-usage-host exec vitest run tests/aggregate.spec.ts
Expected: PASS。

- [ ] **Step 5: Commit**

```
bash
git add packages/usage-host/src/aggregate.ts packages/usage-host/tests/aggregate.spec.ts
git commit -m "feat(usage-host): cross-session aggregation views"
```

---



