import { describe, expect, it } from 'vitest'
import { startupPageUrl } from '../src/startup-page.ts'

function page(locale: string): string {
  const prefix = 'data:text/html;charset=utf-8,'
  const url = startupPageUrl(locale)
  expect(url.startsWith(prefix)).toBe(true)
  return decodeURIComponent(url.slice(prefix.length))
}

describe('desktop startup page', () => {
  it('renders localized, script-free progress before the backend exists', () => {
    const chinese = page('zh-CN')
    expect(chinese).toContain('<html lang="zh">')
    expect(chinese).toContain('正在启动 DSH Teacher')
    expect(chinese).not.toContain('正在加载插件')

    const english = page('en-US')
    expect(english).toContain('<html lang="en">')
    expect(english).toContain('Starting DSH Teacher')
    expect(english).not.toContain('Loading plugins')
    expect(english).not.toContain('<p>')
    expect(english).toContain("default-src 'none'")
    expect(english).not.toContain('<script')
  })
})
