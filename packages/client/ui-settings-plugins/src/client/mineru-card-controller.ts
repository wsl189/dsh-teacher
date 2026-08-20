/** The MinerU card's staged form over the `ocr-mineru` settings namespace. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Namespace of the MinerU OCR provider. */
export const MINERU_NS = 'ocr-mineru'

/** The MinerU provider fields this card edits. */
export interface MinerUSettings {
  /** Full synchronous MinerU parsing endpoint. */
  endpoint?: string
  /** MinerU parsing backend. */
  backend?: string
  /** MinerU hybrid parsing effort. */
  effort?: string
  /** MinerU recognition language code. */
  language?: string
  /** Per-document request deadline in milliseconds. */
  timeoutMs?: number
  /** Maximum decoded upload size in bytes. */
  maxFileBytes?: number
  /** Maximum extracted Markdown characters returned to a client. */
  maxOutputCharacters?: number
  /** Maximum JSON response size accepted from MinerU. */
  maxResponseBytes?: number
}

/** What the MinerU provider card renders. */
export interface MinerUCardState extends CardShell {
  /** Full synchronous parsing endpoint. */
  endpoint: CardFieldState
  /** Parsing backend. */
  backend: CardFieldState
  /** Hybrid parsing effort. */
  effort: CardFieldState
  /** Recognition language code. */
  language: CardFieldState
  /** Per-document deadline. */
  timeoutMs: CardFieldState
  /** Decoded upload limit. */
  maxFileBytes: CardFieldState
  /** Extracted Markdown limit. */
  maxOutputCharacters: CardFieldState
  /** Provider response limit. */
  maxResponseBytes: CardFieldState
}

/** The registration-side face the MinerU card's slot entry injects. */
export interface MinerUCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useMinerUCard. */
    minerUCard: SnapshotStore<MinerUCardState>
  }
}

/** Bridges the `ocr-mineru` scope onto the provider card's staged form. */
export class MinerUCardController {
  private readonly form: CardForm<MinerUSettings>
  private readonly store: SnapshotStore<MinerUCardState>

  /** @param scope - the bound settings scope for the `ocr-mineru` namespace. */
  constructor(scope: SettingsScope<MinerUSettings>) {
    this.form = new CardForm(scope, [
      textField('endpoint'),
      textField('backend'),
      textField('effort'),
      textField('language'),
      numberField('timeoutMs'),
      numberField('maxFileBytes'),
      numberField('maxOutputCharacters'),
      numberField('maxResponseBytes'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): MinerUCardState {
    return {
      ...this.form.shell(),
      endpoint: this.form.field('endpoint'),
      backend: this.form.field('backend'),
      effort: this.form.field('effort'),
      language: this.form.field('language'),
      timeoutMs: this.form.field('timeoutMs'),
      maxFileBytes: this.form.field('maxFileBytes'),
      maxOutputCharacters: this.form.field('maxOutputCharacters'),
      maxResponseBytes: this.form.field('maxResponseBytes'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card snapshot and staged form actions.
   */
  inject(): MinerUCardFace {
    return { hooks: { minerUCard: this.store }, ...this.form.actions() }
  }
}
