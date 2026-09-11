/**
 * Wire vocabulary shared with the browser package: the summary route path and
 * its response payload types. Browser-safe by construction (types plus one
 * pure helper).
 *
 * @module dsh-usage-host/shared
 */

/** The one usage route: GET-only, behind the connection browser trust fence. */
export const USAGE_SUMMARY_ROUTE = '/dsh-usage/summary'

/** The four disjoint provider-reported buckets. Reasoning is inside output. */
export interface UsageBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Sum of the four buckets — the share denominator and sort key. */
export function usageTotal(buckets: UsageBuckets): number {
  return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** One canonical model's usage under one provider. */
export interface ModelUsageRow {
  readonly model: string
  readonly displayName: string
  /** false = 未识别模型:aliases 即原始名,不计价。 */
  readonly recognized: boolean
  /** 归并到该 canonical 模型出现过的原始 model 名列表。 */
  readonly aliases: readonly string[]
  readonly buckets: UsageBuckets
  /** 估算金额(USD);undefined = 未配置单价。 */
  readonly usd: number | undefined
}

/** One provider row with its model breakdown. */
export interface ProviderUsageRow {
  readonly provider: string
  readonly displayName: string
  readonly buckets: UsageBuckets
  /** 0..1,分母为全部四桶总和。 */
  readonly share: number
  readonly models: readonly ModelUsageRow[]
}

/** One local-calendar day of usage. */
export interface DailyUsageRow {
  /** YYYY-MM-DD in the host's local timezone. */
  readonly date: string
  readonly buckets: UsageBuckets
}

/** One session's usage for the Top list. */
export interface SessionUsageRow {
  readonly sessionId: string
  readonly title: string | undefined
  readonly cwd: string | undefined
  readonly createdAt: number
  readonly buckets: UsageBuckets
}

/** The GET USAGE_SUMMARY_ROUTE payload. */
export interface UsageSummaryResponse {
  readonly generatedAt: number
  /** true = 后台首次/全量扫描进行中,前端应轮询。 */
  readonly scanning: boolean
  /** 已纳入统计的会话数(不含 skipped)。 */
  readonly sessionCount: number
  /** 读取/校验失败被跳过的会话数。 */
  readonly skippedSessions: number
  readonly totals: UsageBuckets
  readonly providers: readonly ProviderUsageRow[]
  readonly daily: readonly DailyUsageRow[]
  readonly topSessions: readonly SessionUsageRow[]
  /** 未配置单价、未计入金额的 canonical 模型 id。 */
  readonly unpricedModels: readonly string[]
  /** 全部已计价模型金额合计(USD 估算);undefined = 一个可计价模型都没有。 */
  readonly estimate: { readonly totalUsd: number } | undefined
}
