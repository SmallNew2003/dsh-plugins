/**
 * Route-attributed usage fold over one session's raw log events.
 *
 * Mirrors the upstream token-meter tokenUsage projection fold exactly, with
 * one extension: the last-wins slot carries a routeKey so replacement
 * subtracts from the route that produced the superseded sample.
 *
 * The stream scan below mirrors upstream dsh-llm's lastAssistantStreamChunk
 * (record.type === 'chunk', backwards, first chunk-type hit) because the
 * pinned @deepseek-ai/dsh-llm checkout has not built its /assistant-stream
 * subpath yet; restore the upstream import once lib/types/assistant-stream.js
 * ships.
 *
 * @module dsh-usage-host/fold-usage
 */

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

/** Upstream lastAssistantStreamChunk scan: backwards over compact records. */
function lastUsageChunk(stream: readonly unknown[]): { readonly usage: unknown } | undefined {
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index] as { type?: unknown; chunk?: { type?: unknown; usage?: unknown } }
    if (record.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk as { readonly usage: unknown }
  }
  return undefined
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
  return bucketsOf(lastUsageChunk(stream)?.usage)
}

function bucketsEqual(left: UsageBuckets, right: UsageBuckets): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

function replaceTotals(totals: UsageBuckets, previous: UsageBuckets | undefined, next: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
    outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
  }
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
  let totals = emptyBuckets()
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
    }
    totals = replaceTotals(totals, previous?.buckets, buckets)
    addInto(routes, key, buckets, 1)
    addInto(daily, day, buckets, 1)
    last = { turn, step, routeKey: key, day, buckets }
  }

  return { eventCount: events.length, totals, routes, daily }
}
