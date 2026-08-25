import { renderToString } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { useVoiceRecorder } from '../src/useVoiceRecorder.ts'

function ServerProbe() {
  const recorder = useVoiceRecorder({
    transcribe: vi.fn(async () => 'unused'),
    onTranscript: vi.fn(),
    onError: vi.fn(),
  })
  return <span>{recorder.supported ? 'supported' : 'unsupported'}</span>
}

it('renders unsupported without browser globals', () => {
  expect(renderToString(<ServerProbe />)).toContain('unsupported')
})
