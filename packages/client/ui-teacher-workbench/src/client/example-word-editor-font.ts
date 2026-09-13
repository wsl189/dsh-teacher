/** Browser font rendering and clipboard metadata for Word's two font fields. */

import { getStyleProperty } from '@tiptap/core'
import type { Node as EditorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { FontFamily } from '@tiptap/extension-text-style'
import { exampleDefaultTextFormat, exampleEastAsianRanges } from './example-word-editor-model.ts'

/** Render the saved Western and East Asian fonts without storing the CSS fallback list as a Word font name. */
export const ExampleWordFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [{ types: this.options.types, attributes: {
      fontFamily: {
        default: exampleDefaultTextFormat.font,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-word-font')
          ?? getStyleProperty(element, 'font-family') ?? exampleDefaultTextFormat.font,
        renderHTML: (attributes: Record<string, unknown>) => {
          const fonts = attributes as { fontFamily: string | null; eastAsiaFont: string | null }
          const western = fonts.fontFamily ?? exampleDefaultTextFormat.font
          const eastAsian = fonts.eastAsiaFont ?? exampleDefaultTextFormat.eastAsiaFont
          return {
            'data-word-font': western,
            style: `font-family: ${[...new Set([western, eastAsian])].map(font => JSON.stringify(font)).join(', ')}, serif`,
          }
        },
      },
      eastAsiaFont: {
        default: exampleDefaultTextFormat.eastAsiaFont,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-word-east-asian-font') ?? exampleDefaultTextFormat.eastAsiaFont,
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-word-east-asian-font': (attributes as { eastAsiaFont: string | null }).eastAsiaFont,
        }),
      },
    } }]
  },
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      state: {
        init: (_config, state) => eastAsianFonts(state.doc),
        apply: (transaction, previous) => transaction.docChanged ? eastAsianFonts(transaction.doc) : previous,
      },
      props: { decorations(state) { return this.getState(state) } },
    })]
  },
})

function eastAsianFonts(document: EditorNode): DecorationSet {
  const decorations: Decoration[] = []
  document.descendants((node, position) => {
    if (!node.isText) return
    const style = node.marks.find(mark => mark.type.name === 'textStyle')?.attrs as { eastAsiaFont?: string | null } | undefined
    const font = style?.eastAsiaFont ?? exampleDefaultTextFormat.eastAsiaFont
    for (const [from, to] of exampleEastAsianRanges(node.text ?? '')) {
      decorations.push(Decoration.inline(position + from, position + to, {
        'data-word-script': 'east-asian', style: `font-family: ${JSON.stringify(font)}, serif`,
      }))
    }
  })
  return DecorationSet.create(document, decorations)
}
