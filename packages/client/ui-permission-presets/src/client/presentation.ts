/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/** Locale keys shared by the current-session and future-session permission pickers. */
export type PermissionPresetCopyKey =
  | 'option.readOnly' | 'option.readOnlyDescription'
  | 'option.workspaceWrite' | 'option.workspaceWriteDescription'
  | 'option.fullAccess' | 'option.fullAccessDescription'

/** Localized display copy for one permission preset. */
export interface PermissionPresetCopy {
  label: string
  description: string | undefined
}

/**
 * Convert conventional kebab-case preset names into user-facing title case.
 * @param name - host-supplied preset label or key.
 * @returns the title-cased conventional key, or a non-kebab label unchanged.
 */
export function displayPresetName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Render a permission preset under its product label.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @returns the Full access product label or the conventional display name.
 */
export function displayPermissionPreset(value: string, name: string): string {
  return value === FULL_ACCESS_PRESET ? 'Full access' : displayPresetName(name)
}

/**
 * Render the three product presets with locale copy while preserving host-defined fallbacks.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param description - host-supplied fallback description.
 * @param t - locale translator for the shared option keys.
 * @returns localized product copy or host-defined fallback copy.
 */
export function permissionPresetCopy(
  value: string,
  name: string,
  description: string | undefined,
  t: (key: PermissionPresetCopyKey) => string,
): PermissionPresetCopy {
  switch (value) {
    case 'read-only':
      return { label: t('option.readOnly'), description: t('option.readOnlyDescription') }
    case 'workspace-write':
      return { label: t('option.workspaceWrite'), description: t('option.workspaceWriteDescription') }
    case FULL_ACCESS_PRESET:
      return { label: t('option.fullAccess'), description: t('option.fullAccessDescription') }
    default:
      return { label: displayPresetName(name), description }
  }
}
