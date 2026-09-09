/** Ruled-table crops retain column headings and merged row labels for OCR. */

import sharp, { type Region } from 'sharp'

/** A self-contained observation of part of a source table. */
export interface TableRasterPass {
  /** Source-relative region description. */
  readonly label: string
  /** PNG bytes retaining the source pixels and headers. */
  readonly bytes: Uint8Array
}

interface Interval {
  start: number
  end: number
}

/**
 * Split a large ruled table at merged row groups and repeating data columns.
 * @param bytes - Original raster upload.
 * @param longEdge - Existing OCR detail-size target in pixels.
 * @returns Header-preserving crops, or no crops when the grid is ambiguous.
 */
export async function tableRasterPasses(bytes: Uint8Array, longEdge: number): Promise<TableRasterPass[]> {
  const { width, height } = await sharp(bytes).metadata()
  if (Math.max(width, height) <= longEdge) return []
  const { data } = await sharp(bytes).flatten({ background: 'white' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const dark = (x: number, y: number): boolean => (data[y * width + x] as number) < 200
  const xs = lineCenters(width, height, (x, y) => dark(x, y))
  const ys = lineCenters(height, width, (y, x) => dark(x, y))
  if (xs.length < 6 || ys.length < 6) return []
  const left = xs[0] as number
  const cellWidth = (xs.at(-1) as number) - (xs.at(-2) as number)
  let firstDataColumn = xs.length - 2
  while (firstDataColumn > 1) {
    const previousWidth = (xs[firstDataColumn] as number) - (xs[firstDataColumn - 1] as number)
    if (Math.abs(previousWidth - cellWidth) > Math.max(3, cellWidth / 100)) break
    firstDataColumn -= 1
  }
  if (xs.length - firstDataColumn - 1 < 4) return []
  const prefixRight = xs[firstDataColumn] as number
  const prefixWidth = prefixRight - left
  const labelLeft = left + 4
  const labelRight = (xs[1] as number) - 4
  const fullLines = ys.filter((y) => {
    let ink = 0
    for (let x = labelLeft; x < labelRight; x += 1) if (dark(x, y)) ink += 1
    return ink >= (labelRight - labelLeft) * 0.8
  })
  const groups = fullLines.flatMap((top, index): Interval[] => {
    const bottom = fullLines[index + 1]
    if (bottom === undefined) return []
    const innerLines = ys.filter(y => y > top && y < bottom)
    return innerLines.length >= 2 ? [{ start: top, end: bottom }] : []
  })
  const firstGroup = groups[0]
  if (firstGroup === undefined || groups.length < 2 || groups.some(group => group.end - group.start > longEdge)) return []
  const headerTop = fullLines[fullLines.indexOf(firstGroup.start) - 1]
  if (headerTop === undefined || prefixWidth + cellWidth > longEdge) return []
  const dataColumns = xs.length - firstDataColumn - 1
  const columnGroups = Math.ceil(dataColumns / Math.floor((longEdge - prefixWidth) / cellWidth))
  const columnsPerPass = Math.ceil(dataColumns / columnGroups)
  const headerHeight = firstGroup.start - headerTop
  const passes: TableRasterPass[] = []
  for (const group of groups) {
    const label = await horizontalLabel(bytes, {
      left: labelLeft, top: group.start + 4, width: labelRight - labelLeft, height: group.end - group.start - 8,
    })
    for (let column = firstDataColumn; column < xs.length - 1; column += columnsPerPass) {
      const start = xs[column] as number
      const end = xs[Math.min(column + columnsPerPass, xs.length - 1)] as number
      const tileWidth = prefixWidth + end - start
      const crop = (x: number, y: number, cropWidth: number, cropHeight: number): Promise<Buffer> => (
        sharp(bytes).extract({ left: x, top: y, width: cropWidth, height: cropHeight }).png().toBuffer()
      )
      const parts = [
        { input: await crop(left, headerTop, prefixWidth, headerHeight), left: 0, top: 0 },
        { input: await crop(start, headerTop, end - start, headerHeight), left: prefixWidth, top: 0 },
        { input: await crop(left, group.start, prefixWidth, group.end - group.start + 1), left: 0, top: headerHeight },
        { input: await crop(start, group.start, end - start + 1, group.end - group.start + 1), left: prefixWidth, top: headerHeight },
      ]
      if (label !== undefined) parts.push({ input: label, left: labelLeft - left, top: headerHeight + 4 })
      const composed = await sharp({
        create: { width: tileWidth + 1, height: headerHeight + group.end - group.start + 1, channels: 3, background: 'white' },
      }).composite(parts).png().toBuffer()
      const tile = await sharp(composed).extend({ top: 12, bottom: 12, left: 12, right: 12, background: 'white' }).png().toBuffer()
      passes.push({
        label: `table region ${String(passes.length + 1)}; source bounds ${start / width},${group.start / height},${end / width},${group.end / height}; repeated row and column headers`,
        bytes: tile,
      })
    }
  }
  return passes
}

function lineCenters(length: number, crossLength: number, dark: (along: number, across: number) => boolean): number[] {
  const positions: number[] = []
  for (let along = 0; along < length; along += 1) {
    let ink = 0
    for (let across = 0; across < crossLength; across += 4) if (dark(along, across)) ink += 1
    if (ink >= Math.ceil(crossLength / 4) * 0.65) positions.push(along)
  }
  return contiguousIntervals(positions).map(({ start, end }) => Math.floor((start + end) / 2))
}

function contiguousIntervals(positions: readonly number[]): Interval[] {
  const intervals: Interval[] = []
  for (const position of positions) {
    const previous = intervals.at(-1)
    if (previous !== undefined && position === previous.end + 1) previous.end = position
    else intervals.push({ start: position, end: position })
  }
  return intervals
}

async function horizontalLabel(bytes: Uint8Array, area: Region): Promise<Buffer | undefined> {
  if (area.height < area.width * 2) return undefined
  const { data } = await sharp(bytes).extract(area).flatten({ background: 'white' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const occupied: number[] = []
  for (let y = 0; y < area.height; y += 1) {
    let ink = 0
    for (let x = 0; x < area.width; x += 1) if ((data[y * area.width + x] as number) < 200) ink += 1
    if (ink > 2) occupied.push(y)
  }
  const lines = contiguousIntervals(occupied)
  if (lines.length < 2) return undefined
  const components = lines.map(({ start, end }) => {
    let left = area.width
    let right = 0
    for (let y = start; y <= end; y += 1) {
      for (let x = 0; x < area.width; x += 1) {
        if ((data[y * area.width + x] as number) >= 200) continue
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
    }
    return { left: area.left + left, top: area.top + start, width: right - left + 1, height: end - start + 1 }
  })
  const glyphSide = Math.max(...components.map(component => component.width))
  const glyphs: Region[] = []
  for (const component of components) {
    const previous = glyphs.at(-1)
    if (previous !== undefined && component.top + component.height - previous.top <= glyphSide * 1.25) {
      const left = Math.min(previous.left, component.left)
      previous.width = Math.max(previous.left + previous.width, component.left + component.width) - left
      previous.left = left
      previous.height = component.top + component.height - previous.top
    } else glyphs.push({ ...component })
  }
  if (glyphs.length < 2 || glyphs.length > 6) return undefined
  const glyphHeight = Math.max(...glyphs.map(glyph => glyph.height))
  if (glyphs.some(glyph => glyph.width > glyphHeight * 1.5) || glyphHeight > area.width) return undefined
  let offset = 0
  const parts = []
  for (const glyph of glyphs) {
    parts.push({
      input: await sharp(bytes).extract(glyph).png().toBuffer(),
      left: offset,
      top: Math.floor((glyphHeight - glyph.height) / 2),
    })
    offset += glyph.width + 3
  }
  const joined = await sharp({ create: { width: offset, height: glyphHeight, channels: 3, background: 'white' } }).composite(parts).png().toBuffer()
  const line = await sharp(joined).resize({ width: Math.min(offset, area.width), withoutEnlargement: true }).png().toBuffer()
  return sharp({ create: { width: area.width, height: area.height, channels: 3, background: 'white' } })
    .composite([{ input: line, gravity: 'centre' }]).png().toBuffer()
}
