/** Shared typography for generated, saved, and compiled collection Word documents. */

import { DOMParser, XMLSerializer, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exampleMathmlToOffice, formatExampleOfficeMath } from './example-word-math.ts'
import { exampleWordIsEdited, normalizeExampleFigures, normalizeExampleLetterRuns, normalizeExampleParagraphs } from './example-word-layout.ts'
import { normalizeExampleImageSizes } from './example-word-images.ts'
import { normalizeExampleComplement } from './example-word-complement.ts'
import { normalizeExampleRelations } from './example-word-relations.ts'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

/**
 * Apply textbook typography, native complement runs, source-relative illustrations, and missing equation colors.
 * @param bytes - generated collection document; lowercase bold identifiers gain mathematical italics without changing equation text.
 * @returns normalized bytes, or undefined when the saved typography and layout already match.
 */
export function normalizeExampleWordTypography(bytes: Uint8Array): Buffer | undefined {
  const entries = unzipSync(bytes)
  let changed = false
  for (const path of ['word/document.xml', 'word/styles.xml', 'word/settings.xml']) {
    const entry = entries[path]
    if (entry === undefined) throw new Error(`Example Word file has no ${path}`)
    const source = strFromU8(entry)
    const document = new DOMParser().parseFromString(source, 'application/xml')
    const root = document.documentElement
    if (root === null) throw new Error(`Example Word file has an empty ${path}`)
    if (path === 'word/document.xml') {
      if (normalizeMathLetters(document, entries)) changed = true
      normalizeExampleImageSizes(document)
      normalizeExampleFigures(document)
      normalizeExampleParagraphs(document)
      normalizeExampleLetterRuns(document)
      for (const paragraph of Array.from(document.getElementsByTagNameNS(WORD_NS, 'p'))) {
        if (exampleWordIsEdited(paragraph)) continue
        if (!(paragraph.textContent ?? '').trim() && paragraph.getElementsByTagNameNS(WORD_NS, 'drawing').length === 0) continue
        const properties = child(paragraph, WORD_NS, 'w:pPr')
        if (paragraph.firstChild !== properties) paragraph.insertBefore(properties, paragraph.firstChild)
        const style = properties.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)?.getAttributeNS(WORD_NS, 'val')
        const figure = style === 'DshExampleFigure'
        const subquestion = /^\s*\(\s*(?:i{1,3}|iv|vi{0,3}|ix|xi{0,2})\s*\)/iu.test((paragraph.textContent ?? '').normalize('NFKC'))
        const firstLevel = /^\s*[（(]\s*\d+\s*[)）]/u.test(paragraph.textContent ?? '')
        property(properties, 'w:spacing', { before: figure ? '120' : '0', after: figure ? '120' : '80', line: '300', lineRule: 'auto' })
        property(properties, 'w:jc', { val: figure ? 'right' : 'left' })
        if (subquestion || firstLevel) {
          property(properties, 'w:ind', { left: subquestion ? '480' : '240', firstLine: '0' })
        }
        property(properties, 'w:widowControl', { val: 'true' })
        if (figure || subquestion || firstLevel || style?.startsWith('DshExampleChoices')) property(properties, 'w:keepLines', { val: 'true' })
        let next = paragraph.nextSibling
        while (next !== null && next.nodeType !== next.ELEMENT_NODE) next = next.nextSibling
        const nextStyle = (next as XmlElement | null)?.getElementsByTagNameNS(WORD_NS, 'pStyle').item(0)?.getAttributeNS(WORD_NS, 'val')
        property(properties, 'w:keepNext', { val: String(nextStyle === 'DshExampleFigure' || nextStyle?.startsWith('DshExampleChoices') === true) })
      }
      for (const run of Array.from(document.getElementsByTagNameNS(WORD_NS, 'r'))) {
        const properties = child(run, WORD_NS, 'w:rPr')
        if (run.firstChild !== properties) run.insertBefore(properties, run.firstChild)
      }
      for (const run of Array.from(document.getElementsByTagNameNS(MATH_NS, 'r'))) {
        const properties = child(run, WORD_NS, 'w:rPr')
        property(properties, 'w:rFonts', { ascii: 'Cambria Math', hAnsi: 'Cambria Math', eastAsia: 'Cambria Math', cs: 'Cambria Math', hint: 'default' })
        if (run.firstChild !== properties) run.insertBefore(properties, run.firstChild)
        const mathProperties = Array.from(run.childNodes).find(
          node => node.nodeType === node.ELEMENT_NODE && node.namespaceURI === MATH_NS && node.localName === 'rPr',
        )
        if (mathProperties !== undefined) run.insertBefore(mathProperties, properties)
        if (run.getElementsByTagNameNS(MATH_NS, 'sty').item(0)?.getAttributeNS(MATH_NS, 'val') === 'bi') {
          // Normal-text mode suppresses the math font's bold-italic alphabet in Word.
          for (const normal of Array.from(run.getElementsByTagNameNS(MATH_NS, 'nor'))) normal.parentNode?.removeChild(normal)
        }
      }
      // mathml2omml emits an undefined style for upright MathML; OMML spells plain style "p".
      for (const style of Array.from(document.getElementsByTagNameNS(MATH_NS, 'sty'))) {
        if (style.getAttributeNS(MATH_NS, 'val') === 'undefined') style.setAttributeNS(MATH_NS, 'm:val', 'p')
      }
    } else if (path === 'word/styles.xml') {
      child(child(child(root, WORD_NS, 'w:docDefaults'), WORD_NS, 'w:rPrDefault'), WORD_NS, 'w:rPr')
      for (const id of ['DshExampleVariable', 'DshExampleVector', 'DshExampleChoices1', 'DshExampleChoices2', 'DshExampleChoices4', 'DshExampleFigure', 'DshExampleEdited', 'DshExampleEditedChoices1', 'DshExampleEditedChoices2', 'DshExampleEditedChoices4']) {
        if (Array.from(root.getElementsByTagNameNS(WORD_NS, 'style')).some(style => style.getAttributeNS(WORD_NS, 'styleId') === id)) continue
        const style = document.createElementNS(WORD_NS, 'w:style')
        style.setAttributeNS(WORD_NS, 'w:type', id.startsWith('DshExampleChoices') || id.startsWith('DshExampleEdited') || id === 'DshExampleFigure' ? 'paragraph' : 'character')
        style.setAttributeNS(WORD_NS, 'w:styleId', id)
        property(style, 'w:name', { val: id })
        root.appendChild(style)
      }
    } else {
      const mathFont = child(child(root, MATH_NS, 'm:mathPr'), MATH_NS, 'm:mathFont')
      mathFont.setAttributeNS(MATH_NS, 'm:val', 'Cambria Math')
    }
    for (const properties of Array.from(document.getElementsByTagNameNS(WORD_NS, 'rPr'))) {
      if (exampleWordIsEdited(properties)) continue
      const mathematical = insideEquation(properties)
      property(properties, 'w:rFonts', {
        ascii: mathematical ? 'Cambria Math' : 'Times New Roman',
        hAnsi: mathematical ? 'Cambria Math' : 'Times New Roman',
        eastAsia: mathematical ? 'Cambria Math' : '宋体',
        cs: mathematical ? 'Cambria Math' : 'Times New Roman',
        hint: 'default',
      })
      property(properties, 'w:sz', { val: '24' })
      property(properties, 'w:szCs', { val: '24' })
      if (!mathematical) {
        const style = properties.getElementsByTagNameNS(WORD_NS, 'rStyle').item(0)?.getAttributeNS(WORD_NS, 'val')
        const variable = style === 'DshExampleVariable' || style === 'DshExampleVector'
        for (const name of ['w:b', 'w:bCs']) property(properties, name, { val: String(style === 'DshExampleVector') })
        for (const name of ['w:i', 'w:iCs']) property(properties, name, { val: String(variable) })
      }
    }
    if (path === 'word/document.xml') {
      if (normalizeExampleComplement(document, entries)) changed = true
      if (normalizeExampleRelations(document, entries)) changed = true
    }
    const normalized = new XMLSerializer().serializeToString(document)
    if (normalized === source) continue
    entries[path] = strToU8(normalized)
    changed = true
  }
  return changed ? Buffer.from(zipSync(entries)) : undefined
}

function normalizeMathLetters(document: XmlDocument, entries: Record<string, Uint8Array>): boolean {
  const custom = entries['docProps/custom.xml']
  if (custom === undefined) return false
  const parser = new DOMParser()
  const properties = parser.parseFromString(strFromU8(custom), 'application/xml')
  const saved = Array.from(properties.getElementsByTagName('property')).find(
    element => element.getAttribute('name') === 'dsh.example.mathml',
  )?.firstChild
  if (saved === undefined || saved === null) return false
  const mathml = parser.parseFromString(saved.textContent ?? '', 'application/xml')
  const equations = Array.from(mathml.getElementsByTagNameNS(MATHML_NS, 'math'))
  const nativeEquations = Array.from(document.getElementsByTagNameNS(MATH_NS, 'oMath'))
  if (equations.length !== nativeEquations.length) throw new Error('Collected Word equations do not match their preview data')
  const serializer = new XMLSerializer()
  let changed = false
  for (const [index, equation] of equations.entries()) {
    const native = nativeEquations[index]
    const edited = native !== undefined && exampleWordIsEdited(native)
    const letters = edited ? [] : Array.from(equation.getElementsByTagNameNS(MATHML_NS, 'mi')).filter(
      element => element.getAttribute('mathvariant') === 'bold' && /^[a-z\p{Script=Greek}]$/u.test(element.textContent ?? ''),
    )
    const colored = [equation, ...Array.from(equation.getElementsByTagNameNS(MATHML_NS, '*'))]
    const missingColors = ([['mathcolor', 'color'], ['mathbackground', 'shd']] as const).some(([attribute, property]) =>
      colored.some(element => element.hasAttribute(attribute)) && native?.getElementsByTagNameNS(WORD_NS, property).length === 0)
    const invalidText = Array.from(native?.getElementsByTagNameNS(MATH_NS, '*') ?? []).some(element =>
      Array.from(element.childNodes).some(node => element.localName === 't'
        ? node.nodeType === 1 : (node.nodeType === 3 || node.nodeType === 4) && Boolean(node.textContent?.trim())))
    const missingAlphabet = colored.some(element => /script|fraktur|double-struck|sans-serif|monospace/u.test(element.getAttribute('mathvariant') ?? '')) && native?.getElementsByTagNameNS(MATH_NS, 'scr').length === 0
    if (letters.length === 0 && !missingColors && !invalidText && !missingAlphabet) continue
    for (const letter of letters) letter.setAttribute('mathvariant', 'bold-italic')
    const replacement = exampleMathmlToOffice(serializer.serializeToString(equation))
    if (native === undefined || native.parentNode === null) {
      throw new Error('Collected Word equation has no replaceable native content')
    }
    if (replacement.textContent !== native.textContent) throw new Error('Collected Word letter formatting would change equation text')
    if (missingColors || invalidText || missingAlphabet) {
      const style = equation.getAttribute('style') ?? ''
      const size = /font-size\s*:\s*([\d.]+)pt/u.exec(style)?.[1]
      formatExampleOfficeMath(replacement, size === undefined ? Number(native.getElementsByTagNameNS(WORD_NS, 'sz').item(0)?.getAttributeNS(WORD_NS, 'val') ?? '24') / 2 : Number(size),
        /font-weight\s*:\s*(?:bold|700)/u.test(style))
    }
    native.parentNode.replaceChild(document.importNode(replacement, true), native)
    changed = true
  }
  if (!changed) return false
  saved.textContent = serializer.serializeToString(mathml)
  entries['docProps/custom.xml'] = strToU8(serializer.serializeToString(properties))
  return true
}

function child(parent: XmlElement, namespace: string, name: string): XmlElement {
  const existing = Array.from(parent.childNodes).find(
    node => node.nodeType === node.ELEMENT_NODE && node.namespaceURI === namespace && node.nodeName === name,
  )
  if (existing !== undefined) return existing as XmlElement
  const document = parent.ownerDocument
  if (document === null) throw new Error('Example Word element has no owner document')
  const element = document.createElementNS(namespace, name)
  parent.appendChild(element)
  return element
}

function property(parent: XmlElement, name: string, attributes: Readonly<Record<string, string>>): void {
  const element = child(parent, WORD_NS, name)
  if (parent.localName === 'rPr') {
    const order = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'color', 'sz', 'szCs', 'shd']
    const following = Array.from(parent.childNodes).find(node => order.indexOf(node.localName ?? '') > order.indexOf(element.localName ?? ''))
    if (following !== undefined) parent.insertBefore(element, following)
  }
  if (parent.localName === 'pPr' && name === 'w:ind') {
    const justification = parent.getElementsByTagNameNS(WORD_NS, 'jc').item(0)
    if (justification !== null) parent.insertBefore(element, justification)
  }
  if (parent.localName === 'pPr' && ['w:keepNext', 'w:keepLines', 'w:widowControl'].includes(name)) {
    const order = ['pStyle', 'keepNext', 'keepLines', 'widowControl']
    const following = Array.from(parent.childNodes).find(node => node.nodeType === node.ELEMENT_NODE &&
      (order.indexOf(node.localName ?? '') < 0 || order.indexOf(node.localName ?? '') > order.indexOf(element.localName ?? '')))
    if (following !== undefined) parent.insertBefore(element, following)
  }
  for (const attribute of Array.from(element.attributes)) element.removeAttributeNode(attribute)
  for (const [key, value] of Object.entries(attributes)) element.setAttributeNS(WORD_NS, `w:${key}`, value)
}

function insideEquation(element: XmlElement): boolean {
  let parent = element.parentNode
  while (parent !== null) {
    if (parent.nodeType === parent.ELEMENT_NODE && parent.namespaceURI === MATH_NS) return true
    parent = parent.parentNode
  }
  return false
}
