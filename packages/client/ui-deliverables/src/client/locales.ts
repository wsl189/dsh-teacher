/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '预览 {name}',
  'produced.showInFolder': '在文件夹中显示',
  'preview.loading': '正在加载预览…',
  'preview.retry': '重试',
  'preview.refresh': '刷新',
  'preview.openExternal': '使用系统应用打开',
  'preview.unsupported': '暂不支持预览这种文件格式',
  'preview.empty': '文件没有可预览的内容',
  'preview.page': '第 {page} / {total} 页',
  'preview.slide': '第 {page} / {total} 张',
  'preview.previous': '上一页',
  'preview.next': '下一页',
  'preview.sheetTruncated': '仅显示前 {rows} 行、{columns} 列',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Preview {name}',
  'produced.showInFolder': 'Show in folder',
  'preview.loading': 'Loading preview…',
  'preview.retry': 'Retry',
  'preview.refresh': 'Refresh',
  'preview.openExternal': 'Open in system app',
  'preview.unsupported': 'This file type cannot be previewed yet',
  'preview.empty': 'The file has no previewable content',
  'preview.page': 'Page {page} of {total}',
  'preview.slide': 'Slide {page} of {total}',
  'preview.previous': 'Previous',
  'preview.next': 'Next',
  'preview.sheetTruncated': 'Showing the first {rows} rows and {columns} columns',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
