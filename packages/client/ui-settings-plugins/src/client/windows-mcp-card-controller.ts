/** The built-in Windows desktop automation card over the `windows-mcp` namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { booleanField, CardForm, type CardActions, type CardShell } from './card-form.ts'

/** Host-owned namespace; repeated here so the browser package never imports Host code. */
export const WINDOWS_MCP_NS = 'windows-mcp'

/** Settings values the card reads. The launcher-owned runtime path is never editable here. */
export interface WindowsMcpSettings {
  /** Whether the Host mounts the bundled MCP child. */
  enabled?: boolean
  /** Bundled executable path supplied by the desktop launcher. */
  runtimeCommand?: string
}

/** What the Windows desktop automation card renders. */
export interface WindowsMcpCardState extends CardShell {
  /** Staged on/off state. */
  readonly enabled: boolean
  /** Whether this deployment supplied a runnable bundled command. */
  readonly runtimeAvailable: boolean
}

/** The registration-side face injected into the Windows MCP card. */
export interface WindowsMcpCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useWindowsMcpCard. */
    windowsMcpCard: SnapshotStore<WindowsMcpCardState>
  }
  /** Stage the opposite enabled state. */
  toggleEnabled(): void
  /** Persist the staged enabled state. */
  save(): void
  /** Drop the staged enabled state. */
  discard(): void
}

/** Bridges the `windows-mcp` settings scope onto the staged on/off control. */
export class WindowsMcpCardController {
  private readonly form: CardForm<WindowsMcpSettings>
  private readonly store: SnapshotStore<WindowsMcpCardState>
  private readonly actions: CardActions

  /** @param scope - bound settings scope for the `windows-mcp` namespace. */
  constructor(private readonly scope: SettingsScope<WindowsMcpSettings>) {
    this.form = new CardForm(scope, [booleanField('enabled')])
    this.actions = this.form.actions()
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WindowsMcpCardState {
    const snapshot = this.scope.getSnapshot()
    const value = snapshot.status === 'ready' ? snapshot.value : undefined
    const runtimeCommand = value?.runtimeCommand
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled').text === 'true',
      runtimeAvailable: typeof runtimeCommand === 'string' && runtimeCommand.trim().length > 0,
    }
  }

  /**
   * Build the face injected into the card slot.
   * @returns staged toggle state and save/discard actions.
   */
  inject(): WindowsMcpCardFace {
    return {
      hooks: { windowsMcpCard: this.store },
      toggleEnabled: () => {
        const enabled = this.store.getSnapshot().enabled
        this.actions.edit('enabled', String(!enabled))
      },
      save: this.actions.save,
      discard: this.actions.discard,
    }
  }
}
