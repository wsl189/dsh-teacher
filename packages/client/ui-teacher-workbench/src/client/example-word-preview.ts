/** Restore full equation presentation from the MathML retained in a collected DOCX. */

import { strFromU8, unzipSync } from 'fflate/browser'
import DOMPurify from 'dompurify'

/**
 * Replace docx-preview's incomplete equation rendering with the matching saved MathML.
 * @param bytes - collection-generated DOCX with native equations and matching custom-property MathML.
 * @param container - the fully rendered, caller-owned Word preview.
 */
export function renderExampleWordEquations(bytes: Uint8Array, container: HTMLElement): void {
  const properties = unzipSync(bytes)['docProps/custom.xml']
  if (properties === undefined) return
  const parser = new DOMParser()
  const document = parser.parseFromString(strFromU8(properties), 'application/xml')
  const property = Array.from(document.getElementsByTagName('property')).find(
    element => element.getAttribute('name') === 'dsh.example.mathml',
  )
  if (property === undefined) return
  const saved = parser.parseFromString(property.textContent, 'application/xml')
  const equations = Array.from(saved.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math'))
  const previews = Array.from(container.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math'))
  if (saved.getElementsByTagName('parsererror').length > 0 || equations.length !== previews.length) {
    throw new Error('Collected Word equations do not match their preview data')
  }
  for (const [index, equation] of equations.entries()) {
    const preview = previews[index]
    if (preview === undefined) throw new Error('Collected Word equation preview is missing')
    preview.replaceWith(
      DOMPurify.sanitize(equation, {
        USE_PROFILES: { mathMl: true },
        RETURN_DOM_FRAGMENT: true,
      }),
    )
  }
}

/**
 * Render native Word option tabs as aligned cells that wrap whole options in a narrow preview.
 * @param container - rendered collection DOCX after its native equations have been restored.
 * @returns disposer for preview-size observation.
 */
export function renderExampleWordOptionRows(container: HTMLElement): () => void {
  const rows: { paragraph: HTMLParagraphElement; columns: number; cells: HTMLElement[] }[] = []
  for (const paragraph of container.querySelectorAll<HTMLParagraphElement>('p')) {
    const columns = /\bexample-word_dshexamplechoices([124])\b/u.exec(paragraph.className)?.[1]
    if (columns === undefined) continue
    let current = document.createElement('span')
    const cells: HTMLElement[] = [current]
    for (const node of Array.from(paragraph.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && node.textContent === '\u2003') {
        current = document.createElement('span')
        cells.push(current)
      } else current.append(node)
    }
    if (cells.length !== Number(columns)) throw new Error('Collected Word option columns do not match their tab stops')
    for (const cell of cells) cell.className = 'example-choice-cell'
    paragraph.classList.add('example-choice-row')
    paragraph.replaceChildren(...cells)
    rows.push({ paragraph, columns: Number(columns), cells })
  }
  if (rows.length === 0) return () => {}
  const layout = (): void => {
    for (const { paragraph, columns, cells } of rows) {
      if (paragraph.clientWidth === 0) continue
      for (const cell of cells) cell.style.whiteSpace = 'nowrap'
      let fitting = columns
      paragraph.style.gridTemplateColumns = `repeat(${String(fitting)}, minmax(0, 1fr))`
      while (fitting > 1 && cells.some(cell => cell.scrollWidth > cell.clientWidth + 1)) {
        fitting /= 2
        paragraph.style.gridTemplateColumns = `repeat(${String(fitting)}, minmax(0, 1fr))`
      }
      for (const cell of cells) cell.style.whiteSpace = 'normal'
    }
  }
  layout()
  const observer = new ResizeObserver(layout)
  observer.observe(container)
  return () => { observer.disconnect() }
}
