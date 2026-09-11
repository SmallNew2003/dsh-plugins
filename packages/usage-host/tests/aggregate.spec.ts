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

function message(provider: string, model: string, output: number, day = 11, turn = 1): RawUsageEvent {
  return {
    type: 'assistant/message',
    time: new Date(2026, 8, day).getTime(),
    data: { turn, step: 1, usage: { inputTokens: 0, outputTokens: output }, message: { source: { provider, model } } },
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
      record('a', [message('deepseek', 'deepseek-v4-flash', 2, 11), message('deepseek', 'deepseek-v4-flash', 1, 10, 2)]),
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
