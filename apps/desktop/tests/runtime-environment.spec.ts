import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PPT_MASTER_ARCHIVE_NAME,
  resolveRuntimeEnvironment,
} from '../src/runtime-environment.ts'

describe('desktop backend runtime environment', () => {
  it('points installed builds at the bundled Windows-MCP interpreter', () => {
    const resourcesPath = 'C:/Program Files/DSH Teacher/resources'
    const exists = vi.fn(() => true)

    const env = resolveRuntimeEnvironment({
      env: { SAFE: 'kept', DSH_WINDOWS_MCP_COMMAND: 'ambient-python', DSH_DESKTOP_DIR: 'ambient-desktop' },
      packaged: true,
      resourcesPath,
      desktopPath: 'D:\\课程资料\\桌面',
      exists,
    })

    expect(exists).toHaveBeenCalledWith(join(resourcesPath, 'windows-mcp', 'python.exe'))
    expect(env).toMatchObject({
      SAFE: 'kept',
      DSH_DESKTOP_DIR: 'D:\\课程资料\\桌面',
      DSH_PPT_MASTER_ARCHIVE: join(resourcesPath, PPT_MASTER_ARCHIVE_NAME),
      DSH_WINDOWS_MCP_COMMAND: join(resourcesPath, 'windows-mcp', 'python.exe'),
      DSH_WINDOWS_MCP_RUNTIME_ROOT: join(resourcesPath, 'windows-mcp'),
    })
  })

  it('removes ambient overrides when an installed payload is incomplete', () => {
    const env = resolveRuntimeEnvironment({
      env: {
        DSH_WINDOWS_MCP_COMMAND: 'ambient-python',
        DSH_WINDOWS_MCP_RUNTIME_ROOT: 'ambient-root',
      },
      packaged: true,
      resourcesPath: 'C:/missing',
      desktopPath: 'C:/Users/teacher/OneDrive/Desktop',
      exists: () => false,
    })

    expect(env.DSH_WINDOWS_MCP_COMMAND).toBeUndefined()
    expect(env.DSH_WINDOWS_MCP_RUNTIME_ROOT).toBeUndefined()
    expect(env.DSH_DESKTOP_DIR).toBe('C:/Users/teacher/OneDrive/Desktop')
    expect(env.DSH_PPT_MASTER_ARCHIVE).toBe(join('C:/missing', PPT_MASTER_ARCHIVE_NAME))
  })

  it('retains explicit developer overrides in source runs', () => {
    const env = resolveRuntimeEnvironment({
      env: {
        DSH_WINDOWS_MCP_COMMAND: 'python',
        DSH_WINDOWS_MCP_RUNTIME_ROOT: 'C:/checkout',
        DSH_PPT_MASTER_ARCHIVE: 'C:/checkout/ppt-master.tgz',
      },
      packaged: false,
      resourcesPath: 'unused',
      desktopPath: 'C:/Users/teacher/Desktop',
      exists: () => false,
    })

    expect(env).toMatchObject({
      DSH_WINDOWS_MCP_COMMAND: 'python',
      DSH_WINDOWS_MCP_RUNTIME_ROOT: 'C:/checkout',
      DSH_PPT_MASTER_ARCHIVE: 'C:/checkout/ppt-master.tgz',
      DSH_DESKTOP_DIR: 'C:/Users/teacher/Desktop',
    })
  })
})
