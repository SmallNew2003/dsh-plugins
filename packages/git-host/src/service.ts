/**
 * Git domain service: session-cwd resolution, repository identification,
 * worktree listing/addition/removal, and the single home of the deletion
 * protection rules. Routes and model tools are consumers of this one service;
 * neither can bypass its checks.
 */

import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { GitError } from './errors.ts'
import { resolveGitPath, runGit } from './run-git.ts'
import type { GitStatusPayload, GitWorktreeAddRequest, GitWorktreeRow } from './shared.ts'

/** Configuration values resolved by the plugin Config schema. */
export interface GitServiceConfig {
  /** Per-git-command deadline in milliseconds. */
  readonly commandTimeoutMs: number
  /** Maximum worktree rows whose dirty state is checked per listing. */
  readonly dirtyCheckLimit: number
  /** Status-cache lifetime in milliseconds. */
  readonly statusCacheTtlMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Git domain service owned by the dsh-git-host plugin. */
    gitWorktree: GitWorktreeService
  }
}

/** One resolved repository identity, cached per session cwd. */
interface RepoResolution {
  /** The worktree root the cwd resolves to (rev-parse --show-toplevel). */
  readonly worktreePath: string
  /** The main repository root (common dir's parent). */
  readonly mainRepoPath: string
  /** True when worktreePath is a linked worktree, false on the main checkout. */
  readonly isWorktree: boolean
}

/** Internal worktree row before the dirty pass fills counts. */
interface RawWorktreeRow {
  readonly path: string
  readonly branch: string
  readonly head: string
  readonly isMain: boolean
}

/** Guard a user-supplied worktree name: a plain path segment, never a path. */
function assertPlainName(name: string): void {
  if (name.length === 0) throw new GitError('git/command-failed', 'worktree name must not be empty')
  if (name !== basename(name) || name === '.' || name === '..') {
    throw new GitError('git/command-failed', 'worktree name must be a plain path segment: ' + name)
  }
}

/** Trailing-separator-insensitive path identity for the current-workspace guard. */
function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

/**
 * Canonical path identity: symlinks resolved like git prints them, falling
 * back to the lexical absolute form when the path does not exist yet.
 */
async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

/** Extract the changed path of one porcelain line (rename target side wins). */
function changedPathOf(line: string): string {
  const body = line.slice(3)
  const arrow = body.indexOf(' -> ')
  return arrow === -1 ? body : body.slice(arrow + 4)
}

/** Dirty summary of one worktree: porcelain line count plus at most ten paths. */
async function dirtySummary(
  subprocess: SubprocessRuntime,
  gitPath: string,
  worktreePath: string,
  deadlineMs: number,
): Promise<{ count: number; paths: string[] }> {
  const result = await runGit(subprocess, gitPath, ['status', '--porcelain'], worktreePath, deadlineMs)
  if (result.exitCode !== 0) {
    throw new GitError('git/command-failed', 'git status failed for ' + worktreePath, result.stderr.slice(0, 500))
  }
  const lines = result.stdout.split('\n').filter(line => line.length > 0)
  return { count: lines.length, paths: lines.slice(0, 10).map(changedPathOf) }
}

/** Trim one rev-parse output line; undefined when absent. */
function workline(line: string | undefined): string | undefined {
  const trimmed = line?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

/** Fill a parsed porcelain block into a raw row with detached defaults. */
function finishRow(current: Partial<RawWorktreeRow> & { path: string }): RawWorktreeRow {
  return {
    path: current.path,
    head: current.head ?? '',
    branch: current.branch ?? 'HEAD (detached)',
    isMain: false,
  }
}

/** The git domain service. One instance per composition; routes and tools share it. */
export class GitWorktreeService extends Service {
  private readonly subprocess: SubprocessRuntime
  private readonly config: GitServiceConfig
  /** Resolved git executable; null means git is not on PATH (git/unavailable). */
  private gitPath: Promise<string | null>
  /** Session cwd per session id; session headers are immutable. */
  private readonly sessionCwds = new Map<string, string>()
  /** Repository identity per cwd, invalidated only by process life. */
  private readonly repos = new Map<string, Promise<RepoResolution>>()
  /** Status payload cache keyed by worktree root, TTL-bounded. */
  private readonly statusCache = new Map<string, { at: number; payload: GitStatusPayload }>()

  constructor(ctx: Context, config: GitServiceConfig) {
    super(ctx, 'gitWorktree')
    this.subprocess = ctx.subprocess
    this.config = config
    this.gitPath = resolveGitPath(this.subprocess)
  }

  /** git executable path or the git/unavailable rejection. */
  private async executable(): Promise<string> {
    const path = await this.gitPath
    if (path === null) throw new GitError('git/unavailable', 'git executable is not available on PATH')
    return path
  }

  /** Reset memoized facts; used by tests and after an unavailable transient. */
  reset(): void {
    this.gitPath = resolveGitPath(this.subprocess)
    this.sessionCwds.clear()
    this.repos.clear()
    this.statusCache.clear()
  }

  /**
   * The session header cwd, or the git/missing-dir rejection (unknown session
   * included). Live sessions read from the store; cold sessions fall back to
   * the persistence stat, mirroring the workspace-files resolution order.
   */
  async sessionCwd(sessionId: string): Promise<string> {
    const cached = this.sessionCwds.get(sessionId)
    if (cached !== undefined) return cached
    // The SessionId brand is a string at runtime; the store lookup is exact.
    const live = this.ctx.sessions.get(sessionId as SessionId)
    const header = live?.header
      ?? (await this.ctx.get('sessionPersistence')?.stat(sessionId as SessionId))?.header
    const cwd = header?.cwd
    if (cwd === undefined || !isAbsolute(cwd)) {
      throw new GitError('git/missing-dir', 'session has no working directory: ' + sessionId)
    }
    let existing: boolean
    try {
      existing = (await stat(cwd)).isDirectory()
    } catch {
      existing = false
    }
    if (!existing) throw new GitError('git/missing-dir', 'session working directory does not exist: ' + cwd)
    const canonical = await canonicalPath(cwd)
    this.sessionCwds.set(sessionId, canonical)
    return canonical
  }

  /** Repository identity for one cwd, cached per path. */
  private repoOf(cwd: string): Promise<RepoResolution> {
    const cached = this.repos.get(cwd)
    if (cached !== undefined) return cached
    const resolution = this.resolveRepo(cwd)
    this.repos.set(cwd, resolution)
    resolution.catch(() => { this.repos.delete(cwd) })
    return resolution
  }

  /** One rev-parse round trip; maps failures to the structured vocabulary. */
  private async resolveRepo(cwd: string): Promise<RepoResolution> {
    const gitPath = await this.executable()
    const result = await runGit(this.subprocess, gitPath, ['rev-parse', '--show-toplevel', '--git-common-dir'], cwd, this.config.commandTimeoutMs)
    if (result.exitCode !== 0) {
      throw new GitError('git/not-repo', 'directory is not a git repository: ' + cwd, result.stderr.slice(0, 500))
    }
    const [worktreeLine, commonLine] = result.stdout.split('\n')
    const worktreePath = workline(worktreeLine)
    const commonDir = workline(commonLine)
    if (worktreePath === undefined || commonDir === undefined) {
      throw new GitError('git/command-failed', 'unexpected git rev-parse output', result.stdout.slice(0, 500))
    }
    const commonAbsolute = isAbsolute(commonDir) ? commonDir : resolve(worktreePath, commonDir)
    // The common dir is the main repository's .git directory (or a bare gitdir).
    const mainRepoPath = basename(commonAbsolute) === '.git' ? dirname(commonAbsolute) : commonAbsolute
    return { worktreePath, mainRepoPath, isWorktree: !samePath(worktreePath, mainRepoPath) }
  }

  /** Current branch name, or 'HEAD <short sha>' when detached. */
  private async branchOf(worktreePath: string): Promise<string> {
    const gitPath = await this.executable()
    const ref = await runGit(this.subprocess, gitPath, ['rev-parse', '--abbrev-ref', 'HEAD'], worktreePath, this.config.commandTimeoutMs)
    if (ref.exitCode !== 0) {
      throw new GitError('git/command-failed', 'git rev-parse failed for ' + worktreePath, ref.stderr.slice(0, 500))
    }
    const branch = ref.stdout.trim()
    if (branch !== 'HEAD') return branch
    const sha = await runGit(this.subprocess, gitPath, ['rev-parse', '--short', 'HEAD'], worktreePath, this.config.commandTimeoutMs)
    return 'HEAD ' + sha.stdout.trim()
  }

  /**
   * Status of the session's repository: branch, worktree identity, dirty count.
   * Results are cached per worktree root for the configured TTL.
   */
  async status(sessionId: string): Promise<GitStatusPayload> {
    const cwd = await this.sessionCwd(sessionId)
    const repo = await this.repoOf(cwd)
    const cached = this.statusCache.get(repo.worktreePath)
    if (cached !== undefined && Date.now() - cached.at < this.config.statusCacheTtlMs) return cached.payload
    const gitPath = await this.executable()
    const [branch, dirty] = await Promise.all([
      this.branchOf(repo.worktreePath),
      dirtySummary(this.subprocess, gitPath, repo.worktreePath, this.config.commandTimeoutMs),
    ])
    const payload: GitStatusPayload = {
      branch,
      isWorktree: repo.isWorktree,
      worktreePath: repo.worktreePath,
      mainRepoPath: repo.mainRepoPath,
      dirtyCount: dirty.count,
    }
    this.statusCache.set(repo.worktreePath, { at: Date.now(), payload })
    return payload
  }

  /**
   * All worktrees of the session's main repository, in git output order.
   * Dirty checks stop at the configured limit; skipped rows report dirtyChecked: false.
   */
  async worktrees(sessionId: string): Promise<GitWorktreeRow[]> {
    const cwd = await this.sessionCwd(sessionId)
    const repo = await this.repoOf(cwd)
    const gitPath = await this.executable()
    const result = await runGit(this.subprocess, gitPath, ['worktree', 'list', '--porcelain'], cwd, this.config.commandTimeoutMs)
    if (result.exitCode !== 0) {
      throw new GitError('git/command-failed', 'git worktree list failed', result.stderr.slice(0, 500))
    }
    const rows: RawWorktreeRow[] = []
    let current: Partial<RawWorktreeRow> & { path: string } | undefined
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current !== undefined) rows.push(finishRow(current))
        current = { path: line.slice('worktree '.length) }
      } else if (current === undefined) {
        continue
      } else if (line.startsWith('HEAD ')) {
        current = { ...current, head: line.slice('HEAD '.length) }
      } else if (line.startsWith('branch ')) {
        current = { ...current, branch: line.slice('branch '.length) }
      } else if (line === 'detached') {
        current = { ...current, branch: 'HEAD (detached)' }
      } else if (line === 'bare') {
        current = { ...current, branch: '(bare)' }
      }
    }
    if (current !== undefined) rows.push(finishRow(current))
    // Main-worktree identity: the row at the resolved main repo path, with the
    // first porcelain row as the fallback (git lists the main worktree first).
    const hasMainRow = rows.some(row => samePath(row.path, repo.mainRepoPath))
    const withMain = rows.map((row, index) => ({
      ...row,
      isMain: samePath(row.path, repo.mainRepoPath) || (index === 0 && !hasMainRow),
    }))
    return Promise.all(withMain.map(async (row, index) => {
      if (index >= this.config.dirtyCheckLimit) {
        return { path: row.path, branch: row.branch, head: row.head, isMain: row.isMain, dirtyCount: 0, dirtyChecked: false }
      }
      const dirty = await dirtySummary(this.subprocess, gitPath, row.path, this.config.commandTimeoutMs)
      return {
        path: row.path,
        branch: row.branch,
        head: row.head,
        isMain: row.isMain,
        dirtyCount: dirty.count,
        dirtyChecked: true,
        changedPaths: dirty.paths,
      }
    }))
  }

  /**
   * Create one worktree. Path defaults to <main repo parent>/<main repo name>-<name>;
   * branch defaults to the name; createBranch adds -b.
   * @returns the new row as the next listing reports it.
   */
  async addWorktree(sessionId: string, request: GitWorktreeAddRequest): Promise<GitWorktreeRow> {
    assertPlainName(request.name)
    const branch = request.branch ?? request.name
    const cwd = await this.sessionCwd(sessionId)
    const repo = await this.repoOf(cwd)
    const path = request.path ?? join(dirname(repo.mainRepoPath), basename(repo.mainRepoPath) + '-' + request.name)
    if (!isAbsolute(path)) throw new GitError('git/command-failed', 'worktree path must be absolute: ' + path)
    const argv = ['worktree', 'add']
    if (request.createBranch === true) argv.push('-b', branch)
    if (request.startPoint !== undefined) argv.push(request.startPoint)
    argv.push(path)
    const gitPath = await this.executable()
    const result = await runGit(this.subprocess, gitPath, argv, repo.mainRepoPath, this.config.commandTimeoutMs)
    if (result.exitCode !== 0) {
      throw new GitError('git/command-failed', 'git worktree add failed', result.stderr.slice(0, 500))
    }
    const rows = await this.worktrees(sessionId)
    const created = await canonicalPath(path)
    const row = rows.find(entry => samePath(entry.path, created))
    if (row === undefined) {
      throw new GitError('git/command-failed', 'worktree created but not listed: ' + path)
    }
    return row
  }

  /**
   * Remove one worktree behind the protection rules:
   * 1. dirty + no explicit discardChanges -> git/dirty with a change summary;
   * 2. main worktree or the session's own workspace -> git/protected;
   * 3. discardChanges on a clean worktree removes normally.
   */
  async removeWorktree(sessionId: string, targetPath: string, discardChanges: boolean): Promise<void> {
    if (!isAbsolute(targetPath)) throw new GitError('git/command-failed', 'worktree path must be absolute: ' + targetPath)
    const cwd = await this.sessionCwd(sessionId)
    const repo = await this.repoOf(cwd)
    const target = await canonicalPath(targetPath)
    const rows = await this.worktrees(sessionId)
    const row = rows.find(entry => samePath(entry.path, target))
    if (row === undefined) {
      throw new GitError('git/command-failed', 'no such worktree: ' + targetPath)
    }
    if (row.isMain) {
      throw new GitError('git/protected', 'the main worktree cannot be removed: ' + row.path)
    }
    if (samePath(row.path, cwd)) {
      throw new GitError('git/protected', 'the session workspace worktree cannot be removed: ' + row.path)
    }
    if (row.dirtyChecked && row.dirtyCount > 0 && discardChanges !== true) {
      const gitPath = await this.executable()
      const dirty = await dirtySummary(this.subprocess, gitPath, row.path, this.config.commandTimeoutMs)
      throw new GitError('git/dirty', 'worktree has uncommitted changes: ' + row.path, JSON.stringify({ dirty }))
    }
    const gitPath = await this.executable()
    const argv = ['worktree', 'remove', ...(discardChanges === true ? ['--force'] : []), row.path]
    const result = await runGit(this.subprocess, gitPath, argv, repo.mainRepoPath, this.config.commandTimeoutMs)
    if (result.exitCode !== 0) {
      throw new GitError('git/command-failed', 'git worktree remove failed', result.stderr.slice(0, 500))
    }
    this.statusCache.delete(row.path)
  }
}
