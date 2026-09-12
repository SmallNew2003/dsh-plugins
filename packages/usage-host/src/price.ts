/**
 * USD estimation from buckets and a unit-price row. Estimates only — never a
 * billing input; the registry table is hand-maintained.
 *
 * @module dsh-usage-host/price
 */

import type { ModelPricing } from './registry.ts'
import type { UsageBuckets } from './shared.ts'

export function priceBuckets(buckets: UsageBuckets, pricing: ModelPricing): number {
  const million = 1e6
  return (buckets.uncachedInputTokens / million) * pricing.input
    + (buckets.cacheReadTokens / million) * pricing.cacheRead
    + (buckets.cacheWriteTokens / million) * pricing.cacheWrite
    + (buckets.outputTokens / million) * pricing.output
}
