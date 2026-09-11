/** Browser data carrier: host route fetches plus the client-side short TTL. */

import { GIT_STATUS_ROUTE, GIT_WORKTREES_ROUTE, type GitStatusPayload, type GitWorktreeAddRequest, type GitWorktreeRow } from 'dsh-git-host/shared'

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Structured error body the host sends on every failure. */
export interface GitErrorBodyWire {
  readonly code: string
  readonly message: string
  readonly detail?: string
}

/** Client-side status cache lifetime; the host enforces its own TTL upstream. */
const STATUS_TTL_MS = 5_000

/** Resolve the browser Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/** Extract the structured error body of a failed host response, or a generic one. */
async function errorOf(response: Response): Promise<GitErrorBodyWire> {
  try {
    const body = await response.json() as Partial<GitErrorBodyWire>
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      return { code: body.code, message: body.message, ...(body.detail === undefined ? {} : { detail: body.detail }) }
    }
  } catch {
    // A non-JSON refusal reads as the generic failure below.
  }
  return { code: 'git/command-failed', message: 'HTTP ' + String(response.status) }
}

/**
 * One controller per plugin life: every Session header shares one truth.
 * Status reads are TTL-cached per session; listings and mutations always
 * hit the host. Phase A has no push channel: opening the panel and the
 * refresh button are the only update triggers.
 */
export class GitController {
  private readonly statusCache = new Map<string, { at: number; status: GitStatusPayload }>()

  constructor(private readonly fetcher: Fetch = (input, init) => fetch(input, init)) {}

  /**
   * Status of the session repository, TTL-cached per session id.
   * @returns the payload, or the structured error (badge then renders nothing).
   */
  async status(sessionId: string): Promise<GitStatusPayload | GitErrorBodyWire> {
    const cached = this.statusCache.get(sessionId)
    if (cached !== undefined && Date.now() - cached.at < STATUS_TTL_MS) return cached.status
    const response = await this.fetcher(new URL(GIT_STATUS_ROUTE + '?sessionId=' + encodeURIComponent(sessionId), hostBase()), {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return await errorOf(response)
    const payload = await response.json() as GitStatusPayload
    this.statusCache.set(sessionId, { at: Date.now(), status: payload })
    return payload
  }

  /** Invalidate the status cache for one session (after any mutation). */
  invalidate(sessionId: string): void {
    this.statusCache.delete(sessionId)
  }

  /**
   * Worktree listing of the session repository; never cached (mutations read fresh).
   * @returns the rows, or the structured error.
   */
  async worktrees(sessionId: string): Promise<readonly GitWorktreeRow[] | GitErrorBodyWire> {
    const response = await this.fetcher(new URL(GIT_WORKTREES_ROUTE + '?sessionId=' + encodeURIComponent(sessionId), hostBase()), {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return await errorOf(response)
    const payload = await response.json() as { worktrees?: readonly GitWorktreeRow[] }
    return Array.isArray(payload.worktrees) ? payload.worktrees : []
  }

  /**
   * Create one worktree.
   * @returns the created row, or the structured error.
   */
  async addWorktree(sessionId: string, request: GitWorktreeAddRequest): Promise<GitWorktreeRow | GitErrorBodyWire> {
    const response = await this.fetcher(new URL(GIT_WORKTREES_ROUTE + '?sessionId=' + encodeURIComponent(sessionId), hostBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) return await errorOf(response)
    this.invalidate(sessionId)
    return await response.json() as GitWorktreeRow
  }

  /**
   * Remove one worktree; discardChanges maps to the host force flag and is
   * only sent after the panel's explicit checkbox plus confirm.
   * @returns ok, or the structured error (git/dirty, git/protected, ...).
   */
  async removeWorktree(sessionId: string, path: string, discardChanges: boolean): Promise<true | GitErrorBodyWire> {
    const params = '?sessionId=' + encodeURIComponent(sessionId)
      + '&path=' + encodeURIComponent(path)
      + (discardChanges ? '&discardChanges=true' : '')
    const response = await this.fetcher(new URL(GIT_WORKTREES_ROUTE + params, hostBase()), {
      method: 'DELETE',
    })
    if (!response.ok) return await errorOf(response)
    this.invalidate(sessionId)
    return true
  }
}
