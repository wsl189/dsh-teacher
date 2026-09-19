# Agent Note: Native equations in chat-generated Word

Status: implemented

English | [中文](2026-09-17-chat-word-native-equations.zh.md)

## Problem

Chat Word authoring uses Univer, whose Doc text does not represent native Office equations. Instructions alone cannot make DOCX exports preserve editable fractions, roots, or scripts. The default Latin font also needs a deterministic owner outside the model's formatting choices.

## Decision

The [Univer repack](../../../../third-party/README.md#word-equations-and-fonts) converts explicitly delimited TeX to OMML at its worker's DOCX export operation, using KaTeX and the maintained MathML-to-OMML converter. Conversion preserves surrounding rich text, tables, hyperlinks, media, and existing native equations. Incomplete or unsupported marked equations reject export. A private temporary file is renamed to the authorized destination only after conversion succeeds, preserving existing output on failure.

The default Latin font is Times New Roman; explicit text fonts and East Asian font assignments remain intact. Newly converted equations split Latin letters and digits from operators. Those tokens use Times New Roman inside native math, with italic variables and upright digits and function names. Operators, extensible symbols, and explicit mathematical alphabets retain mathematical typesetting. Word normal-text math runs suppress automatic math spacing within their tokens without flattening surrounding OMML. Existing native equation fonts remain intact.

The Doc skill requires explicit TeX markers, including formula summaries, and the exporter enforces their conversion. Currency text is not parsed as math. An equation cannot cross a paragraph, field, image, or hyperlink boundary. Summary lines use separate paragraphs rather than literal `\n`. The converter's XML serialization escapes text and attributes after entity decoding, preserving `<`, `>`, and `&`; quotation-mark substitutes change mathematical meaning and are not an error recovery strategy. Export failures identify the source equation. The live editor retains TeX source; final layout verification reads and renders the exported Word file.

The [Office performance decision](../bug-fix/2026-09-16-office-generation-overhead.md) continues to own batching and worker caching. The [example collection decision](2026-09-08-example-collection.md) continues to own workbench Word editing and typography. Neither is superseded; this policy covers chat DOCX exports and does not change model settings.

## Alternatives considered

**Prompt-only rules.** They cannot make a plain-text exporter emit native math or prevent unsupported equations from being delivered as text.

**Equation images.** Images lose Word equation editing, mathematical structure, and reliable font changes.

**Times New Roman for the entire equation.** Structural mathematical layout requires a math font. Separate Latin tokens retain the requested font without replacing radicals, integrals, delimiters, or explicit mathematical alphabets.

## Consequences

Export adds a local XML conversion pass and retains the original Univer text. Raster equations cannot be recovered, and upstream import fidelity remains independent. Windows Word editing and rendering require validation in that application; XML inspection and LibreOffice rendering provide complementary evidence.

The [export regression tests](../../../../packages/bundle/web-app/tests/univer-word-export.spec.ts) cover conversion, retained content and fonts, invalid equations, and failed publication. The [shipped chat-tool scenario](../../../../apps/web/tests/univer-generation.e2e.ts) exports real Doc content, and the [recorded skill scenario](../../../../snapshots/web/univer-skills/snapshot.yml) pins the authoring instructions.
