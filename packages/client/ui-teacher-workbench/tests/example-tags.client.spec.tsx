// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExampleTags } from '../src/client/ExampleTags.tsx'
import { zh } from '../src/client/locales.ts'
import type { TeacherWorkbenchTranslate } from '../src/client/shared.tsx'

const t: TeacherWorkbenchTranslate = (key, params) => Object.entries(params ?? {})
  .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), zh[key])

function props() {
  return {
    presets: ['二次函数', '几何'],
    selected: ['几何'],
    pending: false,
    onSelect: vi.fn<(tags: readonly string[]) => Promise<boolean>>().mockResolvedValue(true),
    onAddPreset: vi.fn<(name: string) => Promise<string | null>>().mockImplementation(async name => name),
    t,
  }
}

afterEach(cleanup)

describe('question tags and reusable presets', () => {
  it('removes only the current question selection and leaves the preset available for reselection', () => {
    const data = { ...props(), selected: ['二次函数', '几何'] }
    const view = render(<ExampleTags {...data} />)
    const remove = screen.getByRole<HTMLButtonElement>('button', { name: '取消标签“几何”' })
    view.rerender(<ExampleTags {...data} pending />)
    expect(remove.disabled).toBe(true)
    fireEvent.click(remove)
    expect(data.onSelect).not.toHaveBeenCalled()
    view.rerender(<ExampleTags {...data} />)
    fireEvent.click(remove)
    expect(data.onSelect).toHaveBeenLastCalledWith(['二次函数'])
    view.rerender(<ExampleTags {...data} selected={['二次函数']} />)
    expect(screen.queryByRole('button', { name: '取消标签“几何”' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '选择预设标签' }))
    const preset = screen.getByRole('button', { name: '几何' })
    expect(preset.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(preset)
    expect(data.onSelect).toHaveBeenLastCalledWith(['二次函数', '几何'])
    expect(data.onAddPreset).not.toHaveBeenCalled()
  })

  it('keeps row selection open and focused across saves, and dismisses with Escape or outside clicks', () => {
    const data = props()
    const view = render(<ExampleTags {...data} />)
    const trigger = screen.getByRole('button', { name: '选择预设标签' })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(trigger)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: '几何' }).getAttribute('aria-pressed')).toBe('true')
    const quadratic = screen.getByRole<HTMLButtonElement>('button', { name: '二次函数' })
    quadratic.focus()
    fireEvent.click(quadratic)
    expect(data.onSelect).toHaveBeenLastCalledWith(['几何', '二次函数'])
    view.rerender(<ExampleTags {...data} pending />)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(quadratic)
    expect(quadratic.disabled).toBe(false)
    expect(quadratic.getAttribute('aria-disabled')).toBe('true')
    fireEvent.blur(quadratic, { relatedTarget: null })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '几何' }))
    expect(data.onSelect).toHaveBeenCalledOnce()
    view.rerender(<ExampleTags {...data} selected={['几何', '二次函数']} />)
    expect(quadratic.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '几何' }))
    expect(data.onSelect).toHaveBeenLastCalledWith(['二次函数'])
    view.rerender(<ExampleTags {...data} selected={['二次函数']} />)
    expect(screen.getByRole('button', { name: '几何' }).getAttribute('aria-pressed')).toBe('false')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(data.onAddPreset).not.toHaveBeenCalled()
    fireEvent.keyDown(quadratic, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('group', { name: '预设标签' }))
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: '预设标签' })).toBeNull()
  })

  it('creates a preset without assigning it to the question and makes it available for explicit selection', async () => {
    const data = { ...props(), presets: [], selected: [] }
    const view = render(<ExampleTags {...data} />)
    fireEvent.click(screen.getByRole('button', { name: '选择预设标签' }))
    expect(screen.getByText('暂无预设标签，请点击“添加标签”创建')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '预设标签名称' }), { target: { value: '  向量  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(data.onAddPreset).toHaveBeenCalledWith('向量')
    expect(data.onSelect).not.toHaveBeenCalled()
    view.rerender(<ExampleTags {...data} presets={['向量']} />)
    fireEvent.click(screen.getByRole('button', { name: '选择预设标签' }))
    expect(screen.getByRole('button', { name: '向量' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('preserves a failed preset name for retry and cancels without changing the catalog', async () => {
    const data = props()
    data.onAddPreset.mockResolvedValueOnce(null)
    render(<ExampleTags {...data} />)
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }))
    fireEvent.change(screen.getByRole('textbox', { name: '预设标签名称' }), { target: { value: '向量' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('alert')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '预设标签名称' }).value).toBe('向量')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(data.onAddPreset).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: '添加标签' }))
    fireEvent.change(screen.getByRole('textbox', { name: '预设标签名称' }), { target: { value: '概率' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(data.onAddPreset).toHaveBeenCalledTimes(2)
    expect(data.onSelect).not.toHaveBeenCalled()
  })
})
