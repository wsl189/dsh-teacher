/** Staged form for Host question-media storage settings. */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Namespace registered by the Host teacher-workbench service. */
export const TEACHER_WORKBENCH_NS = 'teacher-workbench'

/** Host settings edited by the question-workspace card. */
export interface TeacherWorkbenchHostSettings {
  /** Root for paper batches. */
  segmentsRoot?: string
  /** Root for readable student assignment copies. */
  studentsRoot?: string
  /** Single decoded image byte limit. */
  maxQuestionImageBytes?: number
  /** One automatic save part's decoded byte limit. */
  maxQuestionBatchBytes?: number
}

/** Projected card state. */
export interface TeacherWorkbenchCardState extends CardShell {
  segmentsRoot: CardFieldState
  studentsRoot: CardFieldState
  maxQuestionImageBytes: CardFieldState
  maxQuestionBatchBytes: CardFieldState
}

/** Slot inject face for the question-workspace settings card. */
export interface TeacherWorkbenchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound as useTeacherWorkbenchCard. */
    teacherWorkbenchCard: SnapshotStore<TeacherWorkbenchCardState>
  }
}

/** Bridge the Host namespace onto the staged card form. */
export class TeacherWorkbenchCardController {
  private readonly form: CardForm<TeacherWorkbenchHostSettings>
  private readonly store: SnapshotStore<TeacherWorkbenchCardState>

  /** @param scope - settings scope bound to the Host teacher-workbench namespace. */
  constructor(scope: SettingsScope<TeacherWorkbenchHostSettings>) {
    this.form = new CardForm(scope, [
      textField('segmentsRoot'),
      textField('studentsRoot'),
      numberField('maxQuestionImageBytes'),
      numberField('maxQuestionBatchBytes'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): TeacherWorkbenchCardState {
    return {
      ...this.form.shell(),
      segmentsRoot: this.form.field('segmentsRoot'),
      studentsRoot: this.form.field('studentsRoot'),
      maxQuestionImageBytes: this.form.field('maxQuestionImageBytes'),
      maxQuestionBatchBytes: this.form.field('maxQuestionBatchBytes'),
    }
  }

  /**
   * Build the slot injection face.
   * @returns card snapshot and staged form actions.
   */
  inject(): TeacherWorkbenchCardFace {
    return { hooks: { teacherWorkbenchCard: this.store }, ...this.form.actions() }
  }
}
