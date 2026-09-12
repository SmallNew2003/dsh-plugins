import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawUsageEvent } from '../src/fold-usage.ts'
import { UsageService, type SessionQueryLike } from '../src/service.ts'
import { saveIndexAtomic } from '../src/usage-index.ts'

vi.mock('../src/usage-index.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/usage-index.ts')>()
  return { ...actual, saveIndexAtomic: vi.fn(actual.saveIndexAtomic) }
})

const saveSpy = vi.mocked(saveIndexAtomic)

function message(provider: string, model: string, output: number, turn = 1): RawUsageEvent {
  return {
    type: 'assistant/message',
    time: new Date(2026, 8, 11).getTime(),
    data: { turn, step: 1, usage: { inputTokens: 0, outputTokens: output }, message: { source: { provider, model } } },
  }
}

interface FakeSession {
  header: { id: string; createdAt: number; cwd?: string }
  events: RawUsageEvent[]
  title?: string
  failRead?: boolean
}

function makeQuery(sessions: FakeSession[], withProbe: boolean): { query: SessionQueryLike; calls: { listSessions: number; readSession: Record<string, number> } } {
  const calls = { listSessions: 0, readSession: {} as Record<string, number> }
  const byId = new Map(sessions.map(session => [session.header.id, session]))
  const query: SessionQueryLike = {
    listSessions: async () => {
      calls.listSessions += 1
      return sessions.map(session => ({ header: session.header }))
    },
    readSession: async (id: string) => {
      calls.readSession[id] = (calls.readSession[id] ?? 0) + 1
      const session = byId.get(id)!
      if (session.failRead) throw new Error('boom')
      return { session: session.header, events: session.events }
    },
    readTitle: async (id: string) => {
      const title = byId.get(id)?.title
      return title === undefined ? undefined : { title }
    },
    ...(withProbe
      ? { eventCount: async (id: string) => byId.get(id)?.events.length }
      : {}),
  }
  return { query, calls }
}

/** Wait until no background scan is mid-flight (saveIndexAtomic count stable). */
async function quiesce(): Promise<void> {
  const deadline = Date.now() + 2000
  let last = -1
  while (Date.now() < deadline) {
    const current = saveSpy.mock.calls.length
    if (current === last) return
    last = current
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('background scans did not settle')
}

describe('UsageService', () => {
  let dir: string
  let indexPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'usage-service-'))
    indexPath = join(dir, 'index.json')
  })

  afterEach(async () => {
    await quiesce()
    await rm(dir, { recursive: true, force: true })
  })

  function session(id: string, output: number, extra: Partial<FakeSession> = {}): FakeSession {
    return {
      header: { id, createdAt: 1000, cwd: '/tmp/' + id },
      events: [message('deepseek', 'm1', output)],
      title: 't-' + id,
      ...extra,
    }
  }

  it('scans in the background, reports a zero shell first, then the summary', async () => {
    const a = session('a', 10, { failRead: true })
    const b = session('b', 30)
    const { query, calls } = makeQuery([a, b], false)
    const service = new UsageService(query, { indexPath, refreshMs: 0 })

    const first = service.summary()
    expect(first.scanning).toBe(true)
    expect(first.totals).toEqual({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    expect(first.providers).toEqual([])

    await vi.waitFor(() => {
      expect(service.summary().scanning).toBe(false)
    })
    const done = service.summary()
    expect(done.scanning).toBe(false)
    expect(done.sessionCount).toBe(1)
    expect(done.skippedSessions).toBe(1)
    expect(done.totals.outputTokens).toBe(30)
    expect(done.topSessions[0]?.sessionId).toBe('b')
    expect(done.topSessions[0]?.title).toBe('t-b')
    expect(calls.readSession['a']).toBeGreaterThan(0)
  })

  it('picks up a previously failing session on the next scan', async () => {
    const a = session('a', 10, { failRead: true })
    const b = session('b', 30)
    const { query } = makeQuery([a, b], false)
    const service = new UsageService(query, { indexPath, refreshMs: 0 })
    await vi.waitFor(() => { expect(service.summary().scanning).toBe(false) })

    a.failRead = false
    await vi.waitFor(() => {
      const summary = service.summary()
      expect(summary.sessionCount).toBe(2)
      expect(summary.skippedSessions).toBe(0)
      expect(summary.totals.outputTokens).toBe(40)
    })
  })

  it('throttles repeat summary() calls within the refresh window', async () => {
    const { query, calls } = makeQuery([session('a', 10)], false)
    const service = new UsageService(query, { indexPath, refreshMs: 60_000 })
    await vi.waitFor(() => { expect(service.summary().scanning).toBe(false) })
    await quiesce()
    const afterFirstScan = calls.listSessions

    service.summary()
    service.summary()
    service.summary()
    expect(calls.listSessions).toBe(afterFirstScan)
  })

  it('short-circuits unchanged sessions via the eventCount probe and re-reads changed ones', async () => {
    const a = session('a', 10)
    const b = session('b', 30)
    const { query, calls } = makeQuery([a, b], true)
    const service = new UsageService(query, { indexPath, refreshMs: 0 })
    await vi.waitFor(() => { expect(service.summary().scanning).toBe(false) })
    await quiesce()
    expect(calls.readSession).toEqual({ a: 1, b: 1 })

    b.events = [...b.events, message('deepseek', 'm1', 5, 2)]
    await vi.waitFor(() => {
      service.summary()
      expect(calls.readSession['b']).toBeGreaterThanOrEqual(2)
    })
    expect(calls.readSession['a']).toBe(1)
    await quiesce()
    expect(service.summary().totals.outputTokens).toBe(45)
  })

  it('contains a listSessions failure: scan resolves, zero shell kept, throttle holds', async () => {
    // Observable hook: the background scan is awaited directly — it must
    // settle resolved, never reject out of the service. The process-level
    // 'unhandledRejection' listener double-checks the fire-and-forget path.
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const { query, calls } = makeQuery([session('a', 10)], false)
      query.listSessions = async () => {
        calls.listSessions += 1
        throw new Error('corpus down')
      }
      const service = new UsageService(query, { indexPath, refreshMs: 60_000 })

      await expect((service as unknown as { scan(limit: number): Promise<void> }).scan(20)).resolves.toBeUndefined()
      expect(unhandled).toEqual([])
      expect((service as unknown as { scanning: boolean }).scanning).toBe(false)

      // The zero shell is untouched and lastScanAt now throttles the next scan.
      const shell = service.summary()
      expect(calls.listSessions).toBe(1)
      expect(shell.sessionCount).toBe(0)
      expect(shell.totals.outputTokens).toBe(0)
      expect(shell.providers).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('contains a saveIndexAtomic failure: scan resolves and the cache stays empty', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      saveSpy.mockRejectedValueOnce(new Error('disk full'))
      const { query } = makeQuery([session('a', 10)], false)
      const service = new UsageService(query, { indexPath, refreshMs: 60_000 })

      await expect((service as unknown as { scan(limit: number): Promise<void> }).scan(20)).resolves.toBeUndefined()
      expect(unhandled).toEqual([])
      expect((service as unknown as { scanning: boolean }).scanning).toBe(false)

      // First-scan failure: still the zero shell, never a partial summary.
      const shell = service.summary()
      expect(shell.sessionCount).toBe(0)
      expect(shell.totals.outputTokens).toBe(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('falls back to a full re-read for unchanged sessions when no probe exists', async () => {
    const a = session('a', 10)
    const b = session('b', 30)
    const { query, calls } = makeQuery([a, b], false)
    const service = new UsageService(query, { indexPath, refreshMs: 0 })
    await vi.waitFor(() => { expect(service.summary().scanning).toBe(false) })
    await quiesce()

    b.events = [...b.events, message('deepseek', 'm1', 5, 2)]
    await vi.waitFor(() => {
      service.summary()
      expect(calls.readSession['a']).toBeGreaterThanOrEqual(2)
      expect(calls.readSession['b']).toBeGreaterThanOrEqual(2)
    })
    await quiesce()
    expect(service.summary().totals.outputTokens).toBe(45)
  })
})
