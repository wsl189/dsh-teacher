/** Provider identity artwork for preset choices and saved connections. */
import { providerSupplierPreset } from './provider-presets.ts'
import { PROVIDER_LOGOS } from './provider-logos.ts'
import styles from './ModelsSection.module.css'

/** Identity used to resolve a supplier mark or a custom-provider initial. */
interface ProviderLogoProps {
  provider: string
  displayName: string
}

/**
 * Render a decorative, locally bundled supplier mark beside its visible name.
 * @param props - route identity and visible name.
 * @returns provider artwork or a neutral initial for an unknown custom service.
 */
export function ProviderLogo({ provider, displayName }: ProviderLogoProps) {
  const supplier = providerSupplierPreset(provider)
  const identity = supplier?.id ?? provider.toLowerCase()
  const logo = Object.entries(PROVIDER_LOGOS).find(([id]) => id === identity
    || id === displayName.trim().toLowerCase())?.[1]
  return (
    <span className={`${styles['providerLogo']} ${logo === undefined ? styles['providerLogoFallback'] : ''}`}
      aria-hidden="true">
      {logo === undefined
        ? displayName.trim().slice(0, 1).toUpperCase()
        : <img src={logo} alt="" draggable={false} />}
    </span>
  )
}
