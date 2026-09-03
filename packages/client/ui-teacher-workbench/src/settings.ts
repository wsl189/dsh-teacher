/** Durable teacher-workbench preferences shared by the Host and browser halves. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the teacher-workbench feature. */
export const TEACHER_WORKBENCH_SETTINGS_NAMESPACE = 'ui-teacher-workbench'

/** Host plugin settings namespace that owns question-cutting execution policy. */
export const QUESTION_CUTTING_SETTINGS_NAMESPACE = 'teacher-workbench'

/** Question-cutting policy projected into the PDF page-range panel. */
export interface QuestionCuttingSettings {
  /** Default reasoning choice for the next PDF admitted to question cutting. */
  questionSegmentationReasoningEnabled?: boolean
}

/** Teacher identity, daily-management preferences, and score-analysis policy. */
export interface TeacherWorkbenchSettings {
  /** Default academic-year directory for legacy and newly created classes. */
  academicYear: string
  /** Teacher display name. */
  teacherName: string
  /** School display name. */
  schoolName: string
  /** Default subject used when creating a class. */
  defaultSubject: string
  /** District, county, or city query resolved by the weather provider. */
  weatherLocation: string
  /** Full score used to label score rates. */
  scoreFullMark: number
  /** Score at or above which an entry is excellent. */
  excellentScore: number
  /** Score at or above which an entry passes. */
  passScore: number
  /** PDF.js raster scale used before question crops are saved. */
  questionRenderScale: number
  /** Padding around detected question boundaries in MinerU layout units. */
  questionCropPadding: number
}

/** Product defaults used until the settings scope has loaded. */
export const DEFAULT_TEACHER_WORKBENCH_SETTINGS: TeacherWorkbenchSettings = Object.freeze({
  academicYear: String(new Date().getFullYear()),
  teacherName: '',
  schoolName: '',
  defaultSubject: '',
  weatherLocation: '',
  scoreFullMark: 100,
  excellentScore: 85,
  passScore: 60,
  questionRenderScale: 2,
  questionCropPadding: 4,
})

/** Durable schema registered in dsh settings. */
export const TeacherWorkbenchSettingsSchema: z<TeacherWorkbenchSettings> = z.object({
  academicYear: z.string().pattern(/^\d{4}(?:-\d{4})?$/u).default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.academicYear),
  teacherName: z.string().default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.teacherName),
  schoolName: z.string().default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.schoolName),
  defaultSubject: z.string().default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.defaultSubject),
  weatherLocation: z.string().pattern(/^.{0,80}$/u).default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.weatherLocation),
  scoreFullMark: z.number().step(1).min(1).max(1000).default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.scoreFullMark),
  excellentScore: z.number().step(1).min(0).max(1000).default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.excellentScore),
  passScore: z.number().step(1).min(0).max(1000).default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.passScore),
  questionRenderScale: z.number().step(0.25).min(1).max(4).default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.questionRenderScale),
  questionCropPadding: z.number().step(1).min(0).max(100).default(DEFAULT_TEACHER_WORKBENCH_SETTINGS.questionCropPadding),
})

/**
 * Reject score thresholds that cannot describe a monotonic grading policy.
 * @param value - schema-valid teacher-workbench settings.
 */
export function validateTeacherWorkbenchSettings(value: TeacherWorkbenchSettings): void {
  if (value.passScore > value.excellentScore) {
    throw new TypeError('teacher-workbench settings: passScore must not exceed excellentScore')
  }
  if (value.excellentScore > value.scoreFullMark) {
    throw new TypeError('teacher-workbench settings: excellentScore must not exceed scoreFullMark')
  }
}
