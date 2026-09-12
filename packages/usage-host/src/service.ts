/**
 * Scan orchestration: sessionQuery corpus in, cached summary response out.
 * One background pass at a time; the persisted index plus the cheap
 * event-count probe keep steady-state refreshes off unchanged sessions. When
 * the corpus offers no probe, change detection falls back to a full re-read
 * (correct but slow), throttled by refreshMs.
 *
 * @module dsh-usage-host/service
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { aggregateSessions, type AggregateInput } from './aggregate.ts'
import { foldSessionUsage, type RawUsageEvent } from './fold-usage.ts'
import { buildNormalizer, loadModelRegistry } from './registry.ts'
import type { UsageBuckets, UsageSummaryResponse } from './shared.ts'
import { entryOf, loadIndex, saveIndexAtomic, type SessionIndexEntry } from './usage-index.ts'

export interface SessionQueryLike {
  listSessions(): Promise<Array<{ header: { id: string; createdAt: number; cwd?: string } }>>
  readSession(id: string): Promise<{ session: { id: string; createdAt: number; cwd?: string }; events: readonly RawUsageEvent[] }>
  readTitle(id: string): Promise<{ title: string } | undefined>
  /** Optional cheap change probe: the session's current raw event count. */
  eventCount?(id: string): Promise<number | undefined>
}

export interface UsageServiceOptions {
  readonly registryOverridesPath?: string
  readonly indexPath?: string
  /** 两次扫描之间的最小间隔毫秒;测试传 0。 */
  readonly refreshMs?: number
}

const EMPTY_TOTALS: UsageBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

export class UsageService {
  private readonly sessionQuery: SessionQueryLike
  private readonly indexPath: string
  private readonly registryOverridesPath: string
  private readonly refreshMs: number
  private scanning = false
  private lastScanAt = 0
  private cached: UsageSummaryResponse | undefined

  constructor(sessionQuery: SessionQueryLike, options: UsageServiceOptions = {}) {
    this.sessionQuery = sessionQuery
    this.registryOverridesPath = options.registryOverridesPath
      ?? join(homedir(), '.dsh', 'storages', 'usage-host', 'models.json')
    this.refreshMs = options.refreshMs ?? 30_000
    this.indexPath = options.indexPath ?? join(homedir(), '.dsh', 'storages', 'usage-host', 'index.json')
  }

  dispose(): void {
    this.scanning = false
  }

  summary(limit = 20): UsageSummaryResponse {
    if (!this.scanning && Date.now() - this.lastScanAt >= this.refreshMs) void this.scan(limit)
    if (this.cached === undefined) {
      return {
        generatedAt: Date.now(), scanning: true, sessionCount: 0, skippedSessions: 0,
        totals: EMPTY_TOTALS, providers: [], daily: [], topSessions: [],
        unpricedModels: [], estimate: undefined,
      }
    }
    return { ...this.cached, topSessions: this.cached.topSessions.slice(0, limit) }
  }

  private async scan(limit: number): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const normalizer = buildNormalizer(loadModelRegistry(this.registryOverridesPath))
      const index = loadIndex(this.indexPath, normalizer.version)
      const records = await this.sessionQuery.listSessions()
      const sessions: Record<string, SessionIndexEntry> = {}
      let skipped = 0

      for (const record of records) {
        const id = record.header.id
        const cachedEntry = index.sessions[id]
        try {
          sessions[id] = cachedEntry === undefined
            ? await this.refresh(id, undefined)
            : await this.refreshOrReuse(id, cachedEntry)
        } catch {
          skipped += 1
          if (cachedEntry !== undefined) sessions[id] = cachedEntry
        }
      }

      await saveIndexAtomic(this.indexPath, { version: 1, normalizerVersion: normalizer.version, sessions })
      const headerOf = new Map(records.map(record => [record.header.id, record.header]))
      const inputs: AggregateInput[] = Object.entries(sessions).map(([sessionId, entry]) => {
        const header = headerOf.get(sessionId)
        return {
          sessionId,
          ...(entry.title === undefined ? {} : { title: entry.title }),
          createdAt: header?.createdAt ?? 0,
          ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
          fold: {
            eventCount: entry.eventCount,
            totals: sumEntries([entry]),
            routes: new Map(Object.entries(entry.routes)),
            daily: new Map(Object.entries(entry.daily)),
          },
        }
      })
      const views = aggregateSessions(inputs, normalizer, limit)
      this.cached = {
        generatedAt: Date.now(),
        scanning: false,
        skippedSessions: skipped,
        ...views,
      }
    } catch (error) {
      // Containment: summary() fires scan() fire-and-forget, so a rejection
      // here would be unhandled and abort the host process. Keep the previous
      // cache untouched (a partial result must never replace a good one) and
      // log once; lastScanAt still advances below so the refreshMs throttle
      // holds and a healthy corpus is picked up on the next window.
      console.warn('[dsh-usage-host] usage scan failed; keeping the previous summary', error)
    } finally {
      this.scanning = false
      this.lastScanAt = Date.now()
    }
  }

  /** 全量读取并折叠一个会话(新会话,或回退路径)。 */
  private async refresh(id: string, previous: SessionIndexEntry | undefined): Promise<SessionIndexEntry> {
    const loaded = await this.sessionQuery.readSession(id)
    const fold = foldSessionUsage(loaded.events)
    const title = (await this.sessionQuery.readTitle(id))?.title ?? previous?.title
    return entryOf(fold, title)
  }

  /** 索引命中:探针短路或 eventCount 相同即复用;否则全量重折。 */
  private async refreshOrReuse(id: string, cachedEntry: SessionIndexEntry): Promise<SessionIndexEntry> {
    const probe = this.sessionQuery.eventCount
    if (probe !== undefined) {
      const count = await probe(id)
      if (count === cachedEntry.eventCount) return cachedEntry
      return this.refresh(id, cachedEntry)
    }
    const loaded = await this.sessionQuery.readSession(id)
    if (loaded.events.length === cachedEntry.eventCount) return cachedEntry
    const fold = foldSessionUsage(loaded.events)
    const title = (await this.sessionQuery.readTitle(id))?.title ?? cachedEntry.title
    return entryOf(fold, title)
  }
}

function sumEntries(entries: readonly SessionIndexEntry[]): UsageBuckets {
  const totals = { ...EMPTY_TOTALS }
  for (const entry of entries) {
    for (const buckets of Object.values(entry.routes)) {
      totals.uncachedInputTokens += buckets.uncachedInputTokens
      totals.outputTokens += buckets.outputTokens
      totals.cacheReadTokens += buckets.cacheReadTokens
      totals.cacheWriteTokens += buckets.cacheWriteTokens
    }
  }
  return totals
}
