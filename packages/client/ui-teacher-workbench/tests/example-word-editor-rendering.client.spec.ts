// @vitest-environment jsdom

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import { afterEach, expect, it } from 'vitest'
import { ExampleWordFontFamily } from '../src/client/example-word-editor-font.ts'
import { exampleDefaultTextFormat, exampleEditorContent } from '../src/client/example-word-editor-model.ts'

const editors: Editor[] = []
const extensions = [StarterKit, TextStyle, ExampleWordFontFamily, FontSize]
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy() })

it.each([
  ['Times New Roman', '宋体'],
  ['Arial', '楷体'],
  ['黑体', '宋体'],
])('renders saved %s and %s immediately and retains both fonts in copied rich text', (font, eastAsiaFont) => {
  const content = [{ kind: 'text' as const, text: '设向量 a = 1。', format: {
    ...exampleDefaultTextFormat, font, eastAsiaFont, size: 16, bold: true, italic: true, underline: true,
  } }]
  const editor = new Editor({ extensions, content: exampleEditorContent([{
    content, alignment: 'left', indent: 0, firstLine: 0, lineSpacing: 1.25, spaceBefore: 0, spaceAfter: 4, tabs: [],
  }]) })
  editors.push(editor)
  const span = editor.view.dom.querySelector<HTMLElement>('[data-word-font]')
  expect(span?.style.fontFamily).toContain(font)
  expect(span?.style.fontFamily).toContain(eastAsiaFont)
  expect(span?.style.fontFamily).toContain('serif')
  const chinese = editor.view.dom.querySelector<HTMLElement>('[data-word-script="east-asian"]')
  expect(chinese?.textContent).toBe('设向量')
  expect(chinese?.style.fontFamily).toBe(`"${eastAsiaFont}", serif`)
  const originalText = editor.getJSON().content?.[0]?.content
  expect(originalText?.[0]?.marks).toContainEqual({
    type: 'textStyle', attrs: { fontFamily: font, eastAsiaFont, fontSize: '16pt' },
  })
  const pasted = new Editor({ extensions, content: editor.getHTML() })
  editors.push(pasted)
  expect(pasted.getJSON().content?.[0]?.content).toEqual(originalText)
  expect(pasted.getHTML()).not.toContain('data-word-script')
})

it('updates the rendered font list after font commands without saving that list as a font name', () => {
  const editor = new Editor({ extensions, content: '<p>中文 a</p>' })
  editors.push(editor)
  editor.commands.selectAll()
  editor.chain().setFontFamily('宋体').setMark('textStyle', { eastAsiaFont: '宋体' }).run()
  expect(editor.view.dom.querySelector<HTMLElement>('span')?.style.fontFamily).toBe('"宋体", serif')
  editor.commands.setFontFamily('Arial')
  expect(editor.view.dom.querySelector<HTMLElement>('span')?.style.fontFamily).toBe('"Arial", "宋体", serif')
  expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toContainEqual({
    type: 'textStyle', attrs: { fontFamily: 'Arial', eastAsiaFont: '宋体', fontSize: null },
  })
  editor.commands.setMark('textStyle', { eastAsiaFont: '楷体' })
  expect(editor.view.dom.querySelector<HTMLElement>('[data-word-script="east-asian"]')?.style.fontFamily).toBe('"楷体", serif')
})
