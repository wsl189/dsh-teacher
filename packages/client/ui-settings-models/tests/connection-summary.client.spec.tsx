// @vitest-environment jsdom
/** Connection summaries report one check and keep media models free of test statuses. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionSummary } from '../src/client/ConnectionSummary.tsx'
import type { ConnectionSummaryProps } from '../src/client/ConnectionSummary.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const MODELS: ConnectionSummaryProps['models'] = [
  { id: 'text', name: 'Chat model', type: 'chat' },
  { id: 'vision', name: 'Vision model', type: 'vision' },
  { id: 'image', name: 'Image model', type: 'image' },
  { id: 'speech', name: 'Speech model', type: 'speech' },
]

function summary(overrides: Partial<ConnectionSummaryProps> = {}): ConnectionSummaryProps {
  return {
    ready: true, models: MODELS, check: undefined, capabilities: [], usages: [],
    t: key => en[key], onRetry: vi.fn(), onUsage: vi.fn(), ...overrides,
  }
}

describe('connection summary', () => {
  it('shows one verified connection with model types and identifies only the tested model', () => {
    render(<ConnectionSummary {...summary({
      check: { model: 'text', status: 'passed', attempt: 1, signature: 'connection' },
    })} />)
    expect(screen.getAllByText(en.connectionPassed)).toHaveLength(1)
    fireEvent.click(screen.getByText(en.viewConnectionModels))
    expect(screen.getByText('Test model: Chat model')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    const labels = [en.requestTypeChat, en.requestTypeVision, en.requestTypeImageGeneration, en.requestTypeSpeechRecognition]
    for (const [index, row] of rows.entries()) {
      expect(row.textContent).toBe(`${MODELS[index]!.name}${labels[index]!}`)
    }
    expect(screen.queryByRole('button', { name: en.retryVerification })).toBeNull()
  })

  it('shows media-only connections as configured without requesting verification', () => {
    render(<ConnectionSummary {...summary({ models: MODELS.slice(2) })} />)
    expect(screen.getByText(en.connectionConfigured)).toBeTruthy()
    expect(screen.queryByText(en.connectionUnverified)).toBeNull()
    fireEvent.click(screen.getByText(en.viewConnectionModels))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: en.retryVerification })).toBeNull()
  })

  it('offers one retry for a failed connection and keeps the model directory intact', () => {
    const props = summary({ check: { model: 'vision', status: 'failed', attempt: 1, signature: 'connection', error: 'No access' } })
    render(<ConnectionSummary {...props} />)
    expect(screen.getByText(en.connectionFailed)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Vision model: No access')
    fireEvent.click(screen.getByRole('button', { name: en.retryVerification }))
    expect(props.onRetry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText(en.viewConnectionModels))
    expect(within(screen.getByRole('list')).queryByText(en.connectionFailed)).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })
})
