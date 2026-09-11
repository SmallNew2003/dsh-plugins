/** GitBadge behavior: badge facts, panel listing, deletion gating, add form. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitBadge } from '../src/client/GitBadge.tsx'
import { GitController, type GitErrorBodyWire } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import type { GitStatusPayload, GitWorktreeRow } from 'dsh-git-host/shared'

afterEach(cleanup)

/** A translator bound to the zh dictionary with {x} interpolation. */
function makeT() {
  return (key: string, params?: Record<string, string | number>): string => {
    const template = zh[key as keyof typeof zh] ?? key
    return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  }
}

const t = makeT()

/** A controller stub returning canned payloads per route. */
class StubController extends GitController {
  statusReply: GitStatusPayload | GitErrorBodyWire
  worktreesReply: readonly GitWorktreeRow[] | GitErrorBodyWire
  addReply: GitWorktreeRow | GitErrorBodyWire
  removeReply: true | GitErrorBodyWire = true
  readonly removeCalls: { path: string; discard: boolean }[] = []

  constructor(statusReply: GitStatusPayload | GitErrorBodyWire, worktreesReply: readonly GitWorktreeRow[] | GitErrorBodyWire = [], addReply: GitWorktreeRow | GitErrorBodyWire = { path: '', branch: '', head: '', isMain: false, dirtyCount: 0, dirtyChecked: true }) {
    super(async () => new Response('{}', { status: 200 }))
    this.statusReply = statusReply
    this.worktreesReply = worktreesReply
    this.addReply = addReply
  }

  override async status(): Promise<GitStatusPayload | GitErrorBodyWire> { return this.statusReply }
  override async worktrees(): Promise<readonly GitWorktreeRow[] | GitErrorBodyWire> { return this.worktreesReply }
  override async addWorktree(): Promise<GitWorktreeRow | GitErrorBodyWire> {
    this.worktreesReply = [...this.worktreesReply as readonly GitWorktreeRow[], this.addReply]
    return this.addReply
  }
  override async removeWorktree(_sessionId: string, path: string, discardChanges: boolean): Promise<true | GitErrorBodyWire> {
    this.removeCalls.push({ path, discard: discardChanges })
    return this.removeReply
  }
}

/** One main-repo status payload. */
function repoStatus(overrides: Partial<GitStatusPayload> = {}): GitStatusPayload {
  return { branch: 'main', isWorktree: false, worktreePath: '/repo', mainRepoPath: '/repo', dirtyCount: 0, ...overrides }
}

/** One worktree row. */
function wtRow(overrides: Partial<GitWorktreeRow> = {}): GitWorktreeRow {
  return { path: '/repo-wt', branch: 'refs/heads/feature', head: 'abc', isMain: false, dirtyCount: 0, dirtyChecked: true, changedPaths: [], ...overrides }
}

/** The default props over one controller stub. */
function props(controller: GitController) {
  return { sessionId: 'session-1', t, controller }
}

describe('badge trigger', () => {
  it('renders the branch of the session repository', async () => {
    render(<GitBadge {...props(new StubController(repoStatus()))} />)
    expect(await screen.findByTitle(t('badge.tooltip.repo', { branch: 'main' }))).toBeTruthy()
    expect(screen.getByText('main')).toBeTruthy()
  })

  it('marks worktree sessions with the worktree marker', async () => {
    render(<GitBadge {...props(new StubController(repoStatus({ isWorktree: true, branch: 'feature', worktreePath: '/repo-wt' })))} />)
    expect(await screen.findByTitle(t('badge.tooltip.worktree', { branch: 'feature', worktreePath: '/repo-wt', mainRepoPath: '/repo' }).replace(/\s+/g, ' '))).toBeTruthy()
  })

  it('renders nothing for a non-repository session', () => {
    const { container } = render(<GitBadge {...props(new StubController({ code: 'git/not-repo', message: 'not a repo' }))} />)
    expect(container.firstElementChild).toBeNull()
  })
})

describe('worktree panel', () => {
  it('lists every worktree with dirty counts on open', async () => {
    const controller = new StubController(repoStatus(), [wtRow(), wtRow({ path: '/repo', branch: 'refs/heads/main', isMain: true })])
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    expect(await screen.findByText('/repo-wt')).toBeTruthy()
    expect(screen.getByText('/repo')).toBeTruthy()
    expect(screen.getByText(t('panel.main.badge'))).toBeTruthy()
    expect(screen.getAllByText(t('panel.dirty.count', { count: 0 })).length).toBe(2)
  })

  it('renders no delete button for the main worktree and the session workspace', async () => {
    const controller = new StubController(repoStatus({ worktreePath: '/repo-current' }), [
      wtRow({ path: '/repo', isMain: true }),
      wtRow({ path: '/repo-current' }),
      wtRow(),
    ])
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    // Only the unprotected row offers a delete entry at all.
    const deletes = await screen.findAllByText(t('panel.delete'))
    expect(deletes).toHaveLength(1)
    expect((deletes[0] as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText('/repo').closest('li')?.querySelector('button[class*="delete"]')).toBeNull()
    expect(screen.getByText('/repo-current').closest('li')?.querySelector('button[class*="delete"]')).toBeNull()
  })

  it('requires the discard checkbox before deleting a dirty worktree', async () => {
    const controller = new StubController(repoStatus(), [wtRow({ dirtyCount: 2, changedPaths: ['a.md', 'b.md'] })])
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    const deleteButton = (await screen.findByText(t('panel.delete'))) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(true)
    expect(screen.getByText(t('panel.dirty.summary', { count: 2, paths: 'a.md, b.md' }))).toBeTruthy()
    fireEvent.click(screen.getByLabelText(t('panel.delete.discard')))
    expect(deleteButton.disabled).toBe(false)
    fireEvent.click(deleteButton)
    await waitFor(() => expect(controller.removeCalls).toEqual([{ path: '/repo-wt', discard: true }]))
  })

  it('deletes a clean worktree without any checkbox', async () => {
    const controller = new StubController(repoStatus(), [wtRow()])
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    const deleteButton = (await screen.findByText(t('panel.delete'))) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(false)
    fireEvent.click(deleteButton)
    await waitFor(() => expect(controller.removeCalls).toEqual([{ path: '/repo-wt', discard: false }]))
  })

  it('surfaces the structured refusal of a protected deletion', async () => {
    const controller = new StubController(repoStatus(), [wtRow()])
    controller.removeReply = { code: 'git/protected', message: 'protected' }
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    fireEvent.click((await screen.findByText(t('panel.delete'))) as HTMLButtonElement)
    expect(await screen.findByText(t('error.git/protected'))).toBeTruthy()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<GitBadge {...props(new StubController(repoStatus(), [wtRow()]))} />)
    const trigger = await screen.findByRole('button')
    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('renders unknown dirty state verbatim', async () => {
    const controller = new StubController(repoStatus(), [wtRow({ dirtyChecked: false, dirtyCount: 0 })])
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    expect(await screen.findByText(t('panel.dirty.unknown'))).toBeTruthy()
  })
})

describe('add form', () => {
  it('posts the name and refreshes the listing', async () => {
    const controller = new StubController(repoStatus(), [wtRow()], wtRow({ path: '/repo-topic', branch: 'refs/heads/topic' }))
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    const nameInput = await screen.findByLabelText(t('add.name'))
    fireEvent.change(nameInput, { target: { value: 'topic' } })
    fireEvent.click(screen.getByText(t('add.submit')))
    expect(await screen.findByText('/repo-topic')).toBeTruthy()
  })

  it('surfaces structured add failures in the panel', async () => {
    const controller = new StubController(repoStatus(), [], { code: 'git/command-failed', message: 'git worktree add failed' })
    render(<GitBadge {...props(controller)} />)
    fireEvent.click(await screen.findByRole('button'))
    fireEvent.change(await screen.findByLabelText(t('add.name')), { target: { value: 'x' } })
    fireEvent.click(screen.getByText(t('add.submit')))
    expect(await screen.findByText(t('error.git/command-failed'))).toBeTruthy()
  })

  it('shows the default path preview as the input placeholder', async () => {
    render(<GitBadge {...props(new StubController(repoStatus()))} />)
    fireEvent.click(await screen.findByRole('button'))
    const pathInput = await screen.findByLabelText(t('add.path')) as HTMLInputElement
    expect(pathInput.placeholder).toBe('/repo')
  })
})
