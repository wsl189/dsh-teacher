// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { DesktopUpdateState } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'
import { UpdateButton, type UpdateButtonProps } from '../src/client/UpdateButton.tsx'

afterEach(cleanup)

const t: UpdateButtonProps['t'] = makeTranslate(zh, commonZh)
const neverHook = (() => { throw new Error('update button must not read global hooks') }) as never

function setup(state: DesktopUpdateState, wide = true) {
  const store = createSnapshotStore(state)
  const download = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const install = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const props: UpdateButtonProps = {
    wide,
    useSessions: neverHook,
    useWorkspaces: neverHook,
    useUpdate: bindSnapshotSelector(store),
    download,
    install,
    t,
  }
  const view = render(<UpdateButton {...props} />)
  return { store, download, install, view }
}

describe('UpdateButton', () => {
  it('renders nothing while checking or up to date', () => {
    const checking = setup({ status: 'checking' })
    expect(checking.view.container.innerHTML).toBe('')
    act(() => { checking.store.set({ status: 'up-to-date' }) })
    expect(checking.view.container.innerHTML).toBe('')
  })

  it('downloads from the visible update action and projects progress', async () => {
    const b = setup({ status: 'available', version: '1.2.0' })
    const button = screen.getByRole('button', { name: '发现新版本 1.2.0，下载更新' })
    expect(button.textContent).toBe('更新')
    fireEvent.click(button)
    await waitFor(() => { expect(b.download).toHaveBeenCalledOnce() })

    act(() => { b.store.set({ status: 'downloading', version: '1.2.0', percent: 41.6 }) })
    const progress = screen.getByRole('button', { name: '正在下载版本 1.2.0，已完成 42%' })
    expect(progress.textContent).toBe('更新中 42%')
    expect((progress as HTMLButtonElement).disabled).toBe(true)
  })

  it('restarts after download and retries a failed download', async () => {
    const b = setup({ status: 'downloaded', version: '1.2.0' })
    fireEvent.click(screen.getByRole('button', { name: '版本 1.2.0 已下载，重启并安装' }))
    await waitFor(() => { expect(b.install).toHaveBeenCalledOnce() })

    act(() => { b.store.set({ status: 'error', version: '1.2.0', message: 'offline' }) })
    const retry = screen.getByRole('button', { name: '版本 1.2.0 下载失败，重试更新' })
    expect(retry.getAttribute('title')).toBe('offline')
    fireEvent.click(retry)
    await waitFor(() => { expect(b.download).toHaveBeenCalledOnce() })
  })

  it('uses an icon-only rail action while preserving its accessible name', () => {
    setup({ status: 'available', version: '1.2.0' }, false)
    const button = screen.getByRole('button', { name: '发现新版本 1.2.0，下载更新' })
    expect(button.textContent).toBe('')
  })
})
