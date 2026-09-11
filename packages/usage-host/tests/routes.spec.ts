/** Route behavior: trust fence, method dispatch, and the limit clamp. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RawUsageEvent } from '../src/fold-usage.ts'
import type { SessionQueryLike } from '../src/service.ts'
import type { UsageSummaryResponse } from '../src/shared.ts'
import { USAGE_SUMMARY_ROUTE } from '../src/shared.ts'
import { apply, name } from '../src/index.ts'

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
}

/** Corpus with the optional eventCount probe, as the real sessionQuery offers. */
function makeQuery(sessions: FakeSession[]): SessionQueryLike {
  const byId = new Map(sessions.map(session => [session.header.id, session]))
  return {
    listSessions: async () => sessions.map(session => ({ header: session.header })),
    readSession: async (id: string) => {
      const session = byId.get(id)
      if (session === undefined) throw new Error('unknown session ' + id)
      return { session: session.header, events: session.events }
    },
    readTitle: async (id: string) => {
      const title = byId.get(id)?.title
      return title === undefined ? undefined : { title }
    },
    eventCount: async (id: string) => byId.get(id)?.events.length,
  }
}

interface Route {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => Promise<void>
}

/** A captured response. */
interface Reply {
  status(): number
  body(): unknown
  header(headerName: string): string | undefined
}

/** A minimal request/response pair wired to the route handler signature. */
function pair(options: { method: string; url: string }) {
  const state: { statusCode: number; text: string; headers: Record<string, string> } = {
    statusCode: 0, text: '', headers: {},
  }
  const req = {
    method: options.method,
    url: options.url,
    headers: {} as Record<string, string>,
  }
  const res = {
    set statusCode(value: number) { state.statusCode = value },
    get statusCode() { return state.statusCode },
    setHeader(headerName: string, value: unknown) { state.headers[headerName] = String(value) },
    end(text?: string) { if (text !== undefined) state.text += text },
  }
  const reply: Reply = {
    status: () => state.statusCode,
    body: () => state.text.length === 0 ? undefined : JSON.parse(state.text),
    header: (headerName: string) => state.headers[headerName],
  }
  return { req: req as unknown as import('node:http').IncomingMessage, res: res as unknown as import('node:http').ServerResponse, reply }
}

describe('summary route', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'usage-routes-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function session(id: string, output: number): FakeSession {
    return {
      header: { id, createdAt: 1000, cwd: '/tmp/' + id },
      events: [message('deepseek', 'm1', output)],
      title: 't-' + id,
    }
  }

  /** Apply the plugin over fakes and return the registered summary handler. */
  function compose(sessions: FakeSession[], rejection?: 401 | 403): Route['handler'] {
    const ctx = new Context()
    const registered: Route[] = []
    Reflect.set(ctx, 'webServer', {
      register(route: Route) { registered.push(route); return () => undefined },
    })
    Reflect.set(ctx, 'connection', { requestRejection: () => rejection })
    Reflect.set(ctx, 'sessionQuery', makeQuery(sessions))
    apply(ctx, {
      indexPath: join(dir, 'index.json'),
      registryOverridesPath: join(dir, 'overrides.json'),
      refreshMs: 60_000,
    })
    expect(name).toBe('dsh-usage-host')
    const route = registered.find(candidate => candidate.path === USAGE_SUMMARY_ROUTE)
    expect(route?.kind).toBe('exact')
    return route!.handler
  }

  it('registers the summary route under the inject trio', () => {
    const ctx = new Context()
    const registered: Route[] = []
    Reflect.set(ctx, 'webServer', { register(route: Route) { registered.push(route); return () => undefined } })
    Reflect.set(ctx, 'connection', { requestRejection: () => undefined })
    Reflect.set(ctx, 'sessionQuery', makeQuery([session('a', 10)]))
    apply(ctx, { indexPath: join(dir, 'index.json'), refreshMs: 60_000 })
    expect(registered).toHaveLength(1)
    expect(registered[0]?.path).toBe(USAGE_SUMMARY_ROUTE)
    expect(registered[0]?.kind).toBe('exact')
  })

  it('answers 200 with the summary payload structure on GET', async () => {
    const handler = compose([session('a', 10), session('b', 30)])
    const first = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE })
    await handler(first.req, first.res)
    expect(first.reply.status()).toBe(200)
    const shell = first.reply.body() as UsageSummaryResponse
    expect(shell.scanning).toBe(true)
    expect(Array.isArray(shell.providers)).toBe(true)

    await vi.waitFor(async () => {
      const poll = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE })
      await handler(poll.req, poll.res)
      expect((poll.reply.body() as UsageSummaryResponse).scanning).toBe(false)
    })
    const done = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE })
    await handler(done.req, done.res)
    expect(done.reply.status()).toBe(200)
    const body = done.reply.body() as UsageSummaryResponse
    expect(body.scanning).toBe(false)
    expect(body.sessionCount).toBe(2)
    expect(body.totals.outputTokens).toBe(40)
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0]).toMatchObject({ provider: 'deepseek', models: [{ model: 'm1', buckets: { outputTokens: 40 } }] })
    expect(body.topSessions[0]).toMatchObject({ sessionId: 'b', title: 't-b' })
  })

  it('rejects POST with 405 and an allow: GET header', async () => {
    const handler = compose([session('a', 10)])
    const call = pair({ method: 'POST', url: USAGE_SUMMARY_ROUTE })
    await handler(call.req, call.res)
    expect(call.reply.status()).toBe(405)
    expect(call.reply.header('allow')).toBe('GET')
    expect(call.reply.body()).toBeUndefined()
  })

  it('propagates the connection rejection and stops there', async () => {
    const handler = compose([session('a', 10)], 401)
    const call = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE })
    await handler(call.req, call.res)
    expect(call.reply.status()).toBe(401)
    expect(call.reply.body()).toBeUndefined()
    const forbidden = compose([session('a', 10)], 403)
    const rejected = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE })
    await forbidden(rejected.req, rejected.res)
    expect(rejected.reply.status()).toBe(403)
  })

  it('clamps the limit parameter to 1..200 with a fallback of 20', async () => {
    const sessions = Array.from({ length: 25 }, (_, index) => session('s' + String(index).padStart(2, '0'), 10 + index))
    const handler = compose(sessions)
    await vi.waitFor(async () => {
      const poll = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE })
      await handler(poll.req, poll.res)
      expect((poll.reply.body() as UsageSummaryResponse).scanning).toBe(false)
    })

    const bad = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE + '?limit=abc' })
    await handler(bad.req, bad.res)
    expect((bad.reply.body() as UsageSummaryResponse).topSessions).toHaveLength(20)

    const overflow = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE + '?limit=500' })
    await handler(overflow.req, overflow.res)
    expect((overflow.reply.body() as UsageSummaryResponse).topSessions).toHaveLength(20)

    const zero = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE + '?limit=0' })
    await handler(zero.req, zero.res)
    expect((zero.reply.body() as UsageSummaryResponse).topSessions).toHaveLength(20)

    const inRange = pair({ method: 'GET', url: USAGE_SUMMARY_ROUTE + '?limit=3' })
    await handler(inRange.req, inRange.res)
    expect((inRange.reply.body() as UsageSummaryResponse).topSessions).toHaveLength(3)
  })
})