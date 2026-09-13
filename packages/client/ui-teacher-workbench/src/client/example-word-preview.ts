/** Restore full equation presentation from the MathML retained in a collected DOCX. */

import { strFromU8, unzipSync } from 'fflate/browser'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { MathMLToLaTeX } from 'mathml-to-latex'
import 'katex/dist/katex.min.css'
import css from './example-word-equation.module.css'

/**
 * Typeset edited TeX with local fonts and preserve its accessible MathML structure.
 * @param latex - equation entered in the formula dialog.
 * @param bold - additional whole-equation emphasis from the Word toolbar.
 * @returns rendered formula; unsupported or malformed TeX throws a KaTeX ParseError.
 */
export function renderExampleEquation(latex: string, bold = false): DocumentFragment {
  const mathml = katex.renderToString(latex, { output: 'mathml', displayMode: false, throwOnError: true, strict: 'ignore', trust: false })
  return renderExampleMathml(mathml, { latex, bold })
}

/**
 * Typeset saved MathML with local TeX fonts while retaining its accessible mathematical structure.
 * @param source - generated or saved MathML; executable markup and TeX annotations are removed.
 * @param formatting - editor-owned LaTeX and whole-equation bold; omitted for a saved Word preview.
 * @returns sanitized typesetting, or the original MathML when TeX conversion is unavailable.
 */
export function renderExampleMathml(
  source: string | Element, formatting?: { readonly latex: string; readonly bold: boolean },
): DocumentFragment {
  const original = typeof source === 'string' ? new DOMParser().parseFromString(source, 'application/xml') : source
  const originals = original instanceof Element && original.localName === 'math' ? [original] : original.querySelectorAll('math')
  const normalized = original.cloneNode(true) as Document | Element
  // Older KaTeX group emphasis can put rows inside token elements, which sanitization discards.
  for (const token of normalized.querySelectorAll('mi:has(> mrow), mo:has(> mrow)')) {
    const row = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mrow')
    for (const attribute of token.attributes) row.setAttribute(attribute.name, attribute.value)
    row.append(...token.childNodes)
    token.replaceWith(row)
  }
  const fragment = DOMPurify.sanitize(new XMLSerializer().serializeToString(normalized), {
    USE_PROFILES: { mathMl: true }, RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['annotation'], ADD_FORBID_CONTENTS: ['annotation'],
  })
  for (const [index, math] of fragment.querySelectorAll('math').entries()) {
    const latex = formatting?.latex ?? MathMLToLaTeX.convert(new XMLSerializer().serializeToString(math))
    if (latex.trim() === '') continue
    const savedStyle = document.createElement('span').style
    savedStyle.cssText = originals[index]?.getAttribute('style') ?? ''
    const bold = formatting?.bold ?? ['bold', '700'].includes(savedStyle.fontWeight)
    let html: string
    try {
      html = katex.renderToString(bold ? `\\boldsymbol{${latex}}` : latex, { output: 'html', displayMode: math.getAttribute('display') === 'block', throwOnError: true, strict: 'ignore', trust: false })
    } catch (error) {
      if (!(error instanceof katex.ParseError)) throw error
      continue
    }
    const wrapper = document.createElement('span')
    wrapper.className = css.equation ?? ''
    wrapper.dataset.wordEquation = ''
    if (formatting === undefined) {
      wrapper.style.fontSize = savedStyle.fontSize
      wrapper.style.fontWeight = savedStyle.fontWeight
      math.setAttribute('style', wrapper.style.cssText)
    }
    const visual = document.createElement('span')
    visual.setAttribute('aria-hidden', 'true')
    visual.append(DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true }, RETURN_DOM_FRAGMENT: true }))
    math.setAttribute('class', css.accessible ?? '')
    math.replaceWith(wrapper)
    wrapper.append(math, visual)
  }
  return fragment
}

/**
 * Scope imported document styles to their preview and restore equations from saved MathML.
 * @param bytes - collection-generated DOCX with native equations and matching custom-property MathML.
 * @param container - the fully rendered, caller-owned Word preview.
 */
export function renderExampleWordEquations(bytes: Uint8Array, container: HTMLElement): void {
  // Imported span and SVG rules must stop before the formula renderer's subtree.
  for (const style of container.querySelectorAll('style')) {
    style.textContent = `@scope to ([data-word-equation]) {\n${style.textContent.replaceAll(':root', ':scope')}\n}`
  }
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
    preview.replaceWith(renderExampleMathml(equation))
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
    const columns = /\bexample-word_dshexample(?:edited)?choices([124])\b/u.exec(paragraph.className)?.[1]
    if (columns === undefined) continue
    const tabs = Array.from(paragraph.querySelectorAll('span')).filter(node =>
      node.children.length === 0 && node.textContent === '\u2003')
    if (tabs.length + 1 !== Number(columns)) {
      if (paragraph.className.includes('dshexampleedited')) continue
      throw new Error('Collected Word option columns do not match their tab stops')
    }
    const cells: HTMLElement[] = []
    const range = document.createRange()
    const appendCell = (): void => {
      const cell = document.createElement('span')
      let content: Node = range.cloneContents()
      let ancestor = range.commonAncestorContainer
      while (ancestor instanceof Element && ancestor !== paragraph) {
        const wrapper = ancestor.cloneNode(false)
        wrapper.appendChild(content)
        content = wrapper
        ancestor = ancestor.parentNode as Node
      }
      cell.append(content)
      cells.push(cell)
    }
    range.setStart(paragraph, 0)
    for (const tab of tabs) {
      range.setEndBefore(tab)
      appendCell()
      range.setStartAfter(tab)
    }
    range.setEnd(paragraph, paragraph.childNodes.length)
    appendCell()
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
