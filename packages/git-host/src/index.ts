/**
 * Host half of the git worktree plugin: the git domain service plus four
 * webServer routes (status, worktree list, add, remove) behind the same
 * browser trust fence as open-in-app. The service is the single protection
 * authority; routes and model tools are consumers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import { GitError, isGitError } from './errors.ts'
import { GitWorktreeService, type GitServiceConfig } from './service.ts'
import {
  GIT_STATUS_ROUTE, GIT_WORKTREES_ROUTE,
  type GitWorktreeAddRequest,
} from './shared.ts'

export type { GitErrorCode, GitErrorBody } from './errors.ts'
export { GitError, isGitError } from './errors.ts'
export type * from './shared.ts'
export { GitWorktreeService, type GitServiceConfig } from './service.ts'

/** Cordis function-plugin name. */
export const name = 'dsh-git-host'
/**
 * The route carrier, the trust fence guarding every route, the git command
 * runner, and the session corpus that resolves session cwds.
 */
export const inject = ['webServer', 'connection', 'subprocess', 'sessions']

/** dsh-git-host configuration. */
export interface Config {
  /** Per-git-command deadline in milliseconds. */
  readonly commandTimeoutMs: number
  /** Maximum worktree rows whose dirty state is checked per listing. */
  readonly dirtyCheckLimit: number
  /** Status-cache lifetime in milliseconds. */
  readonly statusCacheTtlMs: number
}

const boundedMs = (): z<number> => z.number().step(1).min(1).max(600_000).required()

export const Config: z<Config> = z.object({
  commandTimeoutMs: boundedMs(),
  dirtyCheckLimit: z.number().step(1).min(1).max(1000).required(),
  statusCacheTtlMs: boundedMs(),
})

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface OpenInAppConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** The composition's connection service (typed locally: its package is browser-side). */
function connectionOf(ctx: Context): OpenInAppConnection {
  return Reflect.get(ctx, 'connection') as OpenInAppConnection
}

/** Open-route request bodies are tiny JSON objects; anything larger is hostile. */
const MAX_BODY_BYTES = 64 * 1024

/** HTTP status for each structured git code. */
const HTTP_STATUS: Record<string, number> = {
  'git/unavailable': 503,
  'git/not-repo': 404,
  'git/missing-dir': 404,
  'git/dirty': 409,
  'git/protected': 403,
  'git/command-failed': 502,
}

/** JSON response (no-store: git facts are live facts). */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 with the route's one supported method. */
function sendMethodNotAllowed(res: ServerResponse, allow: 'GET' | 'POST' | 'DELETE'): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/** Send one structured git failure; unknown failures degrade to a generic 500. */
function sendError(res: ServerResponse, error: unknown): void {
  if (isGitError(error)) {
    sendJson(res, HTTP_STATUS[error.code] ?? 500, error.body())
    return
  }
  sendJson(res, 500, { code: 'git/command-failed', message: error instanceof Error ? error.message : String(error) })
}

/** Answer an untrusted/unauthenticated request; true when it was rejected. */
function rejected(connection: OpenInAppConnection, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/** The sessionId query parameter, or undefined. */
function sessionIdOf(req: IncomingMessage): string | undefined {
  const value = new URL(String(req.url), 'http://localhost').searchParams.get('sessionId')
  return value === null || value.length === 0 ? undefined : value
}

/** Collect a bounded request body as UTF-8 text; null past the ceiling (stream drained). */
async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** Validate one add-worktree body at the wire: the fields the route accepts. */
function parseAddBody(text: string): GitWorktreeAddRequest | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const name = record['name']
  if (typeof name !== 'string' || name.length === 0) return null
  const branch = record['branch']
  const startPoint = record['startPoint']
  const path = record['path']
  if (branch !== undefined && typeof branch !== 'string') return null
  if (startPoint !== undefined && typeof startPoint !== 'string') return null
  if (path !== undefined && typeof path !== 'string') return null
  return {
    name,
    ...(branch === undefined ? {} : { branch }),
    ...(record['createBranch'] === true ? { createBranch: true } : {}),
    ...(startPoint === undefined ? {} : { startPoint }),
    ...(path === undefined ? {} : { path }),
  }
}

/** Register the git service and the four routes behind the connection trust fence. */
export function apply(ctx: Context, config: Config): void {
  const service = new GitWorktreeService(ctx, config as GitServiceConfig)
  const connection = connectionOf(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: GIT_STATUS_ROUTE,
    handler: async (req, res) => {
      if (rejected(connection, req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      const sessionId = sessionIdOf(req)
      if (sessionId === undefined) {
        sendJson(res, 400, { code: 'git/command-failed', message: 'sessionId query parameter is required' })
        return
      }
      try {
        sendJson(res, 200, await service.status(sessionId))
      } catch (error) {
        sendError(res, error)
      }
    },
  }), 'dsh-git-host: GET ' + GIT_STATUS_ROUTE)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: GIT_WORKTREES_ROUTE,
    handler: async (req, res) => {
      if (rejected(connection, req, res)) return
      const sessionId = sessionIdOf(req)
      if (sessionId === undefined) {
        sendJson(res, 400, { code: 'git/command-failed', message: 'sessionId query parameter is required' })
        return
      }
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, { worktrees: await service.worktrees(sessionId) })
          return
        }
        if (req.method === 'POST') {
          const essence = String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()
          if (essence !== 'application/json') {
            sendJson(res, 415, { code: 'git/command-failed', message: 'content-type must be application/json' })
            return
          }
          const text = await readBoundedBody(req)
          if (text === null) {
            sendJson(res, 413, { code: 'git/command-failed', message: 'request body is too large' })
            return
          }
          const parsed = parseAddBody(text)
          if (parsed === null) {
            sendJson(res, 400, { code: 'git/command-failed', message: 'request body must be JSON with a non-empty string "name"' })
            return
          }
          sendJson(res, 201, await service.addWorktree(sessionId, parsed))
          return
        }
        if (req.method === 'DELETE') {
          const params = new URL(String(req.url), 'http://localhost').searchParams
          const path = params.get('path')
          if (path === null || path.length === 0) {
            sendJson(res, 400, { code: 'git/command-failed', message: 'path query parameter is required' })
            return
          }
          await service.removeWorktree(sessionId, path, params.get('discardChanges') === 'true')
          sendJson(res, 200, { ok: true })
          return
        }
        sendMethodNotAllowed(res, 'GET')
      } catch (error) {
        sendError(res, error)
      }
    },
  }), 'dsh-git-host: ' + GIT_WORKTREES_ROUTE)
}
