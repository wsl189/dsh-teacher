import { describe, expect, it } from 'vitest'
import { sampleBorderColor } from '../src/client/question-image-background.ts'

describe('QuestionImageEditor background sampling', () => {
  it('excludes the erased black text region and keeps a white paper background white', () => {
    const width = 24
    const height = 16
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255)
    for (let y = 4; y < 12; y += 1) {
      for (let x = 6; x < 18; x += 1) {
        const offset = (y * width + x) * 4
        pixels[offset] = 0
        pixels[offset + 1] = 0
        pixels[offset + 2] = 0
      }
    }
    const context = {
      getImageData(left: number, top: number, sampleWidth: number, sampleHeight: number) {
        const data = new Uint8ClampedArray(sampleWidth * sampleHeight * 4)
        for (let y = 0; y < sampleHeight; y += 1) {
          for (let x = 0; x < sampleWidth; x += 1) {
            const sourceOffset = ((top + y) * width + left + x) * 4
            const targetOffset = (y * sampleWidth + x) * 4
            data.set(pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset)
          }
        }
        return { data }
      },
    } as unknown as CanvasRenderingContext2D

    expect(sampleBorderColor(context, { x: 6, y: 4, width: 12, height: 8 }, width, height))
      .toBe('rgb(255, 255, 255)')
  })
})
