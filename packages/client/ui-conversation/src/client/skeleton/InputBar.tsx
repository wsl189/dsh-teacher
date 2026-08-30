/** The default composer body: the 'conversation.composer.bar' slot entry.
 * Machine state arrives through the standard provide channel
 * (useInput + inputActions); the keyboard/DOM command face and stop arrive
 * through this entry's own inject, whose hooks compartment binds
 * useNotices/useLexicon; layout-phase inputs (variant, placeholder,
 * region-slot content) ride the owner props. Session facts
 * (running/removed/promptError) are self-selected via useSession.
 *
 * The text surface is the shell-owned Lexical editor bound here through
 * ComposerContentEditable; chips render as decorator portals, and the
 * keymap registers submit/menu/paste gestures on the editor command layer.
 * The no-session state renders the SAME div inert as the Workspace-picker
 * trigger instead of a parallel tree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconPlusOutline16, IconWarningOutline16, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
// Type-only: the `plan` projection key merge (the TodoDock posture — the
// composer reads a host-computed value; the domain owns the key).
import type {} from '@deepseek-ai/dsh-plan-mode/client'
// Type-only: the `goal` projection key merge (hint disambiguation).
import type {} from '@deepseek-ai/dsh-goal/client'
// The `imageLimits` projection key merge (intake pre-check) arrives with the
// wire types: apiproxy's sessions contract declares it, and client-runtime's
// api-remotes import already places it in every client program.
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import { ComposerContentEditable } from '../input/editor/ComposerContentEditable.tsx'
import { DecoratorPortals } from '../input/editor/DecoratorPortals.tsx'
import { registerComposerKeymap } from '../input/editor/keymap.ts'
import { $replaceDetectSpanWithText } from '../input/editor/span-map.ts'
import { attachmentErrorText, imageSizeText } from '../image-labels.ts'
import { ContextMeter } from './ContextMeter.tsx'
import { PermissionSelect } from './PermissionSelect.tsx'
import { useVoiceInput } from './useVoiceInput.ts'
import css from './InputBar.module.css'

export type InputBarProps = ComposerBarProps

const DOCUMENT_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff'
const HOLD_SPACE_MS = 500

type VoiceErrorTranslate = (key:
  | 'voice.permissionDenied'
  | 'voice.noMicrophone'
  | 'voice.noSpeech'
  | 'voice.networkError'
  | 'voice.notConfigured'
  | 'voice.fileTooLarge'
  | 'voice.failed') => string

function voiceErrorText(code: string, t: VoiceErrorTranslate): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
    case 'NotAllowedError':
    case 'SecurityError': return t('voice.permissionDenied')
    case 'audio-capture':
    case 'NotFoundError':
    case 'NotReadableError': return t('voice.noMicrophone')
    case 'no-speech':
    case 'empty-result': return t('voice.noSpeech')
    case 'provider-disabled': return t('voice.notConfigured')
    case 'file-too-large': return t('voice.fileTooLarge')
    case 'network':
    case 'provider-unavailable':
    case 'provider-failure': return t('voice.networkError')
    default: return t('voice.failed')
  }
}

export function InputBar({
  useSession, useInput, inputActions, keyboard, addImages, removeImage, draftImages,
  addDocuments, removeDocument, draftDocumentFile, transcribeVoice,
  resolveSubmitMode, toggleCommandMenu, stop, command, t,
  renderSlot, useNotices, useLexicon, useMenuLauncher, useDocuments,
  useProjection, sessionId, variant, disabled: inert = false, blocked,
  workspacePickerOpen = false, onRequestWorkspace,
  placeholder, accessory, overlay, leftItems, rightItems, footer,
}: InputBarProps) {
  const input = useInput(s => s)
  const notice = useNotices(s => s)
  void useLexicon // hook seat stays bound by the inject compartment; text-ref decoration rides the shell's editor transforms
  const commandMenuOpen = useMenuLauncher(source => source === 'command')
  const documents = useDocuments(rows => rows)
  const promptError = useSession(s => s.promptError) ?? null
  const running = useSession(s => s.running) ?? false
  const subagent = useSession(s => s.subagent) ?? null
  const removed = useSession(s => s.removed) ?? false
  // Plan mode swaps the composer placeholder (the projection is the folded
  // host value; owner-prop placeholders — hero, session-unavailable — win).
  const planActive = useProjection('plan', plan => plan !== undefined && (plan.pending ? !plan.active : plan.active))
  // Absent (undefined: no frame yet) and cleared (null) both mean no goal.
  const hasGoal = useProjection('goal', goal => goal != null)
  // Session-maybe: the machine faces are absent together while no session is
  // current; the bar renders the same DOM inert instead of a parallel tree.
  const live = input !== undefined && keyboard !== undefined && inputActions !== undefined
  const draft = input?.draft ?? ''
  const editor = keyboard?.editor ?? null
  const attachments = useMemo(
    () => input === undefined || draftImages === undefined ? [] : draftImages(input.imageIds),
    [draftImages, input?.imageIds],
  )
  const empty = draft.trim() === '' && attachments.length === 0 && documents.length === 0
  const documentsSettling = documents.some(document => document.status === 'extracting')
  const documentsFailed = documents.some(document => document.status === 'error')
  // Transient error banner (machine notices, image-intake rejections, and
  // prompt failures): the seq keys the Toast so an identical repeated message
  // restarts the hold-then-fade cycle instead of reusing the faded one.
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])
  const dismissToast = useCallback(() => { setToast(null) }, [])
  // The deployment's image-intake limits (absent while no attachment service
  // is composed — the pre-check below then defers entirely to the host).
  const imageLimits = useProjection('imageLimits')
  // Prompt failures are ordinary failures (no create/attach transaction exists
  // anymore): the toast announces promptError, the draft stays in the machine,
  // and the user resubmits. A remount over a session whose machine still holds
  // an unresolved promptError deliberately re-announces it once — the failure
  // is still pending, and a transient banner is its only surface. Attachment
  // rejections show product copy keyed by the wire reason; other codes are
  // developer-facing and keep the raw message plus code.
  useEffect(() => {
    if (promptError === null) return
    showToast(promptError.error.code === 'attachment-error'
      ? attachmentErrorText(t, promptError.error.details.reason, imageLimits)
      : `${promptError.error.message} (${promptError.error.code})`)
  }, [promptError, showToast, t, imageLimits])
  useEffect(() => {
    if (notice?.level === 'error') showToast(notice.text)
  }, [notice, showToast])
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // The Access seat's data: the host-computed permissions projection
  // (undefined = capability absent → the chip renders nothing).
  const permissions = useProjection('permissions')

  // A continuable child without its live parent cannot accept human input,
  // but its independent Stop below stays available while it runs.
  const continuable = subagent?.address.mode === 'continuable'
  const parentOffline = continuable && subagent.parentAvailable !== true
  // Running input stays free; locked = session removed, the
  // inert no-workspace state, the machine faces absent (no session), or a
  // parent-offline continuable child. An owner block also disables input;
  // adjudicating and submitting render read-only so the draft stays visible.
  const disabled = removed || inert || !live || blocked !== undefined || parentOffline
  const locked = disabled
  // The model seat is the ONE control a block leaves live: every block this
  // contract has is cleared by choosing a model, so locking it too would leave
  // the composer asking for the only thing it prevents. The other reasons to
  // be disabled do lock it — there is no session to choose a model for.
  const modelSeatLocked = removed || inert || !live
  const machineBusy = input?.phase === 'adjudicating' || input?.phase === 'submitting'
  // The no-workspace surface remains the resident DOM node but acts as the
  // existing picker trigger. Message controls stay locked until a Session
  // exists; the trigger itself is read-only rather than disabled so pointer
  // and keyboard users can reach the recovery action.
  const workspaceTrigger = inert && !removed && onRequestWorkspace !== undefined
  const editorDisabled = removed || (locked && !workspaceTrigger)
  const editable = live && !locked && !machineBusy
  const canSteerQueue = !locked && !machineBusy && !commandMenuOpen && empty && running && subagent === null
    && input.queue.some(row => row.placement === 'queued')

  useEffect(() => {
    if (input === undefined || inputActions === undefined) return
    if (attachments.length !== input.imageIds.length) {
      inputActions.pruneImages(attachments.map(attachment => attachment.id))
    }
  }, [attachments, input?.imageIds, inputActions])

  const appendTranscript = useCallback((transcript: string): void => {
    if (keyboard === undefined || locked || machineBusy) return
    const selection = keyboard.caretSpan()
    const before = keyboard.snapshot.draft.slice(0, selection.start)
    keyboard.paste(`${before === '' || /\s$/u.test(before) ? '' : ' '}${transcript}`)
  }, [keyboard, locked, machineBusy])
  const voice = useVoiceInput(transcribeVoice, appendTranscript, (code) => {
    showToast(voiceErrorText(code, t))
  })
  const spaceHold = useRef<{
    timer: number
    activated: boolean
    selection: { start: number; end: number }
  } | null>(null)
  useEffect(() => () => {
    const hold = spaceHold.current
    if (hold !== null) window.clearTimeout(hold.timer)
    spaceHold.current = null
  }, [])
  const beginSpaceHold = useCallback((): boolean => {
    if (spaceHold.current !== null) return true
    if (keyboard === undefined || locked || machineBusy || voice.starting
      || voice.listening || voice.transcribing || !voice.supported) return false
    const hold = {
      timer: 0,
      activated: false,
      selection: keyboard.caretSpan(),
    }
    hold.timer = window.setTimeout(() => {
      hold.activated = true
      void voice.start()
    }, HOLD_SPACE_MS)
    spaceHold.current = hold
    return true
  }, [keyboard, locked, machineBusy, voice.listening, voice.start, voice.starting, voice.supported, voice.transcribing])
  const finishSpaceHold = useCallback((): boolean => {
    const hold = spaceHold.current
    if (hold === null) return false
    window.clearTimeout(hold.timer)
    spaceHold.current = null
    if (hold.activated) {
      voice.stop()
      return true
    }
    if (keyboard !== undefined && !locked && !machineBusy) {
      keyboard.editor.update(() => {
        $replaceDetectSpanWithText(hold.selection, ' ')
      }, { discrete: true })
    }
    return true
  }, [keyboard, locked, machineBusy, voice.stop])
  const voiceBusy = voice.starting || voice.listening || voice.transcribing

  // Scroll the draft scrollport the minimum that brings the selection focus
  // into view — the browser's own behavior for typing, performed for the
  // paths where it does not act (programmatic focus with preventScroll, and
  // session switches that land the caret off screen). The live DOM selection
  // is the ruler; no mirror layer exists to consult.
  const revealSelection = (): void => {
    const scrollEl = scrollRef.current
    if (scrollEl === null || scrollEl.scrollHeight <= scrollEl.clientHeight) return
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    let rect = range.getBoundingClientRect()
    if (rect.height === 0 && rect.width === 0) {
      // A collapsed caret at an empty line reports a zero rect in some
      // engines; the anchor's element box is the line the caret sits on.
      const anchor = selection.anchorNode
      const el = anchor instanceof HTMLElement ? anchor : anchor?.parentElement
      if (el === undefined || el === null) return
      rect = el.getBoundingClientRect()
    }
    const box = scrollEl.getBoundingClientRect()
    if (rect.bottom > box.bottom) scrollEl.scrollTop += rect.bottom - box.bottom
    else if (rect.top < box.top) scrollEl.scrollTop -= box.top - rect.top
  }

  // Unlock (mount / session switch) returns focus to the box, and owns the
  // reveal that comes with it. Lexical's focus() suppresses the browser's
  // scroll walk (preventScroll inside), so the reveal in our own scrollport
  // is ours to perform — switching to a longer draft otherwise leaves the
  // caret (restored at the draft's end) off screen.
  useEffect(() => {
    if (locked || editor === null) return
    // Lexical's focus() restores the editor selection but never calls the DOM
    // focus itself; preventScroll keeps the conversation scrollport still.
    editor.getRootElement()?.focus({ preventScroll: true })
    editor.focus(() => { revealSelection() })
  }, [locked, sessionId, editor])

  // A persisted draft arrives AFTER the unlock effect: ConversationSession
  // adopts it in its own mount effect, and a parent's mount effect runs after
  // its children's. Reveal when the draft becomes non-empty so a restored long
  // draft does not stay at its head with the caret at its end. This effect does
  // not focus: send-clear, failed-send restore, and first-character transitions
  // must not steal focus from another control the user moved to.
  useEffect(() => {
    if (locked || draft === '') return
    revealSelection()
  }, [draft !== ''])

  // Wheel chaining on the draft scrollport, one lifetime (it is never
  // unmounted — the inert state renders the same element disabled). While the
  // capped box can still move in this direction, keep the native scroll; only
  // at its own edge forward the delta to the active conversation scrollport, so
  // a short draft never traps the gesture and a long draft stays scrollable.
  // Hero mounts have no host and keep native wheel scrolling.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const onWheel = (e: WheelEvent): void => {
      const host = el.closest('[data-conversation-scroll]')
      if (!(host instanceof HTMLElement) || e.deltaY === 0) return
      const atTop = el.scrollTop <= 0
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atEnd)) return
      e.preventDefault()
      host.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { el.removeEventListener('wheel', onWheel) }
  }, [])

  // Intake pre-check: an addition that would break
  // a projected limit is refused as a whole batch, announced immediately, and
  // never enters the rail — no more submit-time failure rolling the rail
  // back. The host enforces the same limits at submit for callers that bypass
  // this composer.
  const intakeImages = useCallback((files: readonly File[]): void => {
    if (addImages === undefined || files.length === 0) return
    const rejected = ((): string | null => {
      if (imageLimits !== undefined) {
        // Format precedes limits: a batch with
        // a non-image must announce the format problem, not a count or size
        // it could never pass anyway — addImages rejects it authoritatively.
        if (files.some(file => !(imageLimits.mediaTypes as readonly string[]).includes(file.type))) {
          return addImages(files)
        }
        if (attachments.length + files.length > imageLimits.maxImagesPerMessage) {
          return t('image.tooMany', { count: imageLimits.maxImagesPerMessage })
        }
        if (files.some(file => file.size > imageLimits.maxImageBytes)) {
          return t('image.fileTooLarge', { size: imageSizeText(imageLimits.maxImageBytes) })
        }
        const total = attachments.reduce((sum, attachment) => sum + attachment.file.size, 0)
          + files.reduce((sum, file) => sum + file.size, 0)
        if (total > imageLimits.maxMessageImageBytes) {
          return t('image.totalTooLarge', { size: imageSizeText(imageLimits.maxMessageImageBytes) })
        }
      }
      return addImages(files)
    })()
    if (rejected !== null) showToast(rejected)
  }, [addImages, attachments, imageLimits, showToast, t])

  const intakeDirectories = useCallback((paths: readonly string[]): void => {
    if (keyboard === undefined || locked || machineBusy || paths.length === 0) return
    const mentions = paths.flatMap((path) => {
      const mention = formatFileMention({ path, kind: 'directory' }, false)
      if (mention === undefined) return []
      return [mention.startsWith('@"') ? `${mention}"` : mention]
    })
    if (mentions.length !== paths.length) showToast(t('folder.dropUnsupported'))
    if (mentions.length === 0) return
    const selection = keyboard.caretSpan()
    const before = keyboard.snapshot.draft.slice(0, selection.start)
    keyboard.paste(`${before === '' || /\s$/u.test(before) ? '' : ' '}${mentions.join(' ')}`)
  }, [keyboard, locked, machineBusy, showToast, t])

  const canAcceptDrop = !locked && !machineBusy && addImages !== undefined

  // The keymap handlers read live bar state through this ref so the editor
  // registration survives re-renders without re-arming per keystroke.
  const gate = useRef({
    locked, machineBusy, canSteerQueue, running, subagent, resolveSubmitMode, intakeImages,
    documentsSettling, documentsFailed, voiceBusy, beginSpaceHold, finishSpaceHold,
  })
  gate.current = {
    locked, machineBusy, canSteerQueue, running, subagent, resolveSubmitMode, intakeImages,
    documentsSettling, documentsFailed, voiceBusy, beginSpaceHold, finishSpaceHold,
  }

  useEffect(() => {
    if (editor === null || keyboard === undefined) return
    return registerComposerKeymap(editor, {
      arbitrate: (key, composing) => keyboard.arbitrate(key, composing),
      space: () => {
        if (gate.current.machineBusy || gate.current.locked) return false
        return keyboard.space()
      },
      beginSpaceHold: () => gate.current.beginSpaceHold(),
      finishSpaceHold: () => gate.current.finishSpaceHold(),
      dismissPopup: () => { keyboard.dismissPopup() },
      canSubmit: () => !gate.current.locked && !gate.current.machineBusy
        && !gate.current.documentsSettling && !gate.current.documentsFailed && !gate.current.voiceBusy,
      submit: (accelerated) => {
        const g = gate.current
        // Empty-draft accelerated Enter acts on the queue instead of the
        // (empty) draft: the machine rejects empty drafts, so the gesture
        // steers every still-pending queued message into the running turn.
        if (accelerated && g.canSteerQueue) {
          keyboard.steerQueue()
          return
        }
        keyboard.submit(g.resolveSubmitMode(
          g.running,
          accelerated ? 'accelerated' : 'enter',
          g.subagent === null,
        ))
      },
      intakeFiles: (files) => { gate.current.intakeImages(files) },
      pasteText: (text) => {
        if (gate.current.machineBusy || gate.current.locked) return
        keyboard.paste(text)
      },
    })
  }, [editor, keyboard])

  // Button presses steal focus from the editor; suppress at mousedown so
  // typing continues seamlessly. Lexical's focus() carries preventScroll and
  // restores the previous selection, so no reveal is needed: the caret has
  // not moved, and the next keystroke gets the browser's native one.
  const keepFocus = (e: MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault()
    editor?.getRootElement()?.focus({ preventScroll: true })
  }

  const onToggleCommandMenu = (): void => {
    if (keyboard !== undefined) toggleCommandMenu?.(keyboard.caretSpan())
  }

  // The no-session Workspace trigger: the resident editable div acts as the
  // picker trigger for keyboard users (no editor is bound in this state).
  const onWorkspaceKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!workspaceTrigger) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRequestWorkspace()
    }
  }

  // An ordinary running session keeps Stop while the composer is empty or
  // owner-blocked; an actionable draft gets the existing Queue action. A
  // continuable child keeps Send primary and exposes Stop independently.
  const primaryStops = running && subagent === null && (empty || blocked !== undefined)
  const interruptible = running && continuable
  const primaryLabel = primaryStops ? t('input.stop') : t('input.send')
  const onPrimary = (): void => {
    if (primaryStops) {
      stop?.()
      return
    }
    if (inputActions === undefined) return // absent machine: the button is disabled
    /* v8 ignore next -- defensive: the primary button is disabled while empty||disabled, so a click cannot reach the false arm. */
    if (!empty && !disabled && !machineBusy) inputActions.submit()
  }

  // The Access seat: the projection-fed permission chip (renders nothing
  // while the permissions key is absent — permission-less host or Draft —
  // or while the command face is absent with the session).
  const accessSelect: ReactNode = command === undefined
    ? null
    : <PermissionSelect key={sessionId} value={permissions} locked={locked} command={command} t={t} />

  // Claim ghost hint: rendered by CSS as generated content after the last
  // paragraph while the claim's args are blank (a hint implies a single-line
  // token draft). The translated per-command hint wins over the claim's own.
  const claimActive = (input?.phase === 'claimed' || input?.phase === 'submitting')
    && input.claim !== undefined && draft.startsWith(input.claim.token)
  const rawHint = claimActive && input.claim.hint !== undefined
    && draft.slice(input.claim.token.length).trim() === ''
    ? input.claim.hint
    : null
  const hint = ((): string | null => {
    if (rawHint === null) return null
    // Claim tokens have the `/name ` format (trailing space); trim to the bare name.
    const commandName = input?.claim?.token.slice(1).trim() ?? ''
    const hintKey = `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}`
    // Dynamic lookup by claimed command name: unknown commands miss the
    // dictionary and keep the machine's own hint, so the call is wide.
    const translated = (t as Translate)(hintKey)
    return translated !== hintKey ? translated : rawHint
  })()

  const placeholderText = placeholder ?? (parentOffline
    ? t('placeholder.parentOffline')
    : disabled
      ? t('placeholder.unavailable')
      // The steer hint deliberately outranks the plan placeholder:
      // while it shows, the whole-queue gesture is genuinely available
      // (the gate never consults plan mode), so the actionable hint wins.
      : canSteerQueue
        ? t('placeholder.steerQueue')
        : planActive ? t('placeholder.plan') : t('placeholder.default'))

  return (
    <div className={clsx(css.root, variant === 'hero' && css.hero)}>
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={cardRef.current}
          onDone={dismissToast}
        />
      )}
      {notice?.level === 'info' && (
        <div className={css.notice} role="status">
          {notice.text}
        </div>
      )}
      {/* Trigger clicks land on the card, not the editor: the toolbar row's
          disabled controls swallow clicks otherwise (the CSS state disarms
          their pointer events), so the WHOLE capsule is the pick target.
          pointerdown stops here so the Menu's outside-close cannot race the
          click's reopen (close-then-open flickers the chip's open echo). */}
      <div
        ref={cardRef}
        className={clsx(css.card, workspaceTrigger && css.cardWorkspaceTrigger)}
        data-composer-card
        onClick={workspaceTrigger ? onRequestWorkspace : undefined}
        onPointerDown={workspaceTrigger ? (e) => { e.stopPropagation() } : undefined}
      >
        {overlay !== undefined && <div className={css.overlayAnchor}>{overlay}</div>}
        {accessory !== undefined && <div className={css.accessory}>{accessory}</div>}
        {renderSlot('conversation.input.attachments', {
          attachments,
          documents,
          canAcceptDrop,
          canRemoveDocuments: !machineBusy,
          onAddImages: intakeImages,
          onAddDirectories: intakeDirectories,
          onRemoveImage: (id) => { removeImage?.(id) },
          resolveDocumentFile: id => draftDocumentFile?.(id),
          onRemoveDocument: (id) => { removeDocument?.(id) },
          dropLimits: imageLimits === undefined ? undefined : {
            count: imageLimits.maxImagesPerMessage,
            size: imageSizeText(imageLimits.maxImageBytes),
          },
        }, {
          fallback: documents.length === 0 ? null : (
            <div className={css.documentRail} aria-label={t('document.pending')}>
              {documents.map(document => (
                <div
                  key={document.id}
                  className={clsx(css.documentChip, document.status === 'error' && css.documentChipError)}
                  data-document-status={document.status}
                  title={document.error}
                >
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
                    <path d="M3 1.5h6l4 4v9H3zM9 1.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                  <span className={css.documentName}>{document.name}</span>
                  <span className={css.documentStatus}>
                    {document.status === 'extracting'
                      ? t('document.extracting')
                      : document.status === 'error'
                        ? t('document.failed')
                        : document.truncated === true ? t('document.readyTruncated') : t('document.ready')}
                  </span>
                  <button
                    type="button"
                    className={css.documentRemove}
                    aria-label={t('document.remove', { name: document.name })}
                    disabled={machineBusy}
                    onMouseDown={keepFocus}
                    onClick={() => { removeDocument?.(document.id) }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ),
        })}
        {/* One scrollport, one text surface: the contenteditable grows with
            its content and .scroll — capped at 14 lines in CSS — is the only
            thing that scrolls. Chips are decorator portals inside the same
            surface, so wrapping, caret geometry, and scrolling are the
            browser's own. */}
        <div ref={scrollRef} className={css.scroll} data-input-scroll>
          <div className={css.grow}>
            <ComposerContentEditable
              editor={workspaceTrigger ? null : editor}
              editable={editable}
              className={clsx(css.input, editorDisabled && css.inputDisabled)}
              data-phase={input?.phase ?? 'inert'}
              aria-disabled={editorDisabled || undefined}
              data-placeholder={placeholderText}
              // The placeholder was the textarea's accessible name; a div's
              // data attribute is not, so the label restores it.
              aria-label={workspaceTrigger ? t('hero.chooseWorkspace') : placeholderText}
              aria-haspopup={workspaceTrigger ? 'menu' : undefined}
              aria-expanded={workspaceTrigger ? workspacePickerOpen : undefined}
              tabIndex={workspaceTrigger ? 0 : undefined}
              onKeyDown={workspaceTrigger ? onWorkspaceKeyDown : undefined}
              style={hint === null ? undefined : { '--dsh-composer-hint': JSON.stringify(hint) } as CSSProperties}
            />
            {empty && !claimActive && (
              <div aria-hidden className={css.placeholder} data-composer-placeholder>
                {placeholderText}
              </div>
            )}
            <DecoratorPortals editor={workspaceTrigger ? null : editor} />
          </div>
        </div>
        <div className={css.row}>
          <div className={css.tools}>
            <Tooltip label={t('input.commands')} side="top" delayMs={500}>
              <button
                type="button"
                className={css.add}
                aria-label={t('input.commands')}
                aria-haspopup="listbox"
                aria-expanded={commandMenuOpen}
                disabled={locked || toggleCommandMenu === undefined}
                onMouseDown={keepFocus}
                onClick={onToggleCommandMenu}
              >
                <IconPlusOutline16 size={14} />
              </button>
            </Tooltip>
            <Tooltip label={subagent === null ? t('document.upload') : t('document.subagentUnsupported')} side="top" delayMs={500}>
              <button
                type="button"
                className={css.add}
                aria-label={t('document.upload')}
                disabled={locked || machineBusy || addDocuments === undefined || subagent !== null}
                onMouseDown={keepFocus}
                onClick={() => { fileInputRef.current?.click() }}
              >
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
                  <path d="M5.25 8.5 9.7 4.05a2.2 2.2 0 1 1 3.1 3.1l-5.3 5.3a3.25 3.25 0 0 1-4.6-4.6l5.12-5.12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </Tooltip>
            <input
              ref={fileInputRef}
              className={css.fileInput}
              type="file"
              accept={DOCUMENT_ACCEPT}
              multiple
              tabIndex={-1}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? [])
                event.currentTarget.value = ''
                if (files.length > 0) addDocuments?.(files)
              }}
            />
            <Tooltip
              label={!voice.supported
                ? t('voice.unsupported')
                : voice.transcribing
                  ? t('voice.transcribing')
                  : voice.listening ? t('voice.stop') : t('voice.start')}
              side="top"
              delayMs={500}
            >
              <button
                type="button"
                className={clsx(css.add, voice.listening && css.voiceActive)}
                aria-label={voice.transcribing
                  ? t('voice.transcribing')
                  : voice.listening ? t('voice.stop') : t('voice.start')}
                aria-pressed={voice.listening}
                disabled={locked || machineBusy || voice.transcribing || !voice.supported}
                onMouseDown={keepFocus}
                onClick={() => { voice.toggle() }}
              >
                {voice.listening ? (
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
                    <rect x="5.25" y="1.5" width="5.5" height="8.5" rx="2.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M3.5 7.75a4.5 4.5 0 0 0 9 0M8 12.25V15M5.5 15h5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </Tooltip>
            <div className={css.modes}>
              {accessSelect}
              {sessionId === undefined ? null : renderSlot('conversation.input.plan', { locked })}
            </div>
            {leftItems}
          </div>
          <div className={css.trailing}>
            {rightItems}
            {sessionId === undefined ? null : renderSlot('conversation.input.model', { locked: modelSeatLocked })}
            <ContextMeter useProjection={useProjection} t={t} />
            {interruptible && (
              <Tooltip label={t('input.stop')} side="top" delayMs={500}>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={t('input.stop')}
                  disabled={stop === undefined}
                  onMouseDown={keepFocus}
                  onClick={stop}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                </button>
              </Tooltip>
            )}
            <Tooltip label={primaryLabel} side="top" delayMs={500}>
              <button
                type="button"
                className={css.primary}
                aria-label={primaryLabel}
                disabled={primaryStops
                  ? stop === undefined
                  : empty || disabled || machineBusy || documentsSettling || documentsFailed || voiceBusy}
                onMouseDown={keepFocus}
                onClick={onPrimary}
              >
                {primaryStops ? (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      {footer}
    </div>
  )
}
