/**
 * Canonical model/provider registry with alias normalization.
 *
 * Raw (provider, model) pairs are never rewritten in stored data; the
 * normalizer is a view. Version = rules version + content hash, so any
 * registry edit invalidates the persisted usage index wholesale.
 *
 * @module dsh-usage-host/registry
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const RULES_VERSION = 1

export interface ModelPricing {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

export interface ModelEntry {
  readonly displayName: string
  readonly aliases?: readonly string[]
  readonly pricing?: ModelPricing
}

export interface ProviderEntry {
  readonly displayName: string
  readonly aliases?: readonly string[]
}

export interface ModelRegistryData {
  readonly providers?: Record<string, ProviderEntry>
  readonly models?: Record<string, ModelEntry>
}

export interface NormalizedRoute {
  readonly providerKey: string
  readonly providerDisplayName: string
  readonly modelKey: string
  readonly displayName: string
  readonly recognized: boolean
}

export interface Normalizer {
  readonly version: string
  normalize(provider: string, rawModel: string): NormalizedRoute
  modelEntry(modelKey: string): ModelEntry | undefined
}

/** 注册表候选键:原值优先,逐步宽松。 */
function candidateIds(raw: string): string[] {
  const lower = raw.toLowerCase()
  const noDate = lower.replace(/-\d{8}$/, '')
  const stripped = [lower, noDate].flatMap(value => [
    value,
    value.replace(/^ds-/, ''),
    value.replace(/^deepseek-/, ''),
  ])
  return [...new Set([raw, ...stripped])]
}

export function buildNormalizer(data: ModelRegistryData): Normalizer {
  const models = new Map<string, ModelEntry>(Object.entries(data.models ?? {}))
  const modelAlias = new Map<string, string>()
  for (const [key, entry] of models) {
    for (const candidate of [key, ...(entry.aliases ?? [])]) modelAlias.set(candidate.toLowerCase(), key)
  }
  const providers = new Map<string, ProviderEntry>(Object.entries(data.providers ?? {}))
  const providerAlias = new Map<string, string>()
  for (const [key, entry] of providers) {
    for (const candidate of [key, ...(entry.aliases ?? [])]) providerAlias.set(candidate.toLowerCase(), key)
  }

  function normalize(provider: string, rawModel: string): NormalizedRoute {
    const providerKey = providerAlias.get(provider.toLowerCase()) ?? provider
    const providerDisplayName = providers.get(providerKey)?.displayName ?? providerKey
    for (const candidate of candidateIds(rawModel)) {
      const scoped = modelAlias.get(providerKey.toLowerCase() + '\u0000' + candidate)
      const aliasKey = scoped ?? modelAlias.get(candidate)
      if (aliasKey !== undefined) {
        const entry = models.get(aliasKey)!
        return {
          providerKey,
          providerDisplayName,
          modelKey: aliasKey,
          displayName: entry.displayName,
          recognized: true,
        }
      }
    }
    return { providerKey, providerDisplayName, modelKey: rawModel, displayName: rawModel, recognized: false }
  }

  const version = 'v' + RULES_VERSION + ':' + createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16)
  return {
    version,
    normalize,
    modelEntry: (modelKey) => models.get(modelKey),
  }
}

/** 内置注册表 + 用户覆盖文件(存在时浅合并)。 */
export function loadModelRegistry(overridesPath?: string): ModelRegistryData {
  const builtin = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8')) as ModelRegistryData
  if (overridesPath === undefined || !existsSync(overridesPath)) return builtin
  const overrides = JSON.parse(readFileSync(overridesPath, 'utf8')) as ModelRegistryData
  return {
    providers: { ...builtin.providers, ...overrides.providers },
    models: { ...builtin.models, ...overrides.models },
  }
}
