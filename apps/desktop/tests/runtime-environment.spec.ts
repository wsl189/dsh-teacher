import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PPT_MASTER_ARCHIVE_NAME, resolveRuntimeEnvironment } from '../src/runtime-environment.ts'

describe('desktop backend runtime environment', () => {
  it('resolves installed skill assets and the system desktop directory', () => {
    const resourcesPath = 'C:/Program Files/DSH Teacher/resources'
    const env = resolveRuntimeEnvironment({
      env: { SAFE: 'kept', DSH_DESKTOP_DIR: 'ambient-desktop', DSH_PPT_MASTER_ARCHIVE: 'ambient.tgz' },
      packaged: true,
      resourcesPath,
      desktopPath: 'D:\\课程资料\\桌面',
    })
    expect(env).toEqual({
      SAFE: 'kept',
      DSH_DESKTOP_DIR: 'D:\\课程资料\\桌面',
      DSH_PPT_MASTER_ARCHIVE: join(resourcesPath, PPT_MASTER_ARCHIVE_NAME),
    })
  })

  it('retains an explicit skill archive in source runs', () => {
    expect(resolveRuntimeEnvironment({
      env: { DSH_PPT_MASTER_ARCHIVE: 'C:/checkout/ppt-master.tgz' },
      packaged: false,
      resourcesPath: 'unused',
      desktopPath: 'C:/Users/teacher/Desktop',
    })).toEqual({
      DSH_PPT_MASTER_ARCHIVE: 'C:/checkout/ppt-master.tgz',
      DSH_DESKTOP_DIR: 'C:/Users/teacher/Desktop',
    })
  })
})
