import { defineConfig } from 'tsdown'

/**
 * The dsh app ships the public CLI plus an IPC-controlled Web backend for the
 * Electron distribution. Each entry is bundled separately so the backend
 * carries no CLI dispatch side effects and neither artifact needs a shared
 * chunk. Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig([
  {
    entry: ['lib/types/bin.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/desktop-backend.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
