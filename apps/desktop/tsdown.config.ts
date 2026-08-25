import { defineConfig } from 'tsdown'

const external = (specifier: string): boolean =>
  specifier === 'electron'
  || specifier === 'electron-updater'
  || specifier === 'electron-log/main'

/** Build the Electron main entry as ESM and the sandboxed preload as CommonJS. */
export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: external },
  },
  {
    entry: ['lib/types/preload.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: external },
  },
])
