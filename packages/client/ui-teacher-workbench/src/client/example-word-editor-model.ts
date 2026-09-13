/** Mapping between saved Word paragraphs and the editor's schema-owned JSON document. */

import type { JSONContent } from '@tiptap/core'
import type { Mark } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { TeacherExampleWordParagraph, TeacherExampleTextFormat } from '@deepseek-ai/dsh-api-remotes/client'

/** Fonts and emphasis for unformatted collection Word text. */
export const exampleDefaultTextFormat: TeacherExampleTextFormat = { font: 'Times New Roman', eastAsiaFont: '宋体', size: 12, bold: false, italic: false, underline: false }
const EAST_ASIAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u

/**
 * Locate text rendered with Word's East Asian font field.
 * @param text - one editor text node.
 * @returns half-open UTF-16 ranges, matching ProseMirror text positions.
 */
export function exampleEastAsianRanges(text: string): readonly (readonly [number, number])[] {
  return Array.from(text.matchAll(new RegExp(`${EAST_ASIAN.source}+`, 'gu')), match => [match.index, match.index + match[0].length])
}

/**
 * Read the Word font assigned to selected characters, or the insertion point's surrounding script.
 * @param state - current editor selection and stored typing marks.
 * @returns the common font name, or null when the selected characters use different fonts.
 */
export function exampleSelectionFont(state: EditorState): string | null {
  const { from, to, empty, $from } = state.selection
  if (empty) {
    const before = $from.nodeBefore
    const after = $from.nodeAfter
    const character = before?.isText ? Array.from(before.text ?? '').findLast(value => !/\s/u.test(value))
      : after?.isText ? Array.from(after.text ?? '').find(value => !/\s/u.test(value)) : undefined
    return characterFont(character ?? '', state.storedMarks ?? $from.marks())
  }
  const fonts = new Set<string>()
  state.doc.nodesBetween(from, to, (node, position) => {
    if (node.isText) {
      const selected = (node.text ?? '').slice(Math.max(0, from - position), to - position)
      for (const character of selected) if (!/\s/u.test(character)) fonts.add(characterFont(character, node.marks))
    } else if (node.type.name === 'equation') fonts.add('Cambria Math')
  })
  return fonts.size > 1 ? null : fonts.values().next().value ?? characterFont('', $from.marks())
}

function characterFont(character: string, marks: readonly Mark[]): string {
  const style = marks.find(mark => mark.type.name === 'textStyle')?.attrs as { fontFamily?: string | null; eastAsiaFont?: string | null } | undefined
  return EAST_ASIAN.test(character) ? style?.eastAsiaFont ?? exampleDefaultTextFormat.eastAsiaFont
    : style?.fontFamily ?? exampleDefaultTextFormat.font
}

/**
 * Convert saved Word content without flattening equation or image references.
 * @param paragraphs - structured content from the current Word revision.
 * @returns JSON for the collection editor's registered node schema.
 */
export function exampleEditorContent(paragraphs: readonly TeacherExampleWordParagraph[]): JSONContent {
  return { type: 'doc', content: paragraphs.map(({ content, alignment, ...layout }) => ({
    type: 'paragraph', attrs: { ...layout, textAlign: alignment === 'both' ? 'justify' : alignment },
    content: content.flatMap((inline): JSONContent[] => {
      if (inline.kind === 'break') return [{ type: 'hardBreak' }]
      if (inline.kind === 'equation') return [{ type: 'equation', attrs: { original: inline.original, latex: inline.latex, size: inline.size }, marks: inline.bold ? [{ type: 'bold' }] : [] }]
      if (inline.kind !== 'text') return [{ type: inline.kind, attrs: { ...inline } }]
      if (inline.text === '') return []
      const { format } = inline
      const marks = [{ type: 'textStyle', attrs: { fontFamily: format.font, eastAsiaFont: format.eastAsiaFont, fontSize: `${String(format.size)}pt` } }]
      return [{ type: 'text', text: inline.text, marks: [...marks, ...(['bold', 'italic', 'underline'] as const).flatMap(type => format[type] ? [{ type }] : [])] }]
    }),
  })) }
}

/**
 * Serialize registered editor nodes to the validated Word edit request.
 * @param document - editor-owned JSON using only the collection's registered schema.
 * @returns ordered paragraphs and formats, preserving original object references.
 */
export function exampleEditorParagraphs(document: JSONContent): TeacherExampleWordParagraph[] {
  return (document.content ?? []).map((paragraph): TeacherExampleWordParagraph => {
    const attrs = paragraph.attrs as (Omit<TeacherExampleWordParagraph, 'content' | 'alignment'> & { textAlign: string })
    return {
      alignment: attrs.textAlign === 'justify' ? 'both'
        : attrs.textAlign === 'center' || attrs.textAlign === 'right' ? attrs.textAlign : 'left',
      lineSpacing: attrs.lineSpacing, indent: attrs.indent, firstLine: attrs.firstLine,
      spaceBefore: attrs.spaceBefore, spaceAfter: attrs.spaceAfter, tabs: attrs.tabs,
      content: (paragraph.content ?? []).map((inline) => {
        if (inline.type === 'equation') {
          const equation = inline.attrs as { original: number | null; latex: string; size: number }
          return { kind: 'equation' as const, original: equation.original, latex: equation.latex, size: equation.size, bold: inline.marks?.some(mark => mark.type === 'bold') === true }
        }
        if (inline.type === 'image') return { kind: 'image' as const, original: (inline.attrs as { original: number }).original }
        if (inline.type === 'hardBreak') return { kind: 'break' as const }
        const style = inline.marks?.find(mark => mark.type === 'textStyle')?.attrs as { fontFamily?: string; eastAsiaFont?: string; fontSize?: string } | undefined
        return { kind: 'text' as const, text: inline.text ?? '', format: { ...exampleDefaultTextFormat,
          font: style?.fontFamily ?? exampleDefaultTextFormat.font,
          eastAsiaFont: style?.eastAsiaFont ?? exampleDefaultTextFormat.eastAsiaFont,
          size: style?.fontSize === undefined ? 12 : Number.parseFloat(style.fontSize),
          bold: inline.marks?.some(mark => mark.type === 'bold') === true,
          italic: inline.marks?.some(mark => mark.type === 'italic') === true,
          underline: inline.marks?.some(mark => mark.type === 'underline') === true,
        } }
      }),
    }
  })
}
