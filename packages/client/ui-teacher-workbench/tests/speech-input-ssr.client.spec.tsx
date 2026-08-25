import { expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { VoiceInputButton } from '../src/client/SpeechInput.tsx'
import { zh } from '../src/client/locales.ts'

it('renders the unsupported voice command without a browser global', () => {
  const markup = renderToString(
    <VoiceInputButton transcribe={vi.fn()} onTranscript={vi.fn()} t={key => zh[key]} />,
  )
  expect(markup).toContain('当前浏览器不支持语音输入')
  expect(markup).toContain('disabled')
})
