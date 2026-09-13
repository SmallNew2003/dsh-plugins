### Task 3: 模型注册表与归一化(TDD)

**Files:**
- Create: packages/usage-host/src/models.json
- Create: packages/usage-host/src/registry.ts
- Test: packages/usage-host/tests/registry.spec.ts

**Interfaces:**
- Produces:
  - interface ModelPricing — { input: number; cacheRead: number; cacheWrite: number; output: number }($/M tokens)
  - interface ModelEntry — { displayName: string; aliases?: readonly string[]; pricing?: ModelPricing }
  - interface ProviderEntry — { displayName: string; aliases?: readonly string[] }
  - interface ModelRegistryData — { providers?: Record<string, ProviderEntry>; models?: Record<string, ModelEntry> }
  - interface NormalizedRoute — { providerKey: string; providerDisplayName: string; modelKey: string; displayName: string; recognized: boolean }
  - interface Normalizer — { version: string; normalize(provider: string, rawModel: string): NormalizedRoute; modelEntry(modelKey: string): ModelEntry | undefined }
  - loadModelRegistry(overridesPath?: string): ModelRegistryData(内置 models.json + 用户覆盖文件浅合并,同名 key 覆盖)
- 归一规则 RULES_VERSION = 1:model 候选序列 = [原值, 小写化, 去 -YYYYMMDD 日期后缀(正则 /-\d{8}$/), 去 ds-/deepseek- 前缀, 组合];每个候选先查 provider 作用域别名(providerKey 小写 + NUL + candidate),再查全局别名;provider 同法(小写化 + 别名表)。version = "v1:" + sha256(JSON.stringify(data)) 前 16 个 hex 字符。

- [ ] **Step 1: 写内置 models.json(数据文件,手工维护)**

```
json
{
  "providers": {
    "deepseek": { "displayName": "DeepSeek", "aliases": ["ds"] },
    "anthropic": { "displayName": "Anthropic", "aliases": [] },
    "openai": { "displayName": "OpenAI", "aliases": [] },
    "unattributed": { "displayName": "未归因 / Unattributed", "aliases": [] }
  },
  "models": {
    "deepseek-chat": {
      "displayName": "DeepSeek Chat",
      "aliases": ["deepseek-chat-20260115", "ds-chat"],
      "pricing": { "input": 0.27, "cacheRead": 0.027, "cacheWrite": 0.27, "output": 1.1 }
    },
    "deepseek-reasoner": {
      "displayName": "DeepSeek Reasoner",
      "aliases": ["deepseek-reasoner-20260115", "ds-reasoner"],
      "pricing": { "input": 0.55, "cacheRead": 0.055, "cacheWrite": 0.55, "output": 2.19 }
    }
  }
}
```

单价为示例美元价($/M tokens),交付前按当期官方价目核对修正——这是数据修正,不是实现占位。用户覆盖文件默认路径 ~/.dsh/storages/usage-host/models.json,存在时浅合并。

- [ ] **Step 2: 写失败测试**

```
ts
import { describe, expect, it } from 'vitest'
import { buildNormalizer, type ModelRegistryData } from '../src/registry.ts'

const data: ModelRegistryData = {
  providers: { deepseek: { displayName: 'DeepSeek', aliases: ['ds'] } },
  models: {
    'deepseek-v4-flash': {
      displayName: 'DeepSeek V4 Flash',
      aliases: ['ds-v4-flash', 'deepseek-v4-flash-20260115'],
      pricing: { input: 0.2, cacheRead: 0.02, cacheWrite: 0.2, output: 1.2 },
    },
  },
}

describe('buildNormalizer', () => {
  const normalizer = buildNormalizer(data)

  it('maps exact and aliased model ids to the canonical entry', () => {
    expect(normalizer.normalize('deepseek', 'deepseek-v4-flash').modelKey).toBe('deepseek-v4-flash')
    expect(normalizer.normalize('deepseek', 'ds-v4-flash').modelKey).toBe('deepseek-v4-flash')
    expect(normalizer.normalize('deepseek', 'DeepSeek-V4-Flash').modelKey).toBe('deepseek-v4-flash')
  })

  it('strips date suffixes and provider prefixes as fallback candidates', () => {
    expect(normalizer.normalize('deepseek', 'deepseek-v4-flash-20260115').modelKey).toBe('deepseek-v4-flash')
    expect(normalizer.normalize('deepseek', 'ds-v4-flash-20260301').modelKey).toBe('deepseek-v4-flash')
  })

  it('normalizes provider aliases and carries the provider display name', () => {
    const route = normalizer.normalize('ds', 'ds-v4-flash')
    expect(route.providerKey).toBe('deepseek')
    expect(route.providerDisplayName).toBe('DeepSeek')
  })

  it('keeps unrecognized models under their raw id, unpriced', () => {
    const route = normalizer.normalize('mystery', 'goblin-9x')
    expect(route.recognized).toBe(false)
    expect(route.modelKey).toBe('goblin-9x')
    expect(route.displayName).toBe('goblin-9x')
  })

  it('answers modelEntry only for canonical keys', () => {
    expect(normalizer.modelEntry('deepseek-v4-flash')?.displayName).toBe('DeepSeek V4 Flash')
    expect(normalizer.modelEntry('ds-v4-flash')).toBeUndefined()
  })

  it('derives a stable version from the registry content', () => {
    expect(normalizer.version).toMatch(/^v1:[0-9a-f]{16}$/)
    expect(buildNormalizer(data).version).toBe(normalizer.version)
    expect(buildNormalizer({ ...data, models: {} }).version).not.toBe(normalizer.version)
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/registry.spec.ts
Expected: FAIL。

- [ ] **Step 4: 实现 src/registry.ts**

```
ts
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
```

注:buildNormalizer 内的 scoped/global 别名键里的 \u0000 是 JS 字符串转义(NUL),与 routeKey 的分隔约定一致;models.json 的 key 本身不含 NUL。

- [ ] **Step 5: 运行确认通过**

Run: pnpm --filter dsh-usage-host exec vitest run tests/registry.spec.ts
Expected: PASS。

- [ ] **Step 6: Commit**

```
bash
git add packages/usage-host/src/models.json packages/usage-host/src/registry.ts packages/usage-host/tests/registry.spec.ts
git commit -m "feat(usage-host): canonical model registry and alias normalization"
```

---

