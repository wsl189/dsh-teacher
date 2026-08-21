/** Typed document-extraction failure shared by the runtime and providers. */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { OcrErrorCode } from './types.ts'

/** Typed extraction error used between the runtime and providers. */
export class OcrError extends HarnessError {
  declare readonly code: OcrErrorCode

  /**
   * @param message - concise diagnostic without document content.
   * @param code - stable provider-independent code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: OcrErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
