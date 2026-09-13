import { Schema } from '@tiptap/pm/model'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { exampleSelectionFont, exampleEastAsianRanges } from '../src/client/example-word-editor-model.ts'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' }, paragraph: { content: 'inline*' }, text: { group: 'inline' },
    equation: { inline: true, group: 'inline', atom: true }, image: { inline: true, group: 'inline', atom: true },
  },
  marks: { textStyle: { attrs: { fontFamily: { default: 'Times New Roman' }, eastAsiaFont: { default: '宋体' } } } },
})
const style = (fontFamily = 'Times New Roman', eastAsiaFont = '宋体') => schema.mark('textStyle', { fontFamily, eastAsiaFont })
const text = (value: string, fontFamily?: string, eastAsiaFont?: string) => schema.text(value, [style(fontFamily, eastAsiaFont)])
const document = (...content: ReturnType<typeof text>[]) => schema.node('doc', null, [schema.node('paragraph', null, content)])

describe('the selected Word font', () => {
  const doc = document(text('abc等边三角形（）'))

  it('uses UTF-16 editor positions for supplementary Chinese and mathematical letters', () => {
    expect(exampleEastAsianRanges('𝑎𠀀中（x）')).toEqual([[2, 6], [7, 8]])
  })

  it.each([
    [1, 4, 'Times New Roman'],
    [4, 9, '宋体'],
    [9, 11, '宋体'],
    [2, 6, null],
  ])('reads only characters in the range %s–%s', (from, to, font) => {
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, from, to) }))).toBe(font)
  })

  it('distinguishes differently formatted runs and ignores spaces between Chinese words', () => {
    const doc = document(text('中文'), text(' '), text('宋体'), text('楷体', 'Times New Roman', '楷体'))
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 1, 6) }))).toBe('宋体')
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 1, 8) }))).toBeNull()
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 6, 8) }))).toBe('楷体')
  })

  it('uses the caret script and stored font after a formatting command', () => {
    const doc = document(text('中文abc'))
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 1) }))).toBe('宋体')
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 3) }))).toBe('宋体')
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 6) }))).toBe('Times New Roman')
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 3), storedMarks: [style('Arial', '楷体')] }))).toBe('楷体')
  })

  it('reports the equation font while ignoring images in text selections', () => {
    const doc = document(text('中文'), schema.node('image'), schema.node('equation'))
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 1, 4) }))).toBe('宋体')
    expect(exampleSelectionFont(EditorState.create({ doc, selection: NodeSelection.create(doc, 4) }))).toBe('Cambria Math')
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 1, 5) }))).toBeNull()
  })

  it('preserves a font name outside the toolbar presets', () => {
    const doc = document(text('abc', 'Georgia'))
    expect(exampleSelectionFont(EditorState.create({ doc, selection: TextSelection.create(doc, 1, 4) }))).toBe('Georgia')
  })

  it('provides the typing font in an empty paragraph', () => {
    const doc = document()
    expect(exampleSelectionFont(EditorState.create({ doc }))).toBe('Times New Roman')
    expect(exampleSelectionFont(EditorState.create({ doc, storedMarks: [style('Arial')] }))).toBe('Arial')
  })
})
