import { describe, expect, it, vi } from 'vitest'
import {
  apply as nodeApply,
  TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
  TeacherWorkbenchSettingsSchema,
  validateTeacherWorkbenchSettings,
} from '../src/index.ts'

describe('teacher-workbench node wiring', () => {
  it('registers its settings namespace when the settings service appears', () => {
    const register = vi.fn()
    const ctx = {
      inject: vi.fn((_dependencies: string[], install: (scope: unknown) => void) => {
        install({ settings: { register } })
      }),
    }
    nodeApply(ctx as never)
    expect(ctx.inject).toHaveBeenCalledWith(['settings'], expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      TEACHER_WORKBENCH_SETTINGS_NAMESPACE,
      TeacherWorkbenchSettingsSchema,
      { validate: validateTeacherWorkbenchSettings },
    )
  })

  it('rejects inverted score thresholds', () => {
    expect(() => {
      validateTeacherWorkbenchSettings({
        academicYear: '2026',
        teacherName: '', schoolName: '', defaultSubject: '',
        weatherLocation: '',
        scoreFullMark: 100, excellentScore: 59, passScore: 60,
        questionRenderScale: 2, questionCropPadding: 12,
      })
    }).toThrow('passScore')
    expect(() => {
      validateTeacherWorkbenchSettings({
        academicYear: '2026',
        teacherName: '', schoolName: '', defaultSubject: '',
        weatherLocation: '',
        scoreFullMark: 100, excellentScore: 101, passScore: 60,
        questionRenderScale: 2, questionCropPadding: 12,
      })
    }).toThrow('excellentScore')
    expect(() => {
      validateTeacherWorkbenchSettings({
        academicYear: '2026',
        teacherName: '', schoolName: '', defaultSubject: '',
        weatherLocation: '',
        scoreFullMark: 100, excellentScore: 85, passScore: 60,
        questionRenderScale: 2, questionCropPadding: 12,
      })
    }).not.toThrow()
  })
})
