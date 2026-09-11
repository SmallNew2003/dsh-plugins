/** Wire contract of the git host plugin: route paths and payload shapes. */

import type { GitErrorBody } from './errors.ts'

/** Current branch and worktree facts of the session's repository. */
export interface GitStatusPayload {
  /** Current branch name; `HEAD <sha>` (short sha) when HEAD is detached. */
  readonly branch: string
  /** True when the session cwd sits in a linked worktree, false on the main checkout. */
  readonly isWorktree: boolean
  /** Absolute path of the worktree root the session cwd resolves to. */
  readonly worktreePath: string
  /** Absolute path identifying the main repository (common dir). */
  readonly mainRepoPath: string
  /** Uncommitted-change count of the worktree (porcelain line count). */
  readonly dirtyCount: number
}

/** One row of the worktree list, in `git worktree list --porcelain` order. */
export interface GitWorktreeRow {
  /** Absolute worktree path. */
  readonly path: string
  /** Checked-out branch ref (refs/heads/<name>) or `HEAD <sha>` when detached. */
  readonly branch: string
  /** Commit id the worktree head points at. */
  readonly head: string
  /** True for the main worktree. */
  readonly isMain: boolean
  /** Uncommitted-change count; 0 when `dirtyChecked` is false and the count is unknown. */
  readonly dirtyCount: number
  /** False when the dirty check was skipped (dirtyCheckLimit reached) — UI renders "unknown". */
  readonly dirtyChecked: boolean
  /** At most the first ten changed paths, present when dirtyChecked; feeds the delete summary. */
  readonly changedPaths?: readonly string[]
}

/** New-worktree request body. */
export interface GitWorktreeAddRequest {
  /** Worktree name; also the default branch name and default path segment. */
  readonly name: string
  /** Branch to check out or create; defaults to `name`. */
  readonly branch?: string
  /** Create the branch (`-b`) instead of checking out an existing one. */
  readonly createBranch?: boolean
  /** Optional start point (commit-ish) the new branch bases on. */
  readonly startPoint?: string
  /** Explicit worktree path; defaults to `<repo parent>/<repo name>-<name>`. */
  readonly path?: string
}

/** Summarized uncommitted changes attached to a dirty-rejection error. */
export interface GitDirtySummary {
  /** Number of porcelain entries. */
  readonly count: number
  /** At most the first ten changed paths (rename target side). */
  readonly paths: readonly string[]
}

/** Dirty-rejection error detail: protection rules never delete silently. */
export interface GitDirtyDetail {
  readonly dirty: GitDirtySummary
}

/** Wire body of the dirty rejection (`git/dirty`). */
export interface GitDirtyErrorBody extends GitErrorBody {
  readonly detail?: string
}

/** Route constants; one home so the client package imports the same strings. */
export const GIT_STATUS_ROUTE = '/git/status'
export const GIT_WORKTREES_ROUTE = '/git/worktrees'
