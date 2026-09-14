/**
 * usage namespace dictionaries for the settings usage-statistics dashboard.
 *
 * @module dsh-client-ui-usage/locales
 */

// Type-only: pulls the LocaleNamespaceMap declaration site so the merge below
// lands on the real module.
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'usage'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '使用统计',
  'summary.title': '用量总览',
  'summary.totalTokens': '总 Token',
  'summary.breakdown': 'Token 构成',
  'summary.updatedAt': '更新于 {time}',
  'buckets.uncachedInput': '未缓存输入',
  'buckets.output': '输出',
  'buckets.cacheRead': '缓存读取',
  'buckets.cacheWrite': '缓存写入',
  'buckets.total': '总计',
  'estimate.disclaimer': '金额为按价目表估算,可能与实际账单不一致',
  'estimate.title': '估算金额',
  'summary.sessions': '会话数',
  'summary.skipped': '{count} 个会话已跳过',
  'providers.title': '提供商',
  'providers.expand': '展开 {name} 的模型明细',
  'providers.collapse': '收起 {name} 的模型明细',
  'providers.modelCount': '{count} 个模型',
  'models.title': '模型',
  'daily.title': '按日用量',
  'sessions.title': '会话排行',
  'sessions.untitled': '(无标题会话)',
  'state.scanning': '正在扫描会话历史…',
  'state.empty': '暂无用量数据',
  'state.error': '用量数据加载失败',
  'state.retry': '重试',
  'state.serviceMissing': '使用统计服务未安装或未响应',
  'unpriced.notice': '以下模型未配置单价,未计入金额:{models}',
  'unpriced.intro': '以下模型未配置单价,未计入金额',
  'share.of': '占比',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<UsageKey, string> = {
  'nav': 'Usage',
  'summary.title': 'Usage overview',
  'summary.totalTokens': 'Total tokens',
  'summary.breakdown': 'Token breakdown',
  'summary.updatedAt': 'Updated {time}',
  'buckets.uncachedInput': 'Uncached input',
  'buckets.output': 'Output',
  'buckets.cacheRead': 'Cache read',
  'buckets.cacheWrite': 'Cache write',
  'buckets.total': 'Total',
  'estimate.disclaimer': 'Amounts are estimated from the price list and may differ from actual billing',
  'estimate.title': 'Estimated amount',
  'summary.sessions': 'Sessions',
  'summary.skipped': '{count} sessions skipped',
  'providers.title': 'Providers',
  'providers.expand': 'Show {name} model details',
  'providers.collapse': 'Hide {name} model details',
  'providers.modelCount': '{count} models',
  'models.title': 'Models',
  'daily.title': 'Daily usage',
  'sessions.title': 'Top sessions',
  'sessions.untitled': '(Untitled session)',
  'state.scanning': 'Scanning session history…',
  'state.empty': 'No usage data yet',
  'state.error': 'Failed to load usage data',
  'state.retry': 'Retry',
  'state.serviceMissing': 'The usage service is not installed or not responding',
  'unpriced.notice': 'The following models have no configured price and are not counted in amounts: {models}',
  'unpriced.intro': 'The following models have no configured price and are not counted in amounts',
  'share.of': 'Share',
}

/** Key domain of the usage namespace (zh is the source of truth). */
export type UsageKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    usage: UsageKey
  }
}
