/** Controller behavior: in-flight dedupe, 5s TTL, null-origin fallback, error surface. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageController } from '../src/client/controller.ts'
import { USAGE_SUMMARY_ROUTE, type UsageSummaryResponse } from 'dsh-usage-host/shared'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** One scripted fetch: records calls, answers per-URL canned replies. */
function stubFetch(replies: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const reply = replies[url] ?? { status: 404, body: { code: 'usage/failed', message: 'no script' } }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetcher)
  return { calls, fetcher }
}

/** One minimal summary payload; every field the controller never inspects is dropped. */
function summaryBody(): UsageSummaryResponse {
  return {
    generatedAt: 1,
    scanning: false,
    sessionCount: 3,
    skippedSessions: 0,
    totals: { uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
    providers: [],
    daily: [],
    topSessions: [],
    unpricedModels: [],
    estimate: undefined,
  }
}

describe('UsageController', () => {
  it('falls back to the dsh.internal host base when location.origin is untrustworthy', async () => {
    vi.stubGlobal('location', { origin: 'null' })
    const body = summaryBody()
    const { calls } = stubFetch({ ['http://dsh.internal' + USAGE_SUMMARY_ROUTE + '?limit=20']: { status: 200, body } })
    const controller = new UsageController()
    const result = await controller.fetchSummary()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://dsh.internal/dsh-usage/summary?limit=20')
    expect(calls[0]?.init?.headers).toEqual({ accept: 'application/json' })
    expect(result).toEqual(body)
  })

  it('shares one in-flight request across concurrent callers', async () => {
    const body = summaryBody()
    const { calls, fetcher } = stubFetch({ [(globalThis.location?.origin ?? 'http://dsh.internal') + USAGE_SUMMARY_ROUTE + '?limit=20']: { status: 200, body } })
    const controller = new UsageController()
    const first = controller.fetchSummary()
    const second = controller.fetchSummary()
    const [a, b] = await Promise.all([first, second])
    // The async facade wraps the shared in-flight; identity holds on the resolved value.
    expect(b).toBe(a)
    expect(a).toEqual(body)
    expect(calls).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('throws with the status code when the route answers non-ok', async () => {
    stubFetch({ [(globalThis.location?.origin ?? 'http://dsh.internal') + USAGE_SUMMARY_ROUTE + '?limit=20']: { status: 503, body: { code: 'usage/busy', message: 'scanning' } } })
    const controller = new UsageController()
    await expect(controller.fetchSummary()).rejects.toThrow('usage: summary route failed with 503')
  })

  it('serves the last successful response inside the TTL without re-fetching', async () => {
    vi.useFakeTimers()
    const body = summaryBody()
    const { calls } = stubFetch({ [(globalThis.location?.origin ?? 'http://dsh.internal') + USAGE_SUMMARY_ROUTE + '?limit=20']: { status: 200, body } })
    const controller = new UsageController()
    const first = await controller.fetchSummary()
    vi.advanceTimersByTime(4_000)
    const second = await controller.fetchSummary()
    expect(second).toBe(first)
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(1_500)
    const third = await controller.fetchSummary()
    expect(third).toEqual(body)
    expect(calls).toHaveLength(2)
  })
})
