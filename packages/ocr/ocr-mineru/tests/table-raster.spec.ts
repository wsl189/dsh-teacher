import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { tableRasterPasses } from '../src/table-raster.ts'

async function tableImage(groups = 3, ruled = true): Promise<Buffer> {
  const height = 100 + groups * 240
  const xs = [20, 80, 160, 260, 360, 460, 560, 660, 760]
  const rows = Array.from({ length: groups * 4 + 1 }, (_, index) => 80 + index * 60)
  const lines = ruled ? [
    ...xs.map(x => `<path d="M ${String(x)} 20 V ${String(height - 20)}"/>`),
    '<path d="M 20 20 H 760"/>',
    ...rows.map((y, index) => `<path d="M ${index % 4 === 0 ? '20' : '80'} ${String(y)} H 760"/>`),
  ].join('') : ''
  const labels = Array.from({ length: groups }, (_, group) => {
    const top = 80 + group * 240
    return `<rect x="43" y="${String(top + 70)}" width="12" height="12"/>
<rect x="43" y="${String(top + 96)}" width="12" height="12"/>
${[124, 130, 136].map(offset => `<rect x="43" y="${String(top + offset)}" width="12" height="2"/>`).join('')}`
  }).join('')
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="780" height="${String(height)}">
<rect width="100%" height="100%" fill="white"/>
<g stroke="black" stroke-width="2">${lines}</g><g fill="black">${labels}</g>
</svg>`)).png().toBuffer()
}

describe('tableRasterPasses', () => {
  it('keeps the column heading and complete row group in every bounded tile', async () => {
    const passes = await tableRasterPasses(await tableImage(), 400)
    expect(passes).toHaveLength(9)
    for (const pass of passes) {
      const { width, height } = await sharp(pass.bytes).metadata()
      expect(width).toBe(365)
      expect(height).toBe(325)
      expect(pass.label).toContain('repeated row and column headers')
    }
    const { data, info } = await sharp(passes[0]!.bytes).greyscale().raw().toBuffer({ resolveWithObject: true })
    const inkColumns: number[] = []
    for (let x = 18; x < 68; x += 1) {
      let ink = 0
      for (let y = 160; y < 220; y += 1) if (data[y * info.width + x]! < 200) ink += 1
      if (ink > 0) inkColumns.push(x)
    }
    const starts = inkColumns.filter((x, index) => index === 0 || x > inkColumns[index - 1]! + 1)
    // Three horizontal strokes belong to one glyph, not three copies of 一.
    expect(starts).toHaveLength(3)
  })

  it('leaves small images on the ordinary enhancement path', async () => {
    expect(await tableRasterPasses(await tableImage(), 1000)).toEqual([])
  })

  it('does not crop an image without a dependable grid', async () => {
    expect(await tableRasterPasses(await tableImage(3, false), 400)).toEqual([])
  })

  it('does not infer repeated row groups from one isolated table section', async () => {
    expect(await tableRasterPasses(await tableImage(1), 400)).toEqual([])
  })

  it('keeps the ordinary path when complete row labels cannot fit the detail target', async () => {
    expect(await tableRasterPasses(await tableImage(), 200)).toEqual([])
  })
})
