/** Tool plugin behavior: schema gate, service delegation, structured errors. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { GitWorktreeRow } from 'dsh-git-host'
import { GitError } from 'dsh-git-host'
import { apply, name } from '../src/index.ts'

/** Minimal agent shape: the tools read only the session id. */
type FakeAgent = { id: string; session?: unknown }

const pluginName = name

/** One fake worktree row. */
function row(overrides: Partial<GitWorktreeRow> = {}): GitWorktreeRow {
  return {
    path: '/repo-wt',
    branch: 'refs/heads/feature',
    head: 'abc1234',
    isMain: false,
    dirtyCount: 0,
    dirtyChecked: true,
    ...overrides,
  }
}

/** A git service stub with per-test overrides. */
function fakeService(overrides: {
  worktrees?: (sessionId: string) => Promise<GitWorktreeRow[]>
  addWorktree?: (sessionId: string, request: unknown) => Promise<GitWorktreeRow>
  removeWorktree?: (sessionId: string, path: string, discardChanges: boolean) => Promise<void>
}) {
  return {
    worktrees: overrides.worktrees ?? (async () => [row()]),
    addWorktree: overrides.addWorktree ?? (async (_s: string, request: { name: string }) => row({ path: '/repo-' + request.name })),
    removeWorktree: overrides.removeWorktree ?? (async () => undefined),
  }
}

/** Compose the tool runtime plus this plugin over a stub service. */
async function compose(service: unknown, agent?: FakeAgent) {
  const ctx = new Context()
  Reflect.set(ctx, 'gitWorktree', service)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx as never)
  const call = (tool: string, args: unknown) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: 'call-1' as never,
    name: tool,
    arguments: args as never,
    ...(agent === undefined ? {} : { agent }),
  })
  return { call, ctx }
}

/** A fake session-scoped agent. */
function fakeAgent(): FakeAgent {
  return { id: 'session-1' }
}

function text(result: { content?: { type: string; text?: string }[] }): string {
  return (result.content ?? []).map(block => block.text ?? '').join('')
}

const agent = fakeAgent()

describe('registration', () => {
  it('registers the three worktree tools', async () => {
    const { ctx } = await compose(fakeService({}))
    for (const tool of ['git_worktree_list', 'git_worktree_add', 'git_worktree_remove']) {
      expect(ctx.tools.schemas().some((entry: { name: string }) => entry.name === tool)).toBe(true)
    }
    expect(pluginName).toBe('tool-git-worktree')
  })
})

describe('git_worktree_list', () => {
  it('lists worktrees for the session agent', async () => {
    const service = fakeService({ worktrees: async () => [row(), row({ path: '/repo', isMain: true })] })
    const { call } = await compose(service, agent)
    const result = await call('git_worktree_list', {}) as { value?: unknown }
    expect(result.value).toMatchObject({ ok: true, worktrees: [{ path: '/repo-wt' }, { path: '/repo', isMain: true }] })
  })

  it('reports unknown dirty state verbatim instead of zero', async () => {
    const service = fakeService({ worktrees: async () => [row({ dirtyChecked: false })] })
    const { call } = await compose(service, agent)
    const result = await call('git_worktree_list', {}) as { value?: { worktrees?: { dirtyChecked?: boolean }[] } }
    expect(result.value?.worktrees?.[0]?.dirtyChecked).toBe(false)
  })

  it('requires a session agent', async () => {
    const { call } = await compose(fakeService({}))
    const result = await call('git_worktree_list', {}) as { value?: { ok?: boolean; error?: { code?: string } } }
    expect(result.value?.ok).toBe(false)
    expect(result.value?.error?.code).toBe('git/missing-dir')
  })

  it('folds structured git failures into the error outcome', async () => {
    const service = fakeService({ worktrees: async () => { throw new GitError('git/not-repo', 'not a repo') } })
    const { call } = await compose(service, agent)
    const result = await call('git_worktree_list', {}) as { value?: { ok?: boolean; error?: { code?: string } } }
    expect(result.value?.ok).toBe(false)
    expect(result.value?.error?.code).toBe('git/not-repo')
  })

  it('renders the listing text', async () => {
    const service = fakeService({ worktrees: async () => [row({ dirtyCount: 2 })] })
    const { call } = await compose(service, agent)
    const result = await call('git_worktree_list', {}) as { content?: { text?: string }[] }
    expect(text(result)).toContain('/repo-wt')
    expect(text(result)).toContain('dirty: 2')
  })
})

describe('git_worktree_add', () => {
  it('delegates name, branch, and path to the service', async () => {
    const add = vi.fn(async () => row({ path: '/repo-topic', branch: 'refs/heads/topic' }))
    const { call } = await compose(fakeService({ addWorktree: add }), agent)
    const result = await call('git_worktree_add', { name: 'topic', createBranch: true, path: '/repo-topic' }) as { value?: { worktree?: { path?: string } } }
    expect(add).toHaveBeenCalledWith('session-1', { name: 'topic', createBranch: true, path: '/repo-topic' })
    expect(result.value?.worktree?.path).toBe('/repo-topic')
  })

  it('validates the name at the schema gate', async () => {
    const { call } = await compose(fakeService({}))
    const result = await call('git_worktree_add', {}) as { isError?: boolean }
    expect(result.isError).toBe(true)
  })
})

describe('git_worktree_remove', () => {
  it('delegates the path and the explicit discard flag', async () => {
    const remove = vi.fn(async () => undefined)
    const { call } = await compose(fakeService({ removeWorktree: remove }), agent)
    const result = await call('git_worktree_remove', { path: '/repo-wt', discardChanges: true }) as { value?: { removed?: string } }
    expect(remove).toHaveBeenCalledWith('session-1', '/repo-wt', true)
    expect(result.value?.removed).toBe('/repo-wt')
  })

  it('surfaces the dirty rejection with the change summary detail', async () => {
    const detail = JSON.stringify({ dirty: { count: 3, paths: ['a.md', 'b.md', 'c.md'] } })
    const service = fakeService({ removeWorktree: async () => { throw new GitError('git/dirty', 'worktree has uncommitted changes', detail) } })
    const { call } = await compose(service, agent)
    const result = await call('git_worktree_remove', { path: '/repo-wt' }) as { value?: { ok?: boolean; error?: { code?: string; detail?: string } } }
    expect(result.value?.ok).toBe(false)
    expect(result.value?.error?.code).toBe('git/dirty')
    expect(result.value?.error?.detail).toBe(detail)
  })

  it('refuses without a discard flag only when the service refuses', async () => {
    const remove = vi.fn(async (_s: string, _p: string, discard: boolean) => {
      if (!discard) throw new GitError('git/dirty', 'dirty')
    })
    const { call } = await compose(fakeService({ removeWorktree: remove }), agent)
    const refused = await call('git_worktree_remove', { path: '/repo-wt' }) as { value?: { ok?: boolean } }
    expect(refused.value?.ok).toBe(false)
    const allowed = await call('git_worktree_remove', { path: '/repo-wt', discardChanges: true }) as { value?: { ok?: boolean } }
    expect(allowed.value?.ok).toBe(true)
  })
})
