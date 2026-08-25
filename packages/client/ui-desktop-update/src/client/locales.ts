/** `desktop-update` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.available': '更新',
  'action.downloading': '更新中',
  'action.install': '重启更新',
  'action.retry': '重试更新',
  'aria.available': '发现新版本 {version}，下载更新',
  'aria.downloading': '正在下载版本 {version}，已完成 {percent}%',
  'aria.install': '版本 {version} 已下载，重启并安装',
  'aria.retry': '版本 {version} 下载失败，重试更新',
} satisfies Record<string, string>

/** The desktop-update namespace key union. */
export type DesktopUpdateKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.available': 'Update',
  'action.downloading': 'Updating',
  'action.install': 'Restart to update',
  'action.retry': 'Retry update',
  'aria.available': 'Version {version} is available; download update',
  'aria.downloading': 'Downloading version {version}; {percent}% complete',
  'aria.install': 'Version {version} is downloaded; restart and install',
  'aria.retry': 'Version {version} failed to download; retry update',
} satisfies Record<DesktopUpdateKey, string>
