// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
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
    useSessionPendingInteraction: neverHook,
    useWorkspaces: neverHook,
    useUpdate: bindSnapshotSelector(store),
    download,
    install,
    t,
  }
  const view = render(<UpdateButton {...props} />)
  return { store, download, install, view }
}

function deferred(): {
  promise: Promise<void>
  reject: (reason?: unknown) => void
} {
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise })
  return { promise, reject }
}

describe('UpdateButton', () => {
  it('renders nothing while checking and shows the current version when up to date', () => {
    const checking = setup({ status: 'checking' })
    expect(checking.view.container.innerHTML).toBe('')
    act(() => { checking.store.set({ status: 'up-to-date', version: '1.2.0' }) })
    const current = screen.getByRole('status', { name: '当前版本 1.2.0' })
    expect(current.textContent).toBe('版本号 1.2.0')
    expect(checking.download).not.toHaveBeenCalled()
    expect(checking.install).not.toHaveBeenCalled()
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

  it('hides the current-version status in the rail', () => {
    const current = setup({ status: 'up-to-date', version: '1.2.0' }, false)
    expect(current.view.container.innerHTML).toBe('')
  })

  it('shows rejected action details and accepts non-Error rejections', async () => {
    const b = setup({ status: 'available', version: '1.2.0' })
    b.download.mockRejectedValueOnce(new Error('download unavailable'))
    const button = screen.getByRole('button', { name: '发现新版本 1.2.0，下载更新' })
    fireEvent.click(button)
    await waitFor(() => { expect(button.getAttribute('title')).toBe('download unavailable') })

    b.download.mockRejectedValueOnce('offline')
    fireEvent.click(button)
    await waitFor(() => { expect(button.getAttribute('title')).toBe('offline') })
  })

  it('ignores a rejected action after unmount', async () => {
    const pending = deferred()
    const b = setup({ status: 'available', version: '1.2.0' })
    b.download.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: '发现新版本 1.2.0，下载更新' }))
    b.view.unmount()

    await act(async () => {
      pending.reject(new Error('late failure'))
      await pending.promise.catch(() => undefined)
    })
    expect(b.download).toHaveBeenCalledOnce()
  })

  it('renders the retry icon in the collapsed rail', () => {
    setup({ status: 'error', version: '1.2.0', message: 'offline' }, false)
    expect(screen.getByRole('button', { name: '版本 1.2.0 下载失败，重试更新' })).toBeDefined()
  })
})
