/**
 * Durable per-session usage index: one JSON file, event-count keyed, atomic
 * replace. Corruption or a normalizer-version change rebuilds from scratch.
 *
 * @module dsh-usage-host/usage-index
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SessionUsageFold } from './fold-usage.ts'
import type { UsageBuckets } from './shared.ts'

export interface SessionIndexEntry {
  readonly eventCount: number
  readonly title?: string
  readonly routes: Record<string, UsageBuckets>
  readonly daily: Record<string, UsageBuckets>
}

export interface UsageIndexFile {
  readonly version: 1
  readonly normalizerVersion: string
  readonly sessions: Record<string, SessionIndexEntry>
}

function emptyIndex(normalizerVersion: string): UsageIndexFile {
  return { version: 1, normalizerVersion, sessions: {} }
}

export function entryOf(fold: SessionUsageFold, title?: string): SessionIndexEntry {
  const routes: Record<string, UsageBuckets> = {}
  for (const [key, buckets] of fold.routes) routes[key] = buckets
  const daily: Record<string, UsageBuckets> = {}
  for (const [key, buckets] of fold.daily) daily[key] = buckets
  return { eventCount: fold.eventCount, ...(title === undefined ? {} : { title }), routes, daily }
}

export function loadIndex(path: string, normalizerVersion: string): UsageIndexFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return emptyIndex(normalizerVersion)
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyIndex(normalizerVersion)
  const candidate = parsed as Partial<UsageIndexFile>
  if (candidate.version !== 1 || candidate.normalizerVersion !== normalizerVersion
    || typeof candidate.sessions !== 'object' || candidate.sessions === null) {
    return emptyIndex(normalizerVersion)
  }
  return { version: 1, normalizerVersion, sessions: candidate.sessions }
}

export async function saveIndexAtomic(path: string, index: UsageIndexFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = path + '.tmp-' + String(process.pid)
  await writeFile(tmp, JSON.stringify(index))
  await rename(tmp, path)
}
