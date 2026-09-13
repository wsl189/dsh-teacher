/** Expanded collection Word editing with native equation preservation and explicit save conflicts. */

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Editor, Extension, Node, type JSONContent } from '@tiptap/core'
import { EditorState, Selection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline, Undo2, Redo2, Sigma, Save, IndentIncrease, IndentDecrease } from 'lucide-react'
import type { TeacherExample, TeacherExampleDocumentKind, TeacherExampleWordEditor } from '@deepseek-ai/dsh-api-remotes/client'
import type { ExampleCollectionCommands } from './example-collection-controller.ts'
import type { TeacherWorkbenchTranslate } from './shared.tsx'
import { exampleEditorContent, exampleEditorParagraphs, exampleSelectionFont } from './example-word-editor-model.ts'
import { ExampleWordFontFamily } from './example-word-editor-font.ts'
import { renderExampleEquation, renderExampleMathml } from './example-word-preview.ts'
import { ExampleFormulaDialog } from './ExampleFormulaDialog.tsx'
import css from './ExampleWordEditor.module.css'

interface FormulaDraft { position: number | null; original: number | null; latex: string; size: number }
const FONTS = ['Times New Roman', '宋体', '仿宋', '楷体', '黑体', 'Arial', 'Cambria Math']
const SIZES = [
  [42, 'initial'], [36, 'smallInitial'], [26, 'one'], [24, 'smallOne'], [22, 'two'], [18, 'smallTwo'],
  [16, 'three'], [15, 'smallThree'], [14, 'four'], [12, 'smallFour'], [10.5, 'five'], [9, 'smallFive'],
  [7.5, 'six'], [6.5, 'smallSix'], [5.5, 'seven'], [5, 'eight'],
  [8, null], [10, null], [11, null], [20, null], [28, null], [48, null], [72, null],
] as const

/**
 * Edit the selected saved Word revision and synchronize successful saves with the collection.
 * @param props - document identity, persistent commands, close registration, and localized UI text.
 * @returns formatting toolbar, editable paper, formula dialog, and unsaved-change controls.
 */
export function ExampleWordEditor({ question, documentKind, commands, closeRequest, onClose, t }: {
  question: TeacherExample
  documentKind: TeacherExampleDocumentKind
  commands: ExampleCollectionCommands
  closeRequest: MutableRefObject<() => void>
  onClose: () => void
  t: TeacherWorkbenchTranslate
}) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor | null>(null)
  const base = useRef<TeacherExampleWordEditor | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [formula, setFormula] = useState<FormulaDraft | null>(null)
  const [closing, setClosing] = useState(false)
  const [, selectionChanged] = useState(0)
  const saveRef = useRef<() => void>(() => {})
  useEffect(() => {
    let active = true
    const isActive = (): boolean => active
    setLoaded(false)
    setError(null)
    void commands.readEditor({ id: question.id, document: documentKind }).then((saved) => {
      if (!isActive() || host.current === null) return
      base.current = saved
      const instance = new Editor({
        element: host.current,
        extensions: extensions(() => base.current ?? saved, setFormula, t),
        content: exampleEditorContent(saved.paragraphs),
        editorProps: {
          attributes: { role: 'textbox', 'aria-label': t('examples.editor.document'), 'aria-multiline': 'true', spellcheck: 'false' },
          handleKeyDown: (view, event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveRef.current(); return true }
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'Home' || event.key === 'End')) {
              event.preventDefault()
              const selection = event.key === 'Home' ? Selection.atStart(view.state.doc) : Selection.atEnd(view.state.doc)
              view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
              return true
            }
            return false
          },
        },
        onUpdate: () => { setDirty(true); setError(null) },
        onSelectionUpdate: () => { selectionChanged(value => value + 1) },
        onTransaction: () => { selectionChanged(value => value + 1) },
      })
      editor.current = instance
      setLoaded(true)
      setDirty(false)
    }).catch(() => { if (isActive()) setError(t('examples.editor.loadFailed')) })
    return () => { active = false; editor.current?.destroy(); editor.current = null }
  }, [commands, question.id, documentKind, attempt, t])

  const save = async (closeAfter = false): Promise<boolean> => {
    const instance = editor.current
    const previous = base.current
    if (instance === null || previous === null || saving) return false
    if (!dirty) { if (closeAfter) onClose(); return true }
    setSaving(true)
    setError(null)
    instance.setEditable(false, false)
    try {
      const saved = await commands.saveEditor({
        id: question.id, document: documentKind, sourceId: previous.sourceId,
        wordRevision: previous.wordRevision, paragraphs: exampleEditorParagraphs(instance.getJSON()),
      })
      if (instance.isDestroyed) return true
      base.current = saved
      instance.commands.setContent(exampleEditorContent(saved.paragraphs), { emitUpdate: false })
      // Undo history cannot retain object indexes from an earlier Word revision.
      instance.view.updateState(EditorState.create({ schema: instance.schema, doc: instance.state.doc, plugins: instance.state.plugins }))
      setDirty(false)
      setClosing(false)
      if (closeAfter) onClose()
      return true
    } catch (failure) {
      const conflict = failure instanceof Error && failure.message === 'word-changed'
      setError(t(conflict ? 'examples.editor.conflict' : 'examples.editor.saveFailed'))
      return false
    } finally {
      setSaving(false)
      if (!instance.isDestroyed) instance.setEditable(true, false)
    }
  }
  saveRef.current = () => { void save() }
  closeRequest.current = () => { if (!saving) { if (dirty) setClosing(true); else onClose() } }
  const current = editor.current
  const selectedFont = current === null ? 'Times New Roman' : exampleSelectionFont(current.state)
  const mark = current?.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string } | undefined
  const paragraph = current?.getAttributes('paragraph') as { lineSpacing?: number; indent?: number } | undefined
  const act = (operation: (instance: Editor) => void): void => {
    if (current === null) return
    operation(current)
    // The next key must use the updated selection without waiting for an animation frame.
    current.view.focus()
  }
  const openFormula = (): void => {
    if (current === null) return
    const node = current.state.selection.$from.nodeAfter
    if (node?.type.name === 'equation') setFormula({ ...(node.attrs as Omit<FormulaDraft, 'position'>), position: current.state.selection.from })
    else setFormula({ position: null, original: null, latex: '', size: Number.parseFloat(mark?.fontSize ?? '12') })
  }
  return (
    <div className={css.editor}>
      <div className={css.toolbar} role="toolbar" aria-label={t('examples.editor.tools')}>
        <select aria-label={t('examples.editor.font')} value={selectedFont ?? ''} disabled={!loaded || saving} onChange={(event) => { act((instance) => { const font = event.target.value; instance.chain().setFontFamily(font).setMark('textStyle', { eastAsiaFont: /[\u4e00-\u9fff]/u.test(font) ? font : '宋体' }).run() }) }}>
          {selectedFont === null ? <option value="" disabled>{t('examples.editor.mixedFonts')}</option>
            : !FONTS.includes(selectedFont) && <option value={selectedFont}>{selectedFont}</option>}
          {FONTS.map(font => <option key={font} value={font}>{font}</option>)}
        </select>
        <select aria-label={t('examples.editor.fontSize')} value={Number.parseFloat(mark?.fontSize ?? '12')} disabled={!loaded || saving} onChange={(event) => { act((instance) => {
          instance.chain().setFontSize(`${event.target.value}pt`).run()
          const { from, to } = instance.state.selection
          const transaction = instance.state.tr
          instance.state.doc.nodesBetween(from, to, (node, pos) => { if (node.type.name === 'equation') transaction.setNodeMarkup(pos, undefined, { ...node.attrs, size: Number(event.target.value) }) })
          if (transaction.docChanged) instance.view.dispatch(transaction)
        }) }}>
          {SIZES.map(([size, name]) => <option key={size} value={size}>{name === null ? size : t(`examples.editor.size.${name}`)}</option>)}
        </select>
        {([{ icon: Bold, key: 'bold', action: (instance: Editor) => instance.chain().toggleBold().run() },
          { icon: Italic, key: 'italic', action: (instance: Editor) => instance.chain().toggleItalic().run() },
          { icon: Underline, key: 'underline', action: (instance: Editor) => instance.chain().toggleUnderline().run() }] as const).map(({ icon: Icon, key, action }) => (
          <button key={key} title={t(`examples.editor.${key}`)} aria-label={t(`examples.editor.${key}`)} aria-pressed={current?.isActive(key) ?? false} disabled={!loaded || saving} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { act(action) }}><Icon size={17} /></button>
        ))}
        <span className={css.separator} />
        {([{ icon: AlignLeft, alignment: 'left', labelKey: 'left' }, { icon: AlignCenter, alignment: 'center', labelKey: 'center' }, { icon: AlignRight, alignment: 'right', labelKey: 'right' }] as const).map(({ icon: Icon, alignment, labelKey }) => (
          <button key={alignment} title={t(`examples.editor.${labelKey}`)} aria-label={t(`examples.editor.${labelKey}`)} aria-pressed={current?.isActive({ textAlign: alignment }) ?? false} disabled={!loaded || saving} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { act((instance) => { instance.chain().setTextAlign(alignment).run() }) }}><Icon size={17} /></button>
        ))}
        <select aria-label={t('examples.editor.lineSpacing')} value={paragraph?.lineSpacing ?? 1.25} disabled={!loaded || saving} onChange={(event) => { act((instance) => { instance.chain().updateAttributes('paragraph', { lineSpacing: Number(event.target.value) }).run() }) }}>
          {[1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(value => <option key={value} value={value}>{t('examples.editor.lineMultiple', { value })}</option>)}
        </select>
        {([{ icon: IndentDecrease, value: -12, labelKey: 'outdent' }, { icon: IndentIncrease, value: 12, labelKey: 'indent' }] as const).map(({ icon: Icon, value, labelKey }) => (
          <button key={labelKey} title={t(`examples.editor.${labelKey}`)} aria-label={t(`examples.editor.${labelKey}`)} disabled={!loaded || saving} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { act((instance) => { instance.chain().updateAttributes('paragraph', { indent: Math.max(0, Math.min(288, (paragraph?.indent ?? 0) + value)) }).run() }) }}><Icon size={17} /></button>
        ))}
        <span className={css.separator} />
        <button aria-label={t('examples.editor.formula')} title={t('examples.editor.formula')} disabled={!loaded || saving} onMouseDown={(event) => { event.preventDefault() }} onClick={openFormula}><Sigma size={18} /></button>
        <button aria-label={t('examples.editor.undo')} title={t('examples.editor.undo')} disabled={!loaded || saving || !current?.can().undo()} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { act((instance) => { instance.chain().undo().run() }) }}><Undo2 size={17} /></button>
        <button aria-label={t('examples.editor.redo')} title={t('examples.editor.redo')} disabled={!loaded || saving || !current?.can().redo()} onMouseDown={(event) => { event.preventDefault() }} onClick={() => { act((instance) => { instance.chain().redo().run() }) }}><Redo2 size={17} /></button>
        <div className={css.saveGroup}>
          <span className={css.status} role="status">{loaded ? t(dirty ? 'examples.editor.unsaved' : 'examples.saved') : t('examples.editor.loading')}</span>
          <button className={css.save} disabled={!loaded || !dirty || saving} onClick={() => { void save() }}><Save size={16} />{t(saving ? 'examples.editor.saving' : 'examples.editor.save')}</button>
        </div>
      </div>
      {error !== null && <div className={css.error} role="alert">{error}{!loaded && <button onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</button>}</div>}
      <div className={css.scroll}><div ref={host} className={css.paper} /></div>
      {formula !== null && <ExampleFormulaDialog latex={formula.latex} t={t} onClose={() => { setFormula(null) }} onApply={(latex) => {
        const instance = editor.current
        if (instance === null) return
        const marks = formula.position === null ? instance.state.storedMarks ?? instance.state.selection.$from.marks()
          : instance.state.doc.nodeAt(formula.position)?.marks ?? []
        const content: JSONContent = { type: 'equation', attrs: { original: formula.original, latex, size: formula.size }, marks: marks.map(mark => ({ type: mark.type.name, attrs: mark.attrs })) }
        if (formula.position === null) instance.chain().insertContent(content).run()
        else instance.chain().insertContentAt({ from: formula.position, to: formula.position + 1 }, content).run()
        instance.view.focus()
        setFormula(null)
      }} />}
      {closing && <UnsavedDialog
        t={t} saving={saving} onKeep={() => { setClosing(false) }} onDiscard={onClose} onSave={() => { void save(true) }}
      />}
    </div>
  )
}

function extensions(readSaved: () => TeacherExampleWordEditor, editFormula: (draft: FormulaDraft) => void, t: TeacherWorkbenchTranslate) {
  return [
    StarterKit.configure({
      blockquote: false, bulletList: false, code: false, codeBlock: false, heading: false, horizontalRule: false,
      link: false, listItem: false, listKeymap: false, orderedList: false, strike: false, trailingNode: false,
    }),
    TextStyle, ExampleWordFontFamily, FontSize, TextAlign.configure({ types: ['paragraph'] }),
    Extension.create({ name: 'wordLayout', addGlobalAttributes() {
      const style = (name: string, cssName: string, value: number, unit = 'pt') => ({ default: value, renderHTML: (attrs: Record<string, unknown>) => ({ style: `${cssName}:${String(attrs[name])}${unit}` }) })
      return [{ types: ['paragraph'], attributes: { lineSpacing: style('lineSpacing', 'line-height', 1.25, ''), indent: style('indent', 'margin-left', 0), firstLine: style('firstLine', 'text-indent', 0), spaceBefore: style('spaceBefore', 'margin-top', 0), spaceAfter: style('spaceAfter', 'margin-bottom', 4), tabs: { default: [], renderHTML: (attrs: Record<string, unknown>) => ({ style: `tab-size:${String((attrs.tabs as number[])[0] ?? 36)}pt` }) } } }]
    } }),
    Node.create({ name: 'equation', group: 'inline', inline: true, atom: true,
      addAttributes() { return { original: { default: null }, latex: { default: '' }, size: { default: 12 } } },
      renderHTML() { return ['span', { 'data-equation': '' }] },
      addNodeView() { return ({ node, getPos }) => {
        let attrs = node.attrs as { original: number | null; latex: string; size: number }
        const dom = document.createElement('span')
        dom.className = css.equation ?? ''
        dom.title = t('examples.editor.editFormula')
        dom.setAttribute('data-equation', '')
        const render = (current: typeof node): void => {
          attrs = current.attrs as typeof attrs
          const original = attrs.original === null ? undefined : readSaved().equations[attrs.original]
          const bold = current.marks.some(mark => mark.type.name === 'bold')
          const preview = original?.latex === attrs.latex
            ? renderExampleMathml(original.mathml, { latex: attrs.latex, bold })
            : renderExampleEquation(attrs.latex, bold)
          for (const math of preview.querySelectorAll('math')) {
            math.setAttribute('style', 'font-size:inherit;font-weight:inherit')
          }
          dom.style.fontSize = `${String(attrs.size)}pt`
          dom.replaceChildren(preview)
        }
        render(node)
        dom.addEventListener('dblclick', (event) => { event.preventDefault(); const position = getPos(); if (position !== undefined) editFormula({ ...attrs, position }) })
        return { dom, update(current) { if (current.type !== node.type) return false; render(current); return true } }
      } },
    }),
    Node.create({ name: 'image', group: 'inline', inline: true, atom: true,
      addAttributes() { return { original: { default: 0 } } },
      renderHTML() { return ['img'] },
      addNodeView() { return ({ node }) => {
        const image = readSaved().images[(node.attrs as { original: number }).original]
        const dom = document.createElement('img')
        if (image !== undefined) { dom.src = `data:${image.mediaType};base64,${image.contentBase64}`; dom.width = image.width; dom.height = image.height }
        dom.alt = t('examples.editor.figure')
        return { dom }
      } },
    }),
  ]
}

function UnsavedDialog({ t, saving, onKeep, onDiscard, onSave }: {
  t: TeacherWorkbenchTranslate
  saving: boolean
  onKeep: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close() }, [])
  return <dialog ref={ref} className={css.unsavedDialog} aria-label={t('examples.editor.unsaved')} onClick={(event) => { event.stopPropagation() }} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onKeep() }}>
    <p>{t('examples.editor.closePrompt')}</p>
    <div className={css.dialogActions}>
      <button disabled={saving} onClick={onKeep}>{t('examples.editor.keepEditing')}</button>
      <button disabled={saving} onClick={onDiscard}>{t('examples.editor.discard')}</button>
      <button disabled={saving} className={css.primary} onClick={onSave}>{t('examples.editor.saveClose')}</button>
    </div>
  </dialog>
}
