/** Git domain service behavior against real git repositories. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GitWorktreeService } from '../src/service.ts'
import { GitError } from '../src/errors.ts'
import { addWorktree, git, provideHostServices, tempRepo, TEST_CONFIG } from './helpers.ts'

const cleaned: string[] = []

afterEach(async () => {
  await Promise.all(cleaned.splice(0).map(async root => {
    await git(root, ['worktree', 'prune', '--force']).catch(() => undefined)
  }))
})

/** Compose one service over one fresh repository with a session inside it. */
async function compose() {
  const repo = await tempRepo()
  cleaned.push(repo)
  const ctx = new Context()
  const sessionId = 'session-1'
  provideHostServices(ctx, [{ id: sessionId, cwd: repo }])
  const service = new GitWorktreeService(ctx, TEST_CONFIG)
  return { repo, ctx, sessionId, service }
}

describe('session resolution', () => {
  it('rejects an unknown session with git/missing-dir', async () => {
    const { service } = await compose()
    await expect(service.status('session-unknown')).rejects.toMatchObject({ code: 'git/missing-dir' })
  })

  it('rejects a session whose cwd vanished with git/missing-dir', async () => {
    const repo = await tempRepo()
    cleaned.push(repo)
    const gone = repo + '-gone'
    const ctx = new Context()
    provideHostServices(ctx, [{ id: 'session-1', cwd: gone }])
    const service = new GitWorktreeService(ctx, TEST_CONFIG)
    await expect(service.status('session-1')).rejects.toMatchObject({ code: 'git/missing-dir' })
  })
})

describe('status', () => {
  it('reports the main checkout: branch, main identity, dirty count', async () => {
    const { repo, sessionId, service } = await compose()
    const status = await service.status(sessionId)
    expect(status).toMatchObject({
      branch: 'main',
      isWorktree: false,
      worktreePath: repo,
      mainRepoPath: repo,
      dirtyCount: 0,
    })
  })

  it('reports a linked worktree session with isWorktree and the main repo path', async () => {
    const { repo, sessionId, service } = await compose()
    const wt = repo + '-wt'
    await addWorktree(repo, wt, 'feature')
    const ctx = new Context()
    provideHostServices(ctx, [{ id: 'session-wt', cwd: wt }])
    const wtService = new GitWorktreeService(ctx, TEST_CONFIG)
    const status = await wtService.status('session-wt')
    expect(status).toMatchObject({
      branch: 'feature',
      isWorktree: true,
      worktreePath: wt,
      mainRepoPath: repo,
    })
  })

  it('counts uncommitted changes as the porcelain line count', async () => {
    const { repo, sessionId, service } = await compose()
    await writeFile(repo + '/README.md', 'changed\n')
    const status = await service.status(sessionId)
    expect(status.dirtyCount).toBe(1)
  })

  it('caches status for the configured TTL', async () => {
    const { repo, sessionId, service } = await compose()
    await service.status(sessionId)
    await writeFile(repo + '/README.md', 'changed\n')
    // Within the TTL the cached payload survives.
    expect((await service.status(sessionId)).dirtyCount).toBe(0)
  })
})

describe('worktrees listing', () => {
  it('lists main first with branch refs and dirty counts in git order', async () => {
    const { repo, sessionId, service } = await compose()
    const wt = repo + '-wt'
    await addWorktree(repo, wt, 'feature')
    const rows = await service.worktrees(sessionId)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ path: repo, isMain: true, dirtyChecked: true, dirtyCount: 0 })
    expect(rows[1]).toMatchObject({ path: wt, isMain: false, branch: 'refs/heads/feature' })
    expect(rows[1]?.changedPaths).toEqual([])
  })

  it('marks rows past the dirty-check limit as unknown instead of zero', async () => {
    const { repo, sessionId } = await compose()
    await addWorktree(repo, repo + '-a', 'a')
    await addWorktree(repo, repo + '-b', 'b')
    const ctx = new Context()
    provideHostServices(ctx, [{ id: sessionId, cwd: repo }])
    const service = new GitWorktreeService(ctx, { ...TEST_CONFIG, dirtyCheckLimit: 1 })
    const rows = await service.worktrees(sessionId)
    expect(rows[0]?.dirtyChecked).toBe(true)
    expect(rows[1]).toMatchObject({ dirtyChecked: false, dirtyCount: 0 })
  })
})

describe('worktree creation', () => {
  it('creates with the default path and branch, then lists the new row', async () => {
    const { repo, sessionId, service } = await compose()
    const row = await service.addWorktree(sessionId, { name: 'feature', createBranch: true })
    expect(row.path).toBe(repo + '-feature')
    expect(row.branch).toBe('refs/heads/feature')
    const rows = await service.worktrees(sessionId)
    expect(rows.some(entry => entry.path === row.path)).toBe(true)
  })

  it('honors explicit branch and path overrides', async () => {
    const { repo, sessionId, service } = await compose()
    const row = await service.addWorktree(sessionId, {
      name: 'x', branch: 'topic', createBranch: true, path: repo + '-explicit',
    })
    expect(row.path).toBe(repo + '-explicit')
    expect(row.branch).toBe('refs/heads/topic')
  })

  it('rejects a name that is not a plain path segment', async () => {
    const { sessionId, service } = await compose()
    await expect(service.addWorktree(sessionId, { name: 'a/b' })).rejects.toMatchObject({ code: 'git/command-failed' })
  })

  it('surfaces git refusal as git/command-failed with the stderr', async () => {
    const { sessionId, service } = await compose()
    // A start point that does not exist makes git worktree add fail.
    await expect(service.addWorktree(sessionId, { name: 'x', startPoint: 'no-such-ref' }))
      .rejects.toMatchObject({ code: 'git/command-failed' })
  })
})

describe('worktree removal protection', () => {
  it('refuses the main worktree with git/protected', async () => {
    const { repo, sessionId, service } = await compose()
    await expect(service.removeWorktree(sessionId, repo, false)).rejects.toMatchObject({ code: 'git/protected' })
  })

  it('refuses the session workspace worktree with git/protected', async () => {
    const { repo, sessionId, service } = await compose()
    const wt = repo + '-wt'
    await addWorktree(repo, wt, 'feature')
    // Move the session into the worktree: that workspace is now undeletable.
    const ctx = new Context()
    provideHostServices(ctx, [{ id: 'session-wt', cwd: wt }])
    const wtService = new GitWorktreeService(ctx, TEST_CONFIG)
    await expect(wtService.removeWorktree('session-wt', wt, false)).rejects.toMatchObject({ code: 'git/protected' })
    // The main repo from the same session is still refused too.
    await expect(wtService.removeWorktree('session-wt', repo, false)).rejects.toMatchObject({ code: 'git/protected' })
    void sessionId
    void service
  })

  it('refuses a dirty worktree with git/dirty and a change summary', async () => {
    const { repo, sessionId, service } = await compose()
    const wt = repo + '-wt'
    await addWorktree(repo, wt, 'feature')
    await writeFile(wt + '/README.md', 'dirty\n')
    const error = await service.removeWorktree(sessionId, wt, false).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).code).toBe('git/dirty')
    const detail = JSON.parse((error as GitError).detail ?? '{}') as { dirty?: { count?: number; paths?: string[] } }
    expect(detail.dirty?.count).toBe(1)
    expect(detail.dirty?.paths).toEqual(['README.md'])
    // Nothing was deleted.
    expect(await service.worktrees(sessionId).then(rows => rows.some(row => row.path === wt))).toBe(true)
  })

  it('deletes a dirty worktree only with explicit discardChanges', async () => {
    const { repo, sessionId, service } = await compose()
    const wt = repo + '-wt'
    await addWorktree(repo, wt, 'feature')
    await writeFile(wt + '/README.md', 'dirty\n')
    await service.removeWorktree(sessionId, wt, true)
    const rows = await service.worktrees(sessionId)
    expect(rows.some(row => row.path === wt)).toBe(false)
  })

  it('deletes a clean worktree without any discard flag', async () => {
    const { repo, sessionId, service } = await compose()
    const wt = repo + '-wt'
    await addWorktree(repo, wt, 'feature')
    await service.removeWorktree(sessionId, wt, false)
    const rows = await service.worktrees(sessionId)
    expect(rows.some(row => row.path === wt)).toBe(false)
  })

  it('refuses an unknown path with git/command-failed', async () => {
    const { sessionId, service } = await compose()
    await expect(service.removeWorktree(sessionId, '/nonexistent/wt', false))
      .rejects.toMatchObject({ code: 'git/command-failed' })
  })
})

import { writeFile } from 'node:fs/promises'
