/** Model-facing Consumer for the durable teacher workbench. @module @deepseek-ai/dsh-tool-teacher-workbench */

import type { Context } from '@deepseek-ai/cordis'
import { registerTeacherWorkbenchTools } from '@deepseek-ai/dsh-host-teacher-workbench'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-teacher-workbench'

/** Capability services required by the model-facing Consumer. */
export const inject = ['fs', 'tools', 'teacherWorkbench']

/**
 * Register the ordinary-conversation workbench tools against the authoritative Host service.
 * @param ctx - context providing the filesystem, tool registry, and teacher-workbench service.
 */
export function apply(ctx: Context): void {
  registerTeacherWorkbenchTools(ctx, ctx.teacherWorkbench, ctx.fs)
}
