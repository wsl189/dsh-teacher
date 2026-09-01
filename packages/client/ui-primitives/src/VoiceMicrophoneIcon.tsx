/** Microphone glyph whose active fill follows the current input level. */

import { useId } from 'react'
import css from './VoiceMicrophoneIcon.module.css'

/** Voice microphone glyph props. */
export interface VoiceMicrophoneIconProps {
  /** Whether the microphone is actively listening. */
  readonly active: boolean
  /** Current microphone level from zero to one. */
  readonly level: number
  /** Rendered square size in CSS pixels. */
  readonly size?: number
}

/**
 * Render a pulsing microphone filled from bottom to top by its input level.
 * @param props - active state, normalized level, and optional size.
 * @returns one decorative SVG glyph for a labeled voice-input control.
 */
export function VoiceMicrophoneIcon({ active, level, size = 16 }: VoiceMicrophoneIconProps) {
  const clipId = useId()
  const normalized = Math.max(0, Math.min(1, level))
  const top = 16 * (1 - normalized)
  return (
    <svg
      className={active ? css.active : css.root}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      data-voice-active={active ? 'true' : 'false'}
      data-voice-level={normalized.toFixed(3)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y={top} width="16" height={16 - top} />
        </clipPath>
      </defs>
      <g className={css.fill} clipPath={`url(#${clipId})`}>
        <rect x="5.25" y="1.5" width="5.5" height="8.5" rx="2.75" fill="currentColor" />
        <path d="M3.5 7.75a4.5 4.5 0 0 0 9 0M8 12.25V15M5.5 15h5" />
      </g>
      <g className={css.outline}>
        <rect x="5.25" y="1.5" width="5.5" height="8.5" rx="2.75" />
        <path d="M3.5 7.75a4.5 4.5 0 0 0 9 0M8 12.25V15M5.5 15h5" />
      </g>
    </svg>
  )
}
