import { describe, expect, it } from 'vitest'
import {
  APPLICATION_WINDOW_OPTIONS,
  STARTUP_WINDOW_OPTIONS,
} from '../src/window-presentation.ts'

describe('desktop window presentation', () => {
  it('uses a transparent rounded startup card and an ordinary application window', () => {
    expect(STARTUP_WINDOW_OPTIONS).toEqual({
      width: 380,
      height: 340,
      center: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      roundedCorners: true,
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
    })
    expect(APPLICATION_WINDOW_OPTIONS).toEqual({
      width: 1440,
      height: 900,
      minWidth: 980,
      minHeight: 640,
      center: true,
      show: false,
      backgroundColor: '#f7f8fa',
      autoHideMenuBar: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,
    })
  })
})
