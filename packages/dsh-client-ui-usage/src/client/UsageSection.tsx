/**
 * Usage settings section with a compact overview, provider drill-down, daily
 * trend, and top-session ranking. Data arrives through the inject face; while
 * the host scans, the section re-polls on a fixed cadence.
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

export interface UsageSectionInjected {
  readonly controller: UsageController
  readonly t: TranslateNS<typeof NS>
}

export type UsageSectionProps = Partial<InjectFace<UsageSectionInjected>>

const POLL_MS = 5_000
const IDLE_POLL_MS = 60_000
const DAILY_DAYS = 30

function formatTokens(count: number): string {
  if (count >= 1e6) return (count / 1e6).toFixed(1) + 'M'
  if (count >= 1e3) return (count / 1e3).toFixed(1) + 'K'
  return String(count)
}

function formatUsd(amount: number): string { return '$' + amount.toFixed(2) }
function formatPercent(share: number): string { return Math.round(share * 100) + '%' }

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

function pathTail(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

export function UsageSection(props: UsageSectionProps) {
  const { controller, t } = props
  const [response, setResponse] = useState<UsageSummaryResponse | undefined>(undefined)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'missing'>('loading')
  const [expandedProviders, setExpandedProviders] = useState<ReadonlySet<string>>(() => new Set())
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
    setExpandedProviders(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (status === 'error' || status === 'missing') {
    return <div className={css.section}><div className={css.error}><p>{status === 'missing' ? t('state.serviceMissing') : t('state.error')}</p><button type="button" className={css.retry} onClick={() => { setReload(current => current + 1) }}>{t('state.retry')}</button></div></div>
  }
  if (response === undefined) return <div className={css.section}><p>{t('state.scanning')}</p></div>

  const totals = response.totals
  const totalTokens = usageTotal(totals)
  const daily = response.daily.slice(-DAILY_DAYS)
  const dailyMax = Math.max(0, ...daily.map(day => usageTotal(day.buckets)))
  const updatedAt = response.generatedAt > 0 ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(response.generatedAt)) : undefined

  return (
    <div className={css.section}>
      <header className={css.header}>
        <div><h2>{t('summary.title')}</h2>{updatedAt === undefined ? null : <p className={css.updatedAt}>{t('summary.updatedAt', { time: updatedAt })}</p>}</div>
        {response.scanning ? <span className={css.scanning}>{t('state.scanning')}</span> : null}
      </header>

      <div className={css.summaryGrid}>
        <div className={css.primaryMetrics}>
          <div className={css.primaryMetric}><span className={css.metricLabel}>{t('summary.totalTokens')}</span><strong className={css.primaryValue}>{formatTokens(totalTokens)}</strong></div>
          {response.estimate === undefined ? null : <div className={css.primaryMetric}><span className={css.metricLabel}>{t('estimate.title')}</span><strong className={css.primaryValue}>{formatUsd(response.estimate.totalUsd)}</strong><span className={css.metricHint}>{t('estimate.disclaimer')}</span></div>}
          <div className={css.primaryMetric}><span className={css.metricLabel}>{t('summary.sessions')}</span><strong className={css.primaryValue}>{String(response.sessionCount)}</strong>{response.skippedSessions > 0 ? <span className={css.metricHint}>{t('summary.skipped', { count: response.skippedSessions })}</span> : null}</div>
        </div>

        <section className={css.breakdown} aria-labelledby="usage-token-breakdown">
          <h3 id="usage-token-breakdown">{t('summary.breakdown')}</h3>
          <div className={css.breakdownGrid}>
            <div className={css.breakdownItem}><span>{t('buckets.uncachedInput')}</span><strong>{formatTokens(totals.uncachedInputTokens)}</strong></div>
            <div className={css.breakdownItem}><span>{t('buckets.output')}</span><strong>{formatTokens(totals.outputTokens)}</strong></div>
            <div className={css.breakdownItem}><span>{t('buckets.cacheRead')}</span><strong>{formatTokens(totals.cacheReadTokens)}</strong></div>
            <div className={css.breakdownItem}><span>{t('buckets.cacheWrite')}</span><strong>{formatTokens(totals.cacheWriteTokens)}</strong></div>
          </div>
        </section>
      </div>

      <div className={css.analysisGrid}>
        <section className={css.panel} aria-labelledby="usage-daily-title">
          <div className={css.panelHeader}><h3 id="usage-daily-title">{t('daily.title')}</h3><span>{daily.length + ' / ' + DAILY_DAYS}</span></div>
          {daily.length === 0 ? <p>{t('state.empty')}</p> : <><div className={css.daily} role="list" aria-label={t('daily.title')}>{daily.map(day => { const dayTotal = usageTotal(day.buckets); const height = dailyMax > 0 ? Math.round((dayTotal / dailyMax) * 100) : 0; return <div key={day.date} className={css.column} style={{ height: height + '%' }} title={day.date + ' · ' + formatTokens(dayTotal)} aria-label={day.date + ' · ' + formatTokens(dayTotal)} role="listitem" /> })}</div><div className={css.dailyAxis}><span>{daily[0]?.date}</span><span>{daily.at(-1)?.date}</span></div></>}
        </section>

        <section className={css.panel} aria-labelledby="usage-providers-title">
          <div className={css.panelHeader}><h3 id="usage-providers-title">{t('providers.title')}</h3><span>{response.providers.length}</span></div>
          {response.providers.length === 0 ? <p>{t('state.empty')}</p> : <div className={css.tableFrame}><table className={css.table}><thead><tr><th scope="col">{t('providers.title')}</th><th scope="col">{t('summary.totalTokens')}</th><th scope="col">{t('estimate.title')}</th><th scope="col">{t('share.of')}</th></tr></thead><tbody>
            {response.providers.map(provider => {
              const open = expandedProviders.has(provider.provider)
              const usd = providerUsd(provider)
              return <Fragment key={provider.provider}><tr><th scope="row"><button type="button" className={css.providerToggle} aria-expanded={open} aria-label={open ? t('providers.collapse', { name: provider.displayName }) : t('providers.expand', { name: provider.displayName })} onClick={() => { toggleProvider(provider.provider) }}><span>{provider.displayName}</span><span className={css.modelCount}>{t('providers.modelCount', { count: provider.models.length })}</span></button></th><td>{formatTokens(usageTotal(provider.buckets))}</td><td>{usd === undefined ? '—' : formatUsd(usd)}</td><td><div className={css.shareCell}><span>{formatPercent(provider.share)}</span><div className={css.bar} aria-hidden="true"><span className={css.barFill} style={{ width: formatPercent(provider.share) }} /></div></div></td></tr>
                {open ? <tr className={css.detailRow}><td colSpan={4}><table className={css.modelTable} aria-label={t('models.title')}><thead><tr><th scope="col">{t('models.title')}</th><th scope="col">{t('summary.totalTokens')}</th><th scope="col">{t('estimate.title')}</th></tr></thead><tbody>{provider.models.map(model => <tr key={model.model}><th scope="row"><strong>{model.displayName}</strong>{model.aliases.length > 0 ? <span className={css.aliases}>{model.aliases.join(', ')}</span> : null}</th><td>{formatTokens(usageTotal(model.buckets))}</td><td>{model.usd === undefined ? '—' : formatUsd(model.usd)}</td></tr>)}</tbody></table></td></tr> : null}
              </Fragment>
            })}
          </tbody></table></div>}
        </section>
      </div>

      <section className={css.panel} aria-labelledby="usage-sessions-title">
        <div className={css.panelHeader}><h3 id="usage-sessions-title">{t('sessions.title')}</h3><span>{response.topSessions.length}</span></div>
        {response.topSessions.length === 0 ? <p>{t('state.empty')}</p> : <div className={css.tableFrame}><table className={css.table}><thead><tr><th scope="col">{t('sessions.title')}</th><th scope="col">{t('summary.totalTokens')}</th></tr></thead><tbody>{response.topSessions.map(session => <tr key={session.sessionId}><th scope="row"><span>{session.title ?? t('sessions.untitled')}</span>{session.cwd === undefined ? null : <span className={css.sessionPath}>{pathTail(session.cwd)}</span>}</th><td>{formatTokens(usageTotal(session.buckets))}</td></tr>)}</tbody></table></div>}
      </section>

      {response.unpricedModels.length > 0 ? <p className={css.notice}>{t('unpriced.intro')}</p> : null}
    </div>
  )
}
