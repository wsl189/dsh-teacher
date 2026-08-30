// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  TeacherClassId,
  TeacherNoticeTemplate,
  TeacherStudentId,
  TeacherWorkbenchState,
} from '@deepseek-ai/dsh-api-remotes/client'
import { FamilyCommunication, generateFamilyNotice } from '../src/client/FamilyCommunication.tsx'
import { StructuredRecords } from '../src/client/StructuredRecords.tsx'
import { SeatingPlan } from '../src/client/SeatingPlan.tsx'
import type { TeacherWorkbenchCommands } from '../src/client/contracts.ts'
import { zh } from '../src/client/locales.ts'

const t = ((key: keyof typeof zh, params?: Record<string, unknown>) => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) {
    value = value.replaceAll(`{${name}}`, String(replacement))
  }
  return value
})

const classId = 'class-a' as TeacherClassId
const studentId = 'student-a' as TeacherStudentId
const noticeTemplate: TeacherNoticeTemplate = {
  id: 'notice-template-a' as TeacherNoticeTemplate['id'],
  name: '放假通知',
  icon: 'calendar',
  hint: '适合法定节假日。',
  starter: '📅 放假时间：【填写】',
  custom: false,
}

function state(): TeacherWorkbenchState {
  return {
    dailyTodos: [], quickNotes: [], ledgerCategories: [], ledgerEntries: [], calendarItems: [], timetableEntries: [],
    classes: [{ id: classId, usage: 'roster', name: '高一（1）班', grade: '高一', subject: '语文' }],
    students: [{
      id: studentId, classId, name: '张同学', studentNumber: '1', gender: '', guardian: '', relation: '', phone: '', address: '', extras: {},
    }],
    resources: [],
    templates: [{
      id: 'class-template-a' as never,
      kind: 'class',
      name: '班级事项记录',
      scene: '记录事实和后续动作。',
      fields: ['客观事实', '后续跟进'],
    }],
    records: [],
    noticeTemplates: [noticeTemplate],
    notices: [],
    seatingLayouts: [],
    exams: [], questionBatches: [], questionLibraryFolders: [], questionFolders: [], questionAssignments: [],
  }
}

function commands(): TeacherWorkbenchCommands {
  const ok = vi.fn(async () => ({ ok: true } as const))
  return {
    saveNoticeTemplate: ok,
    deleteNoticeTemplate: ok,
    saveNotice: ok,
    deleteNotice: ok,
    saveSeatingLayout: ok,
    saveTemplate: ok,
    deleteTemplate: ok,
    saveRecord: ok,
    toggleRecord: ok,
    deleteRecord: ok,
    importStudents: ok,
    extractDocument: vi.fn(async () => ({ ok: false, error: { code: 'provider-unavailable', message: 'unavailable' } } as const)),
  } as unknown as TeacherWorkbenchCommands
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('headteacher workbench modules', () => {
  it('generates a complete editable family notice and saves the reviewed draft', async () => {
    const generated = generateFamilyNotice({
      type: '放假通知', audience: '各位家长', date: '9月30日 16:30', facts: '📅 放假时间：10月1日', signature: '王老师',
    }, noticeTemplate, t)
    expect(generated).toContain('📣 【放假通知】')
    expect(generated).toContain('⏰ 重点时间：9月30日 16:30')
    expect(generated).toContain('涉及学生隐私的信息请勿直接发在班级群内')

    const saveNotice = vi.fn(async (_input: Parameters<TeacherWorkbenchCommands['saveNotice']>[0]) => ({ ok: true } as const))
    const c = { ...commands(), saveNotice }
    render(<FamilyCommunication state={state()} commands={c} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '生成可编辑初稿' }))
    expect(screen.getByDisplayValue(/📣 【放假通知】/u)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(saveNotice).toHaveBeenCalledOnce()
    const saved = saveNotice.mock.calls[0]?.[0]
    expect(saved?.title).toBe('放假通知')
    expect(saved?.content).toContain('📣 【放假通知】')
  })

  it('uses the class-record template library to open a complete record editor', () => {
    render(<StructuredRecords kind="class" state={state()} commands={commands()} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /模板库/u }))
    expect(screen.getByText('班级事项记录')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '使用模板' }).at(-1)!)
    expect(screen.getAllByText('客观事实')).toHaveLength(2)
    expect(screen.getAllByText('后续跟进')).toHaveLength(2)
  })

  it('renders the roster in a teacher-oriented seat grid and persists its layout', async () => {
    const c = commands()
    render(<SeatingPlan state={state()} commands={c} t={t} />)
    expect(screen.getByText('张同学')).toBeTruthy()
    expect(screen.getByText('讲台 · 教师视角')).toBeTruthy()
    expect(screen.getByText(/黑 板/u)).toBeTruthy()
    await waitFor(() => {
      expect(c.saveSeatingLayout).toHaveBeenCalledWith(expect.objectContaining({ classId, rows: 5, columns: 6 }))
    })
  })
})
