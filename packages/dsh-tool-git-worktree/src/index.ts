/**
 * Model-facing git worktree tools over the git domain service of dsh-git-host:
 * list, add, and remove. The service owns every protection rule; a dirty
 * worktree without explicit discardChanges refuses with the structured
 * git/dirty error and nothing is deleted. Only type imports cross the package
 * boundary, so the tools never bind a second copy of the host class.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { GitErrorBody, GitWorktreeRow } from 'dsh-git-host'

export const name = 'tool-git-worktree'
/** The tool registry and the git domain service (provided by dsh-git-host). */
export const inject = ['tools', 'gitWorktree']

/** No Config: every tunable lives in the dsh-git-host service config. */

/** Structured outcome shared by the three tools: data or a git error body. */
type Outcome<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: GitErrorBody }

/** Shape test for the host's structured failure; identity-safe across copies. */
function isGitFailure(error: unknown): error is GitErrorBody & { message: string } {
  return error instanceof Error
    && typeof (error as { code?: unknown }).code === 'string'
    && String((error as { code?: unknown }).code).startsWith('git/')
}

/** Run one service call; structured failures become the error outcome. */
async function outcomeOf<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (error) {
    if (isGitFailure(error)) {
      const body: GitErrorBody = {
        code: error.code as GitErrorBody['code'],
        message: error.message,
        ...(error.detail === undefined ? {} : { detail: error.detail }),
      }
      return { ok: false, error: body }
    }
    throw error
  }
}

/** Session id of the calling agent, or the no-session error outcome. */
function sessionOf(exec: ToolExecution): { readonly ok: true; readonly sessionId: string } | { readonly ok: false; readonly error: GitErrorBody } {
  const sessionId = exec.agent?.id
  if (sessionId === undefined) {
    return { ok: false, error: { code: 'git/missing-dir', message: 'no session context: this tool requires a session agent' } }
  }
  return { ok: true, sessionId }
}

/** The row shape the model sees (identical to the host wire shape). */
const WORKTREE_ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    branch: { type: 'string', required: true },
    head: { type: 'string', required: true },
    isMain: { type: 'boolean', required: true },
    dirtyCount: { type: 'integer', required: true },
    dirtyChecked: { type: 'boolean', required: true },
    changedPaths: { type: 'array', items: { type: 'string' } },
  },
} as const

/** The error-body shape tools embed verbatim. */
const ERROR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    detail: { type: 'string' },
  },
} as const

/** The mutable wire row the output schema declares (schema arrays are mutable). */
type WireRow = {
  path: string
  branch: string
  head: string
  isMain: boolean
  dirtyCount: number
  dirtyChecked: boolean
  changedPaths?: string[]
}

/** Convert one service row to the mutable wire shape (schema arrays are mutable). */
function wireRow(row: GitWorktreeRow): WireRow {
  return {
    path: row.path,
    branch: row.branch,
    head: row.head,
    isMain: row.isMain,
    dirtyCount: row.dirtyCount,
    dirtyChecked: row.dirtyChecked,
    ...(row.changedPaths === undefined ? {} : { changedPaths: [...row.changedPaths] }),
  }
}

/** Render one row as the model-visible text line (UI-equivalent facts). */
function renderRow(row: WireRow): string {
  const dirty = row.dirtyChecked ? String(row.dirtyCount) : 'unknown'
  const main = row.isMain ? ' [main]' : ''
  return row.path + '  ' + row.branch + main + '  dirty: ' + dirty
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'git_worktree_list',
    description: 'List every worktree of the current session repository: path, branch, '
      + 'main-worktree flag, and dirty-change count. Dirty counts of worktrees beyond the '
      + 'host check limit read as unknown (dirtyChecked false), not zero.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          worktrees: { type: 'array', items: WORKTREE_ROW_SCHEMA },
          error: ERROR_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok === true
          ? ((value.worktrees as WireRow[]).length === 0 ? '(no worktrees)' : (value.worktrees as WireRow[]).map(renderRow).join('\n'))
          : 'Error: ' + (value.error as GitErrorBody).code + ' - ' + (value.error as GitErrorBody).message,
      }],
    },
    async execute(_args, exec) {
      const session = sessionOf(exec)
      if (!session.ok) return { ok: false, error: session.error }
      const result = await outcomeOf(() => ctx.gitWorktree.worktrees(session.sessionId))
      return result.ok ? { ok: true, worktrees: result.data.map(wireRow) } : { ok: false, error: result.error }
    },
    presentCall: () => ({ card: 'generic', title: 'List git worktrees', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'git_worktree_add',
    description: 'Create a worktree in the current session repository. Provide name; branch '
      + 'defaults to the name, createBranch true creates it (-b), startPoint bases it on a '
      + 'commit-ish, and path overrides the default <repo parent>/<repo name>-<name> location. '
      + 'Fails with git/command-failed and the git stderr when git refuses the path or branch.',
    parameters: {
      name: { type: 'string', required: true, description: 'Worktree name; also the default branch name and default path segment.' },
      branch: { type: 'string', description: 'Branch to check out or create; defaults to the name.' },
      createBranch: { type: 'boolean', description: 'Create the branch (-b) instead of checking out an existing one.' },
      startPoint: { type: 'string', description: 'Optional start point (commit-ish) the new branch bases on.' },
      path: { type: 'string', description: 'Explicit absolute worktree path; defaults to <repo parent>/<repo name>-<name>.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          worktree: WORKTREE_ROW_SCHEMA,
          error: ERROR_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok === true
          ? 'created ' + renderRow(value.worktree as WireRow)
          : 'Error: ' + (value.error as GitErrorBody).code + ' - ' + (value.error as GitErrorBody).message,
      }],
    },
    async execute(args, exec) {
      const session = sessionOf(exec)
      if (!session.ok) return { ok: false, error: session.error }
      const result = await outcomeOf(() => ctx.gitWorktree.addWorktree(session.sessionId, args))
      return result.ok ? { ok: true, worktree: wireRow(result.data) } : { ok: false, error: result.error }
    },
    presentCall: args => ({ card: 'generic', title: 'Create git worktree ' + args.name, kind: 'execute' }),
  }))

  ctx.tools.register(defineTool({
    name: 'git_worktree_remove',
    description: 'Remove a worktree of the current session repository by absolute path. A dirty '
      + 'worktree refuses with git/dirty (change summary included) unless discardChanges is true; '
      + 'the main worktree and the session workspace worktree always refuse with git/protected. '
      + 'Deletion is irreversible: only pass discardChanges after the user explicitly agreed.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path of the worktree to remove.' },
      discardChanges: { type: 'boolean', description: 'Discard uncommitted changes (--force). Requires explicit user agreement first.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          removed: { type: 'string' },
          error: ERROR_SCHEMA,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok === true
          ? 'removed worktree ' + value.removed
          : 'Error: ' + (value.error as GitErrorBody).code + ' - ' + (value.error as GitErrorBody).message,
      }],
    },
    async execute(args, exec) {
      const session = sessionOf(exec)
      if (!session.ok) return { ok: false, error: session.error }
      const result = await outcomeOf(() =>
        ctx.gitWorktree.removeWorktree(session.sessionId, args.path, args.discardChanges === true)
          .then(() => ({ removed: args.path })))
      return result.ok ? { ok: true, removed: result.data.removed } : { ok: false, error: result.error }
    },
    presentCall: args => ({ card: 'generic', title: 'Remove git worktree ' + args.path, kind: 'execute' }),
  }))
}
