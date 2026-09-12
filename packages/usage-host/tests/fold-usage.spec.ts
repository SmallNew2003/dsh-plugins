import { describe, expect, it } from 'vitest'
import { emptyBuckets, foldSessionUsage, routeKey, type RawUsageEvent } from '../src/fold-usage.ts'

const SOURCE = { message: { source: { provider: 'deepseek', model: 'deepseek-v4-flash' } } }

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
      message(1, 1, { inputTokens: 120, outputTokens: 12 }, { message: { source: { provider: 'anthropic', model: 'claude-x' } } }),
    ])
    expect(fold.totals.outputTokens).toBe(22)
    expect(fold.routes.get(routeKey('deepseek', 'deepseek-v4-flash'))?.outputTokens).toBe(10)
    expect(fold.routes.get(routeKey('anthropic', 'claude-x'))?.outputTokens).toBe(12)
  })

  it('falls back to the last stream usage record and attributes unattributed attempts', () => {
    const stream = [{ type: 'chunk', chunk: { type: 'text-delta', text: 'x' } }, { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 30, outputTokens: 5 } } }]
    const fold = foldSessionUsage([{ type: 'assistant/attempt', time: 0, data: { turn: 2, step: 1, stream } }])
    expect(fold.routes.get(routeKey('unattributed', 'unattributed')))
      .toEqual({ uncachedInputTokens: 30, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('does not count events with no usage and no stream', () => {
    const fold = foldSessionUsage([
      { type: 'user/message', time: 0, data: {} },
      { type: 'assistant/message', time: 0, data: { turn: 1, step: 1, ...SOURCE } },
    ])
    expect(fold.totals).toEqual(emptyBuckets())
    expect(fold.routes.size).toBe(0)
    expect(fold.daily.size).toBe(0)
  })

  it('prefers the usage field over the stream when both are present', () => {
    const stream = [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 999, outputTokens: 999 } } }]
    const fold = foldSessionUsage([
      { type: 'assistant/message', time: 0, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 2 }, stream, ...SOURCE } },
    ])
    expect(fold.totals).toEqual({ uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 })
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
