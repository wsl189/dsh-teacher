import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolveRuntimeEnvironment } from '../src/runtime-environment.ts'

describe('desktop backend runtime environment', () => {
  it('points installed builds at the bundled Windows-MCP interpreter', () => {
    const resourcesPath = 'C:/Program Files/DSH Teacher/resources'
    const exists = vi.fn(() => true)

    const env = resolveRuntimeEnvironment({
      env: { SAFE: 'kept', DSH_WINDOWS_MCP_COMMAND: 'ambient-python' },
      packaged: true,
      resourcesPath,
      exists,
    })

    expect(exists).toHaveBeenCalledWith(join(resourcesPath, 'windows-mcp', 'python.exe'))
    expect(env).toMatchObject({
      SAFE: 'kept',
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
      exists: () => false,
    })

    expect(env.DSH_WINDOWS_MCP_COMMAND).toBeUndefined()
    expect(env.DSH_WINDOWS_MCP_RUNTIME_ROOT).toBeUndefined()
  })

  it('retains explicit developer overrides in source runs', () => {
    const env = resolveRuntimeEnvironment({
      env: {
        DSH_WINDOWS_MCP_COMMAND: 'python',
        DSH_WINDOWS_MCP_RUNTIME_ROOT: 'C:/checkout',
      },
      packaged: false,
      resourcesPath: 'unused',
      exists: () => false,
    })

    expect(env).toMatchObject({
      DSH_WINDOWS_MCP_COMMAND: 'python',
      DSH_WINDOWS_MCP_RUNTIME_ROOT: 'C:/checkout',
    })
  })
})
