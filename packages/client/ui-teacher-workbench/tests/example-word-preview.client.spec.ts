// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate/browser'
import { renderExampleEquation, renderExampleWordEquations, renderExampleWordOptionRows } from '../src/client/example-word-preview.ts'

const MATH_NS = 'http://www.w3.org/1998/Math/MathML'

function savedMath(mathml: string): Uint8Array {
  const properties = document.implementation.createDocument(null, 'Properties')
  const property = properties.createElement('property')
  property.setAttribute('name', 'dsh.example.mathml')
  property.textContent = `<equations>${mathml}</equations>`
  properties.documentElement.append(property)
  return zipSync({ 'docProps/custom.xml': strToU8(new XMLSerializer().serializeToString(properties)) })
}

function preview() {
  const container = document.createElement('div')
  container.append(document.createElementNS(MATH_NS, 'math'))
  return container
}

describe('collected Word formula previews', () => {
  it.each([
    { latex: 'x+1', text: 'x+1', structure: 'mrow' },
    { latex: String.raw`-\frac{4}{3}`, text: '−43', structure: 'mfrac' },
    { latex: String.raw`\overrightarrow{PA}`, text: 'PA→', structure: 'mover' },
  ])('renders applied $latex with its mathematical structure and complete content', ({ latex, text, structure }) => {
    const fragment = renderExampleEquation(latex)
    const math = fragment.querySelector('math')
    expect(math?.namespaceURI).toBe(MATH_NS)
    expect(math?.textContent).toBe(text)
    expect(math?.querySelector(structure)).not.toBeNull()
    expect(fragment.querySelector('annotation')).toBeNull()
  })

  it('rejects unsupported or incomplete equations before they replace document content', () => {
    expect(() => renderExampleEquation(String.raw`\frac{4}{`)).toThrow()
    expect(() => renderExampleEquation(String.raw`\notAnEquationCommand`)).toThrow()
  })

  it.each([String.raw`\mathbfit{b}=(1,-\sqrt{3})`, String.raw`\mathbfit{b=\left(1,-\sqrt{3}\right)}`])('renders MathLive bold italics from %s in both MathML and the visible formula', (latex) => {
    const fragment = renderExampleEquation(latex)
    expect(fragment.querySelector('math')?.textContent).toBe('b=(1,−3)')
    expect(fragment.querySelector('math mi')?.getAttribute('mathvariant')).toBe('bold-italic')
    expect(fragment.querySelector('.katex-html .boldsymbol')?.textContent).toContain('b')
  })

  it('retains saved equation size and bold in the visible preview without restoring unrelated CSS', () => {
    const container = preview()
    renderExampleWordEquations(savedMath(`<math xmlns="${MATH_NS}" style="font-size:18pt;font-weight:bold;position:fixed"><msqrt><mi>x</mi></msqrt></math>`), container)
    const equation = container.querySelector('math')?.parentElement
    expect(equation?.style.fontSize).toBe('18pt')
    expect(equation?.style.fontWeight).toBe('bold')
    expect(equation?.style.position).toBe('')
    expect(equation?.querySelector('.katex-html .sqrt svg')).not.toBeNull()
    expect(equation?.querySelector('.katex-html .boldsymbol')).not.toBeNull()
    expect(equation?.querySelector('math')?.textContent).toBe('x')
  })

  it('restores saved bold groups whose legacy token wrapper contains a row', () => {
    const container = preview()
    renderExampleWordEquations(savedMath(`<math xmlns="${MATH_NS}"><mi><mrow><mi mathvariant="bold-italic">b</mi><mo>=</mo><mn mathvariant="bold">1</mn></mrow></mi></math>`), container)
    expect(container.querySelector('math')?.textContent).toBe('b=1')
    expect(container.querySelector('.katex-html')?.textContent).toContain('b')
    expect(container.querySelector('.katex-html .boldsymbol')?.textContent).toContain('b')
  })

  it('renders saved formula spaces without displaying HTML entity names as mathematical text', () => {
    const container = preview()
    renderExampleWordEquations(savedMath(`<math xmlns="${MATH_NS}"><mrow><mi>AB</mi><mtext>\u00a0⫽\u00a0</mtext><mi>CD</mi></mrow></math>`), container)
    expect(container.querySelector('.katex-html')?.textContent?.replaceAll(/\s/gu, '')).toBe('AB⫽CD')
  })

  it('keeps nested formula colors and background fills when restoring a saved preview', () => {
    const container = preview()
    const formula = renderExampleEquation(String.raw`\textcolor{blue}{\hat{a}+\frac{x}{\textcolor{red}{y}}}+\colorbox{yellow}{$b$}`)
    renderExampleWordEquations(savedMath(new XMLSerializer().serializeToString(formula.querySelector('math')!)), container)
    const visual = container.querySelector('.katex-html')!
    const styled = Array.from(visual.querySelectorAll<HTMLElement>('[style]'))
    expect(styled.find(element => element.style.color === 'rgb(0, 0, 255)')?.textContent).toContain('a')
    expect(styled.find(element => element.style.color === 'rgb(255, 0, 0)')?.textContent).toContain('y')
    expect(styled.some(element => element.style.backgroundColor === 'rgb(255, 255, 0)')).toBe(true)
  })

  it.each([
    '<span>A.</span><math><mi>a</mi></math><span><span>\u2003</span></span><span>B.2</span><span><span>\u2003</span></span><span>C.3</span><span><span>\u2003</span></span><span>D.4</span>',
    '<span>A.</span><math><mi>a</mi></math><span style="font-weight:bold"><span>\u2003</span>B.2<span>\u2003</span>C.3<span>\u2003</span>D.4</span>',
  ])('keeps native equations and formatted option runs in aligned cells', (content) => {
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class { disconnect = disconnect; observe = observe })
    try {
      const container = document.createElement('div')
      container.innerHTML = `<p class="example-word_dshexamplechoices4">${content}</p>`
      const dispose = renderExampleWordOptionRows(container)
      const cells = container.querySelectorAll('.example-choice-cell')
      expect(cells).toHaveLength(4)
      expect(cells[0]?.querySelector('math')?.textContent).toBe('a')
      expect(Array.from(cells).map(cell => cell.textContent)).toEqual(['A.a', 'B.2', 'C.3', 'D.4'])
      if (content.includes('font-weight')) expect(cells[1]?.querySelector<HTMLElement>('[style]')?.style.fontWeight).toBe('bold')
      expect(observe).toHaveBeenCalledWith(container)
      dispose()
      expect(disconnect).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects missing option separators instead of losing or merging option content', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p class="example-word_dshexamplechoices4">A.1 B.2</p>'
    expect(() => renderExampleWordOptionRows(container)).toThrow('do not match')
    expect(container.textContent).toBe('A.1 B.2')
  })

  it('preserves a manually edited row after its option separators are deleted', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p class="example-word_dshexampleeditedchoices4">A.1 B.2</p>'
    expect(() => renderExampleWordOptionRows(container)).not.toThrow()
    expect(container.textContent).toBe('A.1 B.2')
  })

  it('renders the saved vector accent and fraction without changing the native Word file', () => {
    const container = preview()
    const file = savedMath(
      `<math xmlns="${MATH_NS}"><mrow><mover><mi>PA</mi><mo>→</mo></mover><mfrac><mn>3</mn><mn>2</mn></mfrac></mrow></math>`,
    )
    const before = file.slice()
    renderExampleWordEquations(file, container)
    expect(container.querySelector('mover')?.textContent).toBe('PA→')
    expect(container.querySelector('mfrac')?.children).toHaveLength(2)
    expect(file).toEqual(before)
  })

  it('rejects mismatched persisted equations instead of placing them against different text', () => {
    expect(() => {
      renderExampleWordEquations(savedMath(''), preview())
    }).toThrow('do not match')
  })

  it('removes executable markup from persisted MathML before inserting it', () => {
    const container = preview()
    renderExampleWordEquations(
      savedMath(
        `<math xmlns="${MATH_NS}" onclick="alert(1)"><mtext><img xmlns="http://www.w3.org/1999/xhtml" src="x" onerror="alert(1)"/></mtext><mi>x</mi></math>`,
      ),
      container,
    )
    expect(container.querySelector('[onclick], [onerror], img, script')).toBeNull()
    expect(container.querySelector('mi')?.textContent).toBe('x')
  })
})
