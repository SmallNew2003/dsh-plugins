/** Route handler behavior: trust fence, method dispatch, wire error mapping. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, name } from '../src/index.ts'
import { addWorktree, git, provideHostServices, tempRepo, TEST_CONFIG } from './helpers.ts'
import { GIT_STATUS_ROUTE, GIT_WORKTREES_ROUTE } from '../src/shared.ts'
import { realpath } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'

const cleaned: string[] = []

afterEach(async () => {
  await Promise.all(cleaned.splice(0).map(async root => {
    await git(root, ['worktree', 'prune', '--force']).catch(() => undefined)
  }))
})

/** A captured response. */
interface Reply {
  status(): number
  body(): unknown
  allowHeader(): string | undefined
}

/** A minimal request/response pair wired to the route handler signature. */
function pair(options: { method: string; url: string; rejection?: 401 | 403; body?: unknown; contentType?: string }) {
  const state: { statusCode: number; text: string; allow?: string } = { statusCode: 0, text: '' }
  const req = {
    method: options.method,
    url: options.url,
    headers: { 'content-type': options.contentType ?? 'application/json' } as Record<string, string>,
  }
  let drained = false
  const res = {
    set statusCode(value: number) { state.statusCode = value },
    get statusCode() { return state.statusCode },
    setHeader(_name: string, value: unknown) {
      if (_name === 'allow') state.allow = String(value)
    },
    end(text?: string) {
      if (text !== undefined) state.text += text
      drained = true
    },
  }
  const reqWithBody = Object.assign(req, {
    [Symbol.asyncIterator]() {
      const chunks = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]
      let index = 0
      return { next: () => index < chunks.length ? { value: chunks[index++], done: false } : { value: undefined, done: true } }
    },
    resume() { drained = true },
  })
  const reply: Reply = {
    status: () => state.statusCode,
    body: () => state.text.length === 0 ? undefined : JSON.parse(state.text),
    allowHeader: () => state.allow,
  }
  return { req: reqWithBody, res: res as unknown as import('node:http').ServerResponse, reply, isDrained: () => drained }
}

/** Compose routes over one fresh repository. */
async function compose(rejection?: 401 | 403) {
  const repo = await realpath(await tempRepo())
  cleaned.push(repo)
  const ctx = new Context()
  provideHostServices(ctx, [{ id: 'session-1', cwd: repo }])
  const registered: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }[] = []
  Reflect.set(ctx, 'webServer', { register(route: never) { registered.push(route as never); return () => undefined } })
  Reflect.set(ctx, 'connection', { requestRejection: () => rejection })
  const config = Config({ ...TEST_CONFIG }) as never
  apply(ctx, config)
  expect(name).toBe('dsh-git-host')
  const statusRoute = registered.find(route => route.path === GIT_STATUS_ROUTE)
  const worktreesRoute = registered.find(route => route.path === GIT_WORKTREES_ROUTE)
  expect(statusRoute).toBeDefined()
  expect(worktreesRoute).toBeDefined()
  return { repo, statusRoute: statusRoute!, worktreesRoute: worktreesRoute! }
}

describe('trust fence', () => {
  it('answers 401/403 without touching the service', async () => {
    const { statusRoute } = await compose(401)
    const call = pair({ method: 'GET', url: GIT_STATUS_ROUTE + '?sessionId=session-1', rejection: 401 })
    await statusRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(401)
    expect(call.reply.body()).toBeUndefined()
  })
})

describe('GET status', () => {
  it('returns the status payload', async () => {
    const { repo, statusRoute } = await compose()
    const call = pair({ method: 'GET', url: GIT_STATUS_ROUTE + '?sessionId=session-1' })
    await statusRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(200)
    expect(call.reply.body()).toMatchObject({ branch: 'main', isWorktree: false, mainRepoPath: repo })
  })

  it('requires the sessionId parameter', async () => {
    const { statusRoute } = await compose()
    const call = pair({ method: 'GET', url: GIT_STATUS_ROUTE })
    await statusRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(400)
  })

  it('maps git/missing-dir to 404 and git/not-repo to 404', async () => {
    const { statusRoute } = await compose()
    const missing = pair({ method: 'GET', url: GIT_STATUS_ROUTE + '?sessionId=unknown' })
    await statusRoute.handler(missing.req, missing.res)
    expect(missing.reply.status()).toBe(404)
    expect(missing.reply.body()).toMatchObject({ code: 'git/missing-dir' })
  })
})

describe('worktrees route', () => {
  it('lists worktrees on GET', async () => {
    const { repo, worktreesRoute } = await compose()
    await addWorktree(repo, repo + '-wt', 'feature')
    const call = pair({ method: 'GET', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1' })
    await worktreesRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(200)
    const body = call.reply.body() as { worktrees?: { length?: number } }
    expect(body.worktrees?.length).toBe(2)
  })

  it('rejects foreign methods with 405 and an allow header', async () => {
    const { statusRoute } = await compose()
    const call = pair({ method: 'POST', url: GIT_STATUS_ROUTE + '?sessionId=session-1' })
    await statusRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(405)
    expect(call.reply.allowHeader()).toBe('GET')
  })

  it('creates a worktree on POST and answers 201 with the new row', async () => {
    const { repo, worktreesRoute } = await compose()
    const call = pair({ method: 'POST', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1', body: { name: 'feature', createBranch: true } })
    await worktreesRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(201)
    expect(call.reply.body()).toMatchObject({ path: repo + '-feature' })
  })

  it('rejects non-JSON content types with 415', async () => {
    const { worktreesRoute } = await compose()
    const call = pair({ method: 'POST', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1', body: { name: 'x' }, contentType: 'text/plain' })
    await worktreesRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(415)
  })

  it('rejects malformed bodies with 400', async () => {
    const { worktreesRoute } = await compose()
    const noName = pair({ method: 'POST', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1', body: {} })
    await worktreesRoute.handler(noName.req, noName.res)
    expect(noName.reply.status()).toBe(400)
    const badJson = pair({ method: 'POST', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1' })
    badJson.req.headers['content-type'] = 'application/json'
    await worktreesRoute.handler(badJson.req, badJson.res)
    expect(badJson.reply.status()).toBe(400)
  })

  it('maps a dirty deletion to 409 git/dirty without discardChanges', async () => {
    const { repo, worktreesRoute } = await compose()
    await addWorktree(repo, repo + '-wt', 'feature')
    await writeFile(repo + '-wt/README.md', 'dirty\n')
    const dirty = pair({ method: 'DELETE', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1&path=' + encodeURIComponent(repo + '-wt') })
    await worktreesRoute.handler(dirty.req, dirty.res)
    expect(dirty.reply.status()).toBe(409)
    expect(dirty.reply.body()).toMatchObject({ code: 'git/dirty' })
  })

  it('deletes with discardChanges=true and answers 200', async () => {
    const { repo, worktreesRoute } = await compose()
    await addWorktree(repo, repo + '-wt', 'feature')
    await writeFile(repo + '-wt/README.md', 'dirty\n')
    const forced = pair({ method: 'DELETE', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1&path=' + encodeURIComponent(repo + '-wt') + '&discardChanges=true' })
    await worktreesRoute.handler(forced.req, forced.res)
    expect(forced.reply.status()).toBe(200)
    expect(forced.reply.body()).toMatchObject({ ok: true })
  })

  it('requires the path parameter on DELETE', async () => {
    const { worktreesRoute } = await compose()
    const call = pair({ method: 'DELETE', url: GIT_WORKTREES_ROUTE + '?sessionId=session-1' })
    await worktreesRoute.handler(call.req, call.res)
    expect(call.reply.status()).toBe(400)
  })
})
