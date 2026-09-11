/** Controller behavior: TTL-cached status, structured error extraction, mutation flags. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitController } from '../src/client/controller.ts'
import { GIT_STATUS_ROUTE, GIT_WORKTREES_ROUTE } from 'dsh-git-host/shared'

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
    const reply = replies[url] ?? { status: 404, body: { code: 'git/command-failed', message: 'no script' } }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetcher)
  return calls
}

/** The base URL the controller resolves under jsdom. */
const BASE = (globalThis.location?.origin ?? 'http://dsh.internal') + '/'

describe('status', () => {
  it('fetches once and serves the TTL window from cache', async () => {
    vi.useFakeTimers()
    const calls = stubFetch({ [BASE + GIT_STATUS_ROUTE.slice(1) + '?sessionId=s1']: { status: 200, body: { branch: 'main', isWorktree: false, dirtyCount: 0 } } })
    const controller = new GitController()
    const first = await controller.status('s1')
    expect(first).toMatchObject({ branch: 'main' })
    vi.advanceTimersByTime(4_000)
    const second = await controller.status('s1')
    expect(second).toMatchObject({ branch: 'main' })
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(1_500)
    await controller.status('s1')
    expect(calls).toHaveLength(2)
  })

  it('force bypasses the cache for the guaranteed-fresh re-pull points', async () => {
    vi.useFakeTimers()
    const calls = stubFetch({ [BASE + GIT_STATUS_ROUTE.slice(1) + '?sessionId=s1']: { status: 200, body: { branch: 'main', isWorktree: false, dirtyCount: 0, statusCacheTtlMs: 5000 } } })
    const controller = new GitController()
    await controller.status('s1')
    vi.advanceTimersByTime(1_000)
    await controller.status('s1')
    expect(calls).toHaveLength(1)
    await controller.status('s1', { force: true })
    expect(calls).toHaveLength(2)
  })

  it('uses the host-provided statusCacheTtlMs for the cache window', async () => {
    vi.useFakeTimers()
    const calls = stubFetch({ [BASE + GIT_STATUS_ROUTE.slice(1) + '?sessionId=s1']: { status: 200, body: { branch: 'main', isWorktree: false, dirtyCount: 0, statusCacheTtlMs: 1_000 } } })
    const controller = new GitController()
    await controller.status('s1')
    vi.advanceTimersByTime(1_500)
    await controller.status('s1')
    expect(calls).toHaveLength(2)
  })

  it('caches per session id', async () => {
    const calls = stubFetch({
      [BASE + GIT_STATUS_ROUTE.slice(1) + '?sessionId=s1']: { status: 200, body: { branch: 'a', isWorktree: false, dirtyCount: 0 } },
      [BASE + GIT_STATUS_ROUTE.slice(1) + '?sessionId=s2']: { status: 200, body: { branch: 'b', isWorktree: false, dirtyCount: 0 } },
    })
    const controller = new GitController()
    await controller.status('s1')
    await controller.status('s2')
    expect(calls).toHaveLength(2)
  })

  it('returns the structured error body on failure', async () => {
    stubFetch({ [BASE + GIT_STATUS_ROUTE.slice(1) + '?sessionId=s1']: { status: 404, body: { code: 'git/not-repo', message: 'not a repo' } } })
    const controller = new GitController()
    const result = await controller.status('s1')
    expect(result).toMatchObject({ code: 'git/not-repo', message: 'not a repo' })
  })
})

describe('worktrees', () => {
  it('lists rows and never serves a cached copy', async () => {
    const calls = stubFetch({ [BASE + GIT_WORKTREES_ROUTE.slice(1) + '?sessionId=s1']: { status: 200, body: { worktrees: [{ path: '/r', branch: 'refs/heads/main', head: 'x', isMain: true, dirtyCount: 0, dirtyChecked: true }] } } })
    const controller = new GitController()
    await controller.worktrees('s1')
    await controller.worktrees('s1')
    expect(calls).toHaveLength(2)
  })

  it('encodes the sessionId parameter', async () => {
    const calls = stubFetch({})
    const controller = new GitController()
    await controller.worktrees('a b/c')
    expect(calls[0]?.url).toContain('sessionId=a%20b%2Fc')
  })
})

describe('addWorktree', () => {
  it('posts the JSON body and invalidates the status cache', async () => {
    const calls = stubFetch({
      [BASE + GIT_WORKTREES_ROUTE.slice(1) + '?sessionId=s1']: { status: 201, body: { path: '/r-wt', branch: 'refs/heads/wt', head: 'x', isMain: false, dirtyCount: 0, dirtyChecked: true } },
      [BASE + GIT_STATUS_ROUTE.slice(1) + '?sessionId=s1']: { status: 200, body: { branch: 'main', isWorktree: false, dirtyCount: 0 } },
    })
    const controller = new GitController()
    await controller.status('s1')
    expect(calls).toHaveLength(1)
    const created = await controller.addWorktree('s1', { name: 'wt', createBranch: true })
    expect(created).toMatchObject({ path: '/r-wt' })
    expect(calls[1]?.init?.method).toBe('POST')
    expect(String((calls[1]?.init?.headers as Record<string, string>)['content-type'])).toBe('application/json')
    // The cache was invalidated: the next status read hits the host again.
    await controller.status('s1')
    expect(calls.filter(call => call.url.includes('status'))).toHaveLength(2)
  })

  it('surfaces structured add failures', async () => {
    stubFetch({ [BASE + GIT_WORKTREES_ROUTE.slice(1) + '?sessionId=s1']: { status: 502, body: { code: 'git/command-failed', message: 'git worktree add failed' } } })
    const controller = new GitController()
    const result = await controller.addWorktree('s1', { name: 'x' })
    expect(result).toMatchObject({ code: 'git/command-failed' })
  })
})

describe('removeWorktree', () => {
  it('sends the discard flag only when asked', async () => {
    const calls = stubFetch({ [BASE + GIT_WORKTREES_ROUTE.slice(1) + '?sessionId=s1']: { status: 200, body: { ok: true } } })
    const controller = new GitController()
    await controller.removeWorktree('s1', '/r-wt', false)
    expect(calls[0]?.url).not.toContain('discardChanges')
    expect(calls[0]?.init?.method).toBe('DELETE')
    await controller.removeWorktree('s1', '/r-wt', true)
    expect(calls[1]?.url).toContain('discardChanges=true')
  })

  it('surfaces the dirty refusal with its summary detail', async () => {
    stubFetch({ [BASE + GIT_WORKTREES_ROUTE.slice(1) + '?sessionId=s1&path=' + encodeURIComponent('/r-wt')]: { status: 409, body: { code: 'git/dirty', message: 'dirty', detail: 'summary' } } })
    const controller = new GitController()
    const result = await controller.removeWorktree('s1', '/r-wt', false)
    expect(result).toMatchObject({ code: 'git/dirty', detail: 'summary' })
  })
})
