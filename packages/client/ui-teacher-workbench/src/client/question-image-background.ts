/** Robust background sampling for rectangular question-image erasure. */

/**
 * Sample a fill color from the exterior ring of an image-edit selection.
 * @param context - source image canvas context.
 * @param rect - selected source-pixel rectangle excluded from sampling.
 * @param canvasWidth - source canvas width in pixels.
 * @param canvasHeight - source canvas height in pixels.
 * @returns median RGB color from the sampled exterior pixels.
 */
export function sampleBorderColor(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): string {
  const padding = 8
  const sampleX = Math.max(0, rect.x - padding)
  const sampleY = Math.max(0, rect.y - padding)
  const sampleRight = Math.min(canvasWidth, rect.x + rect.width + padding)
  const sampleBottom = Math.min(canvasHeight, rect.y + rect.height + padding)
  const sampleWidth = Math.max(1, sampleRight - sampleX)
  const sampleHeight = Math.max(1, sampleBottom - sampleY)
  const data = context.getImageData(sampleX, sampleY, sampleWidth, sampleHeight).data
  const red: number[] = []
  const green: number[] = []
  const blue: number[] = []
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const imageX = sampleX + x
      const imageY = sampleY + y
      const insideSelection = imageX >= rect.x
        && imageX < rect.x + rect.width
        && imageY >= rect.y
        && imageY < rect.y + rect.height
      if (insideSelection) continue
      const offset = (y * sampleWidth + x) * 4
      red.push(data[offset] ?? 255)
      green.push(data[offset + 1] ?? 255)
      blue.push(data[offset + 2] ?? 255)
    }
  }
  if (red.length === 0) return '#ffffff'
  return `rgb(${String(medianChannel(red))}, ${String(medianChannel(green))}, ${String(medianChannel(blue))})`
}

function medianChannel(values: number[]): number {
  values.sort((left, right) => left - right)
  const middle = Math.floor(values.length / 2)
  if (values.length % 2 === 1) return values[middle] ?? 255
  return Math.round(((values[middle - 1] ?? 255) + (values[middle] ?? 255)) / 2)
}
