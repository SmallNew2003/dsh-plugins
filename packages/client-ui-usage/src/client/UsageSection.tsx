/**
 * Usage settings section: summary cards, the provider share table with
 * expandable model breakdown, the daily bar chart, and the top-sessions
 * table. Data arrives through the inject face (one shared UsageController);
 * while the host reports a scan in progress the section re-polls on a fixed
 * cadence, and a failed read degrades to an inline error with retry.
 *
 * @module dsh-client-ui-usage/UsageSection
 */

import { Fragment, useEffect, useState } from 'react'
import { usageTotal, type ProviderUsageRow, type UsageSummaryResponse } from 'dsh-usage-host/shared'
import type { InjectFace, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { isServiceMissing } from './controller.ts'
import type { UsageController } from './controller.ts'
import { NS } from './locales.ts'
import css from './UsageSection.module.css'

/** Injected dependencies of {@link UsageSection} (the slot inject face). */
export interface UsageSectionInjected {
  /** Data carrier for the usage summary route; one instance per plugin life. */
  readonly controller: UsageController
  /** The usage-namespace translator. */
  readonly t: TranslateNS<typeof NS>
}

/**
 * Props delivered by the slot outlet: the inject face spread flat, each
 * member optional until the shell injects — a direct render without the face
 * mounts nothing (the ui-settings-models pattern).
 */
export type UsageSectionProps = Partial<InjectFace<UsageSectionInjected>>

/** Re-poll cadence while the host reports a background scan. */
const POLL_MS = 5_000

/** Re-poll cadence once the scan has settled — keeps the dashboard current. */
const IDLE_POLL_MS = 60_000

/** How many most-recent days the chart renders. */
const DAILY_DAYS = 30

/** ≥1e6 → x.xM; ≥1e3 → x.xK; else the integer itself. */
function formatTokens(count: number): string {
  if (count >= 1e6) return (count / 1e6).toFixed(1) + 'M'
  if (count >= 1e3) return (count / 1e3).toFixed(1) + 'K'
  return String(count)
}

/** Two-decimal USD amount. */
function formatUsd(amount: number): string {
  return '$' + amount.toFixed(2)
}

/** One provider's priced amount: the sum of its models' estimates (undefined = none priced). */
function providerUsd(row: ProviderUsageRow): number | undefined {
  let sum = 0
  let priced = false
  for (const model of row.models) {
    if (model.usd !== undefined) {
      sum += model.usd
      priced = true
    }
  }
  return priced ? sum : undefined
}

/** Final path segment — the cwd tail the sessions table shows. */
function pathTail(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

/**
 * Render the usage statistics section content.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function UsageSection(props: UsageSectionProps) {
  const { controller, t } = props
  const [response, setResponse] = useState<UsageSummaryResponse | undefined>(undefined)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading')
  // Keys of providers whose model breakdown the user collapsed; a provider
  // absent from the set renders expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  // Bumped by the retry button; the load effect re-runs with a fresh read.
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (controller === undefined) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (): Promise<void> => {
      try {
        const next = await controller.fetchSummary()
        if (cancelled) return
        setResponse(next)
        setStatus('ready')
        // Scan in progress: fast cadence until it settles; afterwards a slow
        // keep-fresh cadence. Either way the cleanup clears the pending timer.
        timer = setTimeout(() => { void load() }, next.scanning ? POLL_MS : IDLE_POLL_MS)
      } catch (error) {
        if (!cancelled) setStatus(isServiceMissing(error) ? 'missing' : 'error')
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [controller, reload])

  if (controller === undefined || t === undefined) return null

  const toggleProvider = (key: string): void => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (status === 'error' || status === 'missing') {
    return (
      <div className={css.section}>
        <div className={css.error}>
          <p>{status === 'missing' ? t('state.serviceMissing') : t('state.error')}</p>
          <button type="button" className={css.retry} onClick={() => { setReload(current => current + 1) }}>
            {t('state.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (response === undefined) {
    return <div className={css.section}><p>{t('state.scanning')}</p></div>
  }

  const totals = response.totals
  const daily = response.daily.slice(-DAILY_DAYS)
  const dailyMax = Math.max(0, ...daily.map(day => usageTotal(day.buckets)))

  return (
    <div className={css.section}>
      <h2>{t('summary.title')}</h2>
      {response.scanning ? <p>{t('state.scanning')}</p> : null}
      <div className={css.cards}>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('buckets.uncachedInput')}</span>
          <span className={css.cardValue}>{formatTokens(totals.uncachedInputTokens)}</span>
        </div>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('buckets.output')}</span>
          <span className={css.cardValue}>{formatTokens(totals.outputTokens)}</span>
        </div>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('buckets.cacheRead')}</span>
          <span className={css.cardValue}>{formatTokens(totals.cacheReadTokens)}</span>
        </div>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('buckets.cacheWrite')}</span>
          <span className={css.cardValue}>{formatTokens(totals.cacheWriteTokens)}</span>
        </div>
        <div className={css.card}>
          <span className={css.cardLabel}>{t('buckets.total')}</span>
          <span className={css.cardValue}>{formatTokens(usageTotal(totals))}</span>
        </div>
        {response.estimate !== undefined
          ? (
            <div className={css.card}>
              <span className={css.cardLabel}>{t('estimate.title')}</span>
              <span className={css.cardValue}>{formatUsd(response.estimate.totalUsd)}</span>
              <span className={css.cardLabel}>{t('estimate.disclaimer')}</span>
            </div>
          )
          : null}
        <div className={css.card}>
          <span className={css.cardLabel}>{t('summary.sessions')}</span>
          <span className={css.cardValue}>{String(response.sessionCount)}</span>
          {response.skippedSessions > 0
            ? <span className={css.cardLabel}>{t('summary.skipped', { count: response.skippedSessions })}</span>
            : null}
        </div>
      </div>

      <h3>{t('providers.title')}</h3>
      {response.providers.length === 0
        ? <p>{t('state.empty')}</p>
        : (
          <table className={css.table}>
            <thead>
              <tr>
                <th scope="col" aria-label={t('providers.title')} />
                <th scope="col">{t('buckets.uncachedInput')}</th>
                <th scope="col">{t('buckets.output')}</th>
                <th scope="col">{t('buckets.cacheRead')}</th>
                <th scope="col">{t('buckets.cacheWrite')}</th>
                <th scope="col">{t('estimate.title')}</th>
                <th scope="col">{t('share.of')}</th>
              </tr>
            </thead>
            <tbody>
              {response.providers.map(provider => {
                const open = !collapsed.has(provider.provider)
                const usd = providerUsd(provider)
                return (
                  <Fragment key={provider.provider}>
                    <tr>
                      <th scope="row" onClick={() => { toggleProvider(provider.provider) }}>{provider.displayName}</th>
                      <td>{formatTokens(provider.buckets.uncachedInputTokens)}</td>
                      <td>{formatTokens(provider.buckets.outputTokens)}</td>
                      <td>{formatTokens(provider.buckets.cacheReadTokens)}</td>
                      <td>{formatTokens(provider.buckets.cacheWriteTokens)}</td>
                      <td>{usd === undefined ? '—' : formatUsd(usd)}</td>
                      <td>
                        <div className={css.bar}>
                          <span className={css.barFill} style={{ width: Math.round(provider.share * 100) + '%' }} />
                        </div>
                      </td>
                    </tr>
                    {open
                      ? (
                        <tr>
                          <td colSpan={7}>
                            <table className={css.table}>
                              <thead>
                                <tr>
                                  <th scope="col">{t('models.title')}</th>
                                  <th scope="col">{t('buckets.uncachedInput')}</th>
                                  <th scope="col">{t('buckets.output')}</th>
                                  <th scope="col">{t('buckets.cacheRead')}</th>
                                  <th scope="col">{t('buckets.cacheWrite')}</th>
                                  <th scope="col">{t('estimate.title')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {provider.models.map(model => (
                                  <tr key={model.model}>
                                    <td>
                                      {model.displayName}
                                      {model.aliases.length > 0
                                        ? <span>{' (' + model.aliases.join(', ') + ')'}</span>
                                        : null}
                                    </td>
                                    <td>{formatTokens(model.buckets.uncachedInputTokens)}</td>
                                    <td>{formatTokens(model.buckets.outputTokens)}</td>
                                    <td>{formatTokens(model.buckets.cacheReadTokens)}</td>
                                    <td>{formatTokens(model.buckets.cacheWriteTokens)}</td>
                                    <td>{model.usd === undefined ? '—' : formatUsd(model.usd)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )
                      : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}

      <h3>{t('daily.title')}</h3>
      {daily.length === 0
        ? <p>{t('state.empty')}</p>
        : (
          <div className={css.daily}>
            {daily.map(day => {
              const dayTotal = usageTotal(day.buckets)
              const height = dailyMax > 0 ? Math.round((dayTotal / dailyMax) * 100) : 0
              return (
                <div
                  key={day.date}
                  className={css.column}
                  style={{ height: height + '%' }}
                  title={day.date + ' · ' + formatTokens(dayTotal)}
                />
              )
            })}
          </div>
        )}

      <h3>{t('sessions.title')}</h3>
      {response.topSessions.length === 0
        ? <p>{t('state.empty')}</p>
        : (
          <table className={css.table}>
            <thead>
              <tr>
                <th scope="col" aria-label={t('sessions.title')} />
                <th scope="col">{t('buckets.uncachedInput')}</th>
                <th scope="col">{t('buckets.output')}</th>
                <th scope="col">{t('buckets.cacheRead')}</th>
                <th scope="col">{t('buckets.cacheWrite')}</th>
              </tr>
            </thead>
            <tbody>
              {response.topSessions.map(session => (
                <tr key={session.sessionId}>
                  <th scope="row">
                    {session.title ?? t('sessions.untitled')}
                    {session.cwd !== undefined ? <span>{' ' + pathTail(session.cwd)}</span> : null}
                  </th>
                  <td>{formatTokens(session.buckets.uncachedInputTokens)}</td>
                  <td>{formatTokens(session.buckets.outputTokens)}</td>
                  <td>{formatTokens(session.buckets.cacheReadTokens)}</td>
                  <td>{formatTokens(session.buckets.cacheWriteTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {response.unpricedModels.length > 0
        ? <p className={css.notice}>{t('unpriced.intro')}</p>
        : null}
    </div>
  )
}
