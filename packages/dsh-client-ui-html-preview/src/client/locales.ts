/**
 * Copy for the html-preview plugin. zh is the key-set source of truth; en
 * mirrors it key-for-key (enforced by tests). Interpolation uses {name}
 * placeholders, interpolated by the framework locale runtime.
 */

export const NS = 'html-preview'

export const zh = {
  'row.title': 'Present 交付',
  'row.running': '正在交付…',
  'row.ok': '已交付',
  'row.error': '交付失败',
  'row.stopped': '已中断',
  'row.inspect': '在轨迹中查看',
  'preview.title': 'HTML 预览',
  'preview.expand': '渲染预览',
  'preview.collapse': '收起预览',
  'preview.openTab': '在新标签打开',
  'preview.loading': '正在读取文件…',
  'preview.error': '读取失败',
  'preview.tooLarge': '文件超过 1 MB,已跳过内联渲染',
  'preview.frameLabel': '{path} 的内联预览',
} as const

export type HtmlPreviewKey = keyof typeof zh

export const en: Record<HtmlPreviewKey, string> = {
  'row.title': 'Present call',
  'row.running': 'Presenting…',
  'row.ok': 'Presented',
  'row.error': 'Present failed',
  'row.stopped': 'Interrupted',
  'row.inspect': 'Inspect in trajectory',
  'preview.title': 'HTML preview',
  'preview.expand': 'Render preview',
  'preview.collapse': 'Collapse preview',
  'preview.openTab': 'Open in new tab',
  'preview.loading': 'Reading file…',
  'preview.error': 'Read failed',
  'preview.tooLarge': 'File exceeds 1 MB; inline rendering skipped',
  'preview.frameLabel': 'Inline render of {path}',
}
