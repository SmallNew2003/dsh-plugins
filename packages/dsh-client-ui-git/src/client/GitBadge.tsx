import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { GitController, GitErrorBodyWire } from './controller.ts'
import type { GitStatusPayload, GitWorktreeRow } from 'dsh-git-host/shared'
import { NS, type GitKey } from './locales.ts'
import type { SessionProps, Translate } from './vendor-types.ts'
import css from './GitBadge.module.css'

/** Slot-injected carrier: the shared controller owns every host fetch. */
export interface GitBadgeInjected {
  /** Data carrier for the git routes; one instance per plugin life. */
  readonly controller: GitController
}

/**
 * Full props: the session-standard seat, the namespace translator, and the
 * registrant inject face — the runtime/locale/inject share discipline of the
 * slot framework, consumed only in the shapes this component uses.
 */
export type GitBadgeProps = SessionProps & { readonly t: Translate } & GitBadgeInjected

/** True when the value is a structured host error, not data. */
function isFailure(value: unknown): value is GitErrorBodyWire {
  return typeof value === 'object' && value !== null
    && typeof (value as { code?: unknown }).code === 'string'
    && typeof (value as { message?: unknown }).message === 'string'
}

/** Copy for one structured error; unknown codes degrade to the generic line. */
function errorMessage(value: GitErrorBodyWire, t: Translate): string {
  const key = ('error.' + value.code) as GitKey
  const specific = t(key)
  // A known code translates to a whole phrase; an unknown code falls back to
  // the generic line carrying the host message (and detail when present).
  return specific === key
    ? t('error.generic', { message: value.message + (value.detail === undefined ? '' : ' (' + value.detail + ')') })
    : specific
}

/**
 * Session-header git badge: current branch, worktree marker, and the
 * worktree management panel. Renders nothing at all unless the session cwd
 * resolved to a git repository the host could read.
 * @param props - session id, namespace translator, and the controller.
 */
export function GitBadge({ sessionId, t, controller }: GitBadgeProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<GitStatusPayload | GitErrorBodyWire | undefined>(undefined)
  const [rows, setRows] = useState<readonly GitWorktreeRow[] | undefined>(undefined)
  const [panelError, setPanelError] = useState<string | undefined>(undefined)
  const [discarding, setDiscarding] = useState<Readonly<Record<string, boolean>>>({})
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Outside-pointer dismissal, local to the plugin: one document listener
  // while the panel is open (same semantics as the primitives hook).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open])

  // Badge facts: one fetch per session identity (TTL-cached in the carrier).
  // A failed read renders nothing, exactly like the A1 non-repo case.
  useEffect(() => {
    let alive = true
    controller.status(sessionId).then(next => {
      if (alive) setStatus(next)
    })
    return () => { alive = false }
  }, [sessionId, controller])

  /** Full panel read: status and worktrees, always re-pulled fresh. */
  const refreshPanel = useCallback(async (): Promise<void> => {
    const [nextStatus, nextRows] = await Promise.all([
      controller.status(sessionId, { force: true }),
      controller.worktrees(sessionId),
    ])
    setStatus(nextStatus)
    setRows(isFailure(nextRows) ? undefined : nextRows)
    if (isFailure(nextRows)) setPanelError(errorMessage(nextRows, t))
  }, [sessionId, controller, t])

  useEffect(() => {
    if (!open) return
    setDiscarding({})
    setPanelError(undefined)
    void refreshPanel()
  }, [open, refreshPanel])

  if (status === undefined || isFailure(status)) return null
  const known: GitStatusPayload = status

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }

  /** One add-form submit; success refetches the listing. */
  const submitAdd = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (name.length === 0 || busy) return
    setBusy(true)
    setPanelError(undefined)
    // The branch field defaults to the name (placeholder says so): creating
    // the branch is the form's contract, so createBranch is always sent.
    const request: { name: string; branch?: string; createBranch: boolean; path?: string } = { name, createBranch: true }
    if (branch.length > 0) request['branch'] = branch
    if (path.length > 0) request['path'] = path
    const created = await controller.addWorktree(sessionId, request)
    setBusy(false)
    if (!isFailure(created)) {
      setName('')
      setBranch('')
      setPath('')
      const listing = await controller.worktrees(sessionId)
      setRows(isFailure(listing) ? undefined : listing)
    } else {
      setPanelError(errorMessage(created, t))
    }
  }

  /** One delete click; the checkbox already covers the discard confirmation. */
  const submitRemove = async (row: GitWorktreeRow): Promise<void> => {
    if (busy) return
    setBusy(true)
    setPanelError(undefined)
    const done = await controller.removeWorktree(sessionId, row.path, discarding[row.path] === true)
    setBusy(false)
    if (done === true) {
      setDiscarding(current => {
        const next = { ...current }
        delete next[row.path]
        return next
      })
      const listing = await controller.worktrees(sessionId)
      setRows(isFailure(listing) ? undefined : listing)
    } else {
      setPanelError(errorMessage(done, t))
    }
  }

  const tooltip = known.isWorktree
    ? t('badge.tooltip.worktree', {
        branch: known.branch,
        worktreePath: known.worktreePath,
        mainRepoPath: known.mainRepoPath,
      })
    : t('badge.tooltip.repo', { branch: known.branch })

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown} data-namespace={NS}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        title={tooltip}
        onClick={() => { setOpen(current => !current) }}
      >
        {known.isWorktree ? <span className={css.marker} aria-hidden>⌥</span> : null}
        <span>{known.branch}</span>
      </button>
      {open
        ? (
          <div className={css.panel} role="dialog" aria-label={t('panel.title')}>
            <div className={css.panelHeader}>
              <span className={css.panelTitle}>{t('panel.title')}</span>
              <button type="button" className={css.refresh} onClick={() => { void refreshPanel() }}>
                {t('panel.refresh')}
              </button>
            </div>
            {panelError !== undefined ? <p className={css.error}>{panelError}</p> : null}
            <ul className={css.list}>
              {(rows ?? []).map(row => {
                const protectedRow = row.isMain || row.path === known.worktreePath
                const dirtyKnown = row.dirtyChecked
                const discardChecked = discarding[row.path] === true
                return (
                  <li key={row.path}>
                    <div className={css.row}>
                      <span className={css.rowPath} title={row.path}>{row.path}</span>
                      <span className={css.rowBranch} title={row.branch}>{row.branch}</span>
                      {row.isMain ? <span className={css.mainBadge}>{t('panel.main.badge')}</span> : null}
                      <span className={css.dirty}>
                        {dirtyKnown ? t('panel.dirty.count', { count: row.dirtyCount }) : t('panel.dirty.unknown')}
                      </span>
                      {protectedRow
                        ? null
                        : (
                          <button
                            type="button"
                            className={css.delete}
                            disabled={busy || (dirtyKnown && row.dirtyCount > 0 && !discardChecked)}
                            onClick={() => { void submitRemove(row) }}
                          >
                            {t('panel.delete')}
                          </button>
                        )}
                    </div>
                    {!protectedRow && dirtyKnown && row.dirtyCount > 0
                      ? (
                        <div className={css.deleteRow}>
                          <label>
                            <input
                              type="checkbox"
                              checked={discardChecked}
                              onChange={event => {
                                setDiscarding(current => ({ ...current, [row.path]: event.target.checked }))
                              }}
                            />
                            {' ' + t('panel.delete.discard')}
                          </label>
                          <span title={t('panel.dirty.summary', { count: row.dirtyCount, paths: row.changedPaths?.join(', ') ?? '' })}>
                            {t('panel.dirty.summary', { count: row.dirtyCount, paths: row.changedPaths?.join(', ') ?? '' })}
                          </span>
                        </div>
                      )
                      : null}
                  </li>
                )
              })}
            </ul>
            <form className={css.addForm} onSubmit={event => { void submitAdd(event) }}>
              <label htmlFor="dsh-git-add-name">{t('add.name')}</label>
              <input
                id="dsh-git-add-name"
                value={name}
                onChange={event => { setName(event.target.value) }}
                required
              />
              <label htmlFor="dsh-git-add-branch">{t('add.branch')}</label>
              <input
                id="dsh-git-add-branch"
                value={branch}
                placeholder={t('add.branch.same')}
                onChange={event => { setBranch(event.target.value) }}
              />
              <label htmlFor="dsh-git-add-path">{t('add.path')}</label>
              <input
                id="dsh-git-add-path"
                value={path}
                placeholder={defaultPathOf(known, name)}
                onChange={event => { setPath(event.target.value) }}
              />
              <button type="submit" className={css.submit} disabled={busy || name.length === 0}>
                {busy ? t('add.creating') : t('add.submit')}
              </button>
            </form>
          </div>
        )
        : null}
    </div>
  )
}

/** Default new-worktree path: <repo parent>/<repo name>-<name>, host-identical. */
function defaultPathOf(status: GitStatusPayload, name: string): string {
  if (name.length === 0) return status.mainRepoPath
  const index = status.mainRepoPath.lastIndexOf('/')
  const parent = index === -1 ? '' : status.mainRepoPath.slice(0, index)
  const repoName = status.mainRepoPath.slice(index + 1)
  return parent + '/' + repoName + '-' + name
}
