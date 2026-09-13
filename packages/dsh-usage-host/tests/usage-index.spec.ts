import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})
import { emptyBuckets, foldSessionUsage, type RawUsageEvent } from '../src/fold-usage.ts'
import { entryOf, loadIndex, saveIndexAtomic, type UsageIndexFile } from '../src/usage-index.ts'

function message(provider: string, model: string, output: number, turn: number): RawUsageEvent {
  return {
    type: 'assistant/message',
    time: new Date(2026, 8, 11).getTime(),
    data: { turn, step: 1, usage: { inputTokens: 0, outputTokens: output }, message: { source: { provider, model } } },
  }
}

describe('usage index', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'usage-index-'))
    path = join(dir, 'nested', 'index.json')
    vi.mocked(writeFile).mockClear()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads an empty index when the file does not exist', () => {
    const index = loadIndex(path, 'v1:abc')
    expect(index).toEqual({ version: 1, normalizerVersion: 'v1:abc', sessions: {} })
  })

  it('round-trips through saveIndexAtomic', async () => {
    const fold = foldSessionUsage([message('deepseek', 'm1', 10, 1)])
    const index: UsageIndexFile = {
      version: 1,
      normalizerVersion: 'v1:abc',
      sessions: { s1: entryOf(fold, 'hello') },
    }
    await saveIndexAtomic(path, index)
    expect(loadIndex(path, 'v1:abc')).toEqual(index)
    expect(index.sessions['s1']!.title).toBe('hello')
    expect(index.sessions['s1']!.eventCount).toBe(1)
    expect(index.sessions['s1']!.routes).toEqual(Object.fromEntries(fold.routes))
    expect(index.sessions['s1']!.daily).toEqual(Object.fromEntries(fold.daily))
  })

  it('loads an empty index for corrupt JSON', async () => {
    const corruptPath = join(dir, 'corrupt.json')
    await writeFile(corruptPath, '<not json', 'utf8')
    expect(loadIndex(corruptPath, 'v1:abc')).toEqual({ version: 1, normalizerVersion: 'v1:abc', sessions: {} })
  })

  it('clears sessions when the normalizer version mismatches', async () => {
    const fold = foldSessionUsage([message('deepseek', 'm1', 10, 1)])
    await saveIndexAtomic(path, { version: 1, normalizerVersion: 'v1:old', sessions: { s1: entryOf(fold) } })
    const index = loadIndex(path, 'v1:new')
    expect(index.version).toBe(1)
    expect(index.normalizerVersion).toBe('v1:new')
    expect(index.sessions).toEqual({})
  })

  it('leaves no .tmp- residue after an atomic save', async () => {
    const index: UsageIndexFile = { version: 1, normalizerVersion: 'v1:abc', sessions: {} }
    await saveIndexAtomic(path, index)
    await saveIndexAtomic(path, index)
    const files = await readdir(join(dir, 'nested'))
    expect(files).toEqual(['index.json'])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(index)
  })

  it('writes each save to a unique tmp filename', async () => {
    const index: UsageIndexFile = { version: 1, normalizerVersion: 'v1:abc', sessions: {} }
    await saveIndexAtomic(path, index)
    await saveIndexAtomic(path, index)
    const written = vi.mocked(writeFile).mock.calls.map((call) => String(call[0]))
    expect(written.length).toBe(2)
    expect(new Set(written).size).toBe(written.length)
  })

  it('omits the title field when no title is given', () => {
    const entry = entryOf(foldSessionUsage([message('p', 'm', 1, 1)]))
    expect('title' in entry).toBe(false)
    expect(entry.routes).toEqual(entryOf(foldSessionUsage([message('p', 'm', 1, 1)])).routes)
    expect(entryOf(foldSessionUsage([]), undefined).daily).toEqual({})
    expect(emptyBuckets()).toEqual({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })
})
