/** Host registration for teacher-workbench preferences. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
  TeacherWorkbenchSettingsSchema,
  validateTeacherWorkbenchSettings,
} from './settings.ts'

export {
  DEFAULT_TEACHER_WORKBENCH_SETTINGS,
  TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
  TeacherWorkbenchSettingsSchema,
  validateTeacherWorkbenchSettings,
  type TeacherWorkbenchSettings,
} from './settings.ts'

/**
 * Register the durable workbench settings section when settings are composed.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(TEACHER_WORKBENCH_SETTINGS_NAMESPACE),
      TeacherWorkbenchSettingsSchema,
      { validate: validateTeacherWorkbenchSettings },
    )
  })
}
