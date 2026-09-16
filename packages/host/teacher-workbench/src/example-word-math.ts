/** Native equation conversion with growing braces for equation systems. */

import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom'
import { mml2omml } from 'mathml2omml'
import colorString from 'color-string'
import katex from 'katex'

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/**
 * Read the equation size independently of compact relation runs.
 * @param equation - native equation used when the preview has no explicit size.
 * @param preview - saved MathML with the equation's point size.
 * @returns equation font size in points.
 */
export function exampleOfficeMathSize(equation: XmlElement, preview: XmlElement): number {
  const size = /font-size\s*:\s*([\d.]+)pt/u.exec(preview.getAttribute('style') ?? '')?.[1]
  return size === undefined ? Number(equation.getElementsByTagNameNS(W, 'sz').item(0)?.getAttributeNS(W, 'val') ?? '24') / 2 : Number(size)
}

/**
 * Convert one complete TeX equation, including MathLive bold italics, without Markdown delimiters.
 * @param latex - formula content; malformed or unsupported TeX throws.
 * @param display - whether to use display-math layout.
 * @returns editable native math and its matching annotation-free preview MathML.
 */
export function exampleLatexToOffice(latex: string, display: boolean): { office: XmlElement; mathml: string } {
  if (latex.trim() === '') throw new Error('Equation must not be empty')
  const rendered = katex.renderToString(latex, {
    output: 'mathml', displayMode: display, throwOnError: true, strict: 'ignore', trust: false,
  })
  const math = new DOMParser().parseFromString(rendered, 'application/xml')
    .getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math').item(0)
  if (math === null) throw new Error('TeX conversion returned no MathML')
  for (const annotation of Array.from(math.getElementsByTagName('annotation'))) annotation.parentNode?.removeChild(annotation)
  const mathml = new XMLSerializer().serializeToString(math)
  return { office: exampleMathmlToOffice(mathml), mathml }
}

/**
 * Convert MathML into editable Office math with colors and a system's shared left brace.
 * @param mathml - complete MathML equation from the collection's TeX renderer.
 * @returns native equation with a growing delimiter around each one-sided brace matrix.
 */
export function exampleMathmlToOffice(mathml: string): XmlElement {
  const source = new DOMParser().parseFromString(mathml, 'application/xml')
  for (let element of Array.from(source.getElementsByTagName('*'))) {
    // Older KaTeX equations wrapped compound expressions in token elements.
    if (['mi', 'mo'].includes(element.localName ?? '') && Array.from(element.childNodes).some(node => node.nodeType === 1 && node.localName !== 'mglyph')) {
      const row = source.createElementNS(element.namespaceURI, 'mrow')
      for (const attribute of Array.from(element.attributes)) row.setAttribute(attribute.name, attribute.value)
      while (element.firstChild !== null) row.appendChild(element.firstChild)
      element.parentNode?.replaceChild(row, element)
      element = row
    }
    for (const name of ['mathcolor', 'color', 'mathbackground']) {
      const value = element.getAttribute(name)
      if (!value) continue
      const rgb = colorString.get.rgb(value)
      if (rgb === null || rgb[3] !== 1) throw new Error('Equation colors must be opaque RGB colors')
      element.setAttribute(name, `#${rgb.slice(0, 3).map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`)
    }
  }
  const document = new DOMParser().parseFromString(mml2omml(new XMLSerializer().serializeToString(source)), 'application/xml')
  const office = document.documentElement
  if (office === null) throw new Error('MathML conversion returned no Office equation')
  for (const matrix of Array.from(office.getElementsByTagNameNS(M, 'm'))) {
    const brace = matrix.previousSibling
    const parent = matrix.parentNode
    if (parent === null || brace?.nodeType !== 1 || (brace as XmlElement).localName !== 'r' || brace.textContent !== '{') continue
    if (matrix.nextSibling?.textContent === '}') continue
    const columns = Array.from(matrix.childNodes).find(node => node.nodeType === 1 && (node as XmlElement).localName === 'mPr') as XmlElement | undefined
    for (const alignment of Array.from(columns?.getElementsByTagNameNS(M, 'mcJc') ?? [])) alignment.setAttributeNS(M, 'm:val', 'left')
    const delimiter = document.createElementNS(M, 'm:d')
    const properties = document.createElementNS(M, 'm:dPr')
    for (const [name, value] of [['begChr', '{'], ['endChr', ''], ['grow', '1']] as const) {
      const property = document.createElementNS(M, `m:${name}`)
      property.setAttributeNS(M, 'm:val', value)
      properties.appendChild(property)
    }
    const braceFormat = (brace as XmlElement).getElementsByTagNameNS(W, 'rPr').item(0)
    if (braceFormat !== null) child(properties, M, 'm:ctrlPr').appendChild(braceFormat.cloneNode(true))
    const body = document.createElementNS(M, 'm:e')
    delimiter.appendChild(properties)
    delimiter.appendChild(body)
    parent.removeChild(brace)
    parent.replaceChild(delimiter, matrix)
    body.appendChild(matrix)
  }
  return office
}

/**
 * Apply equation-level sizing and optional bold while retaining intrinsic letter styles and colors.
 * @param equation - native equation rebuilt from its saved MathML when removing whole-equation bold.
 * @param size - font size in points.
 * @param bold - whether to add bold to every native run and structural control character.
 */
export function formatExampleOfficeMath(equation: XmlElement, size: number, bold: boolean): void {
  for (const run of Array.from(equation.getElementsByTagNameNS(M, 'r'))) {
    const pr = child(run, W, 'w:rPr')
    property(pr, W, 'w:rFonts', { ascii: 'Cambria Math', hAnsi: 'Cambria Math', cs: 'Cambria Math', eastAsia: 'Cambria Math' })
    property(pr, W, 'w:sz', { val: String(Math.round(size * 2)) })
    property(pr, W, 'w:szCs', { val: String(Math.round(size * 2)) })
    const mathPr = child(run, M, 'm:rPr')
    if (run.firstChild !== pr) run.insertBefore(pr, run.firstChild)
    if (mathPr.nextSibling !== pr) run.insertBefore(mathPr, pr)
    const style = mathPr.getElementsByTagNameNS(M, 'sty').item(0)
    if (bold) {
      const value = style?.getAttributeNS(M, 'val') ?? (mathPr.getElementsByTagNameNS(M, 'nor').length > 0 ? 'p' : 'i')
      property(mathPr, M, 'm:sty', { val: value === 'i' || value === 'bi' ? 'bi' : 'b' })
      property(pr, W, 'w:b', { val: 'true' })
      property(pr, W, 'w:bCs', { val: 'true' })
    } else if (style?.getAttributeNS(M, 'val') === 'undefined') style.setAttributeNS(M, 'm:val', 'p')
    if (mathPr.getElementsByTagNameNS(M, 'sty').item(0)?.getAttributeNS(M, 'val') === 'bi') {
      for (const normal of Array.from(mathPr.getElementsByTagNameNS(M, 'nor'))) mathPr.removeChild(normal)
    }
  }
  for (const pr of Array.from(equation.getElementsByTagNameNS(M, '*')).filter(node => node.localName?.endsWith('Pr') && !['rPr', 'ctrlPr', 'argPr', 'mcPr'].includes(node.localName))) {
    const run = child(child(pr, M, 'm:ctrlPr'), W, 'w:rPr')
    property(run, W, 'w:sz', { val: String(Math.round(size * 2)) })
    if (bold) {
      property(run, W, 'w:b', { val: 'true' })
      property(run, W, 'w:bCs', { val: 'true' })
    }
  }
}

function child(parent: XmlElement, namespace: string, name: string): XmlElement {
  const existing = Array.from(parent.childNodes).find(node =>
    node.nodeType === 1 && node.namespaceURI === namespace && node.nodeName === name) as XmlElement | undefined
  if (existing !== undefined) return existing
  const document = parent.ownerDocument
  if (document === null) throw new Error('Equation property has no owner document')
  const element = document.createElementNS(namespace, name)
  parent.appendChild(element)
  return element
}

function property(parent: XmlElement, namespace: string, name: string, values: Record<string, string>): void {
  const element = child(parent, namespace, name)
  const prefix = name.slice(0, name.indexOf(':'))
  for (const [key, value] of Object.entries(values)) element.setAttributeNS(namespace, `${prefix}:${key}`, value)
  if (namespace === W && parent.localName === 'rPr') {
    const order = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'color', 'sz', 'szCs', 'shd']
    const following = Array.from(parent.childNodes).find(node => order.indexOf(node.localName ?? '') > order.indexOf(element.localName ?? ''))
    if (following !== undefined) parent.insertBefore(element, following)
  }
}
