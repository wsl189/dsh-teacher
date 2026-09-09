// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate/browser'
import { renderExampleWordEquations, renderExampleWordOptionRows } from '../src/client/example-word-preview.ts'

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
  it('keeps native equations in aligned option cells and releases size observation', () => {
    const disconnect = vi.fn()
    const observe = vi.fn()
    vi.stubGlobal('ResizeObserver', class { disconnect = disconnect; observe = observe })
    try {
      const container = document.createElement('div')
      container.innerHTML = '<p class="example-word_dshexamplechoices4"><span>A.</span><math><mi>a</mi></math><span><span>\u2003</span></span><span>B.2</span><span><span>\u2003</span></span><span>C.3</span><span><span>\u2003</span></span><span>D.4</span></p>'
      const dispose = renderExampleWordOptionRows(container)
      const cells = container.querySelectorAll('.example-choice-cell')
      expect(cells).toHaveLength(4)
      expect(cells[0]?.querySelector('math')?.textContent).toBe('a')
      expect(Array.from(cells).map(cell => cell.textContent)).toEqual(['A.a', 'B.2', 'C.3', 'D.4'])
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
