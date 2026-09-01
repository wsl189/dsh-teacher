import { describe, expect, it } from 'vitest'
import { startupPageUrl } from '../src/startup-page.ts'

function page(locale: string): string {
  const prefix = 'data:text/html;charset=utf-8,'
  const url = startupPageUrl(locale)
  expect(url.startsWith(prefix)).toBe(true)
  return decodeURIComponent(url.slice(prefix.length))
}

describe('desktop startup page', () => {
  it('renders a localized, script-free brand card before the backend exists', () => {
    const chinese = page('zh-CN')
    expect(chinese).toContain('<html lang="zh">')
    expect(chinese).toContain('正在启动')
    expect(chinese).not.toContain('正在加载插件')

    const english = page('en-US')
    expect(english).toContain('<html lang="en">')
    expect(english).toContain('data-dsh-startup-brand')
    expect(english).toContain('<svg class="logo"')
    expect(english).toContain('<h1>DSH Teacher</h1>')
    expect(english).toContain('DEEPSEEK HARNESS')
    expect(english).toContain('<div class="progress"')
    expect(english).toContain('<div class="status">Starting</div>')
    expect(english).toContain('radial-gradient')
    expect(english).toContain('background: transparent')
    expect(english).toContain('border-radius: 28px')
    expect(english).toContain('overflow: hidden')
    expect(english).toContain('-webkit-app-region: drag')
    expect(english).not.toContain('Loading plugins')
    expect(english).toContain("default-src 'none'")
    expect(english).not.toContain('<script')
  })
})
