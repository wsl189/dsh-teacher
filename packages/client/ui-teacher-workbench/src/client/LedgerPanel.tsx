/** Expandable daily ledger with teacher-defined categories and voice entry. */

import { useMemo, useState } from 'react'
import { Calendar, Maximize2, Minimize2, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react'
import type {
  TeacherLedgerCategory,
  TeacherLedgerCategoryId,
  TeacherLedgerEntry,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { TeacherWorkbenchSettings } from '../settings.ts'
import type { TeacherWorkbenchCommands } from './contracts.ts'
import { EditorModal, FormField, IconAction, type TeacherWorkbenchTranslate } from './shared.tsx'
import { VoiceInputButton } from './SpeechInput.tsx'
import css from './TeacherWorkbench.module.css'

/** Ledger panel props. */
export interface LedgerPanelProps {
  /** Complete durable workbench state. */
  state: TeacherWorkbenchState
  /** Voice-recognition settings. */
  settings: TeacherWorkbenchSettings
  /** Durable workbench commands. */
  commands: TeacherWorkbenchCommands
  /** Whether the ledger occupies the full daily-management area. */
  expanded: boolean
  /** Expand the ledger. */
  onExpand: () => void
  /** Return to the daily-management board. */
  onCollapse: () => void
  /** Workbench translator. */
  t: TeacherWorkbenchTranslate
}

/**
 * Render the compact ledger summary or category-based entry workspace.
 * @param props - durable ledger data, voice settings, commands, expansion state, and copy.
 * @returns a compact summary or expanded category ledger.
 */
export function LedgerPanel(props: LedgerPanelProps) {
  const [addingCategory, setAddingCategory] = useState(false)
  const [editingEntry, setEditingEntry] = useState<TeacherLedgerEntry | null>(null)
  const entries = useMemo(
    () => [...props.state.ledgerEntries].sort((left, right) => (
      right.occurredAt.localeCompare(left.occurredAt) || right.createdAt - left.createdAt
    )),
    [props.state.ledgerEntries],
  )
  const totalCents = entries.reduce((sum, entry) => sum + entry.amountCents, 0)
  const toggleLabel = props.expanded ? props.t('daily.panel.collapse') : props.t('daily.panel.expand')
  const deleteCategory = (category: TeacherLedgerCategory): void => {
    const count = entries.filter(entry => entry.categoryId === category.id).length
    if (globalThis.confirm(props.t('daily.ledger.confirmDeleteCategory', { name: category.name, count }))) {
      void props.commands.deleteLedgerCategory(category.id)
    }
  }

  return (
    <section className={`${css.dailyPanel} ${css.ledgerPanel} ${props.expanded ? css.dailyPanelExpanded : ''}`} aria-labelledby="daily-ledger-title">
      <header className={css.dailyPanelHeader}>
        <div>
          <h2 id="daily-ledger-title">{props.t('daily.ledger.title')}</h2>
          <span>{props.t('daily.ledger.summary', { count: entries.length, total: formatAmount(totalCents) })}</span>
        </div>
        <div className={css.dailyPanelActions}>
          {props.expanded && (
            <button type="button" className={css.dailyIconButton} aria-label={props.t('daily.ledger.addCategory')} title={props.t('daily.ledger.addCategory')} onClick={() => { setAddingCategory(true) }}>
              <Plus size={17} />
            </button>
          )}
          <button type="button" className={css.dailyIconButton} aria-label={toggleLabel} title={toggleLabel} onClick={props.expanded ? props.onCollapse : props.onExpand}>
            {props.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </header>
      {props.expanded
        ? (
          <div className={css.ledgerExpandedBody}>
            {props.state.ledgerCategories.length === 0
              ? (
                <button type="button" className={css.ledgerEmptyAction} onClick={() => { setAddingCategory(true) }}>
                  <Plus size={18} />
                  {props.t('daily.ledger.emptyCategories')}
                </button>
              )
              : props.state.ledgerCategories.map(category => (
                <LedgerCategoryCard
                  key={category.id}
                  category={category}
                  entries={entries.filter(entry => entry.categoryId === category.id)}
                  settings={props.settings}
                  commands={props.commands}
                  t={props.t}
                  onEdit={setEditingEntry}
                  onDeleteCategory={() => { deleteCategory(category) }}
                />
              ))}
          </div>
        )
        : (
          <button type="button" className={css.ledgerCompactBody} onClick={props.onExpand} aria-label={props.t('daily.ledger.open')}>
            <ReceiptText size={28} />
            {entries.length === 0
              ? <span>{props.t('daily.ledger.empty')}</span>
              : (
                <>
                  <strong>{formatAmount(totalCents)}</strong>
                  <span>{props.t('daily.ledger.categoryCount', { count: props.state.ledgerCategories.length })}</span>
                  <div className={css.ledgerCompactCategories} aria-hidden="true">
                    {props.state.ledgerCategories.slice(0, 3).map(category => <i key={category.id}>{category.name}</i>)}
                  </div>
                </>
              )}
          </button>
        )}
      {addingCategory && (
        <CategoryEditor commands={props.commands} t={props.t} onClose={() => { setAddingCategory(false) }} />
      )}
      {editingEntry !== null && (
        <EntryEditor
          entry={editingEntry}
          categories={props.state.ledgerCategories}
          language={props.settings.speechLanguage}
          commands={props.commands}
          t={props.t}
          onClose={() => { setEditingEntry(null) }}
        />
      )}
    </section>
  )
}

function LedgerCategoryCard(props: {
  category: TeacherLedgerCategory
  entries: readonly TeacherLedgerEntry[]
  settings: TeacherWorkbenchSettings
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onEdit: (entry: TeacherLedgerEntry) => void
  onDeleteCategory: () => void
}) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const amountCents = parseAmountCents(amount)
  const save = async (): Promise<void> => {
    if (description.trim() === '' || amountCents === null || occurredAt === '') return
    const result = await props.commands.saveLedgerEntry({
      categoryId: props.category.id,
      description,
      amountCents,
      occurredAt,
    })
    if (result.ok) {
      setDescription('')
      setAmount('')
      setOccurredAt('')
    }
  }
  const categoryTotal = props.entries.reduce((sum, entry) => sum + entry.amountCents, 0)
  return (
    <article className={css.ledgerCategoryCard} aria-label={props.category.name}>
      <header className={css.ledgerCategoryHeader}>
        <div>
          <h3>{props.category.name}</h3>
          <span>{props.t('daily.ledger.categorySummary', { count: props.entries.length, total: formatAmount(categoryTotal) })}</span>
        </div>
        <IconAction label={props.t('daily.ledger.deleteCategoryNamed', { name: props.category.name })} danger onClick={props.onDeleteCategory}>
          <Trash2 size={15} />
        </IconAction>
      </header>
      <form className={css.ledgerComposer} onSubmit={(event) => { event.preventDefault(); void save() }}>
        <label className={`${css.ledgerComposerField} ${css.ledgerComposerDescription}`}>
          <span>{props.t('daily.ledger.description')}</span>
          <div className={css.ledgerDescriptionField}>
            <input
              aria-label={props.t('daily.ledger.description')}
              maxLength={500}
              value={description}
              placeholder={props.t('daily.ledger.descriptionPlaceholder')}
              onChange={(event) => { setDescription(event.target.value) }}
            />
            <VoiceInputButton
              language={props.settings.speechLanguage}
              onTranscript={(transcript) => { setDescription(current => current.trim() === '' ? transcript : `${current.trimEnd()} ${transcript}`) }}
              t={props.t}
            />
          </div>
        </label>
        <label className={css.ledgerComposerField}>
          <span>{props.t('daily.ledger.amount')}</span>
          <input aria-label={props.t('daily.ledger.amount')} inputMode="decimal" value={amount} placeholder="0.00" onChange={(event) => { setAmount(event.target.value) }} />
        </label>
        <div className={`${css.ledgerComposerField} ${css.ledgerComposerTime}`}>
          <span>{props.t('daily.ledger.time')}</span>
          <label
            className={css.todoDeadlinePicker}
            data-has-value={occurredAt !== ''}
            data-ledger-time-picker
            title={occurredAt === ''
              ? props.t('daily.ledger.time')
              : `${props.t('daily.ledger.time')}: ${formatLedgerTime(occurredAt)}`}
          >
            <Calendar size={17} aria-hidden="true" />
            <input
              className={css.todoDeadlineInput}
              aria-label={props.t('daily.ledger.time')}
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => { setOccurredAt(event.target.value) }}
            />
          </label>
        </div>
        <button
          type="submit"
          className={`${css.dailyAddButton} ${css.ledgerAddEntryButton}`}
          aria-label={props.t('daily.ledger.addEntry')}
          title={props.t('daily.ledger.addEntry')}
          disabled={description.trim() === '' || amountCents === null || occurredAt === ''}
        >
          <Plus size={16} />
        </button>
      </form>
      <div className={css.ledgerEntryList}>
        {props.entries.length === 0
          ? <div className={css.dailyEmpty}>{props.t('daily.ledger.emptyCategory')}</div>
          : props.entries.map(entry => (
            <article key={entry.id} className={css.ledgerEntry}>
              <button type="button" className={css.ledgerEntryMain} onClick={() => { props.onEdit(entry) }}>
                <span>{entry.description}</span>
                <time>{formatLedgerTime(entry.occurredAt)}</time>
              </button>
              <strong>{formatAmount(entry.amountCents)}</strong>
              <button
                type="button"
                className={css.ledgerEntryAction}
                aria-label={props.t('edit')}
                title={props.t('edit')}
                onClick={() => { props.onEdit(entry) }}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className={css.ledgerEntryActionDanger}
                aria-label={props.t('daily.ledger.deleteEntry')}
                title={props.t('daily.ledger.deleteEntry')}
                onClick={() => { if (globalThis.confirm(props.t('confirm.delete'))) void props.commands.deleteLedgerEntry(entry.id) }}
              >
                <Trash2 size={14} />
              </button>
            </article>
          ))}
      </div>
    </article>
  )
}

function CategoryEditor(props: {
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const save = async (): Promise<void> => {
    const result = await props.commands.saveLedgerCategory({ name })
    if (result.ok) props.onClose()
  }
  return (
    <EditorModal open title={props.t('daily.ledger.addCategory')} closeLabel={props.t('close')} onClose={props.onClose} onSave={() => { void save() }} saveLabel={props.t('save')} cancelLabel={props.t('cancel')} valid={name.trim() !== ''}>
      <FormField label={props.t('daily.ledger.categoryName')}>
        <input autoFocus maxLength={40} value={name} onChange={(event) => { setName(event.target.value) }} />
      </FormField>
    </EditorModal>
  )
}

function EntryEditor(props: {
  entry: TeacherLedgerEntry
  categories: readonly TeacherLedgerCategory[]
  language: string
  commands: TeacherWorkbenchCommands
  t: TeacherWorkbenchTranslate
  onClose: () => void
}) {
  const [categoryId, setCategoryId] = useState<TeacherLedgerCategoryId>(props.entry.categoryId)
  const [description, setDescription] = useState(props.entry.description)
  const [amount, setAmount] = useState((props.entry.amountCents / 100).toFixed(2))
  const [occurredAt, setOccurredAt] = useState(props.entry.occurredAt)
  const amountCents = parseAmountCents(amount)
  const save = async (): Promise<void> => {
    if (amountCents === null) return
    const result = await props.commands.saveLedgerEntry({ id: props.entry.id, categoryId, description, amountCents, occurredAt })
    if (result.ok) props.onClose()
  }
  return (
    <EditorModal open title={props.t('daily.ledger.editEntry')} closeLabel={props.t('close')} onClose={props.onClose} onSave={() => { void save() }} saveLabel={props.t('save')} cancelLabel={props.t('cancel')} valid={description.trim() !== '' && amountCents !== null && occurredAt !== ''}>
      <FormField label={props.t('daily.ledger.categoryName')}>
        <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value as TeacherLedgerCategoryId) }}>
          {props.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </FormField>
      <div className={css.fieldWide}>
        <span className={css.fieldLabel}>{props.t('daily.ledger.description')}</span>
        <div className={css.ledgerDescriptionField}>
          <input aria-label={props.t('daily.ledger.description')} maxLength={500} value={description} onChange={(event) => { setDescription(event.target.value) }} />
          <VoiceInputButton language={props.language} onTranscript={(transcript) => { setDescription(current => current.trim() === '' ? transcript : `${current.trimEnd()} ${transcript}`) }} t={props.t} />
        </div>
      </div>
      <FormField label={props.t('daily.ledger.amount')}>
        <input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value) }} />
      </FormField>
      <FormField label={props.t('daily.ledger.time')}>
        <input type="datetime-local" value={occurredAt} onChange={(event) => { setOccurredAt(event.target.value) }} />
      </FormField>
    </EditorModal>
  )
}

function parseAmountCents(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null
  const [whole = '0', fraction = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

function formatAmount(cents: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100)
}

function formatLedgerTime(value: string): string {
  return value.replace('T', ' ')
}
