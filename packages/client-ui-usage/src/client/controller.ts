/**
 * Browser data carrier: one fetch surface for the usage summary route with a
 * short dedupe TTL. One instance per plugin life, shared through the inject
 * face.
 *
 * @module dsh-client-ui-usage/controller
 */

import { USAGE_SUMMARY_ROUTE, type UsageSummaryResponse } from 'dsh-usage-host/shared'

function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

const TTL_MS = 5_000

export class UsageController {
  private readonly fetcher: typeof fetch
  private inflight: Promise<UsageSummaryResponse> | undefined
  private lastResolved: UsageSummaryResponse | undefined
  private fetchedAt = 0

  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.fetcher = fetcher
  }

  async fetchSummary(limit = 20): Promise<UsageSummaryResponse> {
    if (this.inflight !== undefined) return this.inflight
    if (this.lastResolved !== undefined && Date.now() - this.fetchedAt < TTL_MS) return this.lastResolved
    this.inflight = this.run(limit)
      .then((response) => {
        this.fetchedAt = Date.now()
        this.lastResolved = response
        return response
      })
      .finally(() => {
        this.inflight = undefined
      })
    return this.inflight
  }

  private async run(limit: number): Promise<UsageSummaryResponse> {
    const url = new URL(USAGE_SUMMARY_ROUTE + '?limit=' + String(limit), hostBase())
    const response = await this.fetcher(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('usage: summary route failed with ' + String(response.status))
    return await response.json() as UsageSummaryResponse
  }
}
