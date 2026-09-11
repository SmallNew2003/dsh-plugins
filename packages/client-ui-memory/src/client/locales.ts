/** memory namespace dictionaries: one action label per engram tool. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'memory'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.action.mem_save': '保存记忆',
  'card.action.mem_update': '更新记忆',
  'card.action.mem_capture_passive': '记录观察',
  'card.action.mem_session_summary': '保存会话摘要',
  'card.action.mem_save_prompt': '保存提示词',
  'card.action.mem_session_end': '结束会话',
  'card.action.mem_delete': '删除记忆',
  'card.action.mem_pin': '置顶记忆',
  'card.action.mem_unpin': '取消置顶',
  'card.action.mem_search': '搜索记忆',
  'card.action.mem_context': '读取近期上下文',
  'card.action.mem_get_observation': '查看记忆',
  'card.action.mem_timeline': '查看时间线',
  'card.action.mem_compare': '对比记忆',
  'card.action.mem_session_start': '开始会话',
  'card.action.mem_current_project': '当前项目',
  'card.action.mem_stats': '记忆统计',
  'card.action.mem_doctor': '记忆诊断',
  'card.action.mem_judge': '记忆判断',
  'card.action.mem_review': '审阅记忆',
  'card.action.mem_suggest_topic_key': '建议主题键',
  'card.action.fallback': '记忆操作',
  'card.running': '记忆读写中…',
  'card.error': '调用失败',
  'card.count': '{count} 条结果',
  'card.expand': '展开',
  'card.collapse': '收起',
  'card.empty': '（无返回内容）',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<MemoryKey, string> = {
  'card.action.mem_save': 'Save memory',
  'card.action.mem_update': 'Update memory',
  'card.action.mem_capture_passive': 'Record observation',
  'card.action.mem_session_summary': 'Save session summary',
  'card.action.mem_save_prompt': 'Save prompt',
  'card.action.mem_session_end': 'End session',
  'card.action.mem_delete': 'Delete memory',
  'card.action.mem_pin': 'Pin memory',
  'card.action.mem_unpin': 'Unpin memory',
  'card.action.mem_search': 'Search memory',
  'card.action.mem_context': 'Read recent context',
  'card.action.mem_get_observation': 'View memory',
  'card.action.mem_timeline': 'View timeline',
  'card.action.mem_compare': 'Compare memories',
  'card.action.mem_session_start': 'Start session',
  'card.action.mem_current_project': 'Current project',
  'card.action.mem_stats': 'Memory stats',
  'card.action.mem_doctor': 'Memory diagnostics',
  'card.action.mem_judge': 'Memory judgment',
  'card.action.mem_review': 'Review memory',
  'card.action.mem_suggest_topic_key': 'Suggest topic key',
  'card.action.fallback': 'Memory operation',
  'card.running': 'Reading/writing memory…',
  'card.error': 'Call failed',
  'card.count': '{count} results',
  'card.expand': 'Expand',
  'card.collapse': 'Collapse',
  'card.empty': '(no result content)',
}

/** Key domain of the memory namespace (zh is the source of truth). */
export type MemoryKey = keyof typeof zh
