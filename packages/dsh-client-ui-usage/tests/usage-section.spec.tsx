import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { zh } from '../src/client/locales.ts'
import type { UsageSummaryResponse } from 'dsh-usage-host/shared'

const SUMMARY: UsageSummaryResponse = {
  generatedAt: 0,
  scanning: false,
  sessionCount: 2,
  skippedSessions: 0,
  totals: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
  providers: [{
    provider: 'deepseek',
    displayName: 'DeepSeek',
    buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
    share: 1,
    models: [{
      model: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      recognized: true,
      aliases: ['ds-v4-flash'],
      buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
      usd: 0.83,
    }],
  }],
  daily: [{ date: '2026-09-11', buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 } }],
  topSessions: [{ sessionId: 's1', title: '大项目', cwd: '/tmp/x', createdAt: 0, buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 } }],
  unpricedModels: [],
  estimate: { totalUsd: 0.83 },
}

const t = (key: string, vars?: Record<string, string | number>): string => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}

function mount(response: UsageSummaryResponse, fetchSummary = vi.fn().mockResolvedValue(response)) {
  const controller = { fetchSummary } as never
  render(<UsageSection controller={controller} t={t as never} />)
  return fetchSummary
}

describe('UsageSection', () => {
  afterEach(() => { cleanup() })

  it('renders provider rows with model detail and estimate', async () => {
    mount(SUMMARY)
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy())
    expect(screen.getByText('DeepSeek V4 Flash')).toBeTruthy()
    expect(screen.getByText('大项目')).toBeTruthy()
  })

  it('keeps polling while scanning; a settled response keeps polling at the 60s cadence', async () => {
    vi.useFakeTimers()
    const fetchSummary = vi.fn()
      .mockResolvedValueOnce({ ...SUMMARY, scanning: true })
      .mockResolvedValueOnce(SUMMARY)
    mount(SUMMARY, fetchSummary)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    vi.useRealTimers()
    expect(fetchSummary).toHaveBeenCalledTimes(2)
  })

  it('renders the unpriced notice when models lack pricing', async () => {
    const unpriced: UsageSummaryResponse = {
      ...SUMMARY,
      estimate: undefined,
      unpricedModels: ['goblin-9x'],
      providers: [{
        ...SUMMARY.providers[0]!,
        models: [{ model: 'goblin-9x', displayName: 'goblin-9x', recognized: false, aliases: [], buckets: SUMMARY.totals, usd: undefined }],
      }],
    }
    mount(unpriced)
    await waitFor(() => expect(screen.getByText(/goblin-9x/)).toBeTruthy())
  })

  it('shows the error state with retry after a failed fetch', async () => {
    mount(SUMMARY, vi.fn().mockRejectedValue(new Error('boom')))
    await waitFor(() => expect(screen.getByText(t('state.error'))).toBeTruthy())
    expect(screen.getByText(t('state.retry'))).toBeTruthy()
  })

  it('renders the service-missing state when the route answers 404', async () => {
    mount(SUMMARY, vi.fn().mockRejectedValue(new Error('usage: summary route failed with 404')))
    await waitFor(() => expect(screen.getByText(t('state.serviceMissing'))).toBeTruthy())
    expect(screen.queryByText(t('state.error'))).toBeNull()
  })

  it('renders the generic error state for other failures', async () => {
    mount(SUMMARY, vi.fn().mockRejectedValue(new Error('usage: summary route failed with 503')))
    await waitFor(() => expect(screen.getByText(t('state.error'))).toBeTruthy())
    expect(screen.queryByText(t('state.serviceMissing'))).toBeNull()
  })

  it('schedules exactly one refetch 60s after a settled response', async () => {
    vi.useFakeTimers()
    const fetchSummary = vi.fn().mockResolvedValue(SUMMARY)
    mount(SUMMARY, fetchSummary)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSummary).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(fetchSummary).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchSummary).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('cancels the pending 60s refetch on unmount', async () => {
    vi.useFakeTimers()
    const fetchSummary = vi.fn().mockResolvedValue(SUMMARY)
    const controller = { fetchSummary } as never
    const { unmount } = render(<UsageSection controller={controller} t={t as never} />)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchSummary).toHaveBeenCalledTimes(1)
    unmount()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(fetchSummary).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('renders the session count card with a skipped sub-line', async () => {
    mount({ ...SUMMARY, sessionCount: 7, skippedSessions: 2 })
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.getByText(t('summary.skipped', { count: 2 }))).toBeTruthy()
  })

  it('omits the skipped sub-line when no session was skipped', async () => {
    mount({ ...SUMMARY, sessionCount: 7, skippedSessions: 0 })
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.queryByText(t('summary.skipped', { count: 0 }))).toBeNull()
  })
})
