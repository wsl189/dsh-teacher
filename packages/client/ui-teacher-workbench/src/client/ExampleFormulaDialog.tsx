/** Visual equation entry with MathLive and a high-school mathematics palette. */

import { useEffect, useRef, useState } from 'react'
import { MathfieldElement, validateLatex } from 'mathlive'
import katex from 'katex'
import 'mathlive/fonts.css'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { renderExampleEquation } from './example-word-preview.ts'
import css from './ExampleWordEditor.module.css'

const MENU_LOCALE_KEYS = [
  'tooltip.menu',
  'menu.insert', 'menu.insert.abs', 'menu.insert.nth-root', 'menu.insert.log-base',
  'menu.insert.heading-calculus', 'menu.insert.derivative', 'menu.insert.nth-derivative',
  'menu.insert.integral', 'menu.insert.sum', 'menu.insert.product', 'menu.insert.heading-complex-numbers',
  'menu.insert.modulus', 'menu.insert.argument', 'menu.insert.real-part', 'menu.insert.imaginary-part', 'menu.insert.conjugate',
  'menu.borders', 'menu.array.add column after', 'menu.array.add column before',
  'menu.array.add row above', 'menu.array.add row below',
  'tooltip.fraktur', 'tooltip.script', 'tooltip.caligraphic', 'tooltip.blackboard', 'tooltip.roman-upright',
] as const

const STYLE_LABELS = {
  'variant-double-struck': 'examples.math.tooltip.blackboard',
  'variant-fraktur': 'examples.math.tooltip.fraktur',
  'variant-calligraphic': 'examples.math.tooltip.caligraphic',
  'variant-style-up': 'examples.math.tooltip.roman-upright',
  'variant-style-bold': 'examples.editor.bold',
  'variant-style-italic': 'examples.editor.italic',
} as const

const SYMBOL_GROUPS = [
  ['letters', [
    ['alpha', '\\alpha', '\\alpha'], ['beta', '\\beta', '\\beta'], ['gamma', '\\gamma', '\\gamma'],
    ['delta', '\\delta', '\\delta'], ['theta', '\\theta', '\\theta'], ['lambda', '\\lambda', '\\lambda'],
    ['mu', '\\mu', '\\mu'], ['pi', '\\pi', '\\pi'], ['rho', '\\rho', '\\rho'],
    ['sigma', '\\sigma', '\\sigma'], ['phi', '\\varphi', '\\varphi'], ['omega', '\\omega', '\\omega'],
    ['capitalDelta', '\\Delta', '\\Delta'],
  ]],
  ['structures', [
    ['fraction', '\\frac{a}{b}', '\\frac{#0}{#?}'], ['root', '\\sqrt{x}', '\\sqrt{#0}'],
    ['nthRoot', '\\sqrt[n]{x}', '\\sqrt[#?]{#0}'], ['power', 'x^{n}', '#@^{#?}'],
    ['square', 'x^2', '#@^2'], ['subscript', 'a_n', '#@_{#?}'],
    ['absolute', '\\lvert x\\rvert', '\\left|#0\\right|'], ['plusMinus', '\\pm', '\\pm'],
    ['multiply', '\\times', '\\times'], ['divide', '\\div', '\\div'], ['dot', '\\cdot', '\\cdot'],
    ['infinity', '\\infty', '\\infty'], ['factorial', 'n!', '#@!'],
  ]],
  ['relations', [
    ['notEqual', '\\ne', '\\ne'], ['lessEqual', '\\le', '\\le'], ['greaterEqual', '\\ge', '\\ge'],
    ['approximate', '\\approx', '\\approx'], ['belongs', '\\in', '\\in'], ['notBelongs', '\\notin', '\\notin'],
    ['properSubset', '\\subsetneq', '\\subsetneq'], ['subset', '\\subseteq', '\\subseteq'],
    ['union', '\\cup', '\\cup'], ['intersection', '\\cap', '\\cap'], ['emptySet', '\\varnothing', '\\varnothing'],
    ['natural', '\\mathbb{N}', '\\mathbb{N}'], ['integer', '\\mathbb{Z}', '\\mathbb{Z}'],
    ['rational', '\\mathbb{Q}', '\\mathbb{Q}'], ['real', '\\mathbb{R}', '\\mathbb{R}'],
    ['complex', '\\mathbb{C}', '\\mathbb{C}'], ['implies', '\\Rightarrow', '\\Rightarrow'], ['iff', '\\Leftrightarrow', '\\Leftrightarrow'],
  ]],
  ['geometry', [
    ['vector', '\\vec{a}', '\\vec{#0}'], ['directedSegment', '\\overrightarrow{AB}', '\\overrightarrow{#0}'],
    ['angle', '\\angle', '\\angle'], ['triangle', '\\triangle', '\\triangle'],
    ['parallel', '\\text{⫽}', '\\text{ ⫽ }'], ['perpendicular', '\\perp', '\\perp'], ['degree', '30^{\\circ}', '#@^{\\circ}'],
  ]],
  ['functions', [
    ['sin', '\\sin', '\\sin #0'], ['cos', '\\cos', '\\cos #0'], ['tan', '\\tan', '\\tan #0'],
    ['log', '\\log_a', '\\log_{#?} #0'], ['lg', '\\lg', '\\lg #0'], ['ln', '\\ln', '\\ln #0'],
    ['derivative', "f'(x)", "f'\\left(#0\\right)"], ['sum', '\\sum', '\\sum_{#?}^{#?} #0'],
    ['permutation', 'A_n^m', 'A_{#?}^{#?}'], ['combination', 'C_n^m', 'C_{#?}^{#?}'],
  ]],
  ['roman', [
    ['romanI', '\\text{i}', '\\text{i}'], ['romanII', '\\text{ii}', '\\text{ii}'],
    ['romanIII', '\\text{iii}', '\\text{iii}'], ['romanIV', '\\text{iv}', '\\text{iv}'],
    ['romanV', '\\text{v}', '\\text{v}'], ['romanVI', '\\text{vi}', '\\text{vi}'],
    ['romanVII', '\\text{vii}', '\\text{vii}'], ['romanVIII', '\\text{viii}', '\\text{viii}'],
  ]],
  ['accents', [
    ['hat', '\\hat{a}', '\\hat'], ['wideHat', '\\widehat{ABC}', '\\widehat'],
    ['bar', '\\bar{x}', '\\bar'], ['overline', '\\overline{AB}', '\\overline'],
    ['tilde', '\\tilde{x}', '\\tilde'], ['accentVector', '\\vec{a}', '\\vec'],
    ['accentDot', '\\dot{x}', '\\dot'], ['accentDoubleDot', '\\ddot{x}', '\\ddot'],
  ]],
] as const

/**
 * Edit one equation independently of the document until Apply is pressed.
 * @param props - current LaTeX, apply/cancel callbacks, and localized controls.
 * @returns modal equation editor with symbols and templates inserted at the current selection.
 */
export function ExampleFormulaDialog({ latex, onApply, onClose, t }: {
  latex: string
  onApply: (latex: string) => void
  onClose: () => void
  t: TeacherWorkbenchTranslate
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const field = useRef<MathfieldElement | null>(null)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    const element = dialog.current
    const host = container.current
    if (element === null || host === null) return
    MathfieldElement.fontsDirectory = null
    MathfieldElement.soundsDirectory = null
    const previousLocale = MathfieldElement.locale
    const locale = t('examples.editor.mathLocale')
    MathfieldElement.strings = { [locale]: Object.fromEntries(MENU_LOCALE_KEYS.map(key => [key, t(`examples.math.${key}`)])) }
    MathfieldElement.locale = locale
    const input = new MathfieldElement({ mathVirtualKeyboardPolicy: 'manual' })
    input.setAttribute('aria-label', t('examples.editor.formula'))
    input.value = latex
    host.append(input)
    const menuItems = input.menuItems.filter(item => !('id' in item && ['cut', 'copy', 'paste', 'select-all'].includes(item.id)))
      .map((item) => {
        if (!('submenu' in item) || !('id' in item) || item.id !== 'variant') return item
        return { ...item, submenuClass: '', submenu: item.submenu.map((style) => {
          if (!('id' in style) || !(style.id in STYLE_LABELS)) return style
          const label = t(STYLE_LABELS[style.id as keyof typeof STYLE_LABELS])
          const labeled = { ...style, label, ariaLabel: label, tooltip: label, class: '' }
          if (style.id !== 'variant-style-bold') return labeled
          const isBold = () => input.queryStyle({ variantStyle: 'bold' }) === 'all' || input.queryStyle({ variantStyle: 'bolditalic' }) === 'all'
          return { ...labeled, checked: isBold, onMenuSelect: () => {
            const upright = input.queryStyle({ variantStyle: 'up' }) === 'all' || input.queryStyle({ variantStyle: 'bold' }) === 'all'
              || (['fraktur', 'double-struck', 'calligraphic', 'script', 'monospace'] as const).some(variant => input.queryStyle({ variant }) === 'all')
            input.applyStyle({ variantStyle: upright ? (isBold() ? 'up' : 'bold') : (isBold() ? 'italic' : 'bolditalic') })
            input.focus()
          } }
        }) }
      })
    while (menuItems.at(-1)?.type === 'divider') menuItems.pop()
    input.menuItems = [{
      id: 'insert-equation-system', label: t('examples.editor.equationSystem'),
      onMenuSelect: () => {
        input.insert('\\begin{cases}#0\\\\#?\\end{cases}', { format: 'latex', mode: 'math', selectionMode: 'placeholder', focus: true })
        setInvalid(false)
      },
    }, ...menuItems]
    field.current = input
    element.showModal()
    input.focus()
    return () => {
      input.remove()
      field.current = null
      element.close()
      MathfieldElement.locale = previousLocale
    }
  }, [latex, t])
  const insert = (value: string): void => {
    field.current?.insert(value, { format: 'latex', mode: 'math', selectionMode: 'placeholder', focus: true })
    field.current?.executeCommand(['switchMode', 'math'])
    setInvalid(false)
  }
  const insertAccent = (command: string): void => {
    const input = field.current
    if (input === null) return
    const empty = input.selectionIsCollapsed
    input.insert(`${command}{${empty ? 'x' : '#0'}}`, { format: 'latex', mode: 'math', selectionMode: 'after', focus: true })
    if (empty) {
      // Accent placeholders cannot be entered in MathLive 0.110; select an editable letter instead.
      input.selection = { ranges: [[input.position - 2, input.position - 1]] }
    }
    setInvalid(false)
  }
  const apply = (): void => {
    // MathLive serializes the saved double-solidus glyph as \sslash after editing.
    const value = (field.current?.value.trim() ?? '').replaceAll(/\\sslash\b/gu, '\\text{⫽}')
    if (!value || validateLatex(value).length > 0) { setInvalid(true); return }
    try { renderExampleEquation(value) } catch (error) {
      if (!(error instanceof katex.ParseError)) throw error
      setInvalid(true)
      return
    }
    onApply(value)
  }
  return (
    <dialog ref={dialog} className={css.formulaDialog} aria-label={t('examples.editor.formula')} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }} onClick={(event) =>{  event.stopPropagation() }}>
      <h3>{t('examples.editor.formula')}</h3>
      <div ref={container} className={css.mathfield} />
      {invalid && <p role="alert">{t('examples.editor.invalidFormula')}</p>}
      <div className={css.symbolPalette}>
        {SYMBOL_GROUPS.map(([group, symbols]) => (
          <div key={group} className={css.symbolGroup} role="group" aria-label={t(`examples.symbols.${group}`)}>
            <span className={css.symbolHeading}>{t(`examples.symbols.${group}`)}</span>
            <div className={css.symbolKeys}>
              {symbols.map(([name, display, value]) => (
                <button key={name} type="button" title={t(`examples.symbols.${name}`)} aria-label={t(`examples.symbols.${name}`)}
                  onMouseDown={(event) => { event.preventDefault() }} onClick={() => { if (group === 'accents') insertAccent(value); else insert(value) }}>
                  <span aria-hidden="true" ref={(element) => { element?.replaceChildren(renderExampleEquation(display)) }} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className={css.dialogActions}>
        <button onClick={onClose}>{t('cancel')}</button>
        <button className={css.primary} onClick={apply}>{t('examples.editor.apply')}</button>
      </div>
    </dialog>
  )
}
