### Task 1: dsh-usage-host 包脚手架 + shared.ts 线上类型

**Files:**
- Create: packages/usage-host/package.json
- Create: packages/usage-host/tsconfig.json
- Create: packages/usage-host/tsdown.config.ts
- Create: packages/usage-host/src/index.ts(占位:仅 name/apply 空实现,Task 8 整体替换)
- Create: packages/usage-host/src/shared.ts

**Interfaces:**
- Produces: USAGE_SUMMARY_ROUTE 常量;UsageBuckets / UsageSummaryResponse / ProviderUsageRow / ModelUsageRow / DailyUsageRow / SessionUsageRow 线上类型与 usageTotal(buckets) 帮助函数(Task 5 聚合、Task 8 路由、Task 10/12 client 共同消费)。

- [ ] **Step 1: 创建 package.json**

```
json
{
  "name": "dsh-usage-host",
  "description": "Host-side usage service and webServer route: cross-session provider token aggregation behind the browser trust fence",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./shared": { "types": "./lib/types/shared.d.ts", "default": "./lib/types/shared.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "scripts": { "build": "tsc -p tsconfig.json && tsdown", "test": "vitest run" },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4",
    "@deepseek-ai/dsh-host-webserver": ">=0.1.0",
    "@deepseek-ai/dsh-llm": ">=0.1.0",
    "@deepseek-ai/schemastery": ">=0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../deepseek-harness/vendor/cordis",
    "@deepseek-ai/dsh-host-webserver": "link:../../../deepseek-harness/packages/host/webserver",
    "@deepseek-ai/dsh-llm": "link:../../../deepseek-harness/packages/llm/llm",
    "@deepseek-ai/schemastery": "link:../../../deepseek-harness/vendor/schemastery",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsdown": "^0.12.0",
    "vitest": "^3.0.0"
  }
}
```

若 link 目标路径在 deepseek-harness 中不存在(以 ls 验证,如 vendor/cordis),修正为实际目录后再继续。

- [ ] **Step 2: 创建 tsconfig.json 与 tsdown.config.ts**

tsconfig.json(node-only,无 DOM):
```
json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "lib": ["ES2022"]
  },
  "include": ["src"]
}
```

tsdown.config.ts:复制 packages/git-host/tsdown.config.ts 全文,原样(node-only 单入口模板,头部注释保留)。

- [ ] **Step 3: 创建 src/shared.ts**

```
ts
/**
 * Wire vocabulary shared with the browser package: the summary route path and
 * its response payload types. Browser-safe by construction (types plus one
 * pure helper).
 *
 * @module dsh-usage-host/shared
 */

/** The one usage route: GET-only, behind the connection browser trust fence. */
export const USAGE_SUMMARY_ROUTE = '/dsh-usage/summary'

/** The four disjoint provider-reported buckets. Reasoning is inside output. */
export interface UsageBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Sum of the four buckets — the share denominator and sort key. */
export function usageTotal(buckets: UsageBuckets): number {
  return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** One canonical model's usage under one provider. */
export interface ModelUsageRow {
  readonly model: string
  readonly displayName: string
  /** false = 未识别模型:aliases 即原始名,不计价。 */
  readonly recognized: boolean
  /** 归并到该 canonical 模型出现过的原始 model 名列表。 */
  readonly aliases: readonly string[]
  readonly buckets: UsageBuckets
  /** 估算金额(USD);undefined = 未配置单价。 */
  readonly usd: number | undefined
}

/** One provider row with its model breakdown. */
export interface ProviderUsageRow {
  readonly provider: string
  readonly displayName: string
  readonly buckets: UsageBuckets
  /** 0..1,分母为全部四桶总和。 */
  readonly share: number
  readonly models: readonly ModelUsageRow[]
}

/** One local-calendar day of usage. */
export interface DailyUsageRow {
  /** YYYY-MM-DD in the host's local timezone. */
  readonly date: string
  readonly buckets: UsageBuckets
}

/** One session's usage for the Top list. */
export interface SessionUsageRow {
  readonly sessionId: string
  readonly title: string | undefined
  readonly cwd: string | undefined
  readonly createdAt: number
  readonly buckets: UsageBuckets
}

/** The GET USAGE_SUMMARY_ROUTE payload. */
export interface UsageSummaryResponse {
  readonly generatedAt: number
  /** true = 后台首次/全量扫描进行中,前端应轮询。 */
  readonly scanning: boolean
  /** 已纳入统计的会话数(不含 skipped)。 */
  readonly sessionCount: number
  /** 读取/校验失败被跳过的会话数。 */
  readonly skippedSessions: number
  readonly totals: UsageBuckets
  readonly providers: readonly ProviderUsageRow[]
  readonly daily: readonly DailyUsageRow[]
  readonly topSessions: readonly SessionUsageRow[]
  /** 未配置单价、未计入金额的 canonical 模型 id。 */
  readonly unpricedModels: readonly string[]
  /** 全部已计价模型金额合计(USD 估算);undefined = 一个可计价模型都没有。 */
  readonly estimate: { readonly totalUsd: number } | undefined
}
```

- [ ] **Step 4: 创建占位 src/index.ts**

```
ts
/**
 * Host half of the usage dashboard plugin: the aggregation service plus one
 * webServer summary route behind the connection browser trust fence.
 * @module dsh-usage-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-usage-host'

export function apply(ctx: Context): void {
  void ctx
}
```

- [ ] **Step 5: 安装并构建验证**

Run: pnpm install && pnpm --filter dsh-usage-host build
Expected: 退出码 0,生成 lib/index.js、lib/shared.js、lib/types/*。

- [ ] **Step 6: Commit**

```
bash
git add packages/usage-host
git commit -m "feat(usage-host): package scaffold and wire types"
```

---

