import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  it('renders provider rows with model detail and estimate', async () => {
    mount(SUMMARY)
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy())
    expect(screen.getByText('DeepSeek V4 Flash')).toBeTruthy()
    expect(screen.getByText('大项目')).toBeTruthy()
  })

  it('keeps polling while scanning and stops when settled', async () => {
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
})
