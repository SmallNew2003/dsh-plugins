### Task 2: fold-usage.ts 会话日志折叠纯函数(TDD)

**Files:**
- Create: packages/usage-host/src/fold-usage.ts
- Test: packages/usage-host/tests/fold-usage.spec.ts

**Interfaces:**
- Consumes: UsageBuckets(Task 1);lastAssistantStreamChunk from @deepseek-ai/dsh-llm/assistant-stream。
- Produces:
  - interface RawUsageEvent — { type: string; time: number; data: RawUsageEventData }
  - interface RawUsageEventData — { turn?: number; step?: number; usage?: unknown; stream?: readonly unknown[]; message?: { source?: { provider?: string; model?: string } } }
  - interface SessionUsageFold — { eventCount: number; totals: UsageBuckets; routes: Map<string, UsageBuckets>; daily: Map<string, UsageBuckets> }
  - routeKey(provider, model):string —— provider、NUL 分隔符(转义序列 \u0000)、model 三段拼接;无 source 的尝试 routeKey 为 unattributed + NUL + unattributed
  - dayKeyOf(time: number): string(本地日界 YYYY-MM-DD)
  - emptyBuckets(): UsageBuckets
- 口径规则(实现必须逐条满足,测试逐条覆盖):
  1. 样本来源:data.usage 优先,否则 lastAssistantStreamChunk(data.stream, 'usage')?.usage;都没有 → 事件不计。
  2. 仅处理 assistant/message 与 assistant/attempt;llm/retry-started 在其 (turn, step) 等于 last 槽时清空 last 槽。
  3. last 槽命中同 (turn, step) 且四桶完全相等 → 幂等跳过。
  4. last 槽命中同 (turn, step) 但桶不同 → 从 last 的 routeKey、last 的日桶与 totals 减去旧桶,再加新桶(跨供应商替换也正确)。
  5. usage 四桶必须为非负安全整数(cache 缺省按 0);非法则整个事件不计。

- [ ] **Step 1: 写失败测试**

```
ts
import { describe, expect, it } from 'vitest'
import { foldSessionUsage, routeKey, type RawUsageEvent } from '../src/fold-usage.ts'

const SOURCE = { source: { provider: 'deepseek', model: 'deepseek-v4-flash' } }

function message(turn: number, step: number, usage: Record<string, number>, extra: Partial<RawUsageEvent['data']> = {}): RawUsageEvent {
  return { type: 'assistant/message', time: Date.UTC(2026, 8, 11, 2), data: { turn, step, usage, ...SOURCE, ...extra } }
}

describe('foldSessionUsage', () => {
  it('accumulates usage with provider attribution', () => {
    const fold = foldSessionUsage([
      message(1, 1, { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 5000 }),
      message(1, 2, { inputTokens: 2000, outputTokens: 300 }),
    ])
    expect(fold.eventCount).toBe(2)
    expect(fold.totals).toEqual({ uncachedInputTokens: 3000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 0 })
    expect(fold.routes.get(routeKey('deepseek', 'deepseek-v4-flash')))
      .toEqual({ uncachedInputTokens: 3000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 0 })
  })

  it('is idempotent for the same repeated (turn, step) sample', () => {
    const fold = foldSessionUsage([message(1, 1, { inputTokens: 100, outputTokens: 10 }), message(1, 1, { inputTokens: 100, outputTokens: 10 })])
    expect(fold.totals.outputTokens).toBe(10)
  })

  it('replaces the sample when the same (turn, step) reports new buckets', () => {
    const fold = foldSessionUsage([message(1, 1, { inputTokens: 100, outputTokens: 10 }), message(1, 1, { inputTokens: 150, outputTokens: 20 })])
    expect(fold.totals).toEqual({ uncachedInputTokens: 150, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('re-adds after llm/retry-started closes the slot, including across routes', () => {
    const fold = foldSessionUsage([
      message(1, 1, { inputTokens: 100, outputTokens: 10 }),
      { type: 'llm/retry-started', time: 0, data: { turn: 1, step: 1 } },
      message(1, 1, { inputTokens: 120, outputTokens: 12 }, { source: { provider: 'anthropic', model: 'claude-x' } }),
    ])
    expect(fold.totals.outputTokens).toBe(22)
    expect(fold.routes.get(routeKey('deepseek', 'deepseek-v4-flash'))?.outputTokens).toBe(10)
    expect(fold.routes.get(routeKey('anthropic', 'claude-x'))?.outputTokens).toBe(12)
  })

  it('falls back to the last stream usage record and attributes unattributed attempts', () => {
    const stream = [{ delta: 'x' }, { usage: { inputTokens: 30, outputTokens: 5 } }]
    const fold = foldSessionUsage([{ type: 'assistant/attempt', time: 0, data: { turn: 2, step: 1, stream } }])
    expect(fold.routes.get(routeKey('unattributed', 'unattributed')))
      .toEqual({ uncachedInputTokens: 30, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('ignores events with invalid usage buckets', () => {
    const fold = foldSessionUsage([message(1, 1, { inputTokens: -5, outputTokens: 1 }), message(1, 2, { inputTokens: 10, outputTokens: 2 })])
    expect(fold.totals.uncachedInputTokens).toBe(10)
  })

  it('buckets by local-calendar day and subtracts replacements from the old day', () => {
    const morning = { type: 'assistant/message', time: new Date(2026, 8, 11, 1).getTime(), data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10 }, ...SOURCE } }
    const evening = { type: 'assistant/message', time: new Date(2026, 8, 11, 23).getTime(), data: { turn: 1, step: 1, usage: { inputTokens: 200, outputTokens: 20 }, ...SOURCE } }
    const fold = foldSessionUsage([morning, evening])
    expect(fold.daily.size).toBe(1)
    expect(fold.daily.get('2026-09-11')).toEqual({ uncachedInputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('reports the raw event count for index keying', () => {
    const events = [message(1, 1, { inputTokens: 1, outputTokens: 1 }), { type: 'user/message', time: 0, data: {} }]
    expect(foldSessionUsage(events).eventCount).toBe(2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/fold-usage.spec.ts
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 src/fold-usage.ts**

```
ts
/**
 * Route-attributed usage fold over one session's raw log events.
 *
 * Mirrors the upstream token-meter tokenUsage projection fold exactly, with
 * one extension: the last-wins slot carries a routeKey so replacement
 * subtracts from the route that produced the superseded sample.
 *
 * @module dsh-usage-host/fold-usage
 */

import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { UsageBuckets } from './shared.ts'

export interface RawUsageEventData {
  readonly turn?: number
  readonly step?: number
  readonly usage?: unknown
  readonly stream?: readonly unknown[]
  readonly message?: { readonly source?: { readonly provider?: string; readonly model?: string } }
}

export interface RawUsageEvent {
  readonly type: string
  readonly time: number
  readonly data: RawUsageEventData
}

export interface SessionUsageFold {
  readonly eventCount: number
  readonly totals: UsageBuckets
  readonly routes: Map<string, UsageBuckets>
  readonly daily: Map<string, UsageBuckets>
}

const UNATTRIBUTED = routeKey('unattributed', 'unattributed')

export function routeKey(provider: string, model: string): string {
  return provider + '\u0000' + model
}

export function emptyBuckets(): UsageBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function bucketsOf(usage: unknown): UsageBuckets | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const input = record['inputTokens']
  const output = record['outputTokens']
  if (!isCount(input) || !isCount(output)) return undefined
  const cacheRead = record['cacheReadTokens'] ?? 0
  const cacheWrite = record['cacheWriteTokens'] ?? 0
  if (!isCount(cacheRead) || !isCount(cacheWrite)) return undefined
  return { uncachedInputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

function sampleOf(event: RawUsageEvent): UsageBuckets | undefined {
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return bucketsOf(event.data.usage)
  const stream = event.data.stream
  if (stream === undefined) return undefined
  return bucketsOf(lastAssistantStreamChunk(stream as never, 'usage')?.usage)
}

function bucketsEqual(left: UsageBuckets, right: UsageBuckets): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

function addInto(map: Map<string, UsageBuckets>, key: string, buckets: UsageBuckets, sign: 1 | -1): void {
  const current = map.get(key) ?? emptyBuckets()
  map.set(key, {
    uncachedInputTokens: current.uncachedInputTokens + sign * buckets.uncachedInputTokens,
    outputTokens: current.outputTokens + sign * buckets.outputTokens,
    cacheReadTokens: current.cacheReadTokens + sign * buckets.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + sign * buckets.cacheWriteTokens,
  })
}

/** Local-calendar YYYY-MM-DD of one epoch-ms timestamp. */
export function dayKeyOf(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return String(date.getFullYear()) + '-' + month + '-' + day
}

function sourceOf(event: RawUsageEvent): string {
  const provider = event.data.message?.source?.provider
  const model = event.data.message?.source?.model
  return provider !== undefined && provider.length > 0 && model !== undefined && model.length > 0
    ? routeKey(provider, model)
    : UNATTRIBUTED
}

export function foldSessionUsage(events: readonly RawUsageEvent[]): SessionUsageFold {
  const totals = emptyBuckets()
  const routes = new Map<string, UsageBuckets>()
  const daily = new Map<string, UsageBuckets>()
  let last: { turn: number; step: number; routeKey: string; day: string; buckets: UsageBuckets } | null = null

  for (const event of events) {
    if (event.type === 'llm/retry-started') {
      if (last !== null && last.turn === event.data.turn && last.step === event.data.step) last = null
      continue
    }
    const buckets = sampleOf(event)
    if (buckets === undefined) continue
    const turn = event.data.turn
    const step = event.data.step
    if (!isCount(turn) || !isCount(step)) continue

    const key = sourceOf(event)
    const day = dayKeyOf(event.time)
    const previous = last !== null && last.turn === turn && last.step === step ? last : undefined
    if (previous !== undefined && bucketsEqual(previous.buckets, buckets)) continue

    if (previous !== undefined) {
      addInto(routes, previous.routeKey, previous.buckets, -1)
      addInto(daily, previous.day, previous.buckets, -1)
      totals.uncachedInputTokens -= previous.buckets.uncachedInputTokens
      totals.outputTokens -= previous.buckets.outputTokens
      totals.cacheReadTokens -= previous.buckets.cacheReadTokens
      totals.cacheWriteTokens -= previous.buckets.cacheWriteTokens
    }
    addInto(routes, key, buckets, 1)
    addInto(daily, day, buckets, 1)
    totals.uncachedInputTokens += buckets.uncachedInputTokens
    totals.outputTokens += buckets.outputTokens
    totals.cacheReadTokens += buckets.cacheReadTokens
    totals.cacheWriteTokens += buckets.cacheWriteTokens
    last = { turn, step, routeKey: key, day, buckets }
  }

  return { eventCount: events.length, totals, routes, daily }
}
```

- [ ] **Step 4: 运行确认通过**

Run: pnpm --filter dsh-usage-host exec vitest run tests/fold-usage.spec.ts
Expected: PASS。

- [ ] **Step 5: 对照上游口径(抽检)**

Run: grep -n "retry-started" /Users/jelvin/000_source_code/deepseek-harness/packages/llm/token-meter/src/usage-projection.ts
人工核对实现与该文件 apply() 的分支顺序一致(retry 先于样本处理、幂等先于替换)。

- [ ] **Step 6: Commit**

```
bash
git add packages/usage-host/src/fold-usage.ts packages/usage-host/tests/fold-usage.spec.ts
git commit -m "feat(usage-host): route-attributed session usage fold"
```

---



