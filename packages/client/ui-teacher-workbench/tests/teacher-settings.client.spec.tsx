// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DEFAULT_TEACHER_WORKBENCH_SETTINGS } from '../src/settings.ts'
import { zh } from '../src/client/locales.ts'
import { TeacherWorkbenchSettingsRow, type TeacherWorkbenchSettingsRowProps } from '../src/client/TeacherWorkbenchSettingsRow.tsx'

const dictionary: Readonly<Record<string, string>> = zh

const t: TeacherWorkbenchSettingsRowProps['t'] = (key, params) => {
  let value = dictionary[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

type AttentionSnapshot = Parameters<Parameters<TeacherWorkbenchSettingsRowProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: TeacherWorkbenchSettingsRowProps['useSessionPendingInteraction'] =
  selector => selector(noAttention)

afterEach(cleanup)

describe('TeacherWorkbenchSettingsRow layout', () => {
  it('groups full-width settings and persists both question-cutting controls', () => {
    const setSetting = vi.fn(async () => {})
    const snapshot = {
      status: 'ready' as const,
      value: DEFAULT_TEACHER_WORKBENCH_SETTINGS,
      base: {},
      user: {},
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }
    render(
      <TeacherWorkbenchSettingsRow
        useTeacherSettings={selector => selector(snapshot)}
        useSessions={() => { throw new Error('unused') }}
        useSessionPendingInteraction={useSessionPendingInteraction}
        useWorkspaces={() => { throw new Error('unused') }}
        setSetting={setSetting}
        t={t}
      />,
    )

    expect(screen.getByRole('region', { name: '基础信息' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '成绩标准' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '试题切割' })).toBeTruthy()
    expect(screen.getByText(/清晰度倍率控制 PDF 栅格与切题图片分辨率/u)).toBeTruthy()

    for (const [label, field, value] of [
      ['切题清晰度倍率', 'questionRenderScale', '2.5'],
      ['切题边距', 'questionCropPadding', '18'],
    ] as const) {
      const input = screen.getByLabelText(label)
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
      expect(setSetting).toHaveBeenCalledWith(field, Number(value))
    }
  })
})
