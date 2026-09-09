/** Preset creation and per-question selection use separate collection commands. */

import { useId, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import { EditorModal, FormField, type TeacherWorkbenchTranslate } from './shared.tsx'
import css from './ExampleCollection.module.css'

/**
 * Display a tag in a name-stable color, with an optional removal action on hover or focus.
 * @param props - tag text and an optional localized removal action for the current question.
 * @returns a colored tag whose removal does not change the shared preset catalog.
 */
export function ExampleTag(props: {
  tag: string
  removal?: { label: string; pending: boolean; onRemove: () => void }
}) {
  let hash = 0
  for (let index = 0; index < props.tag.length; index++) hash = (hash * 31 + props.tag.charCodeAt(index)) >>> 0
  return (
    <span className={css.tag} data-tone={hash % 6}>
      {props.tag}
      {props.removal && (
        <button
          type="button"
          className={css.tagRemove}
          aria-label={props.removal.label}
          title={props.removal.label}
          disabled={props.removal.pending}
          onClick={props.removal.onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

/**
 * Choose saved presets for one question or create a preset available to every question.
 * @param props - persisted presets and selection, independent save callbacks, pending state, and locale.
 * @returns a dropdown with persistent row toggles and a dialog that creates presets without selecting them.
 */
export function ExampleTags(props: {
  presets: readonly string[]
  selected: readonly string[]
  pending: boolean
  onSelect: (tags: readonly string[]) => Promise<boolean>
  onAddPreset: (name: string) => Promise<string | null>
  t: TeacherWorkbenchTranslate
}) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [failed, setFailed] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const optionsId = useId()
  useDismissOnOutsidePointer(root, open, setOpen)

  const addPreset = async (): Promise<void> => {
    if (name.trim() === '' || props.pending) return
    setFailed(false)
    const saved = await props.onAddPreset(name.trim())
    if (saved === null) setFailed(true)
    else setCreating(false)
  }

  return (
    <div className={css.tagArea}>
      {props.selected.length > 0 && (
        <div className={css.tagList} aria-label={t('examples.selectedTags')}>
          {props.selected.map(tag => (
            <ExampleTag
              key={tag}
              tag={tag}
              removal={{
                label: t('examples.removeTag', { name: tag }),
                pending: props.pending,
                onRemove: () => { void props.onSelect(props.selected.filter(selected => selected !== tag)) },
              }}
            />
          ))}
        </div>
      )}
      <div className={css.tagControls}>
        <div
          className={css.tagPicker}
          ref={root}
          onBlur={(event) => {
            if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              trigger.current?.focus()
            }
          }}
        >
          <button
            ref={trigger}
            type="button"
            className={css.tagSelect}
            aria-expanded={open}
            aria-controls={open ? optionsId : undefined}
            onClick={() => { setOpen(value => !value) }}
          >
            {t('examples.selectTags')}
            <ChevronDown size={16} />
          </button>
          {open && (
            <div id={optionsId} className={css.tagOptions} role="group" aria-label={t('examples.presets')}>
              {props.presets.length === 0 ? (
                <p className={css.muted}>{t('examples.noTags')}</p>
              ) : props.presets.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className={css.tagOption}
                  aria-pressed={props.selected.includes(tag)}
                  aria-disabled={props.pending}
                  onClick={() => {
                    if (props.pending) return
                    void props.onSelect(props.selected.includes(tag)
                      ? props.selected.filter(selected => selected !== tag)
                      : [...props.selected, tag])
                  }}
                >
                  <span>{tag}</span>
                  {props.selected.includes(tag) && <Check size={16} className={css.tagOptionCheck} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={css.addPreset}
          disabled={props.pending}
          onClick={() => {
            setOpen(false)
            setName('')
            setFailed(false)
            setCreating(true)
          }}
        >
          <Plus size={15} />
          {t('examples.newTag')}
        </button>
      </div>
      <EditorModal
        open={creating}
        title={t('examples.addPreset')}
        closeLabel={t('examples.closePresetEditor')}
        onClose={() => { setCreating(false) }}
        onSave={() => { void addPreset() }}
        saveLabel={props.pending ? t('saving') : t('save')}
        cancelLabel={t('cancel')}
        valid={name.trim() !== '' && !props.pending}
      >
        <form
          className={css.presetForm}
          onSubmit={(event) => {
            event.preventDefault()
            void addPreset()
          }}
        >
          <FormField label={t('examples.presetName')} wide>
            <input
              autoFocus
              value={name}
              maxLength={80}
              required
              disabled={props.pending}
              placeholder={t('examples.tagPlaceholder')}
              onChange={(event) => { setName(event.target.value) }}
            />
          </FormField>
          <p className={css.muted}>{t('examples.presetHint')}</p>
          {failed && <p role="alert">{t('examples.presetFailed')}</p>}
        </form>
      </EditorModal>
    </div>
  )
}
