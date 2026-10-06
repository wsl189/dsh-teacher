/** Decode the workbench's version-matched PDF.js resources without network reads. */

type PdfResourceKind = 'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl'

declare const __DSH_WORKBENCH_PDF_ASSETS__: Readonly<Record<PdfResourceKind, Readonly<Record<string, string>>>>

/** Each fetch returns independently transferable bytes from the current client artifact. */
export class WorkbenchPdfDataFactory {
  /**
   * Decode a resource from the bundle into an independent byte buffer.
   *
   * @param request - the PDF.js resource kind and original filename.
   * @returns locally decoded bytes; rejects an asset absent from the bundle.
   */
  fetch(request: { readonly kind: PdfResourceKind; readonly filename: string }): Promise<Uint8Array> {
    const { kind, filename } = request
    return Promise.resolve().then(() => {
      const files = __DSH_WORKBENCH_PDF_ASSETS__[kind]
      const data = Object.hasOwn(files, filename) ? files[filename] : undefined
      if (data === undefined) throw new Error(`Workbench PDF asset is not bundled: ${kind}/${filename}`)
      return Uint8Array.from(atob(data), character => character.charCodeAt(0))
    })
  }
}
