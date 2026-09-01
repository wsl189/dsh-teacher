// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { VoiceMicrophoneIcon } from '../src/VoiceMicrophoneIcon.tsx'

afterEach(cleanup)

it('clamps the bottom-up fill while preserving the active microphone glyph', () => {
  const view = render(<VoiceMicrophoneIcon active level={0.625} size={20} />)
  const microphone = view.container.querySelector('svg')!
  const fillWindow = view.container.querySelector('clipPath rect')!
  expect(microphone.getAttribute('data-voice-active')).toBe('true')
  expect(microphone.getAttribute('data-voice-level')).toBe('0.625')
  expect(microphone.getAttribute('width')).toBe('20')
  expect(fillWindow.getAttribute('y')).toBe('6')
  expect(fillWindow.getAttribute('height')).toBe('10')

  view.rerender(<VoiceMicrophoneIcon active={false} level={2} />)
  expect(microphone.getAttribute('data-voice-active')).toBe('false')
  expect(microphone.getAttribute('data-voice-level')).toBe('1.000')
  expect(fillWindow.getAttribute('y')).toBe('0')
  expect(fillWindow.getAttribute('height')).toBe('16')

  view.rerender(<VoiceMicrophoneIcon active={false} level={-1} />)
  expect(microphone.getAttribute('data-voice-level')).toBe('0.000')
  expect(fillWindow.getAttribute('y')).toBe('16')
  expect(fillWindow.getAttribute('height')).toBe('0')
})
