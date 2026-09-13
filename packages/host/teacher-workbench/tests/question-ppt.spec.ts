import { DOMParser } from '@xmldom/xmldom'
import { strFromU8, unzipSync } from 'fflate'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { generateUploadedQuestionDocument } from '../src/question-media.ts'

describe('question PowerPoint pictures', () => {
  it.each([
    { name: 'small', width: 96, height: 48 },
    { name: 'wide', width: 2400, height: 600 },
    { name: 'tall', width: 400, height: 1600 },
  ])('scales a $name picture to equal side margins without changing its aspect ratio or pixels', async ({ width, height }) => {
    const pixels = Buffer.alloc(width * height * 4)
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const x = (offset / 4) % width
      const y = Math.floor(offset / 4 / width)
      pixels[offset] = x % 256
      pixels[offset + 1] = y % 256
      pixels[offset + 2] = 73
      pixels[offset + 3] = x === 0 ? 0 : 255
    }
    const original = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer()
    const artifact = await generateUploadedQuestionDocument({
      segmentsRoot: 'unused',
      studentsRoot: 'unused',
      maxImageBytes: 1024 * 1024,
      maxBatchBytes: 1024 * 1024,
    }, {
      kind: 'ppt',
      folderName: 'questions',
      images: [{ fileName: '第1题.png', relativePath: '第1题.png', contentBase64: original.toString('base64') }],
    })
    const parts = unzipSync(Buffer.from(artifact.contentBase64, 'base64'))
    const image = parts['ppt/media/image-1-1.png']!
    const metadata = await sharp(image).metadata()
    expect(metadata.height).toBe(height)
    expect(metadata.width).toBe(width)
    const retained = await sharp(image).ensureAlpha().raw().toBuffer()
    expect(retained.equals(pixels)).toBe(true)

    const parser = new DOMParser()
    const slide = parser.parseFromString(strFromU8(parts['ppt/slides/slide1.xml']!), 'application/xml')
    const presentation = parser.parseFromString(strFromU8(parts['ppt/presentation.xml']!), 'application/xml')
    const position = slide.getElementsByTagName('a:off').item(1)!
    const size = slide.getElementsByTagName('a:ext').item(1)!
    const slideWidth = Number(presentation.getElementsByTagName('p:sldSz').item(0)!.getAttribute('cx'))
    expect(slide.getElementsByTagName('p:pic').length).toBe(1)
    expect(position.getAttribute('x')).toBe('180000')
    expect(position.getAttribute('y')).toBe('360000')
    const leftMargin = Number(position.getAttribute('x'))
    const rightMargin = slideWidth - leftMargin - Number(size.getAttribute('cx'))
    expect(rightMargin).toBe(leftMargin)
    expect(slide.getElementsByTagName('a:srcRect').length).toBe(0)
    const horizontalScale = Number(size.getAttribute('cx')) / width
    const verticalScale = Number(size.getAttribute('cy')) / height
    expect(Math.abs(horizontalScale / verticalScale - 1)).toBeLessThan(0.000001)
  })
})
