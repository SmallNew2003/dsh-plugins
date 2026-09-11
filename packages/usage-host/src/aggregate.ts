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
    sessionCount: records.length,
    totals,
    providers,
    daily: dailyRows,
    topSessions: sessionRows.slice(0, limit),
    unpricedModels: [...unpriced].sort(),
    estimate: anyPriced ? { totalUsd } : undefined,
  }
}
