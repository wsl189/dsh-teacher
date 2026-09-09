/** Focused text fields share their microphone button's recorder for hold-Space dictation. */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { VoiceRecorderController } from '@deepseek-ai/dsh-client-ui-primitives'

/** Controlled field that accepts ordinary spaces and owns one dictation target. */
export interface VoiceKeyboardInput {
  readonly ref: RefObject<HTMLInputElement | HTMLTextAreaElement>
  readonly onChange: (value: string) => void
}

/**
 * Record after a 500 ms hold in one focused field; short presses insert an ordinary space.
 * @param voice - the same recorder used by the field's microphone button.
 * @param input - optional controlled input; composition and modified shortcuts keep their native behavior.
 */
export function useVoiceSpaceHold(voice: VoiceRecorderController, input: VoiceKeyboardInput | undefined): void {
  const latest = useRef({ voice, input })
  latest.current = { voice, input }
  const caret = useRef<{ value: string; offset: number } | null>(null)
  useLayoutEffect(() => {
    const field = input?.ref.current
    const pending = caret.current
    if (field !== null && field !== undefined && pending !== null && field.value === pending.value) {
      if (document.activeElement === field) field.setSelectionRange(pending.offset, pending.offset)
      caret.current = null
    }
  })
  const target = input?.ref
  useEffect(() => {
    const field = target?.current
    if (field === undefined || field === null) return
    let composing = false
    let composingUntil = 0
    let hold: { timer: ReturnType<typeof setTimeout>; started: Promise<void> | null; stop: () => void } | null = null
    const finish = (insertSpace: boolean): void => {
      const pending = hold
      if (pending === null) return
      hold = null
      clearTimeout(pending.timer)
      if (pending.started !== null) {
        // Permission may settle after key release; stop that recording as soon as startup settles.
        void pending.started.then(pending.stop)
      } else if (insertSpace) {
        const start = field.selectionStart ?? field.value.length
        const end = field.selectionEnd ?? start
        const value = `${field.value.slice(0, start)} ${field.value.slice(end)}`
        if (field.maxLength >= 0 && value.length > field.maxLength) return
        caret.current = { value, offset: start + 1 }
        latest.current.input?.onChange(value)
      }
    }
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== ' ') {
        if (hold?.started === null) finish(true)
        return
      }
      // keyCode 229 covers IME confirmation events without isComposing.
      // oxlint-disable-next-line typescript/no-deprecated
      const composingEvent = event.isComposing || event.keyCode === 229 || composing || Date.now() < composingUntil
      if (event.defaultPrevented || composingEvent || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (hold !== null) {
        event.preventDefault()
        return
      }
      const current = latest.current.voice
      if (event.repeat || field.disabled || field.readOnly || !current.supported
        || current.listening || current.starting || current.transcribing) return
      event.preventDefault()
      const pending = {
        timer: setTimeout(() => { pending.started = latest.current.voice.start() }, 500),
        started: null as Promise<void> | null,
        stop: current.stop,
      }
      hold = pending
    }
    const keyup = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || hold === null) return
      event.preventDefault()
      finish(true)
    }
    const blur = (): void => { finish(false) }
    const visibility = (): void => { if (document.hidden) finish(false) }
    const compositionStart = (): void => { composing = true; finish(false) }
    const compositionEnd = (): void => { composing = false; composingUntil = Date.now() + 10 }
    const keyboardTarget: HTMLElement = field
    keyboardTarget.addEventListener('keydown', keydown)
    field.addEventListener('blur', blur)
    field.addEventListener('compositionstart', compositionStart)
    field.addEventListener('compositionend', compositionEnd)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      finish(false)
      caret.current = null
      keyboardTarget.removeEventListener('keydown', keydown)
      field.removeEventListener('blur', blur)
      field.removeEventListener('compositionstart', compositionStart)
      field.removeEventListener('compositionend', compositionEnd)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [target])
}
