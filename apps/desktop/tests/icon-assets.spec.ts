import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveDesktopIconPath } from '../src/desktop-assets.ts'
import { DESKTOP_WHALE_PATH } from '../src/startup-page.ts'

const EXPECTED_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ICON_PATH = fileURLToPath(new URL('../build/icon.ico', import.meta.url))
const SVG_PATH = fileURLToPath(new URL('../build/icon.svg', import.meta.url))
const CONFIG_PATH = fileURLToPath(new URL('../electron-builder.yml', import.meta.url))
const MANIFEST_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

describe('desktop icon assets', () => {
  it('packages the startup whale at Windows taskbar resolutions', async () => {
    const svg = await readFile(SVG_PATH, 'utf8')
    expect(svg).toContain(`d="${DESKTOP_WHALE_PATH}"`)
    expect(svg).toContain('fill="#11121a"')
    expect(svg).toContain('fill="#fbfbff"')

    const icon = await readFile(ICON_PATH)
    expect(icon.readUInt16LE(0)).toBe(0)
    expect(icon.readUInt16LE(2)).toBe(1)
    const imageCount = icon.readUInt16LE(4)
    expect(imageCount).toBe(EXPECTED_ICON_SIZES.length)
    const sizes = Array.from({ length: imageCount }, (_, index) => {
      const entryOffset = 6 + index * 16
      const size = icon.readUInt8(entryOffset) || 256
      const imageLength = icon.readUInt32LE(entryOffset + 8)
      const imageOffset = icon.readUInt32LE(entryOffset + 12)
      expect(icon.subarray(imageOffset, imageOffset + PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE)
      expect(icon.readUInt32BE(imageOffset + 16)).toBe(size)
      expect(icon.readUInt32BE(imageOffset + 20)).toBe(size)
      expect(imageOffset + imageLength).toBeLessThanOrEqual(icon.length)
      return size
    })
    expect(sizes).toEqual(EXPECTED_ICON_SIZES)
  })

  it('uses the checked-in icon for the application and NSIS lifecycle', async () => {
    const config = await readFile(CONFIG_PATH, 'utf8')
    expect(config).toContain('  - from: build/icon.ico\n    to: icon.ico')
    expect(config).toContain('  icon: build/icon.ico')
    expect(config).toContain('  installerIcon: build/icon.ico')
    expect(config).toContain('  uninstallerIcon: build/icon.ico')

    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts['package:win']).toMatch(/^pnpm run generate:icon && /)

    expect(resolveDesktopIconPath({
      packaged: true,
      resourcesPath: 'C:/Program Files/DSH Teacher/resources',
      appPath: 'unused',
    })).toBe(join('C:/Program Files/DSH Teacher/resources', 'icon.ico'))
    expect(resolveDesktopIconPath({
      packaged: false,
      resourcesPath: 'unused',
      appPath: 'C:/checkout/apps/desktop',
    })).toBe(join('C:/checkout/apps/desktop', 'build', 'icon.ico'))
  })
})
