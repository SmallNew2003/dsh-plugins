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
  'preview.more': '更多操作',
  'preview.download': '下载',
  'preview.saveImage': '保存为图片',
  'preview.copyCode': '复制代码',
  'preview.viewCode': '查看代码',
  'preview.hideCode': '收起代码',
  'preview.saveImageError': '无法将该内容保存为图片',
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
  'preview.more': 'More actions',
  'preview.download': 'Download',
  'preview.saveImage': 'Save as image',
  'preview.copyCode': 'Copy code',
  'preview.viewCode': 'View code',
  'preview.hideCode': 'Hide code',
  'preview.saveImageError': 'Unable to save this content as an image',
  'preview.loading': 'Reading file…',
  'preview.error': 'Read failed',
  'preview.tooLarge': 'File exceeds 1 MB; inline rendering skipped',
  'preview.frameLabel': 'Inline render of {path}',
}
